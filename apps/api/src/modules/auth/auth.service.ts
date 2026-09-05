import crypto from "crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { verifyPassword, signToken, hashPassword } from "../../shared/auth-middleware.js";
import { decrypt } from "../../lib/crypto.js";
import { puedeEditarMontoDirecto } from "../../lib/permisos.js";
import * as repo from "./auth.repository.js";

export interface LoginResult {
  token: string;
  user: { id: string; email: string; nombre: string; nivel: string };
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const user = await repo.findUserByEmailForLogin(email.trim().toLowerCase());
  if (!user || !user.activo) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  const token = signToken({ sub: user.id, email: user.email, nivel: user.nivel_acceso });
  await repo.touchLastLogin(user.id);
  return {
    token,
    user: { id: user.id, email: user.email, nombre: user.nombre, nivel: user.nivel_acceso },
  };
}

export async function me(userId: string) {
  const profile = await repo.findUserProfile(userId);
  if (!profile) return null;
  // Alias 'nivel' para compatibilidad con el hook useCurrentUser, y el permiso CALCULADO
  // puede_editar_monto (no es columna; se deriva de nivel + user_permisos).
  return {
    ...profile,
    nivel: profile.nivel_acceso,
    puede_editar_monto: await puedeEditarMontoDirecto({ sub: userId } as any),
  };
}

export async function logout(userId: string | undefined): Promise<void> {
  if (userId) await repo.setUserOffline(userId).catch(() => {});
}

/** Envía el correo de recuperación usando el primer buzón activo con SMTP configurado. */
async function sendResetEmail(to: string, nombre: string, code: string): Promise<boolean> {
  const buzon = await repo.findActiveSmtpMailbox();
  if (!buzon) {
    console.warn("[pwreset] no SMTP buzon disponible — code:", code);
    return false;
  }
  try {
    const smtpPassEnc = buzon.smtp_password_enc || buzon.imap_password_enc;
    const smtpUser = buzon.smtp_user || buzon.imap_user;
    const pass = decrypt(smtpPassEnc as string);
    // SMTPTransport.Options en vez de la firma genérica de createTransport: con el shape suelto
    // que trae la fila de la base, TS no puede decidir sola cuál de las variantes es.
    const transportOptions: SMTPTransport.Options = {
      host: buzon.smtp_host, port: buzon.smtp_port, secure: buzon.smtp_ssl,
      auth: { user: smtpUser ?? undefined, pass },
    };
    const transport = nodemailer.createTransport(transportOptions);
    const html = `
<!doctype html>
<html><body style="margin:0;padding:0;background:#F5F3EE;font-family:Helvetica,Arial,sans-serif;color:#0A0A12">
  <div style="max-width:520px;margin:40px auto;padding:32px;background:#fff;border-radius:24px;box-shadow:0 10px 40px rgba(15,23,42,0.08);border:1px solid #E5E7EB">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:linear-gradient(135deg,#5750E8 0%,#33359D 100%);padding:12px;border-radius:14px;color:#fff;font-weight:900;font-size:18px;letter-spacing:0.1em">GOZZ CRM</div>
    </div>
    <h1 style="font-size:22px;font-weight:900;margin:0 0 8px">Restablecer contraseña</h1>
    <p style="font-size:14px;color:#475569;margin:0 0 24px">Hola ${nombre || ""}, usa este código de <b>6 dígitos</b> para crear tu nueva contraseña. Vence en <b>15 minutos</b>.</p>
    <div style="text-align:center;margin:24px 0 12px">
      <div style="display:inline-block;padding:18px 32px;border-radius:20px;background:linear-gradient(135deg,#FFF7ED 0%,#FEE7D6 100%);border:1px solid #FED7AA;font-family:Menlo,monospace;font-weight:900;font-size:36px;letter-spacing:0.3em;color:#C2410C">
        ${code}
      </div>
    </div>
    <p style="font-size:12px;color:#94A3B8;text-align:center;margin:24px 0 0">Si no solicitaste este cambio puedes ignorar este correo.</p>
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #E5E7EB;font-size:11px;color:#94A3B8;text-align:center">
      GOZZ CRM · 2026
    </div>
  </div>
</body></html>`;
    await transport.sendMail({
      from: { name: buzon.display_name || "GOZZ CRM", address: buzon.email },
      to,
      subject: `Tu código de recuperación: ${code}`,
      text: `Hola ${nombre || ""},\n\nTu código de recuperación es: ${code}\n\nVence en 15 minutos.\n\nSi no solicitaste este cambio puedes ignorar este correo.`,
      html,
    });
    return true;
  } catch (e: any) {
    console.error("[pwreset] send failed:", e?.message);
    return false;
  }
}

/** Responde siempre igual (evita user enumeration); solo envía el correo si el usuario existe. */
export async function forgotPassword(email: string, ip: string | null): Promise<void> {
  const u = await repo.findActiveUserByEmail(email);
  if (!u) return;
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = await bcrypt.hash(code, 10);
  await repo.invalidatePreviousResets(u.id);
  await repo.createPasswordReset(u.id, codeHash, ip);
  const sent = await sendResetEmail(u.email, u.nombre, code);
  if (!sent) console.warn(`[pwreset] user=${u.email} code=${code} (SMTP no disponible)`);
}

// Cuatro casos DISTINTOS y NO intercambiables (mismo texto de error en dos, pero orígenes
// distintos): "no_encontrado" cubre tanto el email sin usuario activo como el reset ya usado o
// inexistente (mismo mensaje que producción histórica: "Código inválido o expirado"), mientras
// que "codigo_incorrecto" es el código que no compara — mensaje más corto, sin "o expirado",
// porque aquí SÍ hay un reset vigente y lo que falló fue el dígito.
export type ResetPasswordError =
  | "no_encontrado"
  | "expirado"
  | "demasiados_intentos"
  | "codigo_incorrecto";

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<ResetPasswordError | null> {
  const userId = await repo.findActiveUserIdByEmail(email);
  if (!userId) return "no_encontrado";

  const reset = await repo.findLatestUnusedReset(userId);
  if (!reset) return "no_encontrado";
  if (new Date(reset.expires_at).getTime() < Date.now()) return "expirado";
  if (reset.intentos >= 5) {
    await repo.markResetUsed(reset.id);
    return "demasiados_intentos";
  }

  const ok = await bcrypt.compare(code, reset.code_hash);
  if (!ok) {
    await repo.incrementResetAttempts(reset.id);
    return "codigo_incorrecto";
  }

  const hash = await hashPassword(newPassword);
  await repo.updateUserPassword(userId, hash);
  await repo.markResetUsed(reset.id);
  return null;
}
