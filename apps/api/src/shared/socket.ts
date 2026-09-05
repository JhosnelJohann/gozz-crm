import { Server as HTTPServer } from "http";
import { Server as IOServer, Socket } from "socket.io";
import { verifyToken } from "./auth-middleware.js";
import { query } from "./db.js";

let io: IOServer | null = null;

// Registro en memoria de la llamada activa por usuario, para avisar AL INSTANTE a una
// pestana/navegador recien abierto (sin esperar el siguiente latido). ts permite expirar
// si la pestana en llamada se cerro.
const activeCalls = new Map<string, { videollamadaId: string; title: string; ts: number }>();

export function initSocket(httpServer: HTTPServer) {
  io = new IOServer(httpServer, {
    cors: { origin: true, credentials: true },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Auth via cookie
  io.use((socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie || "";
      const match = cookie.match(/access_token=([^;]+)/);
      if (!match) return next(new Error("No token"));
      const payload = verifyToken(match[1]);
      (socket as any).user = payload;
      next();
    } catch (e) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket as any).user;
    console.log(`[socket] connected ${user.email}`);

    // Presence: mark online + update ultima_actividad
    query("UPDATE gozz.users SET online = true, ultima_actividad = NOW() WHERE id = $1", [user.sub]).catch(() => {});
    socket.broadcast.emit("presence:online", { userId: user.sub });

    // Join personal notification room
    socket.join(`user:${user.sub}`);

    // Si el usuario YA tiene una llamada activa (en otra pestana/dispositivo), avisarle a
    // ESTA sesion recien conectada de inmediato para que muestre "Volver a la llamada".
    {
      const act = activeCalls.get(user.sub);
      if (act && Date.now() - act.ts < 15000) {
        socket.emit("videollamada:self-active", { videollamadaId: act.videollamadaId, title: act.title });
      }
    }

    // Auto-subscribe (silencioso, sin emitir chat:user-joined) a TODOS los grupos
    // donde el usuario es miembro. Esto garantiza que reciba chat:message y
    // chat:typing de cualquier chat — no solo del que tiene abierto — para que
    // la sidebar refresque preview/badge y muestre "escribiendo…" en vivo.
    // Los grupos creados/unidos DESPUÉS del connect se manejan en index.ts
    // (POST /grupos, /grupos/:id/miembros, /dm) vía io.in(user:<id>).socketsJoin.
    query<any>(
      "SELECT id FROM gozz.chat_grupos WHERE miembros @> to_jsonb($1::text)",
      [user.sub]
    ).then((rows) => {
      for (const r of rows) socket.join(`grupo:${r.id}`);
    }).catch((e: any) => console.warn(`[socket] auto-join failed for ${user.sub}:`, e?.message));

    // Re-ring on (re)connect: si el usuario que (re)conecta es target de una videollamada
    // ACTIVA (<45s) y aun no es participante, re-emitirle el incoming. Cubre a quien estaba
    // desconectado / reconectando justo cuando se hizo el ring original (analogo al re-join
    // de chat). El modal dedupea por videollamadaId, asi que no molesta si ya lo tenia.
    (async () => {
      try {
        const activas = await query<any>(
          `SELECT v.id, v.nombre_sala, v.iniciada_por, v.tipo, v.grupo_id,
                  g.tipo AS g_tipo, g.nombre AS g_nombre, g.avatar_url AS g_avatar,
                  CASE WHEN g.miembros IS NOT NULL THEN jsonb_array_length(g.miembros) ELSE 0 END AS g_miembros_count
           FROM gozz.videollamadas v
           LEFT JOIN gozz.chat_grupos g ON g.id = v.grupo_id
           WHERE v.fin IS NULL
             AND v.inicio > NOW() - INTERVAL '45 seconds'
             AND v.iniciada_por <> $1
             AND NOT (v.participantes @> to_jsonb($1::text))
             AND (
               (v.grupo_id IS NOT NULL AND g.miembros @> to_jsonb($1::text))
               OR (v.grupo_id IS NULL AND v.tipo = '1-1')
             )`,
          [user.sub]
        );
        for (const ll of activas) {
          const caller = await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [ll.iniciada_por]);
          const esGrupo = !!ll.grupo_id && ll.g_tipo && ll.g_tipo !== "directo";
          io?.to(`user:${user.sub}`).emit("videollamada:incoming", {
            videollamadaId: ll.id,
            nombreSala: ll.nombre_sala,
            tipo: esGrupo ? "grupo" : "1-1",
            grupo: esGrupo ? { id: ll.grupo_id, nombre: ll.g_nombre, avatar_url: ll.g_avatar, miembros_count: ll.g_miembros_count } : null,
            from: { id: ll.iniciada_por, nombre: caller[0]?.nombre || "Usuario", foto_perfil_url: caller[0]?.foto_perfil_url || null },
            reRing: true,
          });
          console.log(`[re-ring] user=${user.sub} videollamada=${ll.id}`);
        }
      } catch (e: any) {
        console.warn(`[re-ring] failed for ${user.sub}:`, e?.message);
      }
    })();

    // Join chat grupo
    socket.on("chat:join", async (grupoId: string) => {
      // Verify user is a member
      const rows = await query<any>(
        "SELECT miembros FROM gozz.chat_grupos WHERE id = $1",
        [grupoId]
      );
      if (!rows[0]) return;
      const miembros: string[] = rows[0].miembros || [];
      if (!miembros.includes(user.sub)) {
        // Super admin sees all
        if (user.nivel !== "super_admin" && user.nivel !== "admin") return;
      }
      socket.join(`grupo:${grupoId}`);
      socket.to(`grupo:${grupoId}`).emit("chat:user-joined", { userId: user.sub, userName: user.email });
    });

    socket.on("chat:leave", (grupoId: string) => {
      socket.leave(`grupo:${grupoId}`);
    });

    socket.on("chat:typing", (data: any) => {
      // Acepta string (compat) o { grupoId, nombre } para mostrar "X está escribiendo..."
      const grupoId = typeof data === "string" ? data : data?.grupoId;
      const nombre = (typeof data === "object" && data?.nombre) ? String(data.nombre) : undefined;
      if (!grupoId) return;
      socket.to(`grupo:${grupoId}`).emit("chat:typing", { grupoId, userId: user.sub, nombre });
    });

    // Videollamada room — 1-a-1 estricto
    socket.on("videollamada:join", (videollamadaId: string) => {
      if (!videollamadaId || typeof videollamadaId !== "string") return;
      const room = `videollamada:${videollamadaId}`;
      const current = io?.sockets.adapter.rooms.get(room);
      const size = current?.size || 0;
      if (size >= 2) {
        socket.emit("videollamada:full", { videollamadaId });
        return;
      }
      socket.join(room);
      (socket as any)._videollamadaRoom = room;
      const peers = Array.from(io?.sockets.adapter.rooms.get(room) || [])
        .map((sid) => (io?.sockets.sockets.get(sid) as any)?.user?.sub)
        .filter(Boolean);
      if (peers.length >= 2 && io) {
        io.to(room).emit("videollamada:peer-joined", { userId: user.sub, peers });
      }
    });

    socket.on("videollamada:leave", async (videollamadaId: string) => {
      if (!videollamadaId) return;
      const room = `videollamada:${videollamadaId}`;
      socket.leave(room);
      (socket as any)._videollamadaRoom = undefined;
      if (io) io.to(room).emit("videollamada:peer-left", { userId: user.sub });
      await maybeCloseEmptyVideollamada(videollamadaId);
    });

    socket.on("videollamada:chat", async (data: { videollamadaId: string; contenido: string }) => {
      try {
        const rows = await query<any>(
          `INSERT INTO gozz.videollamadas_chat (videollamada_id, user_id, tipo, contenido)
           VALUES ($1, $2, 'texto', $3) RETURNING *`,
          [data.videollamadaId, user.sub, data.contenido]
        );
        io!.to(`videollamada:${data.videollamadaId}`).emit("videollamada:chat", rows[0]);
      } catch {}
    });

    socket.on("presence:heartbeat", () => {
      query("UPDATE gozz.users SET ultima_actividad = NOW() WHERE id = $1", [user.sub]).catch(() => {});
    });

    // Chat read receipts
    socket.on("chat:read", async (grupoId: string) => {
      try {
        // Add user to leido_por on all messages in grupo where user isn't sender and isn't in leido_por yet
        await query(
          `UPDATE gozz.chat_mensajes
             SET leido_por = COALESCE(leido_por, '[]'::jsonb) || to_jsonb($1::text)
           WHERE grupo_id = $2
             AND user_id != $1
             AND NOT (COALESCE(leido_por, '[]'::jsonb) @> to_jsonb($1::text))`,
          [user.sub, grupoId]
        );
        // Broadcast to group room so the sender UI updates
        if (io) io.to(`grupo:${grupoId}`).emit("chat:read", { grupoId, userId: user.sub, timestamp: new Date().toISOString() });
      } catch {}
    });

    // Videollamada ring (caller emits)
    socket.on("videollamada:ring", async (data: { videollamadaId: string; targetUserIds: string[]; nombreSala: string }) => {
      const { videollamadaId, targetUserIds, nombreSala } = data;
      if (!Array.isArray(targetUserIds)) return;
      const urs = await query<any>("SELECT id, nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [user.sub]).catch(() => []);
      const caller = urs[0] || { id: user.sub, nombre: user.email };
      for (const tid of targetUserIds) {
        if (tid === user.sub) continue;
        // Si el target ya está en otra llamada activa → auto-rechazo
        const busyIn = await userIsBusy(tid, videollamadaId);
        if (busyIn) {
          if (io) io.to(`user:${user.sub}`).emit("videollamada:declined", { videollamadaId, by: tid, reason: "busy" });
          await insertCallMissedSystemMessage({
            videollamadaId, reason: "busy", callerUserId: user.sub, calleeUserId: tid
          });
          continue;
        }
        if (io) io.to(`user:${tid}`).emit("videollamada:incoming", { videollamadaId, nombreSala, from: caller });
      }
    });

    socket.on("videollamada:accept", (data: { videollamadaId: string; callerUserId: string }) => {
      if (!data?.callerUserId) return;
      if (io) io.to(`user:${data.callerUserId}`).emit("videollamada:accepted", { videollamadaId: data.videollamadaId, by: user.sub });
    });

    // Atendida/rechazada en una pestaña -> avisar a las OTRAS pestañas/dispositivos del
    // MISMO usuario para que dejen de sonar (deja de timbrar en todas las sesiones).
    socket.on("videollamada:handled", (data: { videollamadaId: string }) => {
      if (!data?.videollamadaId || !io) return;
      io.to(`user:${user.sub}`).emit("videollamada:handled", { videollamadaId: data.videollamadaId });
    });

    // Estado "estoy en una videollamada AHORA": la pestana en llamada emite un latido
    // (cada ~6s) que el server reenvia a TODAS las sesiones del MISMO usuario (user:<id>),
    // para que cualquier otra pestana/navegador/dispositivo muestre "Volver a la llamada".
    socket.on("videollamada:self-active", (data: { videollamadaId: string; title?: string }) => {
      if (!data?.videollamadaId || !io) return;
      const title = data.title || "Videollamada";
      activeCalls.set(user.sub, { videollamadaId: data.videollamadaId, title, ts: Date.now() });
      io.to(`user:${user.sub}`).emit("videollamada:self-active", { videollamadaId: data.videollamadaId, title });
    });
    socket.on("videollamada:self-inactive", (data: { videollamadaId?: string }) => {
      if (!io) return;
      const cur = activeCalls.get(user.sub);
      if (cur && (!data?.videollamadaId || cur.videollamadaId === data.videollamadaId)) activeCalls.delete(user.sub);
      io.to(`user:${user.sub}`).emit("videollamada:self-inactive", { videollamadaId: data?.videollamadaId || null });
    });
    // Una sesion pregunta si el usuario tiene llamada activa (al montar) -> respuesta inmediata.
    socket.on("videollamada:who-active", () => {
      const act = activeCalls.get(user.sub);
      if (act && Date.now() - act.ts < 15000) {
        socket.emit("videollamada:self-active", { videollamadaId: act.videollamadaId, title: act.title });
      }
    });

    socket.on("videollamada:decline", async (data: { videollamadaId: string; callerUserId: string }) => {
      if (!data?.callerUserId) return;
      if (io) io.to(`user:${data.callerUserId}`).emit("videollamada:declined", { videollamadaId: data.videollamadaId, by: user.sub });
      // Sistema: "No contestó" — el que declinó es el usuario actual; el caller es data.callerUserId
      await insertCallMissedSystemMessage({
        videollamadaId: data.videollamadaId,
        reason: "declined",
        callerUserId: data.callerUserId,
        calleeUserId: user.sub,
      });
      await maybeCloseEmptyVideollamada(data.videollamadaId);
    });

    socket.on("videollamada:cancel", async (data: { videollamadaId: string; targetUserIds: string[] }) => {
      if (!Array.isArray(data?.targetUserIds)) return;
      for (const tid of data.targetUserIds) {
        if (io) io.to(`user:${tid}`).emit("videollamada:canceled", { videollamadaId: data.videollamadaId, by: user.sub });
      }
      // Sistema: "Sin respuesta" — el caller es user.sub, el callee es el primero de targetUserIds (en 1-1)
      const callee = data.targetUserIds[0];
      if (callee) {
        await insertCallMissedSystemMessage({
          videollamadaId: data.videollamadaId,
          reason: "no_answer",
          callerUserId: user.sub,
          calleeUserId: callee,
        });
      }
      await maybeCloseEmptyVideollamada(data.videollamadaId);
    });

    // WebRTC P2P signaling relay — explicit events
    const relay = (event: string) => (data: { to: string; [k: string]: any }) => {
      if (!data?.to || !io) return;
      const payload = { ...data, from: user.sub };
      delete (payload as any).to;
      console.log(`[call] ${event} ${user.sub} -> ${data.to}`);
      io.to(`user:${data.to}`).emit(event, payload);
    };
    socket.on("call:ready", relay("call:ready"));
    socket.on("call:offer", relay("call:offer"));
    socket.on("call:answer", relay("call:answer"));
    socket.on("call:ice", relay("call:ice"));
    socket.on("call:hangup", relay("call:hangup"));
    // Eventos in-call: reacciones, levantar mano, etc. Payload genérico.
    socket.on("call:event", relay("call:event"));

    socket.on("disconnect", () => {
      console.log(`[socket] disconnected ${user.email}`);
      query("UPDATE gozz.users SET online = false, ultima_actividad = NOW() WHERE id = $1", [user.sub]).catch(() => {});
      const room: string | undefined = (socket as any)._videollamadaRoom;
      if (room && io) {
        io.to(room).emit("videollamada:peer-left", { userId: user.sub });
        const vidId = room.slice("videollamada:".length);
        // disconnect ya removió la socket del room; chequeamos si quedó vacío.
        maybeCloseEmptyVideollamada(vidId).catch(() => {});
      }
      if (io) io.emit("presence:offline", { userId: user.sub, timestamp: new Date().toISOString() });
    });
  });

  return io;
}

