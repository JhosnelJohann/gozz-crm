// src/internal-routes.ts — Endpoints invocados por OTRAS apps (no por usuarios).
// Auth: header X-Internal-Secret == INTERNAL_BRIDGE_SECRET.

import type { Express, Request, Response, NextFunction } from "express";
import { query } from "./shared/db.js";

const INTERNAL_BRIDGE_SECRET = process.env.INTERNAL_BRIDGE_SECRET || "";

function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  const got = req.header("X-Internal-Secret") || "";
  if (!INTERNAL_BRIDGE_SECRET || got !== INTERNAL_BRIDGE_SECRET) {
    res.status(401).json({ error: "invalid_internal_secret" });
    return;
  }
  next();
}

interface CreateTareaBody {
  titulo: string;
  descripcion?: string;
  responsable_email: string;
  prioridad?: "baja" | "normal" | "alta" | "urgente";
  urgente?: boolean;
  etiquetas?: string[];
  metadata?: Record<string, unknown>;
  fecha_limite?: string;
}

export function registerInternalRoutes(app: Express) {
  // POST /api/internal/tareas — crea tarea + notificación, asignada por email
  app.post(
    "/api/internal/tareas",
    requireInternalSecret,
    async (req: Request, res: Response) => {
      try {
        const body = req.body as CreateTareaBody;
        if (!body || typeof body.titulo !== "string" || !body.titulo.trim()) {
          res.status(400).json({ error: "missing_titulo" });
          return;
        }
        if (!body.responsable_email || typeof body.responsable_email !== "string") {
          res.status(400).json({ error: "missing_responsable_email" });
          return;
        }

        // Resolver responsable por email
        const respRows = await query<{ id: string; nombre: string }>(
          "SELECT id, nombre FROM gozz.users WHERE LOWER(email) = LOWER($1) AND activo = true LIMIT 1",
          [body.responsable_email.trim()]
        );
        if (respRows.length === 0) {
          res
            .status(404)
            .json({ error: "responsable_not_found", email: body.responsable_email });
          return;
        }
        const responsableId = respRows[0].id;

        const prioridad = body.prioridad || "alta";
        const urgente = body.urgente !== false; // default true para tareas internas
        const fechaLimite = body.fecha_limite || null;
        const etiquetas = body.etiquetas || ["bridge", "auto"];
        const metadata = body.metadata || {};

        // Insert tarea
        const tareaRows = await query<{ id: string; numero_tarea: number }>(
          `INSERT INTO gozz.tareas
             (titulo, descripcion, propietario_id, responsable_id, observadores,
              estado, prioridad, urgente, fecha_limite, etiquetas, creada_por_ia)
           VALUES ($1, $2, $3, $4, '[]'::jsonb,
                   'pendiente', $5, $6, $7, $8::jsonb, false)
           RETURNING id, numero_tarea`,
          [
            body.titulo.trim().slice(0, 500),
            body.descripcion || null,
            responsableId, // propietario = responsable cuando viene del bridge
            responsableId,
            prioridad,
            urgente,
            fechaLimite,
            JSON.stringify(etiquetas),
          ]
        );
        const tarea = tareaRows[0];

        // Insert notificación in-app para el responsable
        let notificationId: string | undefined;
        try {
          const notifRows = await query<{ id: string }>(
            `INSERT INTO gozz.notificaciones
               (user_id, tipo, titulo, mensaje, prioridad, accion_url, leida, metadata)
             VALUES ($1, 'tarea_asignada', $2, $3, $4, $5, false, $6::jsonb)
             RETURNING id`,
            [
              responsableId,
              "Nueva tarea: " + body.titulo.trim().slice(0, 80),
              body.descripcion || body.titulo,
              urgente ? "alta" : prioridad,
              "/tareas/" + tarea.id,
              JSON.stringify({ ...metadata, source: "bridge", tarea_numero: tarea.numero_tarea }),
            ]
          );
          notificationId = notifRows[0]?.id;
        } catch (err) {
          console.warn("[internal/tareas] notif insert failed:", err);
        }

        res.json({
          ok: true,
          task_id: tarea.id,
          numero_tarea: tarea.numero_tarea,
          notification_id: notificationId,
          responsable_id: responsableId,
        });
      } catch (err) {
        console.error(
          "[internal/tareas] error:",
          err instanceof Error ? err.message : err
        );
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  // GET healthcheck
  app.get("/api/internal/health", requireInternalSecret, (_req, res) => {
    res.json({ ok: true, service: "gozz-api", time: new Date().toISOString() });
  });
}
