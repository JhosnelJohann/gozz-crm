import type { Express, Request, Response, NextFunction } from "express";

/** Middleware de error global. Va SIEMPRE al final, después de montar todas las rutas. */
export function registerErrorHandler(app: Express) {
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[express-error] ${req.method} ${req.originalUrl}:`, err?.message || err);
    if (!res.headersSent) res.status(500).json({ error: err?.message || "internal" });
  });
}
