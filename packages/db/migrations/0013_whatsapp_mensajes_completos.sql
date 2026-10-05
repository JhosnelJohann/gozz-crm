-- WhatsApp completo (Parte H, punto 1): que el CRM muestre TODO lo que muestra WhatsApp.
--
-- Diagnóstico (base local, 05 oct 2026): el 28 % de los mensajes (72 de 255) se guardaba como
-- tipo 'sistema' sin contenido. Stickers, reacciones, mensajes borrados o editados, ubicaciones,
-- contactos, encuestas, "ver una vez" y mensajes temporales no se reconocían y se veían como
-- burbujas en blanco. Los grupos se ignoraban por completo y el historial anterior a la conexión
-- nunca se importaba.

-- ---- Tipos nuevos de mensaje ----
ALTER TABLE gozz.whatsapp_mensajes DROP CONSTRAINT IF EXISTS whatsapp_mensajes_tipo_check;
ALTER TABLE gozz.whatsapp_mensajes ADD CONSTRAINT whatsapp_mensajes_tipo_check CHECK (tipo = ANY (ARRAY[
  'texto', 'imagen', 'archivo', 'audio', 'video', 'sistema', 'sticker', 'ubicacion', 'contacto', 'encuesta'
]::text[]));

ALTER TABLE gozz.whatsapp_mensajes
  -- Grupos: quién escribió el mensaje dentro del grupo.
  ADD COLUMN IF NOT EXISTS autor_jid text,
  ADD COLUMN IF NOT EXISTS autor_nombre text,
  -- Respuesta citando otro mensaje (id de WhatsApp del citado + un extracto para mostrarlo).
  ADD COLUMN IF NOT EXISTS respuesta_a text,
  ADD COLUMN IF NOT EXISTS respuesta_preview text,
  -- Reacciones: { "<jid de quien reacciona>": "👍" }.
  ADD COLUMN IF NOT EXISTS reacciones jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS editado_at timestamptz,
  ADD COLUMN IF NOT EXISTS eliminado_at timestamptz,
  -- Lo necesario para descargar la media más tarde (historial importado, o una descarga que
  -- falló en vivo). Sin esto, una foto que no se pudo bajar en el momento se perdía para siempre.
  ADD COLUMN IF NOT EXISTS media_meta jsonb,
  -- Importado del historial de WhatsApp al vincular el número (no cuenta como no leído ni
  -- dispara notificaciones ni automatizaciones).
  ADD COLUMN IF NOT EXISTS historico boolean NOT NULL DEFAULT false;

-- Para aplicar una reacción, un borrado o una edición hay que encontrar el mensaje por su id de
-- WhatsApp sin saber la conversación.
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensajes_wa_id ON gozz.whatsapp_mensajes (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ---- Grupos ----
ALTER TABLE gozz.whatsapp_conversaciones ADD COLUMN IF NOT EXISTS es_grupo boolean NOT NULL DEFAULT false;
UPDATE gozz.whatsapp_conversaciones SET es_grupo = true WHERE wa_jid LIKE '%@g.us' AND es_grupo = false;
