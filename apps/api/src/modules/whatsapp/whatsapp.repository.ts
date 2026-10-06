// Único lugar del slice con acceso directo a SQL. Sin dependencia de Baileys — se usa tanto desde
// las rutas HTTP (proceso gozz-api) como desde whatsapp-connection-manager.ts (proceso
// gozz-whatsapp-worker), vía whatsapp.service.ts.
import { query } from "../../shared/db.js";
import { e164DesdeWhatsApp, e164DesdeTextoLibre } from "../../lib/telefono.js";
import type {
  WhatsAppConexion,
  WhatsAppConexionEstado,
  WhatsAppConversacion,
  WhatsAppMensaje,
  WhatsAppMensajeEstado,
  WhatsAppPipelineStage,
  WhatsAppTag,
} from "@gozz/shared-types";

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------

// Columnas seguras para exponer por API — NUNCA incluir `session_state_enc` aquí (es la sesión
// cifrada de WhatsApp; antes se filtraba completa vía `SELECT *` en las respuestas de /conexiones).
const CONEXION_COLUMNS = `
  id, nombre, telefono, owner_user_id, proveedor, estado, qr_actual, qr_actualizado_at,
  meta_cloud_phone_number_id, activo, errores_consecutivos, ultimo_error, ultima_actividad,
  created_at, updated_at
`;

export async function listConexiones(userId: string, isAdmin: boolean): Promise<WhatsAppConexion[]> {
  if (isAdmin) {
    return query<WhatsAppConexion>(`SELECT ${CONEXION_COLUMNS} FROM gozz.whatsapp_conexiones WHERE activo = true ORDER BY created_at`);
  }
  return query<WhatsAppConexion>(
    `SELECT DISTINCT ${CONEXION_COLUMNS.trim().split(",").map((c) => `c.${c.trim()}`).join(", ")}
     FROM gozz.whatsapp_conexiones c
     LEFT JOIN gozz.whatsapp_conexion_acl a ON a.conexion_id = c.id
     WHERE c.activo = true AND (c.owner_user_id = $1 OR a.user_id = $1)
     ORDER BY c.created_at`,
    [userId]
  );
}

/** Total de no leídos de TODAS las conversaciones a las que el usuario tiene acceso — para la
 * insignia del menú lateral. `EXISTS` en vez de `LEFT JOIN` a propósito: un `JOIN` contra
 * `whatsapp_conexion_acl` duplicaría filas (y por tanto el conteo) si una conexión tuviera más de
 * una entrada de ACL. */
