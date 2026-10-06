// Envío de correo mínimo para las Automatizaciones (recordatorios programados) — solo buzones con
// auth_type='password'. Los buzones OAuth (Gmail) todavía no están soportados aquí: replicar el
// refresco de token de Google (ver email-routes.ts) es una pieza aparte y con riesgo real de dejar
// un token corrupto si algo sale mal a mitad de un cron desatendido; se prefiere fallar con un
// mensaje claro (visible en `gozz.whatsapp_recordatorios.error`) a intentarlo a medias.
import nodemailer from "nodemailer";
import { query } from "../shared/db.js";
import { decrypt } from "./crypto.js";

interface BuzonSimple {
  id: string;
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  smtp_user: string | null;
  smtp_password_enc: string | null;
  imap_user: string;
  imap_password_enc: string | null;
  auth_type: string;
  activo: boolean;
}

export async function enviarEmailSimple(buzonId: string, d: { to: string; subject: string; html: string }): Promise<void> {
  const rows = await query<BuzonSimple>("SELECT * FROM gozz.buzones_email WHERE id = $1", [buzonId]);
  const buzon = rows[0];
  if (!buzon) throw new Error("Buzón no encontrado");
  if (!buzon.activo) throw new Error("Buzón desvinculado");
  if (buzon.auth_type !== "password") {
    throw new Error("Los recordatorios por correo solo soportan buzones con contraseña (no Gmail/OAuth) por ahora");
  }

  const smtpPassEnc = buzon.smtp_password_enc || buzon.imap_password_enc;
  if (!smtpPassEnc) throw new Error("Buzón sin credenciales SMTP");
  const smtpUser = buzon.smtp_user || buzon.imap_user;

  const transport = nodemailer.createTransport({
    host: buzon.smtp_host,
    port: buzon.smtp_port,
    secure: buzon.smtp_ssl,
    auth: { user: smtpUser, pass: decrypt(smtpPassEnc) },
    connectionTimeout: 12000,
    greetingTimeout: 8000,
    socketTimeout: 30000,
  });
  try {
    await transport.sendMail({
      from: { name: buzon.display_name || buzon.email, address: buzon.email },
      to: d.to,
      subject: d.subject,
      html: d.html,
    });
  } finally {
    try { transport.close(); } catch {}
  }
}
