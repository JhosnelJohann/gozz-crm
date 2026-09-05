import pg from "pg";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

export const pool = new pg.Pool({
  connectionString: url,
  max: 32,                       // subido de 20 (Postgres max_connections=100, hay margen) — reduce "Connection not available"
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  query_timeout: 15_000,
  // Red de seguridad: todas las queries usan el prefijo "gozz." explícito, pero esto cubre
  // cualquier query nueva que se escriba sin prefijo por descuido.
  options: "-c search_path=gozz,public",
});

pool.on("error", (err) => {
  console.error("[pg-pool] idle client error", err.message);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
