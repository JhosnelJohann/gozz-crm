-- Soporta el filtro "asignadas a mí" (WHERE conexion_id = ? AND asignado_a = ?) del rediseño del
-- módulo de WhatsApp — sin este índice, ese filtro haría un escaneo secuencial completo de la
-- tabla a medida que crezca el volumen de conversaciones.
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversaciones_asignado
  ON gozz.whatsapp_conversaciones (conexion_id, asignado_a)
  WHERE asignado_a IS NOT NULL;
