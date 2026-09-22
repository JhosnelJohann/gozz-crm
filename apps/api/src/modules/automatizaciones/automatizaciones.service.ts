// Capa de negocio de Automatizaciones (Fase 2 del rediseño de WhatsApp): agentes de IA de n8n
// como "asignados", reglas por etapa/etiqueta, y recordatorios programados por WhatsApp/correo.
// Entrega separada de la Parte 1 (WhatsApp), acordada explícitamente así con Sandro.
import * as repo from "./automatizaciones.repository.js";
import * as whatsappRepo from "../whatsapp/whatsapp.repository.js";
import * as whatsappService from "../whatsapp/whatsapp.service.js";
import { enviarEmailSimple } from "../../lib/enviar-email-simple.js";

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "";

// ---------------------------------------------------------------------------
// Agentes de IA
// ---------------------------------------------------------------------------

export const listarAgentesIA = repo.listAgentesIA;

export async function crearAgenteIA(nombre: string, email: string, n8nWebhookUrl: string | null) {
  return repo.crearAgenteIA(nombre, email, n8nWebhookUrl);
}

export async function actualizarAgenteIA(id: string, d: { nombre?: string; n8nWebhookUrl?: string | null; activo?: boolean }) {
  const actualizado = await repo.actualizarAgenteIA(id, d);
  if (!actualizado) throw new Error("Agente de IA no encontrado");
  return actualizado;
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

export const listarReglas = repo.listReglas;

export async function crearRegla(d: repo.NuevaRegla) {
  const agente = await repo.getAgenteIA(d.agenteId);
  if (!agente) throw new Error("El asignado de la regla debe ser un agente de IA");
  if (!d.etapaId && !d.tagId) throw new Error("La regla necesita al menos una condición (etapa o etiqueta)");
  return repo.crearRegla(d);
}

export async function actualizarRegla(id: string, d: Partial<repo.NuevaRegla> & { activa?: boolean }) {
  if (d.agenteId) {
    const agente = await repo.getAgenteIA(d.agenteId);
    if (!agente) throw new Error("El asignado de la regla debe ser un agente de IA");
  }
  const actualizada = await repo.actualizarRegla(id, d);
  if (!actualizada) throw new Error("Regla no encontrada");
  return actualizada;
}

export async function eliminarRegla(id: string) {
  await repo.eliminarRegla(id);
}

/**
 * Se llama por cada mensaje ENTRANTE de WhatsApp (ver el LISTEN de `whatsapp_evento` en
 * `index.ts`) — nunca por mensajes salientes, para no re-disparar la regla con lo que el propio
 * agente responde. Busca la regla activa más específica para la etapa/etiquetas actuales de la
 * conversación y, si hay una: opcionalmente la asigna al agente, y si el agente tiene un webhook
 * de n8n configurado, le avisa. Nunca lanza — un fallo aquí no debe tumbar el puente de tiempo
 * real de WhatsApp que lo llama.
 */
export async function evaluarReglasParaMensaje(conversacionId: string, mensaje: { direccion: string; contenido: string | null; tipo: string }): Promise<void> {
  if (mensaje.direccion !== "entrante") return;
  try {
    const conversacion = await whatsappRepo.getConversacion(conversacionId);
    if (!conversacion) return;
    const tags = await whatsappRepo.tagsDeConversacion(conversacionId);
    const regla = await repo.buscarReglaParaConversacion(conversacion.etapa_id, tags.map((t) => t.id));
    if (!regla || !regla.agente_activo) return;

    if (regla.asignar_conversacion && conversacion.asignado_a !== regla.agente_id) {
      await whatsappService.asignar(conversacionId, regla.agente_id);
    }

    if (regla.agente_webhook_url) {
      await notificarAgenteN8n(regla.agente_webhook_url, {
        conversacion_id: conversacionId,
        agente_id: regla.agente_id,
        regla: regla.nombre,
        mensaje: { tipo: mensaje.tipo, contenido: mensaje.contenido },
      });
    }
  } catch (e: any) {
    console.error("[automatizaciones] error evaluando reglas:", e?.message || e);
  }
}

async function notificarAgenteN8n(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gozz-Secret": N8N_WEBHOOK_SECRET },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e: any) {
    console.error("[automatizaciones] no se pudo notificar al webhook de n8n:", e?.message || e);
  }
}

/** El workflow de n8n llama esto para responder EN NOMBRE del agente de IA — reutiliza el mismo
 * `enviarMensaje` que usa cualquier agente humano, así que el mensaje sale, se ve, y se cuenta
 * exactamente igual (mismo estado de entrega, mismo socket en vivo). */
export async function recibirRespuestaAgente(conversacionId: string, agenteId: string, contenido: string) {
  const agente = await repo.getAgenteIA(agenteId);
  if (!agente) throw new Error("Agente de IA no encontrado");
  if (!agente.activo) throw new Error("Agente de IA desactivado");
  return whatsappService.enviarMensaje(conversacionId, agenteId, { tipo: "texto", contenido });
}

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------

export const listarRecordatorios = repo.listRecordatorios;

export async function crearRecordatorio(d: repo.NuevoRecordatorio) {
  if (d.canal === "whatsapp" && !d.conversacionId) throw new Error("Falta la conversación para un recordatorio de WhatsApp");
  if (d.canal === "email" && (!d.contactoId || !d.buzonId)) throw new Error("Falta el contacto o el buzón para un recordatorio de correo");
  if (new Date(d.programadoPara).getTime() <= Date.now()) throw new Error("La fecha programada debe ser en el futuro");
  return repo.crearRecordatorio(d);
}

export async function cancelarRecordatorio(id: string) {
  const cancelado = await repo.cancelarRecordatorio(id);
  if (!cancelado) throw new Error("El recordatorio ya se envió o no existe");
}

/** Llamado por el cron cada 60s (ver automatizaciones.cron.ts) — un fallo en UNO no debe frenar
 * al resto de la tanda. */
export async function procesarRecordatoriosPendientes(): Promise<void> {
  const pendientes = await repo.listRecordatoriosPendientes();
  for (const r of pendientes) {
    try {
      if (r.canal === "whatsapp") {
        await whatsappService.enviarMensaje(r.conversacion_id!, r.creado_por, { tipo: "texto", contenido: r.mensaje });
      } else {
        const contacto = await repo.getContactoParaRecordatorio(r.contacto_id!);
        if (!contacto?.email) throw new Error("El contacto no tiene correo registrado");
        await enviarEmailSimple(r.buzon_id!, {
          to: contacto.email,
          subject: r.asunto || "Recordatorio",
          html: `<p>${r.mensaje.replace(/\n/g, "<br/>")}</p>`,
        });
      }
      await repo.marcarRecordatorioEnviado(r.id);
    } catch (e: any) {
      await repo.marcarRecordatorioError(r.id, e?.message || "Error desconocido");
    }
  }
}
