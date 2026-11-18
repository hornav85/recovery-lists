import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";
import { agentCanAccessManualRow } from "@/lib/manual-lists";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const rowId = Number(body.rowId);
    const outcome = String(body.outcome || "");
    const notes = body.notes != null ? String(body.notes) : "";

    if (!Number.isFinite(rowId)) {
      return NextResponse.json({ error: "rowId required" }, { status: 400 });
    }
    if (!ATTEMPT_OUTCOMES.includes(outcome as (typeof ATTEMPT_OUTCOMES)[number])) {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
    }

    const row = (
      await sql<{ id: number; list_id: number; prospect_key: string; list_name: string }>(
        `SELECT r.id, r.list_id, r.prospect_key, l.name AS list_name
         FROM manual_list_rows r
         JOIN manual_lists l ON l.id = r.list_id
         WHERE r.id = $1`,
        [rowId],
      )
    )[0];
    if (!row) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    if (!(await agentCanAccessManualRow(user, row.id))) {
      return NextResponse.json({ error: "Not assigned to this list" }, { status: 403 });
    }

    const attempts = await sql(
      `INSERT INTO manual_attempts
        (row_id, list_id, list_name, prospect_key, outcome, notes, agent_user_id, agent_display_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        row.id,
        row.list_id,
        row.list_name,
        row.prospect_key,
        outcome,
        notes,
        user.id,
        user.displayName,
        new Date().toISOString(),
      ],
    );
    return NextResponse.json({ attempt: attempts[0] });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
