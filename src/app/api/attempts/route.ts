import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";
import { agentCanAccessLead } from "@/lib/leads";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";
import { pacificDayEndUtc, pacificDayStartUtc, pacificYmd } from "@/lib/time";

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const leadId = Number(body.leadId);
    const outcome = String(body.outcome || "").trim();
    const notes = body.notes != null ? String(body.notes) : "";

    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 });
    }
    if (!outcome) {
      return NextResponse.json({ error: "Choose an outcome before saving" }, { status: 400 });
    }
    if (!ATTEMPT_OUTCOMES.includes(outcome as (typeof ATTEMPT_OUTCOMES)[number])) {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
    }

    const lead = (
      await sql<{ id: number; prospect_key: string }>(
        "SELECT id, prospect_key FROM leads WHERE id = $1",
        [leadId],
      )
    )[0];
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    if (!(await agentCanAccessLead(user, lead.id))) {
      return NextResponse.json({ error: "Not assigned to this lead" }, { status: 403 });
    }

    const today = pacificYmd();
    const dayStart = pacificDayStartUtc(today).toISOString();
    const dayEnd = pacificDayEndUtc(today).toISOString();
    const now = new Date().toISOString();

    // One outcome per Pacific day per prospect — later saves replace today's row.
    const sameDay = await sql<{ id: number }>(
      `SELECT id FROM call_attempts
       WHERE prospect_key = $1
         AND created_at::timestamptz >= $2::timestamptz
         AND created_at::timestamptz < $3::timestamptz
       ORDER BY id DESC`,
      [lead.prospect_key, dayStart, dayEnd],
    );

    if (sameDay.length > 0) {
      const keepId = sameDay[0].id;
      await sql(
        `DELETE FROM call_attempts
         WHERE prospect_key = $1
           AND id <> $2
           AND created_at::timestamptz >= $3::timestamptz
           AND created_at::timestamptz < $4::timestamptz`,
        [lead.prospect_key, keepId, dayStart, dayEnd],
      );
      const updated = await sql(
        `UPDATE call_attempts
         SET outcome = $1,
             notes = $2,
             lead_id = $3,
             agent_user_id = $4,
             agent_display_name = $5,
             created_at = $6
         WHERE id = $7
         RETURNING *`,
        [outcome, notes, lead.id, user.id, user.displayName, now, keepId],
      );
      return NextResponse.json({ attempt: updated[0], replaced: true });
    }

    const attempts = await sql(
      `INSERT INTO call_attempts
        (lead_id, prospect_key, outcome, notes, agent_user_id, agent_display_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [lead.id, lead.prospect_key, outcome, notes, user.id, user.displayName, now],
    );

    return NextResponse.json({ attempt: attempts[0], replaced: false });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
