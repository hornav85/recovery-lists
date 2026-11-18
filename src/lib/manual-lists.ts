import {
  type AttemptBucketId,
  bucketForCount,
  countInBucket,
} from "./attempts";
import { sql, type PublicUser } from "./db";
import { fieldMatchesQuery } from "./queue-filters";
import { outcomeHiddenNow } from "./statuses";
import { pacificYmd } from "./time";

export type ManualListSummary = {
  id: number;
  name: string;
  columns: string[];
  rowCount: number;
  updatedAt: string;
  assignedAgents: string[];
};

export type ManualAttempt = {
  id: number;
  row_id: number | null;
  list_id: number | null;
  list_name: string;
  prospect_key: string;
  outcome: string;
  notes: string | null;
  agent_user_id: number;
  agent_display_name: string;
  created_at: string;
};

export type ManualRow = {
  id: number;
  list_id: number;
  prospect_key: string;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
};

export type ManualQueueRow = ManualRow & {
  attempt_count: number;
  attempt_bucket: AttemptBucketId;
  latest_attempt: ManualAttempt | null;
};

const NAME_HEADERS = new Set([
  "name",
  "full name",
  "client",
  "client name",
  "prospect",
  "prospect name",
  "customer",
  "customer name",
  "contact",
  "contact name",
]);

const PHONE_HEADERS = new Set([
  "phone",
  "phone number",
  "mobile",
  "cell",
  "cell phone",
  "telephone",
  "tel",
  "primary phone",
]);

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isPhoneColumn(header: string): boolean {
  return PHONE_HEADERS.has(normHeader(header));
}

export function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
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
      if (ch === "\r" && src[i + 1] === "\n") i++;
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

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const key = base.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function pickColumn(headers: string[], aliases: Set<string>, fallback?: number): number {
  const idx = headers.findIndex((h) => aliases.has(normHeader(h)));
  if (idx >= 0) return idx;
  return fallback ?? -1;
}

export type ParsedUpload = {
  columns: string[];
  nameIndex: number;
  phoneIndex: number;
  rows: Array<{ name: string; phone: string; phoneKey: string; fields: Record<string, string> }>;
  skipped: number;
};

export function parseManualCsv(text: string): ParsedUpload | { error: string } {
  const grid = parseCsv(text);
  if (grid.length < 2) {
    return { error: "The file needs a header row and at least one prospect." };
  }
  const columns = uniqueHeaders(grid[0]);
  let phoneIndex = pickColumn(columns, PHONE_HEADERS);
  if (phoneIndex < 0) {
    const scores = columns.map((_, col) => {
      let hits = 0;
      let seen = 0;
      for (let r = 1; r < grid.length && seen < 25; r++) {
        const value = (grid[r][col] || "").trim();
        if (!value) continue;
        seen++;
        if (phoneDigits(value).length >= 7) hits++;
      }
      return seen > 0 && hits / seen >= 0.6 ? hits : 0;
    });
    const best = scores.reduce((top, n, i) => (n > scores[top] ? i : top), 0);
    if (scores[best] > 0) phoneIndex = best;
  }
  if (phoneIndex < 0) {
    return {
      error: "Could not find a phone column. Use a header like Phone, Mobile, or Cell.",
    };
  }
  let nameIndex = pickColumn(columns, NAME_HEADERS);
  if (nameIndex < 0 || nameIndex === phoneIndex) {
    nameIndex = columns.findIndex((_, i) => i !== phoneIndex);
  }
  if (nameIndex < 0) {
    return { error: "Could not find a name column." };
  }

  const rows: ParsedUpload["rows"] = [];
  const seenPhones = new Set<string>();
  let skipped = 0;
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const name = (cells[nameIndex] || "").trim();
    const phone = (cells[phoneIndex] || "").trim();
    const phoneKey = phoneDigits(phone);
    if (!name || phoneKey.length < 7) {
      skipped++;
      continue;
    }
    if (seenPhones.has(phoneKey)) {
      skipped++;
      continue;
    }
    seenPhones.add(phoneKey);
    const fields: Record<string, string> = {};
    columns.forEach((header, i) => {
      fields[header] = (cells[i] || "").trim();
    });
    rows.push({ name, phone, phoneKey, fields });
  }
  if (rows.length === 0) {
    return { error: "No rows had both a name and a phone number." };
  }
  return { columns, nameIndex, phoneIndex, rows, skipped };
}

function parseFields(raw: string | null): Record<string, string> {
  try {
    const value = JSON.parse(raw || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) out[k] = v == null ? "" : String(v);
    return out;
  } catch {
    return {};
  }
}

type RowDb = {
  id: number;
  list_id: number;
  prospect_key: string;
  name: string | null;
  phone: string | null;
  fields_json: string;
};

