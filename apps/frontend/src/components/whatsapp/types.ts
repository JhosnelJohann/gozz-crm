export interface WhatsAppConexion {
  id: string;
  nombre: string;
  telefono: string | null;
  estado: "pendiente" | "conectando" | "conectado" | "desconectado" | "error" | "cerrada";
  ultimo_error: string | null;
}

export interface WhatsAppPipelineStage {
  id: string;
  key: string;
  label: string;
  color: string;
  orden: number;
  es_terminal: boolean;
  es_ganado: boolean;
}

export interface WhatsAppTag {
  id: string;
  nombre: string;
  color: string;
}

export interface WhatsAppMensaje {
  id: string;
  conversacion_id: string;
  wa_message_id: string | null;
  direccion: "entrante" | "saliente";
  tipo: "texto" | "imagen" | "archivo" | "audio" | "video" | "sistema" | "sticker" | "ubicacion" | "contacto" | "encuesta";
  contenido: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  archivo_tipo: string | null;
  archivo_tamanio: number | null;
  estado_entrega: "pendiente" | "enviado" | "entregado" | "leido" | "fallido";
  created_at: string;
  visto_at: string | null;
  visto_por: string | null;
  autor_jid?: string | null;
  autor_nombre?: string | null;
  respuesta_a?: string | null;
  respuesta_preview?: string | null;
  reacciones?: Record<string, string>;
  editado_at?: string | null;
  eliminado_at?: string | null;
  media_pendiente?: boolean;
  historico?: boolean;
}

export interface WhatsAppConversacionDetalle {
  id: string;
  conexion_id: string;
  wa_jid: string;
  nombre_whatsapp: string | null;
  foto_perfil_url: string | null;
  telefono_real: string | null;
  contacto_id: string | null;
  contacto_vinculo_estado: "sin_vincular" | "vinculado_auto" | "vinculado_manual";
  etapa_id: string | null;
  asignado_a: string | null;
  oportunidad_id: string | null;
  es_grupo?: boolean;
  tags: WhatsAppTag[];
}
