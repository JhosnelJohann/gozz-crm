import { z } from "zod";

const EventosN8nSchema = z.array(z.enum(["mensaje.recibido", "mensaje.estado", "conversacion.etapa", "conversacion.asignada"])).max(4);

export const CrearAgenteIASchema = z.object({
  nombre: z.string().min(2).max(100),
  email: z.string().email(),
  n8nWebhookUrl: z.string().url().nullable().optional(),
  n8nEventos: EventosN8nSchema.optional(),
});

export const ActualizarAgenteIASchema = z.object({
  nombre: z.string().min(2).max(100).optional(),
  n8nWebhookUrl: z.string().url().nullable().optional(),
  activo: z.boolean().optional(),
  n8nEventos: EventosN8nSchema.optional(),
});

export const CrearReglaSchema = z.object({
  nombre: z.string().min(2).max(100),
  etapaId: z.string().uuid().nullable().optional(),
  tagId: z.string().uuid().nullable().optional(),
  agenteId: z.string().uuid(),
  asignarConversacion: z.boolean().default(true),
});

export const ActualizarReglaSchema = z.object({
  nombre: z.string().min(2).max(100).optional(),
  etapaId: z.string().uuid().nullable().optional(),
  tagId: z.string().uuid().nullable().optional(),
  agenteId: z.string().uuid().optional(),
  asignarConversacion: z.boolean().optional(),
  activa: z.boolean().optional(),
});

export const CrearRecordatorioSchema = z.object({
  canal: z.enum(["whatsapp", "email"]),
  conversacionId: z.string().uuid().nullable().optional(),
  contactoId: z.string().uuid().nullable().optional(),
  buzonId: z.string().uuid().nullable().optional(),
  asunto: z.string().max(200).nullable().optional(),
  mensaje: z.string().min(1).max(4096),
  programadoPara: z.string().datetime({ offset: true }).or(z.string().min(1)),
});

/** Body del webhook entrante de n8n — el workflow contesta EN NOMBRE del agente de IA. */
export const RespuestaAgenteSchema = z.object({
  conversacion_id: z.string().uuid(),
  agente_id: z.string().uuid(),
  contenido: z.string().min(1).max(4096),
});

// ---- API para n8n (/api/n8n/*) ----

/** Texto, o media por URL pública (n8n la genera o la toma de otro servicio): GOZZ la descarga y
 * la manda como adjunto real — las notas de voz salen como nota de voz. */
export const N8nEnviarMensajeSchema = z.object({
  agente_id: z.string().uuid(),
  tipo: z.enum(["texto", "imagen", "video", "audio", "archivo"]).default("texto"),
  contenido: z.string().max(4096).nullable().optional(),
  archivo_url: z.string().url().optional(),
  archivo_nombre: z.string().max(200).optional(),
}).refine((d) => (d.tipo === "texto" ? !!d.contenido?.trim() : !!d.archivo_url), {
  message: "Un mensaje de texto necesita `contenido`; uno con media necesita `archivo_url`",
});

export const N8nEtapaSchema = z.object({
  etapa_id: z.string().uuid().optional(),
  etapa_key: z.string().min(1).max(50).optional(),
}).refine((d) => d.etapa_id || d.etapa_key, { message: "Falta `etapa_id` o `etapa_key`" });

export const N8nTagSchema = z.object({
  tag_id: z.string().uuid().optional(),
  tag_nombre: z.string().min(1).max(50).optional(),
  accion: z.enum(["agregar", "quitar"]).default("agregar"),
  crear_si_no_existe: z.boolean().default(false),
}).refine((d) => d.tag_id || d.tag_nombre, { message: "Falta `tag_id` o `tag_nombre`" });

/** `usuario_id: null` = soltar la conversación ("pasar a humano": queda sin asignar y visible
 * para el equipo), o el id de un humano concreto. */
export const N8nAsignarSchema = z.object({
  usuario_id: z.string().uuid().nullable(),
});
