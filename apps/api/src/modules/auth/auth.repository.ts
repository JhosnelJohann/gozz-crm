// Único lugar del slice de auth con acceso directo a SQL. `auth.service.ts` es el único que
// importa de aquí; las rutas nunca tocan `query` directamente.
import { query } from "../../shared/db.js";

export interface UsuarioLogin {
  id: string;
  email: string;
  nombre: string;
  password_hash: string;
  nivel_acceso: string;
  activo: boolean;
}

export async function findUserByEmailForLogin(email: string): Promise<UsuarioLogin | null> {
  const rows = await query<UsuarioLogin>(
    "SELECT id, email, nombre, password_hash, nivel_acceso, activo FROM gozz.users WHERE email = $1 LIMIT 1",
    [email]
  );
  return rows[0] ?? null;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await query("UPDATE gozz.users SET ultimo_login = NOW(), online = true WHERE id = $1", [userId]);
}

export interface UsuarioPerfil {
  id: string;
  email: string;
  nombre: string;
  nivel_acceso: string;
  foto_perfil_url: string | null;
  zona_horaria: string | null;
  posiciones: unknown;
  departamento: string | null;
}

export async function findUserProfile(userId: string): Promise<UsuarioPerfil | null> {
  const rows = await query<UsuarioPerfil>(
    "SELECT id, email, nombre, nivel_acceso, foto_perfil_url, zona_horaria, posiciones, departamento FROM gozz.users WHERE id = $1 LIMIT 1",
    [userId]
  );
  return rows[0] ?? null;
}

export async function setUserOffline(userId: string): Promise<void> {
  await query("UPDATE gozz.users SET online = false WHERE id = $1", [userId]);
}

export interface UsuarioActivo {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
}

export async function findActiveUserByEmail(email: string): Promise<UsuarioActivo | null> {
  const rows = await query<UsuarioActivo>(
    "SELECT id, email, nombre, activo FROM gozz.users WHERE email = $1 LIMIT 1",
    [email]
  );
  return rows[0]?.activo ? rows[0] : null;
}

export async function findActiveUserIdByEmail(email: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM gozz.users WHERE email = $1 AND activo = true LIMIT 1",
    [email]
  );
  return rows[0]?.id ?? null;
}

export async function invalidatePreviousResets(userId: string): Promise<void> {
  await query("UPDATE gozz.password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL", [userId]);
}

export async function createPasswordReset(userId: string, codeHash: string, ip: string | null): Promise<void> {
  await query(
    `INSERT INTO gozz.password_resets (user_id, code_hash, expires_at, ip)
     VALUES ($1, $2, NOW() + INTERVAL '15 minutes', $3)`,
    [userId, codeHash, ip]
  );
}

export interface PasswordReset {
  id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  intentos: number;
}

export async function findLatestUnusedReset(userId: string): Promise<PasswordReset | null> {
  const rows = await query<PasswordReset>(
    `SELECT id, code_hash, expires_at, used_at, intentos FROM gozz.password_resets
      WHERE user_id = $1 AND used_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function markResetUsed(resetId: string): Promise<void> {
  await query("UPDATE gozz.password_resets SET used_at = NOW() WHERE id = $1", [resetId]);
}

export async function incrementResetAttempts(resetId: string): Promise<void> {
  await query("UPDATE gozz.password_resets SET intentos = intentos + 1 WHERE id = $1", [resetId]);
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await query("UPDATE gozz.users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [passwordHash, userId]);
}

export interface BuzonSmtp {
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  smtp_user: string | null;
  smtp_password_enc: string | null;
  imap_user: string | null;
  imap_password_enc: string | null;
}

export async function findActiveSmtpMailbox(): Promise<BuzonSmtp | null> {
  const rows = await query<BuzonSmtp>(
    `SELECT email, display_name, smtp_host, smtp_port, smtp_ssl, smtp_user, smtp_password_enc, imap_user, imap_password_enc
       FROM gozz.buzones_email WHERE activo = true AND smtp_host IS NOT NULL
       ORDER BY created_at ASC LIMIT 1`
  );
  return rows[0] ?? null;
}
