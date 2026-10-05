// Capa de negocio del módulo. Deliberadamente SIN import de `@whiskeysockets/baileys`: la usan
// tanto las rutas HTTP (proceso gozz-api) como whatsapp-connection-manager.ts (proceso
// gozz-whatsapp-worker) para persistir lo que el proveedor reporta. Las pruebas corren contra
// esta capa con `providers/fake.provider.ts`, nunca contra WhatsApp real.
import { query } from "../../shared/db.js";
import * as repo from "./whatsapp.repository.js";
import * as oportunidadesService from "../oportunidades/oportunidades.service.js";
import type { WhatsAppConnectionUpdate, WhatsAppIncomingMessage, WhatsAppMensajeModificado, WhatsAppChatInfo, WhatsAppMediaDescargada } from "./providers/whatsapp-provider.interface.js";
import { previewDe } from "./mensaje-parser.js";

/** Una foto se refresca si no hay, si es una URL vieja del CDN de WhatsApp (caduca), o si se
 * resolvió hace más de 7 días (el contacto pudo cambiarla). */
const FOTO_REFRESCO_MS = 7 * 24 * 60 * 60 * 1000;
export function fotoNecesitaRefresco(c: { foto_perfil_url: string | null; foto_actualizada_at?: string | Date | null }): boolean {
  if (!c.foto_actualizada_at) return true;
  if (c.foto_perfil_url && !c.foto_perfil_url.startsWith("/uploads/")) return true;
  return Date.now() - new Date(c.foto_actualizada_at).getTime() > FOTO_REFRESCO_MS;
}

/** Puente de tiempo real (worker → gozz-api → socket.io). Un fallo transitorio de la conexión a
 * Postgres no debe perder el evento en vivo: se reintenta una vez antes de rendirse (el frontend
 * igual se resincroniza al reconectar y con su sondeo de respaldo). */
async function notifyEvento(payload: Record<string, any>): Promise<void> {
  let body = JSON.stringify(payload);
  // pg_notify rechaza más de 8000 bytes: un texto largo o una encuesta grande perdía el evento en
  // vivo. Si no cabe, viaja solo el id y la bandeja recarga ese mensaje (`recargar`).
  if (Buffer.byteLength(body) > 7500 && payload.mensaje?.id) {
    body = JSON.stringify({ ...payload, mensaje: { id: payload.mensaje.id }, recargar: true });
  }
  try {
    await query("SELECT pg_notify('whatsapp_evento', $1)", [body]);
  } catch (e: any) {
    await new Promise((r) => setTimeout(r, 250));
    await query("SELECT pg_notify('whatsapp_evento', $1)", [body]).catch((e2) =>
      console.error("[whatsapp notify] evento perdido tras reintento:", e2?.message || e?.message)
    );
  }
}

async function notifyEnviar(mensajeId: string): Promise<void> {
  await query("SELECT pg_notify('whatsapp_enviar', $1)", [JSON.stringify({ mensaje_id: mensajeId })]).catch((e) =>
    console.error("[whatsapp notify enviar]", e?.message)
  );
}

async function notifyPedirFoto(conversacionId: string): Promise<void> {
  await query("SELECT pg_notify('whatsapp_pedir_foto', $1)", [JSON.stringify({ conversacion_id: conversacionId })]).catch((e) =>
    console.error("[whatsapp notify pedir_foto]", e?.message)
  );
}

// ---------------------------------------------------------------------------
// Conexiones (llamado desde las rutas HTTP)
// ---------------------------------------------------------------------------

export async function listarConexiones(userId: string, nivel: string) {
  return repo.listConexiones(userId, nivel === "super_admin" || nivel === "admin");
}

