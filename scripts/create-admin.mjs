/**
 * Offline first-admin creation (not exposed over HTTP).
 *
 *   ADMIN_USERNAME=admin ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-10' \
 *     npm run create-admin
 */
import { readdir, readFile, mkdir } from "node:fs/promises";
import bcrypt from "bcryptjs";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

const username = (process.env.ADMIN_USERNAME || "").trim();
const email = (process.env.ADMIN_EMAIL || "").trim();
const password = process.env.ADMIN_PASSWORD || "";
const displayName = (process.env.ADMIN_DISPLAY_NAME || username).trim() || username;
const databaseUrl = process.env.DATABASE_URL?.trim() || "";
const LOCK_KEY = 7272750;

if (!username || !email || password.length < 10) {
  console.error(
    "Need ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD (min 10 chars).",
  );
  process.exit(1);
}

async function withPg(run) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || databaseUrl,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function withPglite(run) {
  const dataDir = `${process.cwd()}/data/pglite`;
  await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const doneRows = await db.query("SELECT name FROM schema_migrations");
  const done = new Set(doneRows.rows.map((r) => r.name));
  const files = (await readdir("migrations").catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (done.has(file)) continue;
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
  }
  return run({
    query: (text, params = []) => db.query(text, params),
  });
}

async function createAdmin(client) {
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    locked = true;
  } catch {
    locked = false;
  }

  try {
    const count = await client.query("SELECT COUNT(*) AS c FROM users");
    const userCount = Number(count.rows[0]?.c ?? 0);
    if (userCount > 0) {
      throw new Error("Users already exist — refusing to create first admin.");
    }

    let bootRows = [];
    try {
      const boot = await client.query("SELECT id FROM app_bootstrap WHERE id = 1");
      bootRows = boot.rows;
    } catch {
      bootRows = [];
    }
    if (bootRows[0]) {
      throw new Error("First admin already created — refusing.");
    }

    const hash = bcrypt.hashSync(password, 10);
    const inserted = await client.query(
      `INSERT INTO users (username, email, password_hash, display_name, role, must_change_password)
       VALUES ($1, $2, $3, $4, 'admin', 0)
       RETURNING id, username`,
      [username, email, hash, displayName],
    );
    const user = inserted.rows[0];
    try {
      await client.query(
        `INSERT INTO app_bootstrap (id, completed_at, admin_user_id) VALUES (1, $1, $2)`,
        [new Date().toISOString(), user.id],
      );
    } catch {
      await client.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => undefined);
      throw new Error("First admin already created — refusing.");
    }
    console.log(`Created admin id=${user.id} username=${user.username}`);
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [LOCK_KEY])
        .catch(() => undefined);
    }
  }
}

try {
  if (databaseUrl) await withPg(createAdmin);
  else await withPglite(createAdmin);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
