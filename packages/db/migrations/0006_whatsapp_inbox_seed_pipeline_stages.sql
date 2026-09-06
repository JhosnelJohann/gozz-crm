-- 0006_whatsapp_inbox_seed_pipeline_stages.sql
-- Embudo por defecto para conversaciones de WhatsApp, independiente del pipeline de Oportunidades
-- (gozz.pipeline_stages). Ver 0005_whatsapp_inbox_schema.sql y docs/ROADMAP.md §0 para el porqué
-- de una tabla propia.

INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
VALUES
  ('apertura', 'Apertura', '#5C6670', 1, false, false, true),
  ('activa', 'Conversación activa', '#2196C9', 2, false, false, true),
  ('oferta', 'Oferta presentada', '#33359D', 3, false, false, true),
  ('decision', 'Tomando decisión', '#FFB51C', 4, false, false, true),
  ('ganado', 'Cliente ganado', '#43A847', 5, true, true, true),
  ('perdido', 'Perdido', '#E53935', 6, true, false, true)
ON CONFLICT (key) DO NOTHING;
