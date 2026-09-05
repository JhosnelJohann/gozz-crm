// src/push-routes.ts — endpoints de suscripcion a Web Push.
import type { Express, Request, Response } from "express";
import { requireAuth } from "./shared/auth-middleware.js";
import { vapidPublicKey, saveSubscription, removeSubscription } from "./push.js";

export function registerPushRoutes(app: Express) {
  // Llave publica VAPID (no es secreta) para que el cliente se suscriba.
  app.get("/api/push/vapid-public-key", (_req: Request, res: Response) => {
    res.json({ key: vapidPublicKey() });
  });

  // Guardar / actualizar la suscripcion del navegador del usuario.
  app.post("/api/push/subscribe", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    try {
      await saveSubscription(u.sub, req.body?.subscription, req.headers["user-agent"] as string);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "subscription invalida" });
    }
  });

  // Quitar una suscripcion (al desactivar o cerrar sesion).
  app.post("/api/push/unsubscribe", requireAuth, async (req: Request, res: Response) => {
    const endpoint = req.body?.endpoint;
    if (endpoint) await removeSubscription(String(endpoint));
    res.json({ ok: true });
  });
}
