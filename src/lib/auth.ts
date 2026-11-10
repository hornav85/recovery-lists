import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { sql, toPublicUser, type PublicUser, type UserRow } from "./db";

const COOKIE = "rl_session";
const SESSION_DAYS = 14;

export async function login(
  username: string,
  password: string
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const users = await sql<UserRow>(
    "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
    [username.trim()],
  );
  const user = users[0];
  if (!user || user.disabled) {
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
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return { ok: true, user: toPublicUser(user) };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await sql("DELETE FROM sessions WHERE token = $1", [token]);
  }
  jar.delete(COOKIE);
}

export async function getSessionUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await sql<UserRow>(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2 AND u.disabled = 0`,
    [token, new Date().toISOString()],
  );
  const row = rows[0];
  if (!row) return null;
  return toPublicUser(row);
}

export async function requireUser(role?: "admin" | "agent"): Promise<PublicUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Unauthorized", 401);
  if (role === "admin" && user.role !== "admin") throw new AuthError("Forbidden", 403);
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