export async function contarNoLeidos(userId: string, isAdmin: boolean): Promise<number> {
  if (isAdmin) {
    const rows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(c.no_leidos_count), 0) AS total
       FROM gozz.whatsapp_conversaciones c
       JOIN gozz.whatsapp_conexiones cx ON cx.id = c.conexion_id
       WHERE cx.activo = true AND c.archivado = false`
    );
    return Number(rows[0]?.total ?? 0);
  }
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(c.no_leidos_count), 0) AS total
     FROM gozz.whatsapp_conversaciones c
     JOIN gozz.whatsapp_conexiones cx ON cx.id = c.conexion_id
     WHERE cx.activo = true AND c.archivado = false
       AND (cx.owner_user_id = $1 OR EXISTS (
         SELECT 1 FROM gozz.whatsapp_conexion_acl a WHERE a.conexion_id = cx.id AND a.user_id = $1
       ))`,
    [userId]
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getConexion(id: string): Promise<WhatsAppConexion | null> {
  const rows = await query<WhatsAppConexion>(`SELECT ${CONEXION_COLUMNS} FROM gozz.whatsapp_conexiones WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function crearConexion(nombre: string, ownerUserId: string): Promise<WhatsAppConexion> {
  const rows = await query<WhatsAppConexion>(
    `INSERT INTO gozz.whatsapp_conexiones (nombre, owner_user_id) VALUES ($1, $2) RETURNING *`,
    [nombre, ownerUserId]
  );
  return rows[0];
}

export async function tieneAcceso(conexionId: string, userId: string, userNivel: string): Promise<boolean> {
  if (userNivel === "super_admin" || userNivel === "admin") return true;
  const rows = await query<any>(
    `SELECT 1 FROM gozz.whatsapp_conexiones c
     LEFT JOIN gozz.whatsapp_conexion_acl a ON a.conexion_id = c.id
     WHERE c.id = $1 AND (c.owner_user_id = $2 OR a.user_id = $2) LIMIT 1`,
    [conexionId, userId]
  );
  return rows.length > 0;
}

export async function listUsuariosConAcceso(conexionId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT u.id FROM gozz.users u
     WHERE u.id IN (SELECT owner_user_id FROM gozz.whatsapp_conexiones WHERE id = $1)
        OR u.id IN (SELECT user_id FROM gozz.whatsapp_conexion_acl WHERE conexion_id = $1 AND user_id IS NOT NULL)
        OR u.nivel_acceso IN ('super_admin', 'admin')`,
    [conexionId]
  );
  return rows.map((r) => r.id);
}

export async function setConexionEstado(
  id: string,
  estado: WhatsAppConexionEstado,
  opts: { telefono?: string | null; ultimoError?: string | null } = {}
): Promise<void> {
  await query(
    `UPDATE gozz.whatsapp_conexiones
       SET estado = $2,
           telefono = COALESCE($3, telefono),
           ultimo_error = $4,
           ultima_actividad = NOW(),
           updated_at = NOW(),
           errores_consecutivos = CASE WHEN $2 = 'error' THEN errores_consecutivos + 1 ELSE 0 END,
           qr_actual = CASE WHEN $2 = 'conectado' THEN NULL ELSE qr_actual END
     WHERE id = $1`,
    [id, estado, opts.telefono ?? null, opts.ultimoError ?? null]
  );
}

export async function setConexionQr(id: string, qr: string): Promise<void> {
  await query(
    "UPDATE gozz.whatsapp_conexiones SET qr_actual = $2, qr_actualizado_at = NOW(), updated_at = NOW() WHERE id = $1",
    [id, qr]
  );
}

export async function setConexionSession(id: string, sessionEnc: string | null): Promise<void> {
  await query("UPDATE gozz.whatsapp_conexiones SET session_state_enc = $2, updated_at = NOW() WHERE id = $1", [id, sessionEnc]);
}

export async function getConexionSession(id: string): Promise<string | null> {
  const rows = await query<{ session_state_enc: string | null }>(
    "SELECT session_state_enc FROM gozz.whatsapp_conexiones WHERE id = $1",
    [id]
  );
  return rows[0]?.session_state_enc ?? null;
}

export async function listConexionesActivas(): Promise<WhatsAppConexion[]> {
  return query<WhatsAppConexion>(
    "SELECT * FROM gozz.whatsapp_conexiones WHERE activo = true AND estado != 'cerrada'"
  );
}

export async function desactivarConexion(id: string): Promise<void> {
  await query(
    "UPDATE gozz.whatsapp_conexiones SET activo = false, estado = 'cerrada', session_state_enc = NULL, updated_at = NOW() WHERE id = $1",
    [id]
  );
}

// ---------------------------------------------------------------------------
// Etapas del embudo propio de WhatsApp
// ---------------------------------------------------------------------------

export async function listEtapas(): Promise<WhatsAppPipelineStage[]> {
  return query<WhatsAppPipelineStage>("SELECT * FROM gozz.whatsapp_pipeline_stages WHERE activa = true ORDER BY orden");
}

export async function getEtapaPorKey(key: string): Promise<WhatsAppPipelineStage | null> {
  const rows = await query<WhatsAppPipelineStage>("SELECT * FROM gozz.whatsapp_pipeline_stages WHERE key = $1", [key]);
  return rows[0] ?? null;
}

export async function getPrimeraEtapa(): Promise<WhatsAppPipelineStage | null> {
  const rows = await query<WhatsAppPipelineStage>(
    "SELECT * FROM gozz.whatsapp_pipeline_stages WHERE activa = true ORDER BY orden LIMIT 1"
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function listTags(): Promise<WhatsAppTag[]> {
  return query<WhatsAppTag>("SELECT * FROM gozz.whatsapp_tags ORDER BY nombre");
}

export async function crearTag(nombre: string, color: string): Promise<WhatsAppTag> {
  const rows = await query<WhatsAppTag>(
    "INSERT INTO gozz.whatsapp_tags (nombre, color) VALUES ($1, $2) RETURNING *",
    [nombre, color]
  );
  return rows[0];
}

export async function eliminarTag(id: string): Promise<void> {
  await query("DELETE FROM gozz.whatsapp_tags WHERE id = $1", [id]);
}

export async function tagsDeConversacion(conversacionId: string): Promise<WhatsAppTag[]> {
  return query<WhatsAppTag>(
    `SELECT t.* FROM gozz.whatsapp_tags t
     JOIN gozz.whatsapp_conversacion_tags ct ON ct.tag_id = t.id
     WHERE ct.conversacion_id = $1 ORDER BY t.nombre`,
    [conversacionId]
  );
}

export async function agregarTagAConversacion(conversacionId: string, tagId: string): Promise<void> {
  await query(
    "INSERT INTO gozz.whatsapp_conversacion_tags (conversacion_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [conversacionId, tagId]
  );
}

export async function quitarTagDeConversacion(conversacionId: string, tagId: string): Promise<void> {
  await query("DELETE FROM gozz.whatsapp_conversacion_tags WHERE conversacion_id = $1 AND tag_id = $2", [conversacionId, tagId]);
}

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

export interface FiltrosConversaciones {
  etapaId?: string;
  tagId?: string;
  asignadoId?: string;
  archivado?: boolean;
  q?: string;
}

export type WhatsAppConversacionConTags = WhatsAppConversacion & {
  tags: WhatsAppTag[];
  asignado_nombre: string | null;
  asignado_foto_url: string | null;
};

/**
 * Trae las etiquetas de cada conversación con una sub-consulta correlacionada en la MISMA query
 * (una sola ida a la base de datos), en vez de una consulta aparte por conversación como antes
 * (con 50 conversaciones eran 51 idas y vueltas — la causa real del "delay" al listar). El filtro
 * por etiqueta usa `EXISTS` en vez de un JOIN para no interferir con esta agregación.
 */
export async function listConversaciones(conexionId: string, filtros: FiltrosConversaciones = {}): Promise<WhatsAppConversacionConTags[]> {
  const cond: string[] = ["c.conexion_id = $1"];
  const params: any[] = [conexionId];
  if (filtros.etapaId) { params.push(filtros.etapaId); cond.push(`c.etapa_id = $${params.length}`); }
  if (filtros.asignadoId) { params.push(filtros.asignadoId); cond.push(`c.asignado_a = $${params.length}`); }
  if (filtros.archivado !== undefined) { params.push(filtros.archivado); cond.push(`c.archivado = $${params.length}`); }
  else { cond.push("c.archivado = false"); }
  if (filtros.q) {
    // Como WhatsApp: por nombre, por número (también el real detrás de un @lid) o por el texto de
    // algún mensaje.
    params.push(`%${filtros.q}%`);
    const p = `$${params.length}`;
    cond.push(`(c.nombre_whatsapp ILIKE ${p} OR c.wa_jid ILIKE ${p} OR c.telefono_real ILIKE ${p}
      OR EXISTS (SELECT 1 FROM gozz.whatsapp_mensajes mq WHERE mq.conversacion_id = c.id AND mq.contenido ILIKE ${p}))`);
  }
  if (filtros.tagId) {
    params.push(filtros.tagId);
    cond.push(`EXISTS (SELECT 1 FROM gozz.whatsapp_conversacion_tags ct2 WHERE ct2.conversacion_id = c.id AND ct2.tag_id = $${params.length})`);
  }
  return query<WhatsAppConversacionConTags>(
    `SELECT c.*,
       COALESCE(
         (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'color', t.color) ORDER BY t.nombre)
          FROM gozz.whatsapp_conversacion_tags ct
          JOIN gozz.whatsapp_tags t ON t.id = ct.tag_id
          WHERE ct.conversacion_id = c.id),
         '[]'::jsonb
       ) AS tags,
       ua.nombre AS asignado_nombre,
       ua.foto_perfil_url AS asignado_foto_url
     FROM gozz.whatsapp_conversaciones c
     LEFT JOIN gozz.users ua ON ua.id = c.asignado_a
     WHERE ${cond.join(" AND ")}
     ORDER BY c.fijada DESC, c.ultimo_mensaje_at DESC NULLS LAST, c.created_at DESC`,
    params
  );
}

export async function getConversacion(id: string): Promise<WhatsAppConversacion | null> {
  const rows = await query<WhatsAppConversacion>("SELECT * FROM gozz.whatsapp_conversaciones WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getConversacionPorJid(conexionId: string, jid: string): Promise<WhatsAppConversacion | null> {
  const rows = await query<WhatsAppConversacion>(
    "SELECT * FROM gozz.whatsapp_conversaciones WHERE conexion_id = $1 AND wa_jid = $2",
    [conexionId, jid]
  );
  return rows[0] ?? null;
}

export interface NuevaConversacion {
  conexionId: string;
  jid: string;
  nombreWhatsapp?: string | null;
  fotoPerfilUrl?: string | null;
  telefonoReal?: string | null;
  etapaId: string;
  contactoId?: string | null;
  contactoVinculoEstado?: string;
  esGrupo?: boolean;
}

export async function crearConversacion(d: NuevaConversacion): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    `INSERT INTO gozz.whatsapp_conversaciones
       (conexion_id, wa_jid, nombre_whatsapp, foto_perfil_url, telefono_real, etapa_id, contacto_id, contacto_vinculo_estado, es_grupo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (conexion_id, wa_jid) DO UPDATE SET nombre_whatsapp = COALESCE(EXCLUDED.nombre_whatsapp, gozz.whatsapp_conversaciones.nombre_whatsapp)
     RETURNING *`,
    [d.conexionId, d.jid, d.nombreWhatsapp ?? null, d.fotoPerfilUrl ?? null, d.telefonoReal ?? null, d.etapaId, d.contactoId ?? null, d.contactoVinculoEstado ?? "sin_vincular", d.esGrupo ?? d.jid.endsWith("@g.us")]
  );
  return rows[0];
}

/** Vista previa y hora del último mensaje. Solo avanza (un mensaje más viejo del historial no pisa
 * uno más nuevo) y solo suma "no leído" si se pide (el historial trae su propio contador). */
export async function tocarUltimoMensaje(
  conversacionId: string,
  preview: string,
  direccion: "entrante" | "saliente",
  opts: { at?: Date | null; contarNoLeido?: boolean } = {}
): Promise<void> {
  await query(
    `UPDATE gozz.whatsapp_conversaciones
       SET ultimo_mensaje_preview = CASE WHEN ultimo_mensaje_at IS NULL OR ultimo_mensaje_at <= COALESCE($4, NOW()) THEN $2 ELSE ultimo_mensaje_preview END,
           ultimo_mensaje_direccion = CASE WHEN ultimo_mensaje_at IS NULL OR ultimo_mensaje_at <= COALESCE($4, NOW()) THEN $3 ELSE ultimo_mensaje_direccion END,
           ultimo_mensaje_at = GREATEST(COALESCE(ultimo_mensaje_at, COALESCE($4, NOW())), COALESCE($4, NOW())),
           no_leidos_count = CASE WHEN $3 = 'entrante' AND $5 THEN no_leidos_count + 1 ELSE no_leidos_count END,
           updated_at = NOW()
     WHERE id = $1`,
    [conversacionId, preview.slice(0, 200), direccion, opts.at ?? null, opts.contarNoLeido ?? direccion === "entrante"]
  );
}

/** Crea o actualiza una conversación desde un chat que informa WhatsApp (historial o grupo). En
 * grupos el nombre (asunto) siempre se actualiza; en chats individuales solo se completa si falta,
 * para no pisar un nombre que el equipo ya conoce. */
export async function upsertConversacionDesdeChat(
  conexionId: string,
  d: { jid: string; nombre?: string | null; esGrupo: boolean; noLeidos?: number; archivado?: boolean; jidReal?: string | null },
  etapaId: string
): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    `INSERT INTO gozz.whatsapp_conversaciones AS c (conexion_id, wa_jid, nombre_whatsapp, es_grupo, no_leidos_count, archivado, telefono_real, etapa_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, false), $7, $8)
     ON CONFLICT (conexion_id, wa_jid) DO UPDATE SET
       nombre_whatsapp = CASE WHEN EXCLUDED.es_grupo THEN COALESCE(EXCLUDED.nombre_whatsapp, c.nombre_whatsapp) ELSE COALESCE(c.nombre_whatsapp, EXCLUDED.nombre_whatsapp) END,
       es_grupo = EXCLUDED.es_grupo,
       no_leidos_count = COALESCE($5, c.no_leidos_count),
       archivado = COALESCE($6, c.archivado),
       telefono_real = COALESCE(c.telefono_real, EXCLUDED.telefono_real),
       updated_at = NOW()
     RETURNING *`,
    [conexionId, d.jid, d.nombre ?? null, d.esGrupo, d.noLeidos ?? null, d.archivado ?? null, d.jidReal ?? null, etapaId]
  );
  return rows[0];
}

