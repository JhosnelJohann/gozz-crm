# Chat interno y llamadas del equipo — CRM GOZZ

Documento técnico de cómo funcionan los dos módulos en tiempo real del CRM:
mensajería entre miembros del equipo y videollamadas. Última revisión: 2026-05-29.

---

## 1. Visión general

- **Chat interno** — mensajería estilo WhatsApp entre miembros del equipo (DMs 1-a-1 y grupos), con socket.io para tiempo real y Postgres para persistencia. No confundir con el módulo de correos IMAP.
- **Llamadas** — videollamadas 1-a-1 y de grupo, basadas en **LiveKit (SFU open-source)**. La señalización (invitar/timbrar/aceptar) corre por socket.io; el media (audio/video) por LiveKit.

Ambos comparten infraestructura: el mismo socket.io del API, la misma autenticación por cookie JWT (`access_token`), y la misma DB (Postgres en `supabase-db`, esquema `gozz`).

**Servicios pm2 involucrados:**
- `gozz-api` (Express + socket.io, puerto 4100)
- `gozz-frontend` (Next.js standalone, puerto 3100)
- `gozz-livekit` (servidor LiveKit, HTTP 7880 + RTC TCP 8080 + UDP 50000–50100)

**Auth:** cookie HTTP-only `access_token` (JWT firmado con `JWT_SECRET`, payload `{sub,email,nivel}`). socket.io toma esa cookie en el handshake y popula `user` en el socket.

---

## 2. Chat interno

### 2.1 Modelo de datos (esquema `gozz`)

#### `chat_grupos`
Representa **un chat** — sea grupo o DM.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `nombre` | text | Para grupos. En DMs el nombre se sustituye en runtime por el nombre del otro usuario. |
| `tipo` | text | `'grupo'` o `'directo'` (DM) |
| `miembros` | jsonb | Array de user ids. Para DMs son exactamente 2. |
| `admins` | jsonb | Array de user ids que pueden administrar el grupo. |
| `avatar_url` | text | Solo grupos. |
| `creado_por` | uuid | |
| `ultimo_mensaje` | text | Cache del último mensaje (preview en sidebar). |
| `ultimo_mensaje_at` | timestamptz | Para ordenar la sidebar. |
| `created_at` | timestamptz | |

**DMs sin duplicados:** `POST /api/chat/dm` reusa el DM existente con búsqueda por contención `miembros @> to_jsonb($1::text) AND miembros @> to_jsonb($2::text)` (jsonb operator). Solo inserta si no encontró.

#### `chat_mensajes`
Cada mensaje de un chat.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `grupo_id` | uuid | FK a `chat_grupos` |
| `user_id` | uuid | Quien envió. NULL = mensaje de sistema o CoPilot. |
| `tipo` | text | `'texto'`, `'imagen'`, `'audio'`, `'video'`, `'archivo'`, `'system'`. |
| `contenido` | text | El texto del mensaje. Puede ser NULL si es solo adjunto. |
| `archivo_url` | text | URL del adjunto (servido por `/uploads/...`). |
| `archivo_nombre` | text | Nombre original. |
| `archivo_tipo` | text | MIME. |
| `archivo_tamanio` | integer | Bytes. |
| `reply_to_id` | uuid | Para respuestas a otro mensaje. |
| `reacciones` | jsonb | `{ emoji: [userId, ...] }`. |
| `leido_por` | jsonb | Array de user ids que leyeron. Acumulativo. |
| `entregado_por` | jsonb | Array de user ids a quienes llegó (cliente confirma). |
| `editado` | boolean | Default false. |
| `eliminado` | boolean | Soft delete con ventana de 3 min. |
| `link_preview` | jsonb | `{url, title, description, image, site}` — generado server-side. |
| `reenviado_de` | text | Referencia al mensaje original si es forward. |
| `menciones` | jsonb | Array de `{id, nombre}`. `id === "all"` → @todos. |
| `created_at`, `updated_at` | timestamptz | |

#### `chat_grupos_user_estado`
Estado por-usuario de cada chat (fijado, oculto, "recordar a las X").

