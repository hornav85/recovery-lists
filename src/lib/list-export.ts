import type { QueueLead } from "./leads";
import { normalizePhone } from "./phone";

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for the currently filtered queue (what Lists is showing). */
export function queueToCsv(
  queue: QueueLead[],
  meta: {
    title: string;
    view: string;
    status?: string | null;
    attempts?: string | null;
    sort?: string | null;
    from?: string | null;
    to?: string | null;
  },
): string {
  const lines: string[] = [];
  lines.push("Recovery Lists — list export");
  lines.push(`Title,${esc(meta.title)}`);
  lines.push(`View,${esc(meta.view)}`);
  if (meta.status) lines.push(`Status,${esc(meta.status)}`);
  if (meta.attempts) lines.push(`Attempt filter,${esc(meta.attempts)}`);
  if (meta.sort) lines.push(`Sort,${esc(meta.sort)}`);
  if (meta.from || meta.to) {
    lines.push(`Appointment from,${esc(meta.from || "")}`);
    lines.push(`Appointment to,${esc(meta.to || "")}`);
  }
  lines.push(`Rows,${queue.length}`);
  lines.push(`Generated,${esc(new Date().toISOString())}`);
  lines.push("");
  lines.push(
    [
      "Name",
      "Phone",
      "Status",
      "Appointment",
      "Meeting time",
      "Attempts",
      "Attempt bucket",
      "Last outcome",
      "Last dialed at",
      "Last agent",
      "Project",
      "Address",
      "Prospect key",
      "Prospect ID",
      "Lead ID",
      "Sheet row",
      "App lead id",
    ].join(","),
  );
  for (const lead of queue) {
    const latest = lead.latest_attempt;
    lines.push(
      [
        lead.name || "",
        normalizePhone(lead.phone) || "",
        lead.status || "",
        lead.appointment_date || lead.date_col || "",
        lead.meeting_time || "",
        lead.attempt_count,
        lead.attempt_bucket,
        latest?.outcome || "",
        latest?.created_at || "",
        latest?.agent_display_name || "",
        lead.project || "",
        lead.address || "",
        lead.prospect_key,
        lead.prospect_id || "",
        lead.lead_id || "",
        lead.sheet_row_index == null ? "" : String(lead.sheet_row_index),
        lead.id,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}
