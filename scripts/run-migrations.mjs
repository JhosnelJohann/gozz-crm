#!/usr/bin/env node
// Runner de migraciones con tabla de control (estilo Laravel).
//
// Modos:
//   node scripts/run-migrations.mjs               -> ejecuta SOLO las pendientes (cada una en su transacción) y las registra
//   node scripts/run-migrations.mjs status        -> lista qué migraciones están aplicadas y cuáles pendientes
//   node scripts/run-migrations.mjs baseline       -> marca TODAS las migraciones actuales como aplicadas SIN ejecutarlas
//   node scripts/run-migrations.mjs baseline 0029  -> marca como aplicadas SOLO las que ordenan ANTES de "0029" (adopción de DB existente)
//
// La tabla public.schema_migrations registra cada archivo .sql aplicado, así
// nunca se re-ejecuta una migración vieja sobre datos reales.

import fs from "fs";
import path from "path";
import pg from "pg";
import "dotenv/config";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL missing");

const dir = path.resolve(process.cwd(), "packages/db/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const [, , cmd, arg] = process.argv;

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet() {
  const { rows } = await pool.query("SELECT filename FROM public.schema_migrations");
  return new Set(rows.map((r) => r.filename));
}

// ---- status ----
if (cmd === "status") {
  await ensureTable();
  const applied = await appliedSet();
  for (const f of files) console.log(`${applied.has(f) ? "[x]" : "[ ]"} ${f}`);
  const pendingCount = files.filter((f) => !applied.has(f)).length;
  console.log(`\n${applied.size} aplicada(s), ${pendingCount} pendiente(s).`);
  await pool.end();
  process.exit(0);
}

// ---- baseline ----
// Marca migraciones como aplicadas SIN ejecutarlas. Sirve para adoptar una DB que
// ya tiene el esquema. Con `arg`, solo marca las que ordenan antes de ese prefijo.
if (cmd === "baseline") {
  await ensureTable();
  const applied = await appliedSet();
  const toMark = files.filter((f) => (arg ? f < arg : true) && !applied.has(f));
  for (const f of toMark) {
    await pool.query(
      "INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [f]
    );
    console.log(`    baseline (marcada sin ejecutar): ${f}`);
  }
  console.log(`\nBaseline OK. ${toMark.length} migración(es) marcada(s)${arg ? ` (antes de ${arg})` : ""}.`);
  await pool.end();
  process.exit(0);
}

// ---- ejecutar pendientes ----
await ensureTable();
const applied = await appliedSet();
const pending = files.filter((f) => !applied.has(f));

if (pending.length === 0) {
  console.log("Sin migraciones pendientes. Todo al día.");
  await pool.end();
  process.exit(0);
}

console.log(`Pendientes: ${pending.length}`);
for (const f of pending) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  console.log(`\n>>> ${f}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1)", [f]);
    await client.query("COMMIT");
    console.log("    OK");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    console.error("    FAILED:", e.message);
    await pool.end();
    process.exit(1);
  }
  client.release();
}

await pool.end();
console.log("\nMigraciones pendientes aplicadas.");