export async function contarNoLeidos(userId: string, nivel: string) {
  return repo.contarNoLeidos(userId, nivel === "super_admin" || nivel === "admin");
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

/** Mientras se importa el historial llegan miles de mensajes: en vez de un evento en vivo por
 * cada uno, la bandeja recibe un aviso "historial" como mucho cada 3 s y se recarga. */
const historialTimers = new Map<string, ReturnType<typeof setTimeout>>();
function avisarHistorial(conexionId: string): void {
  if (historialTimers.has(conexionId)) return;
  historialTimers.set(conexionId, setTimeout(() => {
    historialTimers.delete(conexionId);
    notifyEvento({ tipo: "historial", conexion_id: conexionId }).catch(() => {});
  }, 3000));
}

/**
 * Un mensaje entrante (o propio enviado desde el teléfono, o importado del historial) crea la
 * conversación si no existía (con vinculación automática a un contacto por teléfono en chats
 * individuales) y persiste el mensaje de forma idempotente por `wa_message_id`.
 */
export async function registrarMensajeEntrante(conexionId: string, msg: WhatsAppIncomingMessage): Promise<void> {
  const esGrupo = msg.esGrupo ?? msg.jid.endsWith("@g.us");
  let conversacion = await repo.getConversacionPorJid(conexionId, msg.jid);
  if (!conversacion) {
    const primeraEtapa = await repo.getPrimeraEtapa();
    if (!primeraEtapa) throw new Error("No hay etapas de pipeline de WhatsApp configuradas");
    // Con un `@lid` solo sirve el número real si WhatsApp ya lo reveló: los dígitos del LID son un
    // identificador opaco, no un teléfono. Un grupo no se vincula a un contacto.
    const contacto = esGrupo ? null : await repo.buscarContactoPorTelefono(msg.jidReal || msg.jid);
    conversacion = await repo.crearConversacion({
      conexionId,
      jid: msg.jid,
      // En un chat individual, si el primer mensaje lo mandó el dueño de la conexión (`fromMe`),
      // su `nombrePerfil` es SU propio nombre: no nombra la conversación. En un grupo, el nombre
      // es el asunto del grupo, venga de quien venga el mensaje.
      nombreWhatsapp: esGrupo || !msg.fromMe ? msg.nombrePerfil ?? null : null,
      fotoPerfilUrl: msg.fotoPerfilUrl ?? null,
      telefonoReal: msg.jidReal ?? null,
      etapaId: primeraEtapa.id,
      contactoId: contacto?.id ?? null,
      contactoVinculoEstado: contacto ? "vinculado_auto" : "sin_vincular",
      esGrupo,
    });
  } else {
    // El primer intento pudo fallar (privacidad, red, o el directorio de contactos de WhatsApp
    // todavía no había sincronizado): si un mensaje posterior sí trae el dato, se completa.
    if (msg.fotoPerfilUrl && msg.fotoPerfilUrl !== conversacion.foto_perfil_url) {
      if (await repo.setFotoPerfil(conversacion.id, msg.fotoPerfilUrl)) {
        await notifyEvento({ tipo: "foto_perfil", conexion_id: conexionId, conversacion_id: conversacion.id, foto_perfil_url: msg.fotoPerfilUrl });
      }
    }
    if (!esGrupo && !conversacion.telefono_real && msg.jidReal) {
      await repo.actualizarTelefonoReal(conversacion.id, msg.jidReal);
      await intentarVincularPorTelefono(conversacion.id, conversacion.contacto_id, msg.jidReal);
    }
    if (esGrupo && msg.nombrePerfil && msg.nombrePerfil !== conversacion.nombre_whatsapp) {
      await repo.upsertConversacionDesdeChat(conexionId, { jid: msg.jid, nombre: msg.nombrePerfil, esGrupo: true }, conversacion.etapa_id!);
    } else if (!esGrupo && !conversacion.nombre_whatsapp && !msg.fromMe && msg.nombrePerfil) {
      await repo.actualizarNombreSiFalta(conversacion.id, msg.nombrePerfil);
    }
  }

  // fromMe = lo envió el número conectado desde el teléfono, fuera de GOZZ. Se guarda como
  // 'saliente' para que el hilo quede completo; la idempotencia por wa_message_id evita duplicar
  // lo que GOZZ mismo envió.
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
    archivoTamanio: msg.archivoTamanio ?? null,
    estadoEntrega: msg.fromMe ? "enviado" : "entregado",
    createdAt: msg.timestamp,
    autorJid: msg.autorJid ?? null,
    autorNombre: msg.autorNombre ?? null,
    respuestaA: msg.respuestaA ?? null,
    respuestaPreview: msg.respuestaPreview ?? null,
    mediaMeta: msg.mediaMeta ?? null,
    historico: !!msg.historico,
  });
  if (!insertado) return; // ya lo teníamos (reintento del proveedor o eco de un envío propio)

  const base = previewDe(msg.tipo, msg.contenido, { archivoNombre: msg.archivoNombre });
  const preview = esGrupo && !msg.fromMe && msg.autorNombre ? `${msg.autorNombre}: ${base}` : base;
  await repo.tocarUltimoMensaje(conversacion.id, preview, direccion, { at: msg.timestamp, contarNoLeido: !msg.historico && direccion === "entrante" });
  if (msg.historico) { avisarHistorial(conexionId); return; }
  await notifyEvento({ tipo: "mensaje", conexion_id: conexionId, conversacion_id: conversacion.id, mensaje: insertado, es_grupo: esGrupo });
}

