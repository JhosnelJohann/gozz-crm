# PENDIENTES — Videollamadas (LiveKit)

## Bug latente: cap a 2 participantes en `videollamada:join` (socket.ts)

`apps/api/src/socket.ts`, handler `socket.on("videollamada:join", ...)`:

```
const size = current?.size || 0;
if (size >= 2) { socket.emit("videollamada:full", { videollamadaId }); return; }
```

Capa la room socket `videollamada:<id>` a **2** participantes (legacy del P2P 1-a-1).

**Estado:** DORMIDO. El flujo actual LiveKit (`app/videollamada/[id]/page.tsx` -> `LiveKitCall`)
NO emite `videollamada:join` (eso quedo solo en `VideoRoom.tsx`/`ChatPanel.tsx` legacy P2P).
Por eso hoy NO afecta a las llamadas grupales.

**Riesgo:** si algo reactiva `videollamada:join` en el flujo LiveKit (p.ej. para tracking de
"busy" o presencia en sala), este cap **rompera los grupales** (3er participante recibe
`videollamada:full`). Efecto secundario: `userIsBusy()` hoy es casi no-op porque nadie entra
a esas rooms; si se reactiva join, revisar tambien el busy.

**Fix cuando se reactive:** subir el cap a `max_participants` de la sala (livekit.yaml = 20),
o eliminar el cap y delegar el limite al SFU.

_Anotado 2026-06-01 durante el fix de llamadas (TURN server-side + re-ring + push grupal)._
