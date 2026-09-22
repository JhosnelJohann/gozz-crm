// Implementación real con Baileys (WhatsApp Web multi-device, QR). Vive SOLO en el proceso
// gozz-whatsapp-worker (whatsapp-worker.ts / whatsapp-connection-manager.ts) — ni las rutas HTTP
// ni whatsapp.service.ts ni las pruebas importan este archivo ni `@whiskeysockets/baileys`.
import makeWASocket, {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  proto,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import fs from "fs";
import type { WhatsAppMensajeEstado } from "@gozz/shared-types";
import { UPLOADS_ROOT, shard, readUploadedFileBytes, putUploadedBytesToR2 } from "../../../lib/storage.js";
import { usePostgresAuthState, clearAuthState } from "./postgres-auth-state.js";
import type {
  WhatsAppProvider,
  WhatsAppOutgoingMessage,
  WhatsAppIncomingMessage,
  WhatsAppConnectionUpdate,
} from "./whatsapp-provider.interface.js";

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "silent" });

/** Mayor que el timeout de 25s del modal del frontend y que el connectTimeoutMs interno de
 * Baileys (20s) — si ninguno de los dos disparó un evento (qr/open/close) para entonces, algo se
 * colgó silenciosamente (p. ej. el handshake con los servidores de WhatsApp) y hay que forzar el
 * cierre para no dejar `connect()` bloqueado para siempre en esa conexión. */