/** Devuelve los `wa_message_id` de los entrantes que se acaban de marcar como vistos — para
 * mandarle a WhatsApp la confirmación de lectura (checks azules del lado del contacto). */
export async function marcarLeida(conversacionId: string, userId: string | null): Promise<string[]> {
  await query("UPDATE gozz.whatsapp_conversaciones SET no_leidos_count = 0 WHERE id = $1", [conversacionId]);
  // "Visto por el equipo" — distinto de los checks de envío (`estado_entrega`, que son la
  // confirmación de WhatsApp para lo que NOSOTROS enviamos). Esto es al revés: marca que alguien
  // del equipo ya vio, dentro del CRM, un mensaje que un lead/cliente nos mandó.
  const rows = await query<{ wa_message_id: string | null }>(
    `UPDATE gozz.whatsapp_mensajes SET visto_at = NOW(), visto_por = $2
     WHERE conversacion_id = $1 AND direccion = 'entrante' AND visto_at IS NULL
     RETURNING wa_message_id`,
    [conversacionId, userId]
  );
  return rows.map((r) => r.wa_message_id).filter((id): id is string => !!id).slice(-100);
}

export async function setEtapa(conversacionId: string, etapaId: string): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    "UPDATE gozz.whatsapp_conversaciones SET etapa_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [conversacionId, etapaId]
  );
  return rows[0];
}

