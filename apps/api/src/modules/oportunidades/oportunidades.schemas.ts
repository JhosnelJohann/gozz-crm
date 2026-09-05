import { z } from "zod";

export const OportunidadSchema = z.object({
  contacto_id: z.string().uuid().nullable().optional(),
  nombre_caso: z.string().min(2),
  tipo_tramite_id: z.string().uuid().nullable().optional(),
  etapa: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/).optional(),
  preparador_id: z.string().uuid().nullable().optional(),
  vendedor_id: z.string().uuid().nullable().optional(),
  manager_ventas_id: z.string().uuid().nullable().optional(),
  manager_preparacion_id: z.string().uuid().nullable().optional(),
  manager_general_id: z.string().uuid().nullable().optional(),
  valor_total: z.number().optional(),
  notas: z.string().nullable().optional(),
});
