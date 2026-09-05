import type { Express, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { emitToUser, emitToGrupo } from "./shared/socket.js";
import { sendPushToUser } from "./push.js";
import { placeUploadedFile } from "./lib/storage.js";
import { deleteUploadsIfUnreferenced } from "./lib/uploads-cleanup.js";
import { resolverContactoDeTarea } from "./lib/tarea-vinculo.js";
import { leerVinculo, predicadoDeVinculo } from "./lib/tareas-vinculo.js";

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

const TareaSchema = z.object({
  titulo: z.string().min(2),
  descripcion: z.string().nullable().optional(),
  responsable_id: z.string().uuid().nullable().optional(),
  observadores: z.array(z.string().uuid()).optional(),
  estado: z.enum(["pendiente", "en_progreso", "completada", "cancelada"]).optional(),
  prioridad: z.enum(["baja", "normal", "alta", "urgente"]).optional(),
  fecha_inicio: z.string().nullable().optional(),
  fecha_limite: z.string().nullable().optional(),
  oportunidad_id: z.string().uuid().nullable().optional(),
  contacto_id: z.string().uuid().nullable().optional(),
  subtarea_de: z.string().uuid().nullable().optional(),
  checklist: z.array(z.object({ texto: z.string(), hecho: z.boolean().optional() })).optional(),
  plantilla_id: z.string().uuid().nullable().optional()
});

type TareaInput = z.infer<typeof TareaSchema>;

const SELECT_BASE = `
  SELECT t.*,
         u.nombre AS responsable_nombre,
         u.foto_perfil_url AS responsable_foto,
         p.nombre AS propietario_nombre,
         p.foto_perfil_url AS propietario_foto,
         o.nombre_caso AS oportunidad_nombre,
         c.nombre_completo AS contacto_nombre,
         (SELECT COUNT(*)::int FROM gozz.tareas st WHERE st.subtarea_de = t.id) AS subtareas_count,
         (SELECT COUNT(*)::int FROM gozz.tareas_archivos a WHERE a.tarea_id = t.id) AS archivos_count,
         (SELECT COUNT(*)::int FROM gozz.chat_mensajes m
            WHERE m.grupo_id = t.chat_grupo_id
              AND m.user_id != $user_id
              AND NOT (COALESCE(m.leido_por,'[]'::jsonb) @> to_jsonb($user_id::text))) AS unread_count,
         EXISTS(SELECT 1 FROM gozz.user_task_favoritos f WHERE f.tarea_id = t.id AND f.user_id = $user_id) AS es_favorito
    FROM gozz.tareas t
    LEFT JOIN gozz.users u ON u.id = t.responsable_id
    LEFT JOIN gozz.users p ON p.id = t.propietario_id
    LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
    LEFT JOIN gozz.contactos_cache c ON c.id = t.contacto_id
`;

function buildSelect(userParamIdx: number): string {
  return SELECT_BASE.replace(/\$user_id/g, `$${userParamIdx}`);
}

async function getInvolucrados(tareaId: string): Promise<string[]> {
  const r = await query<any>("SELECT propietario_id, responsable_id, observadores FROM gozz.tareas WHERE id = $1", [tareaId]);
  if (!r[0]) return [];
  const obs: string[] = Array.isArray(r[0].observadores) ? r[0].observadores : [];
  const set = new Set<string>([...obs]);
  if (r[0].propietario_id) set.add(r[0].propietario_id);
  if (r[0].responsable_id) set.add(r[0].responsable_id);
  return [...set];
}

function emitTareaEvento(tareaId: string, evento: string, payload: any, involucrados: string[]) {
  for (const uid of involucrados) emitToUser(uid, evento, { tarea_id: tareaId, ...payload });
}

async function ensureChatGrupoForTarea(tareaId: string): Promise<string | null> {
  const t = (await query<any>("SELECT id, titulo, chat_grupo_id, propietario_id, responsable_id, observadores FROM gozz.tareas WHERE id = $1", [tareaId]))[0];
  if (!t) return null;
  if (t.chat_grupo_id) {
    // Mantener nombre y miembros actualizados
    const miembros = await getInvolucrados(tareaId);
    await query(
      "UPDATE gozz.chat_grupos SET nombre = $1, miembros = $2::jsonb WHERE id = $3",
      [t.titulo.slice(0, 100), JSON.stringify(miembros), t.chat_grupo_id]
    );
    return t.chat_grupo_id;
  }
  const miembros = await getInvolucrados(tareaId);
  const g = await query<any>(
    `INSERT INTO gozz.chat_grupos (nombre, tipo, creado_por, miembros, admins, tarea_id)
     VALUES ($1, 'tarea', $2, $3::jsonb, $4::jsonb, $5) RETURNING id`,
    [t.titulo.slice(0, 100), t.propietario_id, JSON.stringify(miembros), JSON.stringify([t.propietario_id]), tareaId]
  );
  const gid = g[0].id;
  await query("UPDATE gozz.tareas SET chat_grupo_id = $1 WHERE id = $2", [gid, tareaId]);
  return gid;
}

async function postSystemMessage(grupoId: string, contenido: string, meta: any = {}) {
  const r = await query<any>(
    `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
     VALUES ($1, NULL, 'sistema', $2) RETURNING *`,
    [grupoId, contenido]
  );
  await query("UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2", [contenido.slice(0, 100), grupoId]);
  emitToGrupo(grupoId, "chat:message", { ...r[0], user_nombre: "Sistema", meta });
  return r[0];
}

// ============================================================
// UPLOADS (archivos de tareas)
// ============================================================
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
const uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage: uploadStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================================
// Plantillas
// ============================================================
const PlantillaSchema = z.object({
  nombre: z.string().min(2),
  titulo_tpl: z.string().min(2),
  descripcion_tpl: z.string().nullable().optional(),
  prioridad: z.enum(["baja", "normal", "alta", "urgente"]).optional(),
  responsable_default_id: z.string().uuid().nullable().optional(),
  observadores_default: z.array(z.string().uuid()).optional(),
  dias_vencimiento: z.number().int().min(0).max(3650).optional(),
  horas_vencimiento: z.number().int().min(0).max(8760).optional(),
  checklist_default: z.array(z.object({ texto: z.string(), hecho: z.boolean().optional() })).optional(),
  activa: z.boolean().optional()
});

// ============================================================
export function registerTareasRoutes(app: Express) {
  // ====== RUTAS ESPECÍFICAS (antes que /api/tareas/:id) ======

  // --- Plantillas ---
  app.get("/api/tareas/plantillas", requireAuth, async (_req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT p.*, u.nombre AS responsable_default_nombre
         FROM gozz.tareas_plantillas p
         LEFT JOIN gozz.users u ON u.id = p.responsable_default_id
        WHERE p.activa = true
        ORDER BY p.nombre`
    );
    res.json({ plantillas: rows });
  });

  app.post("/api/tareas/plantillas", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = PlantillaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data;
    const rows = await query<any>(
      `INSERT INTO gozz.tareas_plantillas
         (nombre, titulo_tpl, descripcion_tpl, prioridad, responsable_default_id, observadores_default,
          dias_vencimiento, horas_vencimiento, checklist_default, creado_por, activa)
       VALUES ($1, $2, $3, COALESCE($4,'normal'), $5, $6::jsonb, COALESCE($7,0), COALESCE($8,0), $9::jsonb, $10, COALESCE($11,true))
       RETURNING *`,
      [
        d.nombre, d.titulo_tpl, d.descripcion_tpl ?? null, d.prioridad,
        d.responsable_default_id ?? null,
        JSON.stringify(d.observadores_default || []),
        d.dias_vencimiento, d.horas_vencimiento,
        JSON.stringify(d.checklist_default || []),
        u.sub, d.activa
      ]
    );
    res.json({ plantilla: rows[0] });
  });

  app.patch("/api/tareas/plantillas/:id", requireAuth, async (req: Request, res: Response) => {
    const parsed = PlantillaSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data as any;
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const setParts: string[] = [];
    const values: any[] = [];
    for (const k of fields) {
      const json = k === "observadores_default" || k === "checklist_default";
      values.push(json ? JSON.stringify(d[k]) : d[k]);
      setParts.push(`${k} = $${values.length + 1}${json ? "::jsonb" : ""}`);
    }
    const rows = await query<any>(
      `UPDATE gozz.tareas_plantillas SET ${setParts.join(", ")} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json({ plantilla: rows[0] });
  });

  app.delete("/api/tareas/plantillas/:id", requireAuth, async (req: Request, res: Response) => {
    await query("UPDATE gozz.tareas_plantillas SET activa = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  });

  // --- Chat de tareas: bandeja y contador unread ---
  app.get("/api/tareas/chat/bandeja", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<any>(
      `SELECT g.*, t.id AS tarea_id, t.titulo AS tarea_titulo, t.estado AS tarea_estado, t.prioridad,
              (SELECT COUNT(*)::int FROM gozz.chat_mensajes m
                WHERE m.grupo_id = g.id
                  AND m.user_id IS DISTINCT FROM $1
                  AND NOT (COALESCE(m.leido_por,'[]'::jsonb) @> to_jsonb($1::text))) AS unread_count
         FROM gozz.chat_grupos g
         JOIN gozz.tareas t ON t.id = g.tarea_id
        WHERE g.tipo = 'tarea' AND g.miembros @> to_jsonb($1::text) AND t.estado NOT IN ('completada','cancelada')
        ORDER BY g.ultimo_mensaje_at DESC NULLS LAST, g.created_at DESC`,
      [u.sub]
    );
    res.json({ chats: rows });
  });

  app.get("/api/tareas/chat/unread-count", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await query<any>(
      `SELECT COALESCE(SUM(unread),0)::int AS total FROM (
         SELECT (SELECT COUNT(*)::int FROM gozz.chat_mensajes m
                   WHERE m.grupo_id = g.id
                     AND m.user_id IS DISTINCT FROM $1
                     AND NOT (COALESCE(m.leido_por,'[]'::jsonb) @> to_jsonb($1::text))) AS unread
           FROM gozz.chat_grupos g
          WHERE g.tipo = 'tarea' AND g.miembros @> to_jsonb($1::text)
       ) x`,
      [u.sub]
    );
    res.json({ total: r[0]?.total || 0 });
  });

  // --- Búsqueda IA (fallback) ---
  app.post("/api/tareas/search-ia", requireAuth, async (req: Request, res: Response) => {
    const q = (req.body?.query as string || "").trim();
    if (!q) { res.json({ filters: {}, q: "" }); return; }
    res.json({ filters: { q }, q, fallback: true });
  });

  // ====== RUTAS GENÉRICAS ======

  // ---------------- LIST ----------------
  app.get("/api/tareas", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) || (req.query.mine === "true" ? "mine" : "mine");
    const effectiveScope = scope === "all" ? "all" : "mine";

    if (effectiveScope === "all" && !isAdmin(u)) {
      res.status(403).json({ error: "Solo administradores pueden ver todas las tareas" });
      return;
    }

    // ¿Qué relación mía con la tarea se está pidiendo? Lo decide `lib/tareas-vinculo.ts`, y lo
    // consultan LA LISTA Y LOS CONTADORES: son dos consultas distintas y si divergen, el chip de
    // arriba contradice al tablero de abajo.
    const leido = leerVinculo(req.query.vinculo);
    if (!leido.ok) { res.status(400).json({ error: leido.error }); return; }
    const vinculo = leido.vinculo;

    const admin = isAdmin(u);
    // as_user_id: ver el "mine" de otro usuario.
    //  - admin: sin restricción (ve todas las de esa persona).
    //  - usuario normal: SOLO las tareas de esa persona que también lo involucran
    //    (es propietario u observador).
    //
    // 🔴 CAMBIO DE CONDUCTA — 2026-09-02, decisión de Juan David. Aquí decía que "Mis tareas" era
    // `responsable_id = yo y nada más (regla firme, no se toca)". Ya no lo es, y el motivo es el
    // que la tumbó: **en cuanto delegabas una tarea desaparecía de tu pantalla**, así que quien la
    // encargaba no podía ver en qué estado iba. Por defecto ahora son las que creé MÁS las que
    // tengo asignadas, y el resto se elige con `?vinculo=`.
    //
    // ⚠️ Lo que la regla vieja protegía SIGUE protegido: `defecto` no incluye lo que uno solo
    // observa —eso es mirar, no tener—, y quien quiera esa bandeja la pide aparte.
    const asUserIdRaw = (req.query.as_user_id as string) || "";
    const asUserId = asUserIdRaw || null;
    // El user_id usado para "mine" (si se ve a otro, es el otro)
    const viewAsId = asUserId || u.sub;
    const viewingOther = !!(asUserId && asUserId !== u.sub);
    // Predicado "me involucra" (propietario / responsable / observador).
    const involvedSql = (p: string) =>
      `(t.propietario_id = ${p} OR t.responsable_id = ${p} OR COALESCE(t.observadores,'[]'::jsonb) @> to_jsonb(${p}::text))`;
    // Param 1 para el SELECT (favorito/unread counts del visor real)
    const params: any[] = [u.sub];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };

    const wheres: string[] = [];
    if (effectiveScope === "mine") {
      const viewAsParam = addP(viewAsId);
      wheres.push(predicadoDeVinculo(vinculo, viewAsParam));
      // NO-admin viendo a OTRA persona: restringir a las tareas que lo involucran.
      if (viewingOther && !admin) {
        wheres.push(involvedSql(addP(u.sub)));
      }
    }

    if (req.query.responsable_id) wheres.push(`t.responsable_id = ${addP(req.query.responsable_id)}`);
    if (req.query.prioridad) wheres.push(`t.prioridad = ${addP(req.query.prioridad)}`);
    if (req.query.estado) wheres.push(`t.estado = ${addP(req.query.estado)}`);
    if (req.query.oportunidad_id) wheres.push(`t.oportunidad_id = ${addP(req.query.oportunidad_id)}`);
    if (req.query.contacto_id) wheres.push(`t.contacto_id = ${addP(req.query.contacto_id)}`);
    if (req.query.vence_desde) wheres.push(`t.fecha_limite >= ${addP(req.query.vence_desde)}`);
    if (req.query.vence_hasta) wheres.push(`t.fecha_limite <= ${addP(req.query.vence_hasta)}`);
    if (req.query.departamento_id) {
      wheres.push(`t.responsable_id IN (SELECT usuario_id FROM gozz.usuarios_perfil WHERE departamento_id = ${addP(req.query.departamento_id)})`);
    }
    const q = ((req.query.q as string) || "").trim();
    if (q) {
      const p = addP(`%${q}%`);
      // `c.nombre_completo` entra aquí porque una tarea puede colgar de un contacto SIN oportunidad
      // (es el caso entero de la ficha del contacto): buscar solo por `nombre_caso` deja fuera
      // justo esas. El JOIN con contactos ya está en SELECT_BASE, no se añade ninguno.
      wheres.push(`(t.titulo ILIKE ${p} OR t.descripcion ILIKE ${p} OR o.nombre_caso ILIKE ${p} OR c.nombre_completo ILIKE ${p})`);
    }

    // PERF: por defecto excluimos completadas/canceladas (son la gran mayoría — 25k+ filas)
    // para que la carga sea rápida y fluida. Se incluyen solo si se pide estado=... o include_completed=true.
    const includeCompleted = req.query.include_completed === "true";
    if (!req.query.estado && !includeCompleted) {
      wheres.push("t.estado NOT IN ('completada','cancelada')");
    }
    const limit = (req.query.estado === "completada" || includeCompleted) ? 500 : 1000;

    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const sql = `
      ${buildSelect(1)}
      ${whereSql}
      ORDER BY (t.estado = 'completada'), (CASE WHEN t.estado = 'completada' THEN t.fecha_completada END) DESC NULLS LAST, t.fecha_limite ASC NULLS LAST, t.created_at DESC
      LIMIT ${limit}
    `;
    const rows = await query<any>(sql, params);

    // Conteos sobre TODO el universo del scope (sin límite ni filtro de estado) para los chips de stats.
    let countScopeWhere = "";
    const countParams: any[] = [];
    if (effectiveScope === "mine") {
      countParams.push(viewAsId);
      // EL MISMO predicado que la lista, pedido al mismo sitio. Si esto se escribiera aparte —como
      // estaba—, cambiar uno de los dos dejaría los chips contando algo que el tablero no enseña.
      let cw = predicadoDeVinculo(vinculo, "$1");
      if (viewingOther && !admin) {
        countParams.push(u.sub);
        cw += ` AND ${involvedSql("$2")}`;
      }
      countScopeWhere = `WHERE ${cw}`;
    }
    const countRows = await query<any>(
      `SELECT
         count(*) FILTER (WHERE t.estado NOT IN ('completada','cancelada'))::int AS pendientes,
         count(*) FILTER (WHERE t.estado = 'en_progreso')::int AS en_progreso,
         count(*) FILTER (WHERE t.estado = 'completada')::int AS completadas,
         count(*) FILTER (WHERE t.estado NOT IN ('completada','cancelada') AND t.fecha_limite IS NOT NULL AND t.fecha_limite < NOW())::int AS vencidas
       FROM gozz.tareas t ${countScopeWhere}`,
      countParams
    );
    res.json({ tareas: rows, scope: effectiveScope, counts: countRows[0] || {} });
  });

  // ---------------- DETAIL ----------------
  app.get("/api/tareas/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<any>(`${buildSelect(2)} WHERE t.id = $1`, [req.params.id, u.sub]);
    const tarea = rows[0];
    if (!tarea) { res.status(404).json({ error: "Tarea no encontrada" }); return; }

    const subtareas = await query<any>(
      `SELECT t.*, u.nombre AS responsable_nombre
         FROM gozz.tareas t
         LEFT JOIN gozz.users u ON u.id = t.responsable_id
        WHERE t.subtarea_de = $1
        ORDER BY t.created_at ASC`,
      [req.params.id]
    );

    let padre = null;
    if (tarea.subtarea_de) {
      const pr = await query<any>("SELECT id, titulo, numero_tarea FROM gozz.tareas WHERE id = $1", [tarea.subtarea_de]);
      padre = pr[0] || null;
    }

    const archivos = await query<any>(
      `SELECT a.*, u.nombre AS uploader_nombre
         FROM gozz.tareas_archivos a
         LEFT JOIN gozz.users u ON u.id = a.uploaded_by
        WHERE a.tarea_id = $1 ORDER BY a.created_at DESC`,
      [req.params.id]
    );

    res.json({ tarea, subtareas, padre, archivos });
  });

  // ---------------- CREATE ----------------
  app.post("/api/tareas", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = TareaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data;

    // El cliente de la tarea lo decide `lib/tarea-vinculo.ts`, no este handler: si llega una
    // oportunidad y no un contacto, el contacto sale de ella. La misma regla que ya aplicaba
    // `POST /api/oportunidades/:id/tareas` y que aquí no existía.
    const vinculo = await resolverContactoDeTarea(d);
    if (!vinculo.ok) { res.status(400).json({ error: vinculo.error }); return; }
    const contactoId = vinculo.contactoId ?? null;

    // Expandir plantilla si aplica
    let titulo = d.titulo;
    let descripcion = d.descripcion ?? null;
    let prioridad = d.prioridad ?? "normal";
    let checklist = d.checklist ?? [];
    let observadoresArr: string[] = d.observadores || [];
    let responsableId = d.responsable_id || u.sub;
    let fechaLimite = d.fecha_limite ?? null;

    if (d.plantilla_id) {
      const tpl = (await query<any>("SELECT * FROM gozz.tareas_plantillas WHERE id = $1 AND activa = true", [d.plantilla_id]))[0];
      if (tpl) {
        if (!d.titulo || d.titulo === tpl.titulo_tpl) titulo = tpl.titulo_tpl;
        if (!descripcion) descripcion = tpl.descripcion_tpl;
        if (!d.prioridad) prioridad = tpl.prioridad;
        if ((checklist || []).length === 0 && Array.isArray(tpl.checklist_default)) checklist = tpl.checklist_default;
        if (observadoresArr.length === 0 && Array.isArray(tpl.observadores_default)) observadoresArr = tpl.observadores_default;
        if (!d.responsable_id && tpl.responsable_default_id) responsableId = tpl.responsable_default_id;
        if (!fechaLimite && (tpl.dias_vencimiento > 0 || tpl.horas_vencimiento > 0)) {
          const ms = ((tpl.dias_vencimiento || 0) * 86400 + (tpl.horas_vencimiento || 0) * 3600) * 1000;
          fechaLimite = new Date(Date.now() + ms).toISOString();
        }
      }
    }

    const insertTareaSql = `INSERT INTO gozz.tareas
         (titulo, descripcion, propietario_id, responsable_id, observadores,
          estado, prioridad, fecha_inicio, fecha_limite, oportunidad_id, contacto_id, subtarea_de, checklist, plantilla_id)
       VALUES ($1, $2, $3, $4, $5::jsonb,
               COALESCE($6, 'pendiente'), $7,
               $8, $9, $10, $11, $12, $13::jsonb, $14)
       RETURNING *`;
    const insertTareaParams = [
        titulo, descripcion, u.sub, responsableId, JSON.stringify(observadoresArr),
        d.estado, prioridad,
        d.fecha_inicio ?? null, fechaLimite,
        d.oportunidad_id ?? null, contactoId, d.subtarea_de ?? null,
        JSON.stringify(checklist), d.plantilla_id ?? null
      ];
    let rows: any[];
    try {
      rows = await query<any>(insertTareaSql, insertTareaParams);
    } catch (e: any) {
      // Secuencia numero_tarea desincronizada (p.ej. tras una importacion): resync al MAX y reintento
      if (e?.code === "23505" && String(e?.constraint || "").includes("numero_tarea")) {
        await query("SELECT setval('gozz.tareas_numero_tarea_seq', (SELECT COALESCE(MAX(numero_tarea),0) FROM gozz.tareas))");
        rows = await query<any>(insertTareaSql, insertTareaParams);
      } else { throw e; }
    }
    const tarea = rows[0];

    // Auto-crear chat_grupo y enviar mensaje de sistema
    const gid = await ensureChatGrupoForTarea(tarea.id);
    if (gid) {
      await postSystemMessage(gid, `Tarea creada: ${tarea.titulo}`);
    }

    const involucrados = [...new Set<string>([u.sub, responsableId, ...observadoresArr])];
    emitTareaEvento(tarea.id, "tarea:created", { tarea }, involucrados);

    if (responsableId !== u.sub) {
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
         VALUES ($1, 'tarea_asignada', $2, $3, $4, $5, $6::jsonb)`,
        [
          responsableId,
          "Nueva tarea asignada",
          tarea.titulo,
          tarea.prioridad === "urgente" ? "critica" : (tarea.prioridad === "alta" ? "alta" : "normal"),
          `/tareas?id=${tarea.id}`,
          JSON.stringify({ tarea_id: tarea.id })
        ]
      );
      emitToUser(responsableId, "notificacion:nueva", { tipo: "tarea_asignada", tarea_id: tarea.id, titulo: tarea.titulo });
      sendPushToUser(responsableId, {
        title: "Nueva tarea asignada",
        body: tarea.titulo,
        url: `/tareas?id=${tarea.id}`,
        tag: `tarea-${tarea.id}`,
        kind: "tarea",
      }).catch(() => {});
    }

    res.json({ tarea });
  });

  // ---------------- PATCH ----------------
  app.patch("/api/tareas/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = TareaSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data as Partial<TareaInput>;

    if (Object.keys(d).length === 0) { res.json({ ok: true }); return; }

    // Misma regla que al crear, y **solo si esta petición toca el vínculo**: mover una tarea a
    // otra oportunidad le cambia el cliente, y dejar el de antes la partiría en dos. Se comprueba
    // aquí y no en cada `PATCH` para no meterle una consulta extra a los botones de estado, que
    // son los que se pulsan todo el día.
    if (d.oportunidad_id !== undefined || d.contacto_id !== undefined) {
      const vinculo = await resolverContactoDeTarea(d);
      if (!vinculo.ok) { res.status(400).json({ error: vinculo.error }); return; }
      if (vinculo.contactoId !== undefined) d.contacto_id = vinculo.contactoId;
    }

    const fields = Object.keys(d);
    const setParts: string[] = [];
    const values: any[] = [];
    for (const k of fields) {
      values.push(k === "observadores" || k === "checklist" ? JSON.stringify((d as any)[k]) : (d as any)[k]);
      const cast = (k === "observadores" || k === "checklist") ? "::jsonb" : "";
      setParts.push(`${k} = $${values.length + 1}${cast}`);
    }
    // 🔴 `fecha_completada` SE BORRA AL SACAR LA TAREA DE «completada». Hasta ahora solo se
    // escribía, y nadie la limpiaba: daba igual porque no había forma de sacar una tarea de
    // «completada» desde el tablero. Ahora sí la hay —una completada o una cancelada se pueden
    // retomar arrastrándolas a una columna de fecha— y sin esto quedaría una tarea PENDIENTE CON
    // FECHA DE COMPLETADA.
    //
    // No es cosmético. El orden del listado solo mira esa columna cuando el estado es
    // «completada», así que ahí no se notaría; pero `reportes-routes.ts` cuenta
    // `completadas_hoy / _semana / _mes` filtrando **solo** por `fecha_completada`, sin mirar el
    // estado. Una pendiente con esa fecha se colaría en el informe, y contradiría al contador
    // `completadas` de esa misma respuesta, que sí va por estado. Un dato que miente en un
    // reporte no lo caza nadie.
    //
    // Solo se toca cuando el PATCH trae `estado`: cambiar el título de una completada no puede
    // borrarle la fecha de completado.
    const extra =
      d.estado === undefined ? ""
      : d.estado === "completada" ? ", fecha_completada = NOW()"
      : ", fecha_completada = NULL";

    const prev = (await query<any>("SELECT estado, titulo, responsable_id FROM gozz.tareas WHERE id = $1", [req.params.id]))[0];

    const rows = await query<any>(
      `UPDATE gozz.tareas SET ${setParts.join(", ")}${extra} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    const tarea = rows[0];
    if (!tarea) { res.status(404).json({ error: "Tarea no encontrada" }); return; }

    // Asegurar chat_grupo y sincronizar miembros
    const gid = await ensureChatGrupoForTarea(tarea.id);

    // Log de sistema en chat al cambiar estado
    if (gid && prev && d.estado && prev.estado !== d.estado) {
      await postSystemMessage(gid, `Estado: ${prev.estado} → ${d.estado}`);
    }

    // Notificar al nuevo responsable cuando cambia la asignacion
    if (d.responsable_id && d.responsable_id !== prev?.responsable_id && d.responsable_id !== u.sub) {
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
         VALUES ($1, 'tarea_asignada', $2, $3, $4, $5, $6::jsonb)`,
        [
          d.responsable_id,
          "Te asignaron una tarea",
          tarea.titulo,
          tarea.prioridad === "urgente" ? "critica" : (tarea.prioridad === "alta" ? "alta" : "normal"),
          `/tareas?id=${tarea.id}`,
          JSON.stringify({ tarea_id: tarea.id })
        ]
      ).catch(() => {});
    }

    const involucrados = await getInvolucrados(tarea.id);
    emitTareaEvento(tarea.id, "tarea:updated", { tarea }, involucrados);

    res.json({ tarea });
  });

  // ---------------- DELETE ----------------
  app.delete("/api/tareas/:id", requireAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const involucrados = await getInvolucrados(id);
    const archs = await query<any>("SELECT url FROM gozz.tareas_archivos WHERE tarea_id = $1", [id]);
    await query("DELETE FROM gozz.tareas WHERE id = $1", [id]);
    emitTareaEvento(id, "tarea:deleted", {}, involucrados);
    res.json({ ok: true });
    deleteUploadsIfUnreferenced(archs.map((a: any) => a.url), { origen: "cascade_tarea", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup tarea]", e?.message));
  });

  // ---------------- FAVORITO ----------------
  app.post("/api/tareas/:id/favorito", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const existing = await query<any>("SELECT 1 FROM gozz.user_task_favoritos WHERE user_id = $1 AND tarea_id = $2", [u.sub, req.params.id]);
    if (existing[0]) {
      await query("DELETE FROM gozz.user_task_favoritos WHERE user_id = $1 AND tarea_id = $2", [u.sub, req.params.id]);
      res.json({ es_favorito: false });
    } else {
      await query("INSERT INTO gozz.user_task_favoritos (user_id, tarea_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [u.sub, req.params.id]);
      res.json({ es_favorito: true });
    }
  });

  // ---------------- MUTE AUDIO ----------------
  app.post("/api/tareas/:id/mute", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      `UPDATE gozz.tareas SET mute_audio = NOT COALESCE(mute_audio, false) WHERE id = $1 RETURNING mute_audio`,
      [req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "Tarea no encontrada" }); return; }
    res.json({ mute_audio: rows[0].mute_audio });
  });

  // ---------------- CLONAR ----------------
  app.post("/api/tareas/:id/clonar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const src = (await query<any>("SELECT * FROM gozz.tareas WHERE id = $1", [req.params.id]))[0];
    if (!src) { res.status(404).json({ error: "Tarea origen no encontrada" }); return; }

    const rows = await query<any>(
      `INSERT INTO gozz.tareas
         (titulo, descripcion, propietario_id, responsable_id, observadores,
          estado, prioridad, fecha_inicio, fecha_limite, oportunidad_id, contacto_id, subtarea_de, checklist, etiquetas)
       VALUES ($1, $2, $3, $4, $5::jsonb,
               'pendiente', $6, NULL, NULL, $7, $8, $9, $10::jsonb, $11::jsonb)
       RETURNING *`,
      [
        `${src.titulo} (copia)`, src.descripcion,
        u.sub, src.responsable_id || u.sub,
        JSON.stringify(src.observadores || []),
        src.prioridad,
        src.oportunidad_id, src.contacto_id, src.subtarea_de,
        JSON.stringify(src.checklist || []),
        JSON.stringify(src.etiquetas || [])
      ]
    );
    await ensureChatGrupoForTarea(rows[0].id);
    res.json({ tarea: rows[0] });
  });

  // ---------------- CHAT DE LA TAREA ----------------
  app.get("/api/tareas/:id/chat-grupo", requireAuth, async (req: Request, res: Response) => {
    const gid = await ensureChatGrupoForTarea(String(req.params.id));
    if (!gid) { res.status(404).json({ error: "Tarea no encontrada" }); return; }
    const g = (await query<any>("SELECT * FROM gozz.chat_grupos WHERE id = $1", [gid]))[0];
    res.json({ grupo: g });
  });

  // ---------------- SUPER-NOTIFY ----------------
  app.post("/api/tareas/:id/super-notify", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const id = String(req.params.id);
    const t = (await query<any>("SELECT id, titulo, chat_grupo_id FROM gozz.tareas WHERE id = $1", [id]))[0];
    if (!t) { res.status(404).json({ error: "Tarea no encontrada" }); return; }

    const involucrados = await getInvolucrados(id);
    const from = (await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]))[0];

    const mensaje = (req.body?.mensaje as string) || "Necesito tu atención en esta tarea";

    // Insertar notificaciones críticas
    for (const uid of involucrados) {
      if (uid === u.sub) continue;
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
         VALUES ($1, 'tarea_super', $2, $3, 'critica', $4, $5::jsonb)`,
        [uid, `${from?.nombre || "Alguien"} te llama en una tarea`, `${t.titulo}: ${mensaje}`, `/tareas?id=${id}`,
         JSON.stringify({ tarea_id: id, from_user_id: u.sub, from_nombre: from?.nombre, from_foto: from?.foto_perfil_url, mensaje })]
      );
      emitToUser(uid, "tarea:super-notify", {
        tarea_id: id,
        tarea_titulo: t.titulo,
        from_user_id: u.sub,
        from_nombre: from?.nombre || "Usuario",
        from_foto: from?.foto_perfil_url || null,
        mensaje,
        timestamp: new Date().toISOString()
      });
    }

    // Mensaje de sistema en el chat
    if (t.chat_grupo_id) {
      await postSystemMessage(t.chat_grupo_id, `🔔 ${from?.nombre || "Alguien"} envió una super-notificación: ${mensaje}`);
    }

    res.json({ ok: true, notified: involucrados.filter((x) => x !== u.sub).length });
  });

  // ---------------- ARCHIVOS DE TAREA ----------------
  app.get("/api/tareas/:id/archivos", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT a.*, u.nombre AS uploader_nombre
         FROM gozz.tareas_archivos a
         LEFT JOIN gozz.users u ON u.id = a.uploaded_by
        WHERE a.tarea_id = $1 ORDER BY a.created_at DESC`,
      [req.params.id]
    );
    res.json({ archivos: rows });
  });

  app.post("/api/tareas/:id/archivos", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const f = (req as any).file;
    if (!f) { res.status(400).json({ error: "No file" }); return; }
    const url = placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "tarea", { tareaId: String(req.params.id) }, f.filename);
    const rows = await query<any>(
      `INSERT INTO gozz.tareas_archivos (tarea_id, filename, mime, size_bytes, url, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, f.originalname, f.mimetype, f.size, url, u.sub]
    );
    const t = (await query<any>("SELECT chat_grupo_id FROM gozz.tareas WHERE id = $1", [req.params.id]))[0];
    if (t?.chat_grupo_id) {
      await postSystemMessage(t.chat_grupo_id, `📎 Archivo subido: ${f.originalname}`, { archivo_url: url });
    }
    res.json({ archivo: rows[0] });
  });

  app.delete("/api/tareas/:id/archivos/:archivoId", requireAuth, async (req: Request, res: Response) => {
    const prev = (await query<any>("SELECT url FROM gozz.tareas_archivos WHERE id = $1 AND tarea_id = $2", [req.params.archivoId, req.params.id]))[0];
    await query("DELETE FROM gozz.tareas_archivos WHERE id = $1 AND tarea_id = $2", [req.params.archivoId, req.params.id]);
    res.json({ ok: true });
    if (prev?.url) deleteUploadsIfUnreferenced([prev.url], { origen: "cascade_tarea", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup tarea-archivo]", e?.message));
  });

  // ---------------- OPORTUNIDAD → TAREA helper ----------------
  app.post("/api/oportunidades/:id/tareas", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = TareaSchema.safeParse({ ...req.body, oportunidad_id: req.params.id });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data;

    const op = (await query<any>("SELECT contacto_id FROM gozz.oportunidades WHERE id = $1", [req.params.id]))[0];
    if (!op) { res.status(404).json({ error: "Oportunidad no encontrada" }); return; }

    // Esta ruta ya derivaba el contacto de la oportunidad, pero con un `??` propio que aceptaba
    // sin rechistar un contacto que fuese de otra persona. Pasa por el mismo módulo que las otras
    // dos: la derivación es la que era y ahora además se rechaza la contradicción.
    const vinculo = await resolverContactoDeTarea(d);
    if (!vinculo.ok) { res.status(400).json({ error: vinculo.error }); return; }

    const rows = await query<any>(
      `INSERT INTO gozz.tareas
         (titulo, descripcion, propietario_id, responsable_id, observadores,
          estado, prioridad, fecha_inicio, fecha_limite, oportunidad_id, contacto_id, checklist)
       VALUES ($1, $2, $3, $4, $5::jsonb,
               COALESCE($6, 'pendiente'), COALESCE($7, 'normal'),
               $8, $9, $10, $11, $12::jsonb)
       RETURNING *`,
      [
        d.titulo, d.descripcion ?? null, u.sub, d.responsable_id || u.sub,
        JSON.stringify(d.observadores || []),
        d.estado, d.prioridad, d.fecha_inicio ?? null, d.fecha_limite ?? null,
        req.params.id, vinculo.contactoId ?? null,
        JSON.stringify(d.checklist || [])
      ]
    );
    const tarea = rows[0];
    await ensureChatGrupoForTarea(tarea.id);
    const involucrados = [...new Set<string>([u.sub, tarea.responsable_id, ...(tarea.observadores || [])])];
    emitTareaEvento(tarea.id, "tarea:created", { tarea }, involucrados);
    res.json({ tarea });
  });
}
