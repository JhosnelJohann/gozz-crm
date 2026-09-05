import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import sanitizeHtml from "sanitize-html";
import multer from "multer";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { encrypt, decrypt } from "./lib/crypto.js";
import { sendPushToUsers } from "./push.js";
import { cambiarPropietario, notificarNuevoPropietario, resolverPropietarioAlCrear } from "./lib/buzon-propietario.js";
import { cambiarPermisoAcl } from "./lib/buzon-acl.js";
import { esAdminEnBase } from "./lib/permisos.js";

const emailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }
});

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

interface BuzonRow {
  id: string; owner_user_id: string; email: string; display_name: string | null;
  imap_host: string; imap_port: number; imap_ssl: boolean; imap_user: string; imap_password_enc: string | null;
  smtp_host: string; smtp_port: number; smtp_ssl: boolean; smtp_user: string | null; smtp_password_enc: string | null;
  activo: boolean; sync_uid_next: number | null; import_desde_dias: number;
  errores_consecutivos?: number;
  auth_type?: string;
  oauth_provider?: string | null;
  oauth_refresh_token_enc?: string | null;
  oauth_access_token_enc?: string | null;
  oauth_token_expires_at?: string | null;
}

function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: { "*": ["href", "name", "target", "src", "alt", "style", "class", "title"] },
    allowedSchemes: ["http", "https", "data", "mailto", "tel"],
    transformTags: { a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }) }
  });
}

async function userCanSeeBuzon(userId: string, buzonId: string): Promise<{ see: boolean; send: boolean; buzon: BuzonRow | null }> {
  const rows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE id = $1", [buzonId]);
  const b = rows[0];
  if (!b) return { see: false, send: false, buzon: null };
  if (b.owner_user_id === userId) return { see: true, send: true, buzon: b };
  const userRow = (await query<any>("SELECT posiciones FROM gozz.users WHERE id = $1", [userId]))[0];
  const positions: string[] = Array.isArray(userRow?.posiciones) ? userRow.posiciones : [];
  const acls = await query<any>("SELECT user_id, posicion, permiso FROM gozz.buzon_acl WHERE buzon_id = $1", [buzonId]);
  let see = false, send = false;
  for (const a of acls) {
    if (a.user_id === userId || (a.posicion && positions.includes(a.posicion))) {
      see = true;
      if (a.permiso === "enviar") send = true;
    }
  }
  return { see, send, buzon: b };
}

async function listVisibleBuzones(userId: string): Promise<BuzonRow[]> {
  const u = (await query<any>("SELECT id, posiciones FROM gozz.users WHERE id = $1", [userId]))[0];
  const positions: string[] = Array.isArray(u?.posiciones) ? u.posiciones : [];
  const ownRows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE owner_user_id = $1 AND activo = true", [userId]);
  const aclRows = await query<BuzonRow>(
    `SELECT DISTINCT b.* FROM gozz.buzones_email b
       JOIN gozz.buzon_acl a ON a.buzon_id = b.id
      WHERE b.activo = true AND (a.user_id = $1 OR (a.posicion = ANY($2::text[])))`,
    [userId, positions]
  );
  const map = new Map<string, BuzonRow>();
  for (const r of ownRows) map.set(r.id, r);
  for (const r of aclRows) map.set(r.id, r);
  return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export function buildLoginCandidates(primaryUser: string | null | undefined, email?: string | null): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const v = String(value).trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    order.push(v);
  };

  const primary = String(primaryUser || "").trim();
  const fullEmail = String(email || primary || "").trim();

  const rawCandidates = [fullEmail, primary];
  for (const candidate of rawCandidates) push(candidate);

  const localCandidates = rawCandidates
    .map((candidate) => (candidate.includes("@") ? candidate.split("@")[0] : candidate))
    .filter(Boolean);
  for (const candidate of localCandidates) push(candidate);

  return order;
}

function humanizeImapSmtpError(e: any): string {
  const code = e?.serverResponseCode || e?.code || "";
  const respText = e?.responseText || e?.response || "";
  const msg = (e?.message || String(e || "")).trim();
  // 535 / AUTHENTICATIONFAILED / Invalid credentials
  if (/^AUTHENTICATIONFAILED$/i.test(code) || /535/.test(msg) || /Invalid (login|credentials)/i.test(msg) || /Incorrect (authentication|password)/i.test(msg) || /Authentication failed/i.test(msg) || /Logon denied/i.test(msg) || /LOGIN failed/i.test(msg)) {
    const detail = respText ? ` (server: ${String(respText).slice(0,120)})` : "";
    return `Credenciales incorrectas: el servidor cPanel rechazo usuario/password.${detail} Verifica que el correo y la password sean los mismos que usas para entrar a webmail de cPanel.`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(code) || /getaddrinfo/i.test(msg)) {
    return `No se puede resolver el servidor (${e?.hostname || ""}). Verifica el host IMAP/SMTP.`;
  }
  if (/ECONNREFUSED/i.test(code) || /ECONNREFUSED/i.test(msg)) {
    return "El servidor rechazo la conexion. Verifica el puerto y SSL.";
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT/i.test(code) || /timeout/i.test(msg)) {
    return "Timeout al conectar con el servidor. Puede estar caido o bloqueado por firewall.";
  }
  if (/self-signed|certificate|TLS|SSL/i.test(msg)) {
    return `Problema con el certificado TLS/SSL: ${msg}`;
  }
  // fallback: agregar responseText si existe
  if (respText && !msg.includes(String(respText))) {
    return `${msg} — ${String(respText).slice(0,150)}`;
  }
  return msg || "Error desconocido";
}

async function notificarBuzonDesconectado(buzon: BuzonRow): Promise<void> {
  try {
    const titulo = "⚠️ Tu correo se desconectó";
    const mensaje = `El buzón ${buzon.email} dejó de sincronizar (posible cambio de contraseña en tu correo). Vuelve a conectarlo en la sección Correo para seguir recibiendo y enviando.`;
    await query(
      `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
       VALUES ($1, 'sistema', $2, $3, 'alta', '/correo', $4::jsonb)`,
      [buzon.owner_user_id, titulo, mensaje, JSON.stringify({ buzon_id: buzon.id, email: buzon.email, motivo: "auth" })]
    );
    await sendPushToUsers([buzon.owner_user_id], { title: titulo, body: mensaje, url: "/correo", kind: "general", tag: "buzon-auth-" + buzon.id });
  } catch (e: any) {
    console.error("[email-sync] notificarBuzonDesconectado fail:", e?.message || e);
  }
}

