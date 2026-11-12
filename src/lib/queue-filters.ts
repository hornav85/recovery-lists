import { activeSortValue, digitsOnly } from "./prospect";
import type { QueueLead } from "./leads";

export type QueueSort = "attempts" | "appt-desc" | "appt-asc";

export function parseQueueSort(raw: string | null | undefined): QueueSort {
  if (raw === "appt-desc" || raw === "appt-new" || raw === "newest") return "appt-desc";
  if (raw === "appt-asc" || raw === "appt-old" || raw === "oldest") return "appt-asc";
  return "attempts";
}

export function sortLabel(sort: QueueSort): string {
  if (sort === "appt-desc") return "Newest appointment first";
  if (sort === "appt-asc") return "Oldest appointment first";
  return "Fewest attempts first";
}

function leadApptMs(lead: QueueLead): number {
  return activeSortValue(lead);
}

/** Inclusive YMD filter on appointment date (falls back to DATE column). */
export function filterQueueByApptDate(
  queue: QueueLead[],
  fromYmd?: string | null,
  toYmd?: string | null,
): QueueLead[] {
  const fromOk = fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd);
  const toOk = toYmd && /^\d{4}-\d{2}-\d{2}$/.test(toYmd);
  if (!fromOk && !toOk) return queue;

  const fromMs = fromOk ? Date.parse(`${fromYmd}T00:00:00`) : null;
  const toMs = toOk ? Date.parse(`${toYmd}T23:59:59.999`) : null;

  return queue.filter((lead) => {
    const ms = leadApptMs(lead);
    if (!ms) return false; // no usable date → exclude when filtering
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    return true;
  });
}

export function sortQueue(queue: QueueLead[], sort: QueueSort): QueueLead[] {
  const copy = [...queue];
  if (sort === "appt-desc") {
    copy.sort((a, b) => {
      const d = leadApptMs(b) - leadApptMs(a);
      if (d !== 0) return d;
      return a.attempt_count - b.attempt_count;
    });
  } else if (sort === "appt-asc") {
    copy.sort((a, b) => {
      const d = leadApptMs(a) - leadApptMs(b);
      if (d !== 0) return d;
      return a.attempt_count - b.attempt_count;
    });
  } else {
    copy.sort((a, b) => {
      if (a.attempt_count !== b.attempt_count) return a.attempt_count - b.attempt_count;
      return leadApptMs(b) - leadApptMs(a);
    });
  }
  return copy;
}

export function applyQueueView(
  queue: QueueLead[],
  opts: { sort?: QueueSort; fromYmd?: string | null; toYmd?: string | null },
): QueueLead[] {
  const filtered = filterQueueByApptDate(queue, opts.fromYmd, opts.toYmd);
  return sortQueue(filtered, opts.sort || "attempts");
}

/** Stored lead columns an admin search can match. Derived attempt fields are omitted. */
const LEAD_SEARCH_FIELDS = [
  "id",
  "sheet_row_index",
  "prospect_key",
  "prospect_id",
  "lead_id",
  "phone",
  "name",
  "address",
  "status",
  "date_col",
  "appointment_date",
  "meeting_time",
  "team",
  "project",
  "agent",
  "source",
  "language",
  "notes",
  "notes_followups",
  "ownership",
  "recovery_agent",
  "challenge",
  "sales_amount",
  "meeting_id",
  "calendar_event_id",
  "welcome_call",
  "confirmed",
  "paid",
  "synced_at",
] as const satisfies readonly (keyof QueueLead)[];

/** Digits and punctuation only — so "786-704-2650" can match a stored phone. */
function isPhoneLikeQuery(query: string): boolean {
  return /\d/.test(query) && !/[a-z]/.test(query);
}

export function leadMatchesSearch(lead: QueueLead, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const phoneLike = isPhoneLikeQuery(query);
  const queryDigits = phoneLike ? digitsOnly(query) : "";

  for (const key of LEAD_SEARCH_FIELDS) {
    const value = lead[key];
    if (value == null) continue;
    const text = String(value).toLowerCase();
    if (text.includes(query)) return true;
    if (key === "phone" && queryDigits && digitsOnly(text).includes(queryDigits)) return true;
  }
  return false;
}

/** Partial, case-insensitive match against the current queue (every stored lead column). */
export function filterQueueBySearch(
  queue: QueueLead[],
  rawQuery?: string | null,
): QueueLead[] {
  const query = (rawQuery ?? "").trim();
  if (!query) return queue;
  return queue.filter((lead) => leadMatchesSearch(lead, query));
}

/** Debug/helper: readable appt used for sort. */
export function leadApptDisplay(lead: QueueLead): string {
  return lead.appointment_date || lead.date_col || "—";
}
