import { readdir, readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim() ?? "";
const files = (await readdir("migrations").catch(() => []))
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (url === "" || files.length === 0) {
  console.log("migrate: nothing to do");
  process.exit(0);
}
// The session lock needs a direct connection: DATABASE_URL may go through a
// transaction pooler, which would keep the lock after this script exits.
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || url,
});
await client.connect();
try {
  await client.query("set lock_timeout = '60s'");
  await client.query("select pg_advisory_lock(7272741)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await client.query("select name from schema_migrations")).rows.map((r) => r.name),
  );
  for (const file of files.filter((f) => !done.has(f))) {
    await client.query("begin");
    try {
      await client.query(await readFile(`migrations/${file}`, "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`migrate: applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  // Optional deploy-time first admin (never HTTP). Same lock + app_bootstrap guard.
  const username = (process.env.ADMIN_USERNAME || "").trim();
  const email = (process.env.ADMIN_EMAIL || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  const displayName = (process.env.ADMIN_DISPLAY_NAME || username).trim() || username;
  if (username && email && password.length >= 10) {
    await client.query("select pg_advisory_lock(7272750)");
    try {
      const count = await client.query("SELECT COUNT(*) AS c FROM users");
      const userCount = Number(count.rows[0]?.c ?? 0);
      const boot = await client.query("SELECT id FROM app_bootstrap WHERE id = 1").catch(() => ({
        rows: [],
      }));
      if (userCount === 0 && !boot.rows[0]) {
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
          console.log(`migrate: created first admin username=${user.username}`);
        } catch {
          await client.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => undefined);
          console.log("migrate: first admin already created by another runner");
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock(7272750)").catch(() => undefined);
    }
  }
} finally {
  await client.end();
}
