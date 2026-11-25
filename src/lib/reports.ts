import { bucketLabel } from "./attempts";
import { ensureStoredPhonesNormalized, normalizePhone } from "./phone";
import { assignmentsAsOf } from "./assignments";
import { sql } from "./db";
import { getQueueForStatus } from "./leads";
import { manualQueueCount } from "./manual-lists";
import { ATTEMPT_OUTCOMES } from "./statuses";
import { type DateRange, pacificYmd, REPORT_TZ } from "./time";

export type OutcomeCounts = Record<string, number>;

export type AgentReportRow = {
  agentId: number;
  displayName: string;
  username: string;
  dials: number;
  uniqueProspects: number;
  outcomes: OutcomeCounts;
  recovered: number;
  recoveryRate: number;
  firstDialAt: string | null;
  lastDialAt: string | null;
  activeHours: number;
  dialsPerHour: number;
  assignedStatusNames: string[];
  assignedAttemptBuckets: string[];
  assignedManualListNames: string[];
  assignmentSnapshotAt: string | null;
};

export type ListPerfRow = {
  status: string;
  dials: number;
  recovered: number;
  recoveryRate: number;
  outcomes: OutcomeCounts;
};

export type DayHistoryRow = {
  day: string;
  dials: number;
  recovered: number;
  outcomes: OutcomeCounts;
};

export type QueueLeftoverRow = {
  agentId: number;
  displayName: string;
  statusName: string;
  remaining: number;
};

function emptyOutcomes(): OutcomeCounts {
  const o: OutcomeCounts = {};
  for (const name of ATTEMPT_OUTCOMES) o[name] = 0;
  o.Other = 0;
  return o;
}

function bumpOutcome(outcomes: OutcomeCounts, outcome: string) {
  if (outcome in outcomes && outcome !== "Other") outcomes[outcome] += 1;
  else outcomes.Other = (outcomes.Other || 0) + 1;
}

function hoursBetween(aIso: string, bIso: string): number {
  const ms = Math.abs(new Date(bIso).getTime() - new Date(aIso).getTime());
  return Math.max(ms / 3_600_000, 1 / 60); // floor ~1 minute so rate isn't insane
}

type AttemptJoin = {
  id: number;
  outcome: string;
  notes: string | null;
  created_at: string;
  agent_user_id: number;
  agent_display_name: string;
  prospect_key: string;
  lead_status: string | null;
  lead_notes: string | null;
  lead_notes_followups: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_address: string | null;
  lead_project: string | null;
  lead_prospect_id: string | null;
  lead_sheet_lead_id: string | null;
  lead_sheet_row_index: number | null;
  lead_is_dnc: number | null;
  username: string;
  display_name: string;
};

export type CallDetailRow = {
  attemptId: number;
  dialedAt: string;
  agentDisplayName: string;
  agentUsername: string;
  outcome: string;
  recovered: string;
  notes: string;
  agentFeedback: string;
  leadNotes: string;
  listSource: string;
  listName: string;
  prospectKey: string;
  leadName: string;
  phone: string;
  address: string;
  project: string;
  listStatus: string;
  prospectId: string;
  sheetLeadId: string;
  sheetRowIndex: string;
  leadMarkedDnc: string;
};

const REPORT_ATTEMPTS_LIMIT = 50_000;

const ATTEMPT_SELECT = `SELECT a.id, a.outcome, a.notes, a.created_at, a.agent_user_id, a.agent_display_name,
              a.prospect_key,
              l.status AS lead_status,
              l.notes AS lead_notes,
              l.notes_followups AS lead_notes_followups,
              l.name AS lead_name,
              l.phone AS lead_phone,
              l.address AS lead_address,
              l.project AS lead_project,
              l.prospect_id AS lead_prospect_id,
              l.lead_id AS lead_sheet_lead_id,
              l.sheet_row_index AS lead_sheet_row_index,
              l.is_dnc AS lead_is_dnc,
              u.username, u.display_name
       FROM call_attempts a
       JOIN users u ON u.id = a.agent_user_id
       LEFT JOIN leads l ON l.id = a.lead_id`;

