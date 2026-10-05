export interface AgenteIA {
  id: string;
  nombre: string;
  email: string;
  n8n_webhook_url: string | null;
  activo: boolean;
  created_at: string;
  /** Eventos a los que está suscrito su webhook, además de los avisos de sus reglas. */
  n8n_eventos: N8nEvento[];
  /** Última entrega a su webhook (para mostrar si n8n está respondiendo). */
  ultima_entrega: { estado: "pendiente" | "entregado" | "fallido"; evento: string; ultimo_status: number | null; ultimo_error: string | null; created_at: string } | null;
}

/** Eventos que GOZZ puede mandar a n8n. `regla.disparada` llega siempre (es el aviso de una regla
 * que apunta a ese agente); el resto es por suscripción. */
export const N8N_EVENTOS = ["mensaje.recibido", "mensaje.estado", "conversacion.etapa", "conversacion.asignada"] as const;
export type N8nEvento = (typeof N8N_EVENTOS)[number];

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
