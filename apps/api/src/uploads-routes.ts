// apps/api/src/uploads-routes.ts
// Endpoints de la papelera "Archivos sin identificar" (Etapa 4b). Solo admin/super_admin.
// La vista (Etapa 4c) los consume. Preview/descarga van por la ruta estática existente
// (/uploads/_huerfanos/... , /uploads/_conservados/...).
import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";

const UPLOADS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

// UNION normalizado de las dos fuentes de la vista "Archivos sin identificar", parametrizado SOLO por $1=estado.
//   Fuente 1 (disco): huérfanos legacy de /uploads (uploads_cuarentena).
//   Fuente 2 (drive): archivos del Drive en el mismo ciclo (Fase B1); sus bytes viven en R2, no en /uploads →
//     path_actual/url_original NULL (el front sirve preview/descarga por el proxy del Drive).
// Columnas derivadas comunes:
//   fecha_estado = fecha REAL de entrada al estado actual (para ordenar y para el filtro de rango de fechas):
//     cuarentena → cuarentena_en (disco) / deleted_at (drive);  conservado → conservado_en.
//     purgar_en = fecha_estado + 30d, así que ordenar por fecha_estado da el MISMO orden que el anterior (por
//     purgar_en) pero con la fecha que el usuario percibe ("eliminado el 10 jul").
//   usuario_id = responsable del estado actual (para el filtro de usuario): cuarentena → deleted_by (drive; disco
//     no guarda usuario → NULL);  conservado → conservado_por (ambas fuentes).
const UNION_SIN_IDENTIFICAR = `
  SELECT id, 'disco'::text AS origen, filename, url_original, path_actual, tamano_bytes, mime, subido_en,
         cuarentena_en, purgar_en, estado, conservado_en, conservado_por, nota,
         CASE WHEN estado = 'cuarentena' AND purgar_en IS NOT NULL
              THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (purgar_en - NOW())) / 86400))::int ELSE NULL END AS dias_restantes,
         CASE WHEN estado = 'conservado' THEN conservado_en ELSE cuarentena_en END AS fecha_estado,
         CASE WHEN estado = 'conservado' THEN conservado_por ELSE NULL END AS usuario_id
    FROM gozz.uploads_cuarentena
   WHERE estado = $1
  UNION ALL
  SELECT df.id, 'drive'::text, df.nombre, NULL::text, NULL::text, df.size_bytes, df.mime, df.created_at,
         df.deleted_at, df.purgar_en, df.ciclo, df.conservado_en, df.conservado_por, NULL::text,
         CASE WHEN df.ciclo = 'cuarentena' AND df.purgar_en IS NOT NULL
              THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (df.purgar_en - NOW())) / 86400))::int ELSE NULL END,
         CASE WHEN df.ciclo = 'conservado' THEN df.conservado_en ELSE df.deleted_at END,
         CASE WHEN df.ciclo = 'conservado' THEN df.conservado_por ELSE df.deleted_by END
    FROM gozz.drive_files df
   WHERE df.ciclo = $1`;

// Clasificación por tipo (misma taxonomía que el KindIcon del frontend). Se calcula sobre mime + extensión.
const KIND_EXPR = `
  CASE
    WHEN lower(coalesce(mime,'')) LIKE 'image/%' OR lower(coalesce(filename,'')) ~ '\\.(png|jpe?g|gif|webp|svg)$' THEN 'imagen'
    WHEN lower(coalesce(mime,'')) = 'application/pdf' OR lower(coalesce(filename,'')) ~ '\\.pdf$' THEN 'pdf'
    WHEN lower(coalesce(mime,'')) LIKE '%word%' OR lower(coalesce(filename,'')) ~ '\\.docx?$' THEN 'documento'
    WHEN lower(coalesce(mime,'')) LIKE '%sheet%' OR lower(coalesce(mime,'')) LIKE '%excel%' OR lower(coalesce(filename,'')) ~ '\\.(xlsx?|csv)$' THEN 'hoja'
    WHEN lower(coalesce(mime,'')) LIKE 'video/%' OR lower(coalesce(filename,'')) ~ '\\.(mp4|webm|mov)$' THEN 'video'
    WHEN lower(coalesce(mime,'')) LIKE 'audio/%' OR lower(coalesce(filename,'')) ~ '\\.(mp3|wav|ogg)$' THEN 'audio'
    WHEN lower(coalesce(filename,'')) ~ '\\.(zip|rar|7z|tar|gz)$' THEN 'comprimido'
    ELSE 'otro'
  END`;
