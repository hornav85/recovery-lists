import Link from "next/link";
import { redirect } from "next/navigation";
import { AdditionalListManager } from "@/components/AdditionalListManager";
import { AppShell } from "@/components/AppShell";
import { ATTEMPT_BUCKETS, parseAttemptBucket, bucketLabel } from "@/lib/attempts";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import {
  getAssignedManualLists,
  getManualQueue,
  listManualLists,
  type ManualQueueRow,
} from "@/lib/manual-lists";

function buildHref(opts: { list?: number; attempts?: string }) {
  const p = new URLSearchParams();
  if (opts.list) p.set("list", String(opts.list));
  if (opts.attempts) p.set("attempts", opts.attempts);
  const q = p.toString();
  return q ? `/additional-lists?${q}` : "/additional-lists";
}

function prospectHref(rowId: number, opts: { list?: number; attempts?: string }) {
  const q = buildHref(opts).split("?")[1];
  return q ? `/additional-lists/${rowId}?${q}` : `/additional-lists/${rowId}`;
}

function QueueTable({
  columns,
  queue,
  listId,
  attempts,
}: {
  columns: string[];
  queue: ManualQueueRow[];
  listId: number;
  attempts?: string;
}) {
  if (queue.length === 0) {
    return <p className="muted">No visible prospects in this list.</p>;
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
                    {isName ? (
                      <Link href={prospectHref(row.id, { list: listId, attempts })}>
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
  searchParams: Promise<{ list?: string; attempts?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureFixtureLeads();

  const lists = await getAssignedManualLists(user.id, user.role);
  const sp = await searchParams;
  const requested = Number(sp.list);
  const active = lists.find((list) => list.id === requested) || lists[0] || null;
  const attemptFilter = parseAttemptBucket(sp.attempts);
  const full = active ? await getManualQueue(active.id) : { columns: [], queue: [] };
  const counts: Record<string, number> = {};
  for (const bucket of ATTEMPT_BUCKETS) counts[bucket.id] = 0;
  for (const row of full.queue) {
    counts[row.attempt_bucket] = (counts[row.attempt_bucket] || 0) + 1;
  }
  const filtered = attemptFilter
    ? full.queue.filter((row) => row.attempt_bucket === attemptFilter)
    : full.queue;

  return (
    <AppShell user={user}>
      <h1>Additional lists</h1>
      <p className="muted">
        Separate from the Database sync. Each uploaded file is its own list, with the same attempt
        counts, notes, and callback outcome.
      </p>

      {user.role === "admin" && <AdditionalListManager lists={await listManualLists()} />}

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
                  })}
                  className={`tab ${list.id === active.id ? "active" : ""}`}
                >
                  {list.name}
                </Link>
              ))}
            </div>
            <div className="tabs">
              <Link
                href={buildHref({ list: active.id })}
                className={`tab ${!attemptFilter ? "active" : ""}`}
              >
                All attempts ({full.queue.length})
              </Link>
              {ATTEMPT_BUCKETS.map((bucket) => (
                <Link
                  key={bucket.id}
                  href={buildHref({ list: active.id, attempts: bucket.id })}
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
              <QueueTable
                columns={full.columns}
                queue={filtered}
                listId={active.id}
                attempts={attemptFilter || undefined}
              />
            </div>
          </>
        )
      )}
    </AppShell>
  );
}