| Columna | Tipo | Notas |
|---|---|---|
| `grupo_id` | uuid | |
| `user_id` | uuid | |
| `fijado` | boolean | |
| `oculto` | boolean | Auto-`false` al recibir un mensaje nuevo. |
| `recordar_at` | timestamptz | |
| `updated_at` | timestamptz | |

### 2.2 REST endpoints (`apps/api/src/index.ts`)

Todos requieren auth. Prefijo `/api/chat`.

| Endpoint | Qué hace |
|---|---|
| `GET /grupos` | Lista grupos donde el usuario es miembro, con `mensaje_count`, `unread_count`, info del otro usuario en DMs (online, departamento), `fijado/oculto/recordar_at`. Ordena por fijado DESC, `ultimo_mensaje_at` DESC. |
| `GET /grupos/:id/mensajes` | Últimos 50 mensajes (`ORDER BY created_at DESC LIMIT 50`, luego `.reverse()` para devolver ASC). |
| `GET /grupos/:id/mensajes?before=<ISO>` | Paginación hacia atrás — los 50 anteriores a ese timestamp. **Esto soporta el scroll-up.** |
| `POST /grupos/:id/mensajes` | Inserta mensaje, actualiza `ultimo_mensaje*`, des-oculta a otros miembros, emite por socket, dispara push notifications (menciones tienen prioridad alta). |
| `POST /grupos/:id/leer` | Marca como leído (agrega `userId` a `leido_por` de los pendientes). |
| `POST /grupos/:id/mensajes/:msgId/reaccion` | Toggle de emoji. |
| `DELETE /grupos/:id/mensajes/:msgId` | Soft-delete del propio mensaje dentro de 3 min. |
| `GET /grupos/:id/media` | Lista de imágenes/videos/archivos del grupo (para "Ver multimedia"). |
| `POST /upload` | Sube un adjunto (multer disk storage en `/root/gozz-crm/data/uploads`). |
| `POST /dm` | Resuelve/crea DM entre 2 usuarios (ver sección 2.1). |
| `GET /contactos` | Lista de miembros del equipo para el picker (NewChatModal). |
| `GET /search?q=` | Búsqueda en mensajes + usuarios. |
| `GET /grupos/:id/miembros` | Miembros con foto, online, etc. |
| `POST /grupos/:id/miembros` / `DELETE /grupos/:id/miembros/:userId` | Admin de grupos. |
| `POST /grupos` / `DELETE /grupos/:id` | Crear/eliminar grupo. |
| `POST /chat/copilot` | Pregunta al CoPilot (Anthropic) dentro del chat. |

### 2.3 Eventos socket.io (`apps/api/src/socket.ts`)

El socket.io del API maneja rooms `grupo:<id>` (por chat) y `user:<id>` (por usuario, para mensajes directos al user).

**Cliente → servidor:**
| Evento | Payload | Efecto |
|---|---|---|
| `chat:join` | `grupoId` | Une el socket a `room: grupo:<id>` (idempotente). |
| `chat:leave` | `grupoId` | Sale del room. |
| `chat:read` | `grupoId` | Marca leído en DB y emite `chat:read` al room. |
| `chat:typing` | `{ grupoId, nombre? }` | Broadcast a otros del room → `chat:typing { grupoId, userId, nombre }`. *Throttled en cliente a 1 cada 2s.* |
| `presence:heartbeat` | — | Actualiza `users.online` y `users.ultimo_ping`. |

**Servidor → cliente:**
| Evento | Payload | Cuándo |
|---|---|---|
| `chat:message` | mensaje completo + `user_nombre`, `foto_perfil_url` | Al insertar un mensaje, `emitToGrupo`. |
| `chat:message:updated` | `{ id, ...campos }` | Edición/reacción/borrado. |
| `chat:delivered` | `{ mensajeId, userIds }` | Confirmación de entrega. |
| `chat:read` | `{ grupoId, userId, timestamp }` | Otro usuario marcó leído. |
| `chat:typing` | `{ grupoId, userId, nombre }` | Otro está escribiendo. |
| `copilot:thinking` | `{ grupo_id, kind, started_at }` | CoPilot está procesando. |
| `chat:user-joined` | `{ userId, userName }` | Para presence en el room. |
| `chat:grupo-eliminado` | `{ grupoId }` | Grupo borrado para todos → la UI lo quita en vivo. |

