// src/aplicaciones-routes.ts — Sección Aplicaciones del GOZZ CRM.
// GET /api/aplicaciones/status — ping + KPIs mini de ciudadania-app + academia-app
// POST /api/aplicaciones/sso — genera token single-use para abrir app target

import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";

const SSO_BRIDGE_SECRET = process.env.SSO_BRIDGE_SECRET || "";
const CIUDADANIA_BASE = process.env.CIUDADANIA_BASE_URL || "https://curso.tuimpulsolatino.com";
const ACADEMIA_BASE = process.env.ACADEMIA_BASE_URL || "https://academiadeingles.tuimpulsolatino.com";

const APP_TARGETS = {
  ciudadania: {
    base: CIUDADANIA_BASE,
    local: "http://127.0.0.1:3000",
    consumePath: "/api/admin/sso-bridge/consume",
    table: "users",
  },
  academia: {
    base: ACADEMIA_BASE,
    local: "http://127.0.0.1:3001",
    consumePath: "/api/admin/sso-bridge/consume",
    table: "academia_users",
  },
} as const;

type AppKey = keyof typeof APP_TARGETS;

async function pingApp(localUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(localUrl + "/api/health", { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function ciudadaniaKpis(): Promise<Record<string, number | string>> {
  try {
    const total = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM public.users WHERE status != 'blocked'");
    const paid = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM public.users WHERE course_status = 'paid'");
    const today = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM public.users WHERE created_at >= date_trunc('day', now())"
    );
    return {
      total_leads: parseInt(total[0]?.count || "0"),
      paid_users: parseInt(paid[0]?.count || "0"),
      leads_hoy: parseInt(today[0]?.count || "0"),
    };
  } catch {
    return { total_leads: 0, paid_users: 0, leads_hoy: 0 };
  }
}

async function academiaKpis(): Promise<Record<string, number | string>> {
  try {
    const total = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM public.academia_users");
    const classes = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM public.academia_classes");
    const today = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM public.academia_users WHERE created_at >= date_trunc('day', now())"
    );
    return {
      total_estudiantes: parseInt(total[0]?.count || "0"),
      total_clases: parseInt(classes[0]?.count || "0"),
      estudiantes_hoy: parseInt(today[0]?.count || "0"),
    };
  } catch {
    return { total_estudiantes: 0, total_clases: 0, estudiantes_hoy: 0 };
  }
}

export function registerAplicacionesRoutes(app: Express) {
  // GET /api/aplicaciones/status
  app.get("/api/aplicaciones/status", requireAuth, async (_req: Request, res: Response) => {
    const [ciuOnline, acaOnline, ciuKpis, acaKpis] = await Promise.all([
      pingApp(APP_TARGETS.ciudadania.local),
      pingApp(APP_TARGETS.academia.local),
      ciudadaniaKpis(),
      academiaKpis(),
    ]);
    res.json({
      apps: [
        {
          key: "ciudadania",
          name: "Ciudadanía App",
          description: "Curso N-400, leads, pagos Zelle, quiz analytics",
          color: "#FA6C04",
          base_url: CIUDADANIA_BASE,
          online: ciuOnline,
          kpis: ciuKpis,
        },
        {
          key: "academia",
          name: "Academia de Inglés",
          description: "Estudiantes, clases, magic links, oral attempts",
          color: "#3B82F6",
          base_url: ACADEMIA_BASE,
          online: acaOnline,
          kpis: acaKpis,
        },
      ],
    });
  });

  // POST /api/aplicaciones/sso { app: 'ciudadania'|'academia' }
  app.post("/api/aplicaciones/sso", requireAuth, async (req: Request, res: Response) => {
    if (!SSO_BRIDGE_SECRET) {
      res.status(500).json({ error: "sso_secret_not_configured" });
      return;
    }
    const u = (req as { user?: { sub: string; email: string } }).user;
    if (!u?.email) {
      res.status(401).json({ error: "no_session" });
      return;
    }
    const body = req.body as { app?: string };
    const targetApp = body?.app as AppKey | undefined;
    if (!targetApp || !(targetApp in APP_TARGETS)) {
      res.status(400).json({ error: "invalid_app" });
      return;
    }

    const target = APP_TARGETS[targetApp];

    // Validar que el user tenga cuenta admin en la app target (cross-DB query)
    const userRows = await query<{ email: string; role: string }>(
      `SELECT email, role FROM public.${target.table} WHERE LOWER(email) = LOWER($1) AND role = 'admin' LIMIT 1`,
      [u.email]
    );
    if (userRows.length === 0) {
      res.status(403).json({
        error: "no_access_in_target_app",
        message: "No tenés cuenta admin en " + targetApp + ". Contactá al super-admin para que te de acceso.",
      });
      return;
    }

    // Generar token single-use
    const tokenRows = await query<{ jti: string; expires_at: string }>(
      `INSERT INTO gozz.sso_tokens (user_email, target_app, expires_at)
       VALUES ($1, $2, now() + interval '60 seconds')
       RETURNING jti, expires_at`,
      [u.email.toLowerCase(), targetApp]
    );
    const { jti } = tokenRows[0];

    // JWT firmado: payload {jti, email, target, exp}
    const token = jwt.sign(
      {
        jti,
        email: u.email.toLowerCase(),
        target: targetApp,
      },
      SSO_BRIDGE_SECRET,
      { expiresIn: "60s" }
    );

    const url = target.base + target.consumePath + "?token=" + encodeURIComponent(token);
    res.json({ url, target_app: targetApp, expires_in: 60 });
  });
}
