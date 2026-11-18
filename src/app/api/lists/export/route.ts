import { parseAttemptBucket, bucketLabel } from "@/lib/attempts";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import {
  getAssignedAttemptBuckets,
  getAssignedStatuses,
  getQueueForAttemptBucket,
  getQueueForStatus,
} from "@/lib/leads";
import { queueToCsv } from "@/lib/list-export";
import { applyQueueView, filterQueueBySearch, parseQueueSort } from "@/lib/queue-filters";

export async function GET(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const attempts = parseAttemptBucket(url.searchParams.get("attempts"));
    const view = url.searchParams.get("view");
    const sort = parseQueueSort(url.searchParams.get("sort"));
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const fromYmd = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
    const toYmd = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
    const searchQuery = user.role === "admin" ? (url.searchParams.get("q") || "").trim() : "";

    const assigned = await getAssignedStatuses(user.id, user.role);
    const attemptBuckets = await getAssignedAttemptBuckets(user.id, user.role);

    let raw;
    let title = "";
    let exportView = "status";

    if (view === "attempts") {
      if (!attempts) {
        return Response.json({ error: "attempts bucket required" }, { status: 400 });
      }
      if (user.role !== "admin" && !attemptBuckets.includes(attempts)) {
        return Response.json({ error: "Not assigned to this attempt list" }, { status: 403 });
      }
      const allowed = user.role === "admin" ? null : assigned.map((s) => s.name);
      raw = await getQueueForAttemptBucket(attempts, allowed);
      title = `${bucketLabel(attempts)} (all assigned statuses)`;
      exportView = "attempts";
    } else {
      if (!status) {
        return Response.json({ error: "status required" }, { status: 400 });
      }
      const allowed = assigned.some((s) => s.name.toLowerCase() === status.toLowerCase());
      if (!allowed && user.role !== "admin") {
        return Response.json({ error: "Not assigned to this list" }, { status: 403 });
      }
      raw = attempts
        ? await getQueueForStatus(status, attempts)
        : await getQueueForStatus(status);
      title = attempts ? `${status} · ${bucketLabel(attempts)}` : `${status} · All attempts`;
      exportView = "status";
    }

    const viewed = applyQueueView(raw, { sort, fromYmd, toYmd });
    const queue = searchQuery ? filterQueueBySearch(viewed, searchQuery) : viewed;
    const csv = queueToCsv(queue, {
      title,
      view: exportView,
      status: status || undefined,
      attempts: attempts || undefined,
      sort,
      from: fromYmd,
      to: toYmd,
      search: searchQuery || undefined,
    });

    const safe = title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "list";
    const filename = `recovery-list-${safe}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
