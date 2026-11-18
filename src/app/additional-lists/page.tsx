import Link from "next/link";
import { redirect } from "next/navigation";
import { AdditionalListManager } from "@/components/AdditionalListManager";
import { AdditionalSearchHits } from "@/components/AdditionalSearchHits";
import { AdminLeadSearch } from "@/components/AdminLeadSearch";
import { AppShell } from "@/components/AppShell";
import { PhoneLink } from "@/components/PhoneLink";
import { ATTEMPT_BUCKETS, parseAttemptBucket, bucketLabel } from "@/lib/attempts";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { getAllVisibleLeads } from "@/lib/leads";
import {
  getAssignedManualLists,
  getManualQueue,
  isPhoneColumn,
  listManualLists,
  manualRowMatchesSearch,
  searchVisibleManualRows,
  type ManualQueueRow,
} from "@/lib/manual-lists";
import { filterQueueBySearch } from "@/lib/queue-filters";

function buildHref(opts: { list?: number; attempts?: string; q?: string; find?: string }) {
  const p = new URLSearchParams();
  if (opts.list) p.set("list", String(opts.list));
  if (opts.attempts) p.set("attempts", opts.attempts);
  if (opts.q) p.set("q", opts.q);
  if (opts.find) p.set("find", opts.find);
  const q = p.toString();
  return q ? `/additional-lists?${q}` : "/additional-lists";
}

function prospectHref(rowId: number, opts: { list?: number; attempts?: string; q?: string; find?: string }) {
  const q = buildHref(opts).split("?")[1];
  return q ? `/additional-lists/${rowId}?${q}` : `/additional-lists/${rowId}`;
}

