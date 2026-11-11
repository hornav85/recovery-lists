import fs from "fs";
import { COL, rowFromCells, type LeadRow } from "./columns";
import { sql } from "./db";
import { FIXTURE_DATABASE_CSV, FIXTURE_DNC_CSV } from "./fixture-data";
import { normalizeStatus } from "./statuses";
import { prospectKey } from "./prospect";

export type SyncResult = {
  mode: "google" | "apps-script" | "fixture" | "csv";
  rowsUpserted: number;
  dncMarked: number;
  lastSyncAt: string;
  message: string;
};

type SheetObject = Record<string, string>;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((c) => c.trim() !== "")) rows.push(cur);
      cur = [];
    } else {
      field += ch;
    }
  }
  cur.push(field);
  if (cur.some((c) => c.trim() !== "")) rows.push(cur);
  return rows;
}

function cellsToLeadRows(rows: string[][], hasHeader = true): LeadRow[] {
  const start = hasHeader ? 1 : 0;
  const out: LeadRow[] = [];
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.every((c) => !c.trim())) continue;
    out.push(rowFromCells(cells, i + 1));
  }
  return out;
}

/** Normalize header text for fuzzy matching. */
function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/__\d+$/, "")
    .replace(/^__col_\d+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Preferred Database header aliases → column index (COL.*).
 * Matches New 2026 Dashboard labels from the plan.
 */
const HEADER_TO_COL: Array<{ col: number; aliases: string[] }> = [
  { col: COL.DATE, aliases: ["date"] },
  { col: COL.TEAM, aliases: ["team"] },
  { col: COL.NAME, aliases: ["name of the client", "name", "client", "client name"] },
  { col: COL.ADDRESS, aliases: ["adress", "address"] },
  { col: COL.MEETING_TIME, aliases: ["meeting time date", "meeting time", "meeting time + date"] },
  { col: COL.PROJECT, aliases: ["project"] },
  { col: COL.CELL, aliases: ["cell", "phone", "mobile"] },
  { col: COL.AGENT, aliases: ["agent"] },
  { col: COL.WELCOME_CALL, aliases: ["welcome call"] },
  { col: COL.CONFIRMED, aliases: ["confirmed"] },
  { col: COL.SOURCE, aliases: ["source"] },
  { col: COL.LANGUAGE, aliases: ["language"] },
  { col: COL.SENT, aliases: ["sent"] },
  { col: COL.STATUS_LOWER, aliases: ["status"] }, // first "status" column (index 13); see below for W
  { col: COL.PAID, aliases: ["paid", "paid?"] },
  { col: COL.NOTES, aliases: ["notes"] },
  { col: COL.OWNERSHIP, aliases: ["ownership"] },
  {
    col: COL.NOTES_FOLLOWUPS,
    aliases: [
      "notes and follow ups responses",
      "notes and follow ups / responses",
      "notes and follow ups",
      "notes follow ups",
      "notes and followups",
      "follow ups",
      "follow-ups",
      "followups",
      "responses",
    ],
  },
  { col: COL.RECOVERY_AGENT, aliases: ["recovery agent"] },
  { col: COL.CHALLENGE, aliases: ["challenge"] },
  { col: COL.SALES_AMOUNT, aliases: ["sales amount"] },
  { col: COL.STATUS, aliases: ["status"] }, // column W — prefer last match
  { col: COL.MEETING_ID, aliases: ["meeting id"] },
  { col: COL.CALENDAR_EVENT_ID, aliases: ["calendar event id"] },
  { col: COL.PROSPECT_ID, aliases: ["prospect id"] },
  { col: COL.LEAD_ID, aliases: ["lead id"] },
  { col: COL.APPOINTMENT_DATE, aliases: ["appointment date"] },
];

function mapHeaderToCol(rawKey: string, statusOrdinal: { n: number }): number | null {
  if (rawKey.startsWith("__col_")) {
    const colIdx = Number(rawKey.slice("__col_".length));
    return Number.isFinite(colIdx) ? colIdx : null;
  }
  const n = normHeader(rawKey);
  if (!n) return null;
  if (n === "status") {
    // First "status" → col 13; later → col 22 (list membership / column W)
    statusOrdinal.n += 1;
    return statusOrdinal.n === 1 ? COL.STATUS_LOWER : COL.STATUS;
  }
  for (const map of HEADER_TO_COL) {
    if (map.col === COL.STATUS || map.col === COL.STATUS_LOWER) continue;
    if (map.aliases.some((a) => normHeader(a) === n)) return map.col;
  }
  return null;
}

function objectsToLeadRows(objects: SheetObject[]): LeadRow[] {
  const width = Math.max(...Object.values(COL).map((n) => n)) + 1;
  const out: LeadRow[] = [];
  objects.forEach((obj, idx) => {
    const cells = new Array(width).fill("");
    const mapped = new Array(width).fill(false);
    const statusOrdinal = { n: 0 };
    const keys = Object.keys(obj);

    keys.forEach((key) => {
      const val = obj[key] ?? "";
      const col = mapHeaderToCol(key, statusOrdinal);
      if (col != null && col >= 0 && col < width) {
        cells[col] = val;
        mapped[col] = true;
      }
    });

    // Fill unmapped columns by insertion order (sheet column order)
    keys.forEach((key, keyIndex) => {
      if (keyIndex >= width || mapped[keyIndex]) return;
      cells[keyIndex] = obj[key] ?? "";
    });

    // Single status column → treat as list Status (W)
    if (statusOrdinal.n === 1 && cells[COL.STATUS_LOWER] && !cells[COL.STATUS]) {
      cells[COL.STATUS] = cells[COL.STATUS_LOWER];
    }
    if (cells.every((c) => !String(c).trim())) return;
    out.push(rowFromCells(cells, idx + 2)); // +2 ≈ sheet row (header is 1)
  });
  return out;
}

async function upsertLeads(leads: LeadRow[], dncKeys: Set<string>) {
  const insertSql = `
    INSERT INTO leads (
      sheet_row_index, prospect_key, prospect_id, lead_id, phone, name, address,
      status, date_col, appointment_date, meeting_time, team, project, agent,
      source, language, notes, notes_followups, ownership, recovery_agent,
      challenge, sales_amount, meeting_id, calendar_event_id, welcome_call,
      confirmed, paid, is_dnc, raw_json, synced_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25,
      $26, $27, $28, $29, CURRENT_TIMESTAMP
    )
    ON CONFLICT (sheet_row_index, prospect_key) DO UPDATE SET
      prospect_id = EXCLUDED.prospect_id,
      lead_id = EXCLUDED.lead_id,
      phone = EXCLUDED.phone,
      name = EXCLUDED.name,
      address = EXCLUDED.address,
      status = EXCLUDED.status,
      date_col = EXCLUDED.date_col,
      appointment_date = EXCLUDED.appointment_date,
      meeting_time = EXCLUDED.meeting_time,
      team = EXCLUDED.team,
      project = EXCLUDED.project,
      agent = EXCLUDED.agent,
      source = EXCLUDED.source,
      language = EXCLUDED.language,
      notes = EXCLUDED.notes,
      notes_followups = EXCLUDED.notes_followups,
      ownership = EXCLUDED.ownership,
      recovery_agent = EXCLUDED.recovery_agent,
      challenge = EXCLUDED.challenge,
      sales_amount = EXCLUDED.sales_amount,
      meeting_id = EXCLUDED.meeting_id,
      calendar_event_id = EXCLUDED.calendar_event_id,
      welcome_call = EXCLUDED.welcome_call,
      confirmed = EXCLUDED.confirmed,
      paid = EXCLUDED.paid,
      is_dnc = EXCLUDED.is_dnc,
      raw_json = EXCLUDED.raw_json,
      synced_at = CURRENT_TIMESTAMP
  `;

  let upserted = 0;
  let dncMarked = 0;
  for (const row of leads) {
    const key = prospectKey(row);
    const status = normalizeStatus(row.status || row.statusLower);
    const phoneDigits = (row.cell || "").replace(/\D/g, "");
    const isDnc =
      dncKeys.has(key) ||
      dncKeys.has(`phone:${phoneDigits}`) ||
      (row.prospectId && dncKeys.has(`pid:${row.prospectId}`)) ||
      status.toUpperCase() === "DNC"
        ? 1
        : 0;
    if (isDnc) dncMarked++;
    await sql(insertSql, [
      row.sheetRowIndex,
      key,
      row.prospectId || null,
      row.leadId || null,
      row.cell || null,
      row.name || null,
      row.address || null,
      status,
      row.date || null,
      row.appointmentDate || null,
      row.meetingTime || null,
      row.team || null,
      row.project || null,
      row.agent || null,
      row.source || null,
      row.language || null,
      row.notes || null,
      row.notesFollowups || null,
      row.ownership || null,
      row.recoveryAgent || null,
      row.challenge || null,
      row.salesAmount || null,
      row.meetingId || null,
      row.calendarEventId || null,
      row.welcomeCall || null,
      row.confirmed || null,
      row.paid || null,
      isDnc,
      JSON.stringify(row),
    ]);
    upserted++;
  }
  return { upserted, dncMarked };
}

function parseDncKeys(rows: string[][], hasHeader = true): Set<string> {
  const keys = new Set<string>();
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const phone = (r[1] || "").replace(/\D/g, "");
    const pid = (r[2] || "").trim();
    if (pid) keys.add(`pid:${pid}`);
    if (phone.length >= 7) keys.add(`phone:${phone}`);
  }
  return keys;
}

