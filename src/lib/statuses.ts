/**
 * List statuses aligned to Dashboard Column W formula outputs.
 * Formula uses PROPER() for known col-N values, plus:
 *   WC - Pending | Confirmation - Pending | Confirmation - Done
 */
export const SEED_STATUSES = [
  "PNS",
  "NPNS",
  "Sold",
  "NG",
  "No Show",
  "Cancelled",
  "pending",
  "Reschedule",
  "No Answer",
  "FTD",
  "special",
  "2nd Meeting",
  "WC - Pending",
  "Confirmation - Pending",
  "Confirmation - Done",
  "Sold-Canceled",
] as const;

/** Collapse spacing/hyphens for alias lookup. */
function aliasKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map every known spelling (formula PROPER, old seeds, spaced hyphens) → canonical.
 */
const ALIASES: Record<string, string> = {
  // Acronyms
  pns: "PNS",
  npns: "NPNS",
  ng: "NG",
  ftd: "FTD",

  // Cancelled
  canceled: "Cancelled",
  cancelled: "Cancelled",

  // Reschedule / meetings / shows / answers
  reschedule: "Reschedule",
  "no show": "No Show",
  noshow: "No Show",
  "no-show": "No Show",
  "no answer": "No Answer",
  noanswer: "No Answer",
  "no-answer": "No Answer",
  "2nd meeting": "2nd Meeting",
  "second meeting": "2nd Meeting",
  "2nd-meeting": "2nd Meeting",

  // Sold family
  sold: "Sold",
  "sold-canceled": "Sold-Canceled",
  "sold canceled": "Sold-Canceled",
  "sold-cancelled": "Sold-Canceled",
  "sold cancelled": "Sold-Canceled",

  // Welcome / confirmation (Column W derived branches)
  "wc-pending": "WC - Pending",
  "wc pending": "WC - Pending",
  "welcome call pending": "WC - Pending",
  "confirmation-pending": "Confirmation - Pending",
  "confirmation pending": "Confirmation - Pending",
  "confirmation-done": "Confirmation - Done",
  "confirmation done": "Confirmation - Done",

  // Keep explicit pending / special
  pending: "pending",
  special: "special",
};

export function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const key = aliasKey(trimmed);
  if (ALIASES[key]) return ALIASES[key];

  // Spaced form of seed (e.g. "wc - pending" already handled; try exact lower)
  const seed = SEED_STATUSES.find((s) => aliasKey(s) === key || s.toLowerCase() === trimmed.toLowerCase());
  return seed ?? trimmed;
}

export const ATTEMPT_OUTCOMES = [
  "NG",
  "Cancelled",
  "Recovered",
  "Callback",
  "No Answer",
  "No Answer Voicemail",
  "DNC",
  "Not interested",
  "Already did project",
] as const;

export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const HIDDEN_OUTCOMES = new Set<string>(["Recovered", "DNC"]);

/** Old list_statuses.name → new canonical (for DB rename). */
export const STATUS_RENAMES: Array<{ from: string; to: string }> = [
  { from: "WC-pending", to: "WC - Pending" },
  { from: "confirmation pending", to: "Confirmation - Pending" },
  { from: "cancelled", to: "Cancelled" },
  { from: "reschedule", to: "Reschedule" },
  { from: "no answer", to: "No Answer" },
  { from: "no show", to: "No Show" },
  { from: "second meeting", to: "2nd Meeting" },
  { from: "sold", to: "Sold" },
];
