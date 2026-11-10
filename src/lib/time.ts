/** Pacific (America/Los_Angeles) day helpers for reports. */

export const REPORT_TZ = "America/Los_Angeles";

function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Calendar YYYY-MM-DD in Pacific for an instant. */
export function pacificYmd(date = new Date()): string {
  const p = partsInTz(date, REPORT_TZ);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function ymdAdd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

/** Approximate UTC instant for Pacific local midnight of YMD (handles PST/PDT). */
export function pacificDayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  // Probe noon UTC that day, read Pacific offset via formatted parts
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const p = partsInTz(probe, REPORT_TZ);
  // Difference between intended local midnight and what probe shows as Pacific
  // Build a candidate: find UTC such that Pacific date is ymd 00:00
  let guess = new Date(Date.UTC(y, m - 1, d, 8, 0, 0)); // PDT-ish
  for (let i = 0; i < 6; i++) {
    const gp = partsInTz(guess, REPORT_TZ);
    const asLocal = Date.UTC(gp.year, gp.month - 1, gp.day, gp.hour, gp.minute, gp.second);
    const want = Date.UTC(y, m - 1, d, 0, 0, 0);
    const deltaMs = asLocal - want;
    if (Math.abs(deltaMs) < 1000) break;
    guess = new Date(guess.getTime() - deltaMs);
  }
  void p;
  return guess;
}

export function pacificDayEndUtc(ymd: string): Date {
  // Exclusive end = start of next Pacific day
  return pacificDayStartUtc(ymdAdd(ymd, 1));
}

export type DatePreset = "today" | "yesterday" | "week" | "month" | "custom" | "day";

export type DateRange = {
  preset: DatePreset;
  fromYmd: string;
  toYmd: string; // inclusive calendar day in Pacific
  fromIso: string;
  toIsoExclusive: string;
  label: string;
};

export function resolveDateRange(opts: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  day?: string | null;
}): DateRange {
  const today = pacificYmd();
  const presetRaw = (opts.preset || "").toLowerCase();

  if (opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day)) {
    const ymd = opts.day;
    const start = pacificDayStartUtc(ymd);
    const end = pacificDayEndUtc(ymd);
    return {
      preset: "day",
      fromYmd: ymd,
      toYmd: ymd,
      fromIso: start.toISOString(),
      toIsoExclusive: end.toISOString(),
      label: ymd,
    };
  }

  if (presetRaw === "yesterday") {
    const ymd = ymdAdd(today, -1);
    return {
      preset: "yesterday",
      fromYmd: ymd,
      toYmd: ymd,
      fromIso: pacificDayStartUtc(ymd).toISOString(),
      toIsoExclusive: pacificDayEndUtc(ymd).toISOString(),
      label: `Yesterday (${ymd})`,
    };
  }

  if (presetRaw === "week") {
    // Monday–today (Pacific). JS: Sun=0 … Sat=6 → Mon=0
    const [y, m, d] = today.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const mondayOffset = (dow + 6) % 7;
    const fromYmd = ymdAdd(today, -mondayOffset);
    return {
      preset: "week",
      fromYmd,
      toYmd: today,
      fromIso: pacificDayStartUtc(fromYmd).toISOString(),
      toIsoExclusive: pacificDayEndUtc(today).toISOString(),
      label: `This week (${fromYmd} → ${today})`,
    };
  }

  if (presetRaw === "month") {
    const fromYmd = `${today.slice(0, 8)}01`;
    return {
      preset: "month",
      fromYmd,
      toYmd: today,
      fromIso: pacificDayStartUtc(fromYmd).toISOString(),
      toIsoExclusive: pacificDayEndUtc(today).toISOString(),
      label: `This month (${fromYmd} → ${today})`,
    };
  }

  if (
    (presetRaw === "custom" || opts.from || opts.to) &&
    opts.from &&
    /^\d{4}-\d{2}-\d{2}$/.test(opts.from)
  ) {
    const fromYmd = opts.from;
    const toYmd =
      opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : fromYmd;
    const a = fromYmd <= toYmd ? fromYmd : toYmd;
    const b = fromYmd <= toYmd ? toYmd : fromYmd;
    return {
      preset: "custom",
      fromYmd: a,
      toYmd: b,
      fromIso: pacificDayStartUtc(a).toISOString(),
      toIsoExclusive: pacificDayEndUtc(b).toISOString(),
      label: a === b ? a : `${a} → ${b}`,
    };
  }

  // default today
  return {
    preset: "today",
    fromYmd: today,
    toYmd: today,
    fromIso: pacificDayStartUtc(today).toISOString(),
    toIsoExclusive: pacificDayEndUtc(today).toISOString(),
    label: `Today (${today})`,
  };
}
