import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AttemptForm } from "@/components/AttemptForm";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { agentCanAccessManualRow, getManualRowDetail } from "@/lib/manual-lists";

export default async function AdditionalListProspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ list?: string; attempts?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureFixtureLeads();

  const { id } = await params;
  const sp = await searchParams;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) notFound();
  if (!(await agentCanAccessManualRow(user, rowId))) notFound();

  const detail = await getManualRowDetail(rowId);
  if (!detail) notFound();
  const { list, row, attempts, hidden } = detail;
  const noteAttempts = attempts.filter((attempt) => (attempt.notes || "").trim());
  const back = new URLSearchParams();
  back.set("list", sp.list || String(list.id));
  if (sp.attempts) back.set("attempts", sp.attempts);
  const backHref = `/additional-lists?${back.toString()}`;

  return (
    <AppShell user={user}>
      <p>
        <Link href={backHref}>← Back to {list.name}</Link>
      </p>
      <h1>{row.name || "Prospect"}</h1>
      <p className="muted">
        Additional list <strong>{list.name}</strong>. This prospect is not part of the Database
        sync.
      </p>

      {hidden && (
        <div className="error" style={{ marginBottom: "1rem" }}>
          This prospect is hidden from the queue (Recovered or DNC).
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Prospect</h2>
        <dl className="dl">
          {list.columns.map((column) => (
            <span key={column} style={{ display: "contents" }}>
              <dt>{column}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{row.fields[column] || "—"}</dd>
            </span>
          ))}
        </dl>

        <div style={{ marginTop: "1.1rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border)" }}>
          <h2 style={{ margin: "0 0 0.65rem", fontSize: "1rem" }}>Notes</h2>
          {noteAttempts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No attempt notes yet.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {noteAttempts.map((attempt) => (
                <li key={attempt.id} style={{ marginBottom: "0.45rem" }}>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    {attempt.created_at} · {attempt.agent_display_name} · {attempt.outcome}
                  </span>
                  <div style={{ whiteSpace: "pre-wrap" }}>{attempt.notes}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Log call attempt</h2>
        <AttemptForm manualRowId={row.id} returnTo={backHref} />
      </div>

      <div className="card">
        <h2>Attempt history</h2>
        {attempts.length === 0 ? (
          <p className="muted">No attempts yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Agent</th>
                <th>Outcome</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.created_at}</td>
                  <td>{attempt.agent_display_name}</td>
                  <td>
                    <span className="badge">{attempt.outcome}</span>
                  </td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{attempt.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
