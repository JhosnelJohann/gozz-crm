// Capa de negocio del módulo. Deliberadamente SIN import de `@whiskeysockets/baileys`: la usan
// tanto las rutas HTTP (proceso gozz-api) como whatsapp-connection-manager.ts (proceso
// gozz-whatsapp-worker) para persistir lo que el proveedor reporta. Las pruebas corren contra
// esta capa con `providers/fake.provider.ts`, nunca contra WhatsApp real.
import { query } from "../../shared/db.js";
import * as repo from "./whatsapp.repository.js";
import * as oportunidadesService from "../oportunidades/oportunidades.service.js";
import type { WhatsAppConnectionUpdate, WhatsAppIncomingMessage } from "./providers/whatsapp-provider.interface.js";

function jidToPhone(jid: string): string {
  return jid.split("@")[0] || jid;
}

async function notifyEvento(payload: Record<string, any>): Promise<void> {
  await query("SELECT pg_notify('whatsapp_evento', $1)", [JSON.stringify(payload)]).catch((e) =>
    console.error("[whatsapp notify]", e?.message)
  );
}

async function notifyEnviar(mensajeId: string): Promise<void> {
  await query("SELECT pg_notify('whatsapp_enviar', $1)", [JSON.stringify({ mensaje_id: mensajeId })]).catch((e) =>
    console.error("[whatsapp notify enviar]", e?.message)
  );
}

// ---------------------------------------------------------------------------
// Conexiones (llamado desde las rutas HTTP)
// ---------------------------------------------------------------------------

export async function listarConexiones(userId: string, nivel: string) {
  return repo.listConexiones(userId, nivel === "super_admin" || nivel === "admin");
}

export async function crearConexion(nombre: string, ownerUserId: string) {
  return repo.crearConexion(nombre, ownerUserId);
}

export async function verificarAcceso(conexionId: string, userId: string, nivel: string): Promise<boolean> {
  return repo.tieneAcceso(conexionId, userId, nivel);
}

/** Pide al worker que arranque la conexión (QR o retomar sesión guardada). */
export async function iniciarConexion(conexionId: string): Promise<void> {
  await repo.setConexionEstado(conexionId, "conectando");
  await query("SELECT pg_notify('whatsapp_iniciar', $1)", [JSON.stringify({ conexion_id: conexionId })]);
}

export async function desconectarConexion(conexionId: string): Promise<void> {
  await repo.desactivarConexion(conexionId);
  await query("SELECT pg_notify('whatsapp_desconectar', $1)", [JSON.stringify({ conexion_id: conexionId })]);
}

// ---------------------------------------------------------------------------
// Eventos reportados por el proveedor (llamado desde whatsapp-connection-manager.ts, en el worker)
// ---------------------------------------------------------------------------

export async function registrarQr(conexionId: string, qr: string): Promise<void> {
  await repo.setConexionQr(conexionId, qr);
  await notifyEvento({ tipo: "qr", conexion_id: conexionId, qr });
}

export async function registrarActualizacionEstado(conexionId: string, update: WhatsAppConnectionUpdate): Promise<void> {
  await repo.setConexionEstado(conexionId, update.estado, { telefono: update.telefono, ultimoError: update.motivoError });
  await notifyEvento({ tipo: "estado", conexion_id: conexionId, estado: update.estado, telefono: update.telefono ?? null, error: update.motivoError ?? null });
}

/**
 * Un mensaje entrante crea la conversación si no existía (con intento de vinculación automática
 * a un contacto por teléfono) y persiste el mensaje de forma idempotente por `wa_message_id`.
 */
export async function registrarMensajeEntrante(conexionId: string, msg: WhatsAppIncomingMessage): Promise<void> {
  let conversacion = await repo.getConversacionPorJid(conexionId, msg.jid);
  if (!conversacion) {
    const primeraEtapa = await repo.getPrimeraEtapa();
    if (!primeraEtapa) throw new Error("No hay etapas de pipeline de WhatsApp configuradas");
    const contacto = await repo.buscarContactoPorTelefono(jidToPhone(msg.jid));
    conversacion = await repo.crearConversacion({
      conexionId,
      jid: msg.jid,
      nombreWhatsapp: msg.nombrePerfil ?? null,
      etapaId: primeraEtapa.id,
      contactoId: contacto?.id ?? null,
      contactoVinculoEstado: contacto ? "vinculado_auto" : "sin_vincular",
    });
  }

  // fromMe = lo envió el número conectado desde el teléfono físico, fuera de GOZZ (p.ej. el
  // vendedor contestó directo desde su celular). Se guarda como 'saliente' para que el hilo
  // compartido quede completo; la idempotencia por wa_message_id evita duplicar lo que GOZZ
  // mismo ya envió (ese mensaje ya existe con ese wa_message_id tras la confirmación de envío).
  const direccion = msg.fromMe ? "saliente" : "entrante";
  const insertado = await repo.insertMensaje({
    conversacionId: conversacion.id,
    waMessageId: msg.waMessageId,
    direccion,
    tipo: msg.tipo,
    contenido: msg.contenido ?? null,
    archivoUrl: msg.archivoUrl ?? null,
    archivoNombre: msg.archivoNombre ?? null,
    archivoTipo: msg.archivoTipo ?? null,
    estadoEntrega: "entregado",
  });
  if (!insertado) return; // ya lo teníamos (reintento del proveedor o eco de un envío propio) — idempotencia

  const preview = msg.contenido || (msg.tipo === "imagen" ? "📷 Imagen" : msg.tipo === "video" ? "🎥 Video" : msg.tipo === "audio" ? "🎤 Audio" : "📎 Archivo");
  await repo.tocarUltimoMensaje(conversacion.id, preview, direccion);
  await notifyEvento({ tipo: "mensaje", conexion_id: conexionId, conversacion_id: conversacion.id, mensaje: insertado });
}

