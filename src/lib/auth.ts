import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { countUsers, sql, toPublicUser, type PublicUser, type UserRow } from "./db";

const COOKIE = "rl_session";
const SESSION_DAYS = 14;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;
const MIN_PASSWORD_LEN = 10;

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production";
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

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Shared across instances via Postgres (falls back soft-fail open only if DB errors). */
export async function checkLoginRateLimit(key: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  await sql("DELETE FROM login_attempts WHERE attempted_at < $1", [cutoff]);
  const rows = await sql<{ c: string | number }>(
    `SELECT COUNT(*) AS c FROM login_attempts
     WHERE rate_key = $1 AND attempted_at >= $2`,
    [key, cutoff],
  );
  return Number(rows[0]?.c ?? 0) < LOGIN_MAX_ATTEMPTS;
}

export async function recordLoginAttempt(key: string) {
  await sql("INSERT INTO login_attempts (rate_key, attempted_at) VALUES ($1, $2)", [
    key,
    new Date().toISOString(),
  ]);
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

function requiredSetupBootstrapSecret(): string | null {
  const secret = process.env.SETUP_BOOTSTRAP_SECRET?.trim() || "";
  return secret || null;
}

/** First-run only: create the initial admin. Requires SETUP_BOOTSTRAP_SECRET. */
export async function bootstrapAdmin(input: {
  username: string;
  email: string;
  password: string;
  displayName: string;
  bootstrapSecret: string;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string; status: number }> {
  const expected = requiredSetupBootstrapSecret();
  if (!expected) {
    return {
      ok: false,
      error: "Setup locked — set SETUP_BOOTSTRAP_SECRET in app secrets first",
      status: 503,
    };
  }
  if (!safeEqualString(input.bootstrapSecret.trim(), expected)) {
    return { ok: false, error: "Invalid setup secret", status: 401 };
  }

  // Serialize first-admin creation across hosted instances (no-op on local PGlite)
  let locked = false;
  try {
    await sql("SELECT pg_advisory_lock($1)", [7272750]);
    locked = true;
  } catch {
    locked = false;
  }
  try {
    if ((await countUsers()) > 0) {
      return { ok: false, error: "Setup already completed", status: 409 };
    }
    const username = input.username.trim();
    const email = input.email.trim();
    const password = input.password;
    const displayName = input.displayName.trim() || username;
    if (!username || !email || !password) {
      return { ok: false, error: "username, email, and password required", status: 400 };
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return {
        ok: false,
        error: `Password must be at least ${MIN_PASSWORD_LEN} characters`,
        status: 400,
      };
    }
    const rows = await sql<UserRow>(
      `INSERT INTO users (username, email, password_hash, display_name, role, must_change_password)
       VALUES ($1, $2, $3, $4, 'admin', 0)
       RETURNING *`,
      [username, email, hashPassword(password), displayName],
    );
    const user = rows[0];
    if (!user) return { ok: false, error: "Could not create admin", status: 500 };

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
  } finally {
    if (locked) {
      await sql("SELECT pg_advisory_unlock($1)", [7272750]).catch(() => undefined);
    }
  }
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
