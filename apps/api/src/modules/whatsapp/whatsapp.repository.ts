// Único lugar del slice con acceso directo a SQL. Sin dependencia de Baileys — se usa tanto desde
// las rutas HTTP (proceso gozz-api) como desde whatsapp-connection-manager.ts (proceso
// gozz-whatsapp-worker), vía whatsapp.service.ts.
import { query } from "../../shared/db.js";
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

export async function listConexiones(userId: string, isAdmin: boolean): Promise<WhatsAppConexion[]> {
  if (isAdmin) {
    return query<WhatsAppConexion>("SELECT * FROM gozz.whatsapp_conexiones WHERE activo = true ORDER BY created_at");
  }
  return query<WhatsAppConexion>(
    `SELECT DISTINCT c.* FROM gozz.whatsapp_conexiones c
     LEFT JOIN gozz.whatsapp_conexion_acl a ON a.conexion_id = c.id
     WHERE c.activo = true AND (c.owner_user_id = $1 OR a.user_id = $1)
     ORDER BY c.created_at`,
    [userId]
  );
}

export async function getConexion(id: string): Promise<WhatsAppConexion | null> {
  const rows = await query<WhatsAppConexion>("SELECT * FROM gozz.whatsapp_conexiones WHERE id = $1", [id]);
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
  archivado?: boolean;
  q?: string;
}

export async function listConversaciones(conexionId: string, filtros: FiltrosConversaciones = {}): Promise<WhatsAppConversacion[]> {
  const cond: string[] = ["c.conexion_id = $1"];
  const params: any[] = [conexionId];
  if (filtros.etapaId) { params.push(filtros.etapaId); cond.push(`c.etapa_id = $${params.length}`); }
  if (filtros.archivado !== undefined) { params.push(filtros.archivado); cond.push(`c.archivado = $${params.length}`); }
  else { cond.push("c.archivado = false"); }
  if (filtros.q) { params.push(`%${filtros.q}%`); cond.push(`(c.nombre_whatsapp ILIKE $${params.length} OR c.wa_jid ILIKE $${params.length})`); }
  let join = "";
  if (filtros.tagId) {
    params.push(filtros.tagId);
    join = `JOIN gozz.whatsapp_conversacion_tags ct ON ct.conversacion_id = c.id AND ct.tag_id = $${params.length}`;
  }
  return query<WhatsAppConversacion>(
    `SELECT DISTINCT c.* FROM gozz.whatsapp_conversaciones c ${join}
     WHERE ${cond.join(" AND ")}
     ORDER BY c.ultimo_mensaje_at DESC NULLS LAST, c.created_at DESC`,
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
  etapaId: string;
  contactoId?: string | null;
  contactoVinculoEstado?: string;
}

export async function crearConversacion(d: NuevaConversacion): Promise<WhatsAppConversacion> {
  const rows = await query<WhatsAppConversacion>(
    `INSERT INTO gozz.whatsapp_conversaciones
       (conexion_id, wa_jid, nombre_whatsapp, foto_perfil_url, etapa_id, contacto_id, contacto_vinculo_estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conexion_id, wa_jid) DO UPDATE SET nombre_whatsapp = COALESCE(EXCLUDED.nombre_whatsapp, gozz.whatsapp_conversaciones.nombre_whatsapp)
     RETURNING *`,
    [d.conexionId, d.jid, d.nombreWhatsapp ?? null, d.fotoPerfilUrl ?? null, d.etapaId, d.contactoId ?? null, d.contactoVinculoEstado ?? "sin_vincular"]
  );
  return rows[0];
}

export async function tocarUltimoMensaje(
  conversacionId: string,
  preview: string,
  direccion: "entrante" | "saliente"
): Promise<void> {
  await query(
    `UPDATE gozz.whatsapp_conversaciones
       SET ultimo_mensaje_preview = $2, ultimo_mensaje_at = NOW(), ultimo_mensaje_direccion = $3,
           no_leidos_count = CASE WHEN $3 = 'entrante' THEN no_leidos_count + 1 ELSE no_leidos_count END,
           updated_at = NOW()
     WHERE id = $1`,
    [conversacionId, preview.slice(0, 200), direccion]
  );
}

export async function marcarLeida(conversacionId: string): Promise<void> {
  await query("UPDATE gozz.whatsapp_conversaciones SET no_leidos_count = 0 WHERE id = $1", [conversacionId]);
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

/** Match por teléfono normalizado (últimos 10 dígitos) contra `telefono`/`whatsapp` de contactos_cache. */
export async function buscarContactoPorTelefono(telefonoCrudo: string): Promise<{ id: string; nombre_completo: string } | null> {
  const digitos = telefonoCrudo.replace(/\D/g, "").slice(-10);
  if (digitos.length < 7) return null;
  const rows = await query<{ id: string; nombre_completo: string }>(
    `SELECT id, nombre_completo FROM gozz.contactos_cache
     WHERE archivado = false AND (
       right(regexp_replace(COALESCE(telefono, ''), '\\D', '', 'g'), 10) = $1
       OR right(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 10) = $1
     )
     LIMIT 1`,
    [digitos]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

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
}

export async function insertMensaje(d: NuevoMensaje): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>(
    `INSERT INTO gozz.whatsapp_mensajes
       (conversacion_id, wa_message_id, direccion, tipo, contenido, archivo_url, archivo_nombre, archivo_tipo, archivo_tamanio, enviado_por, estado_entrega)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (conversacion_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      d.conversacionId, d.waMessageId ?? null, d.direccion, d.tipo, d.contenido ?? null,
      d.archivoUrl ?? null, d.archivoNombre ?? null, d.archivoTipo ?? null, d.archivoTamanio ?? null,
      d.enviadoPor ?? null, d.estadoEntrega ?? "pendiente",
    ]
  );
  return rows[0] ?? null; // null = ya existía (idempotencia por wa_message_id)
}

export async function listMensajes(conversacionId: string, limit = 50, before?: string): Promise<WhatsAppMensaje[]> {
  if (before) {
    const rows = await query<WhatsAppMensaje>(
      `SELECT * FROM gozz.whatsapp_mensajes WHERE conversacion_id = $1 AND created_at < (SELECT created_at FROM gozz.whatsapp_mensajes WHERE id = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [conversacionId, before, limit]
    );
    return rows.reverse();
  }
  const rows = await query<WhatsAppMensaje>(
    "SELECT * FROM gozz.whatsapp_mensajes WHERE conversacion_id = $1 ORDER BY created_at DESC LIMIT $2",
    [conversacionId, limit]
  );
  return rows.reverse();
}

export async function getMensaje(id: string): Promise<WhatsAppMensaje | null> {
  const rows = await query<WhatsAppMensaje>("SELECT * FROM gozz.whatsapp_mensajes WHERE id = $1", [id]);
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
