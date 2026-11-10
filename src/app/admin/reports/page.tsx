"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { PublicUser } from "@/lib/db";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";

type AgentOpt = { id: number; username: string; display_name: string };

type ReportPayload = {
  range: { label: string; fromYmd: string; toYmd: string; preset: string };
  timezone: string;
  generatedAt: string;
  team: {
    dials: number;
    recovered: number;
    recoveryRate: number;
    uniqueProspects: number;
    agentsActive: number;
    outcomes: Record<string, number>;
  };
  byAgent: Array<{
    agentId: number;
    displayName: string;
    username: string;
    dials: number;
    uniqueProspects: number;
    recovered: number;
    recoveryRate: number;
    dialsPerHour: number;
    activeHours: number;
    assignedStatusNames: string[];
    assignedAttemptBuckets: string[];
    outcomes: Record<string, number>;
  }>;
  listPerformance: Array<{
    status: string;
    dials: number;
    recovered: number;
    recoveryRate: number;
  }>;
  dayHistory: Array<{ day: string; dials: number; recovered: number }>;
  leaderboard: {
    byDials: Array<{ displayName: string; dials: number; recovered: number }>;
    byRecovered: Array<{ displayName: string; dials: number; recovered: number }>;
  };
  queueLeftover: Array<{
    displayName: string;
    statusName: string;
    remaining: number;
  }>;
};

export default function AdminReportsPage() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [preset, setPreset] = useState("today");
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [agentId, setAgentId] = useState("");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (preset === "day" && day) {
      p.set("day", day);
    } else if (preset === "custom") {
      p.set("preset", "custom");
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    } else {
      p.set("preset", preset);
    }
    if (agentId) p.set("agentId", agentId);
    return p.toString();
  }, [preset, day, from, to, agentId]);

  async function ensureAdmin() {
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      router.push("/login");
      return null;
    }
    const meData = await meRes.json();
    if (meData.user.role !== "admin") {
      router.push("/lists");
      return null;
    }
    setMe(meData.user);
    return meData.user as PublicUser;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const user = me || (await ensureAdmin());
      if (!user) return;
      const res = await fetch(`/api/admin/reports?${query}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load report");
        return;
      }
      setAgents(data.agents || []);
      setReport(data.report);
    } catch {
      setError("Network error loading report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return <div className="container muted">Loading…</div>;

  return (
    <AppShell user={me}>
      <h1>Reports</h1>
      <p className="muted">
        Admin-only. Pacific time ({report?.timezone || "America/Los_Angeles"}). Assignment history
        starts when you save lists on Users.
      </p>

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
          <label className="field">
            Preset
            <select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                if (e.target.value !== "day") setDay("");
                if (e.target.value !== "custom") {
                  setFrom("");
                  setTo("");
                }
              }}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="day">Pick one day</option>
              <option value="custom">Custom range</option>
            </select>
          </label>

          {preset === "day" && (
            <label className="field">
              Day
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
          )}

          {preset === "custom" && (
            <>
              <label className="field">
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}

          <label className="field">
            Agent
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name} (@{a.username})
                </option>
              ))}
            </select>
          </label>

          <button className="btn" type="button" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Run report"}
          </button>
          <a className="btn secondary" href={`/api/admin/reports/export?${query}`}>
            Download CSV
          </a>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {report && (
        <>
          <p className="muted">
            {report.range.label} · generated {new Date(report.generatedAt).toLocaleString()}
          </p>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Dials</div>
              <div className="stat-value">{report.team.dials}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Recovered</div>
              <div className="stat-value">{report.team.recovered}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Recovery rate</div>
              <div className="stat-value">{report.team.recoveryRate}%</div>
            </div>
            <div className="stat">
              <div className="stat-label">Agents dialing</div>
              <div className="stat-value">{report.team.agentsActive}</div>
            </div>
          </div>

          <div className="card">
            <h2>Team outcomes</h2>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              {ATTEMPT_OUTCOMES.map((o) => (
                <span key={o} className="badge">
                  {o}: {report.team.outcomes[o] || 0}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>By agent</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Assigned lists</th>
                  <th>Dials</th>
                  <th>Prospects</th>
                  <th>Recovered</th>
                  <th>Rate</th>
                  <th>Pace /hr</th>
                  <th>Outcomes</th>
                </tr>
              </thead>
              <tbody>
                {report.byAgent.map((a) => (
                  <tr key={a.agentId}>
                    <td>
                      {a.displayName}{" "}
                      <span className="muted">@{a.username}</span>
                    </td>
                    <td>
                      {[...a.assignedStatusNames, ...a.assignedAttemptBuckets].length ? (
                        <span className="row" style={{ gap: "0.25rem", flexWrap: "wrap" }}>
                          {[...a.assignedStatusNames, ...a.assignedAttemptBuckets].map((n) => (
                            <span key={n} className="badge ok">
                              {n}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{a.dials}</td>
                    <td>{a.uniqueProspects}</td>
                    <td>{a.recovered}</td>
                    <td>{a.recoveryRate}%</td>
                    <td>{a.dialsPerHour || "—"}</td>
                    <td className="muted" style={{ fontSize: "0.8rem" }}>
                      {ATTEMPT_OUTCOMES.filter((o) => a.outcomes[o])
                        .map((o) => `${o} ${a.outcomes[o]}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>List performance</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Status list</th>
                  <th>Dials</th>
                  <th>Recovered</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.listPerformance.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No dials in this range.
                    </td>
                  </tr>
                ) : (
                  report.listPerformance.map((l) => (
                    <tr key={l.status}>
                      <td>{l.status}</td>
                      <td>{l.dials}</td>
                      <td>{l.recovered}</td>
                      <td>{l.recoveryRate}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Day history</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Dials</th>
                  <th>Recovered</th>
                </tr>
              </thead>
              <tbody>
                {report.dayHistory.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No dials yet.
                    </td>
                  </tr>
                ) : (
                  report.dayHistory.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{d.dials}</td>
                      <td>{d.recovered}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Leaderboard</h2>
            <div className="row" style={{ gap: "2rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3 style={{ fontSize: "0.95rem" }}>Most dials</h3>
                <ol>
                  {report.leaderboard.byDials.map((a) => (
                    <li key={`d-${a.displayName}`}>
                      {a.displayName} — {a.dials} dials ({a.recovered} recovered)
                    </li>
                  ))}
                </ol>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3 style={{ fontSize: "0.95rem" }}>Most recovered</h3>
                <ol>
                  {report.leaderboard.byRecovered.map((a) => (
                    <li key={`r-${a.displayName}`}>
                      {a.displayName} — {a.recovered} recovered ({a.dials} dials)
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Queue leftover</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Visible leads still left in each agent’s assigned status lists (current queue).
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>List</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {report.queueLeftover.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No assigned status lists.
                    </td>
                  </tr>
                ) : (
                  report.queueLeftover.map((q) => (
                    <tr key={`${q.displayName}-${q.statusName}`}>
                      <td>{q.displayName}</td>
                      <td>{q.statusName}</td>
                      <td>{q.remaining}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
