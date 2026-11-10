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

export async function GET(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const attempts = parseAttemptBucket(url.searchParams.get("attempts"));
    const view = url.searchParams.get("view");

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
      const queue = await getQueueForAttemptBucket(attempts, allowed);
      return NextResponse.json({ view: "attempts", attempts, queue });
    }

    const allowed = assigned.some((s) => s.name.toLowerCase() === (status || "").toLowerCase());
    if (!allowed && user.role !== "admin") {
      return NextResponse.json({ error: "Not assigned to this list" }, { status: 403 });
    }

    const full = await getQueueForStatus(status || "");
    const queue = attempts
      ? await getQueueForStatus(status || "", attempts)
      : full;
    return NextResponse.json({
      status,
      attempts: attempts || null,
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
