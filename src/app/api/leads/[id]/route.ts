import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { getLeadDetail } from "@/lib/leads";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureFixtureLeads();
    await requireUser();
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
