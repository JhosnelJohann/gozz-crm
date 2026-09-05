// Tipos del slice de auth. Contrato estático entre `apps/api/src/modules/auth` y el frontend que
// lo consuma — la validación runtime (Zod) sigue viviendo solo en el backend.

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
  nivel: string;
}

export interface LoginResponse {
  success: true;
  user: AuthUser;
}

export interface AuthMeUser {
  id: string;
  email: string;
  nombre: string;
  nivel_acceso: string;
  /** Alias de `nivel_acceso`, por compatibilidad con el hook `useCurrentUser` del frontend. */
  nivel: string;
  foto_perfil_url: string | null;
  zona_horaria: string | null;
  posiciones: unknown;
  departamento: string | null;
  /** Calculado en el servidor (nivel + `user_permisos`), no es una columna. */
  puede_editar_monto: boolean;
}

export interface AuthMeResponse {
  user: AuthMeUser;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  new_password: string;
}
