# Integración con n8n — agentes de IA en WhatsApp

GOZZ avisa a n8n de lo que pasa en las conversaciones de WhatsApp, y n8n puede actuar sobre ellas: responder con texto o media, mover la etapa, etiquetar, asignar o pasar a un humano. Así un agente de IA lee, decide y responde sin que nadie toque el CRM.

```
WhatsApp ──► GOZZ ──(webhook firmado)──► n8n ──► IA (OpenAI, Claude…)
                ▲                          │
                └──── API /api/n8n/* ◄─────┘  (X-N8N-Secret)
```

## 1. Configuración

1. En el servidor, `N8N_WEBHOOK_SECRET` (en `apps/api/.env`): un secreto largo y aleatorio. Es el mismo valor en GOZZ y en n8n.
2. En **Automatizaciones → Agentes de IA**, crea un agente y pega la URL del nodo *Webhook* de n8n.
3. Marca los eventos que debe escuchar. Los avisos de sus **reglas** llegan siempre.
4. Opcional: en **Reglas**, define cuándo se le asigna una conversación (por etapa o etiqueta).

Requiere la migración `0012_webhook_entregas.sql` (y `0010`, de la Fase 2).

## 2. Eventos que GOZZ manda a n8n

`POST` a la URL del agente, JSON, con estos headers:

| Header | Contenido |
|---|---|
| `X-Gozz-Event` | `mensaje.recibido`, `mensaje.estado`, `conversacion.etapa`, `conversacion.asignada` o `regla.disparada` |
| `X-Gozz-Delivery` | id único de la entrega. Se repite en los reintentos, así n8n puede deduplicar |
| `X-Gozz-Signature` | `t=<unix>,v1=<hex>`: HMAC-SHA256 de `"<t>.<cuerpo>"` con el secreto |
| `X-Gozz-Secret` | El secreto en claro, solo por compatibilidad. Usa la firma |

| Evento | Cuándo | Campos extra |
|---|---|---|
| `regla.disparada` | Un mensaje entrante calza con una regla del agente | `conversacion_id`, `agente_id`, `regla`, `mensaje {tipo, contenido}` |
| `mensaje.recibido` | Entra un mensaje de un contacto | `mensaje` (fila completa) |
| `mensaje.estado` | Un mensaje enviado pasa a enviado, entregado, leído o fallido | `mensaje_id`, `estado` |
| `conversacion.etapa` | Cambia la etapa del embudo | `etapa_id` |
| `conversacion.asignada` | Se asigna o se suelta la conversación | `asignado_a` (o `null`) |

Todos incluyen además el **contexto completo**, para que la IA no tenga que consultar nada más:

```json
{
  "evento": "mensaje.recibido",
  "entrega_id": "6f1c…",
  "enviado_at": "2026-10-05T14:03:11.000Z",
  "agente_id": "a1b2…",
  "conversacion": {
    "id": "c3d4…",
    "conexion_id": "e5f6…",
    "nombre": "Ana Pérez",
    "telefono": "+584121234567",
    "etapa": { "id": "…", "key": "apertura", "label": "Apertura" },
    "etiquetas": [{ "id": "…", "nombre": "Interesado" }],
    "asignado_a": "a1b2…",
    "no_leidos": 2
  },
  "contacto": { "id": "…", "nombre_completo": "Ana Pérez", "email": null },
  "ultimos_mensajes": [
    { "id": "…", "direccion": "entrante", "tipo": "texto", "contenido": "Hola, ¿precio?", "archivo_url": null, "estado": "entregado", "fecha": "…" }
  ],
  "mensaje": { "...": "fila del mensaje que disparó el evento" }
}
```

`telefono` va en E.164, o `null` si WhatsApp solo dio un identificador privado (`@lid`). `ultimos_mensajes` trae los 10 más recientes, del más viejo al más nuevo.

### Reintentos

Si n8n responde algo distinto de 2xx, no responde en 10 s o está caído, el aviso **no se pierde**. GOZZ lo reintenta a los 1, 5 y 30 minutos. Tras el cuarto intento queda como *fallido*, y la tarjeta del agente lo muestra en rojo con el motivo. El historial completo está en la tabla `gozz.webhook_entregas`.

