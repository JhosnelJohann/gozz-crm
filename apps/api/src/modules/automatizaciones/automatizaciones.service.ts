// Capa de negocio de Automatizaciones (Fase 2 del rediseño de WhatsApp): agentes de IA de n8n
// como "asignados", reglas por etapa/etiqueta, y recordatorios programados por WhatsApp/correo.
// Entrega separada de la Parte 1 (WhatsApp), acordada explícitamente así con Sandro.
import * as repo from "./automatizaciones.repository.js";
import * as whatsappRepo from "../whatsapp/whatsapp.repository.js";
import * as whatsappService from "../whatsapp/whatsapp.service.js";
import { enviarEmailSimple } from "../../lib/enviar-email-simple.js";
import * as n8n from "./n8n-webhooks.js";

// ---------------------------------------------------------------------------
// Agentes de IA
// ---------------------------------------------------------------------------

export const listarAgentesIA = repo.listAgentesIA;

export async function crearAgenteIA(nombre: string, email: string, n8nWebhookUrl: string | null, n8nEventos: string[] = []) {
  return repo.crearAgenteIA(nombre, email, n8nWebhookUrl, n8nEventos);
}

export async function actualizarAgenteIA(id: string, d: { nombre?: string; n8nWebhookUrl?: string | null; activo?: boolean; n8nEventos?: string[] }) {
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
      // Cola firmada con reintentos (n8n-webhooks.ts). `conversacion_id`/`agente_id`/`regla`/
      // `mensaje` se mantienen en la raíz: los workflows armados antes de esto los leen así.
      const contexto = await n8n.construirContexto(conversacionId);
      await n8n.encolar(regla.agente_id, regla.agente_webhook_url, "regla.disparada", {
        conversacion_id: conversacionId,
        agente_id: regla.agente_id,
        regla: regla.nombre,
        mensaje: { tipo: mensaje.tipo, contenido: mensaje.contenido },
        ...(contexto ?? {}),
      });
    }
  } catch (e: any) {
    console.error("[automatizaciones] error evaluando reglas:", e?.message || e);
  }
}

/** El workflow de n8n llama esto para responder EN NOMBRE del agente de IA — reutiliza el mismo
 * `enviarMensaje` que usa cualquier agente humano, así que el mensaje sale, se ve, y se cuenta
 * exactamente igual (mismo estado de entrega, mismo socket en vivo). */
export async function recibirRespuestaAgente(
  conversacionId: string,
  agenteId: string,
  contenido: string | null,
  media?: { tipo: "imagen" | "video" | "audio" | "archivo"; archivoUrl: string; archivoNombre: string; archivoTamanio: number }
) {
  const agente = await repo.getAgenteIA(agenteId);
  if (!agente) throw new Error("Agente de IA no encontrado");
  if (!agente.activo) throw new Error("Agente de IA desactivado");
  if (!(await whatsappRepo.getConversacion(conversacionId))) throw new Error("Conversación no encontrada");
  if (media) {
    return whatsappService.enviarMensaje(conversacionId, agenteId, {
      tipo: media.tipo, contenido, archivoUrl: media.archivoUrl, archivoNombre: media.archivoNombre, archivoTamanio: media.archivoTamanio,
    });
  }
  if (!contenido?.trim()) throw new Error("El mensaje está vacío");
  return whatsappService.enviarMensaje(conversacionId, agenteId, { tipo: "texto", contenido });
}

// ---------------------------------------------------------------------------
// Acciones de n8n sobre una conversación (API /api/n8n/*)
// ---------------------------------------------------------------------------

/** Etapa por id o por key (`apertura`, `oferta`...) — en n8n es más cómodo escribir la key. */
export async function n8nCambiarEtapa(conversacionId: string, etapa: { id?: string; key?: string }) {
  const etapas = await whatsappRepo.listEtapas();
  const destino = etapas.find((e) => (etapa.id && e.id === etapa.id) || (etapa.key && e.key === etapa.key));
  if (!destino) throw new Error("Etapa no encontrada");
  if (!(await whatsappRepo.getConversacion(conversacionId))) throw new Error("Conversación no encontrada");
  return whatsappService.cambiarEtapa(conversacionId, destino.id);
}

/** Etiqueta por id o por nombre (sin distinguir mayúsculas). Con `crear`, una etiqueta que no
 * existe se crea — útil para que la IA clasifique ("interesado", "precio") sin configurar antes. */
export async function n8nEtiquetar(conversacionId: string, d: { tagId?: string; nombre?: string; accion: "agregar" | "quitar"; crear?: boolean }) {
  if (!(await whatsappRepo.getConversacion(conversacionId))) throw new Error("Conversación no encontrada");
  const tags = await whatsappRepo.listTags();
  let tag = tags.find((t) => (d.tagId && t.id === d.tagId) || (d.nombre && t.nombre.toLowerCase() === d.nombre.trim().toLowerCase()));
  if (!tag && d.accion === "agregar" && d.crear && d.nombre) tag = await whatsappService.crearTag(d.nombre.trim(), "#5750E8");
  if (!tag) throw new Error("Etiqueta no encontrada");
  return d.accion === "agregar" ? whatsappService.agregarTag(conversacionId, tag.id) : whatsappService.quitarTag(conversacionId, tag.id);
}

/** Asignar a un usuario (o a otro agente), o `null` para soltarla — "pasar a humano". */
export async function n8nAsignar(conversacionId: string, usuarioId: string | null) {
  if (!(await whatsappRepo.getConversacion(conversacionId))) throw new Error("Conversación no encontrada");
  if (usuarioId) {
    const u = await repo.usuarioActivo(usuarioId);
    if (!u) throw new Error("Usuario no encontrado o inactivo");
  }
  return whatsappService.asignar(conversacionId, usuarioId);
}

export const n8nContexto = n8n.construirContexto;
export const emitirEventoN8n = n8n.emitir;
export const procesarEntregasN8n = n8n.procesarPendientes;

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