export async function setAsignado(conversacionId: string, userId: string | null): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    "UPDATE gozz.whatsapp_conversaciones SET asignado_a = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [conversacionId, userId]
  );
  return rows[0];
}

// ---- Estados (historias de 24 h) ----

export interface EstadoFila {
  id: string; conexion_id: string; wa_message_id: string; autor_jid: string | null; autor_nombre: string | null;
  propio: boolean; tipo: "texto" | "imagen" | "video"; contenido: string | null; fondo: string | null;
  archivo_url: string | null; visto_at: string | null; created_at: string; expira_at: string;
}
const ESTADO_COLS = "id, conexion_id, wa_message_id, autor_jid, autor_nombre, propio, tipo, contenido, fondo, archivo_url, visto_at, created_at, expira_at";

export async function insertEstado(conexionId: string, e: {
  waMessageId: string; autorJid: string | null; autorNombre: string | null; propio: boolean; tipo: string;
  contenido: string | null; fondo: string | null; archivoUrl: string | null; mediaMeta: string | null; timestamp: Date;
}): Promise<EstadoFila | null> {
  const rows = await query<EstadoFila>(
    `INSERT INTO gozz.whatsapp_estados (conexion_id, wa_message_id, autor_jid, autor_nombre, propio, tipo, contenido, fondo, archivo_url, media_meta, created_at, expira_at, visto_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11::timestamptz + interval '24 hours', CASE WHEN $5 THEN NOW() END)
     ON CONFLICT (conexion_id, wa_message_id) DO UPDATE SET archivo_url = COALESCE(gozz.whatsapp_estados.archivo_url, EXCLUDED.archivo_url)
     RETURNING ${ESTADO_COLS}`,
    [conexionId, e.waMessageId, e.autorJid, e.autorNombre, e.propio, e.tipo, e.contenido, e.fondo, e.archivoUrl, e.mediaMeta, e.timestamp]
  );
  return rows[0] ?? null;
}

