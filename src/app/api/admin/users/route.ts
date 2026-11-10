import { NextResponse } from "next/server";
import { AuthError, hashPassword, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql, toPublicUser, type UserRow } from "@/lib/db";

export async function GET() {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const users = await sql<UserRow>("SELECT * FROM users ORDER BY username");
    return NextResponse.json({ users: users.map(toPublicUser) });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.displayName || username).trim();
    const role = body.role === "admin" ? "admin" : "agent";

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: "username, email, and password required" },
        { status: 400 }
      );
    }

    try {
      const rows = await sql<UserRow>(
        `INSERT INTO users (username, email, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [username, email, hashPassword(password), displayName, role],
      );
      return NextResponse.json({ user: toPublicUser(rows[0]) }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function PATCH(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const existing = (await sql<UserRow>("SELECT * FROM users WHERE id = $1", [id]))[0];
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (typeof body.disabled === "boolean") {
      await sql("UPDATE users SET disabled = $1 WHERE id = $2", [
        body.disabled ? 1 : 0,
        id,
      ]);
    }
    if (body.email) {
      await sql("UPDATE users SET email = $1 WHERE id = $2", [
        String(body.email).trim(),
        id,
      ]);
    }
    if (body.displayName) {
      await sql("UPDATE users SET display_name = $1 WHERE id = $2", [
        String(body.displayName).trim(),
        id,
      ]);
    }
    if (body.password) {
      await sql("UPDATE users SET password_hash = $1 WHERE id = $2", [
        hashPassword(String(body.password)),
        id,
      ]);
    }

    const user = (await sql<UserRow>("SELECT * FROM users WHERE id = $1", [id]))[0];
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