function parseDncKeysFromObjects(objects: SheetObject[]): Set<string> {
  const keys = new Set<string>();
  for (const obj of objects) {
    let phone = "";
    let pid = "";
    for (const [k, v] of Object.entries(obj)) {
      const n = normHeader(k);
      if (n === "phone" || n === "cell" || n === "mobile") phone = (v || "").replace(/\D/g, "");
      if (n === "prospect id" || n === "prospectid") pid = (v || "").trim();
    }
    // Positional fallback: Name, Phone, Prospect ID
    if (!phone || !pid) {
      const vals = Object.values(obj);
      if (!phone && vals[1]) phone = String(vals[1]).replace(/\D/g, "");
      if (!pid && vals[2]) pid = String(vals[2]).trim();
    }
    if (pid) keys.add(`pid:${pid}`);
    if (phone.length >= 7) keys.add(`phone:${phone}`);
  }
  return keys;
}

async function setSyncMeta(mode: string, message: string) {
  const now = new Date().toISOString();
  const upsertSql = `INSERT INTO sync_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  await sql(upsertSql, ["last_sync_at", now]);
  await sql(upsertSql, ["last_sync_mode", mode]);
  await sql(upsertSql, ["last_sync_message", message]);
  return now;
}

export async function getSyncMeta() {
  const get = async (key: string) => {
    const rows = await sql<{ value: string }>("SELECT value FROM sync_meta WHERE key = $1", [
      key,
    ]);
    return rows[0]?.value ?? null;
  };
  return {
    lastSyncAt: await get("last_sync_at"),
    lastSyncMode: await get("last_sync_mode"),
    lastSyncMessage: await get("last_sync_message"),
  };
}

export function getSyncConfig() {
  const rawUrl = process.env.SHEETS_APPS_SCRIPT_URL || "";
  const urlInfo = describeAppsScriptUrlSecret(rawUrl);
  const appsScriptToken = normalizeAppsScriptToken(process.env.SHEETS_APPS_SCRIPT_TOKEN || "");
  return {
    spreadsheetId:
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
      "1G_H_4ETKhtXglDR41c6gYdX6uTJ32ZYmBsz4DTwc7Bw",
    hasServiceAccount: Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim() &&
        fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE.trim())
    ),
    hasAppsScript: Boolean(urlInfo.valid && appsScriptToken),
    appsScriptUrlConfigured: urlInfo.configured,
    appsScriptUrlValid: urlInfo.valid,
    appsScriptUrlHint: urlInfo.hint,
    appsScriptUrlLength: urlInfo.length,
    appsScriptTokenConfigured: Boolean(appsScriptToken),
  };
}

function fixturesAllowed(): boolean {
  return !(
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.CURSOR_APP_ID?.trim()) ||
    Boolean(process.env.VERCEL)
  );
}

async function fixtureOrUnavailable(prefix?: string): Promise<SyncResult> {
  if (!fixturesAllowed()) {
    const message =
      (prefix ? `${prefix}; ` : "") +
      "sample data is disabled on the hosted app — paste CSV or configure Apps Script";
    const lastSyncAt = await setSyncMeta("csv", message);
    return { mode: "csv", rowsUpserted: 0, dncMarked: 0, lastSyncAt, message };
  }
  const result = await loadFixtureIntoDb();
  if (!prefix) return result;
  return { ...result, message: `${prefix}; ${result.message}` };
}

export async function loadFixtureIntoDb(): Promise<SyncResult> {
  if (!fixturesAllowed()) {
    throw new Error("Sample data load is disabled on the hosted app");
  }
  const dbText = FIXTURE_DATABASE_CSV;
  const dncText = FIXTURE_DNC_CSV;
  const leads = cellsToLeadRows(parseCsv(dbText), true);
  const dncKeys = dncText ? parseDncKeys(parseCsv(dncText), true) : new Set<string>();
  const { upserted, dncMarked } = await upsertLeads(leads, dncKeys);
  const message = `Loaded ${upserted} fixture Database rows (${dncMarked} DNC-flagged)`;
  const lastSyncAt = await setSyncMeta("fixture", message);
  return { mode: "fixture", rowsUpserted: upserted, dncMarked, lastSyncAt, message };
}

export async function syncFromCsvText(
  databaseCsv: string,
  dncCsv?: string
): Promise<SyncResult> {
  const leads = cellsToLeadRows(parseCsv(databaseCsv), true);
  const dncKeys = dncCsv ? parseDncKeys(parseCsv(dncCsv), true) : new Set<string>();
  const { upserted, dncMarked } = await upsertLeads(leads, dncKeys);
  const message = `Parsed pasted CSV: ${upserted} rows (${dncMarked} DNC-flagged)`;
  const lastSyncAt = await setSyncMeta("csv", message);
  return { mode: "csv", rowsUpserted: upserted, dncMarked, lastSyncAt, message };
}

export async function syncFromAppsScriptPayload(payload: {
  database?: SheetObject[];
  dnc?: SheetObject[];
  updatedAt?: string;
}): Promise<SyncResult> {
  const database = Array.isArray(payload.database) ? payload.database : [];
  const dnc = Array.isArray(payload.dnc) ? payload.dnc : [];
  const leads = objectsToLeadRows(database);
  const dncKeys = parseDncKeysFromObjects(dnc);
  const { upserted, dncMarked } = await upsertLeads(leads, dncKeys);
  const message = `Apps Script sync: ${upserted} Database rows (${dncMarked} DNC-flagged)${
    payload.updatedAt ? `; sheet updatedAt ${payload.updatedAt}` : ""
  }`;
  const lastSyncAt = await setSyncMeta("apps-script", message);
  return { mode: "apps-script", rowsUpserted: upserted, dncMarked, lastSyncAt, message };
}

/** Normalize a Cursor secret / .env value into a usable Web app URL. */
export function normalizeAppsScriptUrl(raw: string): string {
  let s = raw.trim();
  // Invisible / copy junk
  s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Whole env line pasted by mistake
  s = s.replace(/^SHEETS_APPS_SCRIPT_URL\s*=\s*/i, "").trim();
  // Surrounding quotes / angle brackets from secret forms / markdown
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("<") && s.endsWith(">"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Accidental newlines / second line of paste
  s = s.split(/\r?\n/)[0]?.trim() || "";
  // Host pasted without scheme (very common)
  if (/^(script\.google\.com|www\.google\.com)\//i.test(s)) {
    s = `https://${s}`;
  }
  return s;
}

