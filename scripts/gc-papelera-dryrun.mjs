#!/usr/bin/env node
// DRY-RUN (read-only) del GC de la papelera del Drive (Fase B2). Lista la CUARENTENA VENCIDA
// (ciclo='cuarentena' AND purgar_en < now()) y, por cada sha256, indica si su objeto R2 se BORRARÍA (huérfano)
// o se PRESERVARÍA (referenciado por otra fila de drive_files fuera del batch, o por uploads_r2_backup).
// NO borra nada. Correr desde el worktree de diagnóstico con DATABASE_URL a crm_staging:
//   node scripts/gc-papelera-dryrun.mjs [--sample N]

import pg from "pg";
import "dotenv/config";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL missing");
const sampleN = (() => { const i = process.argv.indexOf("--sample"); return i >= 0 ? Math.max(0, parseInt(process.argv[i + 1] || "20", 10) || 20) : 20; })();
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  // Candidatos: cuarentena vencida.
  const { rows: cand } = await pool.query(
    `SELECT id, sha256, r2_key, nombre FROM gozz.drive_files WHERE ciclo = 'cuarentena' AND purgar_en < now()`
  );
  const conSha = cand.filter((c) => c.sha256);
  const sinSha = cand.length - conSha.length;

  // Por sha distinto del batch: total refs en drive_files, refs dentro del batch, refs en uploads_r2_backup.
  const { rows: perSha } = await pool.query(
    `WITH cand AS (
       SELECT id, sha256 FROM gozz.drive_files
        WHERE ciclo='cuarentena' AND purgar_en < now() AND sha256 IS NOT NULL
     ),
     shas AS (SELECT DISTINCT sha256 FROM cand)
     SELECT s.sha256,
            (SELECT count(*)::int FROM gozz.drive_files df WHERE df.sha256 = s.sha256)      AS total_drive,
            (SELECT count(*)::int FROM cand c WHERE c.sha256 = s.sha256)                        AS en_batch,
            (SELECT count(*)::int FROM gozz.uploads_r2_backup b WHERE b.sha256 = s.sha256)  AS en_backup
       FROM shas s`
  );

  let borrarR2 = 0, preservarPorDrive = 0, preservarPorBackup = 0;
  const ejemplosBorrar = [];
  for (const r of perSha) {
    const refsFuera = r.total_drive - r.en_batch;   // filas de drive_files fuera del batch
    const wouldDelete = refsFuera === 0 && r.en_backup === 0;
    if (wouldDelete) { borrarR2++; if (ejemplosBorrar.length < sampleN) ejemplosBorrar.push(r.sha256); }
    else { if (refsFuera > 0) preservarPorDrive++; else if (r.en_backup > 0) preservarPorBackup++; }
  }

  console.log("=== DRY-RUN GC papelera del Drive (cuarentena vencida) ===");
  console.log(`Filas a purgar (cuarentena vencida): ${cand.length}  ·  con sha: ${conSha.length}  ·  sin sha (no se toca R2): ${sinSha}`);
  console.log(`Objetos R2 (sha distintos) involucrados: ${perSha.length}`);
  console.log(`  → se BORRARÍAN de R2 (huérfanos): ${borrarR2}`);
  console.log(`  → se PRESERVARÍAN por otra fila de drive_files fuera del batch: ${preservarPorDrive}`);
  console.log(`  → se PRESERVARÍAN por uploads_r2_backup (backup de /uploads): ${preservarPorBackup}`);
  if (ejemplosBorrar.length) {
    console.log(`\nEjemplos de sha que se borrarían de R2 (hasta ${sampleN}):`);
    for (const s of ejemplosBorrar) console.log(`  ${s}  →  objects/${s.slice(0, 2)}/${s.slice(2, 4)}/${s}`);
  }
  console.log("\n(NADA se borró — es dry-run.)");
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(2); });
