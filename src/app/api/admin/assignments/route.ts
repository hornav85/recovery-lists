import { NextResponse } from "next/server";
import { ATTEMPT_BUCKETS, type AttemptBucketId } from "@/lib/attempts";
import { saveAssignmentSnapshot } from "@/lib/assignments";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads, sql } from "@/lib/db";

async function assignmentsByUserMap() {
  const rows = await sql<{ user_id: number; status_id: number }>(
    `SELECT user_id, status_id FROM agent_assignments`,
  );
  const map: Record<string, number[]> = {};
  for (const row of rows) {
    const key = String(row.user_id);
    if (!map[key]) map[key] = [];
    map[key].push(row.status_id);
  }
  return map;
}

async function attemptAssignmentsByUserMap() {
  const rows = await sql<{ user_id: number; bucket: string }>(
    `SELECT user_id, bucket FROM agent_attempt_assignments`,
  );
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    const key = String(row.user_id);
    if (!map[key]) map[key] = [];
    map[key].push(row.bucket);
  }
  return map;
}

async function manualAssignmentsByUserMap() {
  const rows = await sql<{ user_id: number; list_id: number }>(
    `SELECT user_id, list_id FROM manual_list_assignments`,
  );
  const map: Record<string, number[]> = {};
  for (const row of rows) {
    const key = String(row.user_id);
    if (!map[key]) map[key] = [];
    map[key].push(row.list_id);
  }
  return map;
}

export async function GET(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const userId = Number(new URL(req.url).searchParams.get("userId"));
    const statuses = await sql<{ id: number; name: string; active: number }>(
      `SELECT id, name, active FROM list_statuses ORDER BY name`,
    );

    const assignmentsByUser = await assignmentsByUserMap();
    const attemptAssignmentsByUser = await attemptAssignmentsByUserMap();
    const manualLists = await sql<{ id: number; name: string }>(
      `SELECT id, name FROM manual_lists ORDER BY name`,
    );
    const manualAssignmentsByUser = await manualAssignmentsByUserMap();
    const attemptBuckets = ATTEMPT_BUCKETS.map((b) => ({ id: b.id, label: b.label }));

    if (!Number.isFinite(userId)) {
      return NextResponse.json({
        statuses,
        assignmentsByUser,
        attemptBuckets,
        attemptAssignmentsByUser,
        manualLists,
        manualAssignmentsByUser,
      });
    }

    return NextResponse.json({
      statuses,
      assignedStatusIds: assignmentsByUser[String(userId)] || [],
      assignmentsByUser,
      attemptBuckets,
      assignedAttemptBuckets: attemptAssignmentsByUser[String(userId)] || [],
      attemptAssignmentsByUser,
      manualLists,
      assignedManualListIds: manualAssignmentsByUser[String(userId)] || [],
      manualAssignmentsByUser,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function PUT(req: Request) {
  try {
    await ensureFixtureLeads();
    const admin = await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const userId = Number(body.userId);
    const statusIds = Array.isArray(body.statusIds)
      ? body.statusIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];
    const validBuckets = new Set(ATTEMPT_BUCKETS.map((b) => b.id));
    const attemptBuckets = Array.isArray(body.attemptBuckets)
      ? body.attemptBuckets
          .map((b: unknown) => String(b))
          .filter((b: string): b is AttemptBucketId => validBuckets.has(b as AttemptBucketId))
      : [];
    const manualListIds = Array.isArray(body.manualListIds)
      ? body.manualListIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
      : null;

    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    await sql("DELETE FROM agent_assignments WHERE user_id = $1", [userId]);
    for (const sid of statusIds) {
      await sql("INSERT INTO agent_assignments (user_id, status_id) VALUES ($1, $2)", [
        userId,
        sid,
      ]);
    }

    await sql("DELETE FROM agent_attempt_assignments WHERE user_id = $1", [userId]);
    for (const bucket of attemptBuckets) {
      await sql("INSERT INTO agent_attempt_assignments (user_id, bucket) VALUES ($1, $2)", [
        userId,
        bucket,
      ]);
    }

    if (manualListIds) {
      await sql("DELETE FROM manual_list_assignments WHERE user_id = $1", [userId]);
      for (const listId of manualListIds) {
        const exists = await sql<{ id: number }>("SELECT id FROM manual_lists WHERE id = $1", [
          listId,
        ]);
        if (!exists[0]) continue;
        await sql(
          "INSERT INTO manual_list_assignments (user_id, list_id) VALUES ($1, $2)",
          [userId, listId],
        );
      }
    }

    // Day-one history: every save becomes a dated snapshot for reports
    await saveAssignmentSnapshot(userId, admin.id);

    return NextResponse.json({
      ok: true,
      userId,
      statusIds,
      assignedStatusIds: statusIds,
      attemptBuckets,
      assignedAttemptBuckets: attemptBuckets,
      manualListIds: manualListIds || [],
      assignedManualListIds: manualListIds || (await manualAssignmentsByUserMap())[String(userId)] || [],
      assignmentsByUser: await assignmentsByUserMap(),
      attemptAssignmentsByUser: await attemptAssignmentsByUserMap(),
      manualAssignmentsByUser: await manualAssignmentsByUserMap(),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
