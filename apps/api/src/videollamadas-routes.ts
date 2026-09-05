import type { Express } from "express";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { emitToUser, emitToGrupo, userIsBusy, insertCallMissedSystemMessage } from "./shared/socket.js";
import { sendPushToUser } from "./push.js";
import { mintToken as lkMintToken, lkUrl, listParticipants as lkListParticipants } from "./livekit.js"; // llamadas vía LiveKit (SFU)

const nanoSala = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 12);

/** Videollamadas (LiveKit): salas directas/de grupo, invitaciones, resumen por IA, y el token de sala. */
export function registerVideollamadasRoutes(app: Express) {
// ============================================================
// Videollamadas
// ============================================================
// Cuantos participantes hay AHORA en la sala LiveKit de una videollamada (source of truth).
  async function salaTieneParticipantes(videollamadaId: string): Promise<number> {
  try { const ps = await lkListParticipants(videollamadaId); return Array.isArray(ps) ? ps.length : 0; }
  catch { return 0; }
}
// Si ya hay una videollamada ACTIVA para este grupo/DM, devolverla (no crear una en paralelo).
// Activa = fin IS NULL y (sala LiveKit con gente O recien creada <25s, para cubrir el arranque).
  async function videollamadaActivaDeGrupo(grupoId: string): Promise<any | null> {
  if (!grupoId) return null;
  const rows = await query<any>("SELECT * FROM gozz.videollamadas WHERE grupo_id = $1 AND fin IS NULL ORDER BY inicio DESC LIMIT 5", [grupoId]);
  for (const ex of rows) {
    const reciente = (Date.now() - new Date(ex.inicio).getTime()) < 25000;
    if (reciente || (await salaTieneParticipantes(ex.id)) > 0) return ex;
  }
  return null;
}

  app.post("/api/videollamadas/direct", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const { target_user_id, grupo_id } = req.body || {};
  if (!target_user_id) { res.status(400).json({ error: "target_user_id requerido" }); return; }
  // Find or create DM grupo
  let dmId = grupo_id || null;
  if (!dmId) {
    const existing = await query<any>(
      `SELECT id FROM gozz.chat_grupos
       WHERE tipo = 'directo'
         AND miembros @> to_jsonb($1::text)
         AND miembros @> to_jsonb($2::text) LIMIT 1`,
      [u.sub, target_user_id]
    );
    if (existing[0]) dmId = existing[0].id;
    else {
      const created = await query<any>(
        `INSERT INTO gozz.chat_grupos (nombre, tipo, creado_por, miembros, admins)
         VALUES ('DM', 'directo', $1, $2::jsonb, $3::jsonb) RETURNING id`,
        [u.sub, JSON.stringify([u.sub, target_user_id]), JSON.stringify([u.sub, target_user_id])]
      );
      dmId = created[0].id;
    }
  }
  // Evitar llamadas en paralelo: si ya hay una activa en este DM, unirse a ella.
  const reuseDm = await videollamadaActivaDeGrupo(dmId);
  if (reuseDm) { res.json({ videollamada: reuseDm, reused: true }); return; }
  const targetRow = await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [target_user_id]);
  const targetName = targetRow[0]?.nombre || "Llamada";
  const salaId = "gozz-" + nanoSala();
  const rows = await query<any>(
    `INSERT INTO gozz.videollamadas (sala_id, grupo_id, iniciada_por, nombre_sala, participantes, tipo)
     VALUES ($1, $2, $3, $4, $5::jsonb, '1-1') RETURNING *`,
    [salaId, dmId, u.sub, targetName, JSON.stringify([u.sub])]
  );
  const myRow = await query<any>("SELECT nombre, email, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]);
  const displayName = myRow[0]?.nombre || myRow[0]?.email || "Anonimo";
  console.log("[ring] caller=" + u.sub + " target=" + target_user_id + " videollamada=" + rows[0].id);

  // Busy check: si el target está en otra llamada activa, auto-rechazo
  const busyIn = await userIsBusy(target_user_id, rows[0].id);
  if (busyIn) {
    emitToUser(u.sub, "videollamada:declined", { videollamadaId: rows[0].id, by: target_user_id, reason: "busy" });
    await insertCallMissedSystemMessage({
      videollamadaId: rows[0].id, reason: "busy", callerUserId: u.sub, calleeUserId: target_user_id
    });
    // Marcar la videollamada como finalizada para no dejarla huérfana
    await query("UPDATE gozz.videollamadas SET fin = NOW() WHERE id = $1", [rows[0].id]);
    res.json({ videollamada: rows[0], busy: true });
    return;
  }

  emitToUser(target_user_id, "videollamada:incoming", {
    videollamadaId: rows[0].id,
    nombreSala: targetName,
    tipo: "1-1",
    from: { id: u.sub, nombre: displayName, foto_perfil_url: myRow[0]?.foto_perfil_url || null }
  });
  sendPushToUser(target_user_id, {
    title: "Llamada entrante",
    body: `${displayName} te esta llamando`,
    url: `/videollamada/${rows[0].id}`,
    tag: `call-${rows[0].id}`,
    kind: "llamada",
    requireInteraction: true,
  }).catch(() => {});
  res.json({ videollamada: rows[0] });
});

  app.get("/api/videollamadas", requireAuth, async (req, res) => {
  const rows = await query<any>(
    `SELECT v.*, u.nombre AS iniciada_por_nombre
     FROM gozz.videollamadas v
     LEFT JOIN gozz.users u ON u.id = v.iniciada_por
     ORDER BY v.inicio DESC LIMIT 100`,
    []
  );
  res.json({ videollamadas: rows });
});

  app.post("/api/videollamadas", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const { grupo_id, nombre_sala } = req.body;
  // Evitar llamadas grupales en paralelo: si ya hay una activa para el grupo, unirse a ella.
  if (grupo_id) {
    const reuseG = await videollamadaActivaDeGrupo(grupo_id);
    if (reuseG) { res.json({ videollamada: reuseG, target_user_ids: [], reused: true }); return; }
  }
  const salaId = "gozz-" + nanoSala();
  const rows = await query<any>(
    `INSERT INTO gozz.videollamadas (sala_id, grupo_id, iniciada_por, nombre_sala, participantes)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [salaId, grupo_id || null, u.sub, nombre_sala || "Videollamada", JSON.stringify([u.sub])]
  );
  const userRows = await query<any>("SELECT nombre, email, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]);
  const displayName = userRows[0]?.nombre || userRows[0]?.email || "Anonimo";
  let targetUserIds: string[] = [];
  if (grupo_id) {
    emitToGrupo(grupo_id, "videollamada:started", { videollamada: rows[0], userId: u.sub });
    // Ring each group member individually with incoming modal
    try {
      const grupoRows = await query<any>(
        "SELECT id, nombre, avatar_url, miembros, tipo FROM gozz.chat_grupos WHERE id = $1",
        [grupo_id]
      );
      const g = grupoRows[0];
      if (g && Array.isArray(g.miembros)) {
        const otros = g.miembros.filter((id: string) => id !== u.sub);
        targetUserIds = otros;
        // Fetch up to 3 members (excluding caller) for avatar stack
        const avatarsRows = await query<any>(
          "SELECT id, nombre, foto_perfil_url FROM gozz.users WHERE id = ANY($1::uuid[]) LIMIT 3",
          [otros]
        );
        const from = { id: u.sub, nombre: displayName, foto_perfil_url: userRows[0]?.foto_perfil_url || null };
        const payload = {
          videollamadaId: rows[0].id,
          nombreSala: rows[0].nombre_sala,
          tipo: g.tipo === "directo" ? "1-1" : "grupo",
          grupo: g.tipo === "directo" ? null : { id: g.id, nombre: g.nombre, avatar_url: g.avatar_url, miembros_count: g.miembros.length },
          from,
          otrosMiembros: avatarsRows,
        };
        // Ring + push en PARALELO; un fallo individual no bloquea al resto (Promise.all + try/catch por miembro).
        await Promise.all(otros.map(async (mid: string) => {
          try {
            const busyIn = await userIsBusy(mid, rows[0].id);
            if (busyIn) {
              emitToUser(u.sub, "videollamada:declined", { videollamadaId: rows[0].id, by: mid, reason: "busy" });
              await insertCallMissedSystemMessage({
                videollamadaId: rows[0].id, reason: "busy", callerUserId: u.sub, calleeUserId: mid
              });
              return;
            }
            emitToUser(mid, "videollamada:incoming", payload);
            await sendPushToUser(mid, {
              title: `Llamada grupal: ${rows[0].nombre_sala}`,
              body: `${displayName} te esta llamando`,
              url: `/videollamada/${rows[0].id}`,
              tag: `call-${rows[0].id}`,
              kind: "llamada",
              requireInteraction: true,
            });
          } catch (e: any) {
            console.error(`[videollamadas] ring/push fail mid=${mid}`, e?.message);
          }
        }));
      }
    } catch (e: any) {
      console.error("[videollamadas] broadcast ring failed", e?.message);
    }
  }
  res.json({ videollamada: rows[0], target_user_ids: targetUserIds });
});

  app.get("/api/videollamadas/:id", requireAuth, async (req, res) => {
  const rows = await query<any>("SELECT * FROM gozz.videollamadas WHERE id = $1", [req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: "No encontrado" }); return; }
  res.json({ videollamada: rows[0] });
});

  app.post("/api/videollamadas/:id/join", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const rows = await query<any>("SELECT * FROM gozz.videollamadas WHERE id = $1", [req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: "No encontrado" }); return; }
  const v = rows[0];
  if (v.fin) { res.status(410).json({ error: "Llamada finalizada" }); return; }
  const userRows = await query<any>("SELECT nombre, email FROM gozz.users WHERE id = $1", [u.sub]);
  const displayName = userRows[0]?.nombre || userRows[0]?.email || "Anonimo";
  const participantes: string[] = Array.isArray(v.participantes) ? v.participantes : [];
  // Validar membresía: iniciador, ya en participantes, o miembro del grupo_id asociado
  let autorizado = v.iniciada_por === u.sub || participantes.includes(u.sub);
  if (!autorizado && v.grupo_id) {
    const g = await query<any>("SELECT miembros FROM gozz.chat_grupos WHERE id = $1", [v.grupo_id]);
    const miembros: string[] = Array.isArray(g[0]?.miembros) ? g[0].miembros : [];
    autorizado = miembros.includes(u.sub);
  }
  if (!autorizado) { res.status(403).json({ error: "No autorizado en esta sala" }); return; }
  if (!participantes.includes(u.sub)) {
    participantes.push(u.sub);
    await query<any>(
      "UPDATE gozz.videollamadas SET participantes = $1::jsonb WHERE id = $2",
      [JSON.stringify(participantes), v.id]
    );
  }
  res.json({ displayName, role: v.iniciada_por === u.sub ? "host" : "participant" });
});

// Invitar miembros adicionales a una videollamada en curso.
// Si la call estaba en un chat DM 1-a-1, al agregar terceros se crea automáticamente
// un nuevo chat grupal con color asignado que agrupa a todos los participantes.
  app.post("/api/videollamadas/:id/invitar", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const invitedIds: string[] = Array.isArray(req.body?.user_ids) ? req.body.user_ids.filter((x: any) => typeof x === "string") : [];
  if (invitedIds.length === 0) { res.status(400).json({ error: "user_ids requerido" }); return; }

  const rows = await query<any>("SELECT * FROM gozz.videollamadas WHERE id = $1", [req.params.id]);
  const v = rows[0];
  if (!v) { res.status(404).json({ error: "No encontrada" }); return; }
  if (v.fin) {
    // Si la sala LiveKit sigue activa, el fin fue seteado por un "leave" (no es fin real) -> reactivar.
    if ((await salaTieneParticipantes(String(req.params.id))) > 0) {
      await query("UPDATE gozz.videollamadas SET fin = NULL, duracion_segundos = NULL WHERE id = $1", [req.params.id]);
      v.fin = null;
    } else {
      res.status(410).json({ error: "Llamada finalizada" }); return;
    }
  }

  // Validar membresía del invitador
  const participantes: string[] = Array.isArray(v.participantes) ? v.participantes : [];
  const esHost = v.iniciada_por === u.sub;
  const esParticipante = participantes.includes(u.sub);
  if (!esHost && !esParticipante) { res.status(403).json({ error: "No estás en esta llamada" }); return; }

  // Info del grupo actual (si hay)
  let grupoActual: any = null;
  if (v.grupo_id) {
    const gr = await query<any>("SELECT * FROM gozz.chat_grupos WHERE id = $1", [v.grupo_id]);
    grupoActual = gr[0];
  }

  // Descartar IDs que ya están (en participantes o en miembros del grupo actual)
  const yaDentro = new Set<string>([
    ...participantes,
    ...(grupoActual && Array.isArray(grupoActual.miembros) ? grupoActual.miembros : [])
  ]);
  const nuevos = invitedIds.filter((id) => !yaDentro.has(id));
  if (nuevos.length === 0) { res.json({ ok: true, invited: 0, grupo_id: v.grupo_id }); return; }

  // Decidir grupo destino:
  // - Si el grupo actual es DM, creamos un nuevo chat grupal con color random.
  // - Si ya es 'grupo|canal|departamento|tarea', solo agregamos los nuevos a miembros.
  let grupoId = v.grupo_id as string | null;
  let chatNuevoCreado = false;

  if (!grupoActual || grupoActual.tipo === "directo") {
    const COLORS = ["purple", "blue", "emerald", "pink", "indigo", "amber", "cyan", "rose"];
    const COLOR_ES: Record<string, string> = {
      purple: "Morado", blue: "Azul", emerald: "Verde", pink: "Rosa",
      indigo: "Índigo", amber: "Ámbar", cyan: "Cian", rose: "Rosado",
    };
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const colorES = COLOR_ES[color] || "Color";
    const todosIds = Array.from(new Set<string>([
      v.iniciada_por,
      ...participantes,
      ...(grupoActual && Array.isArray(grupoActual.miembros) ? grupoActual.miembros : []),
      ...nuevos,
    ].filter(Boolean) as string[]));
    // Nombre: "Chat <ColorES> #<N>" con N = secuencial global entre los chats "Chat"
    const cnt = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.chat_grupos WHERE nombre LIKE 'Chat %#%'",
      []
    );
    const n = (cnt[0]?.n || 0) + 1;
    const nombre = `Chat ${colorES} #${n}`;

    const ins = await query<any>(
      `INSERT INTO gozz.chat_grupos (nombre, tipo, descripcion, color, creado_por, miembros, admins)
       VALUES ($1, 'grupo', 'Creado desde videollamada', $2, $3, $4::jsonb, $5::jsonb) RETURNING *`,
      [nombre, color, u.sub, JSON.stringify(todosIds), JSON.stringify([u.sub])]
    );
    grupoId = ins[0].id;
    chatNuevoCreado = true;

    // Actualizar la videollamada para apuntar al nuevo grupo (conservando sala_id)
    await query("UPDATE gozz.videollamadas SET grupo_id = $1 WHERE id = $2", [grupoId, v.id]);
  } else {
    // Agregar nuevos a miembros del grupo existente
    const miembros: string[] = Array.isArray(grupoActual.miembros) ? grupoActual.miembros : [];
    const merged = Array.from(new Set<string>([...miembros, ...nuevos]));
    await query(
      "UPDATE gozz.chat_grupos SET miembros = $1::jsonb, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(merged), grupoActual.id]
    );
  }

  // Info del caller para el ring
  const myRow = await query<any>("SELECT nombre, email, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]);
  const displayName = myRow[0]?.nombre || myRow[0]?.email || "Anonimo";
  const callerInfo = { id: u.sub, nombre: displayName, foto_perfil_url: myRow[0]?.foto_perfil_url || null };

  // Ring a los nuevos (busy check incluido)
  for (const tid of nuevos) {
    if (tid === u.sub) continue;
    const busyIn = await userIsBusy(tid, v.id);
    if (busyIn) {
      emitToUser(u.sub, "videollamada:declined", { videollamadaId: v.id, by: tid, reason: "busy" });
      await insertCallMissedSystemMessage({
        videollamadaId: v.id, reason: "busy", callerUserId: u.sub, calleeUserId: tid
      });
      continue;
    }
    emitToUser(tid, "videollamada:incoming", {
      videollamadaId: v.id,
      nombreSala: v.nombre_sala,
      tipo: "grupo",
      from: callerInfo,
    });
  }

  res.json({ ok: true, invited: nuevos.length, grupo_id: grupoId, chat_nuevo: chatNuevoCreado });
});

  app.post("/api/videollamadas/resumen-ia", requireAuth, async (req, res) => {
  const { videollamadaId, roomName: roomNameArg, participantes: participantesArg, duracion_segundos: duracionArg, transcript: transcriptArg } = req.body || {};

  // Si vino videollamadaId, cargamos datos canónicos de DB (fuente confiable para persistir).
  let roomName: string = roomNameArg || "";
  let participantesStr: string = typeof participantesArg === "string" ? participantesArg : "";
  let duracion: number = Number(duracionArg || 0);
  let transcript: string = typeof transcriptArg === "string" ? transcriptArg : "";
  let grupoId: string | null = null;
  let participantesList: Array<{ id: string; nombre: string; foto: string | null }> = [];

  if (videollamadaId) {
    const vrows = await query<any>(
      "SELECT id, grupo_id, nombre_sala, duracion_segundos, inicio, fin, participantes, transcripcion_txt FROM gozz.videollamadas WHERE id = $1",
      [videollamadaId]
    );
    const v = vrows[0];
    if (v) {
      roomName = roomName || v.nombre_sala || "sala";
      grupoId = v.grupo_id || null;
      if (!duracion) {
        duracion = Number(v.duracion_segundos || 0) || Math.max(0, Math.floor((Date.now() - new Date(v.inicio).getTime()) / 1000));
      }
      if (!transcript && v.transcripcion_txt) transcript = v.transcripcion_txt;
      const participantesIds: string[] = Array.isArray(v.participantes) ? v.participantes : [];
      if (participantesIds.length > 0) {
        const users = await query<any>(
          "SELECT id, nombre, foto_perfil_url FROM gozz.users WHERE id = ANY($1::uuid[])",
          [participantesIds]
        );
        participantesList = users.map((u: any) => ({ id: u.id, nombre: u.nombre, foto: u.foto_perfil_url || null }));
        if (!participantesStr) participantesStr = users.map((u: any) => u.nombre).join(", ");
      }
    }
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
  const GEMINI_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";

  // Generar resumen estructurado de la videollamada. Motor 1: Claude (Haiku). Fallback: Gemini / Gemma 4.
  let summaryJson: any = null;
  let isAi = false;
  let summaryText = "";
  const resumenPrompt = `Eres un asistente ejecutivo top 2026. Analiza esta videollamada y genera un JSON EXACTO con:
{
  "titulo": "Título breve de 1 línea",
  "resumen": "2-3 oraciones del contenido principal en prosa",
  "puntos_clave": ["bullet 1", "bullet 2", "..."],
  "decisiones": ["decisión 1", "..."],
  "acciones": [{"responsable": "nombre", "tarea": "qué hacer", "fecha": "opcional"}],
  "tono": "positivo|neutral|tenso|productivo",
  "proxima_accion_sugerida": "recomendación"
}

Sala: ${roomName}
Duración: ${Math.floor(duracion / 60)} min ${duracion % 60} s
Participantes: ${participantesStr}

Eventos y chat:
${transcript || "(sin eventos de chat registrados)"}

IMPORTANTE: Responde SOLO el JSON, sin markdown ni texto adicional.`;
  const parseLooseJson = (raw: string): any => {
    let s = (raw || "").trim();
    if (s.startsWith("```")) s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const i = s.indexOf("{"), j = s.lastIndexOf("}");
    if (i !== -1 && j > i) s = s.slice(i, j + 1);
    return JSON.parse(s);
  };
  // 1) Anthropic (Haiku)
  if (ANTHROPIC_KEY && !summaryJson) {
    try {
      const aiR = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: resumenPrompt }] })
      });
      const aiD: any = await aiR.json();
      if (aiD?.error) throw new Error(aiD.error?.message || `anthropic HTTP ${aiR.status}`);
      summaryJson = parseLooseJson(aiD?.content?.[0]?.text || "");
      isAi = true;
    } catch (e: any) {
      console.error("[resumen-ia] Anthropic falló:", e?.message);
    }
  }
  // 2) Fallback: Gemini / Gemma 4 (Google AI). Prueba varios modelos.
  if (GEMINI_KEY && !summaryJson) {
    for (const gModel of ["gemini-flash-latest", "gemini-2.5-flash", "gemma-4-31b-it", "gemini-2.0-flash-lite"]) {
      try {
        const gR = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: resumenPrompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } })
        });
        if (!gR.ok) { const t = await gR.text(); console.error(`[resumen-ia] Gemini ${gModel} HTTP ${gR.status}:`, t.slice(0, 160)); continue; }
        const gD: any = await gR.json();
        const txt: string = ((gD?.candidates?.[0]?.content?.parts) || []).map((p: any) => p?.text || "").join("");
        summaryJson = parseLooseJson(txt);
        isAi = true;
        break;
      } catch (e: any) {
        console.error(`[resumen-ia] Gemini ${gModel} falló:`, e?.message);
      }
    }
  }
  if (summaryJson) {
    summaryText = [
      summaryJson.titulo ? `**${summaryJson.titulo}**` : "",
      summaryJson.resumen || "",
      Array.isArray(summaryJson.puntos_clave) && summaryJson.puntos_clave.length > 0 ? "\n**Puntos clave:**\n" + summaryJson.puntos_clave.map((p: string) => `- ${p}`).join("\n") : "",
      Array.isArray(summaryJson.decisiones) && summaryJson.decisiones.length > 0 ? "\n**Decisiones:**\n" + summaryJson.decisiones.map((d: string) => `- ${d}`).join("\n") : "",
      Array.isArray(summaryJson.acciones) && summaryJson.acciones.length > 0 ? "\n**Acciones:**\n" + summaryJson.acciones.map((a: any) => `- ${a.responsable ? `**${a.responsable}:** ` : ""}${a.tarea || ""}${a.fecha ? ` _(${a.fecha})_` : ""}`).join("\n") : "",
      summaryJson.proxima_accion_sugerida ? `\n**Próximo paso sugerido:** ${summaryJson.proxima_accion_sugerida}` : "",
    ].filter(Boolean).join("\n").trim();
  }
  if (!summaryText) {
    summaryText = `**Resumen de la llamada "${roomName}"**\n\n` +
      `Duración: ${Math.floor(duracion / 60)} min ${duracion % 60} s\n` +
      `Participantes: ${participantesStr || "—"}\n\n` +
      (transcript ? `**Transcripción de chat:**\n${transcript}\n` : "_Sin eventos de chat._\n") +
      ((!ANTHROPIC_KEY && !GEMINI_KEY) ? `\n⚠️ No hay clave de IA configurada en el servidor (ANTHROPIC_API_KEY o GOOGLE_AI_API_KEY).` : "");
  }

  // Persistir en DB y postear al chat del grupo (si tenemos videollamadaId + grupo_id).
  if (videollamadaId && grupoId) {
    try {
      // Idempotencia: sólo un resumen por videollamada.
      const existing = await query<any>(
        `SELECT id, contenido FROM gozz.chat_mensajes
          WHERE grupo_id = $1 AND tipo = 'sistema'
            AND contenido LIKE $2 LIMIT 1`,
        [grupoId, `%"videollamadaId":"${videollamadaId}"%"_t":"call_summary"%`]
      );
      const payload: any = {
        _t: "call_summary",
        videollamadaId,
        roomName,
        duracion_segundos: duracion,
        participantes: participantesList,
        transcript: (transcript || "").slice(0, 5000),
        summary: summaryJson,
        ai: isAi,
        ended_at: new Date().toISOString(),
      };
      if (!existing[0]) {
        const ins = await query<any>(
          `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido)
           VALUES ($1, NULL, 'sistema', $2) RETURNING *`,
          [grupoId, JSON.stringify(payload)]
        );
        await query(
          "UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2",
          ["📹 Resumen de videollamada", grupoId]
        );
        emitToGrupo(grupoId, "chat:message", { ...ins[0], user_nombre: "Sistema", foto_perfil_url: null });
      } else {
        await query(
          `UPDATE gozz.chat_mensajes SET contenido = $1 WHERE id = $2`,
          [JSON.stringify(payload), existing[0].id]
        );
      }
      await query(
        "UPDATE gozz.videollamadas SET resumen_ia = $1::jsonb, transcripcion_txt = COALESCE(transcripcion_txt, $2) WHERE id = $3",
        [summaryJson ? JSON.stringify(summaryJson) : null, transcript || null, videollamadaId]
      );
    } catch (e: any) {
      console.error("[resumen-ia] persist error", e?.message);
    }
  }

  res.json({
    resumen: summaryText,
    summary: summaryJson,
    transcript,
    ai: isAi,
    persisted: !!(videollamadaId && grupoId),
  });
});

  app.post("/api/videollamadas/:id/fin", requireAuth, async (req, res) => {
  const u = (req as any).user;
  // No finalizar la llamada si quedan OTROS participantes en la sala LiveKit
  // (en grupal, que uno se vaya NO debe terminar la llamada para todos).
  try {
    const ps = await lkListParticipants(String(req.params.id));
    const otros = (Array.isArray(ps) ? ps : []).filter((p: any) => p?.identity !== u.sub);
    if (otros.length > 0) { res.json({ ok: true, stillActive: true, remaining: otros.length }); return; }
  } catch {}
  // Sala vacia -> cierre inmediato (marca fin + transcript plano si vino).
  const transcript: string | null = typeof req.body?.transcript === "string" && req.body.transcript.length > 0
    ? req.body.transcript : null;
  const rows = await query<any>(
    `UPDATE gozz.videollamadas
     SET fin = COALESCE(fin, NOW()),
         duracion_segundos = COALESCE(duracion_segundos, EXTRACT(EPOCH FROM (NOW() - inicio))::int),
         transcripcion_txt = COALESCE(transcripcion_txt, $2)
     WHERE id = $1 RETURNING *`,
    [req.params.id, transcript]
  );
  res.json({ videollamada: rows[0] || null });
});

