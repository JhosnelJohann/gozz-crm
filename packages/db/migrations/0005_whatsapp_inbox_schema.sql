-- 0005_whatsapp_inbox_schema.sql
-- Bandeja compartida de WhatsApp (estilo Whaticket): conectar un número por QR (Baileys) o, más
-- adelante, por la API oficial de Meta Cloud, y conversar con leads/clientes desde el CRM.
-- Módulo nuevo, independiente del chat interno (`chat_grupos`/`chat_mensajes`, que asume
-- miembros = usuarios internos). Ver docs/ROADMAP.md para el diseño completo.

CREATE TABLE IF NOT EXISTS gozz.whatsapp_conexiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    nombre text NOT NULL,
    telefono text,
    owner_user_id uuid NOT NULL,
    proveedor text DEFAULT 'baileys'::text NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    qr_actual text,
    qr_actualizado_at timestamp with time zone,
    session_state_enc text,
    meta_cloud_phone_number_id text,
    meta_cloud_access_token_enc text,
    activo boolean DEFAULT true NOT NULL,
    errores_consecutivos integer DEFAULT 0 NOT NULL,
    ultimo_error text,
    ultima_actividad timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_conexiones_proveedor_check CHECK (proveedor = ANY (ARRAY['baileys'::text, 'meta_cloud'::text])),
    CONSTRAINT whatsapp_conexiones_estado_check CHECK (estado = ANY (ARRAY['pendiente'::text, 'conectando'::text, 'conectado'::text, 'desconectado'::text, 'error'::text, 'cerrada'::text]))
);

CREATE TABLE IF NOT EXISTS gozz.whatsapp_conexion_acl (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    conexion_id uuid NOT NULL REFERENCES gozz.whatsapp_conexiones(id) ON DELETE CASCADE,
    user_id uuid,
    posicion text,
    permiso text DEFAULT 'ver'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_conexion_acl_permiso_check CHECK (permiso = ANY (ARRAY['ver'::text, 'responder'::text, 'admin'::text]))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conexion_acl_conexion ON gozz.whatsapp_conexion_acl USING btree (conexion_id);

CREATE TABLE IF NOT EXISTS gozz.whatsapp_pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    key text NOT NULL UNIQUE,
    label text NOT NULL,
    color text DEFAULT '#5C6670'::text NOT NULL,
    orden integer NOT NULL,
    es_terminal boolean DEFAULT false NOT NULL,
    es_ganado boolean DEFAULT false NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS gozz.whatsapp_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    nombre text NOT NULL UNIQUE,
    color text DEFAULT '#5750E8'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS gozz.whatsapp_conversaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    conexion_id uuid NOT NULL REFERENCES gozz.whatsapp_conexiones(id) ON DELETE CASCADE,
    wa_jid text NOT NULL,
    nombre_whatsapp text,
    foto_perfil_url text,
    contacto_id uuid,
    contacto_vinculo_estado text DEFAULT 'sin_vincular'::text NOT NULL,
    etapa_id uuid REFERENCES gozz.whatsapp_pipeline_stages(id),
    asignado_a uuid,
    oportunidad_id uuid,
    convertida_at timestamp with time zone,
    convertida_por uuid,
    ultimo_mensaje_preview text,
    ultimo_mensaje_at timestamp with time zone,
    ultimo_mensaje_direccion text,
    no_leidos_count integer DEFAULT 0 NOT NULL,
    archivado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_conversaciones_conexion_jid_uq UNIQUE (conexion_id, wa_jid),
    CONSTRAINT whatsapp_conversaciones_vinculo_check CHECK (contacto_vinculo_estado = ANY (ARRAY['sin_vincular'::text, 'vinculado_auto'::text, 'vinculado_manual'::text]))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversaciones_conexion ON gozz.whatsapp_conversaciones USING btree (conexion_id, ultimo_mensaje_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversaciones_contacto ON gozz.whatsapp_conversaciones USING btree (contacto_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversaciones_etapa ON gozz.whatsapp_conversaciones USING btree (etapa_id);

CREATE TABLE IF NOT EXISTS gozz.whatsapp_conversacion_tags (
    conversacion_id uuid NOT NULL REFERENCES gozz.whatsapp_conversaciones(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES gozz.whatsapp_tags(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (conversacion_id, tag_id)
);

CREATE TABLE IF NOT EXISTS gozz.whatsapp_mensajes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    conversacion_id uuid NOT NULL REFERENCES gozz.whatsapp_conversaciones(id) ON DELETE CASCADE,
    wa_message_id text,
    direccion text NOT NULL,
    tipo text DEFAULT 'texto'::text NOT NULL,
    contenido text,
    archivo_url text,
    archivo_nombre text,
    archivo_tipo text,
    archivo_tamanio integer,
    enviado_por uuid,
    estado_entrega text DEFAULT 'pendiente'::text NOT NULL,
    error_envio text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_mensajes_direccion_check CHECK (direccion = ANY (ARRAY['entrante'::text, 'saliente'::text])),
    CONSTRAINT whatsapp_mensajes_tipo_check CHECK (tipo = ANY (ARRAY['texto'::text, 'imagen'::text, 'archivo'::text, 'audio'::text, 'video'::text, 'sistema'::text])),
    CONSTRAINT whatsapp_mensajes_estado_check CHECK (estado_entrega = ANY (ARRAY['pendiente'::text, 'enviado'::text, 'entregado'::text, 'leido'::text, 'fallido'::text]))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensajes_conversacion ON gozz.whatsapp_mensajes USING btree (conversacion_id, created_at);
-- Idempotencia: un wa_message_id (id nativo de Baileys) no puede duplicarse dentro de la misma
-- conversación. NULL se permite (mensajes salientes en 'pendiente' aún no confirmados por WhatsApp).
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_mensajes_wa_id_uq ON gozz.whatsapp_mensajes (conversacion_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensajes_pendientes ON gozz.whatsapp_mensajes (conversacion_id) WHERE direccion = 'saliente' AND estado_entrega = 'pendiente';
