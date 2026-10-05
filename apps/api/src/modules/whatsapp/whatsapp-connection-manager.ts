// Orquesta el proveedor de WhatsApp (Baileys hoy; Meta Cloud API mañana, vía la misma interfaz)
// y conecta sus eventos con whatsapp.service.ts. Vive SOLO en el proceso gozz-whatsapp-worker
// (whatsapp-worker.ts) — es el único punto, junto con providers/baileys.provider.ts, que importa
// `@whiskeysockets/baileys`.
import { BaileysWhatsAppProvider } from "./providers/baileys.provider.js";
import type { WhatsAppProvider } from "./providers/whatsapp-provider.interface.js";
import * as service from "./whatsapp.service.js";
import * as repo from "./whatsapp.repository.js";

const provider: WhatsAppProvider = new BaileysWhatsAppProvider();

provider.onQr((conexionId, qr) => {
  service.registrarQr(conexionId, qr).catch((e) => console.error(`[whatsapp-cm] registrarQr(${conexionId}):`, e?.message));
});
provider.onConnectionUpdate((conexionId, update) => {
  service.registrarActualizacionEstado(conexionId, update).catch((e) => console.error(`[whatsapp-cm] registrarActualizacionEstado(${conexionId}):`, e?.message));
});
// Devuelve la promesa a propósito: al importar el historial el proveedor espera cada mensaje antes
// del siguiente (miles de inserciones en paralelo saturarían la base).
provider.onMessage((conexionId, msg) =>
  service.registrarMensajeEntrante(conexionId, msg).catch((e) => console.error(`[whatsapp-cm] registrarMensajeEntrante(${conexionId}):`, e?.message))
);
provider.onMensajeModificado((conexionId, mod) => {
  service.registrarModificacion(conexionId, mod).catch((e) => console.error(`[whatsapp-cm] registrarModificacion(${mod.objetivoId}):`, e?.message));
});
provider.onChats((conexionId, chats, opts) =>
  service.registrarChats(conexionId, chats, opts).catch((e) => console.error(`[whatsapp-cm] registrarChats(${conexionId}):`, e?.message))
);
provider.onMessageStatusUpdate((_conexionId, waMessageId, estado) => {
  if (estado !== "entregado" && estado !== "leido") return;
  service.registrarActualizacionEntrega(waMessageId, estado).catch((e) => console.error(`[whatsapp-cm] registrarActualizacionEntrega(${waMessageId}):`, e?.message));
});
provider.onPresencia((conexionId, jid, estado, participante) => {
  service.registrarPresencia(conexionId, jid, estado, participante).catch(() => {});
});
provider.onContactoResuelto((conexionId, jid, info) => {
  service.registrarContactoResuelto(conexionId, jid, info).catch((e) => console.error(`[whatsapp-cm] registrarContactoResuelto(${jid}):`, e?.message));
});

/** Acciones pedidas desde el CRM (reaccionar, eliminar, editar, "escribiendo…", presencia). */
export async function ejecutarAccion(p: { tipo: string; conversacion_id: string; mensaje_id?: string; emoji?: string; contenido?: string; estado?: string }): Promise<void> {
  const conversacion = await repo.getConversacion(p.conversacion_id);
  if (!conversacion) return;
  const jid = conversacion.wa_jid;
  let clave: { id: string; fromMe: boolean; participant: string | null } | null = null;
  if (p.mensaje_id) {
    const m = await repo.getMensaje(p.mensaje_id);
    if (!m?.wa_message_id) return;
    clave = { id: m.wa_message_id, fromMe: m.direccion === "saliente", participant: m.autor_jid ?? null };
  }
  try {
    if (p.tipo === "reaccion" && clave) await provider.accion(conversacion.conexion_id, { tipo: "reaccion", jid, clave, emoji: p.emoji || "" });
    else if (p.tipo === "eliminar" && clave) await provider.accion(conversacion.conexion_id, { tipo: "eliminar", jid, clave });
    else if (p.tipo === "editar" && clave && p.contenido) await provider.accion(conversacion.conexion_id, { tipo: "editar", jid, clave, contenido: p.contenido });
    else if (p.tipo === "presencia") await provider.accion(conversacion.conexion_id, { tipo: "presencia", jid, estado: (p.estado as any) || "composing" });
    else if (p.tipo === "suscribir_presencia") await provider.accion(conversacion.conexion_id, { tipo: "suscribir_presencia", jid });
  } catch (e: any) {
    // La presencia es best-effort; un fallo de reacción/edición/eliminación se registra.
    if (!p.tipo.includes("presencia")) console.error(`[whatsapp-cm] acción ${p.tipo} falló:`, e?.message);
  }
}

