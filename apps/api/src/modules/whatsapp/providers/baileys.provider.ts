// Implementación real con Baileys (WhatsApp Web multi-device, QR). Vive SOLO en el proceso
// gozz-whatsapp-worker (whatsapp-worker.ts / whatsapp-connection-manager.ts) — ni las rutas HTTP
// ni whatsapp.service.ts ni las pruebas importan este archivo ni `@whiskeysockets/baileys`.
import makeWASocket, {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  generateMessageIDV2,
  BufferJSON,
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
import { aOggOpus } from "../audio-transcode.js";
import { parsearMensaje, type MediaInfo } from "../mensaje-parser.js";
import { createHash } from "crypto";
import type {
  WhatsAppProvider,
  WhatsAppOutgoingMessage,
  WhatsAppIncomingMessage,
  WhatsAppConnectionUpdate,
  WhatsAppMensajeModificado,
  WhatsAppChatInfo,
  WhatsAppMediaDescargada,
} from "./whatsapp-provider.interface.js";

/** Chats que nunca se muestran: estados (historias, Parte 4) y canales. */
const esJidIgnorado = (jid: string) => jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
const GRUPO_CACHE_TTL_MS = 60 * 60 * 1000;

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "silent" });

/** Mayor que el timeout de 25s del modal del frontend y que el connectTimeoutMs interno de
 * Baileys (20s) — si ninguno de los dos disparó un evento (qr/open/close) para entonces, algo se
 * colgó silenciosamente (p. ej. el handshake con los servidores de WhatsApp) y hay que forzar el
 * cierre para no dejar `connect()` bloqueado para siempre en esa conexión. */
const CONNECT_WATCHDOG_MS = 40_000;

/** Las URL de foto de perfil que da WhatsApp (pps.whatsapp.net) son FIRMADAS Y CADUCAN en días —
 * guardarlas tal cual era la causa de fotos rotas que caían a iniciales. Se descarga la imagen una
 * vez y se guarda en almacenamiento propio (disco + R2), con un nombre que incluye el hash del
 * contenido (cacheable como inmutable). El caché en memoria evita repetir la consulta por cada
 * mensaje del mismo contacto, pero expira para detectar cuando el contacto cambia su foto. */