async function loadAttempts(range: DateRange, agentId?: number | null): Promise<AttemptJoin[]> {
  await ensureStoredPhonesNormalized();
  // Cast to timestamptz so PGlite "YYYY-MM-DD HH:MM:SS+00" and ISO strings compare correctly
  if (agentId && Number.isFinite(agentId)) {
    return sql<AttemptJoin>(
      `${ATTEMPT_SELECT}
       WHERE a.created_at::timestamptz >= $1::timestamptz
         AND a.created_at::timestamptz < $2::timestamptz
         AND a.agent_user_id = $3
       ORDER BY a.created_at ASC
       LIMIT $4`,
      [range.fromIso, range.toIsoExclusive, agentId, REPORT_ATTEMPTS_LIMIT],
    );
  }
  return sql<AttemptJoin>(
    `${ATTEMPT_SELECT}
     WHERE a.created_at::timestamptz >= $1::timestamptz
       AND a.created_at::timestamptz < $2::timestamptz
     ORDER BY a.created_at ASC
     LIMIT $3`,
    [range.fromIso, range.toIsoExclusive, REPORT_ATTEMPTS_LIMIT],
  );
}

const MANUAL_ATTEMPT_SELECT = `SELECT a.id, a.outcome, a.notes, a.created_at, a.agent_user_id, a.agent_display_name,
              ('manual:' || COALESCE(a.list_id::text, a.list_name) || ':' || a.prospect_key) AS prospect_key,
              a.list_name AS lead_status,
              r.name AS lead_name,
              r.phone AS lead_phone,
              r.fields_json AS fields_json,
              u.username, u.display_name
       FROM manual_attempts a
       JOIN users u ON u.id = a.agent_user_id
       LEFT JOIN manual_list_rows r ON r.id = a.row_id`;

function fieldValue(fieldsJson: string | null | undefined, aliases: string[]): string {
  if (!fieldsJson) return "";
  try {
    const fields = JSON.parse(fieldsJson) as Record<string, unknown>;
    const wanted = new Set(aliases);
    for (const [key, value] of Object.entries(fields)) {
      const norm = key.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (wanted.has(norm) && value != null && String(value).trim()) return String(value).trim();
    }
  } catch {
    return "";
  }
  return "";
}

async function loadManualAttempts(range: DateRange, agentId?: number | null): Promise<AttemptJoin[]> {
  type Row = AttemptJoin & { fields_json?: string | null };
  const rows =
    agentId && Number.isFinite(agentId)
      ? await sql<Row>(
          `${MANUAL_ATTEMPT_SELECT}
           WHERE a.created_at::timestamptz >= $1::timestamptz
             AND a.created_at::timestamptz < $2::timestamptz
             AND a.agent_user_id = $3
           ORDER BY a.created_at ASC
           LIMIT $4`,
          [range.fromIso, range.toIsoExclusive, agentId, REPORT_ATTEMPTS_LIMIT],
        )
      : await sql<Row>(
          `${MANUAL_ATTEMPT_SELECT}
           WHERE a.created_at::timestamptz >= $1::timestamptz
             AND a.created_at::timestamptz < $2::timestamptz
           ORDER BY a.created_at ASC
           LIMIT $3`,
          [range.fromIso, range.toIsoExclusive, REPORT_ATTEMPTS_LIMIT],
        );
  return rows.map((row) => ({
    id: row.id,
    outcome: row.outcome,
    notes: row.notes,
    created_at: row.created_at,
    agent_user_id: row.agent_user_id,
    agent_display_name: row.agent_display_name,
    prospect_key: row.prospect_key,
    lead_status: row.lead_status,
    lead_notes: fieldValue(row.fields_json, ["notes", "note"]),
    lead_notes_followups: fieldValue(row.fields_json, [
      "notes and follow ups responses",
      "notes and follow ups",
      "follow ups",
      "follow up",
      "feedback",
    ]),
    lead_name: row.lead_name,
    lead_phone: row.lead_phone,
    lead_address: fieldValue(row.fields_json, ["address", "street", "street address"]),
    lead_project: fieldValue(row.fields_json, ["project"]),
    lead_prospect_id: null,
    lead_sheet_lead_id: null,
    lead_sheet_row_index: null,
    lead_is_dnc: 0,
    username: row.username,
    display_name: row.display_name,
  }));
}

