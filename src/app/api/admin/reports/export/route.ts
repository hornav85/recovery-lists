import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { buildReports, reportsToCsv } from "@/lib/reports";
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

    const report = await buildReports(range, agentId && Number.isFinite(agentId) ? agentId : null);
    const csv = reportsToCsv(report);
    const filename = `recovery-report-${range.fromYmd}-to-${range.toYmd}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw e;
  }
}