/** Reacción, borrado o edición sobre un mensaje que ya tenemos. Si el mensaje original no está
 * (anterior a la conexión y no importado), no hay nada que modificar. */
export async function registrarModificacion(conexionId: string, mod: WhatsAppMensajeModificado): Promise<void> {
  const m = await repo.getMensajeDeChat(conexionId, mod.jid, mod.objetivoId);
  if (!m) return;
  const actualizado =
    mod.tipo === "reaccion" ? await repo.aplicarReaccion(m.id, mod.autor, mod.emoji)
    : mod.tipo === "borrado" ? await repo.marcarEliminado(m.id)
    : await repo.editarContenido(m.id, mod.contenido);
  if (!actualizado) return;
  await notifyEvento({ tipo: "mensaje_actualizado", conexion_id: conexionId, conversacion_id: m.conversacion_id, mensaje: actualizado });
}

/** Chats que informa WhatsApp: todos los del teléfono al vincular (historial), o el cambio de
 * nombre de un grupo. Crea las conversaciones que falten con su nombre, no leídos y archivado. */
export async function registrarChats(conexionId: string, chats: WhatsAppChatInfo[], opts: { historial: boolean }): Promise<void> {
  if (!chats.length) return;
  const primeraEtapa = await repo.getPrimeraEtapa();
  if (!primeraEtapa) throw new Error("No hay etapas de pipeline de WhatsApp configuradas");
  for (const chat of chats) {
    const conv = await repo.upsertConversacionDesdeChat(conexionId, chat, primeraEtapa.id);
    if (!chat.esGrupo && !conv.contacto_id) await intentarVincularPorTelefono(conv.id, null, chat.jidReal || chat.jid);
  }
  if (opts.historial) avisarHistorial(conexionId);
  else await notifyEvento({ tipo: "historial", conexion_id: conexionId });
}

// ---- Media que se descarga al abrirla (historial, o descarga en vivo que falló) ----

export async function solicitarDescargaMedia(mensajeId: string): Promise<void> {
  await query("SELECT pg_notify('whatsapp_descargar', $1)", [JSON.stringify({ mensaje_id: mensajeId })]);
}