function joinNotes(...parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const text = (part || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.join("\n");
}

function toCallDetail(a: AttemptJoin): CallDetailRow {
  const agentFeedback = (a.notes || "").trim();
  const fromAdditionalList = a.prospect_key.startsWith("manual:");
  const listName = a.lead_status || "";
  return {
    attemptId: a.id,
    dialedAt: a.created_at,
    agentDisplayName: a.display_name || a.agent_display_name,
    agentUsername: a.username,
    outcome: a.outcome,
    recovered: a.outcome === "Recovered" ? "yes" : "no",
    notes: agentFeedback,
    agentFeedback,
    leadNotes: joinNotes(a.lead_notes, a.lead_notes_followups),
    listSource: fromAdditionalList ? "Additional list" : "Recovery list",
    listName,
    prospectKey: a.prospect_key,
    leadName: a.lead_name || "",
    phone: normalizePhone(a.lead_phone) || "",
    address: a.lead_address || "",
    project: a.lead_project || "",
    listStatus: listName,
    prospectId: a.lead_prospect_id || "",
    sheetLeadId: a.lead_sheet_lead_id || "",
    sheetRowIndex: a.lead_sheet_row_index == null ? "" : String(a.lead_sheet_row_index),
    leadMarkedDnc: a.lead_is_dnc ? "yes" : "no",
  };
}

export async function buildReports(range: DateRange, agentId?: number | null) {
  const sheetAttempts = await loadAttempts(range, agentId);
  const manualAttempts = await loadManualAttempts(range, agentId);
  const attempts = [...sheetAttempts, ...manualAttempts].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id,
  );
  const asOfIso = new Date(new Date(range.toIsoExclusive).getTime() - 1).toISOString();

  const byAgent = new Map<number, AgentReportRow>();
  const listMap = new Map<string, ListPerfRow>();
  const dayMap = new Map<string, DayHistoryRow>();
  const teamOutcomes = emptyOutcomes();

  for (const a of attempts) {
    bumpOutcome(teamOutcomes, a.outcome);

    let agent = byAgent.get(a.agent_user_id);
    if (!agent) {
      agent = {
        agentId: a.agent_user_id,
        displayName: a.display_name || a.agent_display_name,
        username: a.username,
        dials: 0,
        uniqueProspects: 0,
        outcomes: emptyOutcomes(),
        recovered: 0,
        recoveryRate: 0,
        firstDialAt: null,
        lastDialAt: null,
        activeHours: 0,
        dialsPerHour: 0,
        assignedStatusNames: [],
        assignedAttemptBuckets: [],
        assignedManualListNames: [],
        assignmentSnapshotAt: null,
      };
      byAgent.set(a.agent_user_id, agent);
    }
    agent.dials += 1;
    bumpOutcome(agent.outcomes, a.outcome);
    if (a.outcome === "Recovered") agent.recovered += 1;
    if (!agent.firstDialAt || a.created_at < agent.firstDialAt) agent.firstDialAt = a.created_at;
    if (!agent.lastDialAt || a.created_at > agent.lastDialAt) agent.lastDialAt = a.created_at;

    const status = a.lead_status || "(unknown)";
    let list = listMap.get(status);
    if (!list) {
      list = { status, dials: 0, recovered: 0, recoveryRate: 0, outcomes: emptyOutcomes() };
      listMap.set(status, list);
    }
    list.dials += 1;
    bumpOutcome(list.outcomes, a.outcome);
    if (a.outcome === "Recovered") list.recovered += 1;

    const day = pacificYmd(new Date(a.created_at));
    let dayRow = dayMap.get(day);
    if (!dayRow) {
      dayRow = { day, dials: 0, recovered: 0, outcomes: emptyOutcomes() };
      dayMap.set(day, dayRow);
    }
    dayRow.dials += 1;
    bumpOutcome(dayRow.outcomes, a.outcome);
    if (a.outcome === "Recovered") dayRow.recovered += 1;
  }

  // Unique prospects + pace + assignments
  for (const agent of byAgent.values()) {
    const prospects = new Set(
      attempts.filter((a) => a.agent_user_id === agent.agentId).map((a) => a.prospect_key),
    );
    agent.uniqueProspects = prospects.size;
    if (agent.firstDialAt && agent.lastDialAt) {
      agent.activeHours = Number(hoursBetween(agent.firstDialAt, agent.lastDialAt).toFixed(2));
      agent.dialsPerHour = Number((agent.dials / agent.activeHours).toFixed(2));
    }
    agent.recoveryRate = agent.dials
      ? Number(((agent.recovered / agent.dials) * 100).toFixed(1))
      : 0;

    const snap = await assignmentsAsOf(agent.agentId, asOfIso);
    agent.assignedStatusNames = snap.statusNames;
    agent.assignedAttemptBuckets = snap.attemptBuckets.map((b) => bucketLabel(b));
    agent.assignedManualListNames = snap.manualListNames;
    agent.assignmentSnapshotAt = snap.snapshot_at;
  }

  for (const list of listMap.values()) {
    list.recoveryRate = list.dials
      ? Number(((list.recovered / list.dials) * 100).toFixed(1))
      : 0;
  }

  // Agents with assignments but zero dials in range (still show for boss)
  const agents = await sql<{ id: number; username: string; display_name: string }>(
    `SELECT id, username, display_name FROM users
     WHERE role = 'agent' AND disabled = 0 AND deleted_at IS NULL
     ORDER BY display_name`,
  );
  for (const u of agents) {
    if (agentId && u.id !== agentId) continue;
    if (byAgent.has(u.id)) continue;
    const snap = await assignmentsAsOf(u.id, asOfIso);
    if (
      snap.statusNames.length === 0 &&
      snap.attemptBuckets.length === 0 &&
      snap.manualListNames.length === 0
    ) {
      continue;
    }
    byAgent.set(u.id, {
      agentId: u.id,
      displayName: u.display_name,
      username: u.username,
      dials: 0,
      uniqueProspects: 0,
      outcomes: emptyOutcomes(),
      recovered: 0,
      recoveryRate: 0,
      firstDialAt: null,
      lastDialAt: null,
      activeHours: 0,
      dialsPerHour: 0,
      assignedStatusNames: snap.statusNames,
      assignedAttemptBuckets: snap.attemptBuckets.map((b) => bucketLabel(b)),
      assignedManualListNames: snap.manualListNames,
      assignmentSnapshotAt: snap.snapshot_at,
    });
  }

  const agentRows = [...byAgent.values()].sort((a, b) => b.dials - a.dials || b.recovered - a.recovered);
  const listPerformance = [...listMap.values()].sort((a, b) => b.recovered - a.recovered || b.dials - a.dials);
  const dayHistory = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  const leaderboard = {
    byDials: [...agentRows].sort((a, b) => b.dials - a.dials).slice(0, 10),
    byRecovered: [...agentRows].sort((a, b) => b.recovered - a.recovered).slice(0, 10),
  };

  // Queue leftover: remaining visible leads in currently assigned status lists
  const leftover: QueueLeftoverRow[] = [];
  for (const agent of agentRows) {
    for (const statusName of agent.assignedStatusNames) {
      const queue = await getQueueForStatus(statusName);
      leftover.push({
        agentId: agent.agentId,
        displayName: agent.displayName,
        statusName,
        remaining: queue.length,
      });
    }
    for (const listName of agent.assignedManualListNames) {
      leftover.push({
        agentId: agent.agentId,
        displayName: agent.displayName,
        statusName: listName,
        remaining: await manualQueueCount(listName),
      });
    }
  }

  const teamDials = attempts.length;
  const teamRecovered = teamOutcomes.Recovered || 0;
  const callDetails = attempts.map(toCallDetail);

  return {
    timezone: REPORT_TZ,
    range,
    generatedAt: new Date().toISOString(),
    team: {
      dials: teamDials,
      recovered: teamRecovered,
      recoveryRate: teamDials ? Number(((teamRecovered / teamDials) * 100).toFixed(1)) : 0,
      uniqueProspects: new Set(attempts.map((a) => a.prospect_key)).size,
      agentsActive: agentRows.filter((a) => a.dials > 0).length,
      outcomes: teamOutcomes,
    },
    byAgent: agentRows,
    listPerformance,
    dayHistory,
    leaderboard,
    queueLeftover: leftover,
    callDetails,
  };
}

