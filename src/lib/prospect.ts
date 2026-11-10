import type { LeadRow } from "./columns";

/** Cluster key: Prospect ID, else phone (digits), else address core. */
export function prospectKey(row: Pick<LeadRow, "prospectId" | "cell" | "address">): string {
  const pid = (row.prospectId || "").trim();
  if (pid) return `pid:${pid}`;
  const phone = digitsOnly(row.cell);
  if (phone.length >= 7) return `phone:${phone}`;
  const addr = (row.address || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (addr) return `addr:${addr}`;
  return `row:${row.cell || "unknown"}`;
}

export function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** Parse loose date strings for comparison; invalid → 0. */
export function parseSortDate(raw: string | null | undefined): number {
  if (!raw) return 0;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;
  // Try M/D/YYYY
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(year, Number(m[1]) - 1, Number(m[2]));
    return d.getTime();
  }
  return 0;
}

/** Active row = newest by Appointment Date else DATE. */
export function activeSortValue(row: {
  appointment_date?: string | null;
  date_col?: string | null;
  appointmentDate?: string;
  date?: string;
}): number {
  const appt = row.appointment_date ?? row.appointmentDate ?? "";
  const date = row.date_col ?? row.date ?? "";
  return parseSortDate(appt) || parseSortDate(date);
}
