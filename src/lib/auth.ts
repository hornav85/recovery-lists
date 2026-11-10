import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { countUsers, sql, toPublicUser, type PublicUser, type UserRow } from "./db";

const COOKIE = "rl_session";
const SESSION_DAYS = 14;

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

/** In-memory login throttle (per process). Key = username|ip. */
const loginAttempts = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

export function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginAttempts.set(key, recent);
  return recent.length < LOGIN_MAX_ATTEMPTS;
}

export function recordLoginAttempt(key: string) {
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  recent.push(now);
  loginAttempts.set(key, recent);
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

/** First-run only: create the initial admin with a password the operator chooses. */
export async function bootstrapAdmin(input: {
  username: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string; status: number }> {
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
  if (password.length < 10) {
    return { ok: false, error: "Password must be at least 10 characters", status: 400 };
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
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 10) {
    return { ok: false, error: "Password must be at least 10 characters" };
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
