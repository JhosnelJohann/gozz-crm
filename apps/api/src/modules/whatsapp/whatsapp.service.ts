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
      // Si el primer mensaje del hilo lo mandó el dueño de la conexión desde el teléfono
      // (`fromMe`), su `nombrePerfil` es SU propio nombre, no el del contacto — nombrar así la
      // conversación fue el bug reportado ("aparece mi propio nombre"). Sin nombre de sobra, se
      // completará solo en cuanto llegue un mensaje real del contacto (ver la rama de abajo) o el
      // directorio de contactos de WhatsApp lo resuelva (`registrarContactoResuelto`).
      nombreWhatsapp: !msg.fromMe ? msg.nombrePerfil ?? null : null,
      fotoPerfilUrl: msg.fotoPerfilUrl ?? null,
      telefonoReal: msg.jidReal ?? null,
      etapaId: primeraEtapa.id,
      contactoId: contacto?.id ?? null,
      contactoVinculoEstado: contacto ? "vinculado_auto" : "sin_vincular",
    });
  } else {
    // El primer intento pudo fallar (privacidad, red, o el directorio de contactos de WhatsApp
    // todavía no había sincronizado) — si un mensaje posterior sí trae el dato, no hay razón para
    // quedarse sin él para siempre. El nombre solo se completa desde un mensaje que NO es `fromMe`
    // (ver la nota en baileys.provider.ts sobre por qué el pushName de un mensaje propio no sirve).
    if (!conversacion.foto_perfil_url && msg.fotoPerfilUrl) await repo.actualizarFotoPerfil(conversacion.id, msg.fotoPerfilUrl);
    if (!conversacion.telefono_real && msg.jidReal) await repo.actualizarTelefonoReal(conversacion.id, msg.jidReal);
    if (!conversacion.nombre_whatsapp && !msg.fromMe && msg.nombrePerfil) await repo.actualizarNombreSiFalta(conversacion.id, msg.nombrePerfil);
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
  const conversaciones = await repo.listConversaciones(conexionId, filtros);
  const conTags = await Promise.all(
    conversaciones.map(async (c) => ({ ...c, tags: await repo.tagsDeConversacion(c.id) }))
  );
  // La resolución automática de la foto solo ocurre cuando llega o sale un mensaje nuevo — una
  // conversación vieja sin actividad reciente se quedaría sin foto para siempre. Al listar (y al
  // abrir, ver abajo) se pide de una vez, sin bloquear la respuesta.
  for (const c of conTags) if (!c.foto_perfil_url) notifyPedirFoto(c.id).catch(() => {});
  return conTags;
}

export async function obtenerConversacion(id: string) {
  const conversacion = await repo.getConversacion(id);
  if (!conversacion) return null;
  if (!conversacion.foto_perfil_url) notifyPedirFoto(id).catch(() => {});
  const tags = await repo.tagsDeConversacion(id);
  return { ...conversacion, tags };
}

/** El worker escucha esto y, si tiene una conexión activa para esa conversación, intenta
 * resolver su foto de perfil y la guarda — llamado desde whatsapp-connection-manager.ts. */
export async function registrarFotoPerfilResuelta(conversacionId: string, url: string): Promise<void> {
  await repo.actualizarFotoPerfil(conversacionId, url);
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
  if (info.jidReal && !conversacion.telefono_real) await repo.actualizarTelefonoReal(conversacion.id, info.jidReal);
  await notifyEvento({ tipo: "contacto_resuelto", conexion_id: conexionId, conversacion_id: conversacion.id });
}

export async function listarMensajes(conversacionId: string, limit?: number, before?: string) {
  return repo.listMensajes(conversacionId, limit, before);
}

export async function marcarLeida(conversacionId: string, userId: string | null) {
  await repo.marcarLeida(conversacionId, userId);
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