const TIPOS_VALIDOS = new Set(["imagen", "pdf", "documento", "hoja", "video", "audio", "comprimido", "otro"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerUploadsRoutes(app: Express) {
  // Listado paginado server-side (offset/limit) con filtros y count(*) OVER() en la misma query.
  //   ?estado=cuarentena|conservado  ?page=1  ?pageSize=25  ?orden=desc|asc
  //   ?origen=disco|drive  ?tipo=<taxonomía>  ?usuario=<uuid>  ?desde=<ISO>  ?hasta=<ISO>
  //   ?solo_total=1 → devuelve { total } sin filas (para los badges de pestaña, sin filtros).
  // Respuesta: { archivos, total, page, pageSize, usuarios }. usuarios = facet (distintos usuarios del estado).
  app.get("/api/uploads/sin-identificar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo administradores" }); return; }
    const estado = req.query.estado === "conservado" ? "conservado" : "cuarentena";

    // Badge liviano: solo el total del estado (sin filtros, sin filas).
    if (req.query.solo_total) {
      const r = await query<any>(`SELECT count(*)::int AS total FROM ( ${UNION_SIN_IDENTIFICAR} ) f`, [estado]);
      res.json({ total: r[0]?.total ?? 0 });
      return;
    }

    // Paginación
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const offset = (page - 1) * pageSize;
    const dir = req.query.orden === "asc" ? "ASC" : "DESC"; // no interpolación de valor del usuario: literal fijo

    // Filtros (todos opcionales → NULL desactiva el predicado)
    const origen = req.query.origen === "disco" || req.query.origen === "drive" ? String(req.query.origen) : null;
    const tipo = TIPOS_VALIDOS.has(String(req.query.tipo)) ? String(req.query.tipo) : null;
    const usuario = UUID_RE.test(String(req.query.usuario)) ? String(req.query.usuario) : null;
    const parseFecha = (v: any): string | null => (v && !isNaN(Date.parse(String(v))) ? String(v) : null);
    const desde = parseFecha(req.query.desde);
    const hasta = parseFecha(req.query.hasta);

    // Filas de la página + total filtrado en un solo viaje (count(*) OVER()).
    const rows = await query<any>(
      `SELECT f.*, usr.nombre AS usuario_nombre, count(*) OVER() AS total
         FROM ( SELECT x.*, ${KIND_EXPR} AS kind FROM ( ${UNION_SIN_IDENTIFICAR} ) x ) f
         LEFT JOIN gozz.users usr ON usr.id = f.usuario_id
        WHERE ($2::text        IS NULL OR f.origen  = $2)
          AND ($3::text        IS NULL OR f.kind    = $3)
          AND ($4::uuid        IS NULL OR f.usuario_id = $4)
          AND ($5::timestamptz IS NULL OR f.fecha_estado >= $5)
          AND ($6::timestamptz IS NULL OR f.fecha_estado <= $6)
        ORDER BY f.fecha_estado ${dir} NULLS LAST, f.subido_en ${dir}
        LIMIT $7 OFFSET $8`,
      [estado, origen, tipo, usuario, desde, hasta, pageSize, offset]
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    const archivos = rows.map(({ total: _t, kind: _k, ...rest }: any) => rest);

    // Facet de usuarios presentes en el estado (para el dropdown del filtro), sin acotar por los demás filtros.
    const usuarios = await query<any>(
      `SELECT DISTINCT usr.id, usr.nombre
         FROM ( ${UNION_SIN_IDENTIFICAR} ) f
         JOIN gozz.users usr ON usr.id = f.usuario_id
        ORDER BY usr.nombre`,
      [estado]
    );

    res.json({ archivos, total, page, pageSize, usuarios });
  });

  // Conservar (rescatar): retención indefinida → mueve a _conservados/.
  app.post("/api/uploads/sin-identificar/:id/conservar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo administradores" }); return; }
    const row = (await query<any>("SELECT * FROM gozz.uploads_cuarentena WHERE id = $1", [req.params.id]))[0];
    if (!row) { res.status(404).json({ error: "Archivo no encontrado" }); return; }
    if (row.estado !== "cuarentena") { res.status(400).json({ error: "Solo se conservan archivos en cuarentena" }); return; }
    const destRel = `_conservados/${row.filename}`;
    try {
      const src = path.join(UPLOADS_DIR, row.path_actual || `_huerfanos/${row.filename}`);
      const dest = path.join(UPLOADS_DIR, destRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    } catch (e: any) { console.error("[uploads conservar] mover archivo:", e?.message || e); }
    const rows = await query<any>(
      `UPDATE gozz.uploads_cuarentena
          SET estado = 'conservado', path_actual = $1, purgar_en = NULL, conservado_en = NOW(), conservado_por = $2
        WHERE id = $3 RETURNING *`,
      [destRel, u.sub, req.params.id]
    );
    res.json({ archivo: rows[0] });
  });

  // Devolver a "sin identificar" (revertir conservar): mueve de _conservados/ a _huerfanos/ y reinicia
  // el reloj de los 30 días (cuarentena_en/purgar_en = ahora).
  app.post("/api/uploads/sin-identificar/:id/devolver", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo administradores" }); return; }
    const row = (await query<any>("SELECT * FROM gozz.uploads_cuarentena WHERE id = $1", [req.params.id]))[0];
    if (!row) { res.status(404).json({ error: "Archivo no encontrado" }); return; }
    if (row.estado !== "conservado") { res.status(400).json({ error: "Solo se devuelven archivos conservados" }); return; }
    const destRel = `_huerfanos/${row.filename}`;
    try {
      const src = path.join(UPLOADS_DIR, row.path_actual || `_conservados/${row.filename}`);
      const dest = path.join(UPLOADS_DIR, destRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    } catch (e: any) { console.error("[uploads devolver] mover archivo:", e?.message || e); }
    const rows = await query<any>(
      `UPDATE gozz.uploads_cuarentena
          SET estado = 'cuarentena', path_actual = $1, cuarentena_en = NOW(),
              purgar_en = NOW() + INTERVAL '30 days', conservado_en = NULL, conservado_por = NULL
        WHERE id = $2 RETURNING *`,
      [destRel, req.params.id]
    );
    res.json({ archivo: rows[0] });
  });

  // Borrar ya (manual): borrado físico inmediato + bitácora (origen = papelera_manual).
  app.delete("/api/uploads/sin-identificar/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo administradores" }); return; }
    const row = (await query<any>("SELECT * FROM gozz.uploads_cuarentena WHERE id = $1", [req.params.id]))[0];
    if (!row) { res.status(404).json({ error: "Archivo no encontrado" }); return; }
    let existia = false;
    if (row.path_actual) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, row.path_actual)); existia = true; } catch { existia = false; }
    }
    await query(
      `UPDATE gozz.uploads_cuarentena SET estado = 'borrado', borrado_en = NOW(), borrado_por = $1 WHERE id = $2`,
      [u.sub, req.params.id]
    );
    try {
      await query(
        `INSERT INTO gozz.uploads_borrados (url, filename, origen, motivo, existia, borrado_por)
         VALUES ($1, $2, 'papelera_manual', $3, $4, $5)`,
        [row.url_original, row.filename, "Borrado manual desde la papelera", existia, u.sub]
      );
    } catch (e: any) { console.error("[uploads_borrados papelera_manual]", e?.message || e); }
    res.json({ ok: true, existia });
  });
}
