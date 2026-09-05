// apps/api/src/lib/storage.ts
// Fuente ÚNICA DE VERDAD para las rutas de almacenamiento de archivos subidos.
// La usan tanto el reorganizador (archivos existentes) como los endpoints de subida
// (archivos nuevos), para que jamás difieran. Cambiar el layout de carpetas —o migrar
// mañana a un object-store tipo R2— es cambiar SOLO este archivo.
// Ver docs/PLAN-REORGANIZACION-UPLOADS-20260709.md §2 (arquitectura) y §5 (tabla de mapeo).
import fs from "fs";
import path from "path";

// Raíz física de los uploads. Configurable por env con fallback a la ruta del VPS.
export const UPLOADS_ROOT = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";

/** Shard anti fan-out: primeros 2 caracteres del UUID de la entidad. */
export function shard(uuid: string): string {
  if (!uuid || typeof uuid !== "string") {
    throw new Error(`shard(): uuid inválido: ${JSON.stringify(uuid)}`);
  }
  return uuid.slice(0, 2);
}

export type StorageModulo =
  | "user_avatar"
  | "contacto_nota"
  | "oportunidad_nota"
  | "pago_comprobante"
  | "pago_firma"
  | "pago_documento"
  | "pago_solicitud"
  | "oportunidad_ia"
  | "tarea"
  | "chat_mensaje"
  | "chat_grupo_avatar";

export interface StorageIds {
  userId?: string;
  contactoId?: string;
  opId?: string;
  notaId?: string;
  pagoId?: string;
  solId?: string;
  tareaId?: string;
  grupoId?: string;
}

export interface StoragePath {
  /** Ruta relativa a UPLOADS_ROOT (para mkdir -p + escribir). Sin barra final. */
  dirRel: string;
  /** Ruta absoluta en disco = path.join(UPLOADS_ROOT, dirRel). */
  dirAbs: string;
  /** Prefijo de la URL guardada en BD. La URL final = urlPrefix + filename. */
  urlPrefix: string;
}

/** Exige un id requerido por el módulo; si falta, lanza un error claro. */
function req(ids: StorageIds, key: keyof StorageIds, modulo: string): string {
  const v = ids[key];
  if (!v || typeof v !== "string") {
    throw new Error(`storagePathFor(${modulo}): falta el id requerido "${key}"`);
  }
  return v;
}

/**
 * Calcula la ruta de almacenamiento de un módulo dado sus ids.
 * Devuelve { dirRel, dirAbs, urlPrefix }. Valida los ids requeridos por módulo.
 */
export function storagePathFor(modulo: StorageModulo, ids: StorageIds): StoragePath {
  let dirRel: string;
  switch (modulo) {
    case "user_avatar": {
      const userId = req(ids, "userId", modulo);
      dirRel = `users/${shard(userId)}/${userId}`;
      break;
    }
    case "contacto_nota": {
      const contactoId = req(ids, "contactoId", modulo);
      const notaId = req(ids, "notaId", modulo);
      dirRel = `contactos/${shard(contactoId)}/${contactoId}/notas/${notaId}`;
      break;
    }
    case "oportunidad_nota": {
      const opId = req(ids, "opId", modulo);
      const notaId = req(ids, "notaId", modulo);
      dirRel = `oportunidades/${shard(opId)}/${opId}/notas/${notaId}`;
      break;
    }
    case "pago_comprobante": {
      const opId = req(ids, "opId", modulo);
      const pagoId = req(ids, "pagoId", modulo);
      dirRel = `oportunidades/${shard(opId)}/${opId}/pagos/${pagoId}/comprobantes`;
      break;
    }
    case "pago_firma": {
      const opId = req(ids, "opId", modulo);
      const pagoId = req(ids, "pagoId", modulo);
      dirRel = `oportunidades/${shard(opId)}/${opId}/pagos/${pagoId}/firma`;
      break;
    }
    case "pago_documento": {
      const opId = req(ids, "opId", modulo);
      const pagoId = req(ids, "pagoId", modulo);
      dirRel = `oportunidades/${shard(opId)}/${opId}/pagos/${pagoId}/documentos`;
      break;
    }
    case "pago_solicitud": {
      const opId = req(ids, "opId", modulo);
      const pagoId = req(ids, "pagoId", modulo);
      const solId = req(ids, "solId", modulo);
      dirRel = `oportunidades/${shard(opId)}/${opId}/pagos/${pagoId}/solicitudes/${solId}`;
      break;
    }
    case "oportunidad_ia": {
      const opId = req(ids, "opId", modulo);
      dirRel = `oportunidades/${shard(opId)}/${opId}/documentos`;
      break;
    }
    case "tarea": {
      const tareaId = req(ids, "tareaId", modulo);
      dirRel = `tareas/${shard(tareaId)}/${tareaId}`;
      break;
    }
    case "chat_mensaje": {
      // chats/ NO lleva shard (hay pocos grupos). Ver doc §2.
      const grupoId = req(ids, "grupoId", modulo);
      dirRel = `chats/mensajes/${grupoId}`;
      break;
    }
    case "chat_grupo_avatar": {
      const grupoId = req(ids, "grupoId", modulo);
      dirRel = `chats/grupos/${grupoId}`;
      break;
    }
    default: {
      // Exhaustividad: si se agrega un módulo nuevo al type y no aquí, TS falla en compilación.
      const _exhaustive: never = modulo;
      throw new Error(`storagePathFor: módulo desconocido "${_exhaustive}"`);
    }
  }
  return {
    dirRel,
    dirAbs: path.join(UPLOADS_ROOT, dirRel),
    urlPrefix: `/uploads/${dirRel}/`,
  };
}

/**
 * Coloca un archivo recién subido (que multer dejó plano) en su carpeta organizada según
 * (modulo, ids) y devuelve la URL final para guardar en BD. Crea la carpeta bajo demanda y
 * MUEVE el archivo. `currentAbsPath` = ruta absoluta actual; `filename` = nombre a conservar.
 */
export function placeUploadedFile(
  currentAbsPath: string,
  modulo: StorageModulo,
  ids: StorageIds,
  filename: string,
): string {
  const { dirAbs, urlPrefix } = storagePathFor(modulo, ids);
  fs.mkdirSync(dirAbs, { recursive: true });
  const destAbs = path.join(dirAbs, filename);
  try {
    fs.renameSync(currentAbsPath, destAbs);
  } catch {
    // Fallback si el rename cruza dispositivos (p.ej. /tmp → data/uploads): copiar + borrar origen.
    fs.copyFileSync(currentAbsPath, destAbs);
    fs.unlinkSync(currentAbsPath);
  }
  return urlPrefix + filename;
}

/**
 * Resuelve una URL /uploads/ a su ruta absoluta en disco. Soporta rutas organizadas
 * (con subcarpetas) o planas, y descarta el querystring.
 */
export function uploadUrlToAbsPath(url: string): string {
  const rel = url.replace(/^\/uploads\//, "").split("?")[0];
  return path.join(UPLOADS_ROOT, rel);
}
