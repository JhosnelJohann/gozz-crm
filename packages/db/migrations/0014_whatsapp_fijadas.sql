-- Conversaciones fijadas arriba de la bandeja, como en WhatsApp (Parte H, punto 3).
ALTER TABLE gozz.whatsapp_conversaciones ADD COLUMN IF NOT EXISTS fijada boolean NOT NULL DEFAULT false;

-- La búsqueda de la bandeja ahora también mira el texto de los mensajes y el número real.
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensajes_conversacion_texto
  ON gozz.whatsapp_mensajes (conversacion_id) WHERE contenido IS NOT NULL;
