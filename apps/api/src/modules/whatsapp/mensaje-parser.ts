// Interpreta el contenido de un mensaje de WhatsApp (el `message` de un WAMessage de Baileys) y
// decide qué es: un mensaje que se muestra, o una MODIFICACIÓN de otro (reacción, borrado,
// edición), o algo interno que no se muestra.
//
// Por qué existe: antes solo se reconocían texto, imagen, video, audio y documento. Todo lo demás
// se guardaba como tipo 'sistema' sin contenido: el 28 % de los mensajes de la base local eran
// burbujas en blanco (stickers, reacciones, borrados, ubicaciones, contactos, "ver una vez"…).
//
// Puro a propósito: recibe objetos planos (la forma de `proto.IMessage`) y no importa Baileys, así
// las pruebas lo ejercitan sin abrir ninguna conexión (misma regla que whatsapp.service.ts).

export type TipoMensaje = "texto" | "imagen" | "archivo" | "audio" | "video" | "sistema" | "sticker" | "ubicacion" | "contacto" | "encuesta";

export interface MediaInfo {
  tipo: "image" | "video" | "audio" | "document" | "sticker";
  nombre: string | null;
  mimetype: string | null;
  tamanio: number | null;
  segundos: number | null;
}

export type MensajeParseado =
  | { kind: "mensaje"; tipo: TipoMensaje; contenido: string | null; media: MediaInfo | null; cita: { id: string; preview: string } | null }
  | { kind: "reaccion"; objetivoId: string; emoji: string }
  | { kind: "borrado"; objetivoId: string }
  | { kind: "edicion"; objetivoId: string; contenido: string }
  | { kind: "ignorar" };

/** Tipos de `protocolMessage` (proto.Message.ProtocolMessage.Type). */
const PROTOCOL_REVOKE = 0;
const PROTOCOL_EDIT = 14;

/** Envoltorios que WhatsApp pone alrededor del mensaje real: temporales, "ver una vez",
 * documento con texto, edición. Se desenvuelven hasta llegar al contenido. */
const ENVOLTORIOS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage", "botInvokeMessage", "groupMentionedMessage", "lottieStickerMessage"];

export function desenvolver(m: any): any {
  let actual = m;
  for (let i = 0; i < 6 && actual; i++) {
    const clave = ENVOLTORIOS.find((k) => actual[k]?.message);
    if (!clave) break;
    actual = actual[clave].message;
  }
  return actual;
}

