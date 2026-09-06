import { z } from "zod";

export const CrearConexionSchema = z.object({
  nombre: z.string().min(2).max(100),
});

export const EnviarMensajeSchema = z.object({
  tipo: z.enum(["texto", "imagen", "archivo", "audio", "video"]).default("texto"),
  contenido: z.string().max(4096).nullable().optional(),
  archivoUrl: z.string().nullable().optional(),
  archivoNombre: z.string().nullable().optional(),
});

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
