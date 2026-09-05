// Cliente API centralizado — wrapper delgado sobre `fetch` para los slices de referencia
// (auth, contactos, oportunidades). El resto de la app sigue con `fetch` suelto por ahora; ver
// docs/ROADMAP.md para el plan de adopción del resto de dominios.
//
// Las rutas son relativas ("/api/...") y pasan por el rewrite de Next (`next.config.mjs`), así
// que nunca hace falta una URL absoluta ni CORS. `credentials: "include"` asegura que la cookie
// httpOnly `access_token` viaje incluso si algún día el origen deja de ser exactamente el mismo.

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    const message = body && typeof body === "object" && typeof body.error === "string"
      ? body.error
      : `Error ${res.status}`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined });
}

export function apiPatch<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