### 2.4 Frontend del chat

```
apps/frontend/src/
├── app/chat/page.tsx              ← estado global del chat (grupos, mensajes,
│                                    socket, typing, paginación, upload, llamadas)
└── components/chat/
    ├── ChatSidebar.tsx            ← lista de chats con unread/fijado
    ├── ChatHeader.tsx             ← cabecera del chat activo (nombre, online,
    │                                "escribiendo…", botón VIDEOLLAMADA)
    ├── ChatMessages.tsx           ← lista de mensajes con scroll-up,
    │                                day-separator, reacciones, reply, menciones,
    │                                lightbox de imágenes, etc.
    ├── ChatComposer.tsx           ← textarea con @autocomplete, attach menu,
    │                                emoji picker, audio recorder, drop zone
    ├── AudioRecorder.tsx          ← grabación de notas de voz (selector de mic
    │                                con localStorage `chat_mic_device`)
    ├── AudioMessage.tsx           ← reproductor de audio
    ├── FileMessage.tsx            ← chip de archivo
    ├── MessageActions.tsx         ← menú contextual (responder, reenviar,
    │                                editar, eliminar, copiar)
    ├── ForwardModal.tsx, ChatContextMenu.tsx, AttachMenu.tsx, EmojiPicker.tsx
    ├── ChatInfoPanel.tsx          ← panel lateral con miembros/multimedia
    ├── CrearGrupoModal.tsx, NewChatMenu.tsx, NewChatModal.tsx
    ├── ChatNotifier.tsx, MessageToast.tsx, MessageStatus.tsx
    ├── CoPilotMessage.tsx         ← burbuja especial del CoPilot
    ├── IncomingCallModal.tsx      ← modal cuando te están llamando
    └── OutgoingCallOverlay.tsx    ← overlay de "llamando…" / "no contesta"
```

### 2.5 Carga de historial — scroll-up con `before`

Para evitar arrancar mostrando solo "Hoy" en DMs con muchos mensajes del día, la
carga es **incremental hacia atrás** estilo WhatsApp:

1. **Carga inicial**: `GET /api/chat/grupos/:id/mensajes` → últimos 50.
2. **Scroll-up**: cuando `ChatMessages` detecta `scrollTop <= 120`, llama
   `onLoadOlder()` que es `loadOlder` en `page.tsx`. Este hace
   `GET /api/chat/grupos/:id/mensajes?before=<created_at del más antiguo>`.
3. `ChatMessages` **preserva la posición del viewport** después del prepend
   (guarda `anchorHeight` / `anchorTop` antes de pedir, recalcula `scrollTop`
   después del DOM update). El usuario no salta.
4. `hasMore` se infiere: si el lote devolvió 50 ítems, asumimos que hay más.

### 2.6 `mergeMensajes` — anti-clobber del resync

Hay tres mecanismos que recargan mensajes (`onConnect` del socket, resync cada
12s, recarga al cambiar de chat). Si cualquiera de ellos hiciera
`setMensajes(d.mensajes)` plano, **borraría el historial ya traído por scroll-up**.

Por eso `page.tsx` define:

```ts
function mergeMensajes(prev, incoming) {
  if (!prev.length) return incoming;
  const byId = new Map();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);   // server gana ediciones
  return Array.from(byId.values())
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
```

Y todos los resyncs llaman `setMensajes(prev => mergeMensajes(prev, d.mensajes))`.

**Regla:** si tocás la carga/resync del chat, mantené `before` + `mergeMensajes`.
No vuelvas a `setMensajes(d.mensajes)` directo.

### 2.7 Indicador "escribiendo…"

- **Emitir**: `ChatComposer` llama `onTyping?.()` en `onChangeText` cuando hay
  texto. `page.tsx` throttlea a **máximo 1 emit cada 2s** vía
  `lastTypingEmitRef`, y emite
  `socket.emit("chat:typing", { grupoId: activeId, nombre: me.nombre })`.
- **Recibir**: el backend (`socket.ts`) re-emite a los demás del room
  `chat:typing { grupoId, userId, nombre }`. El listener en `page.tsx`
  guarda en `typingByGroup: Record<grupoId, Record<userId, nombre>>` y
  **programa un `setTimeout(3500ms)`** por `(grupoId,userId)` que lo borra del
  estado si no llega otro evento (`typingTimeoutsRef`).
