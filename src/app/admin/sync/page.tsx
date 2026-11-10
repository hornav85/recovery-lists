"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { PublicUser } from "@/lib/db";

type SyncMeta = {
  lastSyncAt: string | null;
  lastSyncMode: string | null;
  lastSyncMessage: string | null;
  spreadsheetId: string;
  hasServiceAccount: boolean;
  hasAppsScript: boolean;
  appsScriptUrlConfigured: boolean;
  appsScriptTokenConfigured: boolean;
  preferredMode: string;
};

export default function AdminSyncPage() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [meta, setMeta] = useState<SyncMeta | null>(null);
  const [csvDatabase, setCsvDatabase] = useState("");
  const [csvDnc, setCsvDnc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

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
    const res = await fetch("/api/admin/sync");
    setMeta(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function sync(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync failed");
        return;
      }
      setMsg(data.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onCsv(e: FormEvent) {
    e.preventDefault();
    await sync({ csvDatabase, csvDnc: csvDnc || undefined });
  }

  if (!me) return <div className="container muted">Loading…</div>;

  return (
    <AppShell user={me}>
      <h1>Sync</h1>
      <p className="muted">
        Pull is <strong>read-only</strong>. Preferred path: Apps Script web app (no Cloud billing, sheet
        stays private). CSV paste remains as a manual fallback. The app never writes cells.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <div className="card">
        <h2>Status</h2>
        <dl className="dl">
          <dt>Last sync</dt>
          <dd>{meta?.lastSyncAt || "never"}</dd>
          <dt>Mode</dt>
          <dd>{meta?.lastSyncMode || "—"}</dd>
          <dt>Message</dt>
          <dd>{meta?.lastSyncMessage || "—"}</dd>
          <dt>Spreadsheet</dt>
          <dd style={{ fontFamily: "var(--mono)", fontSize: "0.85rem" }}>
            {meta?.spreadsheetId}
          </dd>
          <dt>Apps Script</dt>
          <dd>
            {meta?.hasAppsScript ? (
              <span className="badge ok">configured — Sync now uses live JSON</span>
            ) : (
              <span className="badge warn">
                not set — add SHEETS_APPS_SCRIPT_URL + SHEETS_APPS_SCRIPT_TOKEN
                {!meta?.appsScriptUrlConfigured && meta?.appsScriptTokenConfigured
                  ? " (URL missing)"
                  : ""}
                {meta?.appsScriptUrlConfigured && !meta?.appsScriptTokenConfigured
                  ? " (token missing)"
                  : ""}
              </span>
            )}
          </dd>
          <dt>Service account</dt>
          <dd>
            {meta?.hasServiceAccount ? (
              <span className="badge ok">configured (optional fallback)</span>
            ) : (
              <span className="muted">not used for Apps Script path</span>
            )}
          </dd>
          <dt>Preferred</dt>
          <dd>{meta?.preferredMode || "—"}</dd>
        </dl>
        <div className="row" style={{ marginTop: "1rem" }}>
          <button className="btn" type="button" disabled={busy} onClick={() => sync({})}>
            Sync now
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={() => sync({ forceFixture: true })}
          >
            Reload fixtures
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: "0.75rem", fontSize: "0.85rem" }}>
          Deploy guide: Project docs → <code>recovery-lists-apps-script-deploy.md</code>
        </p>
      </div>

      <div className="card">
        <h2>Paste Database CSV (fallback)</h2>
        <p className="muted">
          Still works if Apps Script is not configured or the fetch fails. Paste an export of the
          Database tab (header row included). Optional DNC CSV below.
        </p>
        <form className="stack" onSubmit={onCsv}>
          <label className="field">
            Database CSV
            <textarea
              value={csvDatabase}
              onChange={(e) => setCsvDatabase(e.target.value)}
              required
              style={{ minHeight: 160, fontFamily: "var(--mono)", fontSize: "0.8rem" }}
            />
          </label>
          <label className="field">
            DNC CSV (optional)
            <textarea
              value={csvDnc}
              onChange={(e) => setCsvDnc(e.target.value)}
              style={{ minHeight: 80, fontFamily: "var(--mono)", fontSize: "0.8rem" }}
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Parse &amp; upsert CSV
          </button>
        </form>
      </div>
    </AppShell>
  );
}
