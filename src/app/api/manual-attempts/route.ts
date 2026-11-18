import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";
import { agentCanAccessManualRow } from "@/lib/manual-lists";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";
import { pacificDayEndUtc, pacificDayStartUtc, pacificYmd } from "@/lib/time";

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const rowId = Number(body.rowId);
    const outcome = String(body.outcome || "").trim();
    const notes = body.notes != null ? String(body.notes) : "";

    if (!Number.isFinite(rowId)) {
      return NextResponse.json({ error: "rowId required" }, { status: 400 });
    }
    if (!outcome) {
      return NextResponse.json({ error: "Choose an outcome before saving" }, { status: 400 });
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

    const today = pacificYmd();
    const dayStart = pacificDayStartUtc(today).toISOString();
    const dayEnd = pacificDayEndUtc(today).toISOString();
    const now = new Date().toISOString();
    const sameDay = await sql<{ id: number }>(
      `SELECT id FROM manual_attempts
       WHERE list_id = $1
         AND prospect_key = $2
         AND created_at::timestamptz >= $3::timestamptz
         AND created_at::timestamptz < $4::timestamptz
       ORDER BY id DESC`,
      [row.list_id, row.prospect_key, dayStart, dayEnd],
    );
    if (sameDay.length > 0) {
      const keepId = sameDay[0].id;
      await sql(
        `DELETE FROM manual_attempts
         WHERE list_id = $1
           AND prospect_key = $2
           AND id <> $3
           AND created_at::timestamptz >= $4::timestamptz
           AND created_at::timestamptz < $5::timestamptz`,
        [row.list_id, row.prospect_key, keepId, dayStart, dayEnd],
      );
      const updated = await sql(
        `UPDATE manual_attempts
         SET outcome = $1, notes = $2, row_id = $3, list_name = $4,
             agent_user_id = $5, agent_display_name = $6, created_at = $7
         WHERE id = $8
         RETURNING *`,
        [outcome, notes, row.id, row.list_name, user.id, user.displayName, now, keepId],
      );
      return NextResponse.json({ attempt: updated[0], replaced: true });
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
        now,
      ],
    );
    return NextResponse.json({ attempt: attempts[0], replaced: false });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
