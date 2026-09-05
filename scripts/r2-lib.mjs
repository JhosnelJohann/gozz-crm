/* Cliente S3/R2 mínimo con firma AWS SigV4 (sin dependencias, solo `crypto`).
 * Lee credenciales de un archivo .env-like (ruta en R2_CREDS_FILE) o de process.env.
 * Path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key> */
import crypto from "crypto";
import fs from "fs";

export function loadR2Creds(file) {
  const env = {};
  if (file && fs.existsSync(file)) {
    for (const l of fs.readFileSync(file, "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const g = (k) => env[k] || process.env[k];
  const c = {
    accountId: g("R2_ACCOUNT_ID"), accessKeyId: g("R2_ACCESS_KEY_ID"),
    secretAccessKey: g("R2_SECRET_ACCESS_KEY"), bucket: g("R2_BUCKET"), region: g("R2_REGION") || "auto",
  };
  for (const k of ["accountId", "accessKeyId", "secretAccessKey", "bucket"])
    if (!c[k]) throw new Error("Falta credencial R2: " + k);
  return c;
}

const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const hmac = (key, str) => crypto.createHmac("sha256", key).update(str).digest();
// AWS URI-encode para cada segmento del path (no codifica '/')
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function makeR2(creds) {
  const { accountId, accessKeyId, secretAccessKey, bucket, region } = creds;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const service = "s3";

  async function req(method, key, { body = Buffer.alloc(0), headers = {} } = {}) {
    const now = new Date();
    const amzdate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
    const datestamp = amzdate.slice(0, 8);
    const canonicalUri = "/" + enc(bucket) + "/" + key.split("/").map(enc).join("/");
    const payloadHash = method === "GET" || method === "HEAD" ? sha256hex(Buffer.alloc(0)) : sha256hex(body);
    const H = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzdate };
    for (const [k, v] of Object.entries(headers)) H[k.toLowerCase()] = v;
    const keys = Object.keys(H).sort();
    const canonicalHeaders = keys.map((k) => `${k}:${String(H[k]).trim()}\n`).join("");
    const signedHeaders = keys.join(";");
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${datestamp}/${region}/${service}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzdate, scope, sha256hex(Buffer.from(canonicalRequest))].join("\n");
    let s = hmac("AWS4" + secretAccessKey, datestamp);
    s = hmac(s, region); s = hmac(s, service); s = hmac(s, "aws4_request");
    const signature = crypto.createHmac("sha256", s).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const resp = await fetch(`https://${host}${canonicalUri}`, {
      method, headers: { ...H, authorization }, body: method === "GET" || method === "HEAD" ? undefined : body,
    });
    return resp;
  }

  return {
    host, bucket,
    put: (key, body, { contentType, ifNoneMatch } = {}) =>
      req("PUT", key, { body, headers: { ...(contentType ? { "content-type": contentType } : {}), ...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}) } }),
    get: (key) => req("GET", key),
    head: (key) => req("HEAD", key),
    del: (key) => req("DELETE", key),
  };
}
