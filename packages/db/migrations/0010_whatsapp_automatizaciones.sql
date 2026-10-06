-- Fase 2 del rediseño de WhatsApp (Automatizaciones): agentes de IA de n8n como "asignados",
-- reglas de automatización por etapa/etiqueta, y recordatorios programados por WhatsApp/correo.
-- Entrega separada de la Parte 1 (WhatsApp), tal como se acordó explícitamente con Sandro.

-- Un agente de IA es una fila más de gozz.users (es_agente_ia = true) — decisión tomada desde la
-- Parte 1: `asignado_a` ya era una referencia simple a users.id, sin tabla ni tipo paralelo, para
-- que esto funcionara sin rehacer el selector/filtro/tablero ya construidos para agentes humanos.
-- `password_hash` sigue NOT NULL (no se relaja la columna): al crear un agente se le pone un hash
-- aleatorio irreproducible (ver automatizaciones.repository.ts), así que nunca puede iniciar
-- sesión — solo existe para ser referenciado como asignado y para recibir su propio webhook.
ALTER TABLE gozz.users ADD COLUMN IF NOT EXISTS es_agente_ia boolean NOT NULL DEFAULT false;
ALTER TABLE gozz.users ADD COLUMN IF NOT EXISTS n8n_webhook_url text;

-- Reglas: "si un mensaje entra en esta etapa y/o tiene esta etiqueta, avisa a este agente de IA
-- (y opcionalmente asígnale la conversación)". `tag_id` NULL = cualquier etiqueta; `etapa_id` NULL
-- = cualquier etapa; ambos NULL sería "todo mensaje entrante" — válido pero se advierte en la UI.
CREATE TABLE IF NOT EXISTS gozz.whatsapp_automatizaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre text NOT NULL,
    activa boolean NOT NULL DEFAULT true,
    etapa_id uuid REFERENCES gozz.whatsapp_pipeline_stages(id) ON DELETE SET NULL,
    tag_id uuid REFERENCES gozz.whatsapp_tags(id) ON DELETE CASCADE,
    agente_id uuid NOT NULL REFERENCES gozz.users(id) ON DELETE CASCADE,
    asignar_conversacion boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_automatizaciones_activa ON gozz.whatsapp_automatizaciones (activa) WHERE activa = true;
CREATE INDEX IF NOT EXISTS idx_whatsapp_automatizaciones_agente ON gozz.whatsapp_automatizaciones (agente_id);

DROP TRIGGER IF EXISTS trg_updated_at ON gozz.whatsapp_automatizaciones;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.whatsapp_automatizaciones
    FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();

-- Recordatorios programados. El canal decide qué combinación de columnas es obligatoria: WhatsApp
-- necesita saber a qué conversación (y por tanto con qué conexión) escribirle; correo necesita el
-- contacto (para su dirección) y el buzón que lo envía. `enviado_at` es el mismo patrón de
-- "no reintentar ni duplicar" que usa `clock_breaks.alertado` (ver `clock-routes.ts`).
CREATE TABLE IF NOT EXISTS gozz.whatsapp_recordatorios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canal text NOT NULL CHECK (canal IN ('whatsapp', 'email')),
    conversacion_id uuid REFERENCES gozz.whatsapp_conversaciones(id) ON DELETE CASCADE,
    contacto_id uuid REFERENCES gozz.contactos_cache(id) ON DELETE CASCADE,
    buzon_id uuid REFERENCES gozz.buzones_email(id) ON DELETE SET NULL,
    asunto text,
    mensaje text NOT NULL,
    programado_para timestamptz NOT NULL,
    enviado_at timestamptz,
    error text,
    creado_por uuid NOT NULL REFERENCES gozz.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT whatsapp_recordatorios_canal_destino_check CHECK (
        (canal = 'whatsapp' AND conversacion_id IS NOT NULL) OR
        (canal = 'email' AND buzon_id IS NOT NULL AND contacto_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_recordatorios_pendientes ON gozz.whatsapp_recordatorios (programado_para) WHERE enviado_at IS NULL;