export function reportsToCsv(data: Awaited<ReturnType<typeof buildReports>>): string {
  const lines: string[] = [];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  lines.push(`Recovery Lists report`);
  lines.push(`Range,${esc(data.range.label)}`);
  lines.push(`Timezone,${esc(data.timezone)}`);
  lines.push(`Generated,${esc(data.generatedAt)}`);
  lines.push("");
  lines.push(`Team dials,${data.team.dials}`);
  lines.push(`Team recovered,${data.team.recovered}`);
  lines.push(`Team recovery rate %,${data.team.recoveryRate}`);
  lines.push(`Unique prospects,${data.team.uniqueProspects}`);
  lines.push("");

  lines.push(
    [
      "Agent",
      "Username",
      "Dials",
      "Unique prospects",
      "Recovered",
      "Recovery rate %",
      "Dials/hour",
      "Active hours",
      "Assigned statuses",
      "Assigned attempt lists",
      "Assigned additional lists",
      ...ATTEMPT_OUTCOMES,
    ].join(","),
  );
  for (const a of data.byAgent) {
    lines.push(
      [
        a.displayName,
        a.username,
        a.dials,
        a.uniqueProspects,
        a.recovered,
        a.recoveryRate,
        a.dialsPerHour,
        a.activeHours,
        a.assignedStatusNames.join("; "),
        a.assignedAttemptBuckets.join("; "),
        a.assignedManualListNames.join("; "),
        ...ATTEMPT_OUTCOMES.map((o) => a.outcomes[o] || 0),
      ]
        .map(esc)
        .join(","),
    );
  }

  lines.push("");
  lines.push(["List", "Dials", "Recovered", "Recovery rate %"].join(","));
  for (const l of data.listPerformance) {
    lines.push([l.status, l.dials, l.recovered, l.recoveryRate].map(esc).join(","));
  }

  lines.push("");
  lines.push(["Day", "Dials", "Recovered"].join(","));
  for (const d of data.dayHistory) {
    lines.push([d.day, d.dials, d.recovered].map(esc).join(","));
  }

  lines.push("");
  lines.push("Call details (one row per dial)");
  lines.push(
    [
      "Dialed at",
      "List source",
      "List",
      "Client name",
      "Phone",
      "Agent",
      "Username",
      "Outcome",
      "Recovered",
      "Agent feedback",
      "Notes",
      "Address",
      "Project",
      "List status",
      "Prospect key",
      "Prospect ID",
      "Lead ID",
      "Sheet row",
      "Lead marked DNC",
      "Attempt ID",
    ].join(","),
  );
  for (const c of data.callDetails) {
    lines.push(
      [
        c.dialedAt,
        c.listSource,
        c.listName,
        c.leadName,
        c.phone,
        c.agentDisplayName,
        c.agentUsername,
        c.outcome,
        c.recovered,
        c.agentFeedback,
        joinNotes(c.agentFeedback, c.leadNotes),
        c.address,
        c.project,
        c.listStatus,
        c.prospectKey,
        c.prospectId,
        c.sheetLeadId,
        c.sheetRowIndex,
        c.leadMarkedDnc,
        c.attemptId,
      ]
        .map(esc)
        .join(","),
    );
  }

  return lines.join("\n");
}
