-- 0002_seed_pipeline_stages.sql
-- Etapas de pipeline genéricas por defecto, para que el módulo de Oportunidades sea usable
-- desde el primer arranque. No incluye catálogo de trámites/precios ni estructura
-- organizacional (departamentos/cargos): eso es configuración propia de cada negocio y se
-- define desde Configuración una vez el equipo decide su propio pipeline y catálogo.

INSERT INTO gozz.pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
VALUES
  ('nuevo', 'Nuevo', '#5C6670', 1, false, false, true),
  ('contactado', 'Contactado', '#2196C9', 2, false, false, true),
  ('en_proceso', 'En proceso', '#33359D', 3, false, false, true),
  ('ganado', 'Ganado', '#43A847', 4, true, true, true),
  ('perdido', 'Perdido', '#E53935', 5, true, false, true)
ON CONFLICT (key) DO NOTHING;
