"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ManualListSummary } from "@/lib/manual-lists";

export function AdditionalListManager({ lists }: { lists: ManualListSummary[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a CSV file.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const body = new FormData();
      body.set("name", name);
      body.set("file", file);
      const res = await fetch("/api/admin/manual-lists", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      setMsg(data.message);
      setName("");
      setFile(null);
      const input = document.getElementById("additional-list-file") as HTMLInputElement | null;
      if (input) input.value = "";
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function replace(list: ManualListSummary, next: File) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const body = new FormData();
      body.set("name", list.name);
      body.set("replaceId", String(list.id));
      body.set("file", next);
      const res = await fetch("/api/admin/manual-lists", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Replace failed");
        return;
      }
      setMsg(data.message);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(list: ManualListSummary) {
    const ok = window.confirm(
      `Delete “${list.name}”?\n\nAgents lose the queue. Dial history stays in Reports.`,
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/manual-lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: list.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Delete failed");
        return;
      }
      setMsg(data.message);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Upload a list</h2>
      <p className="muted">
        Name the list, then upload a CSV. The header row is what agents see. A row needs a name and
        a phone number; other columns can be anything. This does not go into Sync or the Database
        sheet.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <form className="stack" onSubmit={upload}>
        <label className="field">
          List name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="March callbacks"
            required
            maxLength={80}
          />
        </label>
        <label className="field">
          CSV file
          <input
            id="additional-list-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Create list"}
        </button>
      </form>

      {lists.length > 0 && (
        <>
          <h2 style={{ marginTop: "1.25rem" }}>Uploaded lists</h2>
          <table className="table">
            <thead>
              <tr>
                <th>List</th>
                <th>Prospects</th>
                <th>Columns</th>
                <th>Assigned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => (
                <tr key={list.id}>
                  <td>{list.name}</td>
                  <td>{list.rowCount}</td>
                  <td className="muted" style={{ fontSize: "0.85rem" }}>
                    {list.columns.join(", ")}
                  </td>
                  <td>
                    {list.assignedAgents.length === 0 ? (
                      <span className="muted">Nobody yet — assign on Users</span>
                    ) : (
                      list.assignedAgents.join(", ")
                    )}
                  </td>
                  <td className="row" style={{ flexWrap: "wrap" }}>
                    <label className="btn secondary" style={{ cursor: "pointer" }}>
                      Replace file
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: "none" }}
                        disabled={busy}
                        onChange={(e) => {
                          const next = e.target.files?.[0];
                          e.target.value = "";
                          if (next) void replace(list, next);
                        }}
                      />
                    </label>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => remove(list)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