/** Estados vigentes (últimas 24 h), más nuevos primero. Aprovecha para borrar los vencidos hace
 * más de 7 días (ya no se muestran y solo ocupan espacio). */
export async function listEstados(conexionId: string): Promise<EstadoFila[]> {
  await query("DELETE FROM gozz.whatsapp_estados WHERE conexion_id = $1 AND expira_at < NOW() - interval '7 days'", [conexionId]);
  return query<EstadoFila>(
    `SELECT ${ESTADO_COLS} FROM gozz.whatsapp_estados WHERE conexion_id = $1 AND expira_at > NOW() ORDER BY created_at DESC`,
    [conexionId]
  );
}

export async function getEstado(id: string): Promise<EstadoFila | null> {
  const rows = await query<EstadoFila>(`SELECT ${ESTADO_COLS} FROM gozz.whatsapp_estados WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function marcarEstadoVisto(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>("UPDATE gozz.whatsapp_estados SET visto_at = NOW() WHERE id = $1 AND visto_at IS NULL RETURNING id", [id]);
  return rows.length > 0;
}

/** A quién se le muestra un estado propio: los chats individuales de la conexión con número. */
export async function destinatariosEstados(conexionId: string): Promise<string[]> {
  const rows = await query<{ jid: string }>(
    `SELECT COALESCE(telefono_real, wa_jid) AS jid FROM gozz.whatsapp_conversaciones
      WHERE conexion_id = $1 AND es_grupo = false AND wa_jid NOT LIKE '%@g.us'`,
    [conexionId]
  );
  return [...new Set(rows.map((r) => r.jid).filter((j) => j.endsWith("@s.whatsapp.net") || j.endsWith("@lid")))];
}

export async function setFijada(conversacionId: string, fijada: boolean): Promise<void> {
  await query("UPDATE gozz.whatsapp_conversaciones SET fijada = $2, updated_at = NOW() WHERE id = $1", [conversacionId, fijada]);
}

/** Buscar dentro de una conversación (texto, pie de foto, nombre de archivo). */
export async function buscarMensajes(conversacionId: string, q: string, limit = 50): Promise<WhatsAppMensaje[]> {
  return query<WhatsAppMensaje>(
    `SELECT ${MSG_COLS} FROM gozz.whatsapp_mensajes
      WHERE conversacion_id = $1 AND (contenido ILIKE $2 OR archivo_nombre ILIKE $2)
      ORDER BY created_at DESC LIMIT $3`,
    [conversacionId, `%${q}%`, limit]
  );
}

export async function setArchivado(conversacionId: string, archivado: boolean): Promise<void> {
  await query("UPDATE gozz.whatsapp_conversaciones SET archivado = $2, updated_at = NOW() WHERE id = $1", [conversacionId, archivado]);
}

export async function vincularContacto(
  conversacionId: string,
  contactoId: string,
  modo: "vinculado_auto" | "vinculado_manual"
): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    "UPDATE gozz.whatsapp_conversaciones SET contacto_id = $2, contacto_vinculo_estado = $3, updated_at = NOW() WHERE id = $1 RETURNING *",
    [conversacionId, contactoId, modo]
  );
  return rows[0];
}

export async function marcarConvertida(conversacionId: string, oportunidadId: string, userId: string | null): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    `UPDATE gozz.whatsapp_conversaciones
       SET oportunidad_id = $2, convertida_at = NOW(), convertida_por = $3, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [conversacionId, oportunidadId, userId]
  );
  return rows[0];
}

/** Guarda la foto resuelta (URL propia `/uploads/...`, nunca la del CDN de WhatsApp) y cuándo se
 * resolvió. `url = null` = el contacto no tiene foto o es privada: se registra igual para no
 * volver a pedirla hasta el próximo refresco. Devuelve true si la foto cambió. */
export async function setFotoPerfil(conversacionId: string, url: string | null): Promise<boolean> {
  const rows = await query<{ cambio: boolean }>(
    `UPDATE gozz.whatsapp_conversaciones c
        SET foto_perfil_url = $2, foto_actualizada_at = NOW()
       FROM (SELECT foto_perfil_url AS previa FROM gozz.whatsapp_conversaciones WHERE id = $1) p
      WHERE c.id = $1
      RETURNING (p.previa IS DISTINCT FROM $2) AS cambio`,
    [conversacionId, url]
  );
  return !!rows[0]?.cambio;
}

/** El número real detrás de un `@lid` puede llegar mucho después de creada la conversación (el
 * directorio de contactos de WhatsApp se sincroniza solo, no bajo pedido) — se corrige cuando
 * llega, sin pisar un valor que ya se hubiera resuelto antes. */
