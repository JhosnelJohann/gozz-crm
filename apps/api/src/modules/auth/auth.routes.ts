import type { Express } from "express";
import type { LoginResponse, AuthMeResponse } from "@gozz/shared-types";
import { requireAuth } from "../../shared/auth-middleware.js";
import { COOKIE_SECURE } from "../../shared/env.js";
import { LoginSchema } from "./auth.schemas.js";
import * as authService from "./auth.service.js";

const RESET_ERROR_RESPONSES: Record<authService.ResetPasswordError, { status: number; error: string }> = {
  no_encontrado: { status: 400, error: "Código inválido o expirado" },
  expirado: { status: 400, error: "El código expiró, solicita uno nuevo" },
  demasiados_intentos: { status: 429, error: "Demasiados intentos. Solicita un nuevo código" },
  codigo_incorrecto: { status: 400, error: "Código inválido" },
};

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Datos invalidos" }); return; }

    const result = await authService.login(parsed.data.email, parsed.data.password);
    if (!result) { res.status(401).json({ error: "Credenciales invalidas" }); return; }

    res.cookie("access_token", result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      maxAge: 60 * 60 * 24 * 365 * 1000, // 365 dias — CRM interno, sesion permanente
      path: "/",
    });
    const body: LoginResponse = { success: true, user: result.user };
    res.json(body);
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const user = await authService.me(u.sub);
    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    const body: AuthMeResponse = { user };
    res.json(body);
  });

  app.post("/api/auth/logout", async (req, res) => {
    const u = (req as any).user;
    await authService.logout(u?.sub);
    res.clearCookie("access_token", { path: "/" });
    res.json({ success: true });
  });

  app.post("/api/auth/forgot", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) { res.status(400).json({ error: "Email inválido" }); return; }
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || null;
    await authService.forgotPassword(email, ip);
    res.json({ ok: true });
  });

  app.post("/api/auth/reset", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    const newPassword = String(req.body?.new_password || "");
    if (!email || !code || !newPassword) { res.status(400).json({ error: "Faltan datos" }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: "La nueva contraseña debe tener mínimo 8 caracteres" }); return; }
    if (!/^\d{6}$/.test(code)) { res.status(400).json({ error: "Código inválido" }); return; }

    const err = await authService.resetPassword(email, code, newPassword);
    if (err) {
      const { status, error } = RESET_ERROR_RESPONSES[err];
      res.status(status).json({ error });
      return;
    }
    res.json({ ok: true });
  });
}
