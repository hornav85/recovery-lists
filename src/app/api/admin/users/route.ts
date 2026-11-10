import { NextResponse } from "next/server";
import { AuthError, hashPassword, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql, toPublicUser, type UserRow } from "@/lib/db";

export async function GET() {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const users = await sql<UserRow>(
      `SELECT * FROM users
       ORDER BY
         CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END,
         username`,
    );
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
        { status: 400 },
      );
    }

    try {
      if (password.length < 10) {
        return NextResponse.json(
          { error: "Password must be at least 10 characters" },
          { status: 400 },
        );
      }
      const rows = await sql<UserRow>(
        `INSERT INTO users (username, email, password_hash, display_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, 1)
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
    const admin = await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const existing = (await sql<UserRow>("SELECT * FROM users WHERE id = $1", [id]))[0];
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Soft-restore deleted accounts (must run before the deleted lock below)
    if (body.restore === true) {
      await sql("UPDATE users SET deleted_at = NULL, disabled = 0 WHERE id = $1", [id]);
      const user = (await sql<UserRow>("SELECT * FROM users WHERE id = $1", [id]))[0];
      return NextResponse.json({ user: toPublicUser(user), restored: true });
    }

    if (existing.deleted_at) {
      return NextResponse.json(
        { error: "Deleted users cannot be edited. Restore them first." },
        { status: 400 },
      );
    }

    if (typeof body.disabled === "boolean") {
      if (id === admin.id && body.disabled) {
        return NextResponse.json({ error: "You cannot disable your own account" }, { status: 400 });
      }
      await sql("UPDATE users SET disabled = $1 WHERE id = $2", [
        body.disabled ? 1 : 0,
        id,
      ]);
      if (body.disabled) {
        await sql("DELETE FROM sessions WHERE user_id = $1", [id]);
      }
    }

    if (body.email != null && String(body.email).trim()) {
      await sql("UPDATE users SET email = $1 WHERE id = $2", [
        String(body.email).trim(),
        id,
      ]);
    }
    if (body.displayName != null && String(body.displayName).trim()) {
      await sql("UPDATE users SET display_name = $1 WHERE id = $2", [
        String(body.displayName).trim(),
        id,
      ]);
    }
    if (body.password != null && String(body.password).length > 0) {
      await sql("UPDATE users SET password_hash = $1 WHERE id = $2", [
        hashPassword(String(body.password)),
        id,
      ]);
    }
    if (body.role === "admin" || body.role === "agent") {
      if (id === admin.id && body.role !== "admin") {
        return NextResponse.json(
          { error: "You cannot remove your own admin role" },
          { status: 400 },
        );
      }
      if (existing.role === "admin" && body.role === "agent") {
        const admins = await sql<{ c: string | number }>(
          `SELECT COUNT(*) AS c FROM users
           WHERE role = 'admin' AND deleted_at IS NULL AND id <> $1`,
          [id],
        );
        if (Number(admins[0]?.c || 0) < 1) {
          return NextResponse.json(
            { error: "Cannot demote the last active admin" },
            { status: 400 },
          );
        }
      }
      await sql("UPDATE users SET role = $1 WHERE id = $2", [body.role, id]);
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

/** Soft-delete: revoke access, clear list assignments, keep dial history for reports. */
export async function DELETE(req: Request) {
  try {
    await ensureFixtureLeads();
    const admin = await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id ?? new URL(req.url).searchParams.get("id"));
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = (await sql<UserRow>("SELECT * FROM users WHERE id = $1", [id]))[0];
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.deleted_at) {
      return NextResponse.json({ error: "User already deleted" }, { status: 400 });
    }
    if (id === admin.id) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }
    if (existing.role === "admin") {
      const admins = await sql<{ c: string | number }>(
        `SELECT COUNT(*) AS c FROM users
         WHERE role = 'admin' AND deleted_at IS NULL AND id <> $1`,
        [id],
      );
      if (Number(admins[0]?.c || 0) < 1) {
        return NextResponse.json(
          { error: "Cannot delete the last active admin" },
          { status: 400 },
        );
      }
    }

    const now = new Date().toISOString();
    await sql("UPDATE users SET deleted_at = $1, disabled = 1 WHERE id = $2", [now, id]);
    await sql("DELETE FROM sessions WHERE user_id = $1", [id]);
    await sql("DELETE FROM agent_assignments WHERE user_id = $1", [id]);
    await sql("DELETE FROM agent_attempt_assignments WHERE user_id = $1", [id]);
    // Snapshot empty assignments so reports show "no lists" after delete day
    const { saveAssignmentSnapshot } = await import("@/lib/assignments");
    await saveAssignmentSnapshot(id, admin.id, [], []);

    const user = (await sql<UserRow>("SELECT * FROM users WHERE id = $1", [id]))[0];
    return NextResponse.json({
      ok: true,
      user: toPublicUser(user),
      message:
        "User soft-deleted: no login or lists. Dial history kept for reports.",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