// Token de LiveKit para una sala de llamada (las llamadas usan LiveKit como SFU).
  app.post("/api/livekit/token", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const roomName = String(req.body?.room || req.body?.roomName || "").trim();
  if (!roomName) { res.status(400).json({ error: "room requerido" }); return; }
  // Validar membresia: la room ES el id (UUID) de la videollamada. Antes este endpoint
  // minteaba un token para CUALQUIER room pedida (200 silencioso) -> hueco de seguridad.
  let vrows: any[] = [];
  try {
    vrows = await query<any>("SELECT participantes, grupo_id, iniciada_por FROM gozz.videollamadas WHERE id = $1::uuid", [roomName]);
  } catch {
    console.warn(`[livekit/token] 404 room invalida room=${roomName} user=${u.sub}`);
    res.status(404).json({ error: "Sala no encontrada" }); return;
  }
  if (!vrows[0]) {
    console.warn(`[livekit/token] 404 room inexistente room=${roomName} user=${u.sub}`);
    res.status(404).json({ error: "Sala no encontrada" }); return;
  }
  const v = vrows[0];
  const participantes: string[] = Array.isArray(v.participantes) ? v.participantes : [];
  let autorizado = v.iniciada_por === u.sub || participantes.includes(u.sub);
  if (!autorizado && v.grupo_id) {
    const g = await query<any>("SELECT miembros FROM gozz.chat_grupos WHERE id = $1", [v.grupo_id]);
    const miembros: string[] = Array.isArray(g[0]?.miembros) ? g[0].miembros : [];
    autorizado = miembros.includes(u.sub);
  }
  if (!autorizado) {
    console.warn(`[livekit/token] 403 no autorizado room=${roomName} user=${u.sub}`);
    res.status(403).json({ error: "No autorizado en esta sala" }); return;
  }
  const ur = await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]);
  const token = await lkMintToken({ roomName, identity: u.sub, name: ur[0]?.nombre || u.email || "Usuario" });
  console.log(`[livekit/token] OK room=${roomName} user=${u.sub}`);
  res.json({ token, url: lkUrl });
});
}
