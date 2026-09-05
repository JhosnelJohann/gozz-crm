import type { Express, Request, Response } from "express";
import { z } from "zod";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { emitToUser, emitToGrupo } from "./shared/socket.js";

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

// Textos canónicos (mismo formato que usa el equipo a mano en el grupo)
const CLOCK_TEXT = { in: "👋Clock-in", break: "🛑Break", back: "✅ De regreso", out: "🔚Clock out" } as const;

// Resuelve (y cachea) el id del grupo "Clock-in & Clock-out Breaks"
let _clockGroupId: string | null = null;
async function resolveClockGroupId(): Promise<string | null> {
  if (_clockGroupId) return _clockGroupId;
  const g = (await query<any>(
    "SELECT id FROM gozz.chat_grupos WHERE (nombre ILIKE '%clock%' OR nombre ILIKE '%break%') AND tipo != 'directo' ORDER BY created_at LIMIT 1"
  ))[0];
  _clockGroupId = g?.id || null;
  return _clockGroupId;
}

// Postea automáticamente un mensaje al grupo de clock como el propio usuario y lo
// emite por socket para que aparezca en vivo. Fire-and-forget: nunca rompe el clock.
async function postClockMessage(userId: string, texto: string) {
  try {
    const gid = await resolveClockGroupId();
    if (!gid) return;
    const ins = await query<any>(
      `INSERT INTO gozz.chat_mensajes (grupo_id, user_id, tipo, contenido) VALUES ($1,$2,'texto',$3) RETURNING *`,
      [gid, userId, texto]
    );
    await query("UPDATE gozz.chat_grupos SET ultimo_mensaje = $1, ultimo_mensaje_at = NOW() WHERE id = $2", [texto.slice(0, 100), gid]);
    const u = (await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [userId]))[0] || {};
    emitToGrupo(gid, "chat:message", { ...ins[0], user_nombre: u.nombre || null, foto_perfil_url: u.foto_perfil_url || null });
  } catch (e: any) {
    console.error("[clock-chat]", e?.message);
  }
}