// Corta una promesa a los `ms` ms con un error controlado. Necesario porque nodemailer/imapflow no
// siempre respetan su connectionTimeout cuando el puerto está filtrado o el ISP lo estrangula (se
// observó SMTP 465 tardando ~2 min desde una red local), lo que colgaba el request y hacía que el
// proxy devolviera un 500 en texto ("Internal Server Error").
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout de ${Math.round(ms / 1000)}s conectando (${label}). Puede estar bloqueado por firewall/ISP o el servidor no responde.`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function testImap(b: { email?: string; imap_host: string; imap_port: number; imap_ssl: boolean; imap_user: string; imap_password: string; }): Promise<{ ok: boolean; error?: string }> {
  const pass = String(b.imap_password || "");
  const candidates = buildLoginCandidates(b.imap_user, b.email || b.imap_user);
  let lastError: any = null;

  for (const user of candidates) {
    const client = new ImapFlow({
      host: String(b.imap_host || "").trim(), port: b.imap_port, secure: b.imap_ssl,
      auth: { user: String(user).trim().toLowerCase(), pass },
      logger: false, emitLogs: false,
      connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 30000,
    } as any);
    client.on("error", (err: any) => console.error("[imap test socket]", user, err?.message || err));
    try {
      await withTimeout((async () => { await client.connect(); await client.logout(); })(), 15000, "IMAP");
      return { ok: true };
    } catch (e: any) {
      lastError = e;
      try { client.close(); } catch {}
    }
  }

  return { ok: false, error: humanizeImapSmtpError(lastError || new Error("No se pudo autenticar con ninguna variante de usuario")) };
}

async function testSmtp(b: { email?: string; smtp_host: string; smtp_port: number; smtp_ssl: boolean; smtp_user: string; smtp_password: string; }): Promise<{ ok: boolean; error?: string }> {
  const pass = String(b.smtp_password || "");
  const candidates = buildLoginCandidates(b.smtp_user, b.email || b.smtp_user);
  let lastError: any = null;

  for (const user of candidates) {
    const t = nodemailer.createTransport({
      host: String(b.smtp_host || "").trim(), port: b.smtp_port, secure: b.smtp_ssl,
      auth: { user: String(user).trim().toLowerCase(), pass },
      connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 30000,
    });
    try {
      await withTimeout(t.verify(), 15000, "SMTP");
      return { ok: true };
    } catch (e: any) {
      lastError = e;
    } finally {
      try { t.close(); } catch {}
    }
  }

  return { ok: false, error: humanizeImapSmtpError(lastError || new Error("No se pudo autenticar con ninguna variante de usuario")) };
}

// ---------------------------------------------------------------------------
// Google OAuth2 helpers (XOAUTH2 para Gmail / Google Workspace)
// ---------------------------------------------------------------------------

function googleOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  const redir = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";
  if (!id || !secret || !redir) return null;
  return { clientId: id, clientSecret: secret, redirectUri: redir };
}

async function exchangeGoogleCodeForTokens(code: string): Promise<any> {
  const cfg = googleOAuthConfig();
  if (!cfg) return null;
  const body = new URLSearchParams({
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri, grant_type: "authorization_code",
  }).toString();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) { console.error("[oauth] token exchange fail", r.status, await r.text().catch(() => "")); return null; }
  return await r.json();
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<any> {
  const cfg = googleOAuthConfig();
  if (!cfg) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  }).toString();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) { console.error("[oauth] refresh fail", r.status, await r.text().catch(() => "")); return null; }
  return await r.json();
}

async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  return (j?.email as string) || null;
}

async function getGoogleAccessTokenForBuzon(buzon: BuzonRow): Promise<string> {
  if (!buzon.oauth_refresh_token_enc) throw new Error("buzon sin refresh_token");
  const nowMs = Date.now();
  const expMs = buzon.oauth_token_expires_at ? new Date(buzon.oauth_token_expires_at).getTime() : 0;
  if (buzon.oauth_access_token_enc && expMs - 60_000 > nowMs) {
    return decrypt(buzon.oauth_access_token_enc);
  }
  const refreshToken = decrypt(buzon.oauth_refresh_token_enc);
  const t = await refreshGoogleAccessToken(refreshToken);
  if (!t?.access_token) throw new Error("no se pudo refrescar access_token de Google");
  const expiresAt = new Date(nowMs + (t.expires_in - 30) * 1000).toISOString();
  await query(
    `UPDATE gozz.buzones_email
     SET oauth_access_token_enc = $1, oauth_token_expires_at = $2
     WHERE id = $3`,
    [encrypt(t.access_token), expiresAt, buzon.id]
  );
  return t.access_token;
}

async function testImapXoauth2(host: string, port: number, user: string, accessToken: string): Promise<{ ok: boolean; error?: string }> {
  const client = new ImapFlow({
    host: host.trim(), port, secure: true,
    auth: { user, accessToken },
    logger: false, emitLogs: false,
    connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 30000,
  } as any);
  client.on("error", (err: any) => console.error("[imap test socket]", user, err?.message || err));
  try { await client.connect(); await client.logout(); return { ok: true }; }
  catch (e: any) { try { client.close(); } catch {} return { ok: false, error: humanizeImapSmtpError(e) }; }
}

async function findContactByEmail(email: string): Promise<{ id: string; oportunidad_id: string | null } | null> {
  if (!email) return null;
  // Mismo idioma que la resolución de contactos por webhook (index.ts): puede haber varias filas
  // con el mismo email (archivados por basura, perdedores de una fusión). Se prefiere el ACTIVO, y
  // si aun así cae en un archivado por fusión se devuelve su GANADOR — así el correo se vincula al
  // contacto que el usuario puede abrir, no a uno invisible.
  const rows = await query<any>(
    `SELECT COALESCE(c.fusionado_en_contacto_id, c.id) AS contacto_id,
            (SELECT id FROM gozz.oportunidades
              WHERE contacto_id = COALESCE(c.fusionado_en_contacto_id, c.id)
              ORDER BY created_at DESC LIMIT 1) AS oportunidad_id
     FROM gozz.contactos_cache c
     WHERE LOWER(c.email) = LOWER($1)
     ORDER BY (COALESCE(c.archivado, false) IS TRUE) ASC, c.updated_at DESC NULLS LAST
     LIMIT 1`,
    [email]
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.contacto_id, oportunidad_id: r.oportunidad_id };
}

// ---------------------------------------------------------------------------
// Adjuntos on-demand: los bytes de los adjuntos NO se persisten (solo metadata),
// así que para preview/descarga los traemos del servidor IMAP bajo demanda.
// Estos helpers construyen el cliente (password u OAuth) y resuelven el nombre
// real de la carpeta canónica almacenada en el email.
// ---------------------------------------------------------------------------
async function buildImapClient(buzon: BuzonRow): Promise<ImapFlow> {
  const common = {
    host: buzon.imap_host, port: buzon.imap_port, secure: buzon.imap_ssl,
    logger: false, emitLogs: false,
    connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 30000,
  };
  const withErr = (c: ImapFlow): ImapFlow => { c.on("error", (err: any) => console.error("[imap socket]", buzon.email, err?.message || err)); return c; };
  if (buzon.auth_type === "oauth2_google") {
    const accessToken = await getGoogleAccessTokenForBuzon(buzon);
    return withErr(new ImapFlow({ ...common, auth: { user: buzon.imap_user, accessToken } } as any));
  }
  if (!buzon.imap_password_enc) throw new Error("buzon sin password ni oauth");
  const pass = decrypt(buzon.imap_password_enc);
  return withErr(new ImapFlow({ ...common, auth: { user: buzon.imap_user, pass } } as any));
}

async function resolveImapFolder(buzon: BuzonRow, canonical: string | null): Promise<string> {
  const canon = canonical || "INBOX";
  const rows = await query<any>(
    "SELECT imap_folder_name FROM gozz.buzon_folder_state WHERE buzon_id = $1 AND folder = $2",
    [buzon.id, canon]
  );
  if (rows[0]?.imap_folder_name) return rows[0].imap_folder_name as string;
  return canon;
}

function asciiFilename(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "'");
}

async function persistEmail(buzon: BuzonRow, parsed: ParsedMail, uid: number, folder: string) {
  const from = parsed.from?.value?.[0];
  const tos = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.flatMap((a: any) => a.value || []) : (parsed.to as any).value || []) : [];
  const ccs = parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.flatMap((a: any) => a.value || []) : (parsed.cc as any).value || []) : [];
  const fromAddr = from?.address || null;
  const fromName = from?.name || null;
  const subject = parsed.subject || null;
  const bodyHtml = parsed.html ? String(parsed.html) : null;
  const bodyText = parsed.text || null;
  const msgId = parsed.messageId || null;
  const fecha = parsed.date || new Date();

  // Direccion inferida por carpeta: SENT/DRAFTS = saliente, resto = entrante.
  const direccion: "entrante" | "saliente" = (folder === "SENT" || folder === "DRAFTS") ? "saliente" : "entrante";

  // Auto-link al contacto: priorizar destinatarios cuando la carpeta es SENT (yo escribi al contacto),
  // priorizar remitente cuando es INBOX/SPAM/TRASH (el contacto me escribio).
  let contacto_id: string | null = null;
  let oportunidad_id: string | null = null;
  const candidatos: string[] = direccion === "saliente"
    ? [...tos.map((t: any) => t.address), fromAddr].filter(Boolean)
    : [fromAddr, ...tos.map((t: any) => t.address)].filter(Boolean);
  for (const addr of candidatos) {
    const r = await findContactByEmail(addr);
    if (r) { contacto_id = r.id; oportunidad_id = r.oportunidad_id; break; }
  }

  try {
    await query(
      `INSERT INTO gozz.emails
       (buzon_id, message_id, imap_uid, thread_id, direccion, from_addr, from_name,
        to_addrs, cc_addrs, subject, body_html, body_text, adjuntos, carpeta,
        contacto_id, oportunidad_id, fecha_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
       ON CONFLICT (buzon_id, message_id) DO NOTHING`,
      [
        buzon.id, msgId, uid, parsed.inReplyTo || msgId || null, direccion,
        fromAddr, fromName,
        JSON.stringify(tos), JSON.stringify(ccs),
        subject, bodyHtml, bodyText,
        JSON.stringify(parsed.attachments?.map((a: any) => ({ name: a.filename, size: a.size, content_type: a.contentType })) || []),
        folder, contacto_id, oportunidad_id, fecha
      ]
    );
  } catch (e: any) {
    console.error("[email-sync] persist fail", e?.message);
  }
}

// ---------------------------------------------------------------------------
// Descubrimiento de carpetas: usar SPECIAL-USE flags (RFC 6154) cuando esten,
// fallback a nombres conocidos. Devuelve mapa canonical -> nombre_real.
// ---------------------------------------------------------------------------
const SENT_NAME_HINTS = [
  "INBOX.Sent", "Sent", "Sent Items", "Sent Messages",
  "[Gmail]/Sent Mail", "[Google Mail]/Sent Mail",
  "Enviados", "Elementos enviados",
];
const SPAM_NAME_HINTS = [
  "INBOX.Junk", "INBOX.spam", "Junk", "Junk E-mail", "Spam", "Bulk Mail",
  "[Gmail]/Spam", "[Google Mail]/Spam",
  "Correo no deseado",
];
const TRASH_NAME_HINTS = [
  "INBOX.Trash", "Trash", "Deleted", "Deleted Items", "Deleted Messages",
  "[Gmail]/Trash", "[Gmail]/Bin", "[Google Mail]/Trash",
  "Papelera", "Elementos eliminados",
];

async function discoverFolders(client: ImapFlow): Promise<Record<string, string | null>> {
  const map: Record<string, string | null> = { INBOX: "INBOX", SENT: null, SPAM: null, TRASH: null };
  try {
    const list: any[] = await (client as any).list();
    for (const m of list) {
      const path: string = m.path || m.name || "";
      const flags: string[] = Array.isArray(m.flags) ? m.flags : (m.specialUse ? [m.specialUse] : []);
      const fl = flags.map((f: string) => String(f).toLowerCase());
      const special = (m.specialUse || "").toLowerCase();
      // SPECIAL-USE / flag detection
      if (!map.SENT && (fl.includes("\\sent") || fl.includes("\sent") || special === "\sent")) map.SENT = path;
      if (!map.SPAM && (fl.includes("\\junk") || fl.includes("\junk") || special === "\junk")) map.SPAM = path;
      if (!map.TRASH && (fl.includes("\\trash") || fl.includes("\trash") || special === "\trash")) map.TRASH = path;
    }
    // Fallback por nombres conocidos
    const paths = list.map((m) => m.path || m.name || "");
    if (!map.SENT) map.SENT = paths.find((p) => SENT_NAME_HINTS.some((h) => p.toLowerCase() === h.toLowerCase())) || null;
    if (!map.SPAM) map.SPAM = paths.find((p) => SPAM_NAME_HINTS.some((h) => p.toLowerCase() === h.toLowerCase())) || null;
    if (!map.TRASH) map.TRASH = paths.find((p) => TRASH_NAME_HINTS.some((h) => p.toLowerCase() === h.toLowerCase())) || null;
  } catch (e: any) {
    console.warn("[email-sync] discoverFolders fail:", e?.message);
  }
  return map;
}

// Sync de UNA carpeta. Devuelve {imported, newUidNext}. Lee y persiste estado
// en gozz.buzon_folder_state.
async function syncOneFolder(buzon: BuzonRow, client: ImapFlow, canonicalName: string, imapFolderName: string): Promise<{ imported: number }> {
  let imported = 0;
  // Leer estado actual de esta carpeta
  const stateRows = await query<any>(
    `SELECT uid_next, imap_folder_name FROM gozz.buzon_folder_state WHERE buzon_id = $1 AND folder = $2`,
    [buzon.id, canonicalName]
  );
  const previousUidNext = stateRows[0]?.uid_next || null;

  const lock = await (client as any).getMailboxLock(imapFolderName);
  try {
    const mb: any = (client as any).mailbox;
    let targetUids: number[] = [];

    if (!previousUidNext) {
      const dias = Math.max(1, buzon.import_desde_dias || 15);
      const since = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      try {
        const search = await client.search({ since }, { uid: true });
        targetUids = Array.isArray(search) ? search.slice() : [];
      } catch {
        const fb = Math.max(1, (mb?.uidNext || 1) - 50);
        const to = (mb?.uidNext || fb) - 1;
        if (to >= fb) for (let u = fb; u <= to; u++) targetUids.push(u);
      }
    } else {
      const fromUid = previousUidNext;
      const toUid = (mb?.uidNext || fromUid) - 1;
      if (toUid >= fromUid) for (let u = fromUid; u <= toUid; u++) targetUids.push(u);
    }

    // Cap de correos por carpeta por CICLO: simpleParser (parseo MIME) es CPU-intensivo y, con un
    // backlog grande, bloquea el event loop de Node → /api/health deja de responder (000) y el
    // watchdog reinicia crm-api ("se queda pegado"/"se cae"). Procesamos un máximo por ciclo
    // (el loop corre cada 2 min) y el resto se drena en ciclos siguientes avanzando uid_next.
    const MAX_PER_CYCLE = 80;
    targetUids.sort((a, b) => a - b);
    const capped = targetUids.length > MAX_PER_CYCLE;
    if (capped) targetUids = targetUids.slice(0, MAX_PER_CYCLE);

    if (targetUids.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < targetUids.length; i += CHUNK) {
        const slice = targetUids.slice(i, i + CHUNK);
        const range = slice.join(",");
        for await (const msg of client.fetch({ uid: range }, { source: true, uid: true })) {
          try {
            const parsed = await simpleParser(msg.source as Buffer);
            await persistEmail(buzon, parsed, msg.uid, canonicalName);
            imported++;
          } catch (e: any) {
            console.error(`[email-sync] parse error ${canonicalName}:`, e?.message);
          }
          // Ceder el event loop tras CADA correo: permite que /api/health y las peticiones de los
          // usuarios respondan durante el sync (sin esto, una ráfaga de parseos congela la API).
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }

    // Si capamos, avanzar uid_next solo hasta el último uid procesado (el resto, próximo ciclo).
    // Si no, usar el uidNext real del buzón (cubre cualquier uid más allá del rango leído).
    const newUidNext = capped
      ? (targetUids[targetUids.length - 1] + 1)
      : (mb?.uidNext || (previousUidNext || 1));
    await query(
      `INSERT INTO gozz.buzon_folder_state (buzon_id, folder, imap_folder_name, uid_next, ultimo_sync, errores_consecutivos, ultimo_error)
       VALUES ($1, $2, $3, $4, NOW(), 0, NULL)
       ON CONFLICT (buzon_id, folder) DO UPDATE SET
         imap_folder_name = EXCLUDED.imap_folder_name,
         uid_next = EXCLUDED.uid_next,
         ultimo_sync = NOW(),
         errores_consecutivos = 0,
         ultimo_error = NULL`,
      [buzon.id, canonicalName, imapFolderName, newUidNext]
    );
  } finally {
    lock.release();
  }
  return { imported };
}



async function syncBuzon(buzon: BuzonRow) {
  let client: ImapFlow;
  if (buzon.auth_type === "oauth2_google") {
    let accessToken: string;
    try { accessToken = await getGoogleAccessTokenForBuzon(buzon); }
    catch (e: any) {
      await query("UPDATE gozz.buzones_email SET requiere_auth_update = true, ultimo_error = $2 WHERE id = $1",
        [buzon.id, "OAuth refresh fail: " + (e?.message || String(e))]);
      return;
    }
    client = new ImapFlow({
      host: buzon.imap_host, port: buzon.imap_port, secure: buzon.imap_ssl,
      auth: { user: buzon.imap_user, accessToken },
      logger: false, emitLogs: false, connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 30000,
    } as any);
  } else {
    if (!buzon.imap_password_enc) {
      await query("UPDATE gozz.buzones_email SET requiere_auth_update = true, ultimo_error = 'sin password ni oauth' WHERE id = $1", [buzon.id]);
      return;
    }
    const pass = decrypt(buzon.imap_password_enc);
    client = new ImapFlow({
      host: buzon.imap_host, port: buzon.imap_port, secure: buzon.imap_ssl,
      auth: { user: buzon.imap_user, pass },
      logger: false, emitLogs: false, connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 30000,
    } as any);
  }
  // CRÍTICO: sin este listener, un 'error' del socket IMAP (Socket timeout/EPIPE) se vuelve
  // uncaughtException y presiona/tumba crm-api (causaba el "se queda pegado"). Aquí solo se loguea.
  client.on("error", (err: any) => { console.error("[email-sync socket]", buzon.email, err?.message || err); });
  try {
    await client.connect();

    // 1) Descubrir nombres reales de carpetas (Sent/Spam/Trash) ademas de INBOX.
    const folderMap = await discoverFolders(client);
    let imported = 0;
    const folderResults: Record<string, number> = {};

    // 2) Iterar por las 4 carpetas canonicas. Si una no existe en este servidor, skip.
    for (const [canonical, imapName] of Object.entries(folderMap)) {
      if (!imapName) continue;
      try {
        const r = await syncOneFolder(buzon, client, canonical, imapName);
        imported += r.imported;
        folderResults[canonical] = r.imported;
      } catch (fe: any) {
        console.error(`[email-sync] folder ${canonical} (${imapName}) error:`, fe?.message);
        folderResults[canonical] = -1;
        await query(
          `INSERT INTO gozz.buzon_folder_state (buzon_id, folder, imap_folder_name, ultimo_sync, errores_consecutivos, ultimo_error)
           VALUES ($1, $2, $3, NOW(), 1, $4)
           ON CONFLICT (buzon_id, folder) DO UPDATE SET
             errores_consecutivos = gozz.buzon_folder_state.errores_consecutivos + 1,
             ultimo_error = EXCLUDED.ultimo_error`,
          [buzon.id, canonical, imapName, String(fe?.message || fe).slice(0, 300)]
        );
      }
    }

    // 3) Mantener back-compat: actualizar sync_uid_next legacy con el de INBOX.
    {
      const r2 = await query<any>(
        `SELECT uid_next FROM gozz.buzon_folder_state WHERE buzon_id=$1 AND folder='INBOX'`,
        [buzon.id]
      );
      const inboxUidNext = r2[0]?.uid_next || (buzon.sync_uid_next || 1);
      const anyFolderFailed = Object.values(folderResults).some((n) => n === -1);
      if (anyFolderFailed) {
        // Conectamos pero una o más carpetas fallaron (típico: la conexión se cayó a mitad =
        // "Connection not available"). NO limpiar el backoff: tratarlo como error transitorio para
        // no reintentar en el próximo ciclo (cada 2 min) y desatar la tormenta de reconexiones que
        // congelaba la API y disparaba el watchdog.
        const errCount = (buzon.errores_consecutivos || 0) + 1;
        const delayMin = Math.min(60, 10 * Math.pow(2, Math.max(0, errCount - 1)));
        await query("UPDATE gozz.buzones_email SET ultimo_sync = NOW(), sync_uid_next = $1, errores_consecutivos = $3, proximo_reintento_at = now() + ($4 || ' minutes')::interval WHERE id = $2", [inboxUidNext, buzon.id, errCount, String(delayMin)]);
      } else {
        await query("UPDATE gozz.buzones_email SET ultimo_sync = NOW(), sync_uid_next = $1, errores_consecutivos = 0, ultimo_error = NULL, proximo_reintento_at = NULL, requiere_auth_update = false WHERE id = $2", [inboxUidNext, buzon.id]);
      }
      if (imported > 0) {
        const breakdown = Object.entries(folderResults).filter(([_,n]) => n > 0).map(([k,v]) => `${k}:${v}`).join(" ");
        console.log(`[email-sync] ${buzon.email} +${imported} (${breakdown})`);
        // Tiempo real: avisar por Postgres NOTIFY (el worker no tiene socket). La API escucha
        // 'email_nuevo' (LISTEN) y emite el socket 'email:nuevo' a los usuarios con acceso al buzón.
        await query("SELECT pg_notify('email_nuevo', $1)", [JSON.stringify({ buzon_id: buzon.id, imported })]).catch(() => {});
      }
    }
    await client.logout();
  } catch (e: any) {
    try { client.close(); } catch {}
    const msg = e?.message || String(e);
    // Detectar errores de auth → requiere intervención manual del user (no reintentar en loop)
    const isAuthError = (e as any)?.authenticationFailed === true || (e as any)?.serverResponseCode === "AUTHENTICATIONFAILED" || /AUTHENTICATIONFAILED|Invalid credentials|535|Logon denied|LOGIN failed|Authentication unsuccessful|incorrect (password|authentication)/i.test(msg);
    if (isAuthError) {
      const yaRequeriaAuth = (buzon as any).requiere_auth_update === true;
      await query(
        "UPDATE gozz.buzones_email SET errores_consecutivos = COALESCE(errores_consecutivos,0)+1, ultimo_error = $2, requiere_auth_update = true, proximo_reintento_at = NULL WHERE id = $1",
        [buzon.id, msg]
      );
      console.error("[email-sync] AUTH ERROR", buzon.email, msg, "— requiere actualizar credenciales");
      if (!yaRequeriaAuth) { void notificarBuzonDesconectado(buzon); }
      return;
    }
    // Errores transitorios (network/timeout) → backoff exponencial, capa 60 min.
    // Si el host está INALCANZABLE o la conexión se cae (EHOSTUNREACH/ETIMEDOUT/Socket timeout/etc.)
    // arrancamos el backoff MUCHO más alto (10 min): un mailserver que flapea NO se debe martillar
    // cada 2 min — esa tormenta de reconexiones es la que tumbaba la API ("se cae"/"se queda pegado").
    const isUnreachable = /EHOSTUNREACH|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|ENOTFOUND|EPIPE|Connection not available|Unexpected close|Socket timeout|socket close|greeting not received/i.test(msg);
    const errCount = (buzon.errores_consecutivos || 0) + 1;
    const base = isUnreachable ? 10 : 2;
    const delayMin = Math.min(60, base * Math.pow(2, Math.max(0, errCount - 1))); // unreachable: 10,20,40,60 · otros: 2,4,8,16,32,60
    await query(
      "UPDATE gozz.buzones_email SET errores_consecutivos = $2, ultimo_error = $3, proximo_reintento_at = now() + ($4 || ' minutes')::interval WHERE id = $1",
      [buzon.id, errCount, msg, String(delayMin)]
    );
    console.error("[email-sync]", buzon.email, "err#" + errCount, "retry in", delayMin + "min:", msg);
  }
}

let _syncInFlight = false;
export async function syncAllBuzones() {
  if (_syncInFlight) return;
  _syncInFlight = true;
  try {
    const rows = await query<BuzonRow>(
      "SELECT * FROM gozz.buzones_email " +
      "WHERE activo = true " +
      "  AND COALESCE(requiere_auth_update, false) = false " +
      "  AND (proximo_reintento_at IS NULL OR proximo_reintento_at <= now())"
    );
    // Sincronizar los buzones EN PARALELO con un tope (no uno por uno): así un buzón lento o
    // caído (timeout de 12s) no retrasa a los demás. El tope evita la "tormenta" de conexiones
    // que motivó aislar el sync en su propio proceso.
    const CONCURRENCIA = 4;
    let i = 0;
    const worker = async () => {
      while (i < rows.length) {
        const b = rows[i++];
        await syncBuzon(b).catch(() => {}); // syncBuzon ya maneja sus errores/backoff internamente
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, rows.length) }, () => worker()));
  } finally {
    _syncInFlight = false;
  }
}

export function startEmailSyncLoop() {
  const intervalMs = 60 * 1000;
  // Primer sync tras 30s para dar margen al arranque
  setTimeout(() => { syncAllBuzones().catch(() => {}); }, 30_000);
  setInterval(() => { syncAllBuzones().catch(() => {}); }, intervalMs);
  console.log("[email-sync] loop started (every 60s)");
}

const BuzonSchema = z.object({
  email: z.string().email(),
  display_name: z.string().optional().nullable(),
  imap_host: z.string().min(3),
  imap_port: z.number().int().min(1).max(65535).default(993),
  imap_ssl: z.boolean().default(true),
  imap_user: z.string().min(1),
  imap_password: z.string().min(1),
  smtp_host: z.string().min(3),
  smtp_port: z.number().int().min(1).max(65535).default(465),
  smtp_ssl: z.boolean().default(true),
  smtp_user: z.string().optional().nullable(),
  smtp_password: z.string().optional().nullable(),
  import_desde_dias: z.number().int().default(7),
  acl: z.array(z.object({ user_id: z.string().uuid().optional().nullable(), posicion: z.string().optional().nullable(), permiso: z.enum(["ver","enviar"]).default("ver") })).optional(),
  // Opcional, y solo un admin lo consigue: lo decide `resolverPropietarioAlCrear`, en el servidor.
  owner_user_id: z.string().uuid().optional().nullable(),
});

export function registerEmailRoutes(app: Express) {
  app.get("/api/buzones", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const list = await listVisibleBuzones(u.sub);
    const clean = list.map((b) => ({
      id: b.id, email: b.email, display_name: b.display_name, owner_user_id: b.owner_user_id,
      imap_host: b.imap_host, imap_port: b.imap_port, smtp_host: b.smtp_host, smtp_port: b.smtp_port,
      activo: b.activo, ultimo_sync: (b as any).ultimo_sync, errores_consecutivos: (b as any).errores_consecutivos || 0,
      ultimo_error: (b as any).ultimo_error || null,
      requiere_auth_update: (b as any).requiere_auth_update === true,
      auth_type: (b as any).auth_type || "password",
      es_mio: b.owner_user_id === u.sub,
    }));
    res.json({ buzones: clean });
  });

  // Panel de control (solo admin): TODOS los buzones con su estado de salud + dueño + métricas.
  // Se registra ANTES de cualquier ruta /api/buzones/:id para que "panel" no se interprete como :id.
  app.get("/api/buzones/panel", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const rows = await query<any>(
      `SELECT b.id, b.email, b.display_name, b.imap_host, b.activo, b.auth_type,
              b.errores_consecutivos, b.ultimo_error, b.requiere_auth_update, b.ultimo_sync,
              us.nombre AS owner_nombre, us.email AS owner_email,
              (SELECT COUNT(*)         FROM gozz.emails e WHERE e.buzon_id = b.id) AS total_correos,
              (SELECT MAX(fecha_email) FROM gozz.emails e WHERE e.buzon_id = b.id) AS ultimo_correo
         FROM gozz.buzones_email b
         LEFT JOIN gozz.users us ON us.id = b.owner_user_id
        ORDER BY b.activo DESC, b.requiere_auth_update DESC, b.errores_consecutivos DESC, b.email`
    );
    res.json({ buzones: rows });
  });

  // ---------------------------------------------------------------------
  // OAuth2 Gmail / Google Workspace: start + callback
  // ---------------------------------------------------------------------
  // El user inicia desde el frontend con POST /api/buzones/oauth/google/start
  // pasando display_name + import_desde_dias + acl[]. Se devuelve auth_url.
  // El user va a Google, autoriza, vuelve por GET /api/buzones/oauth/google/callback
  // donde intercambiamos code -> tokens, descubrimos email, creamos buzon.
  app.post("/api/buzones/oauth/google/start", requireAuth, async (req: Request, res: Response) => {
    const cfg = googleOAuthConfig();
    if (!cfg) { res.status(500).json({ error: "OAuth Google no configurado en .env (GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI)" }); return; }
    const u = (req as any).user;
    const body = req.body || {};
    const payload = {
      display_name: typeof body.display_name === "string" ? body.display_name : null,
      import_desde_dias: Number.isFinite(Number(body.import_desde_dias)) ? Number(body.import_desde_dias) : 7,
      acl: Array.isArray(body.acl) ? body.acl.filter((a: any) => a && (a.user_id || a.posicion)) : [],
    };
    // Generar state aleatorio
    const state = require("crypto").randomBytes(24).toString("hex");
    await query(
      "INSERT INTO gozz.oauth_pending (state, user_id, payload) VALUES ($1, $2, $3)",
      [state, u.sub, JSON.stringify(payload)]
    );
    const scopes = [
      "https://mail.google.com/",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid",
    ].join(" ");
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: scopes,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    const auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
    res.json({ auth_url, state });
  });

  // El callback NO usa requireAuth (viene de Google con browser redirect);
  // valida via el state que vinculamos a un user_id en oauth_pending.
  app.get("/api/buzones/oauth/google/callback", async (req: Request, res: Response) => {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const error = String(req.query.error || "");
    function htmlClose(status: "ok" | "error", msg: string, buzonId?: string, email?: string) {
      const safeMsg = msg.replace(/</g, "&lt;");
      return `<!doctype html><html><head><meta charset="utf-8"><title>OAuth ${status}</title></head>
<body style="font-family:system-ui;padding:24px;text-align:center;color:#1a1a1a">
  <h2 style="margin-top:0">${status === "ok" ? "Listo, conectado" : "Hubo un problema"}</h2>
  <p>${safeMsg}</p>
  <p style="color:#666;font-size:13px">Esta ventana se cerrara sola.</p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: "gozz_oauth_${status}", message: ${JSON.stringify(msg)}, buzon_id: ${JSON.stringify(buzonId || null)}, email: ${JSON.stringify(email || null)} }, "*");
      }
    } catch(e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, 800);
  </script>
