import { z } from "zod";

export const CrearConexionSchema = z.object({
  nombre: z.string().min(2).max(100),
});

export const EnviarMensajeSchema = z.object({
  tipo: z.enum(["texto", "imagen", "archivo", "audio", "video"]).default("texto"),
  contenido: z.string().max(4096).nullable().optional(),
  archivoUrl: z.string().nullable().optional(),
  archivoNombre: z.string().nullable().optional(),
  archivoTamanio: z.number().int().nonnegative().nullable().optional(),
  /** Id de WhatsApp del mensaje al que se responde citando. */
  respuestaA: z.string().min(1).max(128).nullable().optional(),
});

export const PublicarEstadoSchema = z.object({
  tipo: z.enum(["texto", "imagen", "video"]),
  contenido: z.string().max(700).nullable().optional(),
  archivoUrl: z.string().regex(/^\/uploads\//).nullable().optional(),
  fondo: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
});

export const ReaccionSchema = z.object({ emoji: z.string().max(16) });
export const EditarMensajeSchema = z.object({ contenido: z.string().trim().min(1).max(4096) });
export const FijarSchema = z.object({ fijada: z.boolean() });
export const EscribiendoSchema = z.object({ estado: z.enum(["composing", "recording", "paused"]).default("composing") });

export const CrearTagSchema = z.object({
  nombre: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#5750E8"),
});

export const ActualizarEtapaSchema = z.object({
  etapa_id: z.string().uuid(),
});

export const AsignarConversacionSchema = z.object({
  asignado_a: z.string().uuid().nullable(),
});

export const VincularContactoSchema = z.object({
  contacto_id: z.string().uuid(),
});
