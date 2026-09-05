// Tipos del slice de oportunidades. `OportunidadListItem` espeja `COLS_OPORTUNIDAD`
// (`lib/oportunidades-filtro.ts`); `Oportunidad` espeja la fila que devuelven
// `INSERT ... RETURNING *` / `UPDATE ... RETURNING *` en `modules/oportunidades/oportunidades.repository.ts`.

export interface PipelineStage {
  id: string;
  key: string;
  label: string;
  color: string;
  orden: number;
  es_terminal: boolean;
  es_ganado: boolean;
  campos_obligatorios: string[];
  activa: boolean;
}

export type SlaEstado = "on_track" | "warning" | "vencido" | "completado";

/** Fila tal como la devuelve el listado del pipeline (`GET /api/oportunidades`). */
export interface OportunidadListItem {
  id: string;
  nombre_caso: string;
  etapa: string;
  valor_total: number;
  balance_pendiente: number;
  sla_estado: SlaEstado | null;
  sla_fecha_limite: string | null;
  created_at: string;
  preparador_id: string | null;
  vendedor_id: string | null;
  tipo_tramite_id: string | null;
  contacto_id: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  tramite_nombre: string | null;
  tramite_codigo: string | null;
  formulario_uscis: string | null;
  tramite_color: string | null;
  preparador_nombre: string | null;
  preparador_avatar: string | null;
  tareas_pendientes: number;
}

/** La fila completa de `gozz.oportunidades` (`POST`/`PATCH /api/oportunidades/:id`). */
export interface Oportunidad {
  id: string;
  contacto_id: string | null;
  nombre_caso: string;
  tipo_tramite_id: string | null;
  etapa: string;
  preparador_id: string | null;
  vendedor_id: string | null;
  manager_ventas_id: string | null;
  manager_preparacion_id: string | null;
  manager_general_id: string | null;
  valor_total: number;
  balance_pendiente: number;
  sla_fecha_limite: string | null;
  sla_estado: SlaEstado | null;
  notas: string | null;
  fecha_completada: string | null;
  fecha_ganado: string | null;
  created_at: string;
  updated_at: string;
}

/** Cuerpo de `POST /api/oportunidades` y `PATCH /api/oportunidades/:id` (parcial en el PATCH). */
export interface OportunidadInput {
  contacto_id?: string | null;
  nombre_caso: string;
  tipo_tramite_id?: string | null;
  etapa?: string;
  preparador_id?: string | null;
  vendedor_id?: string | null;
  manager_ventas_id?: string | null;
  manager_preparacion_id?: string | null;
  manager_general_id?: string | null;
  valor_total?: number;
  notas?: string | null;
  /** Trámites adicionales (multi); el principal va en `tipo_tramite_id`. Solo en el POST. */
  tramites_extra?: string[];
}