export async function registrarConfirmacionEnvio(mensajeId: string, waMessageId: string): Promise<void> {
  await repo.actualizarEstadoMensaje(mensajeId, "enviado", { waMessageId });
  const m = await repo.getMensaje(mensajeId);
  if (!m) return;
  const conv = await repo.getConversacion(m.conversacion_id);
  if (!conv) return;
  await notifyEvento({ tipo: "mensaje_estado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje_id: mensajeId, estado: "enviado" });
}

export async function registrarFalloEnvio(mensajeId: string, error: string): Promise<void> {
  await repo.actualizarEstadoMensaje(mensajeId, "fallido", { errorEnvio: error });
  const m = await repo.getMensaje(mensajeId);
  if (!m) return;
  const conv = await repo.getConversacion(m.conversacion_id);
  if (!conv) return;
  await notifyEvento({ tipo: "mensaje_estado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje_id: mensajeId, estado: "fallido", error });
}

export async function mensajesPendientesDeEnvio(conexionId?: string) {
  return repo.listMensajesPendientes(conexionId);
}

// ---------------------------------------------------------------------------
// Etapas y tags
// ---------------------------------------------------------------------------

export const listarEtapas = repo.listEtapas;
export const listarTags = repo.listTags;

export async function crearTag(nombre: string, color: string) {
  return repo.crearTag(nombre, color);
}
export async function eliminarTag(id: string) {
  await repo.eliminarTag(id);
}
export async function agregarTag(conversacionId: string, tagId: string) {
  await repo.agregarTagAConversacion(conversacionId, tagId);
  return repo.tagsDeConversacion(conversacionId);
}
export async function quitarTag(conversacionId: string, tagId: string) {
  await repo.quitarTagDeConversacion(conversacionId, tagId);
  return repo.tagsDeConversacion(conversacionId);
}

// ---------------------------------------------------------------------------
// Conversaciones y mensajes (llamado desde las rutas HTTP)
// ---------------------------------------------------------------------------

export async function listarConversaciones(conexionId: string, filtros: repo.FiltrosConversaciones) {
  const conversaciones = await repo.listConversaciones(conexionId, filtros);
  const conTags = await Promise.all(
    conversaciones.map(async (c) => ({ ...c, tags: await repo.tagsDeConversacion(c.id) }))
  );
  return conTags;
}

export async function obtenerConversacion(id: string) {
  const conversacion = await repo.getConversacion(id);
  if (!conversacion) return null;
  const tags = await repo.tagsDeConversacion(id);
  return { ...conversacion, tags };
}

export async function listarMensajes(conversacionId: string, limit?: number, before?: string) {
  return repo.listMensajes(conversacionId, limit, before);
}

export async function marcarLeida(conversacionId: string) {
  await repo.marcarLeida(conversacionId);
}

export async function cambiarEtapa(conversacionId: string, etapaId: string) {
  return repo.setEtapa(conversacionId, etapaId);
}

export async function asignar(conversacionId: string, userId: string | null) {
  return repo.setAsignado(conversacionId, userId);
}

export async function archivar(conversacionId: string, archivado: boolean) {
  await repo.setArchivado(conversacionId, archivado);
}

export async function vincularContactoManual(conversacionId: string, contactoId: string) {
  return repo.vincularContacto(conversacionId, contactoId, "vinculado_manual");
}

/** Encola un mensaje saliente: lo inserta en 'pendiente' y avisa al worker por NOTIFY. */
export async function enviarMensaje(
  conversacionId: string,
  userId: string,
  d: { tipo: string; contenido?: string | null; archivoUrl?: string | null; archivoNombre?: string | null }
) {
  const conversacion = await repo.getConversacion(conversacionId);
  if (!conversacion) throw new Error("Conversación no encontrada");

  const mensaje = await repo.insertMensaje({
    conversacionId,
    direccion: "saliente",
    tipo: d.tipo,
    contenido: d.contenido ?? null,
    archivoUrl: d.archivoUrl ?? null,
    archivoNombre: d.archivoNombre ?? null,
    enviadoPor: userId,
    estadoEntrega: "pendiente",
  });
  if (!mensaje) throw new Error("No se pudo registrar el mensaje");

  const preview = d.contenido || (d.tipo === "imagen" ? "📷 Imagen" : d.tipo === "video" ? "🎥 Video" : d.tipo === "audio" ? "🎤 Audio" : "📎 Archivo");
  await repo.tocarUltimoMensaje(conversacionId, preview, "saliente");
  await notifyEnviar(mensaje.id);
  return mensaje;
}

/** Convierte una conversación en Oportunidad, reutilizando oportunidadesService.crear() (SLA, notas, etc). */
export async function convertirAOportunidad(
  conversacionId: string,
  userId: string | null,
  opts: { nombreCaso: string; tipoTramiteId?: string | null; valorTotal?: number }
) {
  const conversacion = await repo.getConversacion(conversacionId);
  if (!conversacion) throw new Error("Conversación no encontrada");
  if (!conversacion.contacto_id) {
    throw new Error("La conversación debe estar vinculada a un contacto antes de convertirla");
  }
  const oportunidad = await oportunidadesService.crear(
    {
      contacto_id: conversacion.contacto_id,
      nombre_caso: opts.nombreCaso,
      tipo_tramite_id: opts.tipoTramiteId ?? null,
      valor_total: opts.valorTotal,
    } as any,
    userId,
    undefined
  );
  await repo.marcarConvertida(conversacionId, oportunidad.id, userId);
  return oportunidad;
}
