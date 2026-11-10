import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";
import { agentCanAccessLead } from "@/lib/leads";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const leadId = Number(body.leadId);
    const outcome = String(body.outcome || "");
    const notes = body.notes != null ? String(body.notes) : "";

    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 });
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

    const attempts = await sql(
      `INSERT INTO call_attempts
        (lead_id, prospect_key, outcome, notes, agent_user_id, agent_display_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        lead.id,
        lead.prospect_key,
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
