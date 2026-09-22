import { z } from "zod";

export const CrearAgenteIASchema = z.object({
  nombre: z.string().min(2).max(100),
  email: z.string().email(),
  n8nWebhookUrl: z.string().url().nullable().optional(),
});

export const ActualizarAgenteIASchema = z.object({
  nombre: z.string().min(2).max(100).optional(),
  n8nWebhookUrl: z.string().url().nullable().optional(),
  activo: z.boolean().optional(),
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
