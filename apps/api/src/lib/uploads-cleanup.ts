import fs from "fs";
import path from "path";
import { query } from "../shared/db.js";
import { uploadUrlToAbsPath } from "./storage.js";
const SCHEMA = "gozz";

// Origen de cada borrado físico (para la bitácora gozz.uploads_borrados).
export type CleanupOrigen =
  | "cascade_nota"
  | "cascade_pago"
  | "cascade_chat"
  | "cascade_tarea"
  | "cascade_oportunidad"
  | "cascade_ia"
  | "gc_purga"
  | "papelera_manual";

export interface CleanupOpts {
  origen?: CleanupOrigen | string;
  userId?: string | null;   // null/undefined = automático
  motivo?: string | null;
}

/** ¿La URL sigue referenciada por ALGÚN registro? (revisa todas las columnas de archivos) */
export async function isUploadReferenced(url: string): Promise<boolean> {
  const rows = await query<any>(
    `select exists (
       select 1 from ${SCHEMA}.oportunidades_notas where position($1 in archivos::text) > 0
       union all select 1 from ${SCHEMA}.contactos_notas where position($1 in archivos::text) > 0
       union all select 1 from ${SCHEMA}.oportunidades_pagos
                 where comprobante_url = $1 or firma_autorizacion_url = $1
                    or position($1 in comprobantes_urls::text) > 0
                    or position($1 in documentos_adicionales::text) > 0
       union all select 1 from ${SCHEMA}.oportunidad_pago_solicitudes where position($1 in comprobante_propuesto::text) > 0
       union all select 1 from ${SCHEMA}.oportunidades where position($1 in documentos::text) > 0
       union all select 1 from ${SCHEMA}.tareas_archivos where url = $1
       union all select 1 from ${SCHEMA}.chat_mensajes where archivo_url = $1 or position($1 in coalesce(contenido,'')) > 0
       union all select 1 from ${SCHEMA}.chat_grupos where avatar_url = $1
       union all select 1 from ${SCHEMA}.users where foto_perfil_url = $1
       union all select 1 from ${SCHEMA}.notificaciones where position($1 in metadata::text) > 0
     ) as referenced`, [url]);
  return rows[0]?.referenced === true;
}

/**
 * Borra el archivo del disco SOLO si ya nadie lo referencia, y deja rastro en uploads_borrados.
 * Devuelve true si el archivo existía físicamente y se borró.
 * Un fallo de bitácora NUNCA rompe el flujo (se loguea y se sigue).
 */
export async function deleteUploadIfUnreferenced(url: string, opts: CleanupOpts = {}): Promise<boolean> {
  if (!url || typeof url !== "string" || !url.startsWith("/uploads/")) return false;
  if (url.startsWith("/uploads/avatars/")) return false;  // avatares NUNCA se borran (se sobreescriben
                                                          // y están referenciados en JSON históricos)
  if (await isUploadReferenced(url)) return false;
  let existia = false;
  try { fs.unlinkSync(uploadUrlToAbsPath(url)); existia = true; } catch { existia = false; }
  try {
    await query(
      `insert into ${SCHEMA}.uploads_borrados (url, filename, origen, motivo, existia, borrado_por)
       values ($1,$2,$3,$4,$5,$6)`,
      [url, path.posix.basename(url.split("?")[0]), opts.origen ?? null, opts.motivo ?? null, existia, opts.userId ?? null]
    );
  } catch (e: any) {
    console.error("[uploads_borrados] no se pudo registrar el borrado:", e?.message || e);
  }
  return existia;
}

export async function deleteUploadsIfUnreferenced(urls: string[], opts: CleanupOpts = {}): Promise<number> {
  let n = 0;
  for (const u of [...new Set(urls.filter(Boolean))]) if (await deleteUploadIfUnreferenced(u, opts)) n++;
  return n;
}
