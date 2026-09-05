#!/usr/bin/env node
// GATE BLOQUEANTE (read-only) del guardrail R2 de la Fase B2 (GC/borrado permanente).
//
// Toma el set candidato (cuarentena vencida = lo que el GC purgaría), deriva los sha256 que el núcleo MARCARÍA
// para borrado de R2 (huérfanos: 0 refs en drive_files fuera del batch AND 0 refs en uploads_r2_backup) y luego,
// con una consulta INDEPENDIENTE (por-sha, con exclusión explícita del batch), verifica que NINGUNO tenga una
// referencia sobreviviente. Si UN solo sha marcado para borrado tiene una referencia viva → ❌ FUGA (exit 1):
// NO se habilita el loop real hasta que dé 0 fugas.
//
//   node scripts/verificar-gc-papelera.mjs [--verbose]

import pg from "pg";
import "dotenv/config";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL missing");
const VERBOSE = process.argv.includes("--verbose");
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  const { rows: cand } = await pool.query(
    `SELECT id, sha256 FROM gozz.drive_files WHERE ciclo = 'cuarentena' AND purgar_en < now()`
  );
  const batchIds = cand.map((c) => c.id);
  const shasBatch = Array.from(new Set(cand.map((c) => c.sha256).filter(Boolean)));
  if (batchIds.length === 0) { console.log("No hay cuarentena vencida (0 candidatos). Nada que validar → ✅"); await pool.end(); return; }

  // Paso 1 — derivar los sha que el NÚCLEO borraría de R2 (huérfanos), con conteos.
  const { rows: perSha } = await pool.query(
    `WITH cand AS (
       SELECT id, sha256 FROM gozz.drive_files
        WHERE ciclo='cuarentena' AND purgar_en < now() AND sha256 IS NOT NULL
     ),
     shas AS (SELECT DISTINCT sha256 FROM cand)
     SELECT s.sha256,
            (SELECT count(*)::int FROM gozz.drive_files df WHERE df.sha256 = s.sha256)     AS total_drive,
            (SELECT count(*)::int FROM cand c WHERE c.sha256 = s.sha256)                       AS en_batch,
            (SELECT count(*)::int FROM gozz.uploads_r2_backup b WHERE b.sha256 = s.sha256) AS en_backup
       FROM shas s`
  );
  const marcadosBorrar = perSha.filter((r) => (r.total_drive - r.en_batch) === 0 && r.en_backup === 0).map((r) => r.sha256);

  // Paso 2 — verificación INDEPENDIENTE: por cada sha marcado, ¿existe ALGUNA fila sobreviviente que lo use?
  //   (drive_files con id FUERA del batch, cualquier ciclo/deleted_at)  OR  (uploads_r2_backup).
  let fugas = 0;
  for (const sha of marcadosBorrar) {
    const { rows } = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM gozz.drive_files df WHERE df.sha256 = $1 AND NOT (df.id = ANY($2::uuid[]))) AS ref_drive_fuera,
              EXISTS(SELECT 1 FROM gozz.uploads_r2_backup b WHERE b.sha256 = $1)                              AS ref_backup`,
      [sha, batchIds]
    );
    const { ref_drive_fuera, ref_backup } = rows[0];
    if (ref_drive_fuera || ref_backup) {
      fugas++;
      console.log(`❌ FUGA: sha ${sha} marcado para borrar R2 pero referenciado — drive_fuera=${ref_drive_fuera} backup=${ref_backup}`);
    } else if (VERBOSE) {
      console.log(`ok  ${sha} (huérfano confirmado)`);
    }
  }

  console.log("");
  console.log(`Candidatos (cuarentena vencida): ${batchIds.length}  ·  sha distintos: ${shasBatch.length}`);
  console.log(`Objetos R2 marcados para borrado (huérfanos): ${marcadosBorrar.length}`);
  console.log(`Preservados por uploads_r2_backup: ${perSha.filter((r) => (r.total_drive - r.en_batch) === 0 && r.en_backup > 0).length}  ·  por drive_files fuera del batch: ${perSha.filter((r) => (r.total_drive - r.en_batch) > 0).length}`);
  if (fugas === 0) console.log("✅ 0 FUGAS: ningún objeto R2 marcado para borrado está referenciado por una fila sobreviviente. Guardrail OK.");
  else console.log(`❌ ${fugas} FUGA(S) — NO habilitar el GC/borrado real hasta resolver.`);
  await pool.end();
  process.exit(fugas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
