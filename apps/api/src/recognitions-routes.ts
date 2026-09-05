import type { Express, Request, Response } from "express";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { sendPushToUsers } from "./push.js";
import { emitToGrupo } from "./shared/socket.js";

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

// Etiqueta de cada medalla (compartida por chat, notificaciones y push)
const MEDAL_LABELS: Record<string, string> = {
  puntualidad: "🏅 Medalla a la Puntualidad",
  vendedor_semana: "🥇 Vendedor de la Semana",
  preparador_semana: "👏 Preparador de la Semana",
};

// Notifica a TODO el equipo (in-app + push) felicitando al ganador/ganadora.
async function notificarEquipoMedalla(tipo: string, ganadorId: string, nombre: string, metadata: any) {
  const label = MEDAL_LABELS[tipo] || "🏆 Reconocimiento de la semana";
  const extras = metadata ? Object.entries(metadata).map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
  const usuarios = await query<any>("SELECT id FROM gozz.users WHERE activo = true");
  await Promise.all(usuarios.map((row: any) => {
    const esGanador = row.id === ganadorId;
    const titulo = esGanador ? "🎉 ¡Felicidades, ganaste esta semana!" : `🏆 ¡Felicita a ${nombre}!`;
    const mensaje = esGanador
      ? `${label}${extras ? ` · ${extras}` : ""}`
      : `${nombre} ganó: ${label}${extras ? ` · ${extras}` : ""}`;
    return query(
      `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
       VALUES ($1, 'reconocimiento', $2, $3, $4, '/dashboard', $5::jsonb)`,
      [row.id, titulo, mensaje, esGanador ? "alta" : "normal", JSON.stringify({ tipo, ganador_id: ganadorId, nombre })]
    ).catch(() => {});
  }));
  // Push del navegador a todos
  await sendPushToUsers(usuarios.map((u: any) => u.id), {
    title: `🏆 ¡Felicita a ${nombre}!`,
    body: `${label}${extras ? ` · ${extras}` : ""}`,
    url: "/dashboard",
    tag: `recognition-${tipo}`,
    kind: "general",
  }).catch(() => {});
}

// Lunes de la semana dada (zona America/New_York)
function etMondayOfWeek(dt = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(dt);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const w = map[wd] ?? 1;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - (w === 0 ? 6 : w - 1));
  return date.toISOString().slice(0, 10);
}

async function ensureGeneralGroup(): Promise<string | null> {
  const existing = await query<any>("SELECT id FROM gozz.chat_grupos WHERE LOWER(nombre) = 'general' AND tipo != 'directo' LIMIT 1");
  if (existing[0]) return existing[0].id;
  const u = (await query<any>("SELECT id FROM gozz.users WHERE nivel_acceso = 'super_admin' LIMIT 1"))[0];
  if (!u) return null;
  const all = await query<any>("SELECT id FROM gozz.users WHERE activo = true");
  const members = all.map((x: any) => x.id);
  const created = await query<any>(
    `INSERT INTO gozz.chat_grupos (nombre, tipo, descripcion, creado_por, miembros, admins)
     VALUES ('General', 'grupo', 'Canal general del GOZZ CRM', $1, $2::jsonb, $3::jsonb) RETURNING id`,
    [u.id, JSON.stringify(members), JSON.stringify([u.id])]
  );
  return created[0].id;
}

// Busca un grupo (no DM) cuyo nombre haga match con el patrón ILIKE
async function findGroupByLike(pattern: string): Promise<string | null> {
  const rows = await query<any>(
    "SELECT id FROM gozz.chat_grupos WHERE nombre ILIKE $1 AND tipo != 'directo' ORDER BY created_at LIMIT 1",
    [pattern]
  );
  return rows[0]?.id || null;
}

// El grupo de chat al que va la felicitación según el tipo de medalla.
// Puntualidad → canal de Clock-in/out (fallback General). Resto → General.
async function grupoDestino(tipo: string): Promise<string | null> {
  if (tipo === "puntualidad") {
    return (await findGroupByLike("%clock%")) || (await findGroupByLike("%break%")) || (await ensureGeneralGroup());
  }
  return ensureGeneralGroup();
}

// Postea la TARJETA animada de felicitación (mensaje 'sistema' con payload JSON
// _t:"recognition") en el grupo y la emite por socket para render en vivo.
async function postRecognitionCard(grupoId: string, tipo: string, ganadorId: string, nombre: string, foto: string | null, metadata: any) {
  const titulo = MEDAL_LABELS[tipo] || "🏆 Reconocimiento de la semana";
  const payload = { _t: "recognition", tipo, ganador_id: ganadorId, nombre, foto: foto || null, metadata: metadata || null, titulo };
  const ins = await query<any>(
    `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido) VALUES ($1, NULL, 'sistema', $2) RETURNING *`,
    [grupoId, JSON.stringify(payload)]
  );
  const preview = `🎉 ¡Felicidades ${nombre}! · ${titulo}`;
  await query("UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2", [preview.slice(0, 100), grupoId]);
  try { emitToGrupo(grupoId, "chat:message", { ...ins[0], user_nombre: "Sistema", foto_perfil_url: null }); } catch {}
  return ins[0];
}