const CONNECT_WATCHDOG_MS = 40_000;

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".opus": "audio/ogg",
  ".pdf": "application/pdf",
};
function guessMime(filename: string): string {
  return EXT_MIME[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

function extractContent(msg: WAMessage): {
  tipo: WhatsAppIncomingMessage["tipo"];
  contenido: string | null;
  media: { tipo: "image" | "video" | "audio" | "document"; nombre: string | null } | null;
} {
  const m = msg.message;
  if (!m) return { tipo: "sistema", contenido: null, media: null };
  if (m.conversation) return { tipo: "texto", contenido: m.conversation, media: null };
  if (m.extendedTextMessage?.text) return { tipo: "texto", contenido: m.extendedTextMessage.text, media: null };
  if (m.imageMessage) return { tipo: "imagen", contenido: m.imageMessage.caption || null, media: { tipo: "image", nombre: null } };
  if (m.videoMessage) return { tipo: "video", contenido: m.videoMessage.caption || null, media: { tipo: "video", nombre: null } };
  if (m.audioMessage) return { tipo: "audio", contenido: null, media: { tipo: "audio", nombre: null } };
  if (m.documentMessage) {
    return { tipo: "archivo", contenido: m.documentMessage.caption || null, media: { tipo: "document", nombre: m.documentMessage.fileName || "documento" } };
  }
  return { tipo: "sistema", contenido: null, media: null };
}

/** SERVER_ACK(2) se queda como "ya lo tenemos como enviado" — no hace falta notificar. */
function estadoDesdeStatus(status: number | null | undefined): WhatsAppMensajeEstado | null {
  if (status === proto.WebMessageInfo.Status.DELIVERY_ACK) return "entregado";
  if (status === proto.WebMessageInfo.Status.READ || status === proto.WebMessageInfo.Status.PLAYED) return "leido";
  return null;
}

export class BaileysWhatsAppProvider implements WhatsAppProvider {
  private sockets = new Map<string, WASocket>();
  /** Watchdog por conexión (ver CONNECT_WATCHDOG_MS) — se cancela en cuanto llega el primer
   * evento definitivo (qr/open/close) o si `disconnect()` se adelanta. */
  private connectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private qrCbs: ((conexionId: string, qr: string) => void)[] = [];
  private stateCbs: ((conexionId: string, update: WhatsAppConnectionUpdate) => void)[] = [];
  private msgCbs: ((conexionId: string, msg: WhatsAppIncomingMessage) => void)[] = [];
  private statusCbs: ((conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void)[] = [];
  private contactoCbs: ((conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }) => void)[] = [];
  /** Evita pedir la foto de perfil por cada mensaje del mismo jid — se resuelve una sola vez por
   * proceso (si falla o el usuario tiene la foto privada, se cachea `null` igual: reintentar en
   * cada mensaje entrante no vale la pena). */
  private fotoPerfilCache = new Map<string, string | null>();
  /** Directorio de contactos por conexión: mapea tanto el `@lid` como el número real de un
   * contacto a su nombre guardado en el teléfono y al número real (cuando WhatsApp lo revela vía
   * `contacts.*`/`chats.phoneNumberShare`). Ni Baileys ni WhatsApp garantizan esto por adelantado
   * ni bajo pedido — llega solo, de forma asíncrona, cuando llega. */
  private contactDirs = new Map<string, Map<string, { jidReal?: string; nombre?: string }>>();

  private dirDe(conexionId: string): Map<string, { jidReal?: string; nombre?: string }> {
    let dir = this.contactDirs.get(conexionId);
    if (!dir) { dir = new Map(); this.contactDirs.set(conexionId, dir); }
    return dir;
  }

  private registrarContacto(conexionId: string, c: { id?: string; lid?: string; name?: string; notify?: string }): void {
    if (!c.id && !c.lid) return;
    const dir = this.dirDe(conexionId);
    const nombre = c.name || c.notify || undefined;
    if (c.lid) {
      const previo = dir.get(c.lid) || {};
      const info = { jidReal: c.id ?? previo.jidReal, nombre: nombre ?? previo.nombre };
      dir.set(c.lid, info);
      if (info.jidReal || info.nombre) this.contactoCbs.forEach((cb) => cb(conexionId, c.lid!, info));
    }
    if (c.id) {
      const previo = dir.get(c.id) || {};
      dir.set(c.id, { jidReal: previo.jidReal, nombre: nombre ?? previo.nombre });
    }
  }

  async connect(conexionId: string): Promise<void> {
    if (this.sockets.has(conexionId)) return;
    const { state, saveCreds } = await usePostgresAuthState(conexionId);
    // { timeout: 5000 }: sin esto, axios no tiene límite de tiempo y esta petición a GitHub
    // puede colgarse indefinidamente si el egress de Railway es lento — dejando "Conectar
    // WhatsApp" atascado para siempre sin emitir ni un solo evento. La librería ya cae a su
    // versión empaquetada ante cualquier error (incluido un timeout), así que esto es puramente
    // aditivo.
    const { version } = await fetchLatestBaileysVersion({ timeout: 5000 });

    const sock = makeWASocket({
      version,
      logger,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: Browsers.appropriate("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    this.sockets.set(conexionId, sock);

    const watchdog = setTimeout(() => {
      this.connectTimers.delete(conexionId);
      if (this.sockets.get(conexionId) !== sock) return; // ya se resolvió, se reemplazó o se desconectó
      sock.end(new Error("Tiempo de espera agotado esperando respuesta de WhatsApp"));
    }, CONNECT_WATCHDOG_MS);
    this.connectTimers.set(conexionId, watchdog);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr || connection === "open" || connection === "close") {
        const t = this.connectTimers.get(conexionId);
        if (t) { clearTimeout(t); this.connectTimers.delete(conexionId); }
      }
      if (qr) this.qrCbs.forEach((cb) => cb(conexionId, qr));

      if (connection === "open") {
        const telefono = sock.user?.id ? sock.user.id.split(":")[0].split("@")[0] : undefined;
        this.stateCbs.forEach((cb) => cb(conexionId, { estado: "conectado", telefono }));
      } else if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        this.sockets.delete(conexionId);
        if (loggedOut) {
          clearAuthState(conexionId).catch(() => {});
          this.stateCbs.forEach((cb) => cb(conexionId, { estado: "desconectado", motivoError: "Dispositivo desvinculado desde el teléfono" }));
        } else {
          const motivo = lastDisconnect?.error?.message || "Conexión cerrada";
          this.stateCbs.forEach((cb) => cb(conexionId, { estado: "error", motivoError: motivo }));
          // Reconexión automática ante un corte de red (no ante un logout explícito) — la
          // sesión sigue siendo válida, solo se cayó el socket.
          setTimeout(() => { this.connect(conexionId).catch((e) => console.error(`[baileys ${conexionId}] reconexión falló:`, e?.message)); }, 5000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        try {
          await this.handleIncoming(conexionId, sock, msg);
        } catch (e: any) {
          console.error(`[baileys ${conexionId}] error procesando mensaje entrante:`, e?.message);
        }
      }
    });

    // Confirmaciones de entrega/lectura de mensajes YA enviados — sin esto el doble-check gris y
    // el azul de "leído" nunca aparecen, sin importar cuánto se espere (el envío solo confirma
    // "enviado", un único check).
    sock.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        const waMessageId = u.key.id;
        const estado = estadoDesdeStatus(u.update.status as unknown as number);
        if (waMessageId && estado) this.statusCbs.forEach((cb) => cb(conexionId, waMessageId, estado));
      }
    });

    // Directorio de contactos: el nombre que el dueño de la conexión tiene guardado para ese
    // contacto en su teléfono (más confiable que el "pushName" que el propio contacto se puso), y
    // el número real detrás de un `@lid` cuando WhatsApp llega a compartirlo. Ninguno de estos
    // eventos es pedible bajo demanda — llegan solos, en cualquier momento tras conectar.
    const onContactos = (cs: { id?: string; lid?: string; name?: string; notify?: string }[]) => {
      cs.forEach((c) => this.registrarContacto(conexionId, c));
    };
    sock.ev.on("contacts.upsert", onContactos);
    sock.ev.on("contacts.update", onContactos);
    sock.ev.on("messaging-history.set", ({ contacts }) => { if (contacts) onContactos(contacts); });
    sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      this.registrarContacto(conexionId, { lid, id: jid });
    });
  }

  private async fetchFotoPerfil(sock: WASocket, jid: string): Promise<string | null> {
    if (this.fotoPerfilCache.has(jid)) return this.fotoPerfilCache.get(jid)!;
    const url = await sock.profilePictureUrl(jid, "image").catch(() => undefined);
    const resuelta = url ?? null;
    this.fotoPerfilCache.set(jid, resuelta);
    return resuelta;
  }

  /** Versión pública, para resolver bajo demanda (whatsapp-connection-manager.ts) una conversación
   * que no tiene foto porque no tuvo actividad desde que se agregó esta función. */
  async resolverFotoPerfil(conexionId: string, jid: string): Promise<string | null> {
    const sock = this.sockets.get(conexionId);
    if (!sock) return null;
    return this.fetchFotoPerfil(sock, jid);
  }

  private async handleIncoming(conexionId: string, sock: WASocket, msg: WAMessage): Promise<void> {
    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast" || !msg.message) return; // grupos/status fuera de alcance del MVP
    const waMessageId = msg.key.id;
    if (!waMessageId) return;

    const { tipo, contenido, media } = extractContent(msg);
    let archivoUrl: string | null = null;
    let archivoNombre: string | null = null;
    let archivoTipo: string | null = null;

    if (media) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {});
        // Adjuntos entrantes no pertenecen todavía a una conversación resuelta en BD (puede ser
        // la primera vez que escribe este contacto) — se archivan por conexión, no por
        // conversación. La reorganización por conversación es propia de los ADJUNTOS SALIENTES
        // que el composer sube (ver "whatsapp_mensaje" en lib/storage.ts + whatsapp.routes.ts).
        const dirRel = `whatsapp/entrantes/${shard(conexionId)}/${conexionId}`;
        const dirAbs = path.join(UPLOADS_ROOT, dirRel);
        // Async a propósito: este worker sostiene TODAS las conexiones activas en un solo proceso
        // — una escritura síncrona aquí congelaría el event loop (y con él, cualquier otra
        // conexión de WhatsApp) mientras se guarda un adjunto grande.
        await fs.promises.mkdir(dirAbs, { recursive: true });
        const ext = media.tipo === "image" ? ".jpg" : media.tipo === "video" ? ".mp4" : media.tipo === "audio" ? ".ogg" : path.extname(media.nombre || "") || ".bin";
        const filename = `${Date.now()}_${waMessageId.replace(/[^a-zA-Z0-9]/g, "")}${ext}`;
        await fs.promises.writeFile(path.join(dirAbs, filename), buffer);
        archivoUrl = `/uploads/${dirRel}/${filename}`;
        archivoNombre = media.nombre || filename;
        archivoTipo = guessMime(filename);
        // Best-effort: si R2 falla acá NO se descarta el mensaje entrante (a diferencia de las
        // subidas por HTTP en lib/storage.ts, que fallan ruidoso) — queda solo en disco local de
        // este servicio hasta el próximo redeploy, mejor que perder el mensaje completo.
        putUploadedBytesToR2(archivoUrl, buffer).catch((e: any) =>
          console.error(`[baileys ${conexionId}] no se pudo subir el adjunto a R2 (queda solo en disco local):`, e?.message)
        );
      } catch (e: any) {
        console.error(`[baileys ${conexionId}] no se pudo descargar el adjunto de ${waMessageId}:`, e?.message);
      }
    }

    const fotoPerfilUrl = await this.fetchFotoPerfil(sock, jid);
    const fromMe = !!msg.key.fromMe;
    const contacto = this.dirDe(conexionId).get(jid);
    // OJO: `msg.pushName` en un mensaje `fromMe` es el nombre de la CUENTA CONECTADA (el vendedor),
    // no el del contacto — usarlo aquí sin este chequeo fue el bug que nombraba conversaciones con
    // el propio nombre del dueño de la conexión cuando el primer mensaje del hilo lo mandó él desde
    // el teléfono, antes de que el contacto respondiera. El directorio de contactos (nombre
    // guardado en el teléfono) es siempre más confiable que cualquiera de los dos pushName cuando
    // está disponible.
    const nombrePerfil = contacto?.nombre || (!fromMe ? msg.pushName || null : null) || null;

    this.msgCbs.forEach((cb) => cb(conexionId, {
      jid, waMessageId, tipo, contenido, archivoUrl, archivoNombre, archivoTipo,
      timestamp: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000),
      nombrePerfil,
      fromMe,
      fotoPerfilUrl,
      jidReal: contacto?.jidReal ?? null,
    }));
  }

  async disconnect(conexionId: string): Promise<void> {
    const t = this.connectTimers.get(conexionId);
    if (t) { clearTimeout(t); this.connectTimers.delete(conexionId); }
    const sock = this.sockets.get(conexionId);
    this.sockets.delete(conexionId);
    if (!sock) return;
    try {
      // Acotado: sock.logout() puede colgarse si el transporte ya está en mal estado (el
      // timeout interno de Baileys para esto es 60s) — sin límite, deja un socket zombie vivo
      // en el proceso del worker en vez de liberarlo de inmediato.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Tiempo de espera agotado cerrando sesión")), 7000);
        sock.logout().then(() => { clearTimeout(timer); resolve(); }, (e) => { clearTimeout(timer); reject(e); });
      });
    } catch { /* ya pudo estar cerrado, o no respondió a tiempo */ }
    try { sock.end(undefined); } catch {}
    await clearAuthState(conexionId);
  }

  async sendMessage(conexionId: string, msg: WhatsAppOutgoingMessage): Promise<{ waMessageId: string }> {
    const sock = this.sockets.get(conexionId);
    if (!sock) throw new Error("La conexión de WhatsApp no está activa");

    let content: any;
    if (msg.tipo === "texto") {
      content = { text: msg.contenido || "" };
    } else if (msg.archivoUrl) {
      // R2 primero (adjunto puede haber sido subido por el servicio `api`, no por este worker —
      // filesystems ephemeral separados en Railway), disco local como respaldo.
      const buffer = await readUploadedFileBytes(msg.archivoUrl);
      const filename = path.basename(msg.archivoUrl);
      if (msg.tipo === "imagen") content = { image: buffer, caption: msg.contenido || undefined };
      else if (msg.tipo === "video") content = { video: buffer, caption: msg.contenido || undefined };
      else if (msg.tipo === "audio") content = { audio: buffer, mimetype: guessMime(filename), ptt: false };
      else content = { document: buffer, fileName: msg.archivoNombre || filename, mimetype: guessMime(filename), caption: msg.contenido || undefined };
    } else {
      throw new Error("Mensaje sin contenido ni archivo");
    }

    const sent = await sock.sendMessage(msg.jid, content);
    if (!sent?.key?.id) throw new Error("WhatsApp no confirmó el envío");
    return { waMessageId: sent.key.id };
  }

  onQr(cb: (conexionId: string, qr: string) => void): void { this.qrCbs.push(cb); }
  onConnectionUpdate(cb: (conexionId: string, update: WhatsAppConnectionUpdate) => void): void { this.stateCbs.push(cb); }
  onMessage(cb: (conexionId: string, msg: WhatsAppIncomingMessage) => void): void { this.msgCbs.push(cb); }
  onMessageStatusUpdate(cb: (conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void): void { this.statusCbs.push(cb); }
  onContactoResuelto(cb: (conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }) => void): void { this.contactoCbs.push(cb); }
}