</body></html>`;
    }
    if (error) {
      res.status(400).send(htmlClose("error", "Google devolvio error: " + error));
      return;
    }
    if (!code || !state) {
      res.status(400).send(htmlClose("error", "Faltan parametros (code/state)."));
      return;
    }
    const pendingRows = await query<any>(
      "SELECT user_id, payload FROM gozz.oauth_pending WHERE state = $1 AND expires_at > now()",
      [state]
    );
    const pending = pendingRows[0];
    if (!pending) {
      res.status(400).send(htmlClose("error", "Sesion OAuth expirada o invalida. Vuelve a intentar."));
      return;
    }
    await query("DELETE FROM gozz.oauth_pending WHERE state = $1", [state]).catch(() => {});

    const tokens = await exchangeGoogleCodeForTokens(code);
    if (!tokens?.access_token || !tokens?.refresh_token) {
      res.status(500).send(htmlClose("error", "No se obtuvo refresh_token. Revoca acceso en https://myaccount.google.com/permissions y vuelve a intentar."));
      return;
    }
    const email = await fetchGoogleUserEmail(tokens.access_token);
    if (!email) {
      res.status(500).send(htmlClose("error", "No se pudo leer el email del usuario."));
      return;
    }
    // Si ya existe un buzon para este email del mismo owner, actualizamos los tokens en vez de crear.
    const existing = await query<any>(
      "SELECT id FROM gozz.buzones_email WHERE LOWER(email) = LOWER($1) AND owner_user_id = $2",
      [email, pending.user_id]
    );
    const nowMs = Date.now();
    const expiresAt = new Date(nowMs + (tokens.expires_in - 30) * 1000).toISOString();
    let buzonId: string;
    if (existing[0]) {
      buzonId = existing[0].id;
      await query(
        `UPDATE gozz.buzones_email SET
          auth_type = 'oauth2_google', oauth_provider = 'google',
          oauth_refresh_token_enc = $1, oauth_access_token_enc = $2, oauth_token_expires_at = $3,
          imap_user = $4, smtp_user = $4,
          imap_password_enc = NULL, smtp_password_enc = NULL,
          requiere_auth_update = false, errores_consecutivos = 0, ultimo_error = NULL, proximo_reintento_at = NULL,
          activo = true
         WHERE id = $5`,
        [encrypt(tokens.refresh_token), encrypt(tokens.access_token), expiresAt, email, buzonId]
      );
    } else {
      const payload = pending.payload || {};
      const ins = await query<any>(
        `INSERT INTO gozz.buzones_email
         (owner_user_id, email, display_name, auth_type, oauth_provider,
          oauth_refresh_token_enc, oauth_access_token_enc, oauth_token_expires_at,
          imap_host, imap_port, imap_ssl, imap_user, smtp_host, smtp_port, smtp_ssl, smtp_user, import_desde_dias)
         VALUES ($1,$2,$3,'oauth2_google','google',$4,$5,$6,
                 'imap.gmail.com',993,true,$7,'smtp.gmail.com',465,true,$7,$8)
         RETURNING id`,
        [
          pending.user_id, email, payload.display_name || null,
          encrypt(tokens.refresh_token), encrypt(tokens.access_token), expiresAt, email,
          Math.max(1, Math.min(365, Number(payload.import_desde_dias || 7)))
        ]
      );
      buzonId = ins[0].id;
      if (Array.isArray(payload.acl)) {
        for (const a of payload.acl) {
          if (!a.user_id && !a.posicion) continue;
          await query(
            "INSERT INTO gozz.buzon_acl (buzon_id, user_id, posicion, permiso) VALUES ($1,$2,$3,$4)",
            [buzonId, a.user_id || null, a.posicion || null, a.permiso || "ver"]
          );
        }
      }
    }

    // Disparar primer sync en background
    setTimeout(async () => {
      try {
        const rows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE id = $1", [buzonId]);
        if (rows[0]) await syncBuzon(rows[0]);
      } catch (e) { console.error("[oauth] initial sync failed", e); }
    }, 1500);

    res.send(htmlClose("ok", `Buzon ${email} conectado.`, buzonId, email));
  });

  app.post("/api/buzones/test-connection", requireAuth, async (req: Request, res: Response) => {
    try {
      const p = BuzonSchema.safeParse(req.body);
      if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
      const d = p.data;
      // IMAP y SMTP en PARALELO: el total es el más lento, no la suma (antes, un SMTP lento colgaba todo).
      const [imapRes, smtpRes] = await Promise.all([
        testImap({ email: d.email, imap_host: d.imap_host, imap_port: d.imap_port, imap_ssl: d.imap_ssl, imap_user: d.imap_user, imap_password: d.imap_password }),
        testSmtp({ email: d.email, smtp_host: d.smtp_host, smtp_port: d.smtp_port, smtp_ssl: d.smtp_ssl, smtp_user: d.smtp_user || d.imap_user, smtp_password: d.smtp_password || d.imap_password }),
      ]);
      res.json({ imap: imapRes, smtp: smtpRes, ok: imapRes.ok && smtpRes.ok });
    } catch (e: any) {
      // Nunca dejar que el endpoint emita un 500 en texto: el frontend hace r.json() y rompía con
      // "Unexpected token 'I' (Internal Server Error)". Siempre respondemos JSON.
      res.json({ ok: false, imap: { ok: false, error: e?.message || "Error probando la conexión" }, smtp: { ok: false, error: "" } });
    }
  });

  app.post("/api/buzones", requireAuth, async (req: Request, res: Response) => {
   try {
    const u = (req as any).user;
    const p = BuzonSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data;
    // IMAP y SMTP en paralelo (el total es el más lento, no la suma). Ambos son OBLIGATORIOS para
    // crear el buzón (validación estricta, idéntica en dev/qa/prod).
    const [imapRes, smtpRes] = await Promise.all([
      testImap({ email: d.email, imap_host: d.imap_host, imap_port: d.imap_port, imap_ssl: d.imap_ssl, imap_user: d.imap_user, imap_password: d.imap_password }),
      testSmtp({ email: d.email, smtp_host: d.smtp_host, smtp_port: d.smtp_port, smtp_ssl: d.smtp_ssl, smtp_user: d.smtp_user || d.imap_user, smtp_password: d.smtp_password || d.imap_password }),
    ]);
    if (!imapRes.ok) { res.status(400).json({ error: "IMAP falló", detail: imapRes.error }); return; }
    if (!smtpRes.ok) { res.status(400).json({ error: "SMTP falló", detail: smtpRes.error }); return; }

    // A nombre de QUIÉN queda el buzón. `owner_user_id` en el body es opcional y **solo un admin
    // lo consigue**: para el resto se ignora y el dueño es quien conecta. Ver el módulo para el
    // porqué de comprobarlo contra la base y no contra el token.
    const propietario = await resolverPropietarioAlCrear(d.owner_user_id, u.sub);
    if (propietario.error) { res.status(400).json({ error: propietario.error }); return; }
    const ownerId = propietario.ownerId;

    // Si el PROPIETARIO ya tiene un buzón (no-OAuth) para este mismo correo, NO duplicar:
    // actualizamos credenciales/host y lo reactivamos (auto-reparación tras cambio de contraseña).
    // ⚠️ Se busca por `ownerId`, no por `u.sub`: con un admin creándolo a nombre de otra persona,
    // el duplicado que importa es el de ELLA — y es además el que violaría el índice único.
    const existentes = await query<any>(
      "SELECT id FROM gozz.buzones_email WHERE owner_user_id = $1 AND LOWER(email) = LOWER($2) AND COALESCE(auth_type,'password') <> 'oauth' LIMIT 1",
      [ownerId, d.email]
    );
    let buzon: any;
    if (existentes[0]) {
      const rows = await query<any>(
        `UPDATE gozz.buzones_email SET
           display_name = $2, imap_host = $3, imap_port = $4, imap_ssl = $5, imap_user = $6, imap_password_enc = $7,
           smtp_host = $8, smtp_port = $9, smtp_ssl = $10, smtp_user = $11, smtp_password_enc = $12, import_desde_dias = $13,
           activo = true, requiere_auth_update = false, errores_consecutivos = 0, ultimo_error = NULL, proximo_reintento_at = NULL
         WHERE id = $1 RETURNING *`,
        [
          existentes[0].id, d.display_name || null,
          d.imap_host, d.imap_port, d.imap_ssl, d.imap_user, encrypt(d.imap_password),
          d.smtp_host, d.smtp_port, d.smtp_ssl, d.smtp_user || null,
          d.smtp_password ? encrypt(d.smtp_password) : null,
          d.import_desde_dias
        ]
      );
      buzon = rows[0];
      await query("UPDATE gozz.buzon_folder_state SET errores_consecutivos = 0, ultimo_error = NULL WHERE buzon_id = $1", [buzon.id]);
    } else {
      const rows = await query<any>(
        `INSERT INTO gozz.buzones_email
         (owner_user_id, email, display_name, imap_host, imap_port, imap_ssl, imap_user, imap_password_enc,
          smtp_host, smtp_port, smtp_ssl, smtp_user, smtp_password_enc, import_desde_dias)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          ownerId, d.email, d.display_name || null,
          d.imap_host, d.imap_port, d.imap_ssl, d.imap_user, encrypt(d.imap_password),
          d.smtp_host, d.smtp_port, d.smtp_ssl, d.smtp_user || null,
          d.smtp_password ? encrypt(d.smtp_password) : null,
          d.import_desde_dias
        ]
      );
      buzon = rows[0];
    }

    if (Array.isArray(d.acl) && d.acl.length > 0) {
      for (const a of d.acl) {
        if (!a.user_id && !a.posicion) continue;
        await query(
          "INSERT INTO gozz.buzon_acl (buzon_id, user_id, posicion, permiso) VALUES ($1,$2,$3,$4)",
          [buzon.id, a.user_id || null, a.posicion || null, a.permiso || "ver"]
        );
      }
    }

    // Sync primer batch en background
    setTimeout(() => { syncBuzon(buzon).catch(() => {}); }, 1000);
    res.json({ buzon: { id: buzon.id, email: buzon.email } });
   } catch (e: any) {
    console.error("[POST /api/buzones]", e?.message || e);
    res.status(500).json({ error: e?.message || "Error creando el buzón" });
   }
  });

  // ---------------------------------------------------------------------
  // ACL management (compartir acceso al buzon)
  // - Solo el owner del buzon (o admin) puede gestionar la ACL.
  // - Permite agregar/quitar usuarios o posiciones con permiso ver/enviar.
  // ---------------------------------------------------------------------
  app.get("/api/buzones/:id/acl", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]);
    const b = rows[0];
    if (!b) { res.status(404).json({ error: "Buzon no encontrado" }); return; }
    const isOwner = b.owner_user_id === u.sub;
    if (!isOwner && !isAdmin(u)) { res.status(403).json({ error: "Solo el propietario puede ver permisos" }); return; }

    const acls = await query<any>(
      `SELECT a.id, a.user_id, a.posicion, a.permiso, a.created_at,
              u.nombre AS user_nombre, u.email AS user_email, u.foto_perfil_url
       FROM gozz.buzon_acl a
       LEFT JOIN gozz.users u ON u.id = a.user_id
       WHERE a.buzon_id = $1
       ORDER BY a.created_at ASC`,
      [b.id]
    );
    const owner = (await query<any>("SELECT id, nombre, email, foto_perfil_url FROM gozz.users WHERE id = $1", [b.owner_user_id]))[0] || null;
    const allUsers = await query<any>(
      "SELECT id, nombre, email, foto_perfil_url, posiciones FROM gozz.users WHERE activo = true ORDER BY nombre"
    );
    const posRows = await query<any>(
      "SELECT DISTINCT jsonb_array_elements_text(posiciones::jsonb) AS posicion FROM gozz.users WHERE posiciones IS NOT NULL"
    );
    const posiciones = posRows.map((p: any) => p.posicion).filter(Boolean).sort();
    res.json({
      buzon: { id: b.id, email: b.email, display_name: b.display_name },
      owner,
      acls,
      users: allUsers.filter((x: any) => x.id !== b.owner_user_id),
      posiciones,
      can_manage: isOwner || isAdmin(u),
    });
  });

  app.post("/api/buzones/:id/acl", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]);
    const b = rows[0];
    if (!b) { res.status(404).json({ error: "Buzon no encontrado" }); return; }
    const isOwner = b.owner_user_id === u.sub;
    if (!isOwner && !isAdmin(u)) { res.status(403).json({ error: "Solo el propietario puede compartir" }); return; }

    const body = req.body || {};
    const user_id = body.user_id ? String(body.user_id) : null;
    const posicion = body.posicion ? String(body.posicion).trim() : null;
    const permiso = body.permiso === "enviar" ? "enviar" : "ver";

    if (!user_id && !posicion) {
      res.status(400).json({ error: "Especifica un usuario o una posicion" });
      return;
    }
    if (user_id && user_id === b.owner_user_id) {
      res.status(400).json({ error: "El propietario ya tiene acceso completo" });
      return;
    }

    // Anti-duplicado
    const dup = await query<any>(
      `SELECT id FROM gozz.buzon_acl WHERE buzon_id = $1
        AND (CASE WHEN $2::uuid IS NULL THEN user_id IS NULL ELSE user_id = $2::uuid END)
        AND (CASE WHEN $3::text IS NULL THEN posicion IS NULL ELSE posicion = $3::text END)`,
      [b.id, user_id, posicion]
    );
    if (dup.length > 0) {
      // upgrade permiso si era 'ver' y ahora se pide 'enviar'
      await query("UPDATE gozz.buzon_acl SET permiso = $2 WHERE id = $1", [dup[0].id, permiso]);
      const updated = (await query<any>("SELECT * FROM gozz.buzon_acl WHERE id = $1", [dup[0].id]))[0];
      res.json({ acl: updated, updated: true });
      return;
    }

    const ins = await query<any>(
      `INSERT INTO gozz.buzon_acl (buzon_id, user_id, posicion, permiso)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [b.id, user_id, posicion, permiso]
    );
    res.json({ acl: ins[0], created: true });
  });

  // ---------------------------------------------------------------------
  // 🔴 CAMBIAR EL PERMISO DE UNA FILA — sin retirar el acceso por el camino.
  //
  // Antes solo se podía dar acceso y quitarlo. Para pasar a alguien de "leer + enviar" a "solo
  // leer" había que borrarle la fila y volver a agregarlo: entre las dos operaciones la persona se
  // quedaba fuera del buzón, y si la segunda no llegaba a ocurrir se quedaba fuera del todo.
  //
  // ⚠️ El admin se comprueba con `esAdminEnBase` —contra la BASE—, no con el `isAdmin(u)` del JWT
  // que usan los endpoints de al lado. Ese es deuda declarada (D11) y no se amplía en código
  // nuevo: aquí se decide quién puede enviar correo en nombre de una dirección de la empresa, y un
  // token de 365 días no dice qué es esa persona hoy. Los `isAdmin` vecinos se quedan como están —
  // cambiarlos es su propia entrega.
  // ---------------------------------------------------------------------
  app.patch("/api/buzones/:id/acl/:aclId", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]);
    const b = rows[0];
    if (!b) { res.status(404).json({ error: "Buzon no encontrado" }); return; }
    const isOwner = b.owner_user_id === u?.sub;
    if (!isOwner && !(await esAdminEnBase(u?.sub))) {
      res.status(403).json({ error: "Solo el propietario puede gestionar permisos" });
      return;
    }

    const r = await cambiarPermisoAcl(b.id, String(req.params.aclId), (req.body || {}).permiso);

    if (!r.ok && r.motivo === "permiso_invalido") {
      res.status(400).json({ error: "El acceso solo puede ser de lectura o de lectura y envío." });
      return;
    }
    if (!r.ok) { res.status(404).json({ error: "Permiso no encontrado" }); return; }

    // Se devuelve la fila tal como quedó GUARDADA, no lo que se pidió: la pantalla pinta el estado
    // real de la base y no su propia suposición.
    res.json({ acl: r.acl, antes: r.antes, cambio: r.cambio, updated: true });
  });

  app.delete("/api/buzones/:id/acl/:aclId", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<BuzonRow>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]);
    const b = rows[0];
    if (!b) { res.status(404).json({ error: "Buzon no encontrado" }); return; }
    const isOwner = b.owner_user_id === u.sub;
    if (!isOwner && !isAdmin(u)) { res.status(403).json({ error: "Solo el propietario puede gestionar permisos" }); return; }
    const del = await query<any>("DELETE FROM gozz.buzon_acl WHERE id = $1 AND buzon_id = $2 RETURNING id", [req.params.aclId, b.id]);
    if (del.length === 0) { res.status(404).json({ error: "Permiso no encontrado" }); return; }
    res.json({ deleted: true });
  });

  // ---------------------------------------------------------------------
  // 🔴 CAMBIAR EL PROPIETARIO — la acción de más consecuencia del módulo.
  //
  // `owner_user_id` decide quién ve el correo del buzón y quién recibe sus avisos. Hasta ahora se
  // fijaba al crear y no había forma de moverlo: si la persona se iba, su correspondencia se
  // quedaba a su nombre.
  //
  // ⚠️ Solo admin, y comprobado CONTRA LA BASE (`esAdminEnBase`, dentro del módulo), no con el
  // `isAdmin(u)` del JWT que usa el resto de este fichero. Ver el porqué allí.
  // ---------------------------------------------------------------------
  app.patch("/api/buzones/:id/propietario", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const nuevo = String(req.body?.owner_user_id ?? "").trim();
    if (!nuevo) { res.status(400).json({ error: "owner_user_id requerido" }); return; }

    // Se lee ANTES del cambio: después, `email` sigue igual pero el dueño ya no, y la notificación
    // necesita saber de qué buzón habla.
    const [antes] = await query<any>("SELECT id, email FROM gozz.buzones_email WHERE id = $1", [req.params.id]);

    const r = await cambiarPropietario(String(req.params.id), nuevo, u?.sub);
    if (!r.ok) {
      const estado =
        r.motivo === "no_encontrado" ? 404 :
        r.motivo === "sin_permiso" ? 403 : 400;
      const mensaje =
        r.motivo === "no_encontrado" ? "Buzón no encontrado" :
        r.motivo === "sin_permiso" ? "Solo un administrador puede cambiar el propietario de un buzón" :
        r.motivo === "destino_invalido" ? "El usuario indicado no existe o está inactivo" :
        r.motivo === "sin_cambio" ? "Ese buzón ya es de esa persona" :
        r.mensaje;
      res.status(estado).json({ error: mensaje });
      return;
    }

    // Después de traspasar, no antes: avisar de algo que no ocurrió sería peor que no avisar.
    if (antes) await notificarNuevoPropietario(r.nuevo, antes);
    res.json({ ok: true, owner_user_id: r.nuevo, anterior: r.anterior, acl_retirada: r.aclRetirada });
  });

  app.patch("/api/buzones/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await query<any>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]);
    const b = r[0];
    if (!b) { res.status(404).json({ error: "No encontrado" }); return; }
    if (b.owner_user_id !== u.sub && !isAdmin(u)) { res.status(403).json({ error: "Sin permiso" }); return; }
    const allowed = ["display_name","import_desde_dias","activo"];
    const fields = Object.keys(req.body || {}).filter((k) => allowed.includes(k));
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const set = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => req.body[k]);
    const upd = await query<any>(`UPDATE gozz.buzones_email SET ${set} WHERE id = $1 RETURNING id, email, display_name, import_desde_dias, activo`, [req.params.id, ...values]);
    res.json({ buzon: upd[0] });
  });

  // Config actual del buzón (para el modal "Editar conexión"). NUNCA devuelve la contraseña en claro,
  // solo si existe una guardada (has_imap_password) para poder mantenerla si el usuario no la cambia.
  app.get("/api/buzones/:id/config", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const b = (await query<any>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]))[0];
    if (!b) { res.status(404).json({ error: "No encontrado" }); return; }
    if (b.owner_user_id !== u.sub && !isAdmin(u)) { res.status(403).json({ error: "Sin permiso" }); return; }
    res.json({ config: {
      id: b.id, email: b.email, display_name: b.display_name, auth_type: b.auth_type || "password",
      imap_host: b.imap_host, imap_port: b.imap_port, imap_ssl: b.imap_ssl, imap_user: b.imap_user,
      smtp_host: b.smtp_host, smtp_port: b.smtp_port, smtp_ssl: b.smtp_ssl, smtp_user: b.smtp_user,
      import_desde_dias: b.import_desde_dias,
      has_imap_password: !!b.imap_password_enc, has_smtp_password: !!b.smtp_password_enc,
      activo: b.activo, requiere_auth_update: b.requiere_auth_update === true,
      ultimo_error: b.ultimo_error, errores_consecutivos: b.errores_consecutivos || 0,
    }});
  });

  // Editar la conexión de un buzón (host/puertos/SSL/usuario/contraseña/display/import). Prueba estricta
  // IMAP+SMTP antes de guardar (igual que crear). Si no se envía contraseña, se mantiene la actual.
  app.patch("/api/buzones/:id/connection", requireAuth, async (req: Request, res: Response) => {
   try {
    const u = (req as any).user;
    const b = (await query<any>("SELECT * FROM gozz.buzones_email WHERE id = $1", [req.params.id]))[0];
    if (!b) { res.status(404).json({ error: "No encontrado" }); return; }
    if (b.owner_user_id !== u.sub && !isAdmin(u)) { res.status(403).json({ error: "Sin permiso" }); return; }
    if (b.auth_type === "oauth" || b.auth_type === "oauth2_google") {
      res.status(400).json({ error: "Este buzón usa Google (OAuth); no tiene configuración de servidor editable. Usa Reconectar con Google." }); return;
    }
    const d = req.body || {};
    // Valores efectivos: los nuevos si vienen, si no los actuales.
    const imap_host = String(d.imap_host ?? b.imap_host).trim();
    const imap_port = Number(d.imap_port ?? b.imap_port);
    const imap_ssl = d.imap_ssl ?? b.imap_ssl;
    const imap_user = String(d.imap_user ?? b.imap_user ?? b.email).trim();
    const smtp_host = String(d.smtp_host ?? b.smtp_host).trim();
    const smtp_port = Number(d.smtp_port ?? b.smtp_port);
    const smtp_ssl = d.smtp_ssl ?? b.smtp_ssl;
    const imap_password = d.imap_password ? String(d.imap_password) : (b.imap_password_enc ? decrypt(b.imap_password_enc) : "");
    if (!imap_password) { res.status(400).json({ error: "Falta la contraseña IMAP (no hay una guardada; escríbela)." }); return; }
    const smtp_user = String((d.smtp_user ?? b.smtp_user) || imap_user).trim();
    const smtp_password = d.smtp_password ? String(d.smtp_password) : (b.smtp_password_enc ? decrypt(b.smtp_password_enc) : imap_password);

    const [imapRes, smtpRes] = await Promise.all([
      testImap({ imap_host, imap_port, imap_ssl, imap_user, imap_password }),
      testSmtp({ smtp_host, smtp_port, smtp_ssl, smtp_user, smtp_password }),
    ]);
    if (!imapRes.ok) { res.status(400).json({ error: "IMAP falló", detail: imapRes.error, imap: imapRes, smtp: smtpRes }); return; }
    if (!smtpRes.ok) { res.status(400).json({ error: "SMTP falló", detail: smtpRes.error, imap: imapRes, smtp: smtpRes }); return; }

    await query(
      `UPDATE gozz.buzones_email SET
         display_name = $2, imap_host = $3, imap_port = $4, imap_ssl = $5, imap_user = $6, imap_password_enc = $7,
         smtp_host = $8, smtp_port = $9, smtp_ssl = $10, smtp_user = $11, smtp_password_enc = $12, import_desde_dias = $13,
         activo = true, requiere_auth_update = false, errores_consecutivos = 0, ultimo_error = NULL, proximo_reintento_at = NULL
       WHERE id = $1`,
      [
        b.id, d.display_name ?? b.display_name,
        imap_host, imap_port, imap_ssl, imap_user, encrypt(imap_password),
        smtp_host, smtp_port, smtp_ssl, (d.smtp_user ?? b.smtp_user) || null,
        (d.smtp_password ? encrypt(String(d.smtp_password)) : b.smtp_password_enc),
        Number(d.import_desde_dias ?? b.import_desde_dias),
      ]
    );
    await query("UPDATE gozz.buzon_folder_state SET errores_consecutivos = 0, ultimo_error = NULL WHERE buzon_id = $1", [b.id]);
    const full = (await query<any>("SELECT * FROM gozz.buzones_email WHERE id = $1", [b.id]))[0];
    setTimeout(() => { syncBuzon(full).catch(() => {}); }, 500);
    res.json({ ok: true, buzon: { id: b.id, email: b.email } });
   } catch (e: any) {
    console.error("[PATCH /api/buzones/:id/connection]", e?.message || e);
    res.status(500).json({ error: e?.message || "Error editando la conexión" });
   }
  });

  app.delete("/api/buzones/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await query<any>("SELECT owner_user_id FROM gozz.buzones_email WHERE id = $1", [req.params.id]);
    if (!r[0]) { res.status(404).json({ error: "No encontrado" }); return; }
    if (r[0].owner_user_id !== u.sub && !isAdmin(u)) { res.status(403).json({ error: "Sin permiso" }); return; }
    await query("UPDATE gozz.buzones_email SET activo = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  });

  app.post("/api/buzones/:id/sync", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { see, buzon } = await userCanSeeBuzon(u.sub, String(req.params.id));
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }
    syncBuzon(buzon).catch((e) => console.error("[manual-sync]", e?.message));
    res.json({ queued: true });
  });

  app.get("/api/buzones/:id/emails", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { see, buzon } = await userCanSeeBuzon(u.sub, String(req.params.id));
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }
    const folder = (req.query.folder as string) || "INBOX";
    const q = (req.query.q as string) || "";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await query<any>(
      q
        ? `SELECT id, buzon_id, from_addr, from_name, to_addrs, subject, body_text, leido, direccion, contacto_id, oportunidad_id, fecha_email, carpeta
           FROM gozz.emails WHERE buzon_id = $1 AND carpeta = $2 AND (subject ILIKE $3 OR from_addr ILIKE $3 OR body_text ILIKE $3) ORDER BY fecha_email DESC LIMIT $4`
        : `SELECT id, buzon_id, from_addr, from_name, to_addrs, subject, body_text, leido, direccion, contacto_id, oportunidad_id, fecha_email, carpeta
           FROM gozz.emails WHERE buzon_id = $1 AND carpeta = $2 ORDER BY fecha_email DESC LIMIT $3`,
      q ? [buzon.id, folder, `%${q}%`, limit] : [buzon.id, folder, limit]
    );
    res.json({ emails: rows });
  });

  app.get("/api/emails/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT * FROM gozz.emails WHERE id = $1", [req.params.id]);
    const e = rows[0];
    if (!e) { res.status(404).json({ error: "No encontrado" }); return; }
    const { see } = await userCanSeeBuzon(u.sub, e.buzon_id);
    if (!see) { res.status(403).json({ error: "Sin acceso" }); return; }
    await query("UPDATE gozz.emails SET leido = true WHERE id = $1", [req.params.id]);
    res.json({ email: { ...e, body_html_safe: e.body_html ? sanitize(e.body_html) : null } });
  });

  // GET /api/emails/:id/adjuntos/:idx — trae un adjunto desde IMAP bajo demanda.
  //   ?dl=1  → descarga (Content-Disposition: attachment).  default → inline (preview).
  // Funciona para cualquier correo (entrante / saliente / reenviado) que siga en el
  // servidor IMAP. Los bytes no se guardan en DB, por eso se recuperan al vuelo.
  app.get("/api/emails/:id/adjuntos/:idx", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const idx = parseInt(String(req.params.idx), 10);
    if (!Number.isInteger(idx) || idx < 0) { res.status(400).json({ error: "Índice inválido" }); return; }

    const rows = await query<any>(
      "SELECT id, buzon_id, imap_uid, carpeta, message_id, adjuntos FROM gozz.emails WHERE id = $1",
      [req.params.id]
    );
    const e = rows[0];
    if (!e) { res.status(404).json({ error: "Correo no encontrado" }); return; }

    const { see, buzon } = await userCanSeeBuzon(u.sub, e.buzon_id);
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }

    const meta: any[] = Array.isArray(e.adjuntos) ? e.adjuntos : [];
    if (idx >= meta.length) { res.status(404).json({ error: "Adjunto inexistente" }); return; }
    const wantName: string | null = meta[idx]?.name || meta[idx]?.filename || null;

    let client: ImapFlow;
    try { client = await buildImapClient(buzon); }
    catch (err: any) { res.status(502).json({ error: "No se pudo preparar la conexión al buzón", detail: err?.message }); return; }

    try {
      await client.connect();
      const folderReal = await resolveImapFolder(buzon, e.carpeta);
      let parsed: ParsedMail | null = null;
      const lock = await (client as any).getMailboxLock(folderReal);
      try {
        // 1) Por UID (entrantes y salientes/reenviados sincronizados del servidor).
        if (e.imap_uid) {
          const msg = await (client as any).fetchOne(String(e.imap_uid), { source: true }, { uid: true });
          if (msg && msg.source) parsed = await simpleParser(msg.source as Buffer);
        }
        // 2) Fallback por Message-ID (p.ej. enviados compuestos en la app, sin imap_uid).
        if (!parsed && e.message_id) {
          const found = await client.search({ header: { "message-id": e.message_id } } as any, { uid: true });
          const uid = Array.isArray(found) && found.length ? found[found.length - 1] : null;
          if (uid) {
            const msg = await (client as any).fetchOne(String(uid), { source: true }, { uid: true });
            if (msg && msg.source) parsed = await simpleParser(msg.source as Buffer);
          }
        }
      } finally {
        lock.release();
      }

      if (!parsed) { res.status(410).json({ error: "El mensaje ya no está disponible en el servidor" }); return; }

      const atts = (parsed.attachments || []) as any[];
      // Preferimos el índice (mismo orden que la metadata guardada); si el nombre no
      // coincide, intentamos casar por filename como respaldo.
      let att: any = atts[idx];
      if ((!att || (wantName && att.filename && att.filename !== wantName)) && wantName) {
        const byName = atts.find((a: any) => a.filename === wantName);
        if (byName) att = byName;
      }
      if (!att || !att.content) { res.status(404).json({ error: "Adjunto no encontrado en el mensaje" }); return; }

      const buf: Buffer = att.content as Buffer;
      const ctype = att.contentType || meta[idx]?.content_type || "application/octet-stream";
      const fname = att.filename || wantName || `adjunto-${idx}`;
      const disp = req.query.dl === "1" ? "attachment" : "inline";
      res.setHeader("Content-Type", ctype);
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader(
        "Content-Disposition",
        `${disp}; filename="${asciiFilename(fname)}"; filename*=UTF-8''${encodeURIComponent(fname)}`
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(buf);
    } catch (err: any) {
      if (!res.headersSent) res.status(502).json({ error: "Error al recuperar el adjunto", detail: err?.message });
    } finally {
      try { await client.logout(); } catch { try { (client as any).close(); } catch {} }
    }
  });

  app.patch("/api/emails/:id/link", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT buzon_id FROM gozz.emails WHERE id = $1", [req.params.id]);
    const e = rows[0];
    if (!e) { res.status(404).json({ error: "No encontrado" }); return; }
    const { see } = await userCanSeeBuzon(u.sub, e.buzon_id);
    if (!see) { res.status(403).json({ error: "Sin acceso" }); return; }
    const { contacto_id, oportunidad_id } = req.body || {};
    const upd = await query<any>(
      "UPDATE gozz.emails SET contacto_id = $1, oportunidad_id = $2 WHERE id = $3 RETURNING *",
      [contacto_id || null, oportunidad_id || null, req.params.id]
    );
    res.json({ email: upd[0] });
  });

  app.post("/api/buzones/:id/send", requireAuth, emailUpload.array("attachment", 10), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { see, send, buzon } = await userCanSeeBuzon(u.sub, String(req.params.id));
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }
    if (!send) { res.status(403).json({ error: "No autorizado a enviar" }); return; }

    // Soporta JSON o multipart. Cuando es multipart, los arrays vienen como "to[]" o como strings separados por coma.
    const pick = (k: string) => {
      const v = (req.body as any)?.[k];
      if (v === undefined || v === null) return undefined;
      if (Array.isArray(v)) return v;
      if (typeof v === "string") {
        if (k === "to" || k === "cc" || k === "bcc") {
          return v.split(",").map((s) => s.trim()).filter(Boolean);
        }
        return v;
      }
      return v;
    };

    const to = pick("to");
    const cc = pick("cc");
    const bcc = pick("bcc");
    const subject = pick("subject");
    const body_html = pick("body_html");
    const body_text = pick("body_text");
    const in_reply_to = pick("in_reply_to");
    const oportunidad_id = pick("oportunidad_id");
    const contacto_id = pick("contacto_id");

    if (!to || !subject) { res.status(400).json({ error: "to y subject requeridos" }); return; }

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const attachments = files.map((f) => ({
      filename: f.originalname,
      content: f.buffer,
      contentType: f.mimetype,
    }));

    const smtpUser = buzon.smtp_user || buzon.imap_user;
    let transport: any;
    if (buzon.auth_type === "oauth2_google") {
      const cfg = googleOAuthConfig();
      const accessToken = await getGoogleAccessTokenForBuzon(buzon);
      const refreshToken = decrypt(buzon.oauth_refresh_token_enc!);
      transport = nodemailer.createTransport({
        host: buzon.smtp_host, port: buzon.smtp_port, secure: buzon.smtp_ssl,
        auth: {
          type: "OAuth2",
          user: smtpUser,
          clientId: cfg?.clientId,
          clientSecret: cfg?.clientSecret,
          refreshToken,
          accessToken,
        },
      });
    } else {
      const smtpPassEnc = buzon.smtp_password_enc || buzon.imap_password_enc;
      if (!smtpPassEnc) { res.status(400).json({ error: "Buzon sin credenciales" }); return; }
      const pass = decrypt(smtpPassEnc);
      transport = nodemailer.createTransport({
        host: buzon.smtp_host, port: buzon.smtp_port, secure: buzon.smtp_ssl,
        auth: { user: smtpUser, pass },
      });
    }
    try {
      const info = await transport.sendMail({
        from: { name: buzon.display_name || buzon.email, address: buzon.email },
        to, cc, bcc, subject,
        text: body_text || undefined, html: body_html ? sanitize(body_html) : undefined,
        inReplyTo: in_reply_to || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      const tos = Array.isArray(to) ? to : [to];
      const adjuntosMeta = files.map((f) => ({ name: f.originalname, size: f.size, content_type: f.mimetype }));
      await query(
        `INSERT INTO gozz.emails (buzon_id, message_id, direccion, from_addr, from_name, to_addrs, cc_addrs, subject, body_html, body_text, adjuntos, carpeta, contacto_id, oportunidad_id, fecha_email)
         VALUES ($1,$2,'saliente',$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,'SENT',$11,$12,NOW())`,
        [
          buzon.id, info.messageId, buzon.email, buzon.display_name,
          JSON.stringify(tos.map((t: string) => ({ address: t }))),
          JSON.stringify((cc ? (Array.isArray(cc) ? cc : [cc]) : []).map((t: string) => ({ address: t }))),
          subject, body_html || null, body_text || null,
          JSON.stringify(adjuntosMeta),
          contacto_id || null, oportunidad_id || null,
        ]
      );
      res.json({ ok: true, message_id: info.messageId, attachments: attachments.length });
    } catch (e: any) {
      res.status(500).json({ error: "SMTP send failed", detail: e?.message });
    }
  });


  app.patch("/api/emails/bulk", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { ids, leido } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0 || typeof leido !== "boolean") {
      res.status(400).json({ error: "ids[] y leido:boolean requeridos" }); return;
    }
    // Solo puede tocar emails de buzones que puede ver
    const rows = await query<any>("SELECT id, buzon_id FROM gozz.emails WHERE id = ANY($1::uuid[])", [ids]);
    const allowed: string[] = [];
    const buzonCache = new Map<string, boolean>();
    for (const r of rows) {
      if (!buzonCache.has(r.buzon_id)) {
        const { see } = await userCanSeeBuzon(u.sub, r.buzon_id);
        buzonCache.set(r.buzon_id, see);
      }
      if (buzonCache.get(r.buzon_id)) allowed.push(r.id);
    }
    if (allowed.length === 0) { res.json({ updated: 0 }); return; }
    await query("UPDATE gozz.emails SET leido = $1 WHERE id = ANY($2::uuid[])", [leido, allowed]);
    res.json({ updated: allowed.length });
  });

  // Búsqueda instantánea (type-ahead) para el modal del buscador: liviana y rápida.
  // Busca SOLO en asunto + remitente (campos cortos, sin escanear body_text) y
  // devuelve un payload mínimo con snippet. ~2ms incluso en buzones grandes.
  app.get("/api/buzones/:id/search", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { see, buzon } = await userCanSeeBuzon(u.sub, String(req.params.id));
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }
    const term = ((req.query.q as string) || "").trim();
    if (term.length < 2) { res.json({ emails: [] }); return; }
    const folder = (req.query.folder as string) || "";
    const limit = Math.min(Number(req.query.limit) || 15, 40);
    const like = `%${term}%`;
    const rows = await query<any>(
      `SELECT id, from_addr, from_name, subject, fecha_email, leido, direccion, carpeta,
              left(coalesce(body_text,''), 140) AS snippet
         FROM gozz.emails
        WHERE buzon_id = $1
          ${folder ? "AND carpeta = $4" : ""}
          AND (subject ILIKE $2 OR from_addr ILIKE $2 OR COALESCE(from_name,'') ILIKE $2)
        ORDER BY fecha_email DESC
        LIMIT $3`,
      folder ? [buzon.id, like, limit, folder] : [buzon.id, like, limit]
    );
    res.json({ emails: rows });
  });

  app.post("/api/buzones/:id/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { see, buzon } = await userCanSeeBuzon(u.sub, String(req.params.id));
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }
    const folder = (req.body?.folder as string) || "INBOX";
    const r = await query<any>(
      "UPDATE gozz.emails SET leido = true WHERE buzon_id = $1 AND carpeta = $2 AND leido = false RETURNING id",
      [buzon.id, folder]
    );
    res.json({ updated: r.length });
  });

  app.get("/api/buzones/:id/unread-count", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { see, buzon } = await userCanSeeBuzon(u.sub, String(req.params.id));
    if (!see || !buzon) { res.status(403).json({ error: "Sin acceso" }); return; }
    const folder = (req.query.folder as string) || "INBOX";
    const r = await query<any>(
      "SELECT COUNT(*)::int AS n FROM gozz.emails WHERE buzon_id = $1 AND carpeta = $2 AND leido = false",
      [buzon.id, folder]
    );
    res.json({ unread: r[0]?.n || 0 });
  });

  app.get("/api/emails", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const buzones = await listVisibleBuzones(u.sub);
    if (buzones.length === 0) { res.json({ emails: [] }); return; }
    const ids = buzones.map((b) => b.id);
    const contactoId = req.query.contacto_id as string | undefined;
    const oppId = req.query.oportunidad_id as string | undefined;
    const email = req.query.email as string | undefined;
    let sql = `SELECT id, buzon_id, from_addr, from_name, to_addrs, subject, body_text, leido, direccion, contacto_id, oportunidad_id, carpeta, fecha_email
               FROM gozz.emails WHERE buzon_id = ANY($1::uuid[])`;
    const params: any[] = [ids];
    if (contactoId) { sql += ` AND contacto_id = $${params.length + 1}`; params.push(contactoId); }
    if (oppId) { sql += ` AND oportunidad_id = $${params.length + 1}`; params.push(oppId); }
    if (email) { sql += ` AND (LOWER(from_addr) = LOWER($${params.length + 1}) OR LOWER(to_addrs::text) LIKE LOWER($${params.length + 2}))`; params.push(email); params.push("%" + email + "%"); }
    sql += " ORDER BY fecha_email DESC LIMIT 200";
    const rows = await query<any>(sql, params);
    res.json({ emails: rows });
  });
}