export async function registrarMediaDescargada(mensajeId: string, d: WhatsAppMediaDescargada): Promise<void> {
  const m = await repo.setMediaDescargada(mensajeId, d);
  if (!m) return;
  const conv = await repo.getConversacion(m.conversacion_id);
  if (!conv) return;
  await notifyEvento({ tipo: "mensaje_actualizado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje: m });
}

export async function registrarFalloDescarga(mensajeId: string, error: string): Promise<void> {
  const m = await repo.getMensaje(mensajeId);
  if (!m) return;
  const conv = await repo.getConversacion(m.conversacion_id);
  if (!conv) return;
  await notifyEvento({ tipo: "media_error", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje_id: mensajeId, error });
}

/** Antes de enviar: deja guardado el id de WhatsApp del mensaje (ver `generarIdMensaje`). */
export async function reservarIdEnvio(mensajeId: string, waMessageId: string): Promise<string> {
  return repo.reservarWaMessageId(mensajeId, waMessageId);
}

export async function registrarConfirmacionEnvio(mensajeId: string, waMessageId: string): Promise<void> {
  // Notifica el estado REAL tras la confirmación: si un acuse de "entregado" llegó primero, el
  // mensaje ya está en "entregado" y no se retrocede a "enviado".
  const m = await repo.confirmarEnvio(mensajeId, waMessageId);
  if (!m) return;
  const conv = await repo.getConversacion(m.conversacion_id);
  if (!conv) return;
  await notifyEvento({ tipo: "mensaje_estado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje_id: mensajeId, estado: m.estado_entrega });
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

/** Confirmación de entrega/lectura de WhatsApp para un mensaje saliente YA enviado. Si el mensaje
 * no existe (id de otra conexión, o uno que la app nunca guardó) no hace nada — no es un error. */
export async function registrarActualizacionEntrega(waMessageId: string, estado: "entregado" | "leido"): Promise<void> {
  const m = await repo.getMensajePorWaId(waMessageId);
  if (!m || m.direccion !== "saliente") return;
  // No retroceder: un "leído" tardío no debe pisar un estado más avanzado, y repetir el mismo
  // evento (WhatsApp puede reenviar la confirmación) no debe generar ruido de notificaciones.
  const orden: Record<string, number> = { pendiente: 0, enviado: 1, entregado: 2, leido: 3, fallido: 0 };
  if ((orden[m.estado_entrega] ?? 0) >= orden[estado]) return;
  await repo.actualizarEstadoMensaje(m.id, estado);
  const conv = await repo.getConversacion(m.conversacion_id);
  if (!conv) return;
  await notifyEvento({ tipo: "mensaje_estado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje_id: m.id, estado });
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
  // Antes: 1 consulta por conversación para sus etiquetas (N+1 — 51 idas a la base con 50
  // conversaciones). Ahora `repo.listConversaciones` ya trae las etiquetas agregadas en la misma
  // consulta — una sola ida a la base de datos sin importar cuántas conversaciones haya.
  const conversaciones = await repo.listConversaciones(conexionId, filtros);
  // La resolución automática de la foto solo ocurre cuando llega o sale un mensaje nuevo — una
  // conversación vieja sin actividad reciente se quedaría sin foto para siempre. Al listar (y al
  // abrir, ver abajo) se pide de una vez, sin bloquear la respuesta.
  for (const c of conversaciones) if (fotoNecesitaRefresco(c)) notifyPedirFoto(c.id).catch(() => {});
  return conversaciones;
}

export async function obtenerConversacion(id: string) {
  const conversacion = await repo.getConversacion(id);
  if (!conversacion) return null;
  if (fotoNecesitaRefresco(conversacion)) notifyPedirFoto(id).catch(() => {});
  // Para recibir "escribiendo…"/"en línea" WhatsApp exige suscribirse al chat.
  if (!conversacion.wa_jid.endsWith("@g.us")) pedirAccion({ tipo: "suscribir_presencia", conversacion_id: id }).catch(() => {});
  const tags = await repo.tagsDeConversacion(id);
  return { ...conversacion, tags };
}

/** El worker escucha esto y, si tiene una conexión activa para esa conversación, intenta
 * resolver su foto de perfil y la guarda — llamado desde whatsapp-connection-manager.ts. */
export async function registrarFotoPerfilResuelta(conversacionId: string, url: string | null): Promise<void> {
  const cambio = await repo.setFotoPerfil(conversacionId, url);
  if (!cambio) return;
  const conv = await repo.getConversacion(conversacionId);
  if (!conv) return;
  await notifyEvento({ tipo: "foto_perfil", conexion_id: conv.conexion_id, conversacion_id: conversacionId, foto_perfil_url: url });
}

/** El worker escucha `contacts.upsert`/`contacts.update`/`chats.phoneNumberShare` de Baileys —
 * eventos que llegan solos, no bajo pedido — y avisa aquí cuando WhatsApp revela el nombre
 * guardado o el número real de un contacto cuya conversación ya existe (típicamente creada antes,
 * sin ese dato, o con el nombre del propio dueño de la conexión por el bug de `pushName`). Solo
 * corrige lo que faltaba, nunca pisa un nombre o número que ya se hubiera resuelto o editado. */
export async function registrarContactoResuelto(conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }): Promise<void> {
  const conversacion = await repo.getConversacionPorJid(conexionId, jid);
  if (!conversacion) return;
  if (info.nombre && !conversacion.nombre_whatsapp) await repo.actualizarNombreSiFalta(conversacion.id, info.nombre);
  if (info.jidReal && !conversacion.telefono_real) {
    await repo.actualizarTelefonoReal(conversacion.id, info.jidReal);
    await intentarVincularPorTelefono(conversacion.id, conversacion.contacto_id, info.jidReal);
  }
  await notifyEvento({ tipo: "contacto_resuelto", conexion_id: conexionId, conversacion_id: conversacion.id });
}

export async function listarMensajes(conversacionId: string, limit?: number, before?: string) {
  return repo.listMensajes(conversacionId, limit, before);
}

/** Una conversación que llegó como `@lid` no se pudo vincular al crearse (no había número real).
 * Cuando WhatsApp revela el número, se reintenta — solo si sigue sin contacto. */
async function intentarVincularPorTelefono(conversacionId: string, contactoActual: string | null, jidReal: string): Promise<void> {
  if (contactoActual) return;
  const contacto = await repo.buscarContactoPorTelefono(jidReal);
  if (contacto) await repo.vincularContacto(conversacionId, contacto.id, "vinculado_auto");
}

export async function marcarLeida(conversacionId: string, userId: string | null) {
  const waIds = await repo.marcarLeida(conversacionId, userId);
  // Confirmación de lectura hacia WhatsApp (checks azules del lado del contacto), como WhatsApp Web.
  if (waIds.length) {
    await query("SELECT pg_notify('whatsapp_leer', $1)", [JSON.stringify({ conversacion_id: conversacionId, wa_message_ids: waIds })]).catch((e) =>
      console.error("[whatsapp notify leer]", e?.message)
    );
  }
}

// ---- Acciones sobre mensajes (reaccionar, eliminar para todos, editar) ----

async function pedirAccion(payload: Record<string, unknown>): Promise<void> {
  await query("SELECT pg_notify('whatsapp_accion', $1)", [JSON.stringify(payload)]);
}

async function mensajeConWaId(mensajeId: string) {
  const m = await repo.getMensaje(mensajeId);
  if (!m) throw new Error("Mensaje no encontrado");
  if (!m.wa_message_id) throw new Error("Ese mensaje todavía no llegó a WhatsApp");
  return m;
}

const VENTANA_ELIMINAR_MS = 48 * 60 * 60 * 1000;
const VENTANA_EDITAR_MS = 15 * 60 * 1000;

/** Reacción propia (emoji vacío = quitarla). Se refleja al instante y se manda a WhatsApp. */
export async function reaccionar(mensajeId: string, emoji: string) {
  const m = await mensajeConWaId(mensajeId);
  const actualizado = await repo.aplicarReaccion(m.id, "yo", emoji);
  const conv = await repo.getConversacion(m.conversacion_id);
  if (conv && actualizado) await notifyEvento({ tipo: "mensaje_actualizado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje: actualizado });
  await pedirAccion({ tipo: "reaccion", conversacion_id: m.conversacion_id, mensaje_id: m.id, emoji });
  return actualizado;
}

/** Eliminar para todos: solo mensajes propios y dentro de las 48 h (WhatsApp no deja después). */
export async function eliminarParaTodos(mensajeId: string) {
  const m = await mensajeConWaId(mensajeId);
  if (m.direccion !== "saliente") throw new Error("Solo puedes eliminar mensajes enviados por ti");
  if (Date.now() - new Date(m.created_at).getTime() > VENTANA_ELIMINAR_MS) throw new Error("WhatsApp solo deja eliminar para todos durante las primeras 48 horas");
  const actualizado = await repo.marcarEliminado(m.id);
  const conv = await repo.getConversacion(m.conversacion_id);
  if (conv && actualizado) await notifyEvento({ tipo: "mensaje_actualizado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje: actualizado });
  await pedirAccion({ tipo: "eliminar", conversacion_id: m.conversacion_id, mensaje_id: m.id });
  return actualizado;
}

/** Editar un texto propio: solo dentro de los 15 minutos (el límite de WhatsApp). */
export async function editarMensaje(mensajeId: string, contenido: string) {
  const m = await mensajeConWaId(mensajeId);
  if (m.direccion !== "saliente" || m.tipo !== "texto") throw new Error("Solo puedes editar mensajes de texto enviados por ti");
  if (m.eliminado_at) throw new Error("Ese mensaje fue eliminado");
  if (Date.now() - new Date(m.created_at).getTime() > VENTANA_EDITAR_MS) throw new Error("WhatsApp solo deja editar durante los primeros 15 minutos");
  const actualizado = await repo.editarContenido(m.id, contenido);
  const conv = await repo.getConversacion(m.conversacion_id);
  if (conv && actualizado) await notifyEvento({ tipo: "mensaje_actualizado", conexion_id: conv.conexion_id, conversacion_id: m.conversacion_id, mensaje: actualizado });
  await pedirAccion({ tipo: "editar", conversacion_id: m.conversacion_id, mensaje_id: m.id, contenido });
  return actualizado;
}

/** "Escribiendo…" hacia el contacto mientras alguien del equipo escribe en el CRM. */
export async function marcarEscribiendo(conversacionId: string, estado: "composing" | "recording" | "paused") {
  await pedirAccion({ tipo: "presencia", conversacion_id: conversacionId, estado });
}

/** Presencia del contacto (llega del worker) → evento en vivo, sin tocar la base. */
export async function registrarPresencia(conexionId: string, jid: string, estado: string, participante: string | null): Promise<void> {
  const conv = await repo.getConversacionPorJid(conexionId, jid);
  if (!conv) return;
  await notifyEvento({ tipo: "presencia", conexion_id: conexionId, conversacion_id: conv.id, estado, participante });
}

export async function fijar(conversacionId: string, fijada: boolean) {
  await repo.setFijada(conversacionId, fijada);
}

export async function buscarMensajes(conversacionId: string, q: string) {
  return repo.buscarMensajes(conversacionId, q);
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

/** Alta rápida de contacto desde WhatsApp — email opcional, a propósito, y SOLO aquí (ver
 * repo.crearContactoMinimo). No reemplaza a `POST /api/contactos`, que sigue exigiéndolo siempre. */
export async function crearContactoDesdeWhatsApp(nombreCompleto: string, telefono: string, email: string | null) {
  return repo.crearContactoMinimo({ nombreCompleto, telefono, email });
}

/**
 * "Contactar por WhatsApp" desde la ficha del contacto: consigue-o-crea la conversación para su
 * teléfono en la conexión elegida (mismo upsert que usa un mensaje entrante nuevo) y la deja
 * vinculada a ese contacto de una vez — sin esto, el primer mensaje que se le mande llegaría "sin
 * vincular" hasta que alguien lo hiciera a mano.
 */
export async function abrirConversacionConContacto(contactoId: string, conexionId: string): Promise<{ conversacionId: string }> {
  const telefono = await repo.getTelefonoContacto(contactoId);
  if (!telefono) throw new Error("Este contacto no tiene teléfono ni WhatsApp guardado");
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length < 7) throw new Error("El teléfono del contacto no es válido para WhatsApp");
  const primeraEtapa = await repo.getPrimeraEtapa();
  if (!primeraEtapa) throw new Error("No hay etapas de pipeline de WhatsApp configuradas");

  const jid = `${digitos}@s.whatsapp.net`;
  let conversacion = await repo.crearConversacion({ conexionId, jid, etapaId: primeraEtapa.id });
  if (conversacion.contacto_id !== contactoId) {
    conversacion = await repo.vincularContacto(conversacion.id, contactoId, "vinculado_manual");
  }
  return { conversacionId: conversacion.id };
}

/** Encola un mensaje saliente: lo inserta en 'pendiente' y avisa al worker por NOTIFY. */
export async function enviarMensaje(
  conversacionId: string,
  userId: string,
  d: { tipo: string; contenido?: string | null; archivoUrl?: string | null; archivoNombre?: string | null; archivoTamanio?: number | null; respuestaA?: string | null }
) {
  const conversacion = await repo.getConversacion(conversacionId);
  if (!conversacion) throw new Error("Conversación no encontrada");
  // Responder citando: se guarda el id del citado y un extracto para mostrarlo.
  let respuestaPreview: string | null = null;
  if (d.respuestaA) {
    const citado = await repo.getMensajeDeChat(conversacion.conexion_id, conversacion.wa_jid, d.respuestaA);
    if (!citado) throw new Error("El mensaje citado no existe en esta conversación");
    respuestaPreview = previewDe(citado.tipo, citado.contenido, { archivoNombre: citado.archivo_nombre }).slice(0, 160);
  }

  const mensaje = await repo.insertMensaje({
    conversacionId,
    direccion: "saliente",
    tipo: d.tipo,
    contenido: d.contenido ?? null,
    archivoUrl: d.archivoUrl ?? null,
    archivoNombre: d.archivoNombre ?? null,
    archivoTamanio: d.archivoTamanio ?? null,
    enviadoPor: userId,
    estadoEntrega: "pendiente",
    respuestaA: d.respuestaA ?? null,
    respuestaPreview,
  });
  if (!mensaje) throw new Error("No se pudo registrar el mensaje");

  const preview = previewDe(d.tipo, d.contenido ?? null, { archivoNombre: d.archivoNombre });
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