export async function actualizarTelefonoReal(conversacionId: string, telefonoReal: string): Promise<void> {
  await query(
    "UPDATE gozz.whatsapp_conversaciones SET telefono_real = $2, updated_at = NOW() WHERE id = $1 AND telefono_real IS NULL",
    [conversacionId, telefonoReal]
  );
}

/** Completa el nombre — corrige una conversación que se creó
 * sin nombre (o, antes de la corrección del bug de `pushName` en mensajes `fromMe`, con el nombre
 * equivocado) en cuanto WhatsApp comparte el nombre real guardado del contacto. */
export async function actualizarNombreSiFalta(conversacionId: string, nombre: string): Promise<void> {
  await query(
    "UPDATE gozz.whatsapp_conversaciones SET nombre_whatsapp = $2, updated_at = NOW() WHERE id = $1 AND nombre_whatsapp IS NULL",
    [conversacionId, nombre]
  );
}

/**
 * Alta mínima de contacto SOLO para el flujo "crear y vincular" desde WhatsApp — a propósito NO
 * pasa por `queFaltaParaElAlta` de `contactos.routes.ts` (que exige email siempre): aquí el email
 * es opcional por decisión explícita, pero SOLO para este camino. El endpoint general
 * `POST /api/contactos` sigue exigiéndolo igual que siempre, para cualquier otro que lo llame.
 */
export async function crearContactoMinimo(d: { nombreCompleto: string; telefono: string; email: string | null }): Promise<{ id: string; nombre_completo: string }> {
  const rows = await query<{ id: string; nombre_completo: string }>(
    `INSERT INTO gozz.contactos_cache (nombre_completo, telefono, email) VALUES ($1, $2, $3) RETURNING id, nombre_completo`,
    [d.nombreCompleto, d.telefono, d.email]
  );
  return rows[0];
}

/** Para "Contactar por WhatsApp" desde la ficha del contacto — el teléfono que ya tenga guardado. */
export async function getTelefonoContacto(contactoId: string): Promise<string | null> {
  const rows = await query<{ telefono: string | null; whatsapp: string | null }>(
    "SELECT telefono, whatsapp FROM gozz.contactos_cache WHERE id = $1",
    [contactoId]
  );
  return rows[0]?.whatsapp || rows[0]?.telefono || null;
}

/**
 * Contacto cuyo `telefono`/`whatsapp` es EXACTAMENTE el mismo número (E.164) que el de WhatsApp.
 * Prefiltra en SQL por los últimos 7 dígitos (barato) y compara exacto en código con
 * libphonenumber — ver lib/telefono.ts para por qué "últimos 10 dígitos" no bastaba. Si más de un
 * contacto distinto coincide, NO elige uno al azar: devuelve null y queda para vincular a mano.
 */
