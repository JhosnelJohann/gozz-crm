import type { Express } from "express";
import type { Multer } from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { emitToUser, emitToGrupo, joinUsersToGrupo } from "./shared/socket.js";
import { UPLOADS_DIR } from "./shared/env.js";
import { placeUploadedFile, uploadUrlToAbsPath } from "./lib/storage.js";
import { deleteUploadsIfUnreferenced } from "./lib/uploads-cleanup.js";
import { sendPushToUsers } from "./push.js";
import { fetchLinkPreview } from "./chat-link-preview.js";
import { syncClockFromMessage } from "./clock-routes.js";

/** Chat interno (grupos, DMs, mensajes, copiloto de IA) y el perfil de un miembro del equipo. */
export function registerChatRoutes(app: Express, upload: Multer) {
  app.get("/api/chat/grupos", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const rows = await query<any>(
    `SELECT g.*,
       COALESCE(e.fijado, false) AS fijado,
       COALESCE(e.oculto, false) AS oculto,
       COALESCE(e.silenciado, false) AS silenciado,
       e.recordar_at,
       (SELECT COUNT(*)::int FROM gozz.chat_mensajes m WHERE m.grupo_id = g.id) AS mensaje_count,
       (SELECT COUNT(*)::int FROM gozz.chat_mensajes m
          WHERE m.grupo_id = g.id
            AND m.user_id != $1
            AND NOT (m.leido_por @> to_jsonb($1::text))) AS unread_count,
       (SELECT COALESCE(jsonb_agg(s.obj ORDER BY s.ord), '[]'::jsonb) FROM (
          SELECT idx.ord,
                 jsonb_build_object('id', pm.id, 'contenido', pm.contenido, 'tipo', pm.tipo,
                                    'archivo_nombre', pm.archivo_nombre, 'user_id', pm.user_id,
                                    'user_nombre', pu.nombre) AS obj
          FROM jsonb_array_elements_text(g.mensajes_fijados) WITH ORDINALITY AS idx(mid, ord)
          JOIN gozz.chat_mensajes pm ON pm.id = idx.mid::uuid AND NOT COALESCE(pm.eliminado, false)
          LEFT JOIN gozz.users pu ON pu.id = pm.user_id
       ) s) AS mensajes_fijados
     FROM gozz.chat_grupos g
     LEFT JOIN gozz.chat_grupos_user_estado e
            ON e.grupo_id = g.id AND e.user_id = $1
     WHERE g.miembros @> to_jsonb($1::text)
     ORDER BY COALESCE(e.fijado, false) DESC,
              g.ultimo_mensaje_at DESC NULLS LAST,
              g.nombre`,
    [u.sub]
  );

  // Enrich DM rows with the "other" user info
  const enriched = await Promise.all(rows.map(async (g: any) => {
    if (g.tipo === "directo" && Array.isArray(g.miembros)) {
      const otherId = g.miembros.find((id: string) => id !== u.sub);
      if (otherId) {
        const ur = await query<any>(
          "SELECT id, nombre, foto_perfil_url, online, departamento, posiciones FROM gozz.users WHERE id = $1",
          [otherId]
        );
        if (ur[0]) {
          g.otro_usuario = ur[0];
          g.nombre = ur[0].nombre;
          g.avatar_url = ur[0].foto_perfil_url;
        }
      }
    }
    return g;
  }));
  res.json({ grupos: enriched });
});

  app.get("/api/chat/grupos/:id/mensajes", requireAuth, async (req, res) => {
  const before = typeof req.query.before === "string" ? req.query.before : undefined;
  const around = typeof req.query.around === "string" ? req.query.around : undefined;
  // Salto a un mensaje viejo (fijado / cita de respuesta): trae ese mensaje + los
  // 49 anteriores en UNA sola query, sin importar qué tan atrás esté en el historial.
  if (around) {
    const target = (await query<any>(
      "SELECT created_at FROM gozz.chat_mensajes WHERE id = $1 AND grupo_id = $2",
      [around, req.params.id]
    ))[0];
    if (!target) { res.json({ mensajes: [] }); return; }
    const ctx = await query<any>(
      `SELECT m.*, u.nombre AS user_nombre, u.foto_perfil_url
         FROM gozz.chat_mensajes m
         LEFT JOIN gozz.users u ON u.id = m.user_id
         WHERE m.grupo_id = $1 AND m.created_at <= $2
         ORDER BY m.created_at DESC LIMIT 50`,
      [req.params.id, target.created_at]
    );
    res.json({ mensajes: ctx.reverse() });
    return;
  }
  const rows = await query<any>(
    before
      ? `SELECT m.*, u.nombre AS user_nombre, u.foto_perfil_url
         FROM gozz.chat_mensajes m
         LEFT JOIN gozz.users u ON u.id = m.user_id
         WHERE m.grupo_id = $1 AND m.created_at < $2
         ORDER BY m.created_at DESC LIMIT 50`
      : `SELECT m.*, u.nombre AS user_nombre, u.foto_perfil_url
         FROM gozz.chat_mensajes m
         LEFT JOIN gozz.users u ON u.id = m.user_id
         WHERE m.grupo_id = $1
         ORDER BY m.created_at DESC LIMIT 50`,
    before ? [req.params.id, before] : [req.params.id]
  );
  res.json({ mensajes: rows.reverse() });
});

  app.post("/api/chat/grupos/:id/mensajes", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const { contenido, tipo, archivo_url, archivo_nombre, archivo_tipo, reply_to_id, reenviado_de } = req.body;
  if (!contenido && !archivo_url) { res.status(400).json({ error: "Contenido requerido" }); return; }
  // Menciones: array de { id, nombre }. id === "all" representa @todos.
  const mencionesIn: Array<{ id: string; nombre: string }> = Array.isArray(req.body?.menciones)
    ? req.body.menciones
        .filter((x: any) => x && typeof x.id === "string" && typeof x.nombre === "string")
        .map((x: any) => ({ id: String(x.id), nombre: String(x.nombre).slice(0, 120) }))
        .slice(0, 50)
    : [];
  // Si el archivo viene PLANO (recién subido por /api/chat/upload, que no conoce el grupo),
  // moverlo a chats/mensajes/<grupoId>/. Si ya está organizado (p.ej. un reenvío), NO se mueve.
  let finalArchivoUrl = archivo_url;
  if (archivo_url && /^\/uploads\/[^/]+$/.test(archivo_url)) {
    const fname = archivo_url.replace(/^\/uploads\//, "");
    const flat = path.join(UPLOADS_DIR, fname);
    if (fs.existsSync(flat)) {
      finalArchivoUrl = placeUploadedFile(flat, "chat_mensaje", { grupoId: String(req.params.id) }, fname);
    }
  }
  const rows = await query<any>(
    `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido, archivo_url, archivo_nombre, archivo_tipo, reply_to_id, reenviado_de, menciones)
     VALUES ($1, $2, COALESCE($3, 'texto'), $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING *`,
    [req.params.id, u.sub, tipo, contenido, finalArchivoUrl, archivo_nombre, archivo_tipo, reply_to_id, reenviado_de || null, JSON.stringify(mencionesIn)]
  );
  await query(
    "UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2",
    [(contenido || archivo_nombre || "archivo").slice(0, 100), req.params.id]
  );
  // Archivados STICKY (estilo WhatsApp): un mensaje nuevo NO desarchiva (se conserva `oculto`).
  // Solo limpiamos el "recordar más tarde" para que ese chat vuelva a la vista normal.
  await query(
    "UPDATE gozz.chat_grupos_user_estado SET recordar_at = NULL, updated_at = NOW() WHERE grupo_id = $1 AND user_id != $2 AND recordar_at IS NOT NULL",
    [req.params.id, u.sub]
  );
  // Attach user info for broadcast
  const userRow = await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]);
  const mensaje = { ...rows[0], user_nombre: userRow[0]?.nombre, foto_perfil_url: userRow[0]?.foto_perfil_url };
  emitToGrupo(String(req.params.id), "chat:message", mensaje);
  // Vínculo grupo → clock: si el mensaje es del grupo de Clock-in/out y dice
  // "Clock-in/Break/De regreso/Clock out", registra la jornada del usuario (sin re-postear).
  if (rows[0]?.tipo === "texto" && contenido) {
    void syncClockFromMessage(u.sub, String(req.params.id), String(contenido), new Date(rows[0].created_at));
  }
  // Push notification a los demas miembros del grupo (best-effort, no bloquea)
  (async () => {
    try {
      const g = await query<any>("SELECT nombre, tipo, miembros FROM gozz.chat_grupos WHERE id = $1", [req.params.id]);
      const miembros: string[] = Array.isArray(g[0]?.miembros) ? g[0].miembros : [];
      const destinatarios = miembros.filter((m: string) => m && m !== u.sub);
      const senderName = userRow[0]?.nombre || "Alguien";
      const esGrupo = g[0]?.tipo === "grupo";
      const preview = String(contenido || archivo_nombre || "Archivo adjunto").slice(0, 120);
      const grupoNombre = g[0]?.nombre || "el chat";

      // Quiénes silenciaron ESTE chat: se excluyen del PUSH (y del sonido). NO del registro en
      // campana (una @mención sigue quedando como constancia, pero sin avisar). Estilo WhatsApp.
      const silenciadosRows = await query<any>(
        "SELECT user_id FROM gozz.chat_grupos_user_estado WHERE grupo_id = $1 AND silenciado = true AND user_id::text = ANY($2::text[])",
        [req.params.id, destinatarios]
      );
      const silenciadosSet = new Set<string>(silenciadosRows.map((r: any) => String(r.user_id)));

      // Resolver destinatarios mencionados: @todos => todos los miembros; o ids puntuales (solo miembros)
      const mencionAll = mencionesIn.some((m) => m.id === "all");
      const mencionIds = new Set<string>(
        mencionAll
          ? destinatarios
          : mencionesIn.map((m) => m.id).filter((id) => id !== "all" && destinatarios.includes(id))
      );

      // 1) A los mencionados: notificacion in-app + push de mencion
      if (mencionIds.size > 0) {
        const ids = Array.from(mencionIds);
        await Promise.all(ids.map((uid) =>
          query(
            `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
             VALUES ($1, 'mencion', $2, $3, 'alta', $4, $5::jsonb)`,
            [
              uid,
              `${senderName} te mencionó${esGrupo ? ` en ${grupoNombre}` : ""}`,
              preview,
              "/tareas/chat",
              JSON.stringify({ grupo_id: String(req.params.id), mensaje_id: rows[0].id, todos: mencionAll }),
            ]
          )
            // Campanita en tiempo real. La mención NO debe sonar aquí (ya suena por el ping del
            // chat); el frontend omite el ping cuando tipo === "mencion".
            .then(() => emitToUser(uid, "notificacion:nueva", { tipo: "mencion" }))
            .catch(() => {})
        ));
        // Push de mención: excluir a los que silenciaron el chat (la campana sí quedó arriba).
        const idsPush = ids.filter((id) => !silenciadosSet.has(id));
        if (idsPush.length) {
          await sendPushToUsers(idsPush, {
            title: `${senderName} te mencionó${esGrupo ? ` en ${grupoNombre}` : ""}`,
            body: preview,
            url: "/tareas/chat",
            tag: `chat-mencion-${req.params.id}`,
            kind: "chat",
            icon: userRow[0]?.foto_perfil_url || undefined,
            grupoId: String(req.params.id),
          }).catch(() => {});
        }
      }

      // 2) Push normal de chat a los NO mencionados (excluyendo silenciados)
      const restantes = destinatarios.filter((m) => !mencionIds.has(m) && !silenciadosSet.has(m));
      if (restantes.length) {
        await sendPushToUsers(restantes, {
          title: esGrupo ? grupoNombre : senderName,
          body: esGrupo ? `${senderName}: ${preview}` : preview,
          url: "/tareas/chat",
          tag: `chat-${req.params.id}`,
          kind: "chat",
          icon: userRow[0]?.foto_perfil_url || undefined,
          grupoId: String(req.params.id),
        });
      }
    } catch { /* noop */ }
  })();
  // Previsualizacion de enlaces (best-effort, no bloquea)
  fetchLinkPreview({ query, emitToGrupo }, String(req.params.id), rows[0].id, contenido).catch(() => {});

  // Auto-respuesta CoPilot (texto | audio transcrito | documento analizado)
  try {
    const grupoRow = await query<any>("SELECT tipo FROM gozz.chat_grupos WHERE id = $1", [req.params.id]);
    if (grupoRow[0]?.tipo === "copilot") {
      const esAudio = tipo === "audio" && archivo_url;
      const esArchivo = !esAudio && archivo_url && (tipo === "imagen" || tipo === "archivo" || tipo === "video");
      const thinkingKind = esAudio ? "audio" : (tipo === "imagen" ? "imagen" : (tipo === "video" ? "video" : (esArchivo ? "archivo" : "texto")));
      if (esAudio || esArchivo || contenido) {
        // Señalizar al frontend que el bot empezó a pensar. La señal se cierra
        // cuando el broadcast chat:message con user_id=null llega al grupo.
        emitToGrupo(String(req.params.id), "copilot:thinking", {
          grupo_id: String(req.params.id),
          kind: thinkingKind,
          started_at: Date.now(),
        });
      }
      if (esAudio) {
        const messageId = rows[0].id;
        setImmediate(() => { transcribeYResponderCopilot(String(req.params.id), messageId, String(finalArchivoUrl), String(u.sub)); });
      } else if (esArchivo) {
        setImmediate(() => {
          analyzeFileAndReplyCopilot(
            String(req.params.id),
            String(finalArchivoUrl),
            archivo_nombre ? String(archivo_nombre) : null,
            archivo_tipo ? String(archivo_tipo) : null,
            contenido ? String(contenido) : null
          );
        });
      } else if (contenido) {
        setImmediate(() => { generarRespuestaCopilot(String(req.params.id), String(contenido)); });
      }
    }
  } catch {}

  // Mark delivered for online recipients (users of this grupo currently online)
  try {
    const grupoRows = await query<any>("SELECT miembros FROM gozz.chat_grupos WHERE id = $1", [req.params.id]);
    const miembros: string[] = Array.isArray(grupoRows[0]?.miembros) ? grupoRows[0].miembros : [];
    const onlineRecipients = await query<any>(
      "SELECT id FROM gozz.users WHERE id = ANY($1::uuid[]) AND id != $2 AND online = true",
      [miembros, u.sub]
    );
    if (onlineRecipients.length > 0) {
      const deliveredIds = onlineRecipients.map((r: any) => r.id);
      await query(
        `UPDATE gozz.chat_mensajes
           SET entregado_por = COALESCE(entregado_por, '[]'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify(deliveredIds), rows[0].id]
      );
      emitToGrupo(String(req.params.id), "chat:delivered", { mensajeId: rows[0].id, userIds: deliveredIds, timestamp: new Date().toISOString() });
    }
  } catch {}

  res.json({ mensaje });
});

// ---------------- Media/archivos/links/search por grupo ----------------
  app.get("/api/chat/grupos/:id/media", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const grupoId = req.params.id;
  const kind = String(req.query.type || "imagen").toLowerCase();
  const q = String(req.query.q || "").trim();

  // Validar membresía
  const g = await query<any>("SELECT miembros FROM gozz.chat_grupos WHERE id = $1", [grupoId]);
  if (!g[0]) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  const miembros: string[] = Array.isArray(g[0].miembros) ? g[0].miembros : [];
  if (!miembros.includes(u.sub)) { res.status(403).json({ error: "No eres miembro" }); return; }

  let where = "";
  const params: any[] = [grupoId];
  if (kind === "imagen") {
    where = "AND (m.tipo = 'imagen' OR m.archivo_tipo ILIKE 'image/%')";
  } else if (kind === "archivo") {
    where = "AND m.archivo_url IS NOT NULL AND NOT (m.tipo = 'imagen' OR m.archivo_tipo ILIKE 'image/%')";
  } else if (kind === "link") {
    where = "AND m.contenido ~ 'https?://[^\\s]+'";
  } else if (kind === "search") {
    if (!q) { res.json({ mensajes: [] }); return; }
    params.push(`%${q}%`);
    where = `AND m.contenido ILIKE $${params.length}`;
  } else {
    res.status(400).json({ error: "type inválido" }); return;
  }

  const rows = await query<any>(
    `SELECT m.*, u.nombre AS user_nombre, u.foto_perfil_url
       FROM gozz.chat_mensajes m
       LEFT JOIN gozz.users u ON u.id = m.user_id
      WHERE m.grupo_id = $1 ${where}
      ORDER BY m.created_at DESC LIMIT 200`,
    params
  );
  res.json({ mensajes: rows });
});

  app.post("/api/chat/upload", requireAuth, upload.single("file"), async (req, res) => {
  const f = (req as any).file;
  if (!f) { res.status(400).json({ error: "No file" }); return; }
  const url = `/uploads/${f.filename}`;
  res.json({
    url,
    filename: f.originalname,
    mimetype: f.mimetype,
    size: f.size
  });
});

// ---------------- DM (chat directo 1-on-1) ----------------
  app.post("/api/chat/dm", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const { target_user_id } = req.body || {};
  if (!target_user_id) { res.status(400).json({ error: "target_user_id requerido" }); return; }
  if (target_user_id === u.sub) { res.status(400).json({ error: "No puedes chatear contigo mismo" }); return; }

  // Buscar DM existente entre ambos
  const existing = await query<any>(
    `SELECT * FROM gozz.chat_grupos
     WHERE tipo = 'directo'
       AND miembros @> to_jsonb($1::text)
       AND miembros @> to_jsonb($2::text)
     LIMIT 1`,
    [u.sub, target_user_id]
  );
  if (existing[0]) { res.json({ grupo: existing[0] }); return; }

  // Crear nuevo DM
  const newRows = await query<any>(
    `INSERT INTO gozz.chat_grupos (nombre, tipo, creado_por, miembros, admins)
     VALUES ('DM', 'directo', $1, $2::jsonb, $3::jsonb)
     RETURNING *`,
    [u.sub, JSON.stringify([u.sub, target_user_id]), JSON.stringify([u.sub, target_user_id])]
  );
  // Auto-suscribir sockets actuales de ambos al room del DM nuevo, así reciben
  // chat:message/chat:typing sin tener que refrescar.
  joinUsersToGrupo([u.sub, target_user_id], newRows[0].id);
  res.json({ grupo: newRows[0] });
});

// ---------------- Contactos (lista de miembros del equipo para picker) ----------------
  app.get("/api/chat/contactos", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const rows = await query<any>(
    `SELECT id, email, nombre, nivel_acceso, foto_perfil_url, online, departamento, posiciones
     FROM gozz.users
     WHERE id != $1 AND activo = true
     ORDER BY nombre`,
    [u.sub]
  );
  res.json({ contactos: rows });
});

// ---------------- Search (grupos + users) ----------------
  app.get("/api/chat/search", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim();
  if (q.length < 1) { res.json({ grupos: [], users: [] }); return; }
  const pattern = "%" + q + "%";
  const grupos = await query<any>(
    `SELECT id, nombre, tipo, avatar_url, ultimo_mensaje, ultimo_mensaje_at
     FROM gozz.chat_grupos
     WHERE miembros @> to_jsonb($1::text)
       AND nombre ILIKE $2
     ORDER BY ultimo_mensaje_at DESC NULLS LAST LIMIT 10`,
    [u.sub, pattern]
  );
  const users = await query<any>(
    `SELECT id, email, nombre, foto_perfil_url, departamento, posiciones, online
     FROM gozz.users
     WHERE id != $1 AND activo = true
       AND (nombre ILIKE $2 OR email ILIKE $2)
     ORDER BY nombre LIMIT 10`,
    [u.sub, pattern]
  );
  res.json({ grupos, users });
});

// ---------------- Stats y secciones de perfil de usuario ----------------
  function canViewUserData(viewer: any, targetId: string): boolean {
  if (!viewer) return false;
  if (viewer.sub === targetId) return true;
  return viewer.nivel === "super_admin" || viewer.nivel === "admin";
}

  app.get("/api/users/:id/stats", requireAuth, async (req, res) => {
  const u = (req as any).user;
  if (!canViewUserData(u, String(req.params.id))) { res.status(403).json({ error: "Sin permisos" }); return; }
  const uid = req.params.id;
  const rows = await query<any>(
    `SELECT
       (SELECT COUNT(*)::int FROM gozz.tareas t WHERE t.estado = 'pendiente' AND (t.responsable_id = $1 OR t.propietario_id = $1)) AS tareas_pendientes,
       (SELECT COUNT(*)::int FROM gozz.tareas t WHERE t.estado = 'completada' AND (t.responsable_id = $1 OR t.propietario_id = $1)) AS tareas_completadas,
       (SELECT COUNT(*)::int FROM gozz.tareas t WHERE t.estado = 'completada' AND (t.responsable_id = $1 OR t.propietario_id = $1) AND t.fecha_completada >= date_trunc('month', NOW())) AS tareas_completadas_mes,
       (SELECT COALESCE(SUM(ph.puntos),0)::int FROM gozz.puntajes_historial ph WHERE ph.user_id = $1) AS puntos_total,
       (SELECT COALESCE(SUM(ph.puntos),0)::int FROM gozz.puntajes_historial ph WHERE ph.user_id = $1 AND ph.created_at >= date_trunc('month', NOW())) AS puntos_mes,
       (SELECT COALESCE(SUM(ph.puntos * ph.valor_punto_usd),0)::numeric(12,2) FROM gozz.puntajes_historial ph WHERE ph.user_id = $1 AND ph.created_at >= date_trunc('month', NOW())) AS ingresos_mes_usd,
       (SELECT COUNT(*)::int FROM gozz.oportunidades o WHERE (o.vendedor_id = $1 OR o.preparador_id = $1) AND o.etapa = 'completada') AS oportunidades_completadas,
       (SELECT COUNT(*)::int FROM gozz.oportunidades o WHERE (o.vendedor_id = $1 OR o.preparador_id = $1) AND o.etapa != 'completada') AS oportunidades_activas`,
    [uid]
  );
  res.json(rows[0] || {});
});

  app.get("/api/users/:id/tareas", requireAuth, async (req, res) => {
  const u = (req as any).user;
  if (!canViewUserData(u, String(req.params.id))) { res.status(403).json({ error: "Sin permisos" }); return; }
  const estado = req.query.estado === "completada" ? "completada" : req.query.estado === "pendiente" ? "pendiente" : null;
  const desde = typeof req.query.desde === "string" ? req.query.desde : null;
  const hasta = typeof req.query.hasta === "string" ? req.query.hasta : null;
  const params: any[] = [req.params.id];
  let where = "(t.responsable_id = $1 OR t.propietario_id = $1)";
  if (estado) { params.push(estado); where += ` AND t.estado = $${params.length}`; }
  if (desde) { params.push(desde); where += ` AND t.fecha_limite >= $${params.length}`; }
  if (hasta) { params.push(hasta); where += ` AND t.fecha_limite <= $${params.length}`; }
  const rows = await query<any>(
    `SELECT t.id, t.titulo, t.descripcion, t.estado, t.prioridad, t.fecha_limite, t.fecha_completada, t.created_at,
            t.oportunidad_id, o.nombre_caso AS oportunidad_nombre
       FROM gozz.tareas t
       LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
      WHERE ${where}
      ORDER BY (t.estado = 'completada'), t.fecha_limite ASC NULLS LAST, t.created_at DESC
      LIMIT 500`,
    params
  );
  res.json({ tareas: rows });
});

  app.get("/api/users/:id/calendario", requireAuth, async (req, res) => {
  const u = (req as any).user;
  if (!canViewUserData(u, String(req.params.id))) { res.status(403).json({ error: "Sin permisos" }); return; }
  const uid = String(req.params.id);
  const desde = typeof req.query.desde === "string" ? req.query.desde : null;
  const hasta = typeof req.query.hasta === "string" ? req.query.hasta : null;
  const params: any[] = [uid];
  let tareaWhere = "(t.responsable_id = $1 OR t.propietario_id = $1) AND t.fecha_limite IS NOT NULL";
  if (desde) { params.push(desde); tareaWhere += ` AND t.fecha_limite >= $${params.length}`; }
  if (hasta) { params.push(hasta); tareaWhere += ` AND t.fecha_limite <= $${params.length}`; }
  const tareas = await query<any>(
    `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_limite, t.oportunidad_id,
            o.nombre_caso AS oportunidad_nombre
       FROM gozz.tareas t
       LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
      WHERE ${tareaWhere}
      ORDER BY t.fecha_limite ASC
      LIMIT 500`,
    params
  );
  // SLAs de oportunidades asignadas al usuario
  const paramsO: any[] = [uid];
  let oWhere = "(o.vendedor_id = $1 OR o.preparador_id = $1 OR o.manager_ventas_id = $1 OR o.manager_preparacion_id = $1 OR o.supervisor_id = $1) AND o.sla_fecha_limite IS NOT NULL AND o.etapa != 'completada'";
  if (desde) { paramsO.push(desde); oWhere += ` AND o.sla_fecha_limite >= $${paramsO.length}`; }
  if (hasta) { paramsO.push(hasta); oWhere += ` AND o.sla_fecha_limite <= $${paramsO.length}`; }
  const slas = await query<any>(
    `SELECT o.id, o.nombre_caso, o.etapa, o.sla_fecha_limite, o.sla_estado
       FROM gozz.oportunidades o
      WHERE ${oWhere}
      ORDER BY o.sla_fecha_limite ASC
      LIMIT 200`,
    paramsO
  );
  res.json({ tareas, slas });
});

  app.get("/api/users/:id/clock-semana", requireAuth, async (req, res) => {
  const u = (req as any).user;
  if (!canViewUserData(u, String(req.params.id))) { res.status(403).json({ error: "Sin permisos" }); return; }
  const uid = req.params.id;
  const entries = await query<any>(
    `SELECT e.id, e.entrada_at, e.salida_at, e.fecha_local, e.fue_tarde, e.minutos_tarde, e.minutos_totales,
            COALESCE(SUM(b.minutos),0)::int AS total_break_min
       FROM gozz.clock_entries e
       LEFT JOIN gozz.clock_breaks b ON b.clock_entry_id = e.id
      WHERE e.user_id = $1 AND e.fecha_local >= CURRENT_DATE - INTERVAL '13 days'
      GROUP BY e.id
      ORDER BY e.entrada_at DESC`,
    [uid]
  );
  const recentPunct = await query<any>(
    `SELECT fue_tarde FROM gozz.clock_entries WHERE user_id = $1 ORDER BY fecha_local DESC LIMIT 30`,
    [uid]
  );
  let racha = 0;
  for (const r of recentPunct) { if (r.fue_tarde === false) racha++; else break; }
  const sched = await query<any>("SELECT hora_entrada, zona_horaria, estricto, tolerancia_minutos, break_minutos_max FROM gozz.user_schedule WHERE user_id = $1", [uid]);
  res.json({ entries, racha, schedule: sched[0] || null });
});

// ---------------- Estado per-user (fijar/ocultar/recordar) ----------------
  app.patch("/api/chat/grupos/:id/estado", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const { fijado, oculto, recordar_at, silenciado } = req.body || {};
  // Validar membresía
  const g = await query<any>("SELECT miembros FROM gozz.chat_grupos WHERE id = $1", [req.params.id]);
  if (!g[0]) { res.status(404).json({ error: "No encontrado" }); return; }
  const miembros: string[] = Array.isArray(g[0].miembros) ? g[0].miembros : [];
  if (!miembros.includes(u.sub)) { res.status(403).json({ error: "No eres miembro" }); return; }

  const rows = await query<any>(
    `INSERT INTO gozz.chat_grupos_user_estado (grupo_id, user_id, fijado, oculto, silenciado, recordar_at, updated_at)
     VALUES ($1, $2, COALESCE($3, false), COALESCE($4, false), COALESCE($6, false), $5, NOW())
     ON CONFLICT (grupo_id, user_id) DO UPDATE SET
       fijado = COALESCE($3, gozz.chat_grupos_user_estado.fijado),
       oculto = COALESCE($4, gozz.chat_grupos_user_estado.oculto),
       silenciado = COALESCE($6, gozz.chat_grupos_user_estado.silenciado),
       recordar_at = $5,
       updated_at = NOW()
     RETURNING *`,
    [req.params.id, u.sub,
      typeof fijado === "boolean" ? fijado : null,
      typeof oculto === "boolean" ? oculto : null,
      recordar_at ? new Date(recordar_at) : null,
      typeof silenciado === "boolean" ? silenciado : null
    ]
  );
  res.json({ estado: rows[0] });
});

// Ids de los grupos que el usuario tiene silenciados. Endpoint liviano para que los
// notificadores globales (ping + toast) sepan qué suprimir sin traer toda la lista de chats.
  app.get("/api/chat/silenciados", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const rows = await query<any>(
    "SELECT grupo_id FROM gozz.chat_grupos_user_estado WHERE user_id = $1 AND silenciado = true",
    [u.sub]
  );
  res.json({ grupo_ids: rows.map((r: any) => String(r.grupo_id)) });
});

// ---------------- Marcar leído ----------------
  app.post("/api/chat/grupos/:id/leer", requireAuth, async (req, res) => {
  const u = (req as any).user;
  // Añade este user a leido_por en todos los mensajes del grupo que aún no lo tienen
  await query(
    `UPDATE gozz.chat_mensajes
     SET leido_por = COALESCE(leido_por, '[]'::jsonb) || to_jsonb($1::text)
     WHERE grupo_id = $2 AND NOT (COALESCE(leido_por, '[]'::jsonb) @> to_jsonb($1::text))`,
    [u.sub, req.params.id]
  );
  res.json({ ok: true });
});

  app.post("/api/chat/grupos/:id/mensajes/:msgId/reaccion", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const emoji = String((req.body || {}).emoji || "");
  if (!emoji) { res.status(400).json({ error: "emoji requerido" }); return; }
  const rows = await query<any>("SELECT reacciones FROM gozz.chat_mensajes WHERE id = $1 AND grupo_id = $2", [req.params.msgId, req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: "Mensaje no encontrado" }); return; }
  const reacciones: Record<string, string[]> = (rows[0].reacciones && typeof rows[0].reacciones === "object" && !Array.isArray(rows[0].reacciones)) ? rows[0].reacciones : {};
  const arr: string[] = Array.isArray(reacciones[emoji]) ? reacciones[emoji] : [];
  reacciones[emoji] = arr.includes(u.sub) ? arr.filter((x) => x !== u.sub) : [...arr, u.sub];
  if (reacciones[emoji].length === 0) delete reacciones[emoji];
  const upd = await query<any>("UPDATE gozz.chat_mensajes SET reacciones = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING reacciones", [JSON.stringify(reacciones), req.params.msgId]);
  emitToGrupo(String(req.params.id), "chat:message:updated", { id: req.params.msgId, reacciones: upd[0].reacciones });
  res.json({ reacciones: upd[0].reacciones });
});

// ---------------- Editar mensaje (solo autor, solo texto) ----------------
  app.patch("/api/chat/grupos/:id/mensajes/:msgId", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const contenido = typeof (req.body || {}).contenido === "string" ? (req.body.contenido as string).trim() : "";
  if (!contenido) { res.status(400).json({ error: "Contenido requerido" }); return; }
  const m = (await query<any>("SELECT user_id, tipo, eliminado, created_at FROM gozz.chat_mensajes WHERE id = $1 AND grupo_id = $2", [req.params.msgId, req.params.id]))[0];
  if (!m) { res.status(404).json({ error: "Mensaje no encontrado" }); return; }
  if (m.user_id !== u.sub) { res.status(403).json({ error: "Solo puedes editar tus mensajes" }); return; }
  if (m.eliminado) { res.status(400).json({ error: "Mensaje eliminado" }); return; }
  if (m.tipo !== "texto") { res.status(400).json({ error: "Solo se editan mensajes de texto" }); return; }
  if (Date.now() - new Date(m.created_at).getTime() > 3 * 60 * 1000) { res.status(403).json({ error: "Solo se puede editar dentro de los primeros 3 minutos" }); return; }
  await query("UPDATE gozz.chat_mensajes SET contenido = $1, editado = true, updated_at = NOW() WHERE id = $2", [contenido, req.params.msgId]);
  emitToGrupo(String(req.params.id), "chat:message:updated", { id: req.params.msgId, contenido, editado: true });
  res.json({ ok: true, contenido, editado: true });
});

// ---------------- Eliminar mensaje (soft-delete: autor o admin del grupo) ----------------
  app.delete("/api/chat/grupos/:id/mensajes/:msgId", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const m = (await query<any>("SELECT user_id, archivo_url, contenido FROM gozz.chat_mensajes WHERE id = $1 AND grupo_id = $2", [req.params.msgId, req.params.id]))[0];
  if (!m) { res.status(404).json({ error: "Mensaje no encontrado" }); return; }
  const g = (await query<any>("SELECT admins, creado_por FROM gozz.chat_grupos WHERE id = $1", [req.params.id]))[0];
  const admins: string[] = Array.isArray(g?.admins) ? g.admins : [];
  const puede = m.user_id === u.sub || sysAdmin || g?.creado_por === u.sub || admins.includes(u.sub);
  if (!puede) { res.status(403).json({ error: "Sin permiso para eliminar" }); return; }
  await query("UPDATE gozz.chat_mensajes SET eliminado = true, contenido = NULL, archivo_url = NULL, archivo_nombre = NULL, archivo_tipo = NULL, reacciones = '{}'::jsonb, link_preview = NULL, updated_at = NOW() WHERE id = $1", [req.params.msgId]);
  emitToGrupo(String(req.params.id), "chat:message:updated", { id: req.params.msgId, eliminado: true, contenido: null, tipo: "texto", archivo_url: null, archivo_nombre: null, archivo_tipo: null, reacciones: {}, link_preview: null });
  res.json({ ok: true });
  const msgUrls = [m.archivo_url, ...(typeof m.contenido === "string" ? (m.contenido.match(/\/uploads\/[^\s)"'<>\]]+/g) || []) : [])];
  deleteUploadsIfUnreferenced(msgUrls, { origen: "cascade_chat", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup chat-msg]", e?.message));
});

// ---------------- Fijar / desfijar mensaje en el chat (cualquier miembro, maximo 5) ----------------
  app.post("/api/chat/grupos/:id/fijar", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const grupoId = String(req.params.id);
  const g = (await query<any>("SELECT miembros, mensajes_fijados FROM gozz.chat_grupos WHERE id = $1", [grupoId]))[0];
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  const miembros: string[] = Array.isArray(g.miembros) ? g.miembros : [];
  if (!miembros.includes(u.sub)) { res.status(403).json({ error: "No eres miembro del chat" }); return; }
  const rawId = (req.body || {}).mensaje_id;
  if (!rawId) { res.status(400).json({ error: "mensaje_id requerido" }); return; }
  const m = (await query<any>("SELECT id FROM gozz.chat_mensajes WHERE id = $1 AND grupo_id = $2 AND NOT COALESCE(eliminado, false)", [String(rawId), grupoId]))[0];
  if (!m) { res.status(404).json({ error: "Mensaje no encontrado" }); return; }

  let lista: string[] = Array.isArray(g.mensajes_fijados) ? g.mensajes_fijados.map((x: any) => String(x)) : [];
  const yaFijado = lista.includes(m.id);
  let accion: "fijar" | "desfijar";
  if (yaFijado) {
    lista = lista.filter((x) => x !== m.id);
    accion = "desfijar";
  } else {
    if (lista.length >= 5) { res.status(400).json({ error: "Maximo 5 mensajes fijados. Desfija uno primero." }); return; }
    lista = [m.id, ...lista];
    accion = "fijar";
  }
  await query("UPDATE gozz.chat_grupos SET mensajes_fijados = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(lista), grupoId]);

  let ordenados: any[] = [];
  if (lista.length) {
    const rows = await query<any>(
      `SELECT m.id, m.contenido, m.tipo, m.archivo_nombre, m.user_id, u.nombre AS user_nombre
       FROM gozz.chat_mensajes m LEFT JOIN gozz.users u ON u.id = m.user_id
       WHERE m.id = ANY($1::uuid[])`, [lista]);
    const byId = new Map(rows.map((x: any) => [String(x.id), x]));
    ordenados = lista.map((id) => byId.get(id)).filter(Boolean);
  }

  if (accion === "fijar") {
    const nombre = (await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]))[0]?.nombre || "Alguien";
    const ins = (await query<any>(
      `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
       VALUES ($1, NULL, 'sistema', $2) RETURNING *`,
      [grupoId, "\u{1F4CC} " + nombre + " fijó un mensaje"]))[0];
    await query("UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2", [(ins.contenido || "").slice(0, 100), grupoId]);
    emitToGrupo(grupoId, "chat:message", { ...ins, user_nombre: "Sistema", foto_perfil_url: null });
  }

  emitToGrupo(grupoId, "chat:pin:updated", { grupo_id: grupoId, mensajes_fijados: ordenados });
  res.json({ ok: true, mensajes_fijados: ordenados });
});

  async function chatGrupoAdminCheck(grupoId: string, sub: string, sysAdmin: boolean) {
  const g = (await query<any>("SELECT miembros, admins, creado_por FROM gozz.chat_grupos WHERE id = $1", [grupoId]))[0];
  if (!g) return { ok: false, g: null as any };
  const admins: string[] = Array.isArray(g.admins) ? g.admins : [];
  return { ok: sysAdmin || g.creado_por === sub || admins.includes(sub), g };
}

  app.get("/api/chat/grupos/:id/miembros", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const g = (await query<any>("SELECT miembros, admins, creado_por FROM gozz.chat_grupos WHERE id = $1", [req.params.id]))[0];
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  const miembros: string[] = Array.isArray(g.miembros) ? g.miembros : [];
  if (!miembros.includes(u.sub)) { res.status(403).json({ error: "No eres miembro" }); return; }
  const admins: string[] = Array.isArray(g.admins) ? g.admins : [];
  const soyAdmin = sysAdmin || g.creado_por === u.sub || admins.includes(u.sub);
  if (miembros.length === 0) { res.json({ miembros: [], soy_admin: soyAdmin }); return; }
  const rows = await query<any>(
    `SELECT us.id, us.nombre, us.foto_perfil_url, us.online, c.nombre AS cargo
       FROM gozz.users us
       LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = us.id
       LEFT JOIN gozz.cargos c ON c.id = up.cargo_id
      WHERE us.id = ANY($1::uuid[]) ORDER BY us.nombre`,
    [miembros]
  );
  res.json({ miembros: rows.map((r: any) => ({ ...r, admin: admins.includes(r.id) })), soy_admin: soyAdmin });
});

  app.get("/api/chat/grupos/:id/tarea", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const g = (await query<any>("SELECT miembros, tarea_id FROM gozz.chat_grupos WHERE id = $1", [req.params.id]))[0];
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  const miembros: string[] = Array.isArray(g.miembros) ? g.miembros : [];
  if (!sysAdmin && !miembros.includes(u.sub)) { res.status(403).json({ error: "No eres miembro" }); return; }
  if (!g.tarea_id) { res.status(404).json({ error: "El grupo no es de una tarea" }); return; }
  const t = (await query<any>(
    `SELECT t.id AS tarea_id, t.titulo, t.oportunidad_id, o.nombre_caso AS oportunidad_nombre
       FROM gozz.tareas t
       LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
      WHERE t.id = $1`,
    [g.tarea_id]
  ))[0];
  if (!t) { res.status(404).json({ error: "Tarea no encontrada" }); return; }
  res.json({ tarea_id: t.tarea_id, titulo: t.titulo, oportunidad_id: t.oportunidad_id, oportunidad_nombre: t.oportunidad_nombre });
});

  app.post("/api/chat/grupos/:id/miembros", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const userId = String((req.body || {}).user_id || "");
  if (!userId) { res.status(400).json({ error: "user_id requerido" }); return; }
  const { ok, g } = await chatGrupoAdminCheck(String(req.params.id), u.sub, sysAdmin);
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  if (!ok) { res.status(403).json({ error: "Solo admins del grupo" }); return; }
  const miembros: string[] = Array.isArray(g.miembros) ? g.miembros : [];
  if (!miembros.includes(userId)) miembros.push(userId);
  await query("UPDATE gozz.chat_grupos SET miembros = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(miembros), req.params.id]);
  // Auto-suscribir los sockets actuales del nuevo miembro al room del grupo,
  // así empieza a recibir chat:message/chat:typing sin refrescar.
  joinUsersToGrupo([userId], String(req.params.id));
  res.json({ ok: true });
});

  app.delete("/api/chat/grupos/:id/miembros/:userId", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const { ok, g } = await chatGrupoAdminCheck(String(req.params.id), u.sub, sysAdmin);
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  if (!ok) { res.status(403).json({ error: "Solo admins del grupo" }); return; }
  const miembros: string[] = (Array.isArray(g.miembros) ? g.miembros : []).filter((x: string) => x !== String(req.params.userId));
  const admins: string[] = (Array.isArray(g.admins) ? g.admins : []).filter((x: string) => x !== String(req.params.userId));
  await query("UPDATE gozz.chat_grupos SET miembros = $1::jsonb, admins = $2::jsonb, updated_at = NOW() WHERE id = $3", [JSON.stringify(miembros), JSON.stringify(admins), req.params.id]);
  res.json({ ok: true });
});

  app.patch("/api/chat/grupos/:id", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const { ok, g } = await chatGrupoAdminCheck(String(req.params.id), u.sub, sysAdmin);
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  if (!ok) { res.status(403).json({ error: "Solo admins del grupo" }); return; }
  const b = req.body || {};
  // Si el avatar de grupo viene PLANO (recién subido), moverlo a chats/grupos/<grupoId>/. El regex
  // NO matchea /uploads/avatars/... (subcarpeta), así que los avatares de USUARIO de chats directos
  // quedan excluidos automáticamente (no se mueven).
  let avatarUrl = b.avatar_url;
  if (typeof avatarUrl === "string" && /^\/uploads\/[^/]+$/.test(avatarUrl)) {
    const fname = avatarUrl.replace(/^\/uploads\//, "");
    const flat = path.join(UPLOADS_DIR, fname);
    if (fs.existsSync(flat)) {
      avatarUrl = placeUploadedFile(flat, "chat_grupo_avatar", { grupoId: String(req.params.id) }, fname);
    }
  }
  const sets: string[] = []; const params: any[] = [];
  if (typeof b.nombre === "string" && b.nombre.trim()) { params.push(b.nombre.trim()); sets.push(`nombre = $${params.length}`); }
  if (typeof b.avatar_url === "string") { params.push(avatarUrl || null); sets.push(`avatar_url = $${params.length}`); }
  if (sets.length === 0) { res.json({ ok: true }); return; }
  params.push(req.params.id);
  const rows = await query<any>(`UPDATE gozz.chat_grupos SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING id, nombre, avatar_url`, params);
  res.json({ grupo: rows[0] });
});

// ---------------- Eliminar chat (borrar para todos: creador o admin) ----------------
  app.delete("/api/chat/grupos/:id", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const sysAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const grupoId = String(req.params.id);
  const g = (await query<any>("SELECT admins, creado_por FROM gozz.chat_grupos WHERE id = $1", [grupoId]))[0];
  if (!g) { res.status(404).json({ error: "Grupo no encontrado" }); return; }
  const admins: string[] = Array.isArray(g.admins) ? g.admins : [];
  const puede = sysAdmin || g.creado_por === u.sub || admins.includes(u.sub);
  if (!puede) { res.status(403).json({ error: "Solo el creador o un admin puede eliminar el chat" }); return; }

  // Avisar a los miembros ANTES de borrar (la room sigue activa).
  emitToGrupo(grupoId, "chat:grupo-eliminado", { grupoId });

  // Recolectar urls de archivos de los mensajes (y el avatar del grupo) ANTES de borrar.
  const msgs = await query<any>("SELECT archivo_url, contenido FROM gozz.chat_mensajes WHERE grupo_id = $1", [grupoId]);
  const gAvatar = (await query<any>("SELECT avatar_url FROM gozz.chat_grupos WHERE id = $1", [grupoId]))[0]?.avatar_url;
  const cleanupUrls: string[] = [];
  for (const m of msgs) {
    if (m.archivo_url) cleanupUrls.push(m.archivo_url);
    if (typeof m.contenido === "string") for (const x of (m.contenido.match(/\/uploads\/[^\s)"'<>\]]+/g) || [])) cleanupUrls.push(x);
  }
  if (typeof gAvatar === "string" && gAvatar.startsWith("/uploads/") && !gAvatar.startsWith("/uploads/avatars/")) cleanupUrls.push(gAvatar);

  // Desligar videollamadas para no romper FK, luego borrar mensajes, estado y el grupo.
  await query("UPDATE gozz.videollamadas SET grupo_id = NULL WHERE grupo_id = $1", [grupoId]);
  await query("DELETE FROM gozz.chat_mensajes WHERE grupo_id = $1", [grupoId]);
  await query("DELETE FROM gozz.chat_grupos_user_estado WHERE grupo_id = $1", [grupoId]);
  await query("DELETE FROM gozz.chat_grupos WHERE id = $1", [grupoId]);

  res.json({ ok: true });
  deleteUploadsIfUnreferenced(cleanupUrls, { origen: "cascade_chat", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup chat-grupo]", e?.message));
});

  app.post("/api/chat/grupos", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const { nombre, tipo, descripcion, miembros } = req.body;
  if (!nombre) { res.status(400).json({ error: "Nombre requerido" }); return; }
  const allowedTipos = ["grupo", "canal", "departamento", "tarea"];
  const tipoFinal = allowedTipos.includes(tipo) ? tipo : "grupo";
  const miembrosList = Array.isArray(miembros) ? miembros.filter((x: any) => typeof x === "string" && x) : [];
  if (!miembrosList.includes(u.sub)) miembrosList.push(u.sub);
  const rows = await query<any>(
    `INSERT INTO gozz.chat_grupos (nombre, tipo, descripcion, creado_por, miembros, admins)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) RETURNING *`,
    [nombre, tipoFinal, descripcion || null, u.sub, JSON.stringify(miembrosList), JSON.stringify([u.sub])]
  );
  // Auto-suscribir los sockets actuales de todos los miembros al room del grupo
  // nuevo, así reciben chat:message/chat:typing sin tener que refrescar.
  joinUsersToGrupo(miembrosList, rows[0].id);
  res.json({ grupo: rows[0] });
});

// ---------------- CoPilot (chat personal con Claude) ----------------
  app.post("/api/chat/copilot", requireAuth, async (req, res) => {
  const u = (req as any).user;
  // 1 copilot grupo por usuario
  const existing = await query<any>(
    "SELECT * FROM gozz.chat_grupos WHERE tipo = 'copilot' AND creado_por = $1 LIMIT 1",
    [u.sub]
  );
  if (existing[0]) { res.json({ grupo: existing[0] }); return; }
  const rows = await query<any>(
    `INSERT INTO gozz.chat_grupos (nombre, tipo, descripcion, creado_por, miembros, admins)
     VALUES ('CoPilot', 'copilot', 'Asistente IA personal · Claude Sonnet', $1, $2::jsonb, $3::jsonb)
     RETURNING *`,
    [u.sub, JSON.stringify([u.sub]), JSON.stringify([u.sub])]
  );
  // Auto-suscribir el socket del creador al room del CoPilot recién creado, así
  // las respuestas del bot llegan en vivo sin refrescar.
  joinUsersToGrupo([u.sub], rows[0].id);
  // mensaje de bienvenida del bot
  const welcome = "¡Hola! Soy tu CoPilot. Pregúntame lo que necesites sobre el CRM, trámites, borradores, ideas o dudas generales. Respondo en español.";
  const msgRows = await query<any>(
    `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
     VALUES ($1, NULL, 'texto', $2) RETURNING *`,
    [rows[0].id, welcome]
  );
  await query(
    "UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2",
    [welcome.slice(0, 100), rows[0].id]
  );
  res.json({ grupo: rows[0], mensaje_bienvenida: msgRows[0] });
});

  async function generarRespuestaCopilot(grupoId: string, userMessageText: string) {
  try {
    // Fetch usuario + últimos 20 mensajes para contexto
    const [grupoInfo, histRows] = await Promise.all([
      query<any>(
        `SELECT g.creado_por AS owner_id, u.nombre AS owner_nombre, u.nivel_acceso AS owner_nivel
           FROM gozz.chat_grupos g LEFT JOIN gozz.users u ON u.id = g.creado_por
           WHERE g.id = $1`,
        [grupoId]
      ),
      query<any>(
        `SELECT user_id, tipo, contenido FROM gozz.chat_mensajes
           WHERE grupo_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [grupoId]
      ),
    ]);
    const owner = grupoInfo[0] || {};
    const history = histRows.slice().reverse().filter((m: any) => m.contenido);

    // El historial va como turnos REALES (mensaje nuevo fuera). El persona y el estilo
    // viven en el system prompt del servicio AI, no aquí — evitamos duplicación.
    // En `context` mandamos sólo metadatos útiles + historial reciente.
    const contextLines = history.slice(-12, -1).map((m: any) => `${m.user_id ? "USUARIO" : "COPILOT"}: ${m.contenido}`).join("\n");
    const context = [
      owner.owner_nombre ? `Usuario actual: ${owner.owner_nombre} (rol: ${owner.owner_nivel || "usuario"})` : null,
      `Fecha actual: ${new Date().toLocaleString("es", { timeZone: "America/New_York" })} (ET)`,
      contextLines ? `\nHistorial reciente del chat:\n${contextLines}` : null,
    ].filter(Boolean).join("\n");

    const AI_URL = process.env.AI_URL || "http://127.0.0.1:8100";
    const r = await fetch(`${AI_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessageText, context })
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok || !data?.response) {
      console.error("[copilot] AI error", data);
      return;
    }
    const reply = String(data.response).trim();
    const rep = await query<any>(
      `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
       VALUES ($1, NULL, 'texto', $2) RETURNING *`,
      [grupoId, reply]
    );
    await query(
      "UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2",
      [reply.slice(0, 100), grupoId]
    );
    emitToGrupo(grupoId, "chat:message", { ...rep[0], user_nombre: "CoPilot", foto_perfil_url: null, es_copilot: true });
  } catch (e: any) {
    console.error("[copilot] crash", e?.message);
  }
}

/**
 * Analiza un archivo adjunto (PDF/imagen/DOCX/XLSX/TXT/...) que el usuario mandó al
 * grupo CoPilot. El archivo se pasa al servicio AI en el campo `attachments` y
 * Claude lo lee directamente (PDF+imagen nativos en Sonnet 4.6, DOCX/XLSX se
 * extrae como texto). El caption del mensaje (si existe) va como prompt.
 */
  async function analyzeFileAndReplyCopilot(
  grupoId: string,
  archivoUrl: string,
  archivoNombre: string | null,
  archivoTipo: string | null,
  contenidoTexto: string | null,
) {
  try {
    const [grupoInfo, histRows] = await Promise.all([
      query<any>(
        `SELECT g.creado_por AS owner_id, u.nombre AS owner_nombre, u.nivel_acceso AS owner_nivel
           FROM gozz.chat_grupos g LEFT JOIN gozz.users u ON u.id = g.creado_por
           WHERE g.id = $1`,
        [grupoId]
      ),
      query<any>(
        `SELECT user_id, tipo, contenido FROM gozz.chat_mensajes
           WHERE grupo_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [grupoId]
      ),
    ]);
    const owner = grupoInfo[0] || {};
    const history = histRows.slice().reverse().filter((m: any) => m.contenido);
    const contextLines = history.slice(-12, -1).map((m: any) => `${m.user_id ? "USUARIO" : "COPILOT"}: ${m.contenido}`).join("\n");
    const context = [
      owner.owner_nombre ? `Usuario actual: ${owner.owner_nombre} (rol: ${owner.owner_nivel || "usuario"})` : null,
      `Fecha actual: ${new Date().toLocaleString("es", { timeZone: "America/New_York" })} (ET)`,
      contextLines ? `\nHistorial reciente del chat:\n${contextLines}` : null,
    ].filter(Boolean).join("\n");

    const userMessage = (contenidoTexto && contenidoTexto.trim().length > 0)
      ? contenidoTexto
      : `Analiza este archivo: ${archivoNombre || "sin nombre"}. Dame un resumen ejecutivo, identificá qué tipo de documento es, extraé los datos clave y sugerí 3 próximas acciones relevantes.`;

    const AI_URL = process.env.AI_URL || "http://127.0.0.1:8100";
    // apps/ai descarga el attachment por HTTP: darle una URL ABSOLUTA con la base de ESTA API
    // (staging vs prod), configurable por SELF_BASE. Si ya es absoluta, se usa tal cual.
    const SELF_BASE = process.env.SELF_BASE || "http://127.0.0.1:4100";
    const absUrl = archivoUrl.startsWith("/") ? `${SELF_BASE}${archivoUrl}` : archivoUrl;
    const r = await fetch(`${AI_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        context,
        attachments: [{ url: absUrl, mime: archivoTipo, name: archivoNombre }],
      }),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok || !data?.response) {
      console.error("[copilot/file] AI error", r.status, data);
      return;
    }
    const reply = String(data.response).trim();
    const rep = await query<any>(
      `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
       VALUES ($1, NULL, 'texto', $2) RETURNING *`,
      [grupoId, reply]
    );
    await query(
      "UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2",
      [reply.slice(0, 100), grupoId]
    );
    emitToGrupo(grupoId, "chat:message", { ...rep[0], user_nombre: "CoPilot", foto_perfil_url: null, es_copilot: true });
  } catch (e: any) {
    console.error("[copilot/file] crash", e?.message);
  }
}

/**
 * Transcribe un audio que el usuario envió al grupo CoPilot y luego dispara la
 * respuesta de Claude usando el texto transcrito. Actualiza el mensaje original
 * con el transcript para que se vea en el chat debajo del audio.
 */
  async function transcribeYResponderCopilot(grupoId: string, messageId: string, archivoUrl: string, userId: string) {
  try {
    // Resolver la ruta absoluta del audio (soporta URLs organizadas o planas).
    const rutaAbs = uploadUrlToAbsPath(archivoUrl);
    const filename = path.basename(rutaAbs);
    const fs = await import("node:fs");
    if (!fs.existsSync(rutaAbs)) {
      console.error("[copilot/audio] archivo no encontrado:", rutaAbs);
      return;
    }
    const buf = await fs.promises.readFile(rutaAbs);

    // POST multipart al servicio AI
    const AI_URL = process.env.AI_URL || "http://127.0.0.1:8100";
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "audio/webm" }), filename);
    fd.append("language", "es");
    const r = await fetch(`${AI_URL}/transcribe`, { method: "POST", body: fd as any });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok || !data?.text) {
      console.error("[copilot/audio] transcribe falló", r.status, data);
      return;
    }
    const transcript: string = String(data.text).trim();
    if (!transcript) {
      console.error("[copilot/audio] transcript vacío");
      return;
    }

    // Guardar transcript en el mensaje original para que se vea en el chat
    await query(
      "UPDATE gozz.chat_mensajes SET contenido = $1 WHERE id = $2",
      [transcript, messageId]
    );
    emitToGrupo(grupoId, "chat:message:updated", { id: messageId, contenido: transcript });

    // Disparar respuesta de Claude con el transcript como mensaje
    await generarRespuestaCopilot(grupoId, transcript);
  } catch (e: any) {
    console.error("[copilot/audio] crash", e?.message);
  }
}
}
