import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLeadSearch } from "@/components/AdminLeadSearch";
import { AppShell } from "@/components/AppShell";
import { ListDateControls } from "@/components/ListDateControls";
import { PhoneLink } from "@/components/PhoneLink";
import { ATTEMPT_BUCKETS, parseAttemptBucket, bucketLabel } from "@/lib/attempts";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import {
  countByAttemptBucket,
  getAllVisibleLeads,
  getAssignedAttemptBuckets,
  getAssignedStatuses,
  getQueueForAttemptBucket,
  getQueueForStatus,
  type QueueLead,
} from "@/lib/leads";
import { applyQueueView, filterQueueBySearch, parseQueueSort, sortLabel } from "@/lib/queue-filters";
import { normalizeStatus } from "@/lib/statuses";

function buildHref(opts: {
  status?: string;
  attempts?: string;
  view?: string;
  sort?: string;
  from?: string;
  to?: string;
  q?: string;
  find?: string;
}) {
  const p = new URLSearchParams();
  if (opts.view === "attempts") p.set("view", "attempts");
  if (opts.status) p.set("status", opts.status);
  if (opts.attempts) p.set("attempts", opts.attempts);
  if (opts.sort && opts.sort !== "attempts") p.set("sort", opts.sort);
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  if (opts.q) p.set("q", opts.q);
  if (opts.find) p.set("find", opts.find);
  const q = p.toString();
  return q ? `/lists?${q}` : "/lists";
}

