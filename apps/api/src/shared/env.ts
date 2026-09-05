// Lectura centralizada de las variables de entorno que usa el bootstrap del servidor (kernel).
// Las variables propias de cada dominio (email, R2, LiveKit, etc.) se leen donde se usan, no aquí.

export const PORT = Number(process.env.PORT) || 4100;
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
export const UPLOADS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
