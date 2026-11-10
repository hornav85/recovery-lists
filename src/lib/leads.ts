import {
  type AttemptBucketId,
  bucketForCount,
  countInBucket,
} from "./attempts";
import { sql } from "./db";
import { HIDDEN_OUTCOMES, normalizeStatus } from "./statuses";
import { activeSortValue } from "./prospect";

export type LeadDb = {
  id: number;
  sheet_row_index: number | null;
  prospect_key: string;
  prospect_id: string | null;
  lead_id: string | null;
  phone: string | null;
  name: string | null;
  address: string | null;
  status: string | null;
  date_col: string | null;
  appointment_date: string | null;
  meeting_time: string | null;
  team: string | null;
  project: string | null;
  agent: string | null;
  source: string | null;
  language: string | null;
  notes: string | null;
  notes_followups: string | null;
  ownership: string | null;
  recovery_agent: string | null;
  challenge: string | null;
  sales_amount: string | null;
  meeting_id: string | null;
  calendar_event_id: string | null;
  welcome_call: string | null;
  confirmed: string | null;
  paid: string | null;
  is_dnc: number;
  synced_at: string;
};

export type AttemptRow = {
  id: number;
  lead_id: number;
  prospect_key: string;
  outcome: string;
  notes: string | null;
  agent_user_id: number;
  agent_display_name: string;
  created_at: string;
};

export type QueueLead = LeadDb & {
  latest_attempt: AttemptRow | null;
  attempt_count: number;
  attempt_bucket: AttemptBucketId;
};

async function latestAttemptByProspect(): Promise<Map<string, AttemptRow>> {
  const rows = await sql<AttemptRow>(
    `SELECT a.* FROM call_attempts a
     INNER JOIN (
       SELECT prospect_key, MAX(id) AS max_id FROM call_attempts GROUP BY prospect_key
     ) t ON a.id = t.max_id`,
  );
  return new Map(rows.map((r) => [r.prospect_key, r]));
}

async function attemptCountsByProspect(): Promise<Map<string, number>> {
  const rows = await sql<{ prospect_key: string; c: string | number }>(
    `SELECT prospect_key, COUNT(*) AS c FROM call_attempts GROUP BY prospect_key`,
  );
  return new Map(rows.map((r) => [r.prospect_key, Number(r.c)]));
}

async function buildActiveQueue(leads: LeadDb[]): Promise<QueueLead[]> {
  const byProspect = new Map<string, LeadDb[]>();
  for (const lead of leads) {
    const list = byProspect.get(lead.prospect_key) || [];
    list.push(lead);
    byProspect.set(lead.prospect_key, list);
  }

  const latestAttempts = await latestAttemptByProspect();
  const counts = await attemptCountsByProspect();
  const active: QueueLead[] = [];

  for (const [, group] of byProspect) {
    group.sort((a, b) => activeSortValue(b) - activeSortValue(a));
    const top = group[0];
    const attempt = latestAttempts.get(top.prospect_key);
    if (isHiddenLead(top, attempt)) continue;
    const attempt_count = counts.get(top.prospect_key) || 0;
    active.push({
      ...top,
      latest_attempt: attempt || null,
      attempt_count,
      attempt_bucket: bucketForCount(attempt_count),
    });
  }

  // Fewest attempts first (dial fresher leads before burned)
  active.sort((a, b) => {
    if (a.attempt_count !== b.attempt_count) return a.attempt_count - b.attempt_count;
    return activeSortValue(b) - activeSortValue(a);
  });
  return active;
}

/** True if lead should be hidden from queues. */
export function isHiddenLead(
  lead: LeadDb,
  latestAttempt: AttemptRow | undefined
): boolean {
  if (lead.is_dnc) return true;
  if ((lead.status || "").toUpperCase() === "DNC") return true;
  if (latestAttempt && HIDDEN_OUTCOMES.has(latestAttempt.outcome)) return true;
  return false;
}

/** Active lead rows for a status list, one per prospect (newest). */
export async function getQueueForStatus(
  statusName: string,
  attemptBucket?: AttemptBucketId | null
): Promise<QueueLead[]> {
  const target = normalizeStatus(statusName);
  const all = (await sql<LeadDb>(`SELECT * FROM leads`)).filter(
    (lead) => normalizeStatus(lead.status) === target
  );
  let queue = await buildActiveQueue(all);
  if (attemptBucket) {
    queue = queue.filter((l) => countInBucket(l.attempt_count, attemptBucket));
  }
  return queue;
}

/** Cross-status queue for an attempt bucket (e.g. burned out / 1 attempt). */
export async function getQueueForAttemptBucket(
  attemptBucket: AttemptBucketId,
  allowedStatuses?: string[] | null
): Promise<QueueLead[]> {
  let all = await sql<LeadDb>(`SELECT * FROM leads`);
  if (allowedStatuses && allowedStatuses.length > 0) {
    const allowed = new Set(allowedStatuses.map((s) => normalizeStatus(s)));
    all = all.filter((lead) => allowed.has(normalizeStatus(lead.status)));
  }
  return (await buildActiveQueue(all)).filter((l) =>
    countInBucket(l.attempt_count, attemptBucket)
  );
}

export function countByAttemptBucket(
  queue: QueueLead[]
): Record<AttemptBucketId, number> {
  const out: Record<string, number> = {
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    burned: 0,
  };
  for (const lead of queue) {
    out[lead.attempt_bucket] = (out[lead.attempt_bucket] || 0) + 1;
  }
  return out as Record<AttemptBucketId, number>;
}

export async function getAssignedAttemptBuckets(
  userId: number,
  role: string
): Promise<AttemptBucketId[]> {
  if (role === "admin") {
    return ["0", "1", "2", "3", "4", "5", "burned"];
  }
  const rows = await sql<{ bucket: string }>(
    `SELECT bucket FROM agent_attempt_assignments WHERE user_id = $1`,
    [userId],
  );
  return rows
    .map((r) => r.bucket)
    .filter((b): b is AttemptBucketId =>
      ["0", "1", "2", "3", "4", "5", "burned"].includes(b)
    );
}

export async function getLeadDetail(leadId: number) {
  const leads = await sql<LeadDb>("SELECT * FROM leads WHERE id = $1", [leadId]);
  const lead = leads[0];
  if (!lead) return null;

  const siblings = await sql<LeadDb>(
    `SELECT * FROM leads WHERE prospect_key = $1`,
    [lead.prospect_key],
  );
  siblings.sort((a, b) => activeSortValue(b) - activeSortValue(a));

  const active = siblings[0];
  const history = siblings.slice(1);
  // History anchor: older rows display-only; active is newest

  const attempts = await sql<AttemptRow>(
    `SELECT * FROM call_attempts WHERE prospect_key = $1 ORDER BY created_at DESC, id DESC`,
    [lead.prospect_key],
  );

  const latestAttempt = attempts[0];
  const hidden = isHiddenLead(active, latestAttempt);

  return {
    requestedId: leadId,
    active,
    history,
    attempts,
    hidden,
    isActiveRow: active.id === leadId,
  };
}

export async function getAssignedStatuses(userId: number, role: string) {
  if (role === "admin") {
    return sql<{ id: number; name: string }>(
      `SELECT id, name FROM list_statuses WHERE active = 1 ORDER BY name`,
    );
  }
  return sql<{ id: number; name: string }>(
    `SELECT s.id, s.name FROM list_statuses s
     JOIN agent_assignments a ON a.status_id = s.id
     WHERE a.user_id = $1 AND s.active = 1
     ORDER BY s.name`,
    [userId],
  );
}
