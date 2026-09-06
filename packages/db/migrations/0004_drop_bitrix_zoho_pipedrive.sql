-- GOZZ no tiene ni tendrá integración con Bitrix24, Zoho CRM ni Pipedrive — eran artefactos de la
-- migración histórica de datos de crm-tadi, ya heredados en el schema base (0001) porque en ese
-- momento no había contexto de negocio para confirmar que estaban muertos (ver docs/ROADMAP.md).
-- Confirmado: se eliminan las columnas, sus índices (se van solos con la columna) y el endpoint
-- de "archivos importados" de cada uno en el código de la aplicación.

ALTER TABLE gozz.contactos_cache
  DROP COLUMN IF EXISTS pipedrive_person_id,
  DROP COLUMN IF EXISTS pipedrive_tramites,
  DROP COLUMN IF EXISTS pipedrive_imported_at,
  DROP COLUMN IF EXISTS zoho_id,
  DROP COLUMN IF EXISTS zoho_module,
  DROP COLUMN IF EXISTS zoho_tramites,
  DROP COLUMN IF EXISTS zoho_imported_at,
  DROP COLUMN IF EXISTS bitrix_contact_id,
  DROP COLUMN IF EXISTS bitrix_tramites,
  DROP COLUMN IF EXISTS bitrix_imported_at;

ALTER TABLE gozz.oportunidades
  DROP COLUMN IF EXISTS bitrix_deal_id;

ALTER TABLE gozz.users
  DROP COLUMN IF EXISTS bitrix_id,
  DROP COLUMN IF EXISTS importado_desde;

-- `origen` es un campo de procedencia genérico (no específico de Bitrix); el código de la
-- aplicación siempre inserta 'manual' explícitamente, así que el default histórico 'bitrix' ya
-- no reflejaba la realidad — se corrige para que coincida con lo que de verdad se escribe.
ALTER TABLE gozz.oportunidad_tramites
  ALTER COLUMN origen SET DEFAULT 'manual';