// ── Lógica núcleo de jornada (reutilizable por endpoints HTTP y por el sync desde el grupo) ──
// Cada función es idempotente: si el estado ya no aplica, devuelve {ok:false} sin romper nada.
export async function doClockIn(userId: string, at: Date): Promise<{ ok: boolean; entry?: any; tarde?: boolean; minutos?: number; reason?: string }> {
  const sched = await getSchedule(userId);
  const open = (await query<any>("SELECT id FROM gozz.clock_entries WHERE user_id = $1 AND salida_at IS NULL", [userId]))[0];
  if (open) return { ok: false, reason: "ya_abierta" };
  const { tarde, minutos } = calcTarde(sched, at);
  const fechaLocal = toLocalDate(at, sched.zona_horaria || "America/New_York");
  const rows = await query<any>(
    `INSERT INTO gozz.clock_entries (user_id, entrada_at, fue_tarde, minutos_tarde, fecha_local)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, at.toISOString(), tarde, minutos, fechaLocal]
  );
  return { ok: true, entry: rows[0], tarde, minutos };
}

export async function doClockOut(userId: string, at: Date): Promise<{ ok: boolean; entry?: any; reason?: string }> {
  const open = (await query<any>("SELECT * FROM gozz.clock_entries WHERE user_id = $1 AND salida_at IS NULL ORDER BY entrada_at DESC LIMIT 1", [userId]))[0];
  if (!open) return { ok: false, reason: "sin_jornada" };
  await query(
    `UPDATE gozz.clock_breaks
       SET fin_at = $2::timestamptz, minutos = GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - inicio_at))::int / 60)
     WHERE clock_entry_id = $1 AND fin_at IS NULL`,
    [open.id, at.toISOString()]
  );
  const totalBreak = (await query<any>("SELECT COALESCE(SUM(minutos),0)::int AS total FROM gozz.clock_breaks WHERE clock_entry_id = $1", [open.id]))[0].total;
  const rows = await query<any>(
    `UPDATE gozz.clock_entries
       SET salida_at = $2::timestamptz,
           minutos_totales = GREATEST(0, (EXTRACT(EPOCH FROM ($2::timestamptz - entrada_at))::int / 60) - $3),
           minutos_break = $3
     WHERE id = $1 RETURNING *`,
    [open.id, at.toISOString(), totalBreak]
  );
  return { ok: true, entry: rows[0] };
}

export async function doBreakStart(userId: string, at: Date): Promise<{ ok: boolean; brk?: any; reason?: string }> {
  const open = (await query<any>("SELECT id FROM gozz.clock_entries WHERE user_id = $1 AND salida_at IS NULL ORDER BY entrada_at DESC LIMIT 1", [userId]))[0];
  if (!open) return { ok: false, reason: "sin_jornada" };
  const already = (await query<any>("SELECT id FROM gozz.clock_breaks WHERE clock_entry_id = $1 AND fin_at IS NULL", [open.id]))[0];
  if (already) return { ok: false, reason: "break_en_curso" };
  const rows = await query<any>("INSERT INTO gozz.clock_breaks (clock_entry_id, inicio_at) VALUES ($1, $2::timestamptz) RETURNING *", [open.id, at.toISOString()]);
  return { ok: true, brk: rows[0] };
}

export async function doBreakEnd(userId: string, at: Date): Promise<{ ok: boolean; brk?: any; reason?: string }> {
  const open = (await query<any>("SELECT id FROM gozz.clock_entries WHERE user_id = $1 AND salida_at IS NULL ORDER BY entrada_at DESC LIMIT 1", [userId]))[0];
  if (!open) return { ok: false, reason: "sin_jornada" };
  const rows = await query<any>(
    `UPDATE gozz.clock_breaks
       SET fin_at = $2::timestamptz, minutos = GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - inicio_at))::int / 60)
     WHERE clock_entry_id = $1 AND fin_at IS NULL RETURNING *`,
    [open.id, at.toISOString()]
  );
  return rows[0] ? { ok: true, brk: rows[0] } : { ok: false, reason: "sin_break" };
}

// Clasifica el texto de un mensaje del grupo en una acción de jornada (o null si no aplica).
// Conservador: solo si el mensaje ES la frase (evita falsos positivos como "briset marca break").
export function classifyClockText(texto: string): "in" | "break" | "back" | "out" | null {
  if (!texto) return null;
  const n = texto.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  if (/^clock[\s-]?in\b/.test(n) && n.length <= 12) return "in";
  if (/^break\b/.test(n) && n.length <= 8) return "break";
  if (/^de\s?regreso\b/.test(n)) return "back";
  if (/^clock\s?out\b/.test(n) && n.length <= 14) return "out";
  return null;
}

// Engancha un mensaje del grupo de clock al estado de jornada del usuario (sin re-postear).
// Devuelve la acción aplicada o null. Usado por el endpoint de envío de chat (index.ts).
export async function syncClockFromMessage(userId: string, grupoId: string, texto: string, at: Date): Promise<string | null> {
  try {
    const gid = await resolveClockGroupId();
    if (!gid || gid !== grupoId) return null;
    const action = classifyClockText(texto);
    if (!action) return null;
    let r: { ok: boolean };
    if (action === "in") r = await doClockIn(userId, at);
    else if (action === "break") r = await doBreakStart(userId, at);
    else if (action === "back") r = await doBreakEnd(userId, at);
    else r = await doClockOut(userId, at);
    return r.ok ? action : null;
  } catch (e: any) {
    console.error("[clock-sync]", e?.message);
    return null;
  }
}

async function getSchedule(userId: string): Promise<any> {
  const r = await query<any>("SELECT * FROM gozz.user_schedule WHERE user_id = $1", [userId]);
  if (r[0]) return r[0];
  // Seed si no existe
  const created = await query<any>(
    `INSERT INTO gozz.user_schedule (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW() RETURNING *`,
    [userId]
  );
  return created[0];
}

function toLocalDate(dt: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(dt);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    return `${y}-${m}-${d}`;
  } catch { return dt.toISOString().slice(0, 10); }
}

function localHoursMinutes(dt: Date, tz: string): { h: number; m: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(dt);
  const hh = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value || "0");
  const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { h: hh, m: mm, weekday: map[wd] ?? 1 };
}

function calcTarde(sched: any, dt: Date): { tarde: boolean; minutos: number } {
  if (!sched?.estricto) return { tarde: false, minutos: 0 };
  const [sh, sm] = String(sched.hora_entrada || "09:00").split(":").map(Number);
  const local = localHoursMinutes(dt, sched.zona_horaria || "America/New_York");
  const minutosEntradaProgramada = sh * 60 + sm + Number(sched.tolerancia_minutos || 10);
  const minutosReales = local.h * 60 + local.m;
  const diff = minutosReales - minutosEntradaProgramada;
  return diff > 0 ? { tarde: true, minutos: diff } : { tarde: false, minutos: 0 };
}

let _breakMonitorStarted = false;
export function startBreakMonitor() {
  if (_breakMonitorStarted) return;
  _breakMonitorStarted = true;
  setInterval(async () => {
    try {
      const abiertos = await query<any>(
        `SELECT b.id, b.clock_entry_id, b.inicio_at, b.alertado, c.user_id,
                (EXTRACT(EPOCH FROM (NOW() - b.inicio_at)) / 60)::int AS minutos_actuales,
                s.break_minutos_max
         FROM gozz.clock_breaks b
         JOIN gozz.clock_entries c ON c.id = b.clock_entry_id
         LEFT JOIN gozz.user_schedule s ON s.user_id = c.user_id
         WHERE b.fin_at IS NULL`
      );
      for (const b of abiertos) {
        const maxm = b.break_minutos_max || 60;
        if (b.minutos_actuales > maxm && !b.alertado) {
          await query("UPDATE gozz.clock_breaks SET alertado = true, excedido = true WHERE id = $1", [b.id]);
          emitToUser(b.user_id, "clock:break-excedido", { break_id: b.id, minutos: b.minutos_actuales, max: maxm });
        }
      }
    } catch (e: any) {
      console.error("[break-monitor]", e?.message);
    }
  }, 60_000);
  console.log("[clock] break monitor started");
}

export function registerClockRoutes(app: Express) {
  app.get("/api/clock/status", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const openEntry = (await query<any>("SELECT * FROM gozz.clock_entries WHERE user_id = $1 AND salida_at IS NULL ORDER BY entrada_at DESC LIMIT 1", [u.sub]))[0];
    const openBreak = openEntry ? (await query<any>("SELECT * FROM gozz.clock_breaks WHERE clock_entry_id = $1 AND fin_at IS NULL LIMIT 1", [openEntry.id]))[0] : null;
    const sched = await getSchedule(u.sub);
    res.json({ schedule: sched, entry: openEntry || null, break_activo: openBreak || null });
  });

  app.post("/api/clock/in", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await doClockIn(u.sub, new Date());
    if (!r.ok) { res.status(409).json({ error: "Ya tienes una jornada abierta" }); return; }
    const { tarde, minutos } = { tarde: r.tarde, minutos: r.minutos };
    // Tareas próximas a vencer (3 días) o vencidas del usuario
    const tareasProximas = await query<any>(
      `SELECT t.id, t.titulo, t.numero_tarea, t.prioridad, t.estado, t.fecha_limite,
              o.nombre_caso AS oportunidad_nombre,
              (t.fecha_limite < NOW()) AS vencida
         FROM gozz.tareas t
         LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
        WHERE (t.responsable_id = $1 OR t.observadores @> to_jsonb($1::text))
          AND t.estado NOT IN ('completada','cancelada')
          AND t.fecha_limite IS NOT NULL
          AND t.fecha_limite <= NOW() + INTERVAL '3 days'
        ORDER BY t.fecha_limite ASC
        LIMIT 20`,
      [u.sub]
    );
    void postClockMessage(u.sub, CLOCK_TEXT.in);
    res.json({ entry: r.entry, tarde, minutos_tarde: minutos, tareas_proximas: tareasProximas });
  });

  app.post("/api/clock/out", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await doClockOut(u.sub, new Date());
    if (!r.ok) { res.status(400).json({ error: "No hay jornada abierta" }); return; }
    void postClockMessage(u.sub, CLOCK_TEXT.out);
    res.json({ entry: r.entry });
  });

  app.post("/api/clock/break/start", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await doBreakStart(u.sub, new Date());
    if (!r.ok) {
      res.status(r.reason === "break_en_curso" ? 409 : 400).json({ error: r.reason === "break_en_curso" ? "Break ya en curso" : "No hay jornada abierta" });
      return;
    }
    void postClockMessage(u.sub, CLOCK_TEXT.break);
    res.json({ break: r.brk });
  });

  app.post("/api/clock/break/end", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await doBreakEnd(u.sub, new Date());
    if (r.ok) void postClockMessage(u.sub, CLOCK_TEXT.back);
    res.json({ break: r.brk || null });
  });

  app.get("/api/clock/mi-semana", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const sched = await getSchedule(u.sub);
    const tz = sched.zona_horaria || "America/New_York";
    const hoy = toLocalDate(new Date(), tz);
    const entries = await query<any>(
      `SELECT e.*, COALESCE(SUM(b.minutos),0)::int AS total_break_min
       FROM gozz.clock_entries e
       LEFT JOIN gozz.clock_breaks b ON b.clock_entry_id = e.id
       WHERE e.user_id = $1 AND e.fecha_local >= $2::date - INTERVAL '6 days'
       GROUP BY e.id
       ORDER BY e.entrada_at DESC`,
      [u.sub, hoy]
    );
    // Racha puntualidad
    const recentPunct = await query<any>(
      `SELECT fecha_local, fue_tarde FROM gozz.clock_entries WHERE user_id = $1 ORDER BY fecha_local DESC LIMIT 30`,
      [u.sub]
    );
    let racha = 0;
    for (const r of recentPunct) {
      if (r.fue_tarde === false) racha++;
      else break;
    }
    const logros = await query<any>(
      "SELECT tipo, semana_inicio, metadata FROM gozz.recognitions WHERE user_id = $1 ORDER BY semana_inicio DESC LIMIT 20",
      [u.sub]
    );
    res.json({ entries, schedule: sched, racha, logros });
  });

  app.get("/api/clock/equipo", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const since = (req.query.desde as string) || null;
    const rows = await query<any>(
      `SELECT u.id AS user_id, u.nombre, u.foto_perfil_url, u.posiciones,
              s.hora_entrada, s.estricto, s.break_minutos_max, s.tolerancia_minutos,
              (SELECT row_to_json(x) FROM (
                SELECT e.id, e.entrada_at, e.salida_at, e.fue_tarde, e.minutos_tarde
                FROM gozz.clock_entries e
                WHERE e.user_id = u.id AND e.salida_at IS NULL
                ORDER BY e.entrada_at DESC LIMIT 1) x) AS entry_activa,
              (SELECT row_to_json(y) FROM (
                SELECT b.id, b.inicio_at, b.excedido
                FROM gozz.clock_breaks b
                JOIN gozz.clock_entries e ON e.id = b.clock_entry_id
                WHERE e.user_id = u.id AND b.fin_at IS NULL LIMIT 1) y) AS break_activo,
              (SELECT COUNT(*)::int FROM gozz.clock_entries e2 WHERE e2.user_id = u.id AND e2.fecha_local >= CURRENT_DATE - INTERVAL '6 days' AND e2.fue_tarde = true) AS tardes_semana,
              (SELECT COUNT(*)::int FROM gozz.clock_entries e3 WHERE e3.user_id = u.id AND e3.fecha_local >= CURRENT_DATE - INTERVAL '6 days') AS dias_semana,
              (SELECT COALESCE(SUM(e4.minutos_totales),0)::int FROM gozz.clock_entries e4 WHERE e4.user_id = u.id AND e4.fecha_local >= CURRENT_DATE - INTERVAL '6 days') AS minutos_semana
       FROM gozz.users u
       LEFT JOIN gozz.user_schedule s ON s.user_id = u.id
       WHERE u.activo = true
       ORDER BY u.nombre`
    );
    res.json({ equipo: rows });
  });

  app.get("/api/schedule/:user_id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (req.params.user_id !== u.sub && !isAdmin(u)) { res.status(403).json({ error: "Sin permiso" }); return; }
    res.json({ schedule: await getSchedule(String(req.params.user_id)) });
  });

  const SchedSchema = z.object({
    hora_entrada: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    zona_horaria: z.string().optional(),
    tolerancia_minutos: z.number().int().min(0).max(240).optional(),
    estricto: z.boolean().optional(),
    break_minutos_max: z.number().int().min(5).max(480).optional(),
    dias_laborales: z.array(z.number().int().min(0).max(6)).optional(),
  });

  app.patch("/api/schedule/:user_id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u) && req.params.user_id !== u.sub) { res.status(403).json({ error: "Sin permiso" }); return; }
    const p = SchedSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data as any;
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const set = fields.map((k, i) => `${k} = $${i + 2}${k === "dias_laborales" ? "::jsonb" : ""}`).join(", ");
    const values = fields.map((k) => (k === "dias_laborales" ? JSON.stringify(d[k]) : d[k]));
    // asegurar que exista
    await getSchedule(String(req.params.user_id));
    const rows = await query<any>(
      `UPDATE gozz.user_schedule SET ${set}, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
      [req.params.user_id, ...values]
    );
    res.json({ schedule: rows[0] });
  });

  app.get("/api/recognitions/actuales", requireAuth, async (_req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT r.*, u.nombre, u.foto_perfil_url FROM gozz.recognitions r
       JOIN gozz.users u ON u.id = r.user_id
       WHERE r.semana_inicio >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY r.semana_inicio DESC, r.tipo`
    );
    res.json({ recognitions: rows });
  });
}
