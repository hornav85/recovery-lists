import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PhoneLink } from "@/components/PhoneLink";
import { AttemptForm } from "@/components/AttemptForm";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import {
  agentCanAccessLead,
  getLeadDetail,
  type AttemptRow,
  type LeadDb,
} from "@/lib/leads";

function LeadFields({
  lead,
}: {
  lead: {
    name: string | null;
    phone: string | null;
    address: string | null;
    status: string | null;
    appointment_date: string | null;
    date_col: string | null;
    meeting_time: string | null;
    project: string | null;
    agent: string | null;
    team: string | null;
    source: string | null;
    language: string | null;
    prospect_id: string | null;
    lead_id: string | null;
  };
}) {
  return (
    <dl className="dl">
      <dt>Name</dt>
      <dd>{lead.name || "—"}</dd>
      <dt>Phone</dt>
      <dd>
        <PhoneLink phone={lead.phone} />
      </dd>
      <dt>Address</dt>
      <dd>{lead.address || "—"}</dd>
      <dt>Status</dt>
      <dd>
        <span className="badge">{lead.status || "—"}</span>
      </dd>
      <dt>Appointment</dt>
      <dd>{lead.appointment_date || lead.date_col || "—"}</dd>
      <dt>Meeting time</dt>
      <dd>{lead.meeting_time || "—"}</dd>
      <dt>Project</dt>
      <dd>{lead.project || "—"}</dd>
      <dt>Sheet agent</dt>
      <dd>{lead.agent || "—"}</dd>
      <dt>Team</dt>
      <dd>{lead.team || "—"}</dd>
      <dt>Source</dt>
      <dd>{lead.source || "—"}</dd>
      <dt>Language</dt>
      <dd>{lead.language || "—"}</dd>
      <dt>Prospect ID</dt>
      <dd>{lead.prospect_id || "—"}</dd>
      <dt>Lead ID</dt>
      <dd>{lead.lead_id || "—"}</dd>
    </dl>
  );
}

/** Column S + sheet Q notes + prior sheet-row notes + app attempt notes. */
function NotesPanel({
  active,
  history,
  attempts,
}: {
  active: LeadDb;
  history: LeadDb[];
  attempts: AttemptRow[];
}) {
  const note = (active.notes_followups || "").trim();

  const priorSheetNotes = history
    .map((h) => {
      const s = (h.notes_followups || "").trim();
      if (!s) return null;
      return {
        id: h.id,
        when: h.appointment_date || h.date_col || "older row",
        agent: h.agent || "sheet agent",
        note: s,
      };
    })
    .filter(Boolean) as Array<{
    id: number;
    when: string;
    agent: string;
    note: string;
  }>;

  const agentNotes = attempts.filter((a) => (a.notes || "").trim());

  return (
    <div style={{ marginTop: "1.1rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border)" }}>
      <h2 style={{ margin: "0 0 0.65rem", fontSize: "1rem" }}>Notes</h2>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: "0.75rem" }}>
        {note || <span className="muted">—</span>}
      </div>

      <h3 style={{ margin: "0.85rem 0 0.45rem", fontSize: "0.95rem", fontWeight: 600 }}>
        Previous agent notes (this app)
      </h3>
      {agentNotes.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No attempt notes logged in Recovery Lists yet.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {agentNotes.map((a) => (
            <li key={a.id} style={{ marginBottom: "0.45rem" }}>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {a.created_at} · {a.agent_display_name} · {a.outcome}
              </span>
              <div style={{ whiteSpace: "pre-wrap" }}>{a.notes}</div>
            </li>
          ))}
        </ul>
      )}

      {priorSheetNotes.length > 0 && (
        <>
          <h3 style={{ margin: "0.85rem 0 0.45rem", fontSize: "0.95rem", fontWeight: 600 }}>
            Notes from older sheet rows
          </h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {priorSheetNotes.map((n) => (
              <li key={n.id} style={{ marginBottom: "0.45rem" }}>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  #{n.id} · {n.when} · {n.agent}
                </span>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.note}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureFixtureLeads();

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isFinite(leadId)) notFound();

  if (!(await agentCanAccessLead(user, leadId))) notFound();

  const detail = await getLeadDetail(leadId);
  if (!detail) notFound();

  const { active, history, attempts, hidden, isActiveRow } = detail;

  return (
    <AppShell user={user}>
      <p>
        <Link href="/lists">← Back to lists</Link>
      </p>
      <h1>{active.name || "Lead"}</h1>
      <p className="muted">
        Active row is newest by Appointment Date (else DATE). Older sheet rows are display-only
        history for this prospect.
      </p>

      {hidden && (
        <div className="error" style={{ marginBottom: "1rem" }}>
          This prospect is hidden from queues (sheet DNC, or Recovered/DNC from a prior day).
          Same-day Recovered/DNC stay on All attempts until the Pacific day ends.
        </div>
      )}

      {!isActiveRow && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <span className="badge warn">Viewing a history row</span>
          <p className="muted" style={{ marginBottom: 0 }}>
            Attempts attach to the prospect; the active card is{" "}
            <Link href={`/leads/${active.id}`}>lead #{active.id}</Link>.
          </p>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>Active lead</h2>
          <span className="badge ok">#{active.id}</span>
        </div>
        <LeadFields lead={active} />
        <NotesPanel active={active} history={history} attempts={attempts} />
      </div>

      <div className="card">
        <h2>Log call attempt</h2>
        <AttemptForm leadId={active.id} />
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
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.created_at}</td>
                  <td>{a.agent_display_name}</td>
                  <td>
                    <span className="badge">{a.outcome}</span>
                  </td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{a.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h2>Older sheet rows (display-only)</h2>
          {history.map((h) => (
            <div key={h.id} className="history-block">
              <div className="row" style={{ marginBottom: "0.5rem" }}>
                <span className="badge">#{h.id}</span>
                <span className="muted">
                  {h.appointment_date || h.date_col || "no date"} · {h.status}
                </span>
              </div>
              <LeadFields lead={h} />
              {(h.notes_followups || "").trim() && (
                <div style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
                  {(h.notes_followups || "").trim()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