export async function computeWeeklyRecognitions(weekStart?: string): Promise<{ created: number; week: string; results: any[] }> {
  const target = weekStart || etMondayOfWeek(new Date(Date.now() - 7 * 86400000));
  const weekEnd = new Date(new Date(target + "T00:00:00Z").getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const results: any[] = [];

  // Puntualidad: user con MENOS minutos_tarde acumulados en la semana (mínimo 3 días check-in y no estricto=false)
  const puntuales = await query<any>(
    `SELECT c.user_id, COALESCE(SUM(c.minutos_tarde),0)::int AS tardes_total, COUNT(*)::int AS dias
     FROM gozz.clock_entries c
     JOIN gozz.user_schedule s ON s.user_id = c.user_id
     WHERE c.fecha_local >= $1::date AND c.fecha_local < $2::date AND s.estricto = true
     GROUP BY c.user_id HAVING COUNT(*) >= 3
     ORDER BY tardes_total ASC, dias DESC LIMIT 1`,
    [target, weekEnd]
  );
  if (puntuales[0]) results.push({ tipo: "puntualidad", user_id: puntuales[0].user_id, metadata: { dias: puntuales[0].dias, minutos_tarde: puntuales[0].tardes_total } });

  // Vendedor de la semana: mayor suma de valor_total en oportunidades ganadas (aprobado/completado) esta semana
  const vendedor = await query<any>(
    `SELECT o.vendedor_id AS user_id, SUM(o.valor_total)::float AS ventas
     FROM gozz.oportunidades o
     WHERE o.vendedor_id IS NOT NULL AND o.etapa IN ('aprobado','completado')
       AND o.updated_at >= $1::date AND o.updated_at < $2::date
     GROUP BY o.vendedor_id ORDER BY ventas DESC LIMIT 1`,
    [target, weekEnd]
  );
  if (vendedor[0]) results.push({ tipo: "vendedor_semana", user_id: vendedor[0].user_id, metadata: { ventas: Number(vendedor[0].ventas).toFixed(0) } });

  // Preparador de la semana: mayor cantidad de oportunidades movidas a aprobado
  const preparador = await query<any>(
    `SELECT o.preparador_id AS user_id, COUNT(*)::int AS casos
     FROM gozz.oportunidades o
     WHERE o.preparador_id IS NOT NULL AND o.etapa = 'aprobado'
       AND o.updated_at >= $1::date AND o.updated_at < $2::date
     GROUP BY o.preparador_id ORDER BY casos DESC LIMIT 1`,
    [target, weekEnd]
  );
  if (preparador[0]) results.push({ tipo: "preparador_semana", user_id: preparador[0].user_id, metadata: { casos: preparador[0].casos } });

  let created = 0;
  for (const r of results) {
    try {
      const inserted = await query<any>(
        `INSERT INTO gozz.recognitions (tipo, user_id, semana_inicio, metadata)
         VALUES ($1,$2,$3::date,$4::jsonb)
         ON CONFLICT (tipo, user_id, semana_inicio) DO NOTHING
         RETURNING id`,
        [r.tipo, r.user_id, target, JSON.stringify(r.metadata)]
      );
      if (inserted[0]) {
        created++;
        const u = (await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [r.user_id]))[0] || {};
        const uname = u.nombre || "?";
        // Tarjeta animada de felicitación en el grupo de chat correspondiente
        const grupoId = await grupoDestino(r.tipo);
        if (grupoId) {
          await postRecognitionCard(grupoId, r.tipo, r.user_id, uname, u.foto_perfil_url || null, r.metadata);
          await query("UPDATE gozz.recognitions SET posted_chat_grupo_id = $1 WHERE id = $2", [grupoId, inserted[0].id]);
        }
        // Notificar a todo el equipo (in-app + push) felicitando al ganador/ganadora
        await notificarEquipoMedalla(r.tipo, r.user_id, uname, r.metadata).catch((e: any) => console.error("[recognitions-notif]", e?.message));
      }
    } catch (e: any) {
      console.error("[recognitions]", e?.message);
    }
  }
  console.log(`[recognitions] week ${target}: ${created} nuevas medallas`);
  return { created, week: target, results };
}

let _lastRun: string | null = null;
export function startRecognitionsCron() {
  const CHECK_MS = 5 * 60 * 1000;
  const tick = async () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const hh = Number(parts.find((p) => p.type === "hour")?.value || 0);
    if (wd === "Mon" && hh === 9) {
      const wk = etMondayOfWeek(now);
      if (_lastRun !== wk) {
        _lastRun = wk;
        try { await computeWeeklyRecognitions(); } catch (e: any) { console.error("[recognitions-cron]", e?.message); }
      }
    }
  };
  setInterval(tick, CHECK_MS);
  // Primer check a los 2 minutos para dar tiempo al arranque
  setTimeout(tick, 120_000);
  console.log("[recognitions] cron started (checks every 5m for Mon 09:00 ET)");
}

export function registerRecognitionsRoutes(app: Express) {
  app.post("/api/recognitions/run", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const week = req.body?.week as string | undefined;
    const out = await computeWeeklyRecognitions(week);
    res.json(out);
  });

  app.get("/api/recognitions/semana", requireAuth, async (req: Request, res: Response) => {
    const wk = (req.query.week as string) || etMondayOfWeek(new Date(Date.now() - 7 * 86400000));
    const rows = await query<any>(
      `SELECT r.tipo, r.semana_inicio, r.metadata, u.id AS user_id, u.nombre, u.foto_perfil_url
       FROM gozz.recognitions r
       JOIN gozz.users u ON u.id = r.user_id
       WHERE r.semana_inicio = $1::date ORDER BY r.tipo`,
      [wk]
    );
    res.json({ week: wk, recognitions: rows });
  });
}