- **Mostrar**: `activeTypingNames` (useMemo) se pasa como prop `typingNames` a
  `ChatHeader`. Si no vacío, el `statusText` muestra:
  - DM → `"escribiendo…"`
  - Grupo → `"{Nombre} está escribiendo…"` (con `+N` si son varios).
- Se ignora el eco propio (`me?.id === data.userId`).

### 2.8 Menciones, adjuntos, audio

- **Menciones**: el composer detecta `@` y abre autocomplete con miembros.
  La mención se persiste en `menciones jsonb [{id, nombre}]`. `id === "all"` es
  `@todos`. El backend dispara push de alta prioridad a los mencionados
  (notificación in-app `tipo='mencion'` con `accion_url='/tareas/chat'`).
- **Adjuntos**: `POST /api/chat/upload` (multer disk, dir `/root/gozz-crm/data/uploads`),
  luego POST del mensaje con `archivo_url`. Servido por nginx como `/uploads/...`.
- **Audio**: `AudioRecorder` graba con `MediaRecorder` + Web Audio para waveform.
  Tipo MIME negociado dinámicamente (opus/webm preferido). Sube como adjunto
  con `tipo='audio'` y `contenido="[audio Xs]"`. **Selector de micrófono**
  guarda el deviceId elegido en `localStorage` clave `chat_mic_device`, y lo usa
  como `audio: { deviceId: { ideal: micId } }` en `getUserMedia`.

---

## 3. Llamadas (videollamadas)

### 3.1 Arquitectura

```
   Caller browser                                              Callee browser
        │                                                            │
        │  click VIDEOLLAMADA                                        │
        │  ─────────────────────────────►                            │
        │   POST /api/videollamadas/direct  (crea videollamada DB)   │
        │   socket.emit videollamada:ring                            │
        │                                  ──────────────────────►   │
        │                                  socket emit               │
        │                                  videollamada:incoming     │
        │                                  → IncomingCallModal       │
        │                                                            │
        │                                  acepta → navigate         │
        │                                  socket.emit accept        │
        │   ◄──────────────────────────                              │
        │   videollamada:accepted          POST .../join             │
        │   navigate /videollamada/[id]    navigate /videollamada/[id]
        │                                                            │
        │                  ┌─── LiveKitCall ───┐                     │
        │                  │ POST /api/livekit/token { room: id }    │
        │                  └────────┬──────────┘                     │
        │                           │                                │
        │                  wss://crm.tu.com/livekit                  │
        │                           │                                │
        │                           ▼                                │
        │                  ┌────────────────┐                        │
        │                  │ gozz-livekit    │  (LiveKit SFU)         │
        │                  │ HTTP 7880      │                        │
        │                  │ RTC UDP 50000–50100 / TCP 8080          │
        │                  └────────────────┘                        │
        │                           ▲                                │
        │                           │ media (audio/video)            │
        │                           ▼                                │
        └────────────────────────────────────────────────────────────┘
```

### 3.2 Decisión arquitectónica (2026-05-29)

Antes había **WebRTC P2P puro + coturn**. Los comentarios decían
*"livekit import removido — llamadas ahora WebRTC P2P puro via socket.io signaling"*.
**No funcionaba** porque el media no atravesaba NAT entre redes distintas
y coturn no completaba el relay.

Se volvió a **LiveKit** (que seguía instalado, con servidor y libs cliente).
La causa de que LiveKit "no andaba" en su momento era trivial: `rtc.port_range`
estaba en `50000-50001` (≈1 puerto). Se amplió a `50000-50100` y se reactivó.
**No revertir a P2P sin pedirlo.**

### 3.3 Servidor LiveKit

**pm2 app `gozz-livekit`** corre `/usr/local/bin/livekit-server --config /root/gozz-crm/livekit.yaml`.

