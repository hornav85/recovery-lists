import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { sql, toPublicUser, type PublicUser, type UserRow } from "./db";

const COOKIE = "rl_session";
const SESSION_DAYS = 14;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Username-only (primary), username+IP, and IP alone — Postgres-backed. */
const LOGIN_MAX_ATTEMPTS_USER = 8;
const LOGIN_MAX_ATTEMPTS_USER_IP = 8;
const LOGIN_MAX_ATTEMPTS_IP = 40;
const MIN_PASSWORD_LEN = 10;

function cookieSecure(): boolean {
  // Hosted apps are always HTTPS even when NODE_ENV is unset/mis-set.
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.CURSOR_APP_ID?.trim()) ||
    Boolean(process.env.VERCEL) ||
    process.env.COOKIE_SECURE === "1"
  );
}

/**
 * Client IP for rate limiting. Prefer platform headers; if using
 * X-Forwarded-For, take the *rightmost* hop (appended by the trusted
 * proxy). Never trust the leftmost value alone — clients can spoof it.
 */
export function clientIpFromRequest(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1].slice(0, 128);
  }

  return "unknown";
}

function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    expires,
    secure: cookieSecure(),
  };
}

/** Shared across instances via Postgres. Returns false when over limit. */
export async function checkLoginRateLimit(keys: {
  user: string;
  userIp: string;
  ip: string;
}): Promise<boolean> {
  const cutoff = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  await sql("DELETE FROM login_attempts WHERE attempted_at < $1", [cutoff]);

  let locked = false;
  try {
    await sql("SELECT pg_advisory_lock($1)", [7272751]);
    locked = true;
  } catch {
    locked = false;
  }
  try {
    const countFor = async (key: string) => {
      const rows = await sql<{ c: string | number }>(
        `SELECT COUNT(*) AS c FROM login_attempts
         WHERE rate_key = $1 AND attempted_at >= $2`,
        [key, cutoff],
      );
      return Number(rows[0]?.c ?? 0);
    };
    const userCount = await countFor(keys.user);
    const userIpCount = await countFor(keys.userIp);
    const ipCount = await countFor(keys.ip);
    return (
      userCount < LOGIN_MAX_ATTEMPTS_USER &&
      userIpCount < LOGIN_MAX_ATTEMPTS_USER_IP &&
      ipCount < LOGIN_MAX_ATTEMPTS_IP
    );
  } finally {
    if (locked) {
      await sql("SELECT pg_advisory_unlock($1)", [7272751]).catch(() => undefined);
    }
  }
}

export async function recordLoginAttempt(keys: {
  user: string;
  userIp: string;
  ip: string;
}) {
  const now = new Date().toISOString();
  for (const key of [keys.user, keys.userIp, keys.ip]) {
    await sql("INSERT INTO login_attempts (rate_key, attempted_at) VALUES ($1, $2)", [
      key,
      now,
    ]);
  }
}

export async function login(
  username: string,
  password: string
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const users = await sql<UserRow>(
    "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
    [username.trim()],
  );
  const user = users[0];
  if (!user || user.disabled || user.deleted_at) {
    return { ok: false, error: "Invalid username or password" };
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return { ok: false, error: "Invalid username or password" };
  }
  const token = randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  await sql("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    user.id,
    expires.toISOString(),
  ]);
  const jar = await cookies();
  jar.set(COOKIE, token, sessionCookieOptions(expires));
  return { ok: true, user: toPublicUser(user) };
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters` };
  }
  const users = await sql<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  const user = users[0];
  if (!user || user.disabled || user.deleted_at) {
    return { ok: false, error: "Unauthorized" };
  }
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return { ok: false, error: "Current password is incorrect" };
  }
  await sql(
    "UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2",
    [hashPassword(newPassword), userId],
  );
  // Drop other sessions; keep the caller's current cookie if present.
  const jar = await cookies();
  const current = jar.get(COOKIE)?.value;
  if (current) {
    await sql("DELETE FROM sessions WHERE user_id = $1 AND token <> $2", [
      userId,
      current,
    ]);
  } else {
    await sql("DELETE FROM sessions WHERE user_id = $1", [userId]);
  }
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await sql("DELETE FROM sessions WHERE token = $1", [token]);
  }
  jar.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    secure: cookieSecure(),
  });
}

export async function getSessionUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  // During `next build`, DATABASE_URL may be set before migrations — avoid querying.
  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  const rows = await sql<UserRow>(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2
       AND u.disabled = 0 AND u.deleted_at IS NULL`,
    [token, new Date().toISOString()],
  );
  const row = rows[0];
  if (!row) return null;
  return toPublicUser(row);
}

export async function requireUser(
  role?: "admin" | "agent",
  opts?: { allowMustChange?: boolean },
): Promise<PublicUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Unauthorized", 401);
  if (role === "admin" && user.role !== "admin") throw new AuthError("Forbidden", 403);
  if (user.mustChangePassword && !opts?.allowMustChange) {
    throw new AuthError("Password change required", 403);
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export { MIN_PASSWORD_LEN };
