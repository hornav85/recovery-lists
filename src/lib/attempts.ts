/** Attempt-count dial buckets (independent of sheet status). */
export const ATTEMPT_BUCKETS = [
  { id: "0", label: "0 attempts", min: 0, max: 0 },
  { id: "1", label: "1 attempt", min: 1, max: 1 },
  { id: "2", label: "2 attempts", min: 2, max: 2 },
  { id: "3", label: "3 attempts", min: 3, max: 3 },
  { id: "4", label: "4 attempts", min: 4, max: 4 },
  { id: "5", label: "5 attempts", min: 5, max: 5 },
  { id: "burned", label: "Burned out", min: 6, max: Infinity },
] as const;

export type AttemptBucketId = (typeof ATTEMPT_BUCKETS)[number]["id"];

export function bucketForCount(count: number): AttemptBucketId {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "3";
  if (count === 4) return "4";
  if (count === 5) return "5";
  return "burned";
}

export function bucketLabel(id: string): string {
  return ATTEMPT_BUCKETS.find((b) => b.id === id)?.label || id;
}

export function parseAttemptBucket(raw: string | null | undefined): AttemptBucketId | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  if (ATTEMPT_BUCKETS.some((b) => b.id === id)) return id as AttemptBucketId;
  return null;
}

export function countInBucket(count: number, bucketId: AttemptBucketId): boolean {
  const b = ATTEMPT_BUCKETS.find((x) => x.id === bucketId);
  if (!b) return false;
  return count >= b.min && count <= b.max;
}
