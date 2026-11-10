import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";
import { normalizeStatus } from "@/lib/statuses";

export async function GET() {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const statuses = await sql(
      `SELECT id, name, active, created_at FROM list_statuses ORDER BY name`,
    );
    return NextResponse.json({ statuses });
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
    const name = normalizeStatus(String(body.name || ""));
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const existing = (
      await sql<{ id: number; active: number }>(
        `SELECT * FROM list_statuses WHERE LOWER(name) = LOWER($1)`,
        [name],
      )
    )[0];
    if (existing) {
      await sql("UPDATE list_statuses SET active = 1 WHERE id = $1", [existing.id]);
      const row = (
        await sql("SELECT * FROM list_statuses WHERE id = $1", [existing.id])
      )[0];
      return NextResponse.json({ status: row, reactivated: true });
    }
    const rows = await sql(
      "INSERT INTO list_statuses (name, active) VALUES ($1, 1) RETURNING *",
      [name],
    );
    return NextResponse.json({ status: rows[0] }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    // Soft-remove: hide list rather than delete history
    await sql("UPDATE list_statuses SET active = 0 WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
