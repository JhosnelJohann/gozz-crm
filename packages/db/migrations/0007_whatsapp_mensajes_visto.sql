-- 0007_whatsapp_mensajes_visto.sql
-- "Visto por el equipo": distinto de los checks de envío de WhatsApp (enviado/entregado/leído,
-- que ya viven en `estado_entrega` y aplican solo a mensajes salientes). Esto marca, para un
-- mensaje ENTRANTE, que alguien del equipo lo vio dentro del CRM al abrir la conversación —
-- ver whatsapp.repository.ts `marcarLeida`.

ALTER TABLE gozz.whatsapp_mensajes
  ADD COLUMN IF NOT EXISTS visto_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS visto_por uuid;
