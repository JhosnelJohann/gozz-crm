import type { Express } from "express";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";

export function registerNotificacionesRoutes(app: Express) {
  app.get("/api/notificaciones", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const rows = await query(
    "SELECT id, tipo, titulo, mensaje, prioridad, accion_url, leida, created_at FROM gozz.notificaciones WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30",
    [u.sub]
  );
  res.json({ notificaciones: rows });
});

  app.post("/api/notificaciones/:id/leer", requireAuth, async (req, res) => {
  const u = (req as any).user;
  await query("UPDATE gozz.notificaciones SET leida = true, leida_at = NOW() WHERE id = $1 AND user_id = $2", [req.params.id, u.sub]);
  res.json({ success: true });
});

  app.post("/api/notificaciones/leer-todas", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const r = await query<any>(
    "UPDATE gozz.notificaciones SET leida = true, leida_at = NOW() WHERE user_id = $1 AND leida = false RETURNING id",
    [u.sub]
  );
  res.json({ success: true, marcadas: r.length });
});

// Borrar TODAS las notificaciones del usuario
  app.delete("/api/notificaciones", requireAuth, async (req, res) => {
  const u = (req as any).user;
  const r = await query<any>("DELETE FROM gozz.notificaciones WHERE user_id = $1 RETURNING id", [u.sub]);
  res.json({ success: true, eliminadas: r.length });
});

  app.delete("/api/notificaciones/:id", requireAuth, async (req, res) => {
  const u = (req as any).user;
  await query("DELETE FROM gozz.notificaciones WHERE id = $1 AND user_id = $2", [req.params.id, u.sub]);
  res.json({ success: true });
});
}
