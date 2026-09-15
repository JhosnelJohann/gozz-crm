// Lectura centralizada de las variables de entorno que usa el bootstrap del servidor (kernel).
// Las variables propias de cada dominio (email, R2, LiveKit, etc.) se leen donde se usan, no aquí.

export const PORT = Number(process.env.PORT) || 4100;
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
// Compartir la cookie de sesion entre subdominios (ej. ".sandrogozz.com") permite que el
// frontend y la API vivan en hosts distintos (crm.sandrogozz.com / api.sandrogozz.com) y el
// socket.io del navegador siga autenticando via cookie al conectar directo a la API. Sin
// domain, la cookie queda host-only y no se envia a un origen distinto. Vacio = comportamiento
// de siempre (mismo origen, como en el VPS original detras de nginx).
export const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
export const UPLOADS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
