"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { PublicUser } from "@/lib/db";

type StatusRow = { id: number; name: string; active: number; created_at: string };

export default function AdminStatusesPage() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
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
    const res = await fetch("/api/admin/statuses");
    const data = await res.json();
    setStatuses(data.statuses || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function addStatus(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const res = await fetch("/api/admin/statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    setMsg(data.reactivated ? `Reactivated ${data.status.name}` : `Added ${data.status.name}`);
    setName("");
    await load();
  }

  async function removeStatus(id: number) {
    await fetch(`/api/admin/statuses?id=${id}`, { method: "DELETE" });
    setMsg("Status hidden (list removed from agents)");
    await load();
  }

  if (!me) return <div className="container muted">Loading…</div>;

  return (
    <AppShell user={me}>
      <h1>List statuses</h1>
      <p className="muted">
        Adding a status creates a new list. Removing hides it from agents (soft remove).
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <div className="card">
        <h2>Add status</h2>
        <form className="row" onSubmit={addStatus}>
          <label className="field" style={{ flex: 1 }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button className="btn" type="submit" style={{ alignSelf: "end" }}>
            Add
          </button>
        </form>
      </div>

      <div className="card">
        <h2>All statuses</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.active ? <span className="badge ok">yes</span> : <span className="badge">no</span>}</td>
                <td>
                  {s.active ? (
                    <button className="btn secondary" type="button" onClick={() => removeStatus(s.id)}>
                      Remove
                    </button>
                  ) : (
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={async () => {
                        await fetch("/api/admin/statuses", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: s.name }),
                        });
                        await load();
                      }}
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