/** Baja la media de un mensaje guardado sin archivo (historial o descarga fallida), al pedirla. */
export async function descargarMediaMensaje(mensajeId: string): Promise<void> {
  const m = await repo.getMediaPendiente(mensajeId);
  if (!m || m.archivo_url || !m.media_meta) return;
  try {
    const meta = typeof m.media_meta === "string" ? m.media_meta : JSON.stringify(m.media_meta);
    const r = await provider.descargarMedia(m.conexion_id, meta);
    await service.registrarMediaDescargada(mensajeId, r);
  } catch (e: any) {
    await service.registrarFalloDescarga(mensajeId, e?.message || "No se pudo descargar");
  }
}

export async function iniciarConexion(conexionId: string): Promise<void> {
  await provider.connect(conexionId);
}

export async function detenerConexion(conexionId: string): Promise<void> {
  await provider.disconnect(conexionId);
}

/** Reconecta todas las conexiones activas al arrancar el worker (con sesión guardada, sin pedir QR de nuevo). */
export async function reconectarActivas(): Promise<void> {
  const conexiones = await repo.listConexionesActivas();
  for (const c of conexiones) {
    try {
      await provider.connect(c.id);
      console.log(`[whatsapp-worker] reconectando ${c.nombre} (${c.id})`);
    } catch (e: any) {
      console.error(`[whatsapp-worker] no se pudo reconectar ${c.id}:`, e?.message);
    }
  }
}

/** Procesa un mensaje saliente en estado 'pendiente' (recién insertado o sobreviviente de un reinicio). */
export async function enviarMensajePendiente(mensajeId: string): Promise<void> {
  const mensaje = await repo.getMensaje(mensajeId);
  if (!mensaje || mensaje.estado_entrega !== "pendiente") return;
  const conversacion = await repo.getConversacion(mensaje.conversacion_id);
  if (!conversacion) return;

  try {
    // Id asignado y GUARDADO antes de enviar (ver `generarIdMensaje` en la interfaz del proveedor).
    // Un reintento reutiliza el mismo id: WhatsApp deduplica por id, así que nunca llega doble.
    let waId = mensaje.wa_message_id;
    if (!waId) {
      waId = provider.generarIdMensaje(conversacion.conexion_id);
      waId = await service.reservarIdEnvio(mensajeId, waId);
    }
    // Responder citando: se busca el mensaje citado para pasarle a WhatsApp su clave y su texto.
    let citado = null;
    if (mensaje.respuesta_a) {
      const q = await repo.getMensajeDeChat(conversacion.conexion_id, conversacion.wa_jid, mensaje.respuesta_a);
      citado = { id: mensaje.respuesta_a, fromMe: q?.direccion === "saliente", participant: q?.autor_jid ?? null, texto: q?.contenido || mensaje.respuesta_preview || "" };
    }
    const { waMessageId } = await provider.sendMessage(conversacion.conexion_id, {
      jid: conversacion.wa_jid,
      tipo: mensaje.tipo,
      contenido: mensaje.contenido,
      archivoUrl: mensaje.archivo_url,
      archivoNombre: mensaje.archivo_nombre,
      waMessageId: waId,
      citado,
    });
    await service.registrarConfirmacionEnvio(mensajeId, waMessageId);
  } catch (e: any) {
    await service.registrarFalloEnvio(mensajeId, e?.message || "Error enviando el mensaje");
  }
}

/** Barrido al arrancar: reintenta mensajes 'pendiente' que se quedaron a medias si el worker cayó. */
export async function reenviarPendientesAlArrancar(): Promise<void> {
  const pendientes = await service.mensajesPendientesDeEnvio();
  for (const m of pendientes) {
    await enviarMensajePendiente(m.id).catch((e) => console.error(`[whatsapp-worker] pendiente ${m.id}:`, e?.message));
  }
}

/** Pedido bajo demanda (al listar/abrir una conversación sin foto) — solo hace algo si la
 * conexión dueña sigue activa en este proceso; si no, no pasa nada (se reintentará la próxima
 * vez que se liste/abra). */
export async function actualizarFotoConversacion(conversacionId: string, forzar = false): Promise<void> {
  const conversacion = await repo.getConversacion(conversacionId);
  if (!conversacion) return;
  if (!forzar && !service.fotoNecesitaRefresco(conversacion)) return;
  const url = await provider.resolverFotoPerfil(conversacion.conexion_id, conversacion.wa_jid, forzar);
  await service.registrarFotoPerfilResuelta(conversacionId, url);
}

/** Confirmaciones de lectura hacia WhatsApp (checks azules del lado del contacto) cuando alguien
 * del equipo abre la conversación en el CRM. */
export async function marcarLeidosEnWhatsApp(conversacionId: string, waMessageIds: string[]): Promise<void> {
  const conversacion = await repo.getConversacion(conversacionId);
  if (!conversacion || !waMessageIds.length) return;
  await provider.marcarLeidos(conversacion.conexion_id, conversacion.wa_jid, waMessageIds);
}
