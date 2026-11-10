import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";
import { buildReports } from "@/lib/reports";
import { resolveDateRange } from "@/lib/time";

export async function GET(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const url = new URL(req.url);
    const range = resolveDateRange({
      preset: url.searchParams.get("preset"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      day: url.searchParams.get("day"),
    });
    const agentRaw = url.searchParams.get("agentId");
    const agentId = agentRaw ? Number(agentRaw) : null;

    // Include soft-deleted agents so historical reports can still filter by them
    const agents = await sql<{
      id: number;
      username: string;
      display_name: string;
      deleted_at: string | null;
    }>(
      `SELECT id, username, display_name, deleted_at FROM users
       WHERE role = 'agent'
       ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, display_name`,
    );

    const report = await buildReports(range, agentId && Number.isFinite(agentId) ? agentId : null);
    return NextResponse.json({ agents, report });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