```yaml
# /root/gozz-crm/livekit.yaml
port: 7880                                   # HTTP/WS signaling
bind_addresses:
  - "0.0.0.0"
rtc:
  tcp_port: 8080                             # fallback TCP para media
  port_range_start: 50000                    # rango UDP de media
  port_range_end: 50100
  node_ip: 157.173.210.8                     # IP pública del VPS
keys:
  APIFbsvacPLE4Yk: 1gpMQlSvmxeZ4Su5DShlzRDV2Edp0asGs1bcgdyaaEY
log_level: info
room:
  auto_create: true                          # las salas se crean al primer join
  empty_timeout: 300                         # cierra sala vacía a los 5 min
  max_participants: 20
```

Las mismas keys están en `apps/api/.env`:
```
LIVEKIT_API_KEY=APIFbsvacPLE4Yk
LIVEKIT_API_SECRET=1gpMQl…
LIVEKIT_URL=wss://crm.gozz-agencia.com/livekit
LIVEKIT_HOST_URL=ws://localhost:7880
```

### 3.4 Routing nginx

Bloque `/livekit/` en `/etc/nginx/sites-available/crm`:

```nginx
location /livekit/ {
    proxy_pass http://127.0.0.1:7880/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;     # WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

La **señalización** (WSS de LiveKit) va por aquí, puerto 443 (TLS de nginx).
El **media** va directo al VPS:
- Preferido: UDP a `157.173.210.8:50000-50100`
- Fallback: TCP a `157.173.210.8:8080`

**Pendiente conocido**: oficinas con firewall estricto que bloquean todo menos
443 pueden no llegar. Si pasa, hay que habilitar TURN/relay de LiveKit por 443.

### 3.5 Backend — endpoints REST

**Tabla `gozz.videollamadas`** (campos principales):

| Columna | Tipo | Default | Notas |
|---|---|---|---|
| `id` | uuid | gen_random_uuid() | PK; **se usa como nombre de sala en LiveKit**. |
| `sala_id` | text | — | Cache del nombre legible. |
| `grupo_id` | uuid | NULL | FK al chat (si la llamada salió de ahí). |
| `iniciada_por` | uuid | — | |
| `nombre_sala` | text | — | Display name. |
| `participantes` | jsonb | `[]` | Array de user ids que aceptaron. |
| `inicio` | timestamptz | NOW() | |
| `fin` | timestamptz | NULL | |
| `duracion_segundos` | integer | NULL | |
| `transcripcion_txt`, `resumen_ia jsonb`, `tono_reunion`, `tareas_detectadas jsonb`, `analisis_claude jsonb` | — | — | Para post-llamada con IA. |
| `grabacion_url` | text | NULL | |
| `livekit_metadata` | jsonb | `{}` | |
| `tipo` | text | `'grupo'` | `'directo'` para DM. |
| `configuracion` | jsonb | `{chat,reactions,raise_hand,screen_share,background_blur}` | Defaults al crear. |

**Endpoints** (`apps/api/src/index.ts`):

| Endpoint | Línea | Qué hace |
|---|---|---|
| `POST /api/videollamadas/direct` | 1452 | Crea/resuelve una llamada 1-a-1 con `target_user_id` (reusa si hay una activa entre ambos). |
| `POST /api/videollamadas` | 1529 | Crea una llamada grupal (lleva `grupo_id`). |
| `GET /api/videollamadas` | 1518 | Lista las llamadas del usuario. |
| `GET /api/videollamadas/:id` | 1584 | Detalle (lo carga la pantalla de llamada). |
| `POST /api/videollamadas/:id/join` | 1590 | Registra al usuario en `participantes` (con validación de permisos). |
| `POST /api/videollamadas/:id/invitar` | 1620 | Suma más users a una llamada existente. |
| `POST /api/videollamadas/:id/fin` | 1905 | Marca `fin = NOW()`, calcula `duracion_segundos`. Dispara post-procesamiento IA si hay transcript. |
| `POST /api/videollamadas/resumen-ia` | 1726 | Genera resumen/tareas detectadas con Claude desde el transcript. |
| `POST /api/livekit/token` | (al final de index.ts) | **El que importa para que la llamada conecte.** |

### 3.6 Token de LiveKit

`POST /api/livekit/token` recibe `{ room }` y devuelve `{ token, url }`:

```ts
app.post("/api/livekit/token", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const roomName = String(req.body?.room || req.body?.roomName || "").trim();
  if (!roomName) { res.status(400).json({ error: "room requerido" }); return; }
  const ur = await query("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]);
  const token = await lkMintToken({
    roomName,
    identity: u.sub,
    name: ur[0]?.nombre || u.email || "Usuario",
  });
  res.json({ token, url: lkUrl });
});
```

El helper `mintToken` (`apps/api/src/livekit.ts`) usa `livekit-server-sdk`:

```ts
const at = new AccessToken(API_KEY, API_SECRET, {
  identity: opts.identity,
  name: opts.name,
  ttl: "6h",
});
at.addGrant({
  room: opts.roomName,
  roomJoin: true,
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});
return await at.toJwt();
```

Mismo `livekit.ts` exporta:
- `lkUrl` (= `LIVEKIT_URL`)
- `mintToken(opts)`
- `deleteRoom(roomName)` (vía `RoomServiceClient`)
- `listParticipants(roomName)`

### 3.7 Señalización (socket.io) — el ring

Aunque LiveKit se encarga del media, **invitar/timbrar/aceptar** corre por
socket.io (`apps/api/src/socket.ts`):

**Cliente → servidor:**
| Evento | Payload |
|---|---|
| `videollamada:ring` | `{ videollamadaId, targetUserIds, nombreSala }` |
| `videollamada:accept` | `{ videollamadaId, callerUserId }` |
| `videollamada:decline` | `{ videollamadaId, callerUserId }` |
| `videollamada:cancel` | `{ videollamadaId, targetUserIds }` |
| `videollamada:join` | `videollamadaId` (entra al room `vc:<id>`) |
| `videollamada:leave` | `videollamadaId` |

**Servidor → cliente** (enviados a `user:<id>` o al room `vc:<id>`):
| Evento | Payload |
|---|---|
| `videollamada:incoming` | `{ videollamadaId, nombreSala, from }` → abre `IncomingCallModal` en el destinatario |
| `videollamada:accepted` | `{ videollamadaId, by }` → el caller cierra "llamando…" y entra |
| `videollamada:declined` | `{ videollamadaId, by, reason? }` |
| `videollamada:canceled` | `{ videollamadaId, by }` |
| `videollamada:peer-joined` / `videollamada:peer-left` | `{ userId, peers? }` |

**Reglas de busy**: si el destinatario ya está en otra llamada (`userIsBusy`),
el server le responde al caller `videollamada:declined` con `reason: "busy"`.

### 3.8 Frontend — pantalla de llamada

```
apps/frontend/src/
├── app/videollamada/[id]/page.tsx       ← carga /api/auth/me + /api/videollamadas/:id,
│                                          decide isMember, llama /join si no lo está,
│                                          y renderiza <LiveKitCall room={id} onLeave={...}/>
├── components/videollamada/
│   ├── LiveKitCall.tsx                  ← (NUEVO) pide token, renderiza LiveKit
│   ├── VideoRoom.tsx                    ← (LEGACY) el viejo P2P puro, quedó sin uso
│   └── PreJoinScreen.tsx                ← enumera devices, default cam/mic
├── components/chat/
│   ├── IncomingCallModal.tsx            ← se monta al recibir videollamada:incoming
│   └── OutgoingCallOverlay.tsx          ← "Llamando…" / "No contesta" / "Rechazó"
└── lib/socket.ts                        ← getSocket() singleton
```

**`LiveKitCall.tsx`** (esencial):

```tsx
"use client";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";