/** Safe (non-secret) hints for Admin → Sync when the URL secret is wrong. */
export function describeAppsScriptUrlSecret(raw: string): {
  configured: boolean;
  valid: boolean;
  length: number;
  hint: string;
} {
  const normalized = normalizeAppsScriptUrl(raw);
  if (!normalized) {
    return { configured: false, valid: false, length: 0, hint: "missing" };
  }
  const length = normalized.length;
  // Spreadsheet IDs look like long base64ish tokens with no scheme
  if (/^[1-9A-Za-z_-]{30,}$/.test(normalized) && !normalized.includes("/")) {
    return {
      configured: true,
      valid: false,
      length,
      hint: "looks like a spreadsheet ID — need the Web app URL ending in /exec",
    };
  }
  if (!/^https?:\/\//i.test(normalized) && !normalized.includes("script.google.com")) {
    return {
      configured: true,
      valid: false,
      length,
      hint: "not a URL — paste the Deploy → Web app link (https://script.google.com/…/exec)",
    };
  }
  try {
    const u = new URL(normalized);
    const endsExec = /\/exec\/?$/.test(u.pathname);
    const isHttps = u.protocol === "https:";
    const isScriptHost = /(^|\.)script\.google\.com$/i.test(u.hostname);
    if (!isHttps) {
      return { configured: true, valid: false, length, hint: "must start with https://" };
    }
    if (!isScriptHost) {
      return {
        configured: true,
        valid: false,
        length,
        hint: `host is ${u.hostname} — expected script.google.com …/exec`,
      };
    }
    if (!endsExec) {
      return {
        configured: true,
        valid: false,
        length,
        hint: "path must end with /exec (not the Apps Script editor link)",
      };
    }
    return { configured: true, valid: true, length, hint: "ok" };
  } catch {
    return {
      configured: true,
      valid: false,
      length,
      hint: "could not parse as a URL — re-save the full https …/exec link with no quotes",
    };
  }
}

