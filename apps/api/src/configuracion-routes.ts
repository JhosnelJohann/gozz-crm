import type { Express, Request, Response } from "express";
import { z } from "zod";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

export function registerConfiguracionRoutes(app: Express) {
  // ==================== DEPARTAMENTOS CRUD ====================
  app.get("/api/departamentos", requireAuth, async (_req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT d.id, d.nombre, d.color, d.jefe_id, d.created_at,
              u.nombre AS jefe_nombre, u.foto_perfil_url AS jefe_foto,
              (SELECT COUNT(*)::int FROM gozz.usuarios_perfil up WHERE up.departamento_id = d.id) AS empleados_count
         FROM gozz.departamentos d
         LEFT JOIN gozz.users u ON u.id = d.jefe_id
         ORDER BY d.nombre`
    );
    res.json({ departamentos: rows });
  });

  const DeptoSchema = z.object({
    nombre: z.string().min(2),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    jefe_id: z.string().uuid().nullable().optional()
  });

  app.post("/api/departamentos", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const parsed = DeptoSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data;
    try {
      const rows = await query<any>(
        `INSERT INTO gozz.departamentos (nombre, color, jefe_id)
         VALUES ($1, COALESCE($2, '#FF8609'), $3) RETURNING *`,
        [d.nombre, d.color, d.jefe_id ?? null]
      );
      res.json({ departamento: rows[0] });
    } catch (e: any) {
      if (e?.code === "23505") { res.status(409).json({ error: "Ya existe un departamento con ese nombre" }); return; }
      throw e;
    }
  });

  app.patch("/api/departamentos/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const parsed = DeptoSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data as any;
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const set = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => d[k]);
    try {
      const rows = await query<any>(
        `UPDATE gozz.departamentos SET ${set} WHERE id = $1 RETURNING *`,
        [req.params.id, ...values]
      );
      res.json({ departamento: rows[0] });
    } catch (e: any) {
      if (e?.code === "23505") { res.status(409).json({ error: "Ya existe un departamento con ese nombre" }); return; }
      throw e;
    }
  });

  app.delete("/api/departamentos/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    // Verificar que no tenga empleados asignados
    const r = await query<any>(
      "SELECT COUNT(*)::int AS n FROM gozz.usuarios_perfil WHERE departamento_id = $1",
      [req.params.id]
    );
    if (Number(r[0]?.n || 0) > 0) {
      res.status(400).json({ error: `No se puede eliminar: tiene ${r[0].n} empleado(s) asignado(s). Reasígnalos primero.` });
      return;
    }
    await query("DELETE FROM gozz.departamentos WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  });

  // ==================== SEGURIDAD: sesiones + auditoría ====================
  app.get("/api/seguridad/sesiones", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "all" ? "all" : "mine";
    if (scope === "all" && !isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const params = scope === "all" ? [] : [u.sub];
    const where = scope === "all" ? "" : "WHERE s.user_id = $1";
    const rows = await query<any>(
      `SELECT s.id, s.user_id, s.dispositivo, s.ip, s.user_agent, s.ultimo_ping, s.activa, s.expira_at, s.created_at,
              u.nombre, u.email, u.foto_perfil_url
         FROM gozz.sesiones_activas s
         LEFT JOIN gozz.users u ON u.id = s.user_id
         ${where}
         ORDER BY s.ultimo_ping DESC NULLS LAST, s.created_at DESC
         LIMIT 50`,
      params
    );
    res.json({ sesiones: rows });
  });

  app.delete("/api/seguridad/sesiones/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    // Cualquiera puede cerrar sus propias sesiones, admin puede cerrar cualquiera
    const s = (await query<any>("SELECT user_id FROM gozz.sesiones_activas WHERE id = $1", [req.params.id]))[0];
    if (!s) { res.status(404).json({ error: "Sesión no encontrada" }); return; }
    if (s.user_id !== u.sub && !isAdmin(u)) { res.status(403).json({ error: "Sin permiso" }); return; }
    await query("UPDATE gozz.sesiones_activas SET activa = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  });

  app.get("/api/seguridad/auditoria", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await query<any>(
      `SELECT a.id, a.accion, a.tabla_afectada, a.registro_id, a.created_at, a.ip,
              u.nombre AS user_nombre, u.email AS user_email
         FROM gozz.auditoria a
         LEFT JOIN gozz.users u ON u.id = a.user_id
         ORDER BY a.created_at DESC
         LIMIT $1`,
      [limit]
    );
    res.json({ auditoria: rows });
  });

  // ==================== PREFERENCIAS DE NOTIFICACIONES ====================
  const PrefsSchema = z.object({
    sonido_notifs: z.boolean().optional(),
    email_notifs: z.boolean().optional(),
    push_notifs: z.boolean().optional(),
    notifs_tareas: z.boolean().optional(),
    notifs_chat: z.boolean().optional(),
    notifs_descuentos: z.boolean().optional(),
    notifs_asistencia: z.boolean().optional(),
    dark_mode: z.boolean().optional(),
    locale: z.string().optional()
  });

  app.get("/api/me/preferencias", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    let rows = await query<any>("SELECT * FROM gozz.user_preferencias WHERE user_id = $1", [u.sub]);
    if (!rows[0]) {
      rows = await query<any>(
        `INSERT INTO gozz.user_preferencias (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [u.sub]
      );
    }
    res.json({ preferencias: rows[0] });
  });

  app.patch("/api/me/preferencias", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = PrefsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data as any;
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }

    // Ensure row exists
    await query(
      `INSERT INTO gozz.user_preferencias (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [u.sub]
    );

    const set = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => d[k]);
    const rows = await query<any>(
      `UPDATE gozz.user_preferencias SET ${set}, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
      [u.sub, ...values]
    );
    res.json({ preferencias: rows[0] });
  });
}
