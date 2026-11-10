import { sql } from "./db";

export type AssignmentSnapshot = {
  user_id: number;
  snapshot_at: string;
  statusNames: string[];
  attemptBuckets: string[];
  by_admin_id: number | null;
};

export async function readCurrentAssignments(
  userId: number
): Promise<{ statusNames: string[]; attemptBuckets: string[] }> {
  const statusRows = await sql<{ name: string }>(
    `SELECT s.name FROM agent_assignments a
     JOIN list_statuses s ON s.id = a.status_id
     WHERE a.user_id = $1
     ORDER BY s.name`,
    [userId],
  );
  const statusNames = statusRows.map((r) => r.name);

  const bucketRows = await sql<{ bucket: string }>(
    `SELECT bucket FROM agent_attempt_assignments WHERE user_id = $1 ORDER BY bucket`,
    [userId],
  );
  const attemptBuckets = bucketRows.map((r) => r.bucket);

  return { statusNames, attemptBuckets };
}

export async function saveAssignmentSnapshot(
  userId: number,
  byAdminId: number | null,
  statusNames?: string[],
  attemptBuckets?: string[]
) {
  const current =
    statusNames && attemptBuckets
      ? { statusNames, attemptBuckets }
      : await readCurrentAssignments(userId);

  await sql(
    `INSERT INTO assignment_snapshots
      (user_id, snapshot_at, status_names_json, attempt_buckets_json, by_admin_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      new Date().toISOString(),
      JSON.stringify(current.statusNames),
      JSON.stringify(current.attemptBuckets),
      byAdminId,
    ],
  );
}

/** Latest snapshot at or before `atIso` (inclusive). */
export async function assignmentsAsOf(
  userId: number,
  atIso: string
): Promise<{ statusNames: string[]; attemptBuckets: string[]; snapshot_at: string | null }> {
  const rows = await sql<{
    snapshot_at: string;
    status_names_json: string;
    attempt_buckets_json: string;
  }>(
    `SELECT snapshot_at, status_names_json, attempt_buckets_json
     FROM assignment_snapshots
     WHERE user_id = $1 AND snapshot_at <= $2
     ORDER BY snapshot_at DESC, id DESC
     LIMIT 1`,
    [userId, atIso],
  );
  const row = rows[0];

  if (!row) {
    // Fall back to current if no history yet (pre-feature assignments)
    const cur = await readCurrentAssignments(userId);
    return { ...cur, snapshot_at: null };
  }

  return {
    statusNames: JSON.parse(row.status_names_json || "[]") as string[],
    attemptBuckets: JSON.parse(row.attempt_buckets_json || "[]") as string[],
    snapshot_at: row.snapshot_at,
  };
}

/** Bootstrap a day-one snapshot for every agent that has assignments but no history. */
export async function bootstrapAssignmentSnapshots() {
  const users = await sql<{ id: number }>(
    `SELECT id FROM users WHERE role = 'agent' OR role = 'admin'`,
  );

  for (const u of users) {
    const existing = await sql<{ ok: number }>(
      `SELECT 1 AS ok FROM assignment_snapshots WHERE user_id = $1 LIMIT 1`,
      [u.id],
    );
    if (existing[0]) continue;
    const cur = await readCurrentAssignments(u.id);
    if (cur.statusNames.length === 0 && cur.attemptBuckets.length === 0) continue;
    await saveAssignmentSnapshot(u.id, null, cur.statusNames, cur.attemptBuckets);
  }
}