/** Normalize token secret the same way as URL (quotes / env-line paste). */
export function normalizeAppsScriptToken(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/^SHEETS_APPS_SCRIPT_TOKEN\s*=\s*/i, "").trim();
  s = s.replace(/^SYNC_TOKEN\s*=\s*/i, "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("<") && s.endsWith(">"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.split(/\r?\n/)[0]?.trim() || "";
  return s;
}

async function fetchAppsScriptJson(): Promise<{
  database: SheetObject[];
  dnc: SheetObject[];
  updatedAt?: string;
} | null> {
  const base = normalizeAppsScriptUrl(process.env.SHEETS_APPS_SCRIPT_URL || "");
  const token = normalizeAppsScriptToken(process.env.SHEETS_APPS_SCRIPT_TOKEN || "");
  if (!base || !token) return null;

  const info = describeAppsScriptUrlSecret(base);
  if (!info.valid) {
    throw new Error(
      `Invalid Apps Script URL (${info.hint}). Re-save SHEETS_APPS_SCRIPT_URL in Cursor Secrets as the Deploy → Web app https …/exec link, then republish.`,
    );
  }
  const url = new URL(base);
  // Drop any pasted ?token=…; we always attach the bound secret token
  url.search = "";
  url.searchParams.set("token", token);

  const res = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const text = await res.text();
  let data: {
    database?: SheetObject[];
    dnc?: SheetObject[];
    updatedAt?: string;
    error?: string;
    status?: number;
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status})`);
  }

  if (!res.ok || data.error || data.status === 401) {
    const err = data.error || `Apps Script HTTP ${res.status}`;
    if (data.status === 401 || /unauthorized/i.test(err) || res.status === 401) {
      throw new Error(
        "Unauthorized — SHEETS_APPS_SCRIPT_TOKEN does not match Apps Script SYNC_TOKEN. Copy the exact SHEETS_APPS_SCRIPT_TOKEN value from Project Context apps/recovery-lists/.env.local into https://cursor.com/dashboard/apps → recovery-lists → Secrets (don’t paste it in chat), then republish.",
      );
    }
    throw new Error(err);
  }

  return {
    database: Array.isArray(data.database) ? data.database : [],
    dnc: Array.isArray(data.dnc) ? data.dnc : [],
    updatedAt: data.updatedAt,
  };
}

async function fetchGoogleSheets(): Promise<{
  database: string[][];
  dnc: string[][];
} | null> {
  const spreadsheetId =
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    "1G_H_4ETKhtXglDR41c6gYdX6uTJ32ZYmBsz4DTwc7Bw";
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  if (!keyFile || !fs.existsSync(keyFile)) return null;

  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // READ ONLY — spreadsheets.values.get only
  const [dbRes, dncRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "Database" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "DNC" }).catch(() => null),
  ]);

  return {
    database: (dbRes.data.values as string[][]) || [],
    dnc: (dncRes?.data.values as string[][]) || [],
  };
}

export async function runSync(opts?: {
  csvDatabase?: string;
  csvDnc?: string;
  forceFixture?: boolean;
}): Promise<SyncResult> {
  if (opts?.csvDatabase) {
    return syncFromCsvText(opts.csvDatabase, opts.csvDnc);
  }
  if (opts?.forceFixture) {
    return fixtureOrUnavailable();
  }

  // Prefer Apps Script bridge (no Cloud billing) when configured
  try {
    const apps = await fetchAppsScriptJson();
    if (apps) {
      return syncFromAppsScriptPayload(apps);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If service account also unavailable, fall through to fixture with note
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
    const hasSa = Boolean(keyFile && fs.existsSync(keyFile));
    if (!hasSa) {
      return fixtureOrUnavailable(
        `Apps Script sync failed (${msg})`,
      );
    }
    // else try google SA below
  }

  try {
    const remote = await fetchGoogleSheets();
    if (remote) {
      const leads = cellsToLeadRows(remote.database, true);
      const dncKeys = parseDncKeys(remote.dnc, true);
      const { upserted, dncMarked } = await upsertLeads(leads, dncKeys);
      const message = `Google Sheets read-only sync: ${upserted} rows (${dncMarked} DNC-flagged)`;
      const lastSyncAt = await setSyncMeta("google", message);
      return { mode: "google", rowsUpserted: upserted, dncMarked, lastSyncAt, message };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fixtureOrUnavailable(`Google sync failed (${msg})`);
  }

  return fixtureOrUnavailable();
}

/** Exported for unit-style checks without a live deploy. */
export const __test = {
  objectsToLeadRows,
  parseDncKeysFromObjects,
  syncFromAppsScriptPayload,
};
