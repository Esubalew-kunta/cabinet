/*
 * run-sql.mjs — run a migration file (or an inline query) against Supabase Postgres.
 * Reads SUPABASE_DB_URL from .env.local (never committed).
 *
 *   node scripts/run-sql.mjs supabase/migrations/005_audit_log.sql   # run a file
 *   node scripts/run-sql.mjs -c "select 1 as ok"                     # inline query
 *
 * DDL-capable (CREATE/ALTER/policies). Prints rows for SELECTs, "OK" otherwise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const url = process.env.SUPABASE_DB_URL;
if (!url || url.includes("[YOUR-PASSWORD]")) {
  console.error("✗ SUPABASE_DB_URL is missing or still has the [YOUR-PASSWORD] placeholder in .env.local");
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/run-sql.mjs <file.sql> | -c \"SQL\"");
  process.exit(2);
}
const sql = arg === "-c" ? process.argv.slice(3).join(" ") : readFileSync(resolve(root, arg), "utf8");
const label = arg === "-c" ? "(inline)" : arg;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const res = await client.query(sql);
  const results = Array.isArray(res) ? res : [res];
  for (const r of results) {
    if (r.rows && r.rows.length) console.table(r.rows);
    else console.log(`✓ ${r.command ?? "OK"}${typeof r.rowCount === "number" ? ` (${r.rowCount})` : ""}`);
  }
  console.log(`✓ ran ${label}`);
} catch (e) {
  console.error(`✗ failed on ${label}:`, e.message);
  if (/ENETUNREACH|ETIMEDOUT|ENOTFOUND/.test(e.message)) {
    console.error("  Hint: the direct db.<ref>.supabase.co host may be IPv6-only. Use the *Session pooler* URI instead (…pooler.supabase.com).");
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
