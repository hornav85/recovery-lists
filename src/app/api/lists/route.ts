import { NextResponse } from "next/server";
import { parseAttemptBucket } from "@/lib/attempts";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import {
  countByAttemptBucket,
  getAssignedAttemptBuckets,
  getAssignedStatuses,
  getQueueForAttemptBucket,
  getQueueForStatus,
} from "@/lib/leads";
import { applyQueueView, parseQueueSort } from "@/lib/queue-filters";

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

    const assigned = await getAssignedStatuses(user.id, user.role);
    const attemptBuckets = await getAssignedAttemptBuckets(user.id, user.role);

    if (!status && view !== "attempts") {
      return NextResponse.json({ statuses: assigned, attemptBuckets });
    }

    if (view === "attempts") {
      if (!attempts) {
        return NextResponse.json({ error: "attempts bucket required" }, { status: 400 });
      }
      if (user.role !== "admin" && !attemptBuckets.includes(attempts)) {
        return NextResponse.json({ error: "Not assigned to this attempt list" }, { status: 403 });
      }
      const allowed = user.role === "admin" ? null : assigned.map((s) => s.name);
      const raw = await getQueueForAttemptBucket(attempts, allowed);
      const queue = applyQueueView(raw, { sort, fromYmd, toYmd });
      return NextResponse.json({ view: "attempts", attempts, sort, from: fromYmd, to: toYmd, queue });
    }

    const allowed = assigned.some((s) => s.name.toLowerCase() === (status || "").toLowerCase());
    if (!allowed && user.role !== "admin") {
      return NextResponse.json({ error: "Not assigned to this list" }, { status: 403 });
    }

    const full = await getQueueForStatus(status || "");
    const raw = attempts ? await getQueueForStatus(status || "", attempts) : full;
    const queue = applyQueueView(raw, { sort, fromYmd, toYmd });
    return NextResponse.json({
      status,
      attempts: attempts || null,
      sort,
      from: fromYmd,
      to: toYmd,
      bucketCounts: countByAttemptBucket(full),
      queue,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
