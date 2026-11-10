"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { PublicUser } from "@/lib/db";

type Status = { id: number; name: string; active: number };
type AttemptBucket = { id: string; label: string };

export default function AdminUsersPage() {
  const router = useRouter();
  const assignRef = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [attemptBuckets, setAttemptBuckets] = useState<AttemptBucket[]>([]);
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, number[]>>({});
  const [attemptAssignmentsByUser, setAttemptAssignmentsByUser] = useState<
    Record<string, string[]>
  >({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assigned, setAssigned] = useState<number[]>([]);
  const [assignedAttempts, setAssignedAttempts] = useState<string[]>([]);
  const [panelMsg, setPanelMsg] = useState("");
  const [panelError, setPanelError] = useState("");
  const [pageMsg, setPageMsg] = useState("");
  const [pageError, setPageError] = useState("");
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  function applyAssignmentsMap(map: Record<string, number[]> | undefined) {
    setAssignmentsByUser(map || {});
  }

  function applyAttemptMap(map: Record<string, string[]> | undefined) {
    setAttemptAssignmentsByUser(map || {});
  }

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
    const [uRes, aRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/assignments"),
    ]);
    const uData = await uRes.json();
    const aData = await aRes.json();
    setUsers(uData.users || []);
    setStatuses((aData.statuses || []).filter((s: Status) => s.active));
    setAttemptBuckets(aData.attemptBuckets || []);
    applyAssignmentsMap(aData.assignmentsByUser);
    applyAttemptMap(aData.attemptAssignmentsByUser);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (selectedId != null && assignRef.current) {
      assignRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  const selectedUser = users.find((u) => u.id === selectedId) || null;

  function namesForUser(userId: number): string[] {
    const ids = assignmentsByUser[String(userId)] || [];
    const statusNames = ids
      .map((id) => statuses.find((s) => s.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    const attemptNames = (attemptAssignmentsByUser[String(userId)] || [])
      .map((id) => attemptBuckets.find((b) => b.id === id)?.label || id);
    return [...statusNames, ...attemptNames];
  }

  async function openLists(userId: number) {
    setPanelMsg("");
    setPanelError("");
    setPageMsg("");
    setPageError("");
    setSelectedId(userId);
    const res = await fetch(`/api/admin/assignments?userId=${userId}`);
    const data = await res.json();
    if (!res.ok) {
      setPanelError(data.error || "Could not load assignments");
      return;
    }
    setAssigned(data.assignedStatusIds || []);
    setAssignedAttempts(data.assignedAttemptBuckets || []);
    if (data.assignmentsByUser) applyAssignmentsMap(data.assignmentsByUser);
    if (data.attemptAssignmentsByUser) applyAttemptMap(data.attemptAssignmentsByUser);
    if (data.statuses) {
      setStatuses((data.statuses as Status[]).filter((s) => s.active));
    }
    if (data.attemptBuckets) setAttemptBuckets(data.attemptBuckets);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setPageError("");
    setPageMsg("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, displayName, role: "agent" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPageError(data.error || "Create failed");
      return;
    }
    setPageMsg(`Created ${data.user.username}`);
    setUsername("");
    setEmail("");
    setPassword("");
    setDisplayName("");
    await load();
  }

  async function toggleDisabled(u: PublicUser) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, disabled: !u.disabled }),
    });
    await load();
  }

  async function saveAssignments() {
    if (!selectedId || !selectedUser) return;
    setSaving(true);
    setPanelMsg("");
    setPanelError("");
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedId,
          statusIds: assigned,
          attemptBuckets: assignedAttempts,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPanelError(data.error || "Failed to save assignments");
        return;
      }
      if (data.assignmentsByUser) applyAssignmentsMap(data.assignmentsByUser);
      else {
        setAssignmentsByUser((prev) => ({
          ...prev,
          [String(selectedId)]: assigned,
        }));
      }
      if (data.attemptAssignmentsByUser) applyAttemptMap(data.attemptAssignmentsByUser);
      else {
        setAttemptAssignmentsByUser((prev) => ({
          ...prev,
          [String(selectedId)]: assignedAttempts,
        }));
      }
      const label = selectedUser.displayName || selectedUser.username;
      setPanelMsg(
        `Saved ${assigned.length} status list(s) and ${assignedAttempts.length} attempt list(s) for ${label}.`
      );
    } catch {
      setPanelError("Network error while saving");
    } finally {
      setSaving(false);
    }
  }

  function toggleStatus(id: number) {
    setAssigned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPanelMsg("");
  }

  function toggleAttempt(id: string) {
    setAssignedAttempts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setPanelMsg("");
  }

  if (!me) return <div className="container muted">Loading…</div>;

  return (
    <AppShell user={me}>
      <h1>Users & assignments</h1>
      <p className="muted">
        Create/disable agents and assign <strong>status lists</strong> and{" "}
        <strong>attempt lists</strong> (1 attempt, Burned out, etc.). Click{" "}
        <strong>Edit lists</strong> to change them.
      </p>
      {pageError && <div className="error">{pageError}</div>}
      {pageMsg && <div className="success">{pageMsg}</div>}

      <div className="card">
        <h2>Create agent</h2>
        <form className="stack" onSubmit={createUser}>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </div>
          <button className="btn" type="submit">
            Create agent
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Accounts</h2>
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Assigned lists</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const names = namesForUser(u.id);
              const isOpen = selectedId === u.id;
              return (
                <tr key={u.id} style={isOpen ? { background: "rgba(61,154,106,0.08)" } : undefined}>
                  <td>
                    {u.displayName}{" "}
                    <span className="muted">@{u.username}</span>
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>
                    {u.role === "admin" ? (
                      <span className="muted">all active lists</span>
                    ) : names.length === 0 ? (
                      <span className="badge warn">none</span>
                    ) : (
                      <span className="row" style={{ gap: "0.35rem" }}>
                        {names.map((n) => (
                          <span key={n} className="badge ok">
                            {n}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>{u.disabled ? <span className="badge warn">disabled</span> : "active"}</td>
                  <td className="row">
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => openLists(u.id)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? "Editing…" : "Edit lists"}
                    </button>
                    {u.username !== "admin" && (
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => toggleDisabled(u)}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedUser && (
        <div className="card" ref={assignRef} id="assignment-panel">
          <h2>
            Lists for {selectedUser.displayName}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              @{selectedUser.username}
            </span>
          </h2>
          {selectedUser.role === "admin" && (
            <p className="muted">
              Admins always see every active list on the Lists page. Assignments here still save and
              show as chips, but they do not limit the admin queue.
            </p>
          )}
          <p className="muted">
            Status lists = sheet Column W queues. Attempt lists = dial buckets across those statuses
            (Burned out = 6+ attempts).
          </p>
          {panelError && <div className="error">{panelError}</div>}
          {panelMsg && <div className="success">{panelMsg}</div>}
          <h3 style={{ margin: "1rem 0 0.5rem", fontSize: "0.95rem" }}>Status lists</h3>
          <div className="stack">
            {statuses.map((s) => (
              <label key={s.id} className="row" style={{ gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={assigned.includes(s.id)}
                  onChange={() => toggleStatus(s.id)}
                />
                {s.name}
              </label>
            ))}
          </div>
          <h3 style={{ margin: "1.25rem 0 0.5rem", fontSize: "0.95rem" }}>Attempt lists</h3>
          <div className="stack">
            {attemptBuckets.map((b) => (
              <label key={b.id} className="row" style={{ gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={assignedAttempts.includes(b.id)}
                  onChange={() => toggleAttempt(b.id)}
                />
                {b.label}
                {b.id === "burned" ? " (6+ dials)" : ""}
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button className="btn" type="button" onClick={saveAssignments} disabled={saving}>
              {saving ? "Saving…" : "Save assignments"}
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setSelectedId(null);
                setPanelMsg("");
                setPanelError("");
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