export function getIO(): IOServer {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

export function emitToGrupo(grupoId: string, event: string, data: any) {
  if (io) io.to(`grupo:${grupoId}`).emit(event, data);
}

export function emitToUser(userId: string, event: string, data: any) {
  if (!io) return;
  const room = `user:${userId}`;
  const size = io.sockets.adapter.rooms.get(room)?.size || 0;
  console.log(`[emit] ${event} -> ${room} (sockets=${size})`);
  io.to(room).emit(event, data);
}

// Para cada usuario pasado, agarra todos sus sockets conectados ahora mismo
// (vía el room user:<id>) y los mete al room del grupo. Para usar tras crear un
// grupo / DM o agregar un miembro — así los miembros ya conectados reciben
// chat:message/chat:typing del grupo nuevo sin refrescar la página. Los que se
// conecten DESPUÉS se cubren con el auto-join silencioso del handler `connection`.
export function joinUsersToGrupo(userIds: string[], grupoId: string) {
  if (!io || !grupoId) return;
  for (const uid of userIds) {
    if (!uid) continue;
    io.in(`user:${uid}`).socketsJoin(`grupo:${grupoId}`);
  }
}

// Chequea si un usuario está AHORA MISMO en una videollamada. Source of truth =
// membresía en las rooms `videollamada:<id>` de socket.io. La tabla DB no es confiable
// porque si el caller abandona sin llamar /fin, la fila queda huérfana.
export function userIsBusy(userId: string, excludingVideollamadaId?: string | null): string | null {
  if (!io) return null;
  for (const [roomName, socketIds] of io.sockets.adapter.rooms) {
    if (!roomName.startsWith("videollamada:")) continue;
    const vidId = roomName.slice("videollamada:".length);
    if (excludingVideollamadaId && vidId === excludingVideollamadaId) continue;
    for (const sid of socketIds) {
      const s = io.sockets.sockets.get(sid) as any;
      if (s?.user?.sub === userId) return vidId;
    }
  }
  return null;
}

// Si el room quedó sin sockets, marca la videollamada como finalizada en DB
// para no dejar filas con fin IS NULL (que antes confundían al check de busy).
async function maybeCloseEmptyVideollamada(videollamadaId: string) {
  if (!io) return;
  const room = `videollamada:${videollamadaId}`;
  const size = io.sockets.adapter.rooms.get(room)?.size || 0;
  if (size > 0) return;
  try {
    await query(
      `UPDATE gozz.videollamadas
         SET fin = COALESCE(fin, NOW()),
             duracion_segundos = COALESCE(duracion_segundos, EXTRACT(EPOCH FROM (NOW() - inicio))::int)
       WHERE id = $1 AND fin IS NULL`,
      [videollamadaId]
    );
  } catch (e: any) {
    console.error("[videollamada auto-close] error:", e?.message);
  }
}

// Inserta un mensaje sistema "llamada perdida" en el grupo DM/grupal asociado a la videollamada.
// Idempotente: no duplica si ya existe un call_missed del mismo videollamadaId.
export async function insertCallMissedSystemMessage(opts: {
  videollamadaId: string;
  reason: "no_answer" | "declined" | "busy";
  callerUserId: string;
  calleeUserId: string;
}) {
  const { videollamadaId, reason, callerUserId, calleeUserId } = opts;
  try {
    // 1. Buscar grupo + participantes asociados a la videollamada
    const rows = await query<any>(
      "SELECT grupo_id, participantes FROM gozz.videollamadas WHERE id = $1",
      [videollamadaId]
    );
    const grupoId: string | null = rows[0]?.grupo_id || null;
    if (!grupoId) return;

    // GUARD: si el callee REALMENTE se unió/atendió la llamada (está en participantes),
    // NUNCA marcarlo como "rechazó/perdida". Esto evita el decline fantasma del timeout
    // de 45s que se disparaba aunque la persona ya hubiera aceptado.
    const participantes: string[] = Array.isArray(rows[0]?.participantes) ? rows[0].participantes : [];
    if (participantes.includes(calleeUserId)) return;

    // 2. Idempotencia: si ya existe un mensaje call_missed para este videollamadaId, no duplicar.
    const existing = await query<any>(
      `SELECT 1 FROM gozz.chat_mensajes
        WHERE grupo_id = $1 AND tipo = 'sistema'
          AND contenido LIKE $2
        LIMIT 1`,
      [grupoId, `%"videollamadaId":"${videollamadaId}"%`]
    );
    if (existing[0]) return;

    // 3. Fetch nombres para payload legible
    const [c, e] = await Promise.all([
      query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [callerUserId]),
      query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [calleeUserId]),
    ]);
    const caller = c[0] || { nombre: "Usuario" };
    const callee = e[0] || { nombre: "Usuario" };

    // 4. Insert sistema con payload JSON
    const payload = {
      _t: "call_missed",
      videollamadaId,
      reason,
      caller: { id: callerUserId, nombre: caller.nombre, foto_perfil_url: caller.foto_perfil_url || null },
      callee: { id: calleeUserId, nombre: callee.nombre, foto_perfil_url: callee.foto_perfil_url || null },
    };
    const ins = await query<any>(
      `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
       VALUES ($1, NULL, 'sistema', $2) RETURNING *`,
      [grupoId, JSON.stringify(payload)]
    );
    await query(
      "UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2",
      [reason === "declined" ? "Llamada rechazada" : "Llamada sin respuesta", grupoId]
    );

    // 5. Emitir al grupo para render en vivo
    if (io) {
      io.to(`grupo:${grupoId}`).emit("chat:message", {
        ...ins[0],
        user_nombre: "Sistema",
        foto_perfil_url: null,
      });
    }
  } catch (e: any) {
    console.error("[call-missed-sys] error:", e?.message);
  }
}
