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
  const editRef = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [attemptBuckets, setAttemptBuckets] = useState<AttemptBucket[]>([]);
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, number[]>>({});
  const [attemptAssignmentsByUser, setAttemptAssignmentsByUser] = useState<
    Record<string, string[]>
  >({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [assigned, setAssigned] = useState<number[]>([]);
  const [assignedAttempts, setAssignedAttempts] = useState<string[]>([]);
  const [panelMsg, setPanelMsg] = useState("");
  const [panelError, setPanelError] = useState("");
  const [pageMsg, setPageMsg] = useState("");
  const [pageError, setPageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");

  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"agent" | "admin">("agent");
  const [editMsg, setEditMsg] = useState("");
  const [editError, setEditError] = useState("");

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

  useEffect(() => {
    if (editId != null && editRef.current) {
      editRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [editId]);

  const selectedUser = users.find((u) => u.id === selectedId) || null;
  const editingUser = users.find((u) => u.id === editId) || null;

  function namesForUser(userId: number): string[] {
    const ids = assignmentsByUser[String(userId)] || [];
    const statusNames = ids
      .map((id) => statuses.find((s) => s.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    const attemptNames = (attemptAssignmentsByUser[String(userId)] || []).map(
      (id) => attemptBuckets.find((b) => b.id === id)?.label || id,
    );
    return [...statusNames, ...attemptNames];
  }

  async function openLists(userId: number) {
    setPanelMsg("");
    setPanelError("");
    setPageMsg("");
    setPageError("");
    setEditId(null);
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

  function openEdit(u: PublicUser) {
    setSelectedId(null);
    setPageMsg("");
    setPageError("");
    setEditMsg("");
    setEditError("");
    setEditId(u.id);
    setEditDisplayName(u.displayName);
    setEditEmail(u.email);
    setEditPassword("");
    setEditRole(u.role);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setPageError("");
    setPageMsg("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, displayName, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPageError(data.error || "Create failed");
      return;
    }
    setPageMsg(`Created ${data.user.username} as ${data.user.role}`);
    setUsername("");
    setEmail("");
    setPassword("");
    setDisplayName("");
    setRole("agent");
    await load();
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editId || !editingUser) return;
    setEditSaving(true);
    setEditMsg("");
    setEditError("");
    try {
      const body: Record<string, unknown> = {
        id: editId,
        displayName: editDisplayName,
        email: editEmail,
        role: editRole,
      };
      if (editPassword.trim()) body.password = editPassword.trim();
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Update failed");
        return;
      }
      setEditMsg(`Updated ${data.user.displayName} (@${data.user.username})`);
      setEditPassword("");
      await load();
    } catch {
      setEditError("Network error while saving");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleDisabled(u: PublicUser) {
    setPageError("");
    setPageMsg("");
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, disabled: !u.disabled }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPageError(data.error || "Could not update status");
      return;
    }
    await load();
  }

  async function softDelete(u: PublicUser) {
    if (u.deleted) return;
    const ok = window.confirm(
      `Delete ${u.displayName} (@${u.username})?\n\nThey lose all access immediately. Dial history stays in Reports.`,
    );
    if (!ok) return;
    setPageError("");
    setPageMsg("");
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPageError(data.error || "Delete failed");
      return;
    }
    setPageMsg(data.message || `Deleted ${u.username}`);
    if (selectedId === u.id) setSelectedId(null);
    if (editId === u.id) setEditId(null);
    await load();
  }

  async function restoreUser(u: PublicUser) {
    setPageError("");
    setPageMsg("");
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, restore: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPageError(data.error || "Restore failed");
      return;
    }
    setPageMsg(`Restored ${data.user.username} — re-assign lists if needed.`);
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
        `Saved ${assigned.length} status list(s) and ${assignedAttempts.length} attempt list(s) for ${label}.`,
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
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setPanelMsg("");
  }

  if (!me) return <div className="container muted">Loading…</div>;

  return (
    <AppShell user={me}>
      <h1>Users & assignments</h1>
      <p className="muted">
        Create admins or agents, edit profile/password/role, assign lists, or soft-delete (keeps
        report history, removes access).
      </p>
      {pageError && <div className="error">{pageError}</div>}
      {pageMsg && <div className="success">{pageMsg}</div>}

      <div className="card">
        <h2>Create user</h2>
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
          <label className="field" style={{ maxWidth: 240 }}>
            Access role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "agent" | "admin")}
            >
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn" type="submit">
            Create {role}
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
              const isEditing = editId === u.id;
              return (
                <tr
                  key={u.id}
                  style={
                    isOpen || isEditing
                      ? { background: "rgba(61,154,106,0.08)" }
                      : u.deleted
                        ? { opacity: 0.65 }
                        : undefined
                  }
                >
                  <td>
                    {u.displayName}{" "}
                    <span className="muted">@{u.username}</span>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "ok" : ""}`}>{u.role}</span>
                  </td>
                  <td>
                    {u.deleted ? (
                      <span className="muted">—</span>
                    ) : u.role === "admin" ? (
                      <span className="muted">all active lists</span>
                    ) : names.length === 0 ? (
                      <span className="badge warn">none</span>
                    ) : (
                      <span className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                        {names.map((n) => (
                          <span key={n} className="badge ok">
                            {n}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    {u.deleted ? (
                      <span className="badge warn">deleted</span>
                    ) : u.disabled ? (
                      <span className="badge warn">disabled</span>
                    ) : (
                      "active"
                    )}
                  </td>
                  <td className="row" style={{ flexWrap: "wrap" }}>
                    {u.deleted ? (
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => restoreUser(u)}
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => openEdit(u)}
                        >
                          {isEditing ? "Editing…" : "Edit"}
                        </button>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => openLists(u.id)}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? "Lists…" : "Edit lists"}
                        </button>
                        {u.id !== me.id && (
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => toggleDisabled(u)}
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                        )}
                        {u.id !== me.id && (
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => softDelete(u)}
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingUser && !editingUser.deleted && (
        <div className="card" ref={editRef} id="edit-user-panel">
          <h2>
            Edit {editingUser.displayName}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              @{editingUser.username}
            </span>
          </h2>
          <p className="muted">Username stays the same. Leave password blank to keep it.</p>
          {editError && <div className="error">{editError}</div>}
          {editMsg && <div className="success">{editMsg}</div>}
          <form className="stack" onSubmit={saveEdit}>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Display name
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  required
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Email
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                New password
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Access role
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as "agent" | "admin")}
                  disabled={editingUser.id === me.id}
                >
                  <option value="agent">Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <div className="row">
              <button className="btn" type="submit" disabled={editSaving}>
                {editSaving ? "Saving…" : "Save user"}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setEditId(null);
                  setEditMsg("");
                  setEditError("");
                }}
              >
                Close
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedUser && !selectedUser.deleted && (
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