export function LiveKitCall({ room, onLeave }) {
  const [token, setToken] = useState(null);
  const [serverUrl, setServerUrl] = useState("");

  useEffect(() => {
    fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room }),
    })
      .then(r => r.json())
      .then(d => { setToken(d.token); setServerUrl(d.url); });
  }, [room]);

  if (!token) return <Loading/>;

  return (
    <div data-lk-theme="default" style={{ height: "100dvh" }}>
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect={true}
        video={true}
        audio={true}
        onDisconnected={onLeave}
      >
        <VideoConference />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
```

`<VideoConference>` es el componente prebuilt de LiveKit: grid de participantes,
controles de mic/cam/screenshare, salir, chat lateral. Todo gratis al traerlo.

### 3.9 Lifecycle completo de una llamada

1. **Iniciar** — Caller en chat click VIDEOLLAMADA →
   `ChatHeader.startDirectCall()` →
   `POST /api/videollamadas/direct` → recibe `{ videollamadaId }` →
   `socket.emit("videollamada:ring", { videollamadaId, targetUserIds, nombreSala })` →
   abre `OutgoingCallOverlay` ("Llamando…").

2. **Timbrar** — Servidor reenvía a cada `targetUserId` por su socket
   personal (`user:<id>`) → `videollamada:incoming`. Si el destinatario está
   en otra llamada, el server responde `videollamada:declined { reason: "busy" }`
   al caller. Si no, `IncomingCallModal` aparece en el destinatario.

3. **Aceptar** — Callee click Aceptar → `socket.emit("videollamada:accept")` +
   `router.push("/videollamada/<id>")` → la página llama `POST /:id/join` y
   monta `LiveKitCall`. Caller recibe `videollamada:accepted` → cierra overlay
   y también navega.

4. **Conectar** — Ambos `LiveKitCall` piden token al API, abren WSS a
   `wss://crm.gozz-agencia.com/livekit`. LiveKit los pone en la misma
   sala (`auto_create: true`). El media empieza a fluir.

5. **Colgar** — Salir desde `<VideoConference>` dispara `onDisconnected` →
   `onLeave` de la página → `POST /api/videollamadas/:id/fin` →
   `router.push("/chat")`. El backend calcula `duracion_segundos` y, si hay
   transcript, dispara post-procesamiento IA (`resumen-ia`, `tareas_detectadas`,
   `tono_reunion`).

### 3.10 Notas operativas

- **coturn (puerto 3478)** quedó corriendo en el VPS pero ya no se usa para las
  llamadas. Se podría apagar.
- **El viejo `VideoRoom.tsx` (P2P)** quedó en el repo pero no se importa en
  ningún lado — sirve como referencia/rollback.
- **Caché del navegador**: tras cambios en el frontend de llamadas, `Ctrl+Shift+R`
  obligatorio o usar incógnito.
- **Verificación end-to-end** debe ser entre dos navegadores en redes distintas
  (ideal: uno en WiFi, otro en datos del celular).

---

## 4. Build/deploy

```
# API
cd /root/gozz-crm/apps/api && pnpm build         # tsc → dist/
pm2 restart gozz-api --update-env

# Frontend
cd /root/gozz-crm/apps/frontend && pnpm build    # next build + postbuild
pm2 restart gozz-frontend --update-env

# LiveKit (al cambiar livekit.yaml)
pm2 restart gozz-livekit
```

Edición remota: `vps_get.py` / `vps_put.py` (paramiko SFTP, ver memoria
[[vps-tu-impulso-latino]]). Convención de backups: copiar el archivo a
`<original>.bak-pre-<desc>-<fecha>` antes de tocarlo.

---

## 5. Referencia rápida de archivos

| Archivo | Función |
|---|---|
| `apps/api/src/socket.ts` | Todo el realtime: chat + llamadas (ring/accept/decline). |
| `apps/api/src/index.ts` | Endpoints REST de chat y videollamadas; ruta `/api/livekit/token`. |
| `apps/api/src/livekit.ts` | Helper `mintToken`, `lkUrl`, `deleteRoom`. |
| `apps/api/.env` | `LIVEKIT_API_KEY/SECRET/URL/HOST_URL`. |
| `livekit.yaml` (raíz del repo) | Config del servidor LiveKit. |
| `/etc/nginx/sites-available/crm` | Routing público; bloque `/livekit/` con WS upgrade. |
| `apps/frontend/src/app/chat/page.tsx` | Página principal del chat. |
| `apps/frontend/src/components/chat/*.tsx` | Componentes del chat (Sidebar, Header, Messages, Composer, etc.). |
| `apps/frontend/src/app/videollamada/[id]/page.tsx` | Página de la llamada. |
| `apps/frontend/src/components/videollamada/LiveKitCall.tsx` | Sala basada en LiveKit. |
| `apps/frontend/src/components/videollamada/VideoRoom.tsx` | Legacy P2P (sin uso). |
| `apps/frontend/src/components/chat/IncomingCallModal.tsx` | Modal de "te están llamando". |
| `apps/frontend/src/components/chat/OutgoingCallOverlay.tsx` | Overlay de "llamando…". |
