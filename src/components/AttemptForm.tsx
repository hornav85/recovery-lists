"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ATTEMPT_OUTCOMES } from "@/lib/statuses";

export function AttemptForm({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string>(ATTEMPT_OUTCOMES[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, outcome, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }
      setNotes("");
      router.refresh();
      if (outcome === "Recovered" || outcome === "DNC") {
        router.push("/lists");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label className="field">
        Outcome
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {ATTEMPT_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Timestamp and your display name are stamped automatically on save. Attempts stay in SQLite
        only — never written to Google Sheets.
      </p>
      {error && <div className="error">{error}</div>}
      <button className="btn" type="submit" disabled={saving}>
        {saving ? "Saving…" : "Log attempt"}
      </button>
    </form>
  );
}
