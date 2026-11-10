import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { buildReports } from "@/lib/reports";
import { resolveDateRange } from "@/lib/time";

/** Same payload as reports, tuned for the live dashboard refresh button. */
export async function GET(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const url = new URL(req.url);
    const range = resolveDateRange({
      preset: url.searchParams.get("preset") || "today",
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      day: url.searchParams.get("day"),
    });
    const report = await buildReports(range, null);
    return NextResponse.json({
      refreshedAt: new Date().toISOString(),
      report,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
