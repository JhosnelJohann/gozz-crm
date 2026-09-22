// Tipos del módulo de Automatizaciones de WhatsApp (Fase 2 del rediseño): agentes de IA de n8n
// como "asignados" (fila de `gozz.users` con `es_agente_ia = true`), reglas por etapa/etiqueta
// (`gozz.whatsapp_automatizaciones`) y recordatorios programados (`gozz.whatsapp_recordatorios`).
// Ver 0010_whatsapp_automatizaciones.sql.

export interface AgenteIA {
  id: string;
  nombre: string;
  email: string;
  n8n_webhook_url: string | null;
  activo: boolean;
  created_at: string;
}

export interface AutomatizacionRegla {
  id: string;
  nombre: string;
  activa: boolean;
  etapa_id: string | null;
  tag_id: string | null;
  agente_id: string;
  asignar_conversacion: boolean;
  created_at: string;
  updated_at: string;
}

export type RecordatorioCanal = "whatsapp" | "email";

export interface Recordatorio {
  id: string;
  canal: RecordatorioCanal;
  conversacion_id: string | null;
  contacto_id: string | null;
  buzon_id: string | null;
  asunto: string | null;
  mensaje: string;
  programado_para: string;
  enviado_at: string | null;
  error: string | null;
  creado_por: string;
  created_at: string;
}
