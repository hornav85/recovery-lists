/** US dial string: +1 and exactly ten digits. */
const DIALABLE = /^\+1\d{10}$/;

/**
 * Characters stripped as formatting. Anything else (letters, notes, extensions)
 * means the value is not a plain phone and is left unchanged.
 */
const PHONE_SHAPED = /^[\d\s().+\-/]+$/;

/**
 * Canonical Florida/US form: `+1` plus 10 digits.
 * 10 digits → assume US +1. 11 digits starting with 1 → `+1` and the last 10.
 * Blank becomes null. Clearly invalid values are returned unchanged.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const original = String(raw);
  const trimmed = original.trim();
  if (!trimmed) return null;
  if (!PHONE_SHAPED.test(trimmed)) return original;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+1${digits.slice(1)}`;
  return original;
}

export function isDialablePhone(phone: string | null | undefined): phone is string {
  return typeof phone === "string" && DIALABLE.test(phone);
}

/** `tel:+1XXXXXXXXXX` when the value normalizes to a dialable US number. */
export function telHref(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  if (!isDialablePhone(normalized)) return null;
  return `tel:${normalized}`;
}

let normalizing: Promise<void> | undefined;

/**
 * Rewrite stored lead phones to the canonical form once per process.
 * Invalid values are not updated. Skipped during `next build`.
 */
export function ensureStoredPhonesNormalized(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
  if (!normalizing) {
    normalizing = rewriteStoredPhones().catch((error: unknown) => {
      normalizing = undefined;
      throw error;
    });
  }
  return normalizing;
}

async function rewriteStoredPhones(): Promise<void> {
  const { sql } = await import("./db");
  const rows = await sql<{ id: number; phone: string | null }>(
    "SELECT id, phone FROM leads WHERE phone IS NOT NULL",
  );
  for (const row of rows) {
    const next = normalizePhone(row.phone);
    if (next === row.phone) continue;
    await sql("UPDATE leads SET phone = $1 WHERE id = $2", [next, row.id]);
  }
}