const num = (v: any): number | null => {
  if (v == null) return null;
  const n = typeof v === "object" && typeof v.toNumber === "function" ? v.toNumber() : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Contactos compartidos: nombre y teléfonos sacados de la vCard (con `waid` cuando viene). */
export function parsearVcard(vcard: string | null | undefined, nombre?: string | null): { nombre: string; telefonos: string[] } {
  const v = vcard || "";
  const fn = /^FN[^:]*:(.+)$/im.exec(v)?.[1]?.trim();
  const telefonos: string[] = [];
  for (const linea of v.split(/\r?\n/)) {
    if (!/^(item\d+\.)?TEL/i.test(linea)) continue;
    const waid = /waid=(\d+)/i.exec(linea)?.[1];
    const valor = linea.split(":").slice(1).join(":").trim();
    const tel = waid ? `+${waid}` : valor;
    if (tel && !telefonos.includes(tel)) telefonos.push(tel);
  }
  return { nombre: (nombre || fn || "Contacto").trim(), telefonos };
}

/** Texto corto de un mensaje para listas, citas y notificaciones. */
export function previewDe(tipo: string, contenido: string | null | undefined, opts: { archivoNombre?: string | null } = {}): string {
  const json = <T,>(): T | null => { try { return contenido ? JSON.parse(contenido) : null; } catch { return null; } };
  switch (tipo) {
    case "texto": return contenido || "";
    case "imagen": return contenido ? `📷 ${contenido}` : "📷 Foto";
    case "video": return contenido ? `🎥 ${contenido}` : "🎥 Video";
    case "audio": return "🎤 Nota de voz";
    case "sticker": return "Sticker";
    case "archivo": return `📄 ${opts.archivoNombre || contenido || "Documento"}`;
    case "ubicacion": { const u = json<{ nombre?: string; vivo?: boolean }>(); return `📍 ${u?.vivo ? "Ubicación en tiempo real" : u?.nombre || "Ubicación"}`; }
    case "contacto": { const c = json<{ nombre: string }[]>(); return `👤 ${c && c.length > 1 ? `${c.length} contactos` : c?.[0]?.nombre || "Contacto"}`; }
    case "encuesta": { const e = json<{ pregunta: string }>(); return `📊 ${e?.pregunta || "Encuesta"}`; }
    default: return contenido || "Mensaje";
  }
}

function contextInfoDe(m: any): any {
  for (const k of Object.keys(m || {})) {
    const ci = m[k]?.contextInfo;
    if (ci) return ci;
  }
  return null;
}

function cuerpo(m: any): { tipo: TipoMensaje; contenido: string | null; media: MediaInfo | null } | null {
  if (m.conversation) return { tipo: "texto", contenido: m.conversation, media: null };
  if (m.extendedTextMessage?.text != null) return { tipo: "texto", contenido: m.extendedTextMessage.text, media: null };
  if (m.imageMessage) {
    const i = m.imageMessage;
    return { tipo: "imagen", contenido: i.caption || null, media: { tipo: "image", nombre: null, mimetype: i.mimetype || "image/jpeg", tamanio: num(i.fileLength), segundos: null } };
  }
  if (m.videoMessage) {
    const v = m.videoMessage;
    return { tipo: "video", contenido: v.caption || null, media: { tipo: "video", nombre: null, mimetype: v.mimetype || "video/mp4", tamanio: num(v.fileLength), segundos: num(v.seconds) } };
  }
  if (m.ptvMessage) {
    const v = m.ptvMessage;
    return { tipo: "video", contenido: null, media: { tipo: "video", nombre: null, mimetype: v.mimetype || "video/mp4", tamanio: num(v.fileLength), segundos: num(v.seconds) } };
  }
  if (m.audioMessage) {
    const a = m.audioMessage;
    return { tipo: "audio", contenido: null, media: { tipo: "audio", nombre: null, mimetype: a.mimetype || "audio/ogg", tamanio: num(a.fileLength), segundos: num(a.seconds) } };
  }
  if (m.documentMessage) {
    const d = m.documentMessage;
    return { tipo: "archivo", contenido: d.caption || null, media: { tipo: "document", nombre: d.fileName || d.title || "documento", mimetype: d.mimetype || null, tamanio: num(d.fileLength), segundos: null } };
  }
  if (m.stickerMessage) {
    const s = m.stickerMessage;
    return { tipo: "sticker", contenido: null, media: { tipo: "sticker", nombre: null, mimetype: s.mimetype || "image/webp", tamanio: num(s.fileLength), segundos: null } };
  }
  if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage || m.liveLocationMessage;
    const lat = Number(l.degreesLatitude), lng = Number(l.degreesLongitude);
    return {
      tipo: "ubicacion",
      contenido: JSON.stringify({ lat, lng, nombre: l.name || null, direccion: l.address || null, vivo: !!m.liveLocationMessage, url: l.url || `https://maps.google.com/?q=${lat},${lng}` }),
      media: null,
    };
  }
  if (m.contactMessage) return { tipo: "contacto", contenido: JSON.stringify([parsearVcard(m.contactMessage.vcard, m.contactMessage.displayName)]), media: null };
  if (m.contactsArrayMessage) {
    const lista = (m.contactsArrayMessage.contacts || []).map((c: any) => parsearVcard(c.vcard, c.displayName));
    return { tipo: "contacto", contenido: JSON.stringify(lista), media: null };
  }
  const poll = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
  if (poll) return { tipo: "encuesta", contenido: JSON.stringify({ pregunta: poll.name || "Encuesta", opciones: (poll.options || []).map((o: any) => o.optionName).filter(Boolean) }), media: null };
  // Respuestas a botones y listas, y mensajes de empresas con plantilla: se muestran como texto.
  const textoRespuesta =
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.interactiveResponseMessage?.body?.text ||
    m.buttonsMessage?.contentText ||
    m.listMessage?.description ||
    m.templateMessage?.hydratedTemplate?.hydratedContentText ||
    m.templateMessage?.hydratedFourRowTemplate?.hydratedContentText ||
    m.interactiveMessage?.body?.text;
  if (textoRespuesta) return { tipo: "texto", contenido: String(textoRespuesta), media: null };
  if (m.groupInviteMessage) return { tipo: "texto", contenido: `Invitación al grupo "${m.groupInviteMessage.groupName || ""}"`.trim(), media: null };
  if (m.callLogMesssage || m.callLogMessage) return { tipo: "sistema", contenido: "📞 Llamada de WhatsApp", media: null };
  return null;
}

/** Claves que son solo señalización interna de WhatsApp y nunca se muestran. */
const INTERNAS = new Set(["senderKeyDistributionMessage", "messageContextInfo", "keepInChatMessage", "pinInChatMessage", "pollUpdateMessage", "encReactionMessage", "encEventResponseMessage", "deviceSentMessage", "secretEncryptedMessage", "botFeedbackMessage", "scheduledCallEditMessage"]);

export function parsearMensaje(message: any): MensajeParseado {
  const m = desenvolver(message);
  if (!m || typeof m !== "object") return { kind: "ignorar" };

  if (m.reactionMessage?.key?.id) return { kind: "reaccion", objetivoId: m.reactionMessage.key.id, emoji: m.reactionMessage.text || "" };

  if (m.protocolMessage) {
    const p = m.protocolMessage;
    const objetivoId = p.key?.id;
    if (p.type === PROTOCOL_REVOKE && objetivoId) return { kind: "borrado", objetivoId };
    if (p.type === PROTOCOL_EDIT && objetivoId) {
      const nuevo = cuerpo(desenvolver(p.editedMessage) || {});
      if (nuevo?.contenido) return { kind: "edicion", objetivoId, contenido: nuevo.contenido };
    }
    return { kind: "ignorar" };
  }

  const c = cuerpo(m);
  if (c) {
    const ci = contextInfoDe(m);
    let cita: { id: string; preview: string } | null = null;
    if (ci?.stanzaId && ci?.quotedMessage) {
      const q = cuerpo(desenvolver(ci.quotedMessage) || {});
      cita = { id: ci.stanzaId, preview: q ? previewDe(q.tipo, q.contenido, { archivoNombre: q.media?.nombre }).slice(0, 160) : "Mensaje" };
    }
    return { kind: "mensaje", ...c, cita };
  }

  const claves = Object.keys(m).filter((k) => m[k] != null && !INTERNAS.has(k));
  if (!claves.length) return { kind: "ignorar" };
  // Algo que el CRM todavía no sabe mostrar: se dice claramente en vez de dejar una burbuja vacía.
  return { kind: "mensaje", tipo: "sistema", contenido: "Este tipo de mensaje no se puede mostrar aquí. Ábrelo en el teléfono.", media: null, cita: null };
}