function QueueTable({
  columns,
  queue,
  listId,
  attempts,
  q,
  find,
  empty = "No visible prospects in this list.",
}: {
  columns: string[];
  queue: ManualQueueRow[];
  listId: number;
  attempts?: string;
  q?: string;
  find?: string;
  empty?: string;
}) {
  if (queue.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            <th>Attempts</th>
            <th>Last attempt</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => {
                const isName = (row.fields[column] || "") === (row.name || "") && column ===
                  columns.find((candidate) => (row.fields[candidate] || "") === (row.name || ""));
                return (
                  <td key={column}>
                    {isPhoneColumn(column) ? (
                      <PhoneLink phone={row.fields[column] || row.phone} />
                    ) : isName ? (
                      <Link href={prospectHref(row.id, { list: listId, attempts, q, find })}>
                        {row.fields[column] || "—"}
                      </Link>
                    ) : (
                      row.fields[column] || "—"
                    )}
                  </td>
                );
              })}
              <td>
                {row.attempt_count >= 6 ? (
                  <span className="badge warn">{row.attempt_count} · burned</span>
                ) : (
                  <span className="badge">{row.attempt_count}</span>
                )}
              </td>
              <td>
                {row.latest_attempt ? (
                  <span className="badge">{row.latest_attempt.outcome}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdditionalListsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; attempts?: string; q?: string; find?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureFixtureLeads();

  const lists = await getAssignedManualLists(user.id, user.role);
  const sp = await searchParams;
  const requested = Number(sp.list);
  const active = lists.find((list) => list.id === requested) || lists[0] || null;
  const attemptFilter = parseAttemptBucket(sp.attempts);
  const searchQuery = user.role === "admin" ? (sp.q || "").trim() : "";
  const findQuery = user.role === "admin" ? (sp.find || "").trim() : "";
  const full = active ? await getManualQueue(active.id) : { columns: [], queue: [] };
  const recoveryMatches = findQuery
    ? filterQueueBySearch(await getAllVisibleLeads(), findQuery)
    : [];
  const additionalMatches = findQuery ? await searchVisibleManualRows(findQuery) : [];
  const counts: Record<string, number> = {};
  for (const bucket of ATTEMPT_BUCKETS) counts[bucket.id] = 0;
  for (const row of full.queue) {
    counts[row.attempt_bucket] = (counts[row.attempt_bucket] || 0) + 1;
  }
  const inBucket = attemptFilter
    ? full.queue.filter((row) => row.attempt_bucket === attemptFilter)
    : full.queue;
  const filtered = searchQuery
    ? inBucket.filter((row) => manualRowMatchesSearch(row, searchQuery))
    : inBucket;

  return (
    <AppShell user={user}>
      <h1>Additional lists</h1>
      <p className="muted">
        Separate from the Database sync. Each uploaded file is its own list, with the same attempt
        counts, notes, and callback outcome.
      </p>

      {user.role === "admin" ? (
        <>
          <AdminLeadSearch
            hrefBase="/additional-lists"
            query={findQuery}
            paramName="find"
            label="Search all lists"
            placeholder="Name, phone, or any lead field"
            baseParams={{
              list: active ? String(active.id) : undefined,
              attempts: attemptFilter || undefined,
              q: searchQuery || undefined,
            }}
          />
          {findQuery ? (
            <div className="card">
              <h2>
                All lists{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  ({recoveryMatches.length + additionalMatches.length})
                </span>
              </h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Matches for “{findQuery}” in every recovery list and additional list.
              </p>
              {recoveryMatches.length === 0 && additionalMatches.length === 0 ? (
                <p className="muted">No leads match in any list.</p>
              ) : (
                <>
                  {recoveryMatches.length > 0 ? (
                    <div style={{ overflowX: "auto" }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>List</th>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Attempts</th>
                            <th>Last attempt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recoveryMatches.map((lead) => (
                            <tr key={`r-${lead.id}`}>
                              <td>
                                <span className="badge">{lead.status || "—"}</span>
                              </td>
                              <td>
                                <Link
                                  href={`/leads/${lead.id}?${new URLSearchParams({
                                    ...(lead.status ? { status: lead.status } : {}),
                                    find: findQuery,
                                  }).toString()}`}
                                >
                                  {lead.name || "—"}
                                </Link>
                              </td>
                              <td>
                                <PhoneLink phone={lead.phone} />
                              </td>
                              <td>{lead.attempt_count}</td>
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
                    </div>
                  ) : null}
                  <AdditionalSearchHits hits={additionalMatches} find={findQuery} q={searchQuery} />
                </>
              )}
            </div>
          ) : null}
          <AdditionalListManager lists={await listManualLists()} />
        </>
      ) : null}

      {lists.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {user.role === "admin"
              ? "Upload a list above, then assign agents on Users."
              : "No additional lists assigned. Ask an admin to assign you."}
          </p>
        </div>
      ) : (
        active && (
          <>
            <div className="tabs">
              {lists.map((list) => (
                <Link
                  key={list.id}
                  href={buildHref({
                    list: list.id,
                    attempts: attemptFilter || undefined,
                    q: searchQuery || undefined,
                    find: findQuery || undefined,
                  })}
                  className={`tab ${list.id === active.id ? "active" : ""}`}
                >
                  {list.name}
                </Link>
              ))}
            </div>
            <div className="tabs">
              <Link
                href={buildHref({
                  list: active.id,
                  q: searchQuery || undefined,
                  find: findQuery || undefined,
                })}
                className={`tab ${!attemptFilter ? "active" : ""}`}
              >
                All attempts ({full.queue.length})
              </Link>
              {ATTEMPT_BUCKETS.map((bucket) => (
                <Link
                  key={bucket.id}
                  href={buildHref({
                    list: active.id,
                    attempts: bucket.id,
                    q: searchQuery || undefined,
                    find: findQuery || undefined,
                  })}
                  className={`tab ${attemptFilter === bucket.id ? "active" : ""} ${
                    bucket.id === "burned" ? "warn-tab" : ""
                  }`}
                >
                  {bucket.label} ({counts[bucket.id] || 0})
                </Link>
              ))}
            </div>
            <div className="card">
              <h2>
                {active.name}
                {attemptFilter ? ` · ${bucketLabel(attemptFilter)}` : ""}{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  ({filtered.length})
                </span>
              </h2>
              {user.role === "admin" ? (
                <AdminLeadSearch
                  hrefBase="/additional-lists"
                  query={searchQuery}
                  label="Search this list"
                  placeholder="Filter the open list"
                  baseParams={{
                    list: String(active.id),
                    attempts: attemptFilter || undefined,
                    find: findQuery || undefined,
                  }}
                />
              ) : null}
              <QueueTable
                columns={full.columns}
                queue={filtered}
                listId={active.id}
                attempts={attemptFilter || undefined}
                q={searchQuery || undefined}
                find={findQuery || undefined}
                empty={searchQuery ? "No prospects match this search." : undefined}
              />
            </div>
          </>
        )
      )}
    </AppShell>
  );
}
