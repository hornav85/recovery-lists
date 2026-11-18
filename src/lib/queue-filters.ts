import { activeSortValue } from "./prospect";
import type { QueueLead } from "./leads";

export type QueueSort = "attempts" | "appt-desc" | "appt-asc";

export function parseQueueSort(raw: string | null | undefined): QueueSort {
  if (raw === "appt-desc" || raw === "appt-new" || raw === "newest") return "appt-desc";
  if (raw === "appt-asc" || raw === "appt-old" || raw === "oldest") return "appt-asc";
  return "attempts";
}

/** Query string for the lists page, omitting the default fewest-attempts sort. */
export function listViewSearch(opts: {
  view?: string;
  status?: string;
  attempts?: string;
  sort?: string;
  from?: string;
  to?: string;
}): string {
  const p = new URLSearchParams();
  if (opts.view === "attempts") p.set("view", "attempts");
  if (opts.status) p.set("status", opts.status);
  if (opts.attempts) p.set("attempts", opts.attempts);
  if (opts.sort && opts.sort !== "attempts") p.set("sort", opts.sort);
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  const q = p.toString();
  return q;
}

export function listsPath(opts: {
  view?: string;
  status?: string;
  attempts?: string;
  sort?: string;
  from?: string;
  to?: string;
}): string {
  const q = listViewSearch(opts);
  return q ? `/lists?${q}` : "/lists";
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

/** Debug/helper: readable appt used for sort. */
export function leadApptDisplay(lead: QueueLead): string {
  return lead.appointment_date || lead.date_col || "—";
}