function toManualRow(row: RowDb): ManualRow {
  return {
    id: row.id,
    list_id: row.list_id,
    prospect_key: row.prospect_key,
    name: row.name,
    phone: row.phone,
    fields: parseFields(row.fields_json),
  };
}

export async function listManualLists(): Promise<ManualListSummary[]> {
  const lists = await sql<{
    id: number;
    name: string;
    columns_json: string;
    updated_at: string;
    row_count: string | number;
  }>(
    `SELECT l.id, l.name, l.columns_json, l.updated_at,
            (SELECT COUNT(*) FROM manual_list_rows r WHERE r.list_id = l.id) AS row_count
     FROM manual_lists l
     ORDER BY l.name`,
  );
  const assigned = await sql<{ list_id: number; display_name: string }>(
    `SELECT a.list_id, u.display_name
     FROM manual_list_assignments a
     JOIN users u ON u.id = a.user_id
     WHERE u.deleted_at IS NULL
     ORDER BY u.display_name`,
  );
  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    columns: JSON.parse(list.columns_json || "[]") as string[],
    rowCount: Number(list.row_count || 0),
    updatedAt: list.updated_at,
    assignedAgents: assigned.filter((a) => a.list_id === list.id).map((a) => a.display_name),
  }));
}

export async function uploadManualList(input: {
  name: string;
  csv: string;
  replaceId?: number | null;
}): Promise<
  | { ok: true; listId: number; name: string; imported: number; skipped: number; replaced: boolean }
  | { ok: false; error: string; status: number }
> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) {
    return { ok: false, error: "List name is required (80 characters max).", status: 400 };
  }
  const parsed = parseManualCsv(input.csv);
  if ("error" in parsed) return { ok: false, error: parsed.error, status: 400 };

  const replaceId = input.replaceId && Number.isFinite(input.replaceId) ? input.replaceId : null;
  const existing = (
    await sql<{ id: number; name: string }>(
      "SELECT id, name FROM manual_lists WHERE LOWER(name) = LOWER($1)",
      [name],
    )
  )[0];
  if (existing && existing.id !== replaceId) {
    return {
      ok: false,
      error: `A list named “${existing.name}” already exists. Replace that list, or use a different name.`,
      status: 409,
    };
  }
  if (replaceId) {
    const target = (
      await sql<{ id: number }>("SELECT id FROM manual_lists WHERE id = $1", [replaceId])
    )[0];
    if (!target) return { ok: false, error: "That list no longer exists.", status: 404 };
  }

  let listId = replaceId;
  if (!listId) {
    const inserted = await sql<{ id: number }>(
      `INSERT INTO manual_lists (name, columns_json, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       RETURNING id`,
      [name, JSON.stringify(parsed.columns), new Date().toISOString()],
    );
    listId = inserted[0].id;
  } else {
    await sql(
      `UPDATE manual_lists SET name = $1, columns_json = $2, updated_at = $3 WHERE id = $4`,
      [name, JSON.stringify(parsed.columns), new Date().toISOString(), listId],
    );
    await sql("DELETE FROM manual_list_rows WHERE list_id = $1", [listId]);
  }

  for (const row of parsed.rows) {
    const inserted = await sql<{ id: number }>(
      `INSERT INTO manual_list_rows (list_id, prospect_key, name, phone, fields_json)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [listId, row.phoneKey, row.name, row.phone, JSON.stringify(row.fields)],
    );
    await sql(
      `UPDATE manual_attempts
       SET row_id = $1, list_name = $2
       WHERE list_id = $3 AND prospect_key = $4`,
      [inserted[0].id, name, listId, row.phoneKey],
    );
  }

  return {
    ok: true,
    listId,
    name,
    imported: parsed.rows.length,
    skipped: parsed.skipped,
    replaced: Boolean(replaceId),
  };
}

export async function deleteManualList(listId: number): Promise<boolean> {
  const rows = await sql<{ id: number }>("DELETE FROM manual_lists WHERE id = $1 RETURNING id", [
    listId,
  ]);
  return Boolean(rows[0]);
}

export async function getAssignedManualLists(userId: number, role: string) {
  if (role === "admin") {
    return sql<{ id: number; name: string; columns_json: string }>(
      `SELECT id, name, columns_json FROM manual_lists ORDER BY name`,
    );
  }
  return sql<{ id: number; name: string; columns_json: string }>(
    `SELECT l.id, l.name, l.columns_json
     FROM manual_lists l
     JOIN manual_list_assignments a ON a.list_id = l.id
     WHERE a.user_id = $1
     ORDER BY l.name`,
    [userId],
  );
}

async function attemptsForList(listId: number): Promise<Map<string, ManualAttempt[]>> {
  const rows = await sql<ManualAttempt>(
    `SELECT * FROM manual_attempts WHERE list_id = $1 ORDER BY created_at DESC, id DESC`,
    [listId],
  );
  const map = new Map<string, ManualAttempt[]>();
  for (const row of rows) {
    const list = map.get(row.prospect_key) || [];
    list.push(row);
    map.set(row.prospect_key, list);
  }
  return map;
}

export async function getManualQueue(
  listId: number,
  attemptBucket?: AttemptBucketId | null,
): Promise<{ columns: string[]; queue: ManualQueueRow[] }> {
  const lists = await sql<{ columns_json: string }>(
    "SELECT columns_json FROM manual_lists WHERE id = $1",
    [listId],
  );
  const columns = JSON.parse(lists[0]?.columns_json || "[]") as string[];
  const rows = await sql<RowDb>(
    "SELECT * FROM manual_list_rows WHERE list_id = $1",
    [listId],
  );
  const attempts = await attemptsForList(listId);
  const queue: ManualQueueRow[] = [];
  for (const row of rows) {
    const history = attempts.get(row.prospect_key) || [];
    const latest = history[0] || null;
    if (latest && outcomeHiddenNow(latest.outcome, latest.created_at)) continue;
    const attempt_count = new Set(
      history.map((attempt) => pacificYmd(new Date(attempt.created_at))),
    ).size;
    queue.push({
      ...toManualRow(row),
      attempt_count,
      attempt_bucket: bucketForCount(attempt_count),
      latest_attempt: latest,
    });
  }
  queue.sort((a, b) => {
    if (a.attempt_count !== b.attempt_count) return a.attempt_count - b.attempt_count;
    return (a.name || "").localeCompare(b.name || "");
  });
  const filtered = attemptBucket
    ? queue.filter((row) => countInBucket(row.attempt_count, attemptBucket))
    : queue;
  return { columns, queue: filtered };
}

export type ManualSearchHit = ManualQueueRow & { listName: string };

export function manualRowMatchesSearch(
  row: { name: string | null; phone: string | null; fields: Record<string, string> },
  rawQuery: string,
): boolean {
  const query = rawQuery.trim();
  if (!query) return true;
  const values = [row.name || "", row.phone || "", ...Object.values(row.fields)];
  return values.some((value) => value.trim() !== "" && fieldMatchesQuery(value, query));
}

/** Visible rows on every additional list, same visibility rules as each list queue. */
export async function searchVisibleManualRows(rawQuery: string): Promise<ManualSearchHit[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const lists = await sql<{ id: number; name: string }>(
    "SELECT id, name FROM manual_lists ORDER BY name",
  );
  const hits: ManualSearchHit[] = [];
  for (const list of lists) {
    const { queue } = await getManualQueue(list.id);
    for (const row of queue) {
      if (manualRowMatchesSearch(row, query)) hits.push({ ...row, listName: list.name });
    }
  }
  return hits;
}

export async function manualQueueCount(listName: string): Promise<number> {
  const list = (
    await sql<{ id: number }>("SELECT id FROM manual_lists WHERE name = $1", [listName])
  )[0];
  if (!list) return 0;
  const { queue } = await getManualQueue(list.id);
  return queue.length;
}

export async function getManualRowDetail(rowId: number) {
  const rows = await sql<RowDb>("SELECT * FROM manual_list_rows WHERE id = $1", [rowId]);
  const row = rows[0];
  if (!row) return null;
  const lists = await sql<{ id: number; name: string; columns_json: string }>(
    "SELECT id, name, columns_json FROM manual_lists WHERE id = $1",
    [row.list_id],
  );
  const list = lists[0];
  if (!list) return null;
  const attempts = await sql<ManualAttempt>(
    `SELECT * FROM manual_attempts
     WHERE list_id = $1 AND prospect_key = $2
     ORDER BY created_at DESC, id DESC`,
    [row.list_id, row.prospect_key],
  );
  const latest = attempts[0];
  return {
    list: {
      id: list.id,
      name: list.name,
      columns: JSON.parse(list.columns_json || "[]") as string[],
    },
    row: toManualRow(row),
    attempts,
    hidden: Boolean(latest && outcomeHiddenNow(latest.outcome, latest.created_at)),
  };
}

export async function agentCanAccessManualRow(user: PublicUser, rowId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  const rows = await sql<{ list_id: number }>(
    "SELECT list_id FROM manual_list_rows WHERE id = $1",
    [rowId],
  );
  const row = rows[0];
  if (!row) return false;
  const assigned = await sql<{ ok: number }>(
    `SELECT 1 AS ok FROM manual_list_assignments WHERE user_id = $1 AND list_id = $2`,
    [user.id, row.list_id],
  );
  return Boolean(assigned[0]);
}

export async function agentCanAccessManualList(user: PublicUser, listId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  const assigned = await sql<{ ok: number }>(
    `SELECT 1 AS ok FROM manual_list_assignments WHERE user_id = $1 AND list_id = $2`,
    [user.id, listId],
  );
  return Boolean(assigned[0]);
}
