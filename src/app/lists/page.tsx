import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ATTEMPT_BUCKETS, parseAttemptBucket, bucketLabel } from "@/lib/attempts";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import {
  countByAttemptBucket,
  getAssignedAttemptBuckets,
  getAssignedStatuses,
  getQueueForAttemptBucket,
  getQueueForStatus,
  type QueueLead,
} from "@/lib/leads";

function buildHref(opts: {
  status?: string;
  attempts?: string;
  view?: string;
}) {
  const p = new URLSearchParams();
  if (opts.view === "attempts") p.set("view", "attempts");
  if (opts.status) p.set("status", opts.status);
  if (opts.attempts) p.set("attempts", opts.attempts);
  const q = p.toString();
  return q ? `/lists?${q}` : "/lists";
}

function QueueTable({ queue }: { queue: QueueLead[] }) {
  if (queue.length === 0) {
    return <p className="muted">No visible leads in this list.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Phone</th>
          <th>Status</th>
          <th>Appt</th>
          <th>Attempts</th>
          <th>Last attempt</th>
        </tr>
      </thead>
      <tbody>
        {queue.map((lead) => (
          <tr key={lead.id}>
            <td>
              <Link href={`/leads/${lead.id}`}>{lead.name || "—"}</Link>
            </td>
            <td>{lead.phone || "—"}</td>
            <td>
              <span className="badge">{lead.status || "—"}</span>
            </td>
            <td>{lead.appointment_date || lead.date_col || "—"}</td>
            <td>
              {lead.attempt_count >= 6 ? (
                <span className="badge warn">{lead.attempt_count} · burned</span>
              ) : (
                <span className="badge">{lead.attempt_count}</span>
              )}
            </td>
            <td>
              {lead.latest_attempt ? (
                <span className="badge">{lead.latest_attempt.outcome}</span>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; attempts?: string; view?: string }>;
}) {
  await ensureFixtureLeads();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const statuses = await getAssignedStatuses(user.id, user.role);
  const attemptBuckets = await getAssignedAttemptBuckets(user.id, user.role);
  const sp = await searchParams;
  const view = sp.view === "attempts" ? "attempts" : "status";
  const attemptFilter = parseAttemptBucket(sp.attempts);

  const activeStatus =
    view === "status" ? sp.status || statuses[0]?.name || "" : "";
  const activeAttemptBucket =
    view === "attempts"
      ? attemptFilter || attemptBuckets[0] || null
      : attemptFilter;

  let queue: QueueLead[] = [];
  let bucketCounts: Record<string, number> = {};
  let title = "";

  if (view === "attempts" && activeAttemptBucket) {
    const allowed =
      user.role === "admin" ? null : statuses.map((s) => s.name);
    queue = await getQueueForAttemptBucket(activeAttemptBucket, allowed);
    title = `${bucketLabel(activeAttemptBucket)} (all assigned statuses)`;
  } else if (activeStatus) {
    const full = await getQueueForStatus(activeStatus);
    bucketCounts = countByAttemptBucket(full);
    queue = activeAttemptBucket
      ? await getQueueForStatus(activeStatus, activeAttemptBucket)
      : full;
    title = activeAttemptBucket
      ? `${activeStatus} · ${bucketLabel(activeAttemptBucket)}`
      : activeStatus;
  }

  return (
    <AppShell user={user}>
      <h1>Recovery lists</h1>
      <p className="muted">
        Status lists and attempt filters. Queues sort fewest attempts first. Recovered/DNC and sheet
        DNC stay hidden. <strong>Burned out</strong> = 6+ attempts.
      </p>

      <div className="tabs" style={{ marginBottom: "0.5rem" }}>
        <Link
          href={buildHref({ status: statuses[0]?.name })}
          className={`tab ${view === "status" ? "active" : ""}`}
        >
          By status
        </Link>
        <Link
          href={buildHref({ view: "attempts", attempts: attemptBuckets[0] || "0" })}
          className={`tab ${view === "attempts" ? "active" : ""}`}
        >
          By attempts
        </Link>
      </div>

      {view === "status" && statuses.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No status lists assigned. Ask an admin to assign status lists, or open{" "}
            <strong>By attempts</strong> if attempt buckets were assigned.
          </p>
        </div>
      ) : null}

      {view === "status" && statuses.length > 0 && (
        <>
          <div className="tabs">
            {statuses.map((s) => (
              <Link
                key={s.id}
                href={buildHref({
                  status: s.name,
                  attempts: activeAttemptBucket || undefined,
                })}
                className={`tab ${s.name === activeStatus ? "active" : ""}`}
              >
                {s.name}
              </Link>
            ))}
          </div>

          <div className="tabs">
            <Link
              href={buildHref({ status: activeStatus })}
              className={`tab ${!activeAttemptBucket ? "active" : ""}`}
            >
              All attempts
              {activeStatus ? ` (${Object.values(bucketCounts).reduce((a, b) => a + b, 0) || queue.length})` : ""}
            </Link>
            {ATTEMPT_BUCKETS.map((b) => {
              const count = bucketCounts[b.id] ?? 0;
              return (
                <Link
                  key={b.id}
                  href={buildHref({ status: activeStatus, attempts: b.id })}
                  className={`tab ${activeAttemptBucket === b.id ? "active" : ""} ${
                    b.id === "burned" ? "warn-tab" : ""
                  }`}
                >
                  {b.label}
                  {activeStatus ? ` (${count})` : ""}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {view === "attempts" && (
        <>
          {attemptBuckets.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No attempt lists assigned. Ask an admin to assign attempt buckets (e.g. 1 attempt,
                Burned out).
              </p>
            </div>
          ) : (
            <div className="tabs">
              {attemptBuckets.map((id) => (
                <Link
                  key={id}
                  href={buildHref({ view: "attempts", attempts: id })}
                  className={`tab ${activeAttemptBucket === id ? "active" : ""} ${
                    id === "burned" ? "warn-tab" : ""
                  }`}
                >
                  {bucketLabel(id)}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {(view === "status" ? Boolean(activeStatus) : Boolean(activeAttemptBucket)) && (
        <div className="card">
          <h2>
            {title}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              ({queue.length})
            </span>
          </h2>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Sorted by fewest attempts first so agents can dial fresher leads before burned ones.
          </p>
          <QueueTable queue={queue} />
        </div>
      )}
    </AppShell>
  );
}