function QueueTable({
  queue,
  showList = false,
  empty = "No visible leads in this list.",
}: {
  queue: QueueLead[];
  showList?: boolean;
  empty?: string;
}) {
  if (queue.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          {showList ? <th>List</th> : null}
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
            {showList ? (
              <td>
                <span className="badge">{normalizeStatus(lead.status) || "—"}</span>
              </td>
            ) : null}
            <td>
              <Link href={`/leads/${lead.id}`}>{lead.name || "—"}</Link>
            </td>
            <td>
              <PhoneLink phone={lead.phone} />
            </td>
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
  searchParams: Promise<{
    status?: string;
    attempts?: string;
    view?: string;
    sort?: string;
    from?: string;
    to?: string;
    q?: string;
    find?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureFixtureLeads();

  const statuses = await getAssignedStatuses(user.id, user.role);
  const attemptBuckets = await getAssignedAttemptBuckets(user.id, user.role);
  const sp = await searchParams;
  const view = sp.view === "attempts" ? "attempts" : "status";
  const attemptFilter = parseAttemptBucket(sp.attempts);
  const sort = parseQueueSort(sp.sort);
  const fromYmd = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : "";
  const toYmd = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : "";
  const searchQuery = user.role === "admin" ? (sp.q || "").trim() : "";
  const findQuery = user.role === "admin" ? (sp.find || "").trim() : "";
  const allMatches = findQuery
    ? filterQueueBySearch(await getAllVisibleLeads(), findQuery)
    : [];

  const activeStatus =
    view === "status" ? sp.status || statuses[0]?.name || "" : "";
  const activeAttemptBucket =
    view === "attempts"
      ? attemptFilter || attemptBuckets[0] || null
      : attemptFilter;

  let rawQueue: QueueLead[] = [];
  let bucketCounts: Record<string, number> = {};
  let title = "";

  if (view === "attempts" && activeAttemptBucket) {
    const allowed = user.role === "admin" ? null : statuses.map((s) => s.name);
    rawQueue = await getQueueForAttemptBucket(activeAttemptBucket, allowed);
    title = `${bucketLabel(activeAttemptBucket)} (all assigned statuses)`;
  } else if (activeStatus) {
    const full = await getQueueForStatus(activeStatus);
    bucketCounts = countByAttemptBucket(full);
    rawQueue = activeAttemptBucket
      ? await getQueueForStatus(activeStatus, activeAttemptBucket)
      : full;
    title = activeAttemptBucket
      ? `${activeStatus} · ${bucketLabel(activeAttemptBucket)}`
      : activeStatus;
  }

  const viewed = applyQueueView(rawQueue, { sort, fromYmd, toYmd });
  const queue = searchQuery ? filterQueueBySearch(viewed, searchQuery) : viewed;

  const persist = {
    view: view === "attempts" ? "attempts" : undefined,
    status: view === "status" ? activeStatus || undefined : undefined,
    attempts: activeAttemptBucket || undefined,
    sort: sort !== "attempts" ? sort : undefined,
    from: fromYmd || undefined,
    to: toYmd || undefined,
    q: searchQuery || undefined,
    find: findQuery || undefined,
  };

  return (
    <AppShell user={user}>
      <h1>Recovery lists</h1>
      {user.role === "admin" ? (
        <>
          <AdminLeadSearch
            query={findQuery}
            paramName="find"
            label="Search all lists"
            placeholder="Name, phone, or any lead field"
            baseParams={{
              view: view === "attempts" ? "attempts" : undefined,
              status: view === "status" ? activeStatus || undefined : undefined,
              attempts: activeAttemptBucket || undefined,
              sort: sort !== "attempts" ? sort : undefined,
              from: fromYmd || undefined,
              to: toYmd || undefined,
              q: searchQuery || undefined,
            }}
          />
          {findQuery ? (
            <div className="card">
              <h2>
                All lists{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  ({allMatches.length})
                </span>
              </h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Matches for “{findQuery}” in every list.
              </p>
              <QueueTable
                queue={allMatches}
                showList
                empty="No leads match in any list."
              />
            </div>
          ) : null}
        </>
      ) : null}
      <p className="muted">
        Status lists use each prospect&apos;s <strong>latest appointment</strong> only. An older
        Cancelled meeting drops off Cancelled once a later meeting is Sold (or any other status).{" "}
        <strong>All attempts</strong> keeps dialed leads visible through the end of the Pacific day
        (including Recovered/DNC); they drop off the next day. Sheet DNC hides immediately.{" "}
        <strong>0 attempts</strong> moves a lead after a real dial. Same-day outcome edits replace
        today&apos;s result (no double count). <strong>Burned out</strong> = 6+ dial days.
      </p>

      <div className="tabs" style={{ marginBottom: "0.5rem" }}>
        <Link
          href={buildHref({
            status: statuses[0]?.name,
            sort: persist.sort,
            from: persist.from,
            to: persist.to,
            q: persist.q,
            find: persist.find,
          })}
          className={`tab ${view === "status" ? "active" : ""}`}
        >
          By status
        </Link>
        <Link
          href={buildHref({
            view: "attempts",
            attempts: attemptBuckets[0] || "0",
            sort: persist.sort,
            from: persist.from,
            to: persist.to,
            q: persist.q,
            find: persist.find,
          })}
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
                  sort: persist.sort,
                  from: persist.from,
                  to: persist.to,
                  q: persist.q,
            find: persist.find,
                })}
                className={`tab ${s.name === activeStatus ? "active" : ""}`}
              >
                {s.name}
              </Link>
            ))}
          </div>

          <div className="tabs">
            <Link
              href={buildHref({
                status: activeStatus,
                sort: persist.sort,
                from: persist.from,
                to: persist.to,
                q: persist.q,
            find: persist.find,
              })}
              className={`tab ${!activeAttemptBucket ? "active" : ""}`}
            >
              All attempts
              {activeStatus
                ? ` (${Object.values(bucketCounts).reduce((a, b) => a + b, 0) || rawQueue.length})`
                : ""}
            </Link>
            {ATTEMPT_BUCKETS.map((b) => {
              const count = bucketCounts[b.id] ?? 0;
              return (
                <Link
                  key={b.id}
                  href={buildHref({
                    status: activeStatus,
                    attempts: b.id,
                    sort: persist.sort,
                    from: persist.from,
                    to: persist.to,
                    q: persist.q,
            find: persist.find,
                  })}
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
                  href={buildHref({
                    view: "attempts",
                    attempts: id,
                    sort: persist.sort,
                    from: persist.from,
                    to: persist.to,
                    q: persist.q,
            find: persist.find,
                  })}
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
              ({queue.length}
              {queue.length !== viewed.length
                ? ` of ${viewed.length}`
                : queue.length !== rawQueue.length
                  ? ` of ${rawQueue.length}`
                  : ""})
            </span>
          </h2>

          {user.role === "admin" ? (
            <AdminLeadSearch
              query={searchQuery}
              label="Search this list"
              placeholder="Filter the open list"
              baseParams={{
                view: view === "attempts" ? "attempts" : undefined,
                status: view === "status" ? activeStatus || undefined : undefined,
                attempts: activeAttemptBucket || undefined,
                sort: sort !== "attempts" ? sort : undefined,
                from: fromYmd || undefined,
                to: toYmd || undefined,
                find: findQuery || undefined,
              }}
            />
          ) : null}

          <ListDateControls
            baseParams={{
              view: view === "attempts" ? "attempts" : undefined,
              status: view === "status" ? activeStatus || undefined : undefined,
              attempts: activeAttemptBucket || undefined,
              q: searchQuery || undefined,
              find: findQuery || undefined,
            }}
            sort={sort}
            fromYmd={fromYmd}
            toYmd={toYmd}
          />

          <div
            className="row"
            style={{ marginTop: 0, marginBottom: "0.75rem", justifyContent: "space-between" }}
          >
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              {sortLabel(sort)}
              {fromYmd || toYmd
                ? ` · appointment filter ${fromYmd || "…"} → ${toYmd || "…"}`
                : ""}
              {searchQuery ? ` · this list “${searchQuery}”` : ""}.
            </p>
            <a
              className="btn secondary"
              href={`/api/lists/export?${new URLSearchParams({
                ...(view === "attempts" ? { view: "attempts" } : {}),
                ...(view === "status" && activeStatus ? { status: activeStatus } : {}),
                ...(activeAttemptBucket ? { attempts: activeAttemptBucket } : {}),
                ...(sort !== "attempts" ? { sort } : {}),
                ...(fromYmd ? { from: fromYmd } : {}),
                ...(toYmd ? { to: toYmd } : {}),
                ...(searchQuery ? { q: searchQuery } : {}),
              }).toString()}`}
            >
              Download CSV
            </a>
          </div>
          <QueueTable queue={queue} />
        </div>
      )}
    </AppShell>
  );
}
