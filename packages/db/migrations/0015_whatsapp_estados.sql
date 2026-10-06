-- Estados de WhatsApp (historias de 24 h), Parte H punto 4: ver los de los contactos y publicar
-- los propios desde el CRM. Antes se descartaban todos (status@broadcast se ignoraba).
CREATE TABLE IF NOT EXISTS gozz.whatsapp_estados (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conexion_id uuid NOT NULL REFERENCES gozz.whatsapp_conexiones(id) ON DELETE CASCADE,
    wa_message_id text NOT NULL,
    -- jid de quien lo publicó; NULL = publicado por esta conexión (desde el CRM o el teléfono).
    autor_jid text,
    autor_nombre text,
    propio boolean NOT NULL DEFAULT false,
    tipo text NOT NULL CHECK (tipo IN ('texto', 'imagen', 'video')),
    contenido text,
    -- Estados de texto: color de fondo (#RRGGBB).
    fondo text,
    archivo_url text,
    media_meta jsonb,
    visto_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    expira_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
    CONSTRAINT whatsapp_estados_uq UNIQUE (conexion_id, wa_message_id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_estados_vigentes ON gozz.whatsapp_estados (conexion_id, expira_at DESC);
