// Implementación real con Baileys (WhatsApp Web multi-device, QR). Vive SOLO en el proceso
// gozz-whatsapp-worker (whatsapp-worker.ts / whatsapp-connection-manager.ts) — ni las rutas HTTP
// ni whatsapp.service.ts ni las pruebas importan este archivo ni `@whiskeysockets/baileys`.
import makeWASocket, {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import fs from "fs";
import { UPLOADS_ROOT, shard, uploadUrlToAbsPath } from "../../../lib/storage.js";
import { usePostgresAuthState, clearAuthState } from "./postgres-auth-state.js";
import type {
  WhatsAppProvider,
  WhatsAppOutgoingMessage,
  WhatsAppIncomingMessage,
  WhatsAppConnectionUpdate,
} from "./whatsapp-provider.interface.js";

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "silent" });

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

export class BaileysWhatsAppProvider implements WhatsAppProvider {
  private sockets = new Map<string, WASocket>();
  private qrCbs: ((conexionId: string, qr: string) => void)[] = [];
  private stateCbs: ((conexionId: string, update: WhatsAppConnectionUpdate) => void)[] = [];
  private msgCbs: ((conexionId: string, msg: WhatsAppIncomingMessage) => void)[] = [];

  async connect(conexionId: string): Promise<void> {
    if (this.sockets.has(conexionId)) return;
    const { state, saveCreds } = await usePostgresAuthState(conexionId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: Browsers.appropriate("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    this.sockets.set(conexionId, sock);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
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
        fs.mkdirSync(dirAbs, { recursive: true });
        const ext = media.tipo === "image" ? ".jpg" : media.tipo === "video" ? ".mp4" : media.tipo === "audio" ? ".ogg" : path.extname(media.nombre || "") || ".bin";
        const filename = `${Date.now()}_${waMessageId.replace(/[^a-zA-Z0-9]/g, "")}${ext}`;
        fs.writeFileSync(path.join(dirAbs, filename), buffer);
        archivoUrl = `/uploads/${dirRel}/${filename}`;
        archivoNombre = media.nombre || filename;
        archivoTipo = guessMime(filename);
      } catch (e: any) {
        console.error(`[baileys ${conexionId}] no se pudo descargar el adjunto de ${waMessageId}:`, e?.message);
      }
    }

    this.msgCbs.forEach((cb) => cb(conexionId, {
      jid, waMessageId, tipo, contenido, archivoUrl, archivoNombre, archivoTipo,
      timestamp: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000),
      nombrePerfil: msg.pushName || null,
      fromMe: !!msg.key.fromMe,
    }));
  }

  async disconnect(conexionId: string): Promise<void> {
    const sock = this.sockets.get(conexionId);
    this.sockets.delete(conexionId);
    if (!sock) return;
    try { await sock.logout(); } catch { /* ya pudo estar cerrado */ }
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
      const buffer = fs.readFileSync(uploadUrlToAbsPath(msg.archivoUrl));
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
}
