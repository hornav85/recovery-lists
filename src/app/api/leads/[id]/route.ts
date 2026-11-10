import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { agentCanAccessLead, getLeadDetail } from "@/lib/leads";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (!(await agentCanAccessLead(user, leadId))) {
      return NextResponse.json({ error: "Not assigned to this lead" }, { status: 403 });
    }
    const detail = await getLeadDetail(leadId);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (detail.hidden) {
      return NextResponse.json(
        { error: "Lead hidden (Recovered, DNC, or sheet DNC)", detail },
        { status: 410 }
      );
    }
    return NextResponse.json(detail);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