const FOTO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FOTO_CACHE_MAX = 5000;
const FOTO_MAX_BYTES = 2 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".opus": "audio/ogg",
  ".pdf": "application/pdf",
};
function guessMime(filename: string): string {
  return EXT_MIME[path.extname(filename).toLowerCase()] || "application/octet-stream";
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
  private msgCbs: ((conexionId: string, msg: WhatsAppIncomingMessage) => void | Promise<void>)[] = [];
  private modCbs: ((conexionId: string, mod: WhatsAppMensajeModificado) => void)[] = [];
  private chatCbs: ((conexionId: string, chats: WhatsAppChatInfo[], opts: { historial: boolean }) => void | Promise<void>)[] = [];
  /** Nombre (asunto) de cada grupo, para no pedirlo a WhatsApp en cada mensaje. */
  private gruposCache = new Map<string, { nombre: string | null; at: number }>();
  private statusCbs: ((conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void)[] = [];
  private contactoCbs: ((conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }) => void)[] = [];
  /** Evita pedir la foto de perfil por cada mensaje del mismo jid — se resuelve una sola vez por
   * proceso (si falla o el usuario tiene la foto privada, se cachea `null` igual: reintentar en
   * cada mensaje entrante no vale la pena). */
  private fotoPerfilCache = new Map<string, { url: string | null; at: number }>();
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
      // Navegador "de escritorio" + historial completo: así, al vincular el número, WhatsApp manda
      // TODOS los chats con su historial (como WhatsApp Web), no solo lo que llegue desde ese
      // momento. Solo surte efecto en una vinculación nueva (escanear el QR).
      browser: Browsers.macOS("Desktop"),
      syncFullHistory: true,
      markOnlineOnConnect: false,
    });
    this.sockets.set(conexionId, sock);

    // Número real detrás de un `@lid`. Baileys 6.x descarta el atributo `sender_pn` que WhatsApp
    // manda en el paquete crudo de cada mensaje (y `participant_pn` en grupos, `peer_recipient_pn`
    // en lo que mandamos desde el teléfono). Se lee aquí, antes de que Baileys descifre el mensaje,
    // así el directorio ya lo tiene cuando se procesa: sin esto, 5 de 13 conversaciones de la base
    // local mostraban "Número no disponible".
    (sock.ws as any).on?.("CB:message", (node: any) => {
      const a = node?.attrs || {};
      const pares: [string | undefined, string | undefined][] = [
        [a.from, a.sender_pn], [a.participant, a.participant_pn], [a.recipient, a.peer_recipient_pn || a.recipient_pn],
      ];
      for (const [lid, pn] of pares) {
        if (lid?.endsWith("@lid") && pn?.endsWith("@s.whatsapp.net")) this.registrarContacto(conexionId, { lid, id: pn });
      }
    });

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
          await this.handleIncoming(conexionId, sock, msg, { historico: false });
        } catch (e: any) {
          console.error(`[baileys ${conexionId}] error procesando mensaje entrante:`, e?.message);
        }
      }
    });

    // Historial completo al vincular: chats (con nombre, no leídos y archivados) y sus mensajes.
    // Se procesa en orden y esperando cada paso: pueden ser miles de mensajes y el worker no debe
    // saturar la base. La media del historial NO se descarga aquí (se baja al abrirla).
    sock.ev.on("messaging-history.set", async ({ chats, contacts, messages }) => {
      try {
        if (contacts?.length) contacts.forEach((c: any) => this.registrarContacto(conexionId, c));
        const infos: WhatsAppChatInfo[] = (chats || [])
          .filter((c: any) => c.id && !esJidIgnorado(c.id))
          .map((c: any) => ({
            jid: c.id,
            nombre: c.name || c.subject || this.dirDe(conexionId).get(c.id)?.nombre || null,
            esGrupo: c.id.endsWith("@g.us"),
            noLeidos: Math.max(0, Number(c.unreadCount) || 0),
            archivado: !!c.archived,
            jidReal: this.dirDe(conexionId).get(c.id)?.jidReal ?? null,
          }));
        for (const cb of this.chatCbs) await cb(conexionId, infos, { historial: true });
        const ordenados = [...(messages || [])].sort((x, y) => Number(x.messageTimestamp || 0) - Number(y.messageTimestamp || 0));
        for (const msg of ordenados) {
          try { await this.handleIncoming(conexionId, sock, msg, { historico: true }); } catch (e: any) {
            console.error(`[baileys ${conexionId}] historial: no se pudo importar un mensaje:`, e?.message);
          }
        }
        console.log(`[baileys ${conexionId}] historial importado: ${infos.length} chats, ${ordenados.length} mensajes`);
      } catch (e: any) {
        console.error(`[baileys ${conexionId}] error importando historial:`, e?.message);
      }
    });

    // Cambios de nombre de un grupo.
    sock.ev.on("groups.update", (updates: any[]) => {
      const infos = updates.filter((g) => g.id && g.subject).map((g) => {
        this.gruposCache.set(`${conexionId}:${g.id}`, { nombre: g.subject, at: Date.now() });
        return { jid: g.id, nombre: g.subject, esGrupo: true } as WhatsAppChatInfo;
      });
      if (infos.length) this.chatCbs.forEach((cb) => cb(conexionId, infos, { historial: false }));
    });

    // Confirmaciones de entrega/lectura de mensajes YA enviados — sin esto el doble-check gris y
    // el azul de "leído" nunca aparecen, sin importar cuánto se espere (el envío solo confirma
    // "enviado", un único check).
    sock.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        if (!u.key.fromMe) continue; // solo importan los checks de lo que ENVIAMOS
        const waMessageId = u.key.id;
        const estado = estadoDesdeStatus(u.update.status as unknown as number);
        if (waMessageId && estado) this.statusCbs.forEach((cb) => cb(conexionId, waMessageId, estado));
      }
    });
    // Algunos acuses (sobre todo "leído" cuando el contacto abre el chat en otro dispositivo)
    // llegan como recibo y no como `messages.update` — sin escucharlos, el azul a veces no aparece.
    sock.ev.on("message-receipt.update", (updates) => {
      for (const u of updates) {
        if (!u.key.fromMe || !u.key.id) continue;
        const r = u.receipt;
        const estado: WhatsAppMensajeEstado | null = r.readTimestamp || r.playedTimestamp ? "leido" : r.receiptTimestamp ? "entregado" : null;
        if (estado) this.statusCbs.forEach((cb) => cb(conexionId, u.key.id!, estado));
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
    sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      this.registrarContacto(conexionId, { lid, id: jid });
    });
  }

  private async fetchFotoPerfil(conexionId: string, sock: WASocket, jid: string, forzar = false): Promise<string | null> {
    const cacheKey = `${conexionId}:${jid}`;
    const enCache = this.fotoPerfilCache.get(cacheKey);
    if (!forzar && enCache && Date.now() - enCache.at < FOTO_CACHE_TTL_MS) return enCache.url;

    const cdnUrl = await sock.profilePictureUrl(jid, "image").catch(() => undefined);
    const propia = cdnUrl ? await this.persistirFoto(conexionId, jid, cdnUrl) : null;

    this.fotoPerfilCache.delete(cacheKey);
    this.fotoPerfilCache.set(cacheKey, { url: propia, at: Date.now() });
    if (this.fotoPerfilCache.size > FOTO_CACHE_MAX) {
      const masVieja = this.fotoPerfilCache.keys().next().value;
      if (masVieja) this.fotoPerfilCache.delete(masVieja);
    }
    return propia;
  }

  /** Descarga la foto del CDN de WhatsApp y la guarda como archivo propio. Devuelve la URL propia
   * (`/uploads/...`), o null si no se pudo — nunca la URL del CDN, que caduca. */
  private async persistirFoto(conexionId: string, jid: string, cdnUrl: string): Promise<string | null> {
    try {
      const r = await fetch(cdnUrl, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > FOTO_MAX_BYTES) return null;
      const jidHash = createHash("sha1").update(jid).digest("hex").slice(0, 16);
      const contenidoHash = createHash("sha1").update(buf).digest("hex").slice(0, 12);
      const dirRel = `whatsapp/avatares/${shard(conexionId)}/${conexionId}`;
      const filename = `${jidHash}-${contenidoHash}.jpg`;
      const url = `/uploads/${dirRel}/${filename}`;
      const abs = path.join(UPLOADS_ROOT, dirRel, filename);
      if (!fs.existsSync(abs)) {
        await fs.promises.mkdir(path.dirname(abs), { recursive: true });
        await fs.promises.writeFile(abs, buf);
        putUploadedBytesToR2(url, buf, "image/jpeg").catch((e: any) =>
          console.error(`[baileys ${conexionId}] no se pudo subir la foto de perfil a R2:`, e?.message)
        );
      }
      return url;
    } catch (e: any) {
      console.error(`[baileys ${conexionId}] no se pudo descargar la foto de perfil:`, e?.message);
      return null;
    }
  }

  /** Versión pública, para resolver bajo demanda (whatsapp-connection-manager.ts) una conversación
   * que no tiene foto porque no tuvo actividad desde que se agregó esta función. */
  async resolverFotoPerfil(conexionId: string, jid: string, forzar = false): Promise<string | null> {
    const sock = this.sockets.get(conexionId);
    if (!sock) return null;
    return this.fetchFotoPerfil(conexionId, sock, jid, forzar);
  }

  /** Confirmaciones de lectura hacia WhatsApp (los checks azules que ve el contacto) — igual que
   * WhatsApp Web al abrir un chat. Best-effort: si la conexión no está activa, no pasa nada. */
  generarIdMensaje(conexionId: string): string {
    return generateMessageIDV2(this.sockets.get(conexionId)?.user?.id);
  }

  async marcarLeidos(conexionId: string, jid: string, waMessageIds: string[]): Promise<void> {
    const sock = this.sockets.get(conexionId);
    if (!sock || !waMessageIds.length) return;
    await sock.readMessages(waMessageIds.map((id) => ({ remoteJid: jid, id, fromMe: false })));
  }

  private async nombreGrupo(conexionId: string, sock: WASocket, jid: string): Promise<string | null> {
    const k = `${conexionId}:${jid}`;
    const c = this.gruposCache.get(k);
    if (c && Date.now() - c.at < GRUPO_CACHE_TTL_MS) return c.nombre;
    const meta = await sock.groupMetadata(jid).catch(() => null);
    const nombre = meta?.subject || null;
    this.gruposCache.set(k, { nombre, at: Date.now() });
    return nombre;
  }

  /** Guarda un adjunto entrante como archivo propio (disco + R2) y devuelve su URL. */
  private async guardarMedia(conexionId: string, waMessageId: string, media: MediaInfo, buffer: Buffer) {
    // Adjuntos entrantes no pertenecen todavía a una conversación resuelta en BD (puede ser la
    // primera vez que escribe este contacto): se archivan por conexión. Async a propósito: este
    // worker sostiene TODAS las conexiones en un solo proceso.
    const dirRel = `whatsapp/entrantes/${shard(conexionId)}/${conexionId}`;
    await fs.promises.mkdir(path.join(UPLOADS_ROOT, dirRel), { recursive: true });
    const ext = media.tipo === "image" ? ".jpg" : media.tipo === "sticker" ? ".webp" : media.tipo === "video" ? ".mp4" : media.tipo === "audio" ? ".ogg" : path.extname(media.nombre || "") || ".bin";
    const filename = `${Date.now()}_${waMessageId.replace(/[^a-zA-Z0-9]/g, "")}${ext}`;
    await fs.promises.writeFile(path.join(UPLOADS_ROOT, dirRel, filename), buffer);
    const archivoUrl = `/uploads/${dirRel}/${filename}`;
    // Best-effort: si R2 falla el mensaje no se descarta (queda en disco local hasta el redeploy).
    putUploadedBytesToR2(archivoUrl, buffer, media.mimetype || undefined).catch((e: any) =>
      console.error(`[baileys ${conexionId}] no se pudo subir el adjunto a R2 (queda solo en disco local):`, e?.message)
    );
    return { archivoUrl, archivoNombre: media.nombre || filename, archivoTipo: media.mimetype?.split(";")[0] || guessMime(filename), archivoTamanio: buffer.length };
  }

  private async handleIncoming(conexionId: string, sock: WASocket, msg: WAMessage, opts: { historico: boolean }): Promise<void> {
    const jid = msg.key.remoteJid;
    if (!jid || esJidIgnorado(jid) || !msg.message) return;
    const waMessageId = msg.key.id;
    if (!waMessageId) return;
    const esGrupo = jid.endsWith("@g.us");
    const fromMe = !!msg.key.fromMe;

    const p = parsearMensaje(msg.message);
    if (p.kind === "ignorar") return;
    if (p.kind !== "mensaje") {
      // Reacción, borrado o edición: modifican un mensaje que ya existe, no son uno nuevo.
      const autor = fromMe ? "yo" : (msg.key.participant || jid);
      const mod: WhatsAppMensajeModificado =
        p.kind === "reaccion" ? { jid, tipo: "reaccion", objetivoId: p.objetivoId, emoji: p.emoji, autor }
        : p.kind === "borrado" ? { jid, tipo: "borrado", objetivoId: p.objetivoId, autor }
        : { jid, tipo: "edicion", objetivoId: p.objetivoId, contenido: p.contenido, autor };
      this.modCbs.forEach((cb) => cb(conexionId, mod));
      return;
    }

    let archivo: { archivoUrl: string | null; archivoNombre: string | null; archivoTipo: string | null; archivoTamanio: number | null } = {
      archivoUrl: null, archivoNombre: p.media?.nombre ?? null, archivoTipo: p.media?.mimetype ?? null, archivoTamanio: p.media?.tamanio ?? null,
    };
    let mediaMeta: string | null = null;
    if (p.media) {
      // Lo necesario para bajar la media más tarde (ver `descargarMedia`): el historial no se
      // descarga de entrada, y una descarga en vivo que falla se puede reintentar al abrirla.
      mediaMeta = JSON.stringify({ key: msg.key, message: msg.message, messageTimestamp: msg.messageTimestamp }, BufferJSON.replacer);
      if (!opts.historico) {
        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Buffer;
          archivo = await this.guardarMedia(conexionId, waMessageId, p.media, buffer);
        } catch (e: any) {
          console.error(`[baileys ${conexionId}] no se pudo descargar el adjunto de ${waMessageId} (se podrá reintentar):`, e?.message);
        }
      }
    }

    // Las fotos del historial se resuelven después, al listar (cientos de chats a la vez
    // dispararían el límite de WhatsApp).
    const fotoPerfilUrl = opts.historico ? undefined : await this.fetchFotoPerfil(conexionId, sock, jid);
    const dir = this.dirDe(conexionId);
    const contacto = dir.get(jid);
    const autorJid = esGrupo && !fromMe ? msg.key.participant || null : null;
    const autorInfo = autorJid ? dir.get(autorJid) : undefined;
    // OJO: `msg.pushName` en un mensaje `fromMe` es el nombre de la CUENTA CONECTADA (el vendedor),
    // no el del contacto: usarlo nombraba conversaciones con el nombre del propio dueño. En un grupo,
    // el pushName es el de quien escribió, no el del grupo.
    const nombrePerfil = esGrupo
      ? await this.nombreGrupo(conexionId, sock, jid)
      : contacto?.nombre || (!fromMe ? msg.pushName || null : null) || (msg as any).verifiedBizName || null;

    const payload: WhatsAppIncomingMessage = {
      jid, waMessageId, tipo: p.tipo, contenido: p.contenido,
      ...archivo,
      timestamp: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000),
      nombrePerfil,
      fromMe,
      fotoPerfilUrl,
      jidReal: esGrupo ? null : contacto?.jidReal ?? null,
      esGrupo,
      autorJid,
      autorNombre: autorJid ? autorInfo?.nombre || msg.pushName || null : null,
      autorJidReal: autorJid ? autorInfo?.jidReal ?? null : null,
      respuestaA: p.cita?.id ?? null,
      respuestaPreview: p.cita?.preview ?? null,
      mediaMeta,
      historico: opts.historico,
    };
    for (const cb of this.msgCbs) await cb(conexionId, payload);
  }

  /** Baja la media de un mensaje guardado sin archivo (historial, o descarga fallida). Si el
   * archivo ya caducó en los servidores de WhatsApp, pide al teléfono que lo vuelva a subir. */
  async descargarMedia(conexionId: string, mediaMeta: string): Promise<WhatsAppMediaDescargada> {
    const sock = this.sockets.get(conexionId);
    if (!sock) throw new Error("La conexión de WhatsApp no está activa");
    const msg = JSON.parse(mediaMeta, BufferJSON.reviver) as WAMessage;
    const p = parsearMensaje(msg.message);
    if (p.kind !== "mensaje" || !p.media) throw new Error("Ese mensaje no tiene media");
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Buffer;
    const r = await this.guardarMedia(conexionId, msg.key.id || "media", p.media, buffer);
    return { archivoUrl: r.archivoUrl, archivoNombre: r.archivoNombre, archivoTipo: r.archivoTipo, archivoTamanio: r.archivoTamanio };
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
      else if (msg.tipo === "audio") {
        // Siempre como nota de voz (PTT) en OGG/Opus — el único formato que WhatsApp reproduce
        // como tal. Ver audio-transcode.ts para por qué el webm/m4a del navegador no sirve.
        const { buffer: ogg, segundos } = await aOggOpus(buffer);
        content = { audio: ogg, mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: segundos };
      }
      else content = { document: buffer, fileName: msg.archivoNombre || filename, mimetype: guessMime(filename), caption: msg.contenido || undefined };
    } else {
      throw new Error("Mensaje sin contenido ni archivo");
    }

    const sent = await sock.sendMessage(msg.jid, content, msg.waMessageId ? { messageId: msg.waMessageId } : undefined);
    if (!sent?.key?.id) throw new Error("WhatsApp no confirmó el envío");
    return { waMessageId: sent.key.id };
  }

  onQr(cb: (conexionId: string, qr: string) => void): void { this.qrCbs.push(cb); }
  onConnectionUpdate(cb: (conexionId: string, update: WhatsAppConnectionUpdate) => void): void { this.stateCbs.push(cb); }
  onMessage(cb: (conexionId: string, msg: WhatsAppIncomingMessage) => void | Promise<void>): void { this.msgCbs.push(cb); }
  onMensajeModificado(cb: (conexionId: string, mod: WhatsAppMensajeModificado) => void): void { this.modCbs.push(cb); }
  onChats(cb: (conexionId: string, chats: WhatsAppChatInfo[], opts: { historial: boolean }) => void | Promise<void>): void { this.chatCbs.push(cb); }
  onMessageStatusUpdate(cb: (conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void): void { this.statusCbs.push(cb); }
  onContactoResuelto(cb: (conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }) => void): void { this.contactoCbs.push(cb); }
}
