import Link from "next/link";
import { PhoneLink } from "@/components/PhoneLink";
import type { ManualSearchHit } from "@/lib/manual-lists";

export function AdditionalSearchHits({
  hits,
  empty,
  find,
  q,
}: {
  hits: ManualSearchHit[];
  empty?: string;
  find?: string;
  q?: string;
}) {
  if (hits.length === 0) {
    return empty ? <p className="muted">{empty}</p> : null;
  }
  return (
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
          {hits.map((hit) => (
            <tr key={`${hit.list_id}-${hit.id}`}>
              <td>
                <span className="badge">{hit.listName}</span>
              </td>
              <td>
                <Link
                  href={`/additional-lists/${hit.id}?${new URLSearchParams({
                    list: String(hit.list_id),
                    ...(find ? { find } : {}),
                    ...(q ? { q } : {}),
                  }).toString()}`}
                >
                  {hit.name || "—"}
                </Link>
              </td>
              <td>
                <PhoneLink phone={hit.phone} />
              </td>
              <td>
                {hit.attempt_count >= 6 ? (
                  <span className="badge warn">{hit.attempt_count} · burned</span>
                ) : (
                  <span className="badge">{hit.attempt_count}</span>
                )}
              </td>
              <td>
                {hit.latest_attempt ? (
                  <span className="badge">{hit.latest_attempt.outcome}</span>
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
