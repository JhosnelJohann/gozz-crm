// Avisos de GOZZ → n8n, de nivel producción (Parte G).
//
// Antes: un `fetch` suelto por regla, sin firma ni reintento. Si n8n estaba caído o tardaba más
// de 8 s, el aviso se perdía sin rastro. Ahora cada aviso:
//   · se guarda primero en `gozz.webhook_entregas` (nada se pierde aunque n8n esté caído);
//   · se intenta entregar al instante y, si falla, el cron lo reintenta a 1, 5 y 30 minutos;
//   · va FIRMADO con HMAC-SHA256 (`X-Gozz-Signature: t=<unix>,v1=<hex>`), para que el workflow
//     pueda rechazar cualquier llamada que no venga de este CRM (ver docs/N8N-INTEGRACION.md);
//   · lleva un contexto estable y completo (conversación, contacto, teléfono E.164, etapa,
//     etiquetas, últimos mensajes), así un agente de IA puede responder sin consultar nada más.
import crypto from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { query } from "../../shared/db.js";
import * as whatsappRepo from "../whatsapp/whatsapp.repository.js";

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "";
const TIMEOUT_MS = 10_000;
/** Espera antes del 2.º, 3.º y 4.º intento. Tras el 4.º fallo la entrega queda "fallida". */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_INTENTOS = BACKOFF_MS.length + 1;
const CONTEXTO_MENSAJES = 10;

export const EVENTOS_SUSCRIBIBLES = ["mensaje.recibido", "mensaje.estado", "conversacion.etapa", "conversacion.asignada"] as const;
export type EventoN8n = (typeof EVENTOS_SUSCRIBIBLES)[number] | "regla.disparada";

export interface Entrega {
  id: string;
  agente_id: string;
  url: string;
  evento: string;
  payload: Record<string, unknown>;
  estado: "pendiente" | "entregado" | "fallido";
  intentos: number;
  ultimo_status: number | null;
  ultimo_error: string | null;
}

// ---------------------------------------------------------------------------
// Firma
// ---------------------------------------------------------------------------

/** `t=<unix>,v1=<hex(HMAC-SHA256(secret, "<t>.<body>"))>` — mismo esquema que Stripe: el
 * timestamp dentro de lo firmado evita que una llamada capturada se pueda repetir más tarde. */
