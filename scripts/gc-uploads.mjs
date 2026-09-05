// scripts/gc-uploads.mjs
// Garbage Collector de /uploads (Etapa 4b). docs/PLAN-ETAPA4B-GC-PAPELERA.md.
//
// Modos:  --dry-run (default, NO muta nada) | --apply
// Pasos (en orden), NUNCA toca /uploads/avatars/:
//   1. Organiza planos referenciados  → mueve el suelto a su carpeta + reescribe la BD (cierra Fuga 1).
//   2. Encuarentena huérfanos          → MUEVE a _huerfanos/ + fila en uploads_cuarentena. Gracia 24 h.
//   3. Rescata                         → si un huérfano volvió a estar referenciado, regresa a su sitio.
//   4. Purga                           → 30 días cumplidos: borrado físico + estado='borrado' + bitácora.
//   5. Borra carpetas vacías + reporte.
// Tras --apply: notificaciones AGREGADAS (conteo) a admins (≤7d normal, ≤24h alta), máx 2/día, sin repetir.
//
// Reutiliza collectReferences() (reorg-sources) y storagePathFor()/uploadUrlToAbsPath() (dist/storage.js),
// la MISMA fuente de verdad que el auditor y el reorganizador.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCHEMA = "gozz";

// --- Cargar entorno ANTES de importar módulos que leen UPLOADS_DIR al cargar (storage.js) ---
if (!process.env.DATABASE_URL || !process.env.UPLOADS_DIR) {
  try { const m = await import("dotenv"); (m.default ?? m).config({ path: path.join(ROOT, "apps", "api", ".env") }); }
  catch (e) { console.warn("[gc] no se pudo cargar dotenv:", e?.message || e); }
}
const DATABASE_URL = process.env.DATABASE_URL;
const UPLOADS_ROOT = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
if (!DATABASE_URL) { console.error("[gc] FALTA DATABASE_URL. Abortando."); process.exit(1); }

// --- Imports dinámicos (tras fijar el entorno) ---
const HELPER_PATH = path.join(ROOT, "apps", "api", "dist", "lib", "storage.js");
if (!fs.existsSync(HELPER_PATH)) {
  console.error("Falta compilar el helper. Corre primero: pnpm --filter @gozz/api build");
  process.exit(1);
}
const { uploadUrlToAbsPath } = await import(pathToFileURL(HELPER_PATH).href);
const { collectReferences } = await import("./lib/reorg-sources.mjs");
const { updateReference } = await import("./lib/reorg-db.mjs");
const { collectAllReferencedKeys } = await import("./lib/uploads-refs.mjs");

// --- Flags ---
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const MODE = APPLY ? "apply" : "dry-run";

const HUERFANOS = "_huerfanos";
const CONSERVADOS = "_conservados";
const EXCLUIR_RAIZ = new Set([HUERFANOS, CONSERVADOS, "avatars", "reorg-report"]);
const GRACIA_MS = 24 * 60 * 60 * 1000;

