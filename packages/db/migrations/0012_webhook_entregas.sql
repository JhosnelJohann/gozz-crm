-- Integración con n8n de nivel producción (Parte G): suscripción por eventos y cola de entregas
-- con reintentos. Antes cada aviso a n8n era un `fetch` suelto: si n8n estaba caído o tardaba,
-- el evento se perdía sin rastro y nadie se enteraba.

-- Qué eventos recibe cada agente de IA en su webhook. Vacío = solo los avisos de sus reglas
-- (`regla.disparada`), que es exactamente el comportamiento anterior a esta migración.
ALTER TABLE gozz.users ADD COLUMN IF NOT EXISTS n8n_eventos text[] NOT NULL DEFAULT '{}';

-- Una fila por aviso a n8n. Se entrega al instante y, si falla, el cron de automatizaciones la
-- reintenta con espera creciente (1 min, 5 min, 30 min) antes de darla por fallida. El estado
-- (último código HTTP y error) se muestra en la tarjeta del agente.
CREATE TABLE IF NOT EXISTS gozz.webhook_entregas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agente_id uuid NOT NULL REFERENCES gozz.users(id) ON DELETE CASCADE,
    url text NOT NULL,
    evento text NOT NULL,
    payload jsonb NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'entregado', 'fallido')),
    intentos integer NOT NULL DEFAULT 0,
    proximo_intento_at timestamptz NOT NULL DEFAULT now(),
    ultimo_status integer,
    ultimo_error text,
    entregado_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_entregas_pendientes
  ON gozz.webhook_entregas (proximo_intento_at) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_webhook_entregas_agente
  ON gozz.webhook_entregas (agente_id, created_at DESC);
