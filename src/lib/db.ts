import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import pg from "pg";
import { SEED_STATUSES, STATUS_RENAMES, normalizeStatus } from "./statuses";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool: pg.Pool | undefined;
let local: Promise<PGlite> | undefined;
let ready: Promise<void> | undefined;

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await pool.query(text, params)).rows as T[];
  }
  local ??= startLocal().catch((error: unknown) => {
    local = undefined;
    throw error;
  });
  return (await (await local).query<T>(text, params)).rows;
}

async function startLocal(): Promise<PGlite> {
  const { mkdir } = await import("node:fs/promises");
  const dataDir = `${process.cwd()}/data/pglite`;
  await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  const files = (await readdir("migrations").catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // Track applied migration files so 002+ can run on existing local data dirs
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const doneRows = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(doneRows.rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
  }
  return db;
}

function countOf(rows: Array<{ c: string | number | bigint }>): number {
  return Number(rows[0]?.c ?? 0);
}

async function seedIfEmpty() {
  const userCount = countOf(await sql<{ c: string | number }>("SELECT COUNT(*) AS c FROM users"));
  if (userCount === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    await sql(
      `INSERT INTO users (username, email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4, $5)`,
      ["admin", "don@local", hash, "Admin", "admin"],
    );
  }

  const statusCount = countOf(
    await sql<{ c: string | number }>("SELECT COUNT(*) AS c FROM list_statuses"),
  );
  if (statusCount === 0) {
    for (const name of SEED_STATUSES) {
      await sql(`INSERT INTO list_statuses (name, active) VALUES ($1, 1)`, [name]);
    }
  }
}

/** Rename/insert list tabs to match Column W spellings; re-normalize lead.status. */
async function alignStatusesWithColumnW() {
  for (const name of SEED_STATUSES) {
    await sql(
      `INSERT INTO list_statuses (name, active) VALUES ($1, 1)
       ON CONFLICT (name) DO UPDATE SET active = 1`,
      [name],
    );
  }

  const all = await sql<{ id: number; name: string }>("SELECT id, name FROM list_statuses");
  const byCanon = new Map<string, { id: number; name: string }>();

  for (const row of all) {
    const canon = normalizeStatus(row.name) || row.name;
    const keep = byCanon.get(canon);
    if (!keep) {
      byCanon.set(canon, row);
      if (row.name !== canon) {
        const taken = await sql<{ id: number }>(
          "SELECT id FROM list_statuses WHERE name = $1",
          [canon],
        );
        if (!taken[0]) {
          await sql("UPDATE list_statuses SET name = $1 WHERE id = $2", [canon, row.id]);
          byCanon.set(canon, { id: row.id, name: canon });
        }
      }
      continue;
    }

    const destRows = await sql<{ id: number }>(
      "SELECT id FROM list_statuses WHERE name = $1",
      [canon],
    );
    const destId =
      keep.name === canon ? keep.id : (destRows[0]?.id ?? keep.id);

    await sql(
      `INSERT INTO agent_assignments (user_id, status_id)
       SELECT user_id, $1 FROM agent_assignments WHERE status_id = $2
       ON CONFLICT DO NOTHING`,
      [destId, row.id],
    );
    await sql("DELETE FROM agent_assignments WHERE status_id = $1", [row.id]);
    if (row.id !== destId) {
      await sql("DELETE FROM list_statuses WHERE id = $1", [row.id]);
    }
  }

  for (const name of SEED_STATUSES) {
    await sql(
      `INSERT INTO list_statuses (name, active) VALUES ($1, 1)
       ON CONFLICT (name) DO UPDATE SET active = 1`,
      [name],
    );
  }

  for (const { from, to } of STATUS_RENAMES) {
    const rows = await sql<{ id: number; name: string }>(
      "SELECT id, name FROM list_statuses WHERE name = $1",
      [from],
    );
    const row = rows[0];
    if (!row) continue;
    const dest = (
      await sql<{ id: number }>("SELECT id FROM list_statuses WHERE name = $1", [to])
    )[0];
    if (!dest) {
      await sql("UPDATE list_statuses SET name = $1 WHERE id = $2", [to, row.id]);
    } else if (dest.id !== row.id) {
      await sql(
        `INSERT INTO agent_assignments (user_id, status_id)
         SELECT user_id, $1 FROM agent_assignments WHERE status_id = $2
         ON CONFLICT DO NOTHING`,
        [dest.id, row.id],
      );
      await sql("DELETE FROM agent_assignments WHERE status_id = $1", [row.id]);
      await sql("DELETE FROM list_statuses WHERE id = $1", [row.id]);
    }
  }

  const leads = await sql<{ id: number; status: string | null }>(
    "SELECT id, status FROM leads",
  );
  for (const lead of leads) {
    const next = normalizeStatus(lead.status);
    if (next !== (lead.status || "")) {
      await sql("UPDATE leads SET status = $1 WHERE id = $2", [next || null, lead.id]);
    }
  }
}

/** Ensure PGlite migrations (when local), seed, and status alignment. */
export async function ensureReady() {
  ready ??= (async () => {
    await sql("SELECT 1");
    await seedIfEmpty();
    await alignStatusesWithColumnW();
    const { bootstrapAssignmentSnapshots } = await import("./assignments");
    await bootstrapAssignmentSnapshots();
  })().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
}

/** Call after ensureReady so fixture CSV loads without circular imports. */
export async function ensureFixtureLeads() {
  await ensureReady();
  const leadCount = countOf(await sql<{ c: string | number }>("SELECT COUNT(*) AS c FROM leads"));
  if (leadCount === 0) {
    const { loadFixtureIntoDb } = await import("./sync");
    await loadFixtureIntoDb();
  }
}

export type UserRow = {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: "admin" | "agent";
  disabled: number;
  created_at: string;
};

export type PublicUser = {
  id: number;
  username: string;
  email: string;
  displayName: string;
  role: "admin" | "agent";
  disabled: boolean;
};

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    disabled: !!u.disabled,
  };
}