// --- Utilidades ---
async function walk(dir, baseRel = "") {
  let out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (baseRel === "" && EXCLUIR_RAIZ.has(ent.name)) continue;   // nunca avatars/, _huerfanos/, etc.
      out = out.concat(await walk(path.join(dir, ent.name), rel));
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

const MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm",
  mp4: "video/mp4", txt: "text/plain", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
function guessMime(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return MIME[ext] || null;
}
function parseSubidoEn(filename, st) {
  const m = filename.match(/^(\d{12,})/);
  if (m) { const t = Number(m[1]); if (t > 1000000000000 && t < 4102444800000) return new Date(t); }
  return new Date(st.mtimeMs);
}

// --- Paso 1: organiza planos referenciados (mueve el suelto a su carpeta + reescribe la BD) ---
async function step1(client, refs, stats) {
  const movido = new Set();
  for (const r of refs) {
    if (!r.new_url || !r.dirRel) continue;
    if (!/^\/uploads\/[^/]+$/.test(r.old_url)) continue;         // solo planos en la raíz
    if (r.old_url.startsWith("/uploads/avatars/")) continue;     // avatares nunca
    const srcAbs = uploadUrlToAbsPath(r.old_url);
    if (!fs.existsSync(srcAbs) && !movido.has(r.fileKey)) continue; // no está en disco → lo verá el barrido
    const destRel = `${r.dirRel}/${r.filename}`;
    const destAbs = path.join(UPLOADS_ROOT, destRel);
    try {
      if (APPLY) {
        if (!fs.existsSync(destAbs)) {
          fs.mkdirSync(path.dirname(destAbs), { recursive: true });
          if (fs.existsSync(srcAbs)) fs.renameSync(srcAbs, destAbs);
        }
        await updateReference(client, r);
        movido.add(r.fileKey);
      }
      stats.organizados++;
    } catch (e) { stats.errores++; console.error("[gc step1]", r.old_url, "→", e?.message || e); }
  }
}

// --- Adopta los _huerfanos/ preexistentes (sin fila en uploads_cuarentena) ---
// Primera corrida: los que ya estaban en _huerfanos/ (etapas anteriores) eran invisibles y nunca se
// purgaban. Les damos de alta con cuarentena_en = now() (el reloj de 30 días arranca hoy). Idempotente.
async function adoptHuerfanos(client, stats) {
  const dir = path.join(UPLOADS_ROOT, HUERFANOS);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const filename = ent.name;
    let st;
    try { st = fs.statSync(path.join(dir, filename)); } catch { continue; }
    const r = await client.query(
      `insert into ${SCHEMA}.uploads_cuarentena
         (filename, url_original, path_actual, tamano_bytes, mime, subido_en, cuarentena_en, purgar_en, estado)
       values ($1, null, $2, $3, $4, $5, now(), now() + interval '30 days', 'cuarentena')
       on conflict (filename) do nothing`,
      [filename, `${HUERFANOS}/${filename}`, st.size, guessMime(filename), parseSubidoEn(filename, st)]
    );
    if (r.rowCount > 0) stats.adoptados++;
  }
}

