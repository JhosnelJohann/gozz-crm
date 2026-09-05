// apps/api/src/lib/object-store.ts
// Cliente Cloudflare R2 (S3-compatible) con firma AWS SigV4, SIN dependencias externas (solo `crypto`).
// TODA la configuración sale de process.env — CERO hardcoding: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_REGION (default "auto"). El bucket es POR ENTORNO (sale de R2_BUCKET),
// así el mismo código apunta al bucket correcto según el .env de cada ambiente.
// Si falta alguna credencial/bucket requerido, `r2Enabled=false` y los call-sites caen a disco local
// (arranque graceful: NO se lanza en import). Portado idiomático de scripts/r2-lib.mjs.
// Path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>.
import crypto from "node:crypto";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "";
const REGION = process.env.R2_REGION || "auto";

/** true solo si las credenciales + bucket requeridos están en el entorno (R2_REGION cae a "auto"). */
export const r2Enabled: boolean = !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);

/** Llave content-addressed del objeto para un sha256 (idéntica a la de migrar-storage-r2.mjs). */
export function r2Key(sha: string): string {
  return `objects/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
}

/**
 * Estado del backend de almacenamiento de archivos, derivado del entorno. ÚNICA fuente de verdad del
 * proveedor: ningún otro archivo hardcodea el nombre del proveedor — lo consumen backend y frontend desde acá.
 */
export function storageStatus(): { ready: boolean; provider: string } {
  return { ready: r2Enabled, provider: "Cloudflare R2" };
}

const HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const SERVICE = "s3";
const sha256hex = (b: crypto.BinaryLike) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (key: crypto.BinaryLike, str: string): Buffer => crypto.createHmac("sha256", key).update(str).digest();
// AWS URI-encode por segmento (no codifica '/').
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const cleanEtag = (e: string | null) => (e || "").replace(/"/g, "");

async function r2req(method: string, key: string, opts: { body?: Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
  if (!r2Enabled) throw new Error("R2 no configurado (faltan variables de entorno R2_*)");
  const body = opts.body ?? Buffer.alloc(0);
  const amzdate = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
  const datestamp = amzdate.slice(0, 8);
  const canonicalUri = "/" + enc(BUCKET) + "/" + key.split("/").map(enc).join("/");
  const payloadHash = method === "GET" || method === "HEAD" ? sha256hex(Buffer.alloc(0)) : sha256hex(body);
  const H: Record<string, string> = { host: HOST, "x-amz-content-sha256": payloadHash, "x-amz-date": amzdate };
  for (const [k, v] of Object.entries(opts.headers || {})) H[k.toLowerCase()] = v;
  const keys = Object.keys(H).sort();
  const canonicalHeaders = keys.map((k) => `${k}:${String(H[k]).trim()}\n`).join("");
  const signedHeaders = keys.join(";");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${datestamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, scope, sha256hex(Buffer.from(canonicalRequest))].join("\n");
  let s = hmac("AWS4" + SECRET_ACCESS_KEY, datestamp);
  s = hmac(s, REGION); s = hmac(s, SERVICE); s = hmac(s, "aws4_request");
  const signature = crypto.createHmac("sha256", s).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`https://${HOST}${canonicalUri}`, {
    method,
    headers: { ...H, authorization },
    body: method === "GET" || method === "HEAD" ? undefined : (body as any),
  });
}

export interface HeadResult { status: number; etag: string; ok: boolean; }
export interface PutResult { etag: string; existed: boolean; status: number; }

/** HEAD de un objeto: existencia + etag. */
export async function headObject(key: string): Promise<HeadResult> {
  const r = await r2req("HEAD", key);
  return { status: r.status, etag: cleanEtag(r.headers.get("etag")), ok: r.ok };
}

/**
 * PUT content-addressed con If-None-Match:* → nunca sobrescribe el original.
 * status 200/201 = subido; 412 = ya existía → se toma el etag vía headObject. Lanza en otro fallo.
 */
export async function putObject(key: string, buf: Buffer, contentType?: string): Promise<PutResult> {
  const r = await r2req("PUT", key, {
    body: buf,
    headers: { ...(contentType ? { "content-type": contentType } : {}), "if-none-match": "*" },
  });
  if (r.status === 200 || r.status === 201) return { etag: cleanEtag(r.headers.get("etag")), existed: false, status: r.status };
  if (r.status === 412) { const h = await headObject(key); return { etag: h.etag, existed: true, status: 412 }; }
  throw new Error(`R2 PUT falló: HTTP ${r.status}`);
}

/** GET server-side de un objeto (los bytes se sirven por el proxy autenticado; nunca URLs firmadas públicas). */
export async function getObject(key: string): Promise<Buffer> {
  const r = await r2req("GET", key);
  if (!r.ok) throw Object.assign(new Error(`R2 GET falló: HTTP ${r.status}`), { httpStatus: r.status });
  return Buffer.from(await r.arrayBuffer());
}

/**
 * DELETE de un objeto R2 (Fase B2 — borrado permanente). ⚠️ IRREVERSIBLE. Solo debe invocarse sobre objetos
 * HUÉRFANOS (ninguna fila de drive_files ni uploads_r2_backup referencia su sha256): el guardrail vive en el
 * núcleo de purga, no acá. 204 = borrado; 404 = ya no existía (idempotente, ok).
 */
export async function deleteObject(key: string): Promise<{ status: number; ok: boolean }> {
  const r = await r2req("DELETE", key);
  await r.arrayBuffer().catch(() => {}); // drena el body para no dejar la conexión colgada
  return { status: r.status, ok: r.status === 204 || r.status === 200 || r.status === 404 };
}