export function firmar(body: string, t: number = Math.floor(Date.now() / 1000), secret: string = N8N_WEBHOOK_SECRET): string {
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Verificación (la usa n8n del otro lado; se exporta para las pruebas y como referencia). */
export function verificarFirma(body: string, cabecera: string, secret: string = N8N_WEBHOOK_SECRET, toleranciaSeg = 300): boolean {
  const partes = Object.fromEntries(cabecera.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(partes.t);
  if (!t || !partes.v1 || Math.abs(Date.now() / 1000 - t) > toleranciaSeg) return false;
  const esperado = Buffer.from(firmar(body, t, secret).split("v1=")[1], "hex");
  const recibido = Buffer.from(partes.v1, "hex");
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

function e164(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [parte, servidor] = jid.split("@");
  if (servidor === "lid" || servidor === "g.us") return null;
  const p = parsePhoneNumberFromString(`+${(parte || "").replace(/\D/g, "")}`);
  return p?.isValid() ? p.number : null;
}

/** Foto completa de la conversación para el agente de IA. Forma estable y documentada en
 * docs/N8N-INTEGRACION.md — cambiarla rompe workflows ya armados. */
export async function construirContexto(conversacionId: string) {
  const c = await whatsappRepo.getConversacion(conversacionId);
  if (!c) return null;
  const [etapas, tags, mensajes, contacto] = await Promise.all([
    whatsappRepo.listEtapas(),
    whatsappRepo.tagsDeConversacion(conversacionId),
    whatsappRepo.listMensajes(conversacionId, CONTEXTO_MENSAJES),
    c.contacto_id
      ? query<{ id: string; nombre_completo: string; email: string | null }>(
          "SELECT id, nombre_completo, email FROM gozz.contactos_cache WHERE id = $1", [c.contacto_id]
        ).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const etapa = etapas.find((e) => e.id === c.etapa_id);
  return {
    conversacion: {
      id: c.id,
      conexion_id: c.conexion_id,
      es_grupo: c.wa_jid.endsWith("@g.us"),
      nombre: c.nombre_whatsapp,
      telefono: e164(c.telefono_real) ?? e164(c.wa_jid),
      etapa: etapa ? { id: etapa.id, key: etapa.key, label: etapa.label } : null,
      etiquetas: tags.map((t) => ({ id: t.id, nombre: t.nombre })),
      asignado_a: c.asignado_a,
      no_leidos: c.no_leidos_count,
    },
    contacto,
    ultimos_mensajes: mensajes.map((m) => ({
      id: m.id,
      direccion: m.direccion,
      tipo: m.tipo,
      contenido: m.contenido,
      archivo_url: m.archivo_url,
      estado: m.estado_entrega,
      fecha: m.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Cola de entregas
// ---------------------------------------------------------------------------

async function intentarEntrega(e: Entrega): Promise<Entrega> {
  const body = JSON.stringify({ evento: e.evento, entrega_id: e.id, enviado_at: new Date().toISOString(), ...e.payload });
  let status: number | null = null;
  let error: string | null = null;
  try {
    const r = await fetch(e.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gozz-Event": e.evento,
        "X-Gozz-Delivery": e.id,
        "X-Gozz-Signature": firmar(body),
        // Compatibilidad con los workflows armados antes de la firma (comparaban este secreto).
        "X-Gozz-Secret": N8N_WEBHOOK_SECRET,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = r.status;
    if (!r.ok) error = `HTTP ${r.status}`;
  } catch (err: any) {
    error = err?.name === "TimeoutError" ? `Sin respuesta en ${TIMEOUT_MS / 1000}s` : (err?.message || "Error de red");
  }

  const intentos = e.intentos + 1;
  const ok = !error;
  const estado = ok ? "entregado" : intentos >= MAX_INTENTOS ? "fallido" : "pendiente";
  const espera = ok ? 0 : BACKOFF_MS[Math.min(intentos - 1, BACKOFF_MS.length - 1)];
  const rows = await query<Entrega>(
    `UPDATE gozz.webhook_entregas
        SET estado = $2, intentos = $3, ultimo_status = $4, ultimo_error = $5,
            proximo_intento_at = NOW() + ($6 || ' milliseconds')::interval,
            entregado_at = CASE WHEN $2 = 'entregado' THEN NOW() ELSE entregado_at END
      WHERE id = $1 RETURNING *`,
    [e.id, estado, intentos, status, error, String(espera)]
  );
  if (!ok) console.error(`[n8n] entrega ${e.id} (${e.evento}) falló, intento ${intentos}/${MAX_INTENTOS}: ${error}`);
  return rows[0];
}

/** Guarda el aviso y lo intenta entregar de inmediato. Nunca lanza: un n8n caído no puede
 * tumbar el flujo de WhatsApp que lo originó (el cron reintenta). */
export async function encolar(agenteId: string, url: string, evento: EventoN8n, payload: Record<string, unknown>): Promise<Entrega | null> {
  try {
    const rows = await query<Entrega>(
      `INSERT INTO gozz.webhook_entregas (agente_id, url, evento, payload) VALUES ($1, $2, $3, $4) RETURNING *`,
      [agenteId, url, evento, JSON.stringify(payload)]
    );
    return await intentarEntrega(rows[0]);
  } catch (e: any) {
    console.error("[n8n] no se pudo encolar el aviso:", e?.message || e);
    return null;
  }
}

/** Cron: reintenta lo vencido. Reserva cada fila corriendo su próximo intento 2 min (lease) antes
 * de entregarla, así dos procesos no la mandan dos veces. */
export async function procesarPendientes(limite = 25): Promise<number> {
  const vencidas = await query<Entrega>(
    `UPDATE gozz.webhook_entregas SET proximo_intento_at = NOW() + interval '2 minutes'
      WHERE id IN (
        SELECT id FROM gozz.webhook_entregas
         WHERE estado = 'pendiente' AND proximo_intento_at <= NOW()
         ORDER BY proximo_intento_at LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limite]
  );
  for (const e of vencidas) await intentarEntrega(e);
  return vencidas.length;
}

/** Avisa `evento` a todo agente de IA activo con webhook que esté suscrito a él. */
export async function emitir(evento: Exclude<EventoN8n, "regla.disparada">, conversacionId: string, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    const agentes = await query<{ id: string; n8n_webhook_url: string }>(
      `SELECT id, n8n_webhook_url FROM gozz.users
        WHERE es_agente_ia = true AND activo = true AND n8n_webhook_url IS NOT NULL AND $1 = ANY(n8n_eventos)`,
      [evento]
    );
    if (!agentes.length) return;
    const contexto = await construirContexto(conversacionId);
    if (!contexto) return;
    await Promise.all(agentes.map((a) => encolar(a.id, a.n8n_webhook_url, evento, { ...extra, ...contexto, agente_id: a.id })));
  } catch (e: any) {
    console.error(`[n8n] no se pudo emitir ${evento}:`, e?.message || e);
  }
}
