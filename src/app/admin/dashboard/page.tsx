"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { PublicUser } from "@/lib/db";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";

type DashReport = {
  range: { label: string };
  team: {
    dials: number;
    recovered: number;
    recoveryRate: number;
    agentsActive: number;
    outcomes: Record<string, number>;
  };
  byAgent: Array<{
    displayName: string;
    dials: number;
    recovered: number;
    dialsPerHour: number;
    assignedStatusNames: string[];
  }>;
  dayHistory: Array<{ day: string; dials: number; recovered: number }>;
  listPerformance: Array<{ status: string; dials: number; recovered: number }>;
};

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="bar-value">{value}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [preset, setPreset] = useState("today");
  const [report, setReport] = useState<DashReport | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/dashboard?preset=${encodeURIComponent(preset)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Refresh failed");
        return;
      }
      setReport(data.report);
      setRefreshedAt(data.refreshedAt);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        router.push("/login");
        return;
      }
      const meData = await meRes.json();
      if (meData.user.role !== "admin") {
        router.push("/lists");
        return;
      }
      setMe(meData.user);
    })();
  }, [router]);

  useEffect(() => {
    if (me) refresh();
  }, [me, refresh]);

  if (!me) return <div className="container muted">Loading…</div>;

  const outcomeMax = report
    ? Math.max(1, ...ATTEMPT_OUTCOMES.map((o) => report.team.outcomes[o] || 0))
    : 1;
  const agentMax = report ? Math.max(1, ...report.byAgent.map((a) => a.dials)) : 1;
  const dayMax = report ? Math.max(1, ...report.dayHistory.map((d) => d.dials)) : 1;

  return (
    <AppShell user={me}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "end" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Live dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Keep this tab open. Click <strong>Sync now</strong> to pull the latest agent dials (not
            auto-streaming).
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem", alignItems: "end" }}>
          <label className="field">
            Range
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={refresh} disabled={loading}>
            {loading ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {refreshedAt && (
        <p className="muted">
          Last sync {new Date(refreshedAt).toLocaleString()} · {report?.range.label}
        </p>
      )}
      {error && <div className="error">{error}</div>}

      {report && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Dials</div>
              <div className="stat-value">{report.team.dials}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Recovered</div>
              <div className="stat-value accent">{report.team.recovered}</div>
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

          <div className="dash-grid">
            <div className="card">
              <h2>Outcomes</h2>
              {ATTEMPT_OUTCOMES.map((o) => (
                <Bar key={o} label={o} value={report.team.outcomes[o] || 0} max={outcomeMax} />
              ))}
            </div>

            <div className="card">
              <h2>Agent dials</h2>
              {report.byAgent.length === 0 ? (
                <p className="muted">No agents with activity or assignments.</p>
              ) : (
                report.byAgent.slice(0, 12).map((a) => (
                  <Bar key={a.displayName} label={a.displayName} value={a.dials} max={agentMax} />
                ))
              )}
            </div>

            <div className="card">
              <h2>Recovered by agent</h2>
              {report.byAgent
                .slice()
                .sort((a, b) => b.recovered - a.recovered)
                .slice(0, 12)
                .map((a) => (
                  <Bar
                    key={`rec-${a.displayName}`}
                    label={a.displayName}
                    value={a.recovered}
                    max={Math.max(1, ...report.byAgent.map((x) => x.recovered))}
                  />
                ))}
            </div>

            <div className="card">
              <h2>Day trend</h2>
              {report.dayHistory.length === 0 ? (
                <p className="muted">No dials in range yet.</p>
              ) : (
                report.dayHistory.map((d) => (
                  <Bar key={d.day} label={d.day} value={d.dials} max={dayMax} />
                ))
              )}
            </div>
          </div>

          <div className="card">
            <h2>Who is on what</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Lists</th>
                  <th>Dials</th>
                  <th>Recovered</th>
                  <th>Pace /hr</th>
                </tr>
              </thead>
              <tbody>
                {report.byAgent.map((a) => (
                  <tr key={a.displayName}>
                    <td>{a.displayName}</td>
                    <td>
                      {a.assignedStatusNames.length ? (
                        a.assignedStatusNames.map((n) => (
                          <span key={n} className="badge ok" style={{ marginRight: 4 }}>
                            {n}
                          </span>
                        ))
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{a.dials}</td>
                    <td>{a.recovered}</td>
                    <td>{a.dialsPerHour || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
