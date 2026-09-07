// Tipos del módulo de bandeja compartida de WhatsApp. Espejan las filas de
// `gozz.whatsapp_conexiones` / `whatsapp_conversaciones` / `whatsapp_mensajes` / `whatsapp_tags` /
// `whatsapp_pipeline_stages` (0005_whatsapp_inbox_schema.sql).

export type WhatsAppProveedor = "baileys" | "meta_cloud";
export type WhatsAppConexionEstado = "pendiente" | "conectando" | "conectado" | "desconectado" | "error" | "cerrada";
export type WhatsAppVinculoEstado = "sin_vincular" | "vinculado_auto" | "vinculado_manual";
export type WhatsAppMensajeDireccion = "entrante" | "saliente";
export type WhatsAppMensajeTipo = "texto" | "imagen" | "archivo" | "audio" | "video" | "sistema";
export type WhatsAppMensajeEstado = "pendiente" | "enviado" | "entregado" | "leido" | "fallido";

export interface WhatsAppConexion {
  id: string;
  nombre: string;
  telefono: string | null;
  owner_user_id: string;
  proveedor: WhatsAppProveedor;
  estado: WhatsAppConexionEstado;
  qr_actual: string | null;
  qr_actualizado_at: string | null;
  activo: boolean;
  ultimo_error: string | null;
  ultima_actividad: string | null;
  created_at: string;
}

export interface WhatsAppPipelineStage {
  id: string;
  key: string;
  label: string;
  color: string;
  orden: number;
  es_terminal: boolean;
  es_ganado: boolean;
  activa: boolean;
}

export interface WhatsAppTag {
  id: string;
  nombre: string;
  color: string;
}

export interface WhatsAppConversacion {
  id: string;
  conexion_id: string;
  wa_jid: string;
  nombre_whatsapp: string | null;
  foto_perfil_url: string | null;
  contacto_id: string | null;
  contacto_vinculo_estado: WhatsAppVinculoEstado;
  etapa_id: string | null;
  asignado_a: string | null;
  oportunidad_id: string | null;
  ultimo_mensaje_preview: string | null;
  ultimo_mensaje_at: string | null;
  ultimo_mensaje_direccion: WhatsAppMensajeDireccion | null;
  no_leidos_count: number;
  archivado: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppMensaje {
  id: string;
  conversacion_id: string;
  wa_message_id: string | null;
  direccion: WhatsAppMensajeDireccion;
  tipo: WhatsAppMensajeTipo;
  contenido: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  archivo_tipo: string | null;
  archivo_tamanio: number | null;
  enviado_por: string | null;
  estado_entrega: WhatsAppMensajeEstado;
  error_envio: string | null;
  created_at: string;
  /** "Visto por el equipo" — distinto de `estado_entrega` (que es la confirmación de WhatsApp
   * para lo que GOZZ envía). Solo aplica a mensajes `entrante`: cuándo, y quién del equipo, vio
   * este mensaje dentro del CRM. */
  visto_at: string | null;
  visto_por: string | null;
}