export async function buscarContactoPorTelefono(jidODigitos: string): Promise<{ id: string; nombre_completo: string } | null> {
  const wa = e164DesdeWhatsApp(jidODigitos);
  if (!wa) return null;
  const cola = wa.e164.replace(/\D/g, "").slice(-7);
  const candidatos = await query<{ id: string; nombre_completo: string; telefono: string | null; whatsapp: string | null }>(
    `SELECT id, nombre_completo, telefono, whatsapp FROM gozz.contactos_cache
     WHERE archivado = false AND (
       right(regexp_replace(COALESCE(telefono, ''), '\\D', '', 'g'), 7) = $1
       OR right(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 7) = $1
     )
     LIMIT 50`,
    [cola]
  );
  const exactos = candidatos.filter((c) =>
    e164DesdeTextoLibre(c.whatsapp, wa.pais) === wa.e164 || e164DesdeTextoLibre(c.telefono, wa.pais) === wa.e164
  );
  if (exactos.length !== 1) return null;
  return { id: exactos[0].id, nombre_completo: exactos[0].nombre_completo };
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

/** Columnas de un mensaje que salen hacia la API. `media_meta` (el mensaje crudo de WhatsApp para
 * bajar la media más tarde) es interno y pesado: nunca se manda al navegador, solo si falta bajarla. */
const MSG_COLS = `id, conversacion_id, wa_message_id, direccion, tipo, contenido, archivo_url, archivo_nombre, archivo_tipo,
  archivo_tamanio, enviado_por, estado_entrega, error_envio, created_at, visto_at, visto_por, autor_jid, autor_nombre,
  respuesta_a, respuesta_preview, reacciones, editado_at, eliminado_at, historico,
  (media_meta IS NOT NULL AND archivo_url IS NULL) AS media_pendiente`;

/** Mensajes viejos que se guardaron como 'sistema' vacío (antes de mensaje-parser.ts): no tienen
 * nada que mostrar. No se borran (el historial los repara al reimportarse, ver insertMensaje). */
const NO_VACIO = "NOT (tipo = 'sistema' AND contenido IS NULL AND archivo_url IS NULL)";

export interface NuevoMensaje {
  conversacionId: string;
  waMessageId?: string | null;
  direccion: "entrante" | "saliente";
  tipo: string;
  contenido?: string | null;
  archivoUrl?: string | null;
  archivoNombre?: string | null;
  archivoTipo?: string | null;
  archivoTamanio?: number | null;
  enviadoPor?: string | null;
  estadoEntrega?: WhatsAppMensajeEstado;
  createdAt?: Date | null;
  autorJid?: string | null;
  autorNombre?: string | null;
  respuestaA?: string | null;
  respuestaPreview?: string | null;
  mediaMeta?: string | null;
  historico?: boolean;
}

export async function insertMensaje(d: NuevoMensaje): Promise<WhatsAppMensaje | null> {
  // `created_at` = la hora REAL del mensaje en WhatsApp (no la hora en que llegó al CRM): sin esto
  // el historial importado aparecía todo "ahora" y desordenado.
  // Si ya existía como 'sistema' vacío (guardado antes de que el CRM supiera leer ese tipo), se
  // repara con el contenido real en vez de quedarse vacío para siempre.
  const rows = await query<WhatsAppMensaje>(
    `INSERT INTO gozz.whatsapp_mensajes AS m
       (conversacion_id, wa_message_id, direccion, tipo, contenido, archivo_url, archivo_nombre, archivo_tipo, archivo_tamanio,
        enviado_por, estado_entrega, created_at, autor_jid, autor_nombre, respuesta_a, respuesta_preview, media_meta, historico)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, NOW()), $13, $14, $15, $16, $17::jsonb, $18)
     ON CONFLICT (conversacion_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO UPDATE SET
       tipo = EXCLUDED.tipo, contenido = EXCLUDED.contenido, archivo_url = EXCLUDED.archivo_url,
       archivo_nombre = EXCLUDED.archivo_nombre, archivo_tipo = EXCLUDED.archivo_tipo, archivo_tamanio = EXCLUDED.archivo_tamanio,
       autor_jid = EXCLUDED.autor_jid, autor_nombre = EXCLUDED.autor_nombre, respuesta_a = EXCLUDED.respuesta_a,
       respuesta_preview = EXCLUDED.respuesta_preview, media_meta = EXCLUDED.media_meta
       WHERE m.tipo = 'sistema' AND m.contenido IS NULL AND m.archivo_url IS NULL
     RETURNING ${MSG_COLS}`,
    [
      d.conversacionId, d.waMessageId ?? null, d.direccion, d.tipo, d.contenido ?? null,
      d.archivoUrl ?? null, d.archivoNombre ?? null, d.archivoTipo ?? null, d.archivoTamanio ?? null,
      d.enviadoPor ?? null, d.estadoEntrega ?? "pendiente", d.createdAt ?? null,
      d.autorJid ?? null, d.autorNombre ?? null, d.respuestaA ?? null, d.respuestaPreview ?? null, d.mediaMeta ?? null, d.historico ?? false,
    ]
  );
  return rows[0] ?? null; // null = ya existía (idempotencia por wa_message_id)
}

// ---- Reacciones, borrados, ediciones ----

/** Un mensaje de una conversación concreta por su id de WhatsApp. */
export async function getMensajeDeChat(conexionId: string, jid: string, waMessageId: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<{ id: string }>(
    `SELECT m.id FROM gozz.whatsapp_mensajes m
       JOIN gozz.whatsapp_conversaciones c ON c.id = m.conversacion_id
      WHERE c.conexion_id = $1 AND c.wa_jid = $2 AND m.wa_message_id = $3 LIMIT 1`,
    [conexionId, jid, waMessageId]
  );
  return rows[0] ? getMensaje(rows[0].id) : null;
}

/** `emoji` vacío = quitó su reacción. */
export async function aplicarReaccion(mensajeId: string, autor: string, emoji: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(
    `UPDATE gozz.whatsapp_mensajes
        SET reacciones = CASE WHEN $3 = '' THEN reacciones - $2 ELSE jsonb_set(reacciones, ARRAY[$2], to_jsonb($3::text)) END
      WHERE id = $1 RETURNING ${MSG_COLS}`,
    [mensajeId, autor, emoji]
  );
  return rows[0] ?? null;
}

/** El contenido original se conserva (el equipo de ventas puede necesitarlo); la interfaz lo
 * muestra como eliminado. */
export async function marcarEliminado(mensajeId: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(
    `UPDATE gozz.whatsapp_mensajes SET eliminado_at = COALESCE(eliminado_at, NOW()) WHERE id = $1 RETURNING ${MSG_COLS}`,
    [mensajeId]
  );
  return rows[0] ?? null;
}

export async function editarContenido(mensajeId: string, contenido: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(
    `UPDATE gozz.whatsapp_mensajes SET contenido = $2, editado_at = NOW() WHERE id = $1 RETURNING ${MSG_COLS}`,
    [mensajeId, contenido]
  );
  return rows[0] ?? null;
}

// ---- Media diferida ----

export async function getMediaPendiente(mensajeId: string): Promise<{ media_meta: any; conexion_id: string; archivo_url: string | null } | null> {
  const rows = await query<{ media_meta: any; conexion_id: string; archivo_url: string | null }>(
    `SELECT m.media_meta, m.archivo_url, c.conexion_id FROM gozz.whatsapp_mensajes m
       JOIN gozz.whatsapp_conversaciones c ON c.id = m.conversacion_id WHERE m.id = $1`,
    [mensajeId]
  );
  return rows[0] ?? null;
}

export async function setMediaDescargada(
  mensajeId: string, d: { archivoUrl: string; archivoNombre: string; archivoTipo: string; archivoTamanio: number }
): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(
    `UPDATE gozz.whatsapp_mensajes
        SET archivo_url = $2, archivo_nombre = COALESCE(archivo_nombre, $3), archivo_tipo = $4, archivo_tamanio = $5, media_meta = NULL
      WHERE id = $1 RETURNING ${MSG_COLS}`,
    [mensajeId, d.archivoUrl, d.archivoNombre, d.archivoTipo, d.archivoTamanio]
  );
  return rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Página de mensajes, del más viejo al más nuevo. `before` = id del mensaje más viejo ya cargado
 * (cursor para el scroll hacia arriba). Se compara la tupla (created_at, id) y no solo la hora:
 * dos mensajes con la misma marca de tiempo (ráfagas, sincronización de historial) no se saltan ni
 * se repiten entre páginas. Un cursor que no es un uuid se rechaza en vez de reventar en Postgres. */
export async function listMensajes(conversacionId: string, limit = 50, before?: string): Promise<WhatsAppMensaje[]> {
  if (before) {
    if (!UUID_RE.test(before)) return [];
    const rows = await query<WhatsAppMensaje>(
      `SELECT ${MSG_COLS} FROM gozz.whatsapp_mensajes
        WHERE conversacion_id = $1 AND ${NO_VACIO}
          AND (created_at, id) < (SELECT created_at, id FROM gozz.whatsapp_mensajes WHERE id = $2)
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [conversacionId, before, limit]
    );
    return rows.reverse();
  }
  const rows = await query<WhatsAppMensaje>(
    `SELECT ${MSG_COLS} FROM gozz.whatsapp_mensajes WHERE conversacion_id = $1 AND ${NO_VACIO} ORDER BY created_at DESC, id DESC LIMIT $2`,
    [conversacionId, limit]
  );
  return rows.reverse();
}

export async function getMensaje(id: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(`SELECT ${MSG_COLS} FROM gozz.whatsapp_mensajes WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Para las confirmaciones de entrega/lectura de Baileys, que solo traen el `wa_message_id`. */
export async function getMensajePorWaId(waMessageId: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(`SELECT ${MSG_COLS} FROM gozz.whatsapp_mensajes WHERE wa_message_id = $1`, [waMessageId]);
  return rows[0] ?? null;
}

/** Guarda el id de WhatsApp de un saliente ANTES de enviarlo (ver `generarIdMensaje`). Si ya
 * tenía uno (reintento), se conserva ese y se devuelve. */
export async function reservarWaMessageId(mensajeId: string, waMessageId: string): Promise<string> {
  const rows = await query<{ wa_message_id: string }>(
    `UPDATE gozz.whatsapp_mensajes SET wa_message_id = COALESCE(wa_message_id, $2)
      WHERE id = $1 RETURNING wa_message_id`,
    [mensajeId, waMessageId]
  );
  return rows[0]?.wa_message_id ?? waMessageId;
}

/** WhatsApp aceptó el envío. Pasa a "enviado" SOLO si seguía pendiente/fallido: un acuse de
 * "entregado"/"leído" pudo llegar antes que esta confirmación y no se debe retroceder. */
export async function confirmarEnvio(mensajeId: string, waMessageId: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(
    `UPDATE gozz.whatsapp_mensajes
        SET estado_entrega = CASE WHEN estado_entrega IN ('pendiente', 'fallido') THEN 'enviado' ELSE estado_entrega END,
            wa_message_id = COALESCE(wa_message_id, $2),
            error_envio = NULL
      WHERE id = $1 RETURNING ${MSG_COLS}`,
    [mensajeId, waMessageId]
  );
  return rows[0] ?? null;
}

export async function actualizarEstadoMensaje(
  id: string,
  estado: WhatsAppMensajeEstado,
  opts: { waMessageId?: string | null; errorEnvio?: string | null } = {}
): Promise<void> {
  await query(
    "UPDATE gozz.whatsapp_mensajes SET estado_entrega = $2, wa_message_id = COALESCE($3, wa_message_id), error_envio = $4 WHERE id = $1",
    [id, estado, opts.waMessageId ?? null, opts.errorEnvio ?? null]
  );
}

export async function listMensajesPendientes(conexionId?: string): Promise<(WhatsAppMensaje & { conexion_id: string; wa_jid: string })[]> {
  const params: any[] = [];
  let cond = "m.direccion = 'saliente' AND m.estado_entrega = 'pendiente'";
  if (conexionId) { params.push(conexionId); cond += ` AND c.conexion_id = $${params.length}`; }
  return query<any>(
    `SELECT m.*, c.conexion_id, c.wa_jid FROM gozz.whatsapp_mensajes m
     JOIN gozz.whatsapp_conversaciones c ON c.id = m.conversacion_id
     WHERE ${cond} ORDER BY m.created_at`,
    params
  );
}