### Verificar la firma en n8n

Activa *Raw body* en el nodo Webhook y pon antes un nodo **Code**:

```js
const crypto = require('crypto');
const secreto = $env.GOZZ_SECRET;              // el mismo N8N_WEBHOOK_SECRET
const cuerpo = $input.first().binary?.data
  ? Buffer.from($input.first().binary.data.data, 'base64').toString('utf8')
  : JSON.stringify($input.first().json.body);
const cab = $input.first().json.headers['x-gozz-signature'] || '';
const { t, v1 } = Object.fromEntries(cab.split(',').map(p => p.split('=')));
const esperado = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
const vigente = Math.abs(Date.now() / 1000 - Number(t)) < 300;
if (!vigente || !v1 || !crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(v1, 'hex'))) {
  throw new Error('Firma de GOZZ inválida');
}
return [{ json: JSON.parse(cuerpo) }];
```

## 3. API para n8n

Base: `https://crm.sandrogozz.com`. Todas las llamadas llevan el header `X-N8N-Secret: <N8N_WEBHOOK_SECRET>`. Los errores responden `400` (datos inválidos) o `404` (no existe), con `{ "error": "…" }`.

| Acción | Método y ruta | Body |
|---|---|---|
| Leer contexto | `GET /api/n8n/conversaciones/:id/contexto` | — |
| Responder | `POST /api/n8n/conversaciones/:id/mensajes` | `{ "agente_id", "tipo": "texto", "contenido" }` |
| Responder con media | igual | `{ "agente_id", "tipo": "imagen" \| "video" \| "audio" \| "archivo", "archivo_url", "archivo_nombre"?, "contenido"? }` |
| Mover de etapa | `PATCH /api/n8n/conversaciones/:id/etapa` | `{ "etapa_key": "oferta" }` o `{ "etapa_id" }` |
| Etiquetar | `POST /api/n8n/conversaciones/:id/tags` | `{ "tag_nombre": "Interesado", "accion": "agregar" \| "quitar", "crear_si_no_existe": true }` |
| Asignar o pasar a humano | `PATCH /api/n8n/conversaciones/:id/asignar` | `{ "usuario_id": "<uuid>" }` o `{ "usuario_id": null }` |

Notas sobre la API:
- **Responder** usa exactamente el mismo envío que un agente humano: el mensaje aparece en vivo en el CRM con sus checks y se reintenta si WhatsApp falla.
- **Media**: GOZZ descarga `archivo_url` (http/https, máximo 16 MB) y la manda como adjunto real. Un `audio` sale como **nota de voz**.
- **Etapas** sembradas: `apertura`, `activa`, `oferta`, `decision`, `ganado`, `perdido`.
- **Pasar a humano** (`usuario_id: null`) deja la conversación sin asignar y visible para todo el equipo. Combínalo con una etiqueta (`"Requiere humano"`) para encontrarla al instante.
- La ruta original `POST /api/automatizaciones/n8n/mensaje` (`{ conversacion_id, agente_id, contenido }`) sigue funcionando.

## 4. Workflow de ejemplo: agente de ventas

1. **Webhook** (POST, *Raw body*) → **Code** (verificar firma, ver arriba).
2. **IF** `evento == "regla.disparada"` o `"mensaje.recibido"`.
3. **AI Agent / OpenAI / Anthropic**: prompt de sistema con la oferta, y como entrada `conversacion` + `ultimos_mensajes`. Pídele JSON: `{ "respuesta", "etapa_key"?, "etiqueta"?, "pasar_a_humano": bool }`.
4. **HTTP Request** → `POST /api/n8n/conversaciones/{{conversacion.id}}/mensajes` con `agente_id` y `respuesta`.
5. Si viene `etapa_key` → `PATCH …/etapa`. Si viene `etiqueta` → `POST …/tags` con `crear_si_no_existe: true`.
6. Si `pasar_a_humano` → `PATCH …/asignar` con `usuario_id: null` y `POST …/tags` con `"Requiere humano"`.
7. Responde `200` rápido. Si el workflow tarda más de 10 s, usa *Respond to Webhook* al inicio para que GOZZ no lo cuente como fallo.