// --- Paso 2: encuarentena huérfanos (MUEVE a _huerfanos/ + fila en uploads_cuarentena) ---
// Usa la RED ANCHA (allKeys): un archivo referenciado por CUALQUIER columna NO se toca.
async function step2(client, allKeys, stats) {
  const disk = await walk(UPLOADS_ROOT);
  const now = Date.now();
  for (const rel of disk) {
    if (allKeys.has(rel)) continue;
    if (rel.startsWith("avatars/")) continue;                    // defensa extra
    const abs = path.join(UPLOADS_ROOT, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (now - st.mtimeMs < GRACIA_MS) { stats.saltados_gracia++; continue; }   // gracia 24 h
    const filename = path.posix.basename(rel);
    const destRel = `${HUERFANOS}/${filename}`;
    const moverAHuerfanos = () => {
      fs.mkdirSync(path.join(UPLOADS_ROOT, HUERFANOS), { recursive: true });
      if (fs.existsSync(abs)) fs.renameSync(abs, path.join(UPLOADS_ROOT, destRel));
    };

    // ¿Ya hay una fila para este filename? (evita el ON CONFLICT que descartaba el caso).
    const existing = (await client.query(
      `select id, estado, path_actual from ${SCHEMA}.uploads_cuarentena where filename = $1`, [filename])).rows[0];

    if (existing) {
      const canonAbs = existing.path_actual ? path.join(UPLOADS_ROOT, existing.path_actual) : null;
      const canonExiste = canonAbs ? fs.existsSync(canonAbs) : false;

      if ((existing.estado === "cuarentena" || existing.estado === "conservado") && canonExiste) {
        // (a) DUPLICADO: el canónico está a salvo (con sus 30 días). La copia suelta de la raíz sobra.
        if (APPLY) {
          let existia = false;
          try { fs.unlinkSync(abs); existia = true; } catch { existia = false; }
          await client.query(
            `insert into ${SCHEMA}.uploads_borrados (url, filename, origen, motivo, existia, borrado_por)
             values ($1,$2,'gc_duplicado',$3,$4,null)`,
            [`/uploads/${rel}`, filename, "Copia suelta duplicada de un archivo ya en la papelera", existia]
          );
        }
        stats.duplicados++;
        continue;
      }

      // (b) estado='borrado' o el canónico ya no existe → huérfano nuevo: mover + ACTUALIZAR la fila.
      if (APPLY) {
        moverAHuerfanos();
        await client.query(
          `update ${SCHEMA}.uploads_cuarentena
              set estado='cuarentena', path_actual=$2, url_original=$3, tamano_bytes=$4, mime=$5,
                  subido_en=$6, cuarentena_en=now(), purgar_en=now() + interval '30 days',
                  borrado_en=null, borrado_por=null, conservado_en=null, conservado_por=null
            where id=$1`,
          [existing.id, destRel, `/uploads/${rel}`, st.size, guessMime(filename), parseSubidoEn(filename, st)]
        );
      }
      stats.encuarentena++;
      continue;
    }

    // Sin fila previa → huérfano nuevo: mover + insertar.
    if (APPLY) {
      moverAHuerfanos();
      await client.query(
        `insert into ${SCHEMA}.uploads_cuarentena
           (filename, url_original, path_actual, tamano_bytes, mime, subido_en, cuarentena_en, purgar_en, estado)
         values ($1,$2,$3,$4,$5,$6, now(), now() + interval '30 days', 'cuarentena')
         on conflict (filename) do nothing`,
        [filename, `/uploads/${rel}`, destRel, st.size, guessMime(filename), parseSubidoEn(filename, st)]
      );
    }
    stats.encuarentena++;
  }
}

// --- Paso 3: rescata (huérfano que volvió a estar referenciado → regresa a su sitio) ---
// Usa la RED ANCHA por nombre de archivo. Sin LIKE: el "_" es comodín de LIKE y los nombres de
// archivo están llenos de guiones bajos (daría falsos positivos).
async function step3(client, allKeys, stats) {
  // basename → fileKey al que la BD apunta HOY (destino correcto del rescate).
  const keyByBasename = new Map();
  for (const k of allKeys) keyByBasename.set(k.split("/").pop(), k);
  const rows = (await client.query(
    `select id, filename, url_original, path_actual from ${SCHEMA}.uploads_cuarentena where estado='cuarentena'`)).rows;
  for (const q of rows) {
    if (!keyByBasename.has(q.filename)) continue;   // no volvió a estar referenciado
    if (APPLY) {
      // Destino = el fileKey de la red ancha (dónde apunta la BD hoy). url_original solo como respaldo
      // (puede ser null en los adoptados o una ruta plana obsoleta → dejaría el enlace roto).
      const destRel = keyByBasename.get(q.filename) || (q.url_original || "").replace(/^\/uploads\//, "") || q.filename;
      const dest = path.join(UPLOADS_ROOT, destRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const src = path.join(UPLOADS_ROOT, q.path_actual || `${HUERFANOS}/${q.filename}`);
      if (fs.existsSync(src)) fs.renameSync(src, dest);
      await client.query(`delete from ${SCHEMA}.uploads_cuarentena where id=$1`, [q.id]);
    }
    stats.rescatados++;
  }
}

// --- Paso 4: purga (30 días cumplidos → borrado físico + bitácora) ---
async function step4(client, stats) {
  const rows = (await client.query(
    `select id, filename, url_original, path_actual from ${SCHEMA}.uploads_cuarentena
      where estado='cuarentena' and purgar_en <= now()`)).rows;
  for (const q of rows) {
    if (APPLY) {
      let existia = false;
      if (q.path_actual) { try { fs.unlinkSync(path.join(UPLOADS_ROOT, q.path_actual)); existia = true; } catch { existia = false; } }
      await client.query(`update ${SCHEMA}.uploads_cuarentena set estado='borrado', borrado_en=now(), borrado_por=null where id=$1`, [q.id]);
      await client.query(
        `insert into ${SCHEMA}.uploads_borrados (url, filename, origen, motivo, existia, borrado_por)
         values ($1,$2,'gc_purga',$3,$4,null)`,
        [q.url_original, q.filename, "Purga automática tras 30 días en cuarentena", existia]
      );
    }
    stats.purgados++;
  }
}

// --- Paso 5: carpetas vacías ---
function removeEmptyDirs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  if (dir !== UPLOADS_ROOT) {
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
  }
}

// --- Notificaciones (agregadas, solo admins, tras --apply) ---
async function notificar(client) {
  const c = (await client.query(
    `select
       count(*) filter (where purgar_en <= now() + interval '7 days')  as b7,
       count(*) filter (where purgar_en <= now() + interval '24 hours') as b24
     from ${SCHEMA}.uploads_cuarentena where estado='cuarentena'`)).rows[0];
  const b7 = Number(c?.b7 || 0), b24 = Number(c?.b24 || 0);
  const admins = (await client.query(
    `select id from ${SCHEMA}.users where activo=true and nivel_acceso in ('admin','super_admin')`)).rows;
  const ACCION_URL = "/configuracion/archivos-sin-identificar";
  const notifs = [
    b7 > 0 ? { tipo: "uploads_gc_7d", prioridad: "normal", titulo: "Archivos sin identificar", mensaje: `${b7} archivo(s) sin identificar se borrarán en 7 días o menos` } : null,
    b24 > 0 ? { tipo: "uploads_gc_24h", prioridad: "alta", titulo: "Archivos sin identificar", mensaje: `${b24} archivo(s) sin identificar se borrarán en menos de 24 horas` } : null,
  ].filter(Boolean);
  for (const n of notifs) {
    for (const a of admins) {
      // No repetir si ya existe una sin leer del mismo tipo creada hoy.
      await client.query(
        `insert into ${SCHEMA}.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
         select $1,$2,$3,$4,$5,$6
         where not exists (
           select 1 from ${SCHEMA}.notificaciones
            where user_id=$1 and tipo=$2 and leida=false and created_at::date = current_date)`,
        [a.id, n.tipo, n.titulo, n.mensaje, n.prioridad, ACCION_URL]
      );
    }
  }
  return { b7, b24, admins: admins.length };
}

// --- Main ---
async function main() {
  console.log(`=== GC de /uploads — modo: ${MODE} ===`);
  console.log("Schema:", SCHEMA, "| UPLOADS_ROOT:", UPLOADS_ROOT);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const stats = { organizados: 0, adoptados: 0, encuarentena: 0, duplicados: 0, saltados_gracia: 0, rescatados: 0, purgados: 0, errores: 0 };
  try {
    // Paso 1 (MOVE-net: collectReferences, la misma del reorganizador — solo mueve planos referenciados).
    const { refs } = await collectReferences(client, {});
    await step1(client, refs, stats);
    // Adopta los _huerfanos/ preexistentes (les crea fila de cuarentena con el reloj desde hoy).
    if (APPLY) await adoptHuerfanos(client, stats);
    // DELETE-net: red ANCHA que NO salta ninguna fuente (contenido JSON de sistema, link_preview,
    // metadata, foto_perfil_url, drive_files...). Se computa TRAS el Paso 1 (la BD pudo cambiar).
    const allKeys = await collectAllReferencedKeys(client);
    // Pasos 2–4
    await step2(client, allKeys, stats);
    await step3(client, allKeys, stats);
    await step4(client, stats);
    // Paso 5
    if (APPLY) removeEmptyDirs(UPLOADS_ROOT);
    // Notificaciones (solo apply)
    let notif = null;
    if (APPLY) notif = await notificar(client);

    console.log("\n──────────── RESUMEN (" + MODE + ") ────────────");
    console.log("  organizados (planos → carpeta):", stats.organizados);
    console.log("  adoptados (_huerfanos previos): ", stats.adoptados);
    console.log("  encuarentenados (→ _huerfanos):", stats.encuarentena);
    console.log("  duplicados sueltos borrados:   ", stats.duplicados);
    console.log("  saltados por gracia 24 h:      ", stats.saltados_gracia);
    console.log("  rescatados (volvieron a uso):  ", stats.rescatados);
    console.log("  purgados (30 días cumplidos):  ", stats.purgados);
    console.log("  errores:                       ", stats.errores);
    if (notif) console.log(`  notificaciones: ≤7d=${notif.b7} ≤24h=${notif.b24} a ${notif.admins} admins`);
    if (!APPLY) console.log("\n(dry-run: no se movió/borró/insertó nada. Corre con --apply para aplicar.)");
    console.log("──────────────────────────────────────────────");
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error("[gc] error fatal:", e); process.exit(1); });
