// Drive del CRM — endpoints /api/drive/*
import type { Express, Request, Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { query, pool } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { r2Enabled, r2Key, putObject, getObject, deleteObject, headObject, storageStatus } from "./lib/object-store.js";
import { decidir, generarMiniatura } from "./lib/drive-thumbs.js";

const TMP_DIR = "/root/gozz-crm/data/tmp";
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

// Almacenamiento local PERMANENTE (fallback de emergencia cuando R2 falla).
// Garantiza que subir documentos SIEMPRE funcione, aunque R2 esté caído momentáneamente.
const DRIVE_DIR = "/root/gozz-crm/data/drive";
try { fs.mkdirSync(DRIVE_DIR, { recursive: true }); } catch {}

// ÚNICO helper de servido de bytes (reutilizado por /download, /raw y /extract): R2 (content-addressed)
// → disco local. La capa de archivos es R2-only. Los archivos legacy ya fueron
// migrados a R2 (Fase 1); un R2 caído momentáneo cae a disco si el archivo tiene copia local.
async function readFileBytes(f: any): Promise<Buffer> {
  if (f.r2_key && r2Enabled) {
    try { return await getObject(f.r2_key); }
    catch (e: any) { console.warn("[drive/read] R2 falló, fallback a disco:", e?.message); }
  }
  if (f.local_path) return fs.promises.readFile(f.local_path);
  throw new Error("archivo sin fuente de bytes (r2_key/local_path)");
}

// Separa nombre en base + ext (ext = desde el ÚLTIMO punto; sin punto o dotfile → todo es base, ext="").
function splitNombre(originalname: string): { base: string; ext: string } {
  const dot = originalname.lastIndexOf(".");
  return dot > 0 ? { base: originalname.slice(0, dot), ext: originalname.slice(dot) } : { base: originalname, ext: "" };
}

// Resuelve un nombre libre en la carpeta (case-insensitive, solo archivos vivos). Si "base+ext" está tomado,
// devuelve el primer "base (N)+ext" libre con N≥1. Un nombre que ya trae contador se trata literal (no se
// re-parsea). Debe llamarse dentro de la transacción con el advisory lock tomado (evita la race del contador).
async function resolverNombreUnico(client: any, folderId: string, originalname: string): Promise<string> {
  const { base, ext } = splitNombre(originalname);
  const { rows } = await client.query(
    `SELECT lower(nombre) AS n FROM gozz.drive_files WHERE folder_id = $1 AND deleted_at IS NULL`,
    [folderId]
  );
  const taken = new Set(rows.map((r: any) => r.n));
  const candidato = (n: number) => (n === 0 ? `${base}${ext}` : `${base} (${n})${ext}`);
  if (!taken.has(candidato(0).toLowerCase())) return candidato(0);
  let n = 1;
  while (taken.has(candidato(n).toLowerCase())) n++;
  return candidato(n);
}

// Sniff MIME by extension (fallback when DB mime is null/octet-stream — frequent for Pipedrive imports).
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain", json: "application/json", html: "text/html", htm: "text/html",
  zip: "application/zip", rtf: "application/rtf",
  mp3: "audio/mpeg", mp4: "video/mp4", mov: "video/quicktime",
};
function resolveMime(filename: string, declared: string | null): string {
  if (declared && declared !== "application/octet-stream" && declared.includes("/")) return declared;
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  return EXT_TO_MIME[ext] || declared || "application/octet-stream";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB (techo único alineado con Notas/Pagos y nginx)
});

interface Folder {
  id: string;
  nombre: string;
  parent_id: string | null;
  tipo: string;
  owner_user_id: string | null;
  oportunidad_id: string | null;
}

async function getFolder(id: string): Promise<Folder | null> {
  const rows = await query<Folder>("SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getAncestors(folderId: string): Promise<Folder[]> {
  // Ancestros recursivos (incluye la carpeta misma).
  const rows = await query<Folder>(
    `WITH RECURSIVE chain AS (
       SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id, 0 AS depth
         FROM gozz.drive_folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.nombre, f.parent_id, f.tipo, f.owner_user_id, f.oportunidad_id, c.depth+1
         FROM gozz.drive_folders f
         JOIN chain c ON c.parent_id = f.id
     )
     SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM chain ORDER BY depth DESC`,
    [folderId]
  );
  return rows;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// T5 · COMPARTIR — la única excepción a «nadie entra en el Mi Drive ajeno»
//
// Esa regla es la más dura que tiene el Drive y sigue siendo la puerta por defecto. Lo que hace
// esta pieza es abrirla para UNA persona concreta y nada más: la nombrada en `compartido_con`.
//
// 🔴 UN ADMIN NO ENTRA POR AQUÍ. Preguntado expresamente el 2026-08-24 y respondido: «no,
// solamente el destinatario». Como la comprobación del Mi Drive ajeno va ANTES del atajo de
// admin, un admin sin compartición recibe el mismo 403 que cualquiera. No es un efecto lateral:
// es el orden que hace que la decisión se cumpla.
//
// ⚠️ ES RECURSIVO POR LA CADENA DE ANCESTROS, no por la carpeta suelta. Compartir una carpeta
// comparte lo que hay dentro, incluidas las subcarpetas que se creen DESPUÉS — que es lo que se
// pidió y lo que espera cualquiera que haya usado Drive. Por eso se consulta con la cadena
// entera y no con un id.
// ══════════════════════════════════════════════════════════════════════════════════════════════
type PermisoCompartido = "lector" | "editor";

/**
 * El permiso que `userId` tiene sobre alguna de estas carpetas por compartición, o `null`.
 *
 * Si hay varias —una carpeta compartida como lector dentro de otra compartida como editor— gana
 * la MÁS PERMISIVA. Es lo que espera quien comparte: dar acceso de edición a un árbol y que una
 * subcarpeta de dentro lo recorte sería una sorpresa, y encima silenciosa.
 */
async function permisoCompartidoEnCadena(userId: string, folderIds: string[]): Promise<PermisoCompartido | null> {
  if (!folderIds.length) return null;
  const r = await query<any>(
    `SELECT permiso FROM gozz.drive_comparticiones
      WHERE compartido_con = $1 AND folder_id = ANY($2::uuid[])
      ORDER BY (permiso = 'editor') DESC
      LIMIT 1`,
    [userId, folderIds]
  );
  return (r[0]?.permiso as PermisoCompartido) ?? null;
}

/** El permiso que `userId` tiene sobre ESTE archivo por compartición directa, o `null`. */
async function permisoCompartidoDeArchivo(userId: string, fileId: string): Promise<PermisoCompartido | null> {
  const r = await query<any>(
    "SELECT permiso FROM gozz.drive_comparticiones WHERE compartido_con = $1 AND file_id = $2 LIMIT 1",
    [userId, fileId]
  );
  return (r[0]?.permiso as PermisoCompartido) ?? null;
}

/**
 * 🔴 EL ÁMBITO DE UN DESTACADO SE DERIVA DE DÓNDE VIVE LA COSA, NUNCA SE ACEPTA DEL CLIENTE.
 *
 * Bajo la rama de la compañía → `compania`, que lo ve todo el equipo. En cualquier otro sitio →
 * `personal`, que no lo ve nadie más. Aceptarlo del cuerpo dejaría publicar el NOMBRE de una
 * carpeta privada a los quince de la empresa con un campo mal puesto.
 *
 * `personal` es el valor por defecto a propósito: ante la duda, lo que no se comparte.
 */
async function ambitoDeDestacado(folderId: string): Promise<"compania" | "personal"> {
  const cadena = await getAncestors(folderId);
  return cadena.some((f) => f.tipo === "company") ? "compania" : "personal";
}

/**
 * Cuántos «recientes» se guardan por persona, y cuántos días.
 *
 * Decisión de Juan del 2026-08-24. Sin tope, registrar cada apertura sobre ~189.000 archivos y
 * quince personas convierte esto en la tabla más grande del sistema en un año — para enseñar
 * veinte líneas en un panel.
 */
const MAX_RECIENTES = 200;
const DIAS_RECIENTES = 90;

/**
 * Anota que esta persona ha abierto este archivo, y poda lo que sobra de SUS filas.
 *
 * 🔴 NUNCA LANZA. Es una comodidad de navegación: si falla, lo que no puede pasar es que se caiga
 * la descarga de un archivo que por lo demás iba bien. Se registra en consola y se sigue.
 *
 * ⚠️ SE ESPERA (`await`), no se lanza y se olvida. Con `void` la respuesta salía antes de que la
 * poda terminara: el efecto quedaba a merced de la carrera —y una prueba lo cazó contando 206
 * filas donde debía haber 200—. Son dos consultas indexadas sobre un par de cientos de filas,
 * despreciable frente a servir el archivo, y a cambio el comportamiento es el mismo siempre.
 *
 * La poda va aquí y no en un proceso de fondo: un bucle que hay que acordarse de encender es un
 * bucle que un día está apagado y nadie lo nota hasta que la tabla pesa. Toca solo las filas de
 * esta persona —unos cientos, indexadas por `(user_id, visto_at DESC)`—, así que es barato.
 */
async function anotarReciente(userId: string, fileId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO gozz.drive_recientes (user_id, file_id, visto_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, file_id) DO UPDATE SET visto_at = now()`,
      [userId, fileId]
    );
    await query(
      `DELETE FROM gozz.drive_recientes
        WHERE user_id = $1
          AND (visto_at < now() - interval '${DIAS_RECIENTES} days'
               OR file_id NOT IN (
                 SELECT file_id FROM gozz.drive_recientes
                  WHERE user_id = $1 ORDER BY visto_at DESC LIMIT ${MAX_RECIENTES}))`,
      [userId]
    );
  } catch (e: any) {
    console.error("[drive recientes] no se pudo anotar:", e?.message);
  }
}

/**
 * ¿Esta carpeta cuelga del «Mi unidad» de ESTA persona?
 *
 * 🔴 SIN ATAJO DE ADMIN, a diferencia de `canEditFolder`. Es la puerta de quién puede repartir
 * accesos, y repartir accesos sobre el espacio personal de otra persona no es una atribución de
 * administrador: es una decisión de su dueño. Si algún día hiciera falta que un admin revoque una
 * compartición ajena, será una herramienta aparte y una decisión que se pregunta.
 */
async function esMiRama(userId: string, folderId: string): Promise<boolean> {
  const cadena = await getAncestors(folderId);
  const mia = cadena.find((f) => f.tipo === "user");
  return !!(mia && mia.owner_user_id === userId);
}

/** Lo que hay que saber de lo que se va a compartir, sea carpeta o archivo. */
type ObjetivoCompartible =
  | { ok: true; folder_id: string | null; file_id: string | null; folderId: string }
  | { ok: false; estado: number; error: string };

/**
 * Resuelve el objetivo de una compartición a partir de `folder_id` **o** `file_id`.
 *
 * `folderId` es la carpeta que MANDA para decidir de quién es: la propia si se comparte una
 * carpeta, y la que contiene al archivo si se comparte un archivo suelto. Sin esa distinción
 * habría que repetir el `if` en los cinco endpoints, y el quinto acabaría no teniéndolo.
 */
async function resolverObjetivoCompartible(folderRaw: any, fileRaw: any): Promise<ObjetivoCompartible> {
  const folderId = folderRaw ? String(folderRaw) : "";
  const fileId = fileRaw ? String(fileRaw) : "";
  // Una cosa o la otra. Las dos a la vez sería ambiguo, y ninguna no dice nada — el mismo criterio
  // que el CHECK de la tabla, aquí arriba para responder 400 en vez de dejar que reviente la base.
  if (!!folderId === !!fileId) return { ok: false, estado: 400, error: "objetivo_invalido" };

  if (folderId) {
    if (!UUID_RE.test(folderId)) return { ok: false, estado: 400, error: "objetivo_invalido" };
    const f = await getFolder(folderId);
    if (!f || (f as any).deleted_at) return { ok: false, estado: 404, error: "not_found" };
    return { ok: true, folder_id: folderId, file_id: null, folderId };
  }

  if (!UUID_RE.test(fileId)) return { ok: false, estado: 400, error: "objetivo_invalido" };
  const a = (await query<any>(
    "SELECT id, folder_id FROM gozz.drive_files WHERE id = $1 AND deleted_at IS NULL", [fileId]
  ))[0];
  if (!a) return { ok: false, estado: 404, error: "not_found" };
  return { ok: true, folder_id: null, file_id: fileId, folderId: String(a.folder_id) };
}

/**
 * La carpeta que decide de quién es una compartición ya existente.
 *
 * Devuelve `"no_existe"` si la fila no está —que es un 404— y `null` si está pero su archivo ya no
 * —que es un 403, no un 404: la fila existe, simplemente no hay forma de comprobar el dueño—.
 * Distinguirlas importa: un 404 en la primera diría «esto nunca existió», que es falso.
 */
async function carpetaDeComparticion(id: string): Promise<string | null | "no_existe"> {
  if (!UUID_RE.test(id)) return "no_existe";
  const c = (await query<any>(
    "SELECT folder_id, file_id FROM gozz.drive_comparticiones WHERE id = $1", [id]
  ))[0];
  if (!c) return "no_existe";
  if (c.folder_id) return String(c.folder_id);
  const a = (await query<any>("SELECT folder_id FROM gozz.drive_files WHERE id = $1", [c.file_id]))[0];
  return a ? String(a.folder_id) : null;
}

/**
 * ¿Puede este usuario con ESTE archivo?
 *
 * Primero por su carpeta, que es el camino de siempre. Si por ahí no, se mira si el archivo está
 * compartido **suelto**: se decidió el 2026-08-24 que se comparten «carpetas y archivos sueltos»,
 * y un archivo compartido cuya carpeta no lo está es justo el caso que la comprobación por
 * carpeta no puede ver.
 *
 * 🔴 Se conserva el motivo del rechazo de la carpeta. El de aquí no aporta nada nuevo, y perder
 * `forbidden_solo_lectura` convertiría un «puedes mirar pero no cambiar» en un «no puedes entrar».
 */
async function canAccessFile(
  user: { sub: string; nivel: string },
  file: { id: string; folder_id: string },
  mode: "read" | "write"
): Promise<{ ok: boolean; reason?: string }> {
  const porCarpeta = await canAccessFolder(user, file.folder_id, mode);
  if (porCarpeta.ok) return { ok: true };
  if (alcanza(await permisoCompartidoDeArchivo(user.sub, file.id), mode)) return { ok: true };
  return { ok: false, reason: porCarpeta.reason };
}

/** ¿Alcanza este permiso para lo que se quiere hacer? `lector` no escribe. */
const alcanza = (p: PermisoCompartido | null, mode: "read" | "write"): boolean =>
  p === "editor" || (p === "lector" && mode === "read");

async function canAccessFolder(
  user: { sub: string; nivel: string },
  folderId: string,
  mode: "read" | "write"
): Promise<{ ok: boolean; reason?: string; folder?: Folder }> {
  const folder = await getFolder(folderId);
  if (!folder) return { ok: false, reason: "not_found" };
  const isAdmin = user.nivel === "super_admin" || user.nivel === "admin";

  // Universal: NADIE accede al drive personal ajeno (ni admins) — salvo que se lo hayan
  // COMPARTIDO (T5). La excepción es nominal: vale para la persona nombrada y para nadie más,
  // admins incluidos, y por eso se resuelve aquí arriba y no después del atajo de admin.
  const chainCheck = await getAncestors(folderId);
  const ownerUser = chainCheck.find((f) => f.tipo === "user");
  if (ownerUser && ownerUser.owner_user_id !== user.sub) {
    const compartido = await permisoCompartidoEnCadena(user.sub, chainCheck.map((f) => f.id));
    if (!compartido) return { ok: false, reason: "forbidden_user_folder", folder };
    // Compartida como LECTOR: se ve, no se toca. Un motivo propio y no `forbidden_user_folder`,
    // porque «no puedes entrar» y «puedes mirar pero no cambiar» no son lo mismo y la pantalla
    // tiene que poder decir cuál de las dos.
    if (!alcanza(compartido, mode)) return { ok: false, reason: "forbidden_solo_lectura", folder };
    return { ok: true, folder };
  }

  if (isAdmin) return { ok: true, folder };

  const chain = chainCheck;
  const scope = chain.find((f) => ["user", "opportunity", "company", "root"].includes(f.tipo));
  const top = chain[chain.length - 1]; // la carpeta misma
  const under = chain;

  // Carpeta de usuario (o descendiente): sólo el dueño.
  const userFolder = under.find((f) => f.tipo === "user");
  if (userFolder) {
    if (userFolder.owner_user_id === user.sub) return { ok: true, folder };
    return { ok: false, reason: "forbidden_user_folder", folder };
  }

  // Carpeta de oportunidad (o descendiente): sólo gente vinculada.
  const opFolder = under.find((f) => f.tipo === "opportunity");
  if (opFolder && opFolder.oportunidad_id) {
    // Acceso abierto: todos ven Y suben documentos a las oportunidades.
    return { ok: true, folder };
  }

  // Carpeta compañía: todos leen, sólo admin escribe.
  const isCompanyBranch = under.some((f) => f.tipo === "company");
  if (isCompanyBranch) {
    if (mode === "read") return { ok: true, folder };
    return { ok: false, reason: "forbidden_company_write", folder };
  }

  // users_root / opportunities_root / root: lectura permitida (sólo ven estructura), escritura bloqueada.
  if (mode === "read") return { ok: true, folder };
  return { ok: false, reason: "forbidden_structural", folder };
}

// Devuelve la lista completa de carpetas visibles por el usuario, ya filtrada.
// ============================================================================================
// T1 · EL ESCONDITE DE LAS RAMAS DE CLIENTES — orden visual, NO autorización
//
// Pedido en la reunión del 2026-08-24: la raíz del Drive le enseñaba a todo el equipo cinco ramas
// de datos de clientes (las 269 carpetas de contacto que cuelgan de la compañía, `Trámites`, y los
// tres árboles de importación de Bitrix/Pipedrive/Zoho). Para llegar a los archivos de un cliente
// se entra por SU FICHA; tenerlos también aquí es ruido, y con 12.000 carpetas es mucho ruido.
//
// 🔴 ESTO NO ES UNA BARRERA Y NO SE PUEDE CONTAR COMO TAL. `canAccessFolder` no cambia ni una
// línea: quien pida una de esas carpetas POR SU ID la sigue recibiendo, exactamente igual que
// ayer. Lo único que cambia es que dejan de aparecer al ENUMERAR. La frase honesta es "no las
// tienen delante", nunca "no pueden verlas". Si algún día se quiere lo segundo, es otro trabajo y
// se toca otra función.
//
// 🔴 LA REGLA APLICA AL DESCENDER, NUNCA AL CAMINO PEDIDO. La pestaña Documentos de una
// negociación monta este mismo `DriveBrowser` y pide `/tree/path?folder_id=<carpeta de la
// oportunidad>`, cuya cadena de ancestros pasa por `Trámites` — que es justo una de las ramas
// escondidas. Si el escondite se aplicara al camino, esa pantalla se quedaría sin árbol y sin
// migas de pan, y el equipo perdería el acceso a los documentos de sus casos. De ahí `exentos`:
// los nodos del camino solicitado no se ocultan jamás.
//
// POR QUÉ ES UN FILTRO APARTE Y NO UN MODO MÁS DE LA MÁQUINA DE ESTADOS: la visibilidad del árbol
// ya vive replicada en CUATRO sitios (`visibleFolders`, `visibleChildren`, `computeSeedMode`,
// `VIS_SUBTREE_CTE`) más una quinta copia porteada dentro de `scripts/verificar-arbol-lazy.mjs`.
// Meterle un caso ortogonal a esa máquina es la forma más rápida de que las cinco dejen de decir
// lo mismo, que es el defecto que describe CONVENCIONES §4.8. Este filtro se compone ENCIMA, y es
// una sola frase que se puede escribir igual en JS y en SQL.
// ============================================================================================

/** Los únicos hijos de la raíz que se enumeran. Todo lo demás que cuelgue de ahí es de clientes. */
const TIPOS_RAIZ_VISIBLES = new Set(["company", "users_root"]);

/**
 * Id centinela del nodo agrupador «Drive Contactos». **No existe en la base.** No tiene forma de
 * uuid a propósito: así no puede chocar con ninguna carpeta real ni colarse en una consulta que
 * espere un uuid (ahí reventaría con un error de tipo, que es justo lo que se quiere).
 */
export const ID_NODO_CONTACTOS = "virtual:contactos";
const NOMBRE_NODO_CONTACTOS = "Drive Contactos";

/** Sólo el super_admin navega las ramas de clientes desde el árbol. Ver la nota de `admin` abajo. */
function veRamasDeClientes(u: { nivel: string }): boolean {
  // ⚠️ Deliberadamente NO incluye `admin`. Hoy hay 1 super_admin y 6 admin, y los seis dejan de
  // ver estas ramas en el árbol. Es lo que se pidió el 2026-08-24. Abrirlo a `admin` es cambiar
  // esta línea y nada más — está en un solo sitio por eso.
  return u.nivel === "super_admin";
}

/**
 * ¿Se oculta un hijo de tipo `hijoTipo` al enumerar los hijos de una carpeta de tipo `padreTipo`?
 *
 * Se aplica a TODO EL MUNDO, incluido el super_admin: a él las ramas no se le quitan, se le
 * reagrupan bajo `ID_NODO_CONTACTOS`. Si aquí se le hiciera una excepción, las vería dos veces.
 */
function ocultoAlEnumerar(padreTipo: string, hijoTipo: string): boolean {
  if (padreTipo === "root") return !TIPOS_RAIZ_VISIBLES.has(hijoTipo);
  return hijoTipo === "contact";
}

/**
 * El mismo `ocultoAlEnumerar`, en SQL, para las consultas que enumeran hijos.
 * `pExentos` es el parámetro con los ids del camino pedido, que nunca se ocultan.
 */
function sqlEscondite(padreTipo: string, pExentos: string, alias: string): string {
  const cond =
    padreTipo === "root"
      ? `${alias}.tipo NOT IN ('company','users_root')`
      : `${alias}.tipo = 'contact'`;
  return `AND (${alias}.id = ANY(${pExentos}::uuid[]) OR NOT (${cond}))`;
}

/**
 * Poda las ramas de clientes de un listado plano de carpetas (el endpoint legacy
 * `/api/drive/tree` y la copia porteada del harness). Quita las raíces escondidas Y sus
 * descendientes: dejar un descendiente cuyo ancestro se fue produce un árbol huérfano.
 *
 * 🔴 SE PODA PARA TODO EL MUNDO, SUPER_ADMIN INCLUIDO, igual que `ocultoAlEnumerar`. Tentaba
 * dejarle el árbol entero al super_admin, y sería un error: `scripts/verificar-arbol-lazy.mjs`
 * existe para comprobar que ESTA función y el árbol lazy ven exactamente lo mismo, y con una
 * excepción por rol dejarían de verlo — el harness se pondría rojo con razón. Al super_admin las
 * ramas no se le quitan: se le reagrupan bajo `ID_NODO_CONTACTOS`.
 *
 * ⚠️ La ÚNICA excepción por rol de todo el escondite vive en el buscador (`VIS_SUBTREE_CTE`, $5),
 * y está ahí porque buscar no es recorrer un árbol. Es una excepción, en un sitio, escrita.
 */
function podarRamasDeClientes(folders: Folder[]): Folder[] {
  const rootId = folders.find((f) => f.tipo === "root")?.id ?? null;
  const semillas: string[] = [];
  for (const f of folders) {
    if (rootId && f.parent_id === rootId && !TIPOS_RAIZ_VISIBLES.has(f.tipo)) semillas.push(f.id);
    else if (f.tipo === "contact") semillas.push(f.id);
  }
  if (!semillas.length) return folders;

  const hijosPorPadre = new Map<string, Folder[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const arr = hijosPorPadre.get(f.parent_id);
    if (arr) arr.push(f);
    else hijosPorPadre.set(f.parent_id, [f]);
  }
  const fuera = new Set<string>();
  const pila = [...semillas];
  while (pila.length) {
    const id = pila.pop()!;
    if (fuera.has(id)) continue;                    // ya visto → corta ciclos y repetidos
    fuera.add(id);
    for (const h of hijosPorPadre.get(id) ?? []) pila.push(h.id);
  }
  return folders.filter((f) => !fuera.has(f.id));
}

/**
 * Los hijos del nodo virtual «Drive Contactos»: exactamente lo que `ocultoAlEnumerar` quita de la
 * raíz y de la compañía, reunido en un solo sitio. Las ramas primero y los contactos después, que
 * es como se lee — primero los cajones grandes, luego las fichas.
 *
 * Sólo lo llama el camino que ya comprobó `veRamasDeClientes`. No repite esa comprobación aquí a
 * propósito: una función que decide y además autoriza acaba usándose sin la segunda mitad.
 */
async function hijosDelNodoContactos(opts: { page: number; pageSize: number; q: string | null }): Promise<{ children: any[]; total: number }> {
  const offset = (opts.page - 1) * opts.pageSize;
  const rows = await query<any>(
    `WITH raiz AS (SELECT id FROM gozz.drive_folders WHERE tipo='root' AND deleted_at IS NULL LIMIT 1),
          comp AS (SELECT id FROM gozz.drive_folders WHERE tipo='company' AND deleted_at IS NULL)
     SELECT f.id, f.nombre, f.parent_id, f.tipo, f.owner_user_id, f.oportunidad_id,
            EXISTS(
              SELECT 1 FROM gozz.drive_folders cf
               WHERE cf.parent_id = f.id AND cf.deleted_at IS NULL
            ) AS has_children,
            count(*) OVER() AS total
       FROM gozz.drive_folders f
      WHERE f.deleted_at IS NULL
        AND ( (f.parent_id = (SELECT id FROM raiz) AND f.tipo NOT IN ('company','users_root'))
           OR (f.parent_id IN (SELECT id FROM comp) AND f.tipo = 'contact') )
        AND ($1::text IS NULL OR lower(f.nombre) LIKE '%' || lower($1) || '%')
      ORDER BY (f.tipo = 'contact'), f.nombre, f.id
      LIMIT $2 OFFSET $3`,
    [opts.q, opts.pageSize, offset]
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { children: rows.map(({ total: _t, ...rest }: any) => rest), total };
}

/** La fila con que el nodo virtual se presenta en el árbol. Su `parent_id` es la raíz REAL. */
function filaNodoContactos(rootId: string | null, tieneHijos: boolean) {
  return {
    id: ID_NODO_CONTACTOS,
    nombre: NOMBRE_NODO_CONTACTOS,
    parent_id: rootId,
    tipo: "virtual_contactos",
    owner_user_id: null,
    oportunidad_id: null,
    has_children: tieneHijos,
  };
}

async function visibleFolders(user: { sub: string; nivel: string }): Promise<Folder[]> {
  // Excluir carpetas en papelera (deleted_at IS NOT NULL)
  const all = await query<Folder>(
    "SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE deleted_at IS NULL",
    []
  );
  const isAdmin = user.nivel === "super_admin" || user.nivel === "admin";

  // Comportamiento universal: NADIE ve user folders ajenas (ni admin).
  // El admin ve todo lo demás (incluso oportunidades a las que no está vinculado).
  if (isAdmin) {
    const filtered = all.filter((f) => {
      if (f.tipo !== "user") return true;
      return f.owner_user_id === user.sub;
    });
    // También excluir descendientes de user folders ajenas
    const byId = new Map(filtered.map((f) => [f.id, f]));
    const sinAjenas = filtered.filter((f) => {
      let cur: Folder | undefined = f;
      const visited = new Set<string>();
      while (cur?.parent_id) {
        if (visited.has(cur.id)) return false;      // ciclo (datos corruptos) → cortar
        visited.add(cur.id);
        if (!byId.has(cur.parent_id)) return false; // ancestro filtrado → este también
        cur = byId.get(cur.parent_id);
      }
      return true;
    });
    // T1 · se poda para TODO EL MUNDO, super_admin incluido. Ver la nota de `podarRamasDeClientes`.
    return podarRamasDeClientes(sinAjenas);
  }

  // Sets: carpetas permitidas al usuario.
  const opIds = (await query<any>(
    `SELECT id FROM gozz.oportunidades
      WHERE preparador_id=$1 OR vendedor_id=$1 OR manager_preparacion_id=$1 OR
            manager_ventas_id=$1 OR supervisor_id=$1`,
    [user.sub]
  )).map((r) => r.id);

  const allowed = new Set<string>();
  const byId = new Map(all.map((f) => [f.id, f]));

  // Índice padre -> hijos, construido UNA sola vez. Reemplaza el recorrido
  // de `all` por cada nodo en addDescendants (O(n^2) -> O(n)).
  const childrenByParent = new Map<string, Folder[]>();
  for (const f of all) {
    if (!f.parent_id) continue;
    const arr = childrenByParent.get(f.parent_id);
    if (arr) arr.push(f);
    else childrenByParent.set(f.parent_id, [f]);
  }

  const addAncestors = (id: string) => {
    let cur: Folder | undefined = byId.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur.id)) break;               // ciclo → cortar
      visited.add(cur.id);
      allowed.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  };
  const addDescendants = (id: string) => {
    const stack = [id];
    const visited = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;               // ya procesado → corta ciclos y repetidos
      visited.add(cur);
      allowed.add(cur);
      const kids = childrenByParent.get(cur);       // O(1) en vez de O(n)
      if (kids) for (const f of kids) stack.push(f.id);
    }
  };

  // Helper: true si la carpeta cae bajo un user folder ajeno.
  const isUnderForeignUser = (id: string): boolean => {
    let cur: Folder | undefined = byId.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur.id)) return false;        // ciclo → cortar
      visited.add(cur.id);
      if (cur.tipo === "user") return cur.owner_user_id !== user.sub;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };

  for (const f of all) {
    if (f.tipo === "root" || f.tipo === "users_root" || f.tipo === "opportunities_root") {
      allowed.add(f.id);
    }
    if (f.tipo === "company") {
      // compañía y descendientes visibles (read-only).
      addDescendants(f.id);
    }
    if (f.tipo === "user" && f.owner_user_id === user.sub) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
    if (f.tipo === "opportunity" && f.oportunidad_id && opIds.includes(f.oportunidad_id)) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
    // Custom folders: visibles a todos read-only si NO están bajo un user folder ajeno
    // (cubre "Trámites Pipedrive" y descendientes; bloquea customs personales).
    if (f.tipo === "custom" && !isUnderForeignUser(f.id)) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
  }
  // T1 · se poda al final, sobre el conjunto ya resuelto. Aplicarlo antes obligaría a repetir la
  // condición dentro de cada `addDescendants`, que es como divergen las copias de una regla.
  const visibles = all.filter((f) => allowed.has(f.id));
  return podarRamasDeClientes(visibles);
}

// ======== Árbol lazy (3B): visibilidad por-nodo — RÉPLICA EXACTA de visibleFolders ========
// Regla (idéntica a visibleFolders, evaluada sin cargar el grafo entero):
//   - admin: ve todo salvo Mi Drive ajeno (tipo='user' de otro) y sus descendientes (no se expanden → no aparecen).
//   - no-admin: COMPUERTAS solo en los roots estructurales:
//       * users_root         → solo el propio Mi Drive (+ customs, que no están bajo user ajeno).
//       * opportunities_root → solo las oportunidades VINCULADAS (opIds) (+ customs).
//     Dentro de cualquier otro nodo permitido (company/mi-user/opp-vinculada/custom y sus descendientes),
//     TODOS los hijos son visibles (salvo Mi Drive ajeno, que solo cuelga de users_root).
// La equivalencia con visibleFolders está probada caso-por-caso y se verifica con scripts/verificar-arbol-lazy.mjs.
async function treeVisContext(u: { sub: string; nivel: string }): Promise<{ isAdmin: boolean; sub: string; opIds: string[] }> {
  const isAdmin = u.nivel === "super_admin" || u.nivel === "admin";
  const opIds = isAdmin ? [] : (await query<any>(
    `SELECT id FROM gozz.oportunidades
      WHERE preparador_id=$1 OR vendedor_id=$1 OR manager_preparacion_id=$1 OR manager_ventas_id=$1 OR supervisor_id=$1`,
    [u.sub]
  )).map((r) => r.id);
  return { isAdmin, sub: u.sub, opIds };
}

// Hijos directos VISIBLES de `parent` (paginado, "cargar más"), cada uno con has_children calculado SOBRE
// hijos visibles (no el conteo crudo — clave para las compuertas vacías, p.ej. opportunities_root sin vinculadas).
// El filtro de visibilidad va en SQL → count(*) OVER() y LIMIT/OFFSET correctos.
//
// OPCIÓN A — se REPLICA el "leak" de visibleFolders: la regla `custom && !isUnderForeignUser → addAncestors +
// addDescendants` hace visible cualquier custom Y su cadena de ancestros. Como las secciones de una oportunidad son
// tipo='custom', una oportunidad NO vinculada que tenga un custom en su subárbol (y ese custom) quedan visibles.
// Reglas por-nodo para no-admin (equivalentes, probadas contra el harness):
//   * bajo opportunities_root: opp visible si (vinculada) o (su subárbol tiene un custom);  customs directos → sí.
//   * bajo una opp NO-vinculada (visible solo por el leak): hijo visible si su subárbol tiene un custom.
//   * bajo cualquier otro nodo permitido (opp vinculada / custom / company / contact / …): todos los hijos.
// "subárbol tiene un custom" se resuelve con el CTE `leads` (custom o ancestro-de-custom) scopeado al subárbol de
// opportunities_root (barato), y SOLO se usa en los 3 casos que lo necesitan (root, opportunities_root, opp
// no-vinculada); admin y el resto de padres usan la query simple. has_children se calcula con estas mismas reglas.
async function visibleChildren(
  parent: Folder,
  ctx: { isAdmin: boolean; sub: string; opIds: string[] },
  opts: { page: number; pageSize: number; q: string | null; exentos?: string[] }
): Promise<{ children: any[]; total: number }> {
  const offset = (opts.page - 1) * opts.pageSize;
  // T1 · los nodos del camino pedido no se ocultan nunca (ver el bloque del escondite).
  const exentos = opts.exentos ?? [];

  const isUnlinkedOpp = parent.tipo === "opportunity" && parent.oportunidad_id != null && !ctx.opIds.includes(parent.oportunidad_id);
  const needLeads = !ctx.isAdmin && (parent.tipo === "root" || parent.tipo === "opportunities_root" || isUnlinkedOpp);

  let rows: any[];
  if (!needLeads) {
    // Query simple: admin (ve todo salvo Mi Drive ajeno) y no-admin bajo padres "normales" (sin compuertas/leak).
    // has_children = EXISTS un hijo visible (mismo filtro de Mi Drive ajeno).
    rows = await query<any>(
      `SELECT f.id, f.nombre, f.parent_id, f.tipo, f.owner_user_id, f.oportunidad_id,
              EXISTS(
                SELECT 1 FROM gozz.drive_folders cf
                 WHERE cf.parent_id = f.id AND cf.deleted_at IS NULL
                   AND (cf.tipo <> 'user' OR cf.owner_user_id = $2)
                   AND cf.tipo <> 'contact'
              ) AS has_children,
              count(*) OVER() AS total
         FROM gozz.drive_folders f
        WHERE f.parent_id = $1 AND f.deleted_at IS NULL
          AND (f.tipo <> 'user' OR f.owner_user_id = $2)
          ${sqlEscondite(parent.tipo, "$6", "f")}
          AND ($3::text IS NULL OR lower(f.nombre) LIKE '%' || lower($3) || '%')
        ORDER BY f.tipo, f.nombre, f.id
        LIMIT $4 OFFSET $5`,
      [parent.id, ctx.sub, opts.q, opts.pageSize, offset, exentos]
    );
  } else {
    // Query con leak (no-admin): CTE `leads` = subárbol-tiene-custom dentro del subárbol de opportunities_root.
    // FILTER: solo opportunities_root y opp no-vinculada restringen; root no restringe (sus hijos son estructurales),
    // pero necesita `leads` para el has_children de su hijo opportunities_root.
    const filter =
      parent.tipo === "opportunities_root"
        ? `AND (f.tipo <> 'opportunity' OR f.oportunidad_id = ANY($3::uuid[]) OR f.id IN (SELECT id FROM leads))`
        : isUnlinkedOpp
        ? `AND (f.id IN (SELECT id FROM leads))`
        : ``; // parent = root → sin restricción de hijos
    rows = await query<any>(
      `WITH RECURSIVE opps_sub AS (
         SELECT id, parent_id, tipo FROM gozz.drive_folders WHERE tipo='opportunities_root' AND deleted_at IS NULL
         UNION
         SELECT c.id, c.parent_id, c.tipo FROM gozz.drive_folders c JOIN opps_sub ON c.parent_id = opps_sub.id WHERE c.deleted_at IS NULL
       ),
       leads AS (
         SELECT id, parent_id FROM opps_sub WHERE tipo='custom'
         UNION
         SELECT s.id, s.parent_id FROM opps_sub s JOIN leads ON s.id = leads.parent_id
       )
       SELECT f.id, f.nombre, f.parent_id, f.tipo, f.owner_user_id, f.oportunidad_id,
              EXISTS(
                SELECT 1 FROM gozz.drive_folders cf
                 WHERE cf.parent_id = f.id AND cf.deleted_at IS NULL
                   AND (cf.tipo <> 'user' OR cf.owner_user_id = $2)
                   AND cf.tipo <> 'contact'
                   AND CASE
                         WHEN f.tipo = 'opportunities_root'
                           THEN (cf.tipo <> 'opportunity' OR cf.oportunidad_id = ANY($3::uuid[]) OR cf.id IN (SELECT id FROM leads))
                         WHEN f.tipo = 'opportunity' AND NOT (f.oportunidad_id = ANY($3::uuid[]))
                           THEN (cf.id IN (SELECT id FROM leads))
                         ELSE true
                       END
              ) AS has_children,
              count(*) OVER() AS total
         FROM gozz.drive_folders f
        WHERE f.parent_id = $1 AND f.deleted_at IS NULL
          AND (f.tipo <> 'user' OR f.owner_user_id = $2)
          ${sqlEscondite(parent.tipo, "$7", "f")}
          ${filter}
          AND ($4::text IS NULL OR lower(f.nombre) LIKE '%' || lower($4) || '%')
        ORDER BY f.tipo, f.nombre, f.id
        LIMIT $5 OFFSET $6`,
      [parent.id, ctx.sub, ctx.opIds, opts.q, opts.pageSize, offset, exentos]
    );
  }
  const total = rows.length ? Number(rows[0].total) : 0;
  const children = rows.map(({ total: _t, ...rest }: any) => rest);
  return { children, total };
}

// ======== Búsqueda scopeada (3C): visibilidad EXACTA del árbol dentro del subárbol de `scope` ========
// ¿el subárbol de folderId contiene algún custom? (para decidir el "leak" de una oportunidad no-vinculada)
async function subtreeHasCustom(folderId: string): Promise<boolean> {
  const r = await query<any>(
    `WITH RECURSIVE sub AS (
       SELECT id, tipo FROM gozz.drive_folders WHERE id = $1 AND deleted_at IS NULL
       UNION ALL
       SELECT c.id, c.tipo FROM gozz.drive_folders c JOIN sub ON c.parent_id = sub.id WHERE c.deleted_at IS NULL
     ) SELECT EXISTS(SELECT 1 FROM sub WHERE tipo = 'custom') AS has`,
    [folderId]
  );
  return !!r[0]?.has;
}

// Modo de visibilidad de `scope` = cómo se gatean SUS hijos, simulando el camino root→scope (barato, prof. ~6).
// Devuelve null si el scope está OCULTO para el usuario (Mi Drive ajeno u opp no-vinculada sin leak) → sin resultados.
//   admin → siempre 'open' (ve todo salvo Mi Drive ajeno). Los modos: open|gate_root|gate_users|gate_opps|leak.
async function computeSeedMode(chain: Folder[], ctx: { isAdmin: boolean; sub: string; opIds: string[] }): Promise<string | null> {
  if (ctx.isAdmin) {
    // admin: cualquier scope bajo un Mi Drive ajeno está bloqueado (canAccessFolder ya lo corta, pero por las dudas)
    if (chain.some((f) => f.tipo === "user" && f.owner_user_id !== ctx.sub)) return null;
    return "open";
  }
  let mode = "gate_root"; // modo de los HIJOS de la raíz; chain[0] = raíz
  for (let i = 1; i < chain.length; i++) {
    const node = chain[i];
    if (node.tipo === "user" && node.owner_user_id !== ctx.sub) return null; // Mi Drive ajeno
    if (mode === "open") { mode = "open"; continue; }
    if (mode === "gate_root") {
      mode = node.tipo === "company" ? "open" : node.tipo === "users_root" ? "gate_users" : node.tipo === "opportunities_root" ? "gate_opps" : "open";
      continue;
    }
    if (mode === "gate_users") { mode = "open"; continue; } // Mi Drive propio (ajeno ya cortado) o custom
    if (mode === "gate_opps") {
      if (node.tipo === "opportunity") {
        const linked = node.oportunidad_id != null && ctx.opIds.includes(node.oportunidad_id);
        if (linked) { mode = "open"; continue; }
        if (await subtreeHasCustom(node.id)) { mode = "leak"; continue; }
        return null; // opp no-vinculada sin leak → oculta
      }
      mode = "open"; continue; // custom bajo opportunities_root
    }
    if (mode === "leak") {
      if (await subtreeHasCustom(node.id)) { mode = node.tipo === "custom" ? "open" : "leak"; continue; }
      return null;
    }
  }
  return mode;
}

// CTE `vis` = carpetas VISIBLES del subárbol de $1=scope (con su $2=modo semilla), replicando childVisible.
// Para no-admin usa el CTE `leads` (subárbol-tiene-custom, scopeado a opportunities_root) para el gateo de opps.
// admin: seedMode='open' → recorre todo el subárbol salvo Mi Drive ajeno (leads queda inerte). $3=opIds, $4=sub.
const VIS_SUBTREE_CTE = `
WITH RECURSIVE opps_sub AS (
  SELECT id, parent_id, tipo FROM gozz.drive_folders WHERE tipo='opportunities_root' AND deleted_at IS NULL
  UNION
  SELECT c.id, c.parent_id, c.tipo FROM gozz.drive_folders c JOIN opps_sub ON c.parent_id = opps_sub.id WHERE c.deleted_at IS NULL
),
leads AS (
  SELECT id, parent_id FROM opps_sub WHERE tipo='custom'
  UNION
  SELECT s.id, s.parent_id FROM opps_sub s JOIN leads ON s.id = leads.parent_id
),
vis AS (
  SELECT f.id, f.nombre, f.parent_id, f.tipo, f.owner_user_id, f.oportunidad_id, $2::text AS mode
    FROM gozz.drive_folders f WHERE f.id = $1 AND f.deleted_at IS NULL
  UNION ALL
  SELECT c.id, c.nombre, c.parent_id, c.tipo, c.owner_user_id, c.oportunidad_id,
         CASE
           WHEN vis.mode = 'open' THEN 'open'
           WHEN vis.mode = 'gate_root' THEN
             CASE c.tipo WHEN 'company' THEN 'open' WHEN 'users_root' THEN 'gate_users' WHEN 'opportunities_root' THEN 'gate_opps' ELSE 'open' END
           WHEN vis.mode = 'gate_users' THEN 'open'
           WHEN vis.mode = 'gate_opps' THEN
             CASE WHEN c.tipo = 'opportunity' THEN (CASE WHEN c.oportunidad_id = ANY($3::uuid[]) THEN 'open' ELSE 'leak' END) ELSE 'open' END
           WHEN vis.mode = 'leak' THEN (CASE WHEN c.tipo = 'custom' THEN 'open' ELSE 'leak' END)
           ELSE 'open'
         END AS mode
    FROM gozz.drive_folders c JOIN vis ON c.parent_id = vis.id
   WHERE c.deleted_at IS NULL
     AND (c.tipo <> 'user' OR c.owner_user_id = $4)
     AND CASE
           WHEN vis.mode = 'gate_opps' AND c.tipo = 'opportunity' THEN (c.oportunidad_id = ANY($3::uuid[]) OR c.id IN (SELECT id FROM leads))
           WHEN vis.mode = 'leak' THEN (c.id IN (SELECT id FROM leads))
           ELSE true
         END
     -- T1 · el escondite de las ramas de clientes, aquí para que el BUSCADOR no devuelva lo que el
     -- árbol esconde. $5 = ve las ramas (super_admin) y entonces no poda nada. OJO: vis.tipo es
     -- el tipo del PADRE en este paso de la recursión, que es lo que distingue "hijo de la raíz"
     -- de todo lo demás. (Sin comillas invertidas: esto vive dentro de un template literal.)
     AND ($5::bool OR NOT (CASE WHEN vis.tipo = 'root' THEN c.tipo NOT IN ('company','users_root') ELSE c.tipo = 'contact' END))
)`;

async function resolveUserFolder(userId: string, createdBy: string): Promise<Folder> {
  const existing = await query<Folder>(
    "SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE tipo='user' AND owner_user_id=$1",
    [userId]
  );
  if (existing[0]) return existing[0];
  const usersRoot = await query<any>("SELECT id FROM gozz.drive_folders WHERE tipo='users_root' LIMIT 1", []);
  if (!usersRoot[0]) throw new Error("users_root no existe (correr migración 0024)");
  const u = await query<any>("SELECT nombre FROM gozz.users WHERE id=$1", [userId]);
  const nombre = u[0]?.nombre || "Usuario";
  const ins = await query<Folder>(
    "INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, owner_user_id, created_by) VALUES ($1,'user',$2,$3,$4) RETURNING id, nombre, parent_id, tipo, owner_user_id, oportunidad_id",
    [nombre, usersRoot[0].id, userId, createdBy]
  );
  return ins[0];
}

async function resolveOportunidadFolder(opId: string, createdBy: string): Promise<Folder> {
  const existing = await query<Folder>(
    "SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE tipo='opportunity' AND oportunidad_id=$1",
    [opId]
  );
  if (existing[0]) return existing[0];
  const opsRoot = await query<any>("SELECT id FROM gozz.drive_folders WHERE tipo='opportunities_root' LIMIT 1", []);
  if (!opsRoot[0]) throw new Error("opportunities_root no existe (correr migración 0024)");
  const op = await query<any>("SELECT nombre_caso FROM gozz.oportunidades WHERE id=$1", [opId]);
  if (!op[0]) throw new Error("oportunidad no encontrada");
  const nombre = op[0].nombre_caso || `Trámite ${opId.slice(0, 8)}`;
  const ins = await query<Folder>(
    "INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, oportunidad_id, created_by) VALUES ($1,'opportunity',$2,$3,$4) RETURNING id, nombre, parent_id, tipo, owner_user_id, oportunidad_id",
    [nombre, opsRoot[0].id, opId, createdBy]
  );
  return ins[0];
}

// ==================== Fase B1: ciclo de vida de archivos (papelera de 2 niveles) ====================

// origen_ref: mínimo para reubicar un archivo si su carpeta de origen desaparece. Best-effort; null lo que no resuelva.
async function resolverOrigenRef(folderId: string): Promise<any> {
  const fr = await query<any>(
    "SELECT id, tipo, seccion, oportunidad_id, contacto_id, parent_id FROM gozz.drive_folders WHERE id=$1",
    [folderId]
  );
  const f = fr[0];
  if (!f) return { folder_id: folderId, contacto_id: null, oportunidad_id: null, seccion: null, tipo: null };
  let contacto_id: string | null = f.contacto_id || null;
  if (!contacto_id && f.oportunidad_id) {
    const o = await query<any>("SELECT contacto_id FROM gozz.oportunidades WHERE id=$1", [f.oportunidad_id]);
    contacto_id = o[0]?.contacto_id || null;
  }
  if (!contacto_id && f.parent_id) {
    // walk-up hasta la primera carpeta de contacto con contacto_id
    const anc = await query<any>(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id, tipo, contacto_id FROM gozz.drive_folders WHERE id=$1
         UNION ALL
         SELECT p.id, p.parent_id, p.tipo, p.contacto_id FROM gozz.drive_folders p JOIN up ON p.id = up.parent_id
       )
       SELECT contacto_id FROM up WHERE tipo='contact' AND contacto_id IS NOT NULL LIMIT 1`,
      [folderId]
    );
    contacto_id = anc[0]?.contacto_id || null;
  }
  return { folder_id: f.id, contacto_id, oportunidad_id: f.oportunidad_id || null, seccion: f.seccion || null, tipo: f.tipo || null };
}

// Carpeta de contacto → sección General (find contacto; find-or-create General). null si el contacto no tiene carpeta.
async function resolveContactGeneral(contactoId: string, createdBy: string): Promise<string | null> {
  const cf = await query<any>(
    "SELECT id FROM gozz.drive_folders WHERE tipo='contact' AND contacto_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
    [contactoId]
  );
  if (!cf[0]) return null;
  const gen = await query<any>(
    "SELECT id FROM gozz.drive_folders WHERE parent_id=$1 AND seccion='general' AND deleted_at IS NULL LIMIT 1",
    [cf[0].id]
  );
  if (gen[0]) return gen[0].id;
  const ins = await query<any>(
    "INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, seccion, created_by) VALUES ('General','custom',$1,'general',$2) RETURNING id",
    [cf[0].id, createdBy]
  );
  return ins[0].id;
}

// Carpeta de sistema company-level "Sin ubicación (reasignar)" — find-or-create, idempotente (una por company).
async function resolveSinUbicacionFolder(createdBy: string): Promise<string> {
  const company = await query<any>("SELECT id FROM gozz.drive_folders WHERE tipo='company' AND deleted_at IS NULL LIMIT 1", []);
  if (!company[0]) throw new Error("carpeta company no existe (correr migración 0024)");
  const NOMBRE = "Sin ubicación (reasignar)";
  const ex = await query<any>(
    "SELECT id FROM gozz.drive_folders WHERE parent_id=$1 AND tipo='custom' AND nombre=$2 AND deleted_at IS NULL LIMIT 1",
    [company[0].id, NOMBRE]
  );
  if (ex[0]) return ex[0].id;
  const ins = await query<any>(
    "INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, created_by) VALUES ($1,'custom',$2,$3) RETURNING id",
    [NOMBRE, company[0].id, createdBy]
  );
  return ins[0].id;
}

// Destino de restauración (cascada, NUNCA falla, NUNCA pierde):
// 1) carpeta de origen si existe y está activa → ahí. 2) General del contacto (origen_ref.contacto_id).
// 3) carpeta de sistema "Sin ubicación (reasignar)" para reasignación manual del admin.
async function resolverDestinoRestore(file: any, createdBy: string): Promise<string> {
  const orig = await query<any>("SELECT id FROM gozz.drive_folders WHERE id=$1 AND deleted_at IS NULL", [file.folder_id]);
  if (orig[0]) return orig[0].id;
  const ref = file.origen_ref || {};
  if (ref.contacto_id) {
    const g = await resolveContactGeneral(ref.contacto_id, createdBy);
    if (g) return g;
  }
  // Cierre de brecha (borrado en cascada): si no hubo contacto_id pero sí oportunidad_id (subcarpeta de opp),
  // resolver el contacto de esa oportunidad y usar su General — evita caer en "Sin ubicación" innecesariamente.
  if (ref.oportunidad_id) {
    const o = await query<any>("SELECT contacto_id FROM gozz.oportunidades WHERE id=$1", [ref.oportunidad_id]);
    if (o[0]?.contacto_id) {
      const g = await resolveContactGeneral(o[0].contacto_id, createdBy);
      if (g) return g;
    }
  }
  return await resolveSinUbicacionFolder(createdBy);
}

// ids del subárbol de una carpeta (para el scoping por contexto de la papelera).
async function subtreeFolderIds(rootId: string): Promise<string[]> {
  const rows = await query<any>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM gozz.drive_folders WHERE id=$1
       UNION ALL
       SELECT f.id FROM gozz.drive_folders f JOIN tree t ON f.parent_id=t.id
     ) SELECT id FROM tree`,
    [rootId]
  );
  return rows.map((r: any) => r.id);
}

// NOTA: la visibilidad de carpetas en la papelera (subárbol sin archivos, o con ≥1 en ciclo='papelera')
// se resuelve ahora set-based dentro de TRASH_UNIFICADO_CTE (CTE `roots`/`agg`/`visibles`), no en un loop.

// Taxonomía de tipo de archivo por mime+extensión (espejo de la de uploads-routes.ts / KindIcon del frontend).
// Se parametriza por las columnas a usar para mime y nombre (así sirve para la lista unificada de la papelera).
const kindExpr = (mimeCol: string, nameCol: string): string => `
  CASE
    WHEN lower(coalesce(${mimeCol},'')) LIKE 'image/%' OR lower(coalesce(${nameCol},'')) ~ '\\.(png|jpe?g|gif|webp|svg)$' THEN 'imagen'
    WHEN lower(coalesce(${mimeCol},'')) = 'application/pdf' OR lower(coalesce(${nameCol},'')) ~ '\\.pdf$' THEN 'pdf'
    WHEN lower(coalesce(${mimeCol},'')) LIKE '%word%' OR lower(coalesce(${nameCol},'')) ~ '\\.docx?$' THEN 'documento'
    WHEN lower(coalesce(${mimeCol},'')) LIKE '%sheet%' OR lower(coalesce(${mimeCol},'')) LIKE '%excel%' OR lower(coalesce(${nameCol},'')) ~ '\\.(xlsx?|csv)$' THEN 'hoja'
    WHEN lower(coalesce(${mimeCol},'')) LIKE 'video/%' OR lower(coalesce(${nameCol},'')) ~ '\\.(mp4|webm|mov)$' THEN 'video'
    WHEN lower(coalesce(${mimeCol},'')) LIKE 'audio/%' OR lower(coalesce(${nameCol},'')) ~ '\\.(mp3|wav|ogg)$' THEN 'audio'
    WHEN lower(coalesce(${nameCol},'')) ~ '\\.(zip|rar|7z|tar|gz)$' THEN 'comprimido'
    ELSE 'otro'
  END`;
const TIPOS_VALIDOS = new Set(["imagen", "pdf", "documento", "hoja", "video", "audio", "comprimido", "otro"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Papelera Nivel 1 como LISTA UNIFICADA (carpeta/archivo), parametrizada SOLO por $1 = ctxIds (uuid[] | NULL).
// Reemplaza el N+1 de carpetaVisibleEnPapelera por un CTE recursivo set-based: `roots` recorre UNA vez el
// bosque borrado (candidata → todo su subárbol), `agg` cuenta archivos por raíz y `visibles` aplica la MISMA
// regla de antes (visible ⟺ subárbol sin archivos, o con ≥1 en ciclo='papelera'). Así count(*) OVER() y
// LIMIT/OFFSET del select externo son correctos. `u` = carpetas visibles ∪ archivos en papelera de carpeta activa.
const TRASH_UNIFICADO_CTE = `
WITH RECURSIVE roots AS (
  SELECT f.id AS root_id, f.id
    FROM gozz.drive_folders f
   WHERE f.deleted_at IS NOT NULL
     AND (f.parent_id IS NULL OR f.parent_id NOT IN (SELECT id FROM gozz.drive_folders WHERE deleted_at IS NOT NULL))
     AND ($1::uuid[] IS NULL OR f.id = ANY($1) OR f.parent_id = ANY($1))
  UNION ALL
  SELECT r.root_id, c.id
    FROM gozz.drive_folders c JOIN roots r ON c.parent_id = r.id
),
agg AS (
  SELECT r.root_id,
         count(df.id) AS total,
         count(*) FILTER (WHERE df.ciclo = 'papelera') AS en_papelera
    FROM roots r
    LEFT JOIN gozz.drive_files df ON df.folder_id = r.id
   GROUP BY r.root_id
),
visibles AS (
  SELECT root_id FROM agg WHERE total = 0 OR en_papelera > 0
),
folders_norm AS (
  SELECT 'folder'::text AS kind, f.id, f.nombre, NULL::text AS mime, NULL::bigint AS size_bytes,
         f.deleted_at, f.deleted_by, NULL::uuid AS folder_id, NULL::text AS folder_nombre,
         (SELECT count(*) FROM gozz.drive_files df2 WHERE df2.folder_id = f.id)::int AS file_count,
         f.tipo AS folder_tipo
    FROM gozz.drive_folders f
   WHERE f.deleted_at IS NOT NULL
     AND (f.parent_id IS NULL OR f.parent_id NOT IN (SELECT id FROM gozz.drive_folders WHERE deleted_at IS NOT NULL))
     AND f.id IN (SELECT root_id FROM visibles)
     AND ($1::uuid[] IS NULL OR f.id = ANY($1) OR f.parent_id = ANY($1))
),
files_norm AS (
  SELECT 'file'::text AS kind, df.id, df.nombre, df.mime, df.size_bytes,
         df.deleted_at, df.deleted_by, df.folder_id, fold.nombre AS folder_nombre,
         NULL::int AS file_count, NULL::text AS folder_tipo
    FROM gozz.drive_files df
    LEFT JOIN gozz.drive_folders fold ON fold.id = df.folder_id
   WHERE df.ciclo = 'papelera' AND fold.deleted_at IS NULL
     AND ($1::uuid[] IS NULL OR df.folder_id = ANY($1))
),
u AS (
  SELECT * FROM folders_norm
  UNION ALL
  SELECT * FROM files_norm
)`;

// ======== Fase B2: núcleo de purga (borrado PERMANENTE del ciclo de papelera). ⚠️ IRREVERSIBLE ========
//
// GUARDRAIL R2 (el eje): un objeto R2 (content-addressed por sha256) se borra SOLO si es HUÉRFANO — ninguna fila
// SOBREVIVIENTE lo referencia. "Sobreviviente" = después de borrar el batch. Referencia = drive_files (CUALQUIER
// ciclo/deleted_at) O uploads_r2_backup (el backup de /uploads comparte el mismo bucket content-addressed).
async function shaHuerfano(sha: string): Promise<boolean> {
  const r = await query<any>(
    `SELECT NOT EXISTS(SELECT 1 FROM gozz.drive_files       WHERE sha256 = $1)
        AND NOT EXISTS(SELECT 1 FROM gozz.uploads_r2_backup WHERE sha256 = $1) AS huerfano`,
    [sha]
  );
  return !!r[0]?.huerfano;
}

// Purga un set de filas de drive_files: (1) carga las filas; (2) tx = bitácora (drive_files_purgados) + DELETE
// duro de las filas; (3) por cada sha distinto del batch, si es huérfano borra el objeto R2 UNA vez —
// RE-VERIFICANDO el orphan justo antes de cada deleteObject (cierra la microventana con uploads concurrentes).
// v1: NO toca el disco (local_path); muchos apuntan a archivos-fuente/backup.
async function purgeDriveFiles(
  ids: string[],
  opts: { origen: "gc_purga" | "manual"; borradoPor: string | null }
): Promise<{ purgadas: number; objetosR2Borrados: number; objetosPreservados: number }> {
  if (!ids.length) return { purgadas: 0, objetosR2Borrados: 0, objetosPreservados: 0 };

  // 1) cargar las filas del batch
  const filas = await query<any>(
    `SELECT id, sha256, r2_key, nombre, ciclo FROM gozz.drive_files WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  if (!filas.length) return { purgadas: 0, objetosR2Borrados: 0, objetosPreservados: 0 };
  const batchIds = filas.map((f) => f.id);

  // 2) tx: bitácora append-only + DELETE duro de las filas
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const f of filas) {
      await client.query(
        `INSERT INTO gozz.drive_files_purgados (drive_file_id, sha256, r2_key, nombre, ciclo, origen, borrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [f.id, f.sha256, f.r2_key, f.nombre, f.ciclo, opts.origen, opts.borradoPor]
      );
    }
    await client.query(`DELETE FROM gozz.drive_files WHERE id = ANY($1::uuid[])`, [batchIds]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    throw e;
  }
  client.release();

  // 3) borrar objetos R2 huérfanos (post-DELETE del batch). Re-verifica el orphan JUSTO antes de cada delete.
  const shas = Array.from(new Set(filas.map((f) => f.sha256).filter(Boolean))) as string[];
  let objetosR2Borrados = 0, objetosPreservados = 0;
  for (const sha of shas) {
    try {
      if (!r2Enabled) { objetosPreservados++; continue; }
      if (!(await shaHuerfano(sha))) { objetosPreservados++; continue; } // re-verificación inmediata
      const res = await deleteObject(r2Key(sha));
      if (res.ok) {
        objetosR2Borrados++;
        await query(
          `UPDATE gozz.drive_files_purgados SET r2_deleted = true WHERE sha256 = $1 AND drive_file_id = ANY($2::uuid[])`,
          [sha, batchIds]
        );
      } else {
        objetosPreservados++;
      }
    } catch { objetosPreservados++; }
  }
  return { purgadas: filas.length, objetosR2Borrados, objetosPreservados };
}

// GC de cuarentena vencida. DETRÁS DE ENV, default OFF (no borra nada solo hasta prender el flag validado).
//   DRIVE_GC_ENABLED=1 lo arranca; DRIVE_GC_DRYRUN=1 loguea qué purgaría sin borrar; DRIVE_GC_INTERVAL_MS.
let gcHandle: NodeJS.Timeout | null = null;
let gcRunning = false;
export function startDriveCuarentenaGcLoop() {
  if (gcHandle) return;
  const enabled = ["1", "true"].includes((process.env.DRIVE_GC_ENABLED || "").toLowerCase());
  if (!enabled) { console.log("[drive-gc] DRIVE_GC_ENABLED off; GC de cuarentena NO iniciado"); return; }
  const dryRun = ["1", "true"].includes((process.env.DRIVE_GC_DRYRUN || "").toLowerCase());
  const intervalMs = Math.max(60_000, parseInt(process.env.DRIVE_GC_INTERVAL_MS || "3600000", 10) || 3_600_000);
  const tick = async () => {
    if (gcRunning) return;
    gcRunning = true;
    try {
      const rows = await query<any>(
        `SELECT id FROM gozz.drive_files WHERE ciclo = 'cuarentena' AND purgar_en < now() ORDER BY purgar_en LIMIT 200`, []
      );
      const ids = rows.map((r) => r.id);
      if (!ids.length) return;
      if (dryRun) { console.log(`[drive-gc] DRY-RUN: ${ids.length} archivo(s) en cuarentena vencida (no se borra nada)`); return; }
      const r = await purgeDriveFiles(ids, { origen: "gc_purga", borradoPor: null });
      console.log(`[drive-gc] purgadas=${r.purgadas} objetosR2=${r.objetosR2Borrados} preservados=${r.objetosPreservados}`);
    } catch (e: any) { console.error("[drive-gc]", e?.message); }
    finally { gcRunning = false; }
  };
  gcHandle = setInterval(tick, intervalMs);
  setTimeout(tick, 30_000);
  console.log(`[drive-gc] GC de cuarentena iniciado (cada ${intervalMs / 1000}s${dryRun ? ", DRY-RUN" : ""})`);
}

export function registerDriveRoutes(app: Express) {
  // Árbol filtrado por visibilidad del usuario (LEGACY: trae TODAS las carpetas visibles de una).
  // Lo reemplaza el árbol lazy (/api/drive/tree/path + /api/drive/tree/children). Se mantiene hasta que el
  // frontend migre a lazy (Entrega 3B parte 2).
  app.get("/api/drive/tree", requireAuth, async (req, res) => {
    try {
      const u = (req as any).user;
      const folders = await visibleFolders(u);
      res.json({ folders, storage: storageStatus() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Árbol lazy — hijos directos visibles de una carpeta (paginado, "cargar más"). Cada hijo trae has_children
  // (sobre hijos VISIBLES). Gating: canAccessFolder read (consistente con el acceso ya existente al detalle).
  app.get("/api/drive/tree/children", requireAuth, async (req, res) => {
    try {
      const u = (req as any).user;
      const parentId = String(req.query.parent_id || "");
      if (!parentId) { res.status(400).json({ error: "parent_id requerido" }); return; }
      const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "100"), 10) || 100));
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const qRaw = (req.query.q ?? "").toString().trim();
      const q = qRaw ? qRaw.replace(/[\\%_]/g, (s) => "\\" + s) : null;

      // T1 · el nodo virtual «Drive Contactos». Se atiende ANTES de `canAccessFolder`, que buscaría
      // este id en `drive_folders` y devolvería 404 — y un 404 aquí diría "no existe" cuando lo que
      // pasa es "no es para ti". Son cosas distintas y se responden distinto.
      if (parentId === ID_NODO_CONTACTOS) {
        if (!veRamasDeClientes(u)) { res.status(403).json({ error: "forbidden_nodo_contactos" }); return; }
        const r = await hijosDelNodoContactos({ page, pageSize, q });
        res.json({ children: r.children, total: r.total, page, pageSize, hasMore: page * pageSize < r.total });
        return;
      }

      const perm = await canAccessFolder(u, parentId, "read");
      if (!perm.ok) { res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason }); return; }
      const ctx = await treeVisContext(u);
      const { children, total } = await visibleChildren(perm.folder!, ctx, { page, pageSize, q });
      res.json({ children, total, page, pageSize, hasMore: page * pageSize < total });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // Árbol lazy — carga inicial: storage + raíz + cadena de ancestros de `folder_id` (para auto-expand),
  // con la primera página de hijos visibles de cada nodo del camino. Sin folder_id → solo la raíz.
  app.get("/api/drive/tree/path", requireAuth, async (req, res) => {
    try {
      const u = (req as any).user;
      const ctx = await treeVisContext(u);
      const PRELOAD = 100;
      const rootRows = await query<any>(
        "SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE tipo='root' AND deleted_at IS NULL LIMIT 1", []
      );
      const root = rootRows[0] || null;

      const folderId = String(req.query.folder_id || "");
      let ancestors: string[] = [];
      let bajoRamaDeClientes = false;
      if (folderId) {
        const perm = await canAccessFolder(u, folderId, "read");
        if (!perm.ok) { res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason }); return; }
        const chain = await getAncestors(folderId); // root → … → folder
        ancestors = chain.slice().reverse().map((f) => f.id);
        // ¿El camino pedido entra por una de las ramas escondidas? (chain[0] es la raíz.)
        bajoRamaDeClientes =
          chain.length > 1 &&
          (ocultoAlEnumerar("root", chain[1].tipo) || chain.some((f) => f.tipo === "contact"));
      } else if (root) {
        ancestors = [root.id];
      }

      // T1 · LOS EXENTOS. Todo nodo del camino pedido queda a salvo del escondite. Sin esto, la
      // pestaña Documentos de una negociación —que pide el path de una carpeta bajo `Trámites`—
      // recibiría un árbol al que le falta justo el eslabón por el que preguntó.
      const exentos = ancestors.slice();

      // Preload: primera página de hijos visibles de cada nodo del camino (render expandido sin fetches extra).
      const preload: Record<string, { children: any[]; total: number; hasMore: boolean }> = {};
      for (const pid of ancestors) {
        const pf = await getFolder(pid);
        if (!pf) continue;
        const { children, total } = await visibleChildren(pf, ctx, { page: 1, pageSize: PRELOAD, q: null, exentos });
        preload[pid] = { children, total, hasMore: PRELOAD < total };
      }

      // T1 · el nodo virtual «Drive Contactos», sólo para quien puede navegar esas ramas.
      if (root && veRamasDeClientes(u)) {
        const sonda = await hijosDelNodoContactos({ page: 1, pageSize: 1, q: null });
        if (sonda.total > 0) {
          const enRaiz = preload[root.id];
          if (enRaiz) {
            enRaiz.children = [...enRaiz.children, filaNodoContactos(root.id, true)];
            enRaiz.total = enRaiz.total + 1;
          }
          // Si se pidió el path de algo que vive DENTRO de una rama escondida, el nodo virtual va
          // en la cadena —justo debajo de la raíz— o el árbol no sabría dónde colgar lo expandido.
          if (bajoRamaDeClientes && ancestors.length > 0) {
            ancestors.splice(ancestors.length - 1, 0, ID_NODO_CONTACTOS);
            const r = await hijosDelNodoContactos({ page: 1, pageSize: PRELOAD, q: null });
            preload[ID_NODO_CONTACTOS] = { children: r.children, total: r.total, hasMore: PRELOAD < r.total };
          }
        }
      }

      res.json({ storage: storageStatus(), root, ancestors, preload });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // Búsqueda scopeada (3C): carpetas/archivos por nombre DENTRO del subárbol de `scope`, respetando EXACTO la
  // visibilidad del árbol (sin fuga). ?q= (mín. 2) ?scope=<folderId> ?kind=all|folder|file ?page= ?pageSize=25.
  app.get("/api/drive/search", requireAuth, async (req, res) => {
    try {
      const u = (req as any).user;
      const scope = String(req.query.scope || "");
      if (!scope) { res.status(400).json({ error: "scope requerido" }); return; }
      const perm = await canAccessFolder(u, scope, "read");
      if (!perm.ok) { res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason }); return; }

      const kind = req.query.kind === "folder" || req.query.kind === "file" ? String(req.query.kind) : "all";
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const offset = (page - 1) * pageSize;
      const qRaw = (req.query.q ?? "").toString().trim();
      const empty = { folders: { items: [], total: 0 }, files: { items: [], total: 0 }, page, pageSize };
      if (qRaw.length < 2) { res.json(empty); return; }                 // mínimo 2 caracteres
      const q = qRaw.replace(/[\\%_]/g, (s) => "\\" + s);

      // Visibilidad EXACTA: modo semilla del scope (o null = oculto → sin resultados).
      const ctx = await treeVisContext(u);
      const chain = await getAncestors(scope); // raíz → … → scope
      const seedMode = await computeSeedMode(chain, ctx);
      if (!seedMode) { res.json(empty); return; }
      const visParams = [scope, seedMode, ctx.opIds, u.sub, veRamasDeClientes(u)]; // $1..$5 del CTE `vis`

      let folders = { items: [] as any[], total: 0 };
      let files = { items: [] as any[], total: 0 };

      if (kind === "all" || kind === "folder") {
        const rows = await query<any>(
          `${VIS_SUBTREE_CTE}
           SELECT vis.id, vis.nombre, vis.tipo, vis.parent_id, count(*) OVER() AS total
             FROM vis
            WHERE vis.id <> $1
              AND lower(vis.nombre) LIKE '%' || lower($6) || '%'
            ORDER BY vis.nombre, vis.id
            LIMIT $7 OFFSET $8`,
          [...visParams, q, pageSize, offset]
        );
        folders = { items: rows.map(({ total: _t, ...r }: any) => r), total: rows.length ? Number(rows[0].total) : 0 };
      }

      if (kind === "all" || kind === "file") {
        const rows = await query<any>(
          `${VIS_SUBTREE_CTE}
           SELECT df.id, df.nombre, df.mime, df.size_bytes, df.folder_id, count(*) OVER() AS total
             FROM gozz.drive_files df
            WHERE df.folder_id IN (SELECT id FROM vis) AND df.deleted_at IS NULL
              AND lower(df.nombre) LIKE '%' || lower($6) || '%'
            ORDER BY df.nombre, df.id
            LIMIT $7 OFFSET $8`,
          [...visParams, q, pageSize, offset]
        );
        files = { items: rows.map(({ total: _t, ...r }: any) => r), total: rows.length ? Number(rows[0].total) : 0 };
      }

      // Breadcrumbs (una pasada para toda la página): carpeta destino = la carpeta misma / la carpeta del archivo.
      const targetIds = Array.from(new Set([
        ...folders.items.map((f) => f.id),
        ...files.items.map((f) => f.folder_id),
      ]));
      const crumbs: Record<string, { id: string; nombre: string; tipo: string }[]> = {};
      if (targetIds.length) {
        const up = await query<any>(
          `WITH RECURSIVE up AS (
             SELECT id AS target, id, nombre, parent_id, tipo, 0 AS d FROM gozz.drive_folders WHERE id = ANY($1::uuid[])
             UNION ALL
             SELECT up.target, p.id, p.nombre, p.parent_id, p.tipo, up.d + 1
               FROM gozz.drive_folders p JOIN up ON p.id = up.parent_id
           )
           SELECT target, id, nombre, tipo, d FROM up ORDER BY target, d DESC`,
          [targetIds]
        );
        for (const r of up) {
          (crumbs[r.target] ||= []).push({ id: r.id, nombre: r.nombre, tipo: r.tipo }); // ya ordenado raíz→destino
        }
      }
      folders.items = folders.items.map((f) => ({ ...f, breadcrumb: crumbs[f.id] || [] }));
      files.items = files.items.map((f) => ({ ...f, breadcrumb: crumbs[f.folder_id] || [] }));

      res.json({ folders, files, page, pageSize, scope: { id: perm.folder!.id, nombre: perm.folder!.nombre } });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // Detalle carpeta + breadcrumbs + subcarpetas + archivos.
  // Detalle carpeta + breadcrumbs + subcarpetas + archivos PAGINADOS (server-side).
  //   Archivos: ?filesPage=1 ?filesPageSize=50 ?orden=desc|asc, filtros ?tipo=<taxonomía> ?uploader=<uuid>
  //   ?desde=<ISO> ?hasta=<ISO> (sobre created_at) ?q=<texto> (nombre ILIKE). count(*) OVER() para el total.
  //   ?filesOnly=1 → devuelve solo { files, filesTotal, filesPage, filesPageSize } (sin re-traer
  //   folder/breadcrumbs/children/uploaders) para cambios de filtro/página/búsqueda. Los `children`
  //   (subcarpetas) NO se paginan (son pocos; el front los filtra localmente).
  app.get("/api/drive/folders/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const perm = await canAccessFolder(u, String(req.params.id), "read");
    if (!perm.ok) { res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason }); return; }

    const folderId = String(req.params.id);

    // Paginación + filtros de archivos.
    const filesPageSize = Math.min(200, Math.max(1, parseInt(String(req.query.filesPageSize ?? "50"), 10) || 50));
    const filesPage = Math.max(1, parseInt(String(req.query.filesPage ?? "1"), 10) || 1);
    const offset = (filesPage - 1) * filesPageSize;
    const dir = req.query.orden === "asc" ? "ASC" : "DESC"; // literal fijo, no viene del usuario
    const tipo = TIPOS_VALIDOS.has(String(req.query.tipo)) ? String(req.query.tipo) : null;
    const uploader = UUID_RE.test(String(req.query.uploader)) ? String(req.query.uploader) : null;
    const parseFecha = (v: any): string | null => (v && !isNaN(Date.parse(String(v))) ? String(v) : null);
    const desde = parseFecha(req.query.desde);
    const hasta = parseFecha(req.query.hasta);
    const qRaw = (req.query.q ?? "").toString().trim();
    const q = qRaw ? qRaw.replace(/[\\%_]/g, (s) => "\\" + s) : null; // escapar comodines de ILIKE

    // Paginación + búsqueda de subcarpetas (children). qFolder = búsqueda por nombre en las subcarpetas directas.
    const childrenPageSize = Math.min(200, Math.max(1, parseInt(String(req.query.childrenPageSize ?? "50"), 10) || 50));
    const childrenPage = Math.max(1, parseInt(String(req.query.childrenPage ?? "1"), 10) || 1);
    const childrenOffset = (childrenPage - 1) * childrenPageSize;
    const qfRaw = (req.query.qFolder ?? "").toString().trim();
    const qFolder = qfRaw ? qfRaw.replace(/[\\%_]/g, (s) => "\\" + s) : null;

    // Subcarpetas de la página + total, con el MISMO filtro de visibilidad que antes (nadie ve Mi Drive ajeno),
    // ahora en SQL para que count/offset sean correctos. Orden con desempate determinista por id.
    // T1 · el mismo escondite que el árbol, porque este endpoint pinta el PANEL DE CONTENIDO. Sin
    // esto, el árbol escondería las 269 fichas de contacto pero pulsar «Drive de la compañía» las
    // volvería a soltar todas de golpe — que es exactamente el desorden que se vino a quitar.
    // No lleva exentos: aquí no hay "camino pedido", hay una carpeta y sus hijos.
    const runChildren = () => query<any>(
      `SELECT f.id, f.nombre, f.parent_id, f.tipo, f.owner_user_id, f.oportunidad_id, count(*) OVER() AS total
         FROM gozz.drive_folders f
        WHERE f.parent_id = $1 AND f.deleted_at IS NULL
          AND (f.tipo <> 'user' OR f.owner_user_id = $2)
          ${sqlEscondite(perm.folder!.tipo, "$6", "f")}
          AND ($3::text IS NULL OR lower(f.nombre) LIKE '%' || lower($3) || '%')
        ORDER BY f.tipo, f.nombre, f.id
        LIMIT $4 OFFSET $5`,
      [folderId, u.sub, qFolder, childrenPageSize, childrenOffset, []]
    );

    // Cambio de página/búsqueda de SUBCARPETAS: solo children, sin re-traer archivos/estructura.
    if (req.query.childrenOnly) {
      const childRows = await runChildren();
      const childrenTotal = childRows.length ? Number(childRows[0].total) : 0;
      const children = childRows.map(({ total: _t, ...rest }: any) => rest);
      res.json({ children, childrenTotal, childrenPage, childrenPageSize });
      return;
    }

    // Archivos de la página + total filtrado en un solo viaje. Orden con desempate determinista por id.
    const filesRows = await query<any>(
      `SELECT f.id, f.nombre, f.mime, f.size_bytes, f.uploaded_by,
              f.created_at, f.updated_at, u.nombre AS uploader_nombre, u.foto_perfil_url AS uploader_foto,
              count(*) OVER() AS total
         FROM gozz.drive_files f
         LEFT JOIN gozz.users u ON u.id = f.uploaded_by
        WHERE f.folder_id = $1 AND f.deleted_at IS NULL
          AND ($2::text        IS NULL OR ${kindExpr("f.mime", "f.nombre")} = $2)
          AND ($3::uuid        IS NULL OR f.uploaded_by = $3)
          AND ($4::timestamptz IS NULL OR f.created_at >= $4)
          AND ($5::timestamptz IS NULL OR f.created_at <= $5)
          AND ($6::text        IS NULL OR f.nombre ILIKE '%' || $6 || '%')
        ORDER BY f.created_at ${dir}, f.id
        LIMIT $7 OFFSET $8`,
      [folderId, tipo, uploader, desde, hasta, q, filesPageSize, offset]
    );
    const filesTotal = filesRows.length ? Number(filesRows[0].total) : 0;
    const files = filesRows.map(({ total: _t, ...rest }: any) => rest);

    // Cambio de filtro/página/búsqueda de ARCHIVOS: solo los archivos, sin re-traer estructura.
    if (req.query.filesOnly) {
      res.json({ files, filesTotal, filesPage, filesPageSize });
      return;
    }

    const [ancestors, childRows, uploaders] = await Promise.all([
      getAncestors(folderId),
      runChildren(),
      // Facet de subidores presentes en la carpeta (para el dropdown del filtro), sin acotar por los demás filtros.
      query<any>(
        `SELECT DISTINCT us.id, us.nombre
           FROM gozz.drive_files f JOIN gozz.users us ON us.id = f.uploaded_by
          WHERE f.folder_id = $1 AND f.deleted_at IS NULL
          ORDER BY us.nombre`,
        [folderId]
      ),
    ]);
    const childrenTotal = childRows.length ? Number(childRows[0].total) : 0;
    const children = childRows.map(({ total: _t, ...rest }: any) => rest);
    // breadcrumbs: de root a carpeta actual.
    // 🔴 SIN `.reverse()`. `getAncestors` YA devuelve la cadena de raíz a carpeta (`ORDER BY depth
    // DESC`, y la raíz es la de mayor profundidad). Invertirla la dejaba de carpeta a raíz, así que
    // las migas se pintaban del revés y el tramo marcado como «estás aquí» era la RAÍZ.
    //
    // Venía del snapshot inicial (26-may). Se vio en staging el 2026-08-25: dentro de «Mi unidad»
    // ponía «Usuarios › Drive del CRM» con la raíz en naranja.
    //
    // ⚠️ Y arrastraba algo peor: `recortarMigas` (T3) recorta desde donde encuentra la raíz del
    // alcance, así que con la cadena invertida esa raíz caía en la posición 0 y el recorte
    // devolvía la cadena ENTERA. La pestaña Documentos de una negociación seguía ofreciendo un
    // enlace a `Trámites`, que es justo lo que la T3 venía a impedir.
    const breadcrumbs = ancestors;
    res.json({
      folder: perm.folder, breadcrumbs, children, files,
      filesTotal, filesPage, filesPageSize,
      childrenTotal, childrenPage, childrenPageSize,
      uploaders,
    });
  });

  // Crear subcarpeta personalizada.
  app.post("/api/drive/folders", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const { parent_id, nombre } = req.body || {};
    if (!parent_id || !nombre) { res.status(400).json({ error: "parent_id y nombre requeridos" }); return; }
    const perm = await canAccessFolder(u, parent_id, "write");
    if (!perm.ok) { res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason }); return; }
    const ins = await query<Folder>(
      "INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, created_by) VALUES ($1,'custom',$2,$3) RETURNING id, nombre, parent_id, tipo, owner_user_id, oportunidad_id",
      [String(nombre).slice(0, 200), parent_id, u.sub]
    );
    res.json({ folder: ins[0] });
  });

  // Renombrar carpeta.
  app.patch("/api/drive/folders/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const { nombre } = req.body || {};
    if (!nombre) { res.status(400).json({ error: "nombre requerido" }); return; }
    const folder = await getFolder(String(req.params.id));
    if (!folder) { res.status(404).json({ error: "not_found" }); return; }
    // Admins editan en cualquier lado; users solo dentro de su Mi Drive.
    if (!(await canEditFolder(u, folder))) { res.status(403).json({ error: "forbidden" }); return; }
    // No permitimos renombrar carpetas estructurales.
    const protegidas = new Set(["root", "company", "users_root", "opportunities_root", "user", "opportunity"]);
    if (protegidas.has(folder.tipo)) {
      res.status(400).json({ error: "no_renombrable" }); return;
    }
    await query("UPDATE gozz.drive_folders SET nombre=$1, updated_at=NOW() WHERE id=$2", [String(nombre).slice(0, 200), String(req.params.id)]);
    res.json({ ok: true });
  });

  // Soft-delete carpeta (mover a papelera). Admin global o user en su Mi Drive.
  app.delete("/api/drive/folders/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const folder = await getFolder(String(req.params.id));
    if (!folder) { res.status(404).json({ error: "not_found" }); return; }
    if (!(await canEditFolder(u, folder))) { res.status(403).json({ error: "forbidden" }); return; }
    const protegidas = new Set(["root", "company", "users_root", "opportunities_root", "user"]);
    if (protegidas.has(folder.tipo)) {
      res.status(400).json({ error: "no_eliminable" }); return;
    }
    // Soft-delete carpeta + descendientes + archivos descendientes (todos).
    await query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM gozz.drive_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM gozz.drive_folders f JOIN tree t ON f.parent_id = t.id
       )
       UPDATE gozz.drive_folders SET deleted_at = NOW(), deleted_by = $2 WHERE id IN (SELECT id FROM tree) AND deleted_at IS NULL`,
      [String(req.params.id), u.sub]
    );
    await query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM gozz.drive_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM gozz.drive_folders f JOIN tree t ON f.parent_id = t.id
       )
       UPDATE gozz.drive_files df
          SET deleted_at = NOW(), deleted_by = $2, ciclo = 'papelera',
              origen_ref = jsonb_build_object('folder_id', fo.id, 'contacto_id', fo.contacto_id,
                                              'oportunidad_id', fo.oportunidad_id, 'seccion', fo.seccion, 'tipo', fo.tipo)
         FROM gozz.drive_folders fo
        WHERE fo.id = df.folder_id AND df.folder_id IN (SELECT id FROM tree) AND df.deleted_at IS NULL`,
      [String(req.params.id), u.sub]
    );
    res.json({ ok: true, soft: true });
  });

  // Resolver carpeta de usuario (lazy). Solo el propio dueño accede.
  app.get("/api/drive/resolve/user/:userId", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const userId = req.params.userId === "me" ? u.sub : req.params.userId;
    if (userId !== u.sub) { res.status(403).json({ error: "forbidden_user_folder" }); return; }
    try {
      const f = await resolveUserFolder(userId, u.sub);
      res.json({ folder: f });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Resolver carpeta de oportunidad (lazy).
  app.get("/api/drive/resolve/oportunidad/:opId", requireAuth, async (req, res) => {
    const u = (req as any).user;
    // Acceso abierto: todo usuario autenticado puede ver/subir documentos de oportunidades.
    try {
      const f = await resolveOportunidadFolder(String(req.params.opId), u.sub);
      res.json({ folder: f });
    } catch (e: any) {
      res.status(e?.message?.includes("no encontrada") ? 404 : 500).json({ error: e?.message });
    }
  });

  // Subir archivo.
  app.post("/api/drive/upload", requireAuth, upload.single("file"), async (req, res) => {
    const u = (req as any).user;
    const folder_id = (req.body?.folder_id || "").toString();
    const file = (req as any).file;
    try {
      if (!folder_id) throw new Error("folder_id requerido");
      if (!file) throw new Error("file requerido");
      const perm = await canAccessFolder(u, folder_id, "write");
      if (!perm.ok) {
        res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason });
        return;
      }
      // R2 primero (content-addressed). Fallback de EMERGENCIA: disco local (para no perder una subida
      //    si R2 está caído momentáneamente). La capa de archivos es R2-only.
      let localPath: string | null = null;
      let sha256: string | null = null;
      let r2_key: string | null = null;
      let r2_etag: string | null = null;
      let r2_status: string | null = null;

      if (r2Enabled) {
        try {
          const buf = await fs.promises.readFile(file.path);
          sha256 = crypto.createHash("sha256").update(buf).digest("hex");
          const key = r2Key(sha256);
          const put = await putObject(key, buf, file.mimetype);
          r2_key = key; r2_etag = put.etag; r2_status = "ok";
        } catch (e: any) {
          console.warn("[drive/upload] R2 falló, guardando en disco local:", e?.message);
          r2_key = null; r2_etag = null; r2_status = null; // sha256 (si se calculó) se conserva
        }
      }

      if (r2_status !== "ok") {
        const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
        const dest = path.join(DRIVE_DIR, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
        await fs.promises.copyFile(file.path, dest);
        localPath = dest;
      }

      // Resolución de nombre + INSERT en una transacción con advisory lock por (carpeta + base en minúsculas):
      // serializa las subidas del mismo nombre a la misma carpeta y evita la race del contador (N). El putObject
      // a R2 ya se hizo arriba (fuera del lock; es idempotente/content-addressed).
      const { base } = splitNombre(file.originalname);
      const client = await pool.connect();
      let inserted: any;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${folder_id}/${base.toLowerCase()}`]);
        const nombre = await resolverNombreUnico(client, folder_id, file.originalname);
        const r = await client.query(
          `INSERT INTO gozz.drive_files (folder_id, nombre, mime, size_bytes, local_path, uploaded_by, sha256, r2_key, r2_etag, r2_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [folder_id, nombre, file.mimetype, file.size, localPath, u.sub, sha256, r2_key, r2_etag, r2_status]
        );
        inserted = r.rows[0];
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      res.json({ file: inserted });
    } catch (e: any) {
      console.error("[drive/upload]", e?.message);
      res.status(500).json({ error: e?.message });
    } finally {
      // Cleanup tmp siempre (exitoso o no).
      if (file?.path) { fs.promises.unlink(file.path).catch(() => {}); }
    }
  });

  // Descargar archivo (proxy con ACL).
  app.get("/api/drive/files/:id/download", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT * FROM gozz.drive_files WHERE id = $1", [String(req.params.id)]);
    const f = rows[0];
    if (!f) { res.status(404).json({ error: "not_found" }); return; }
    const perm = await canAccessFile(u, f, "read");
    if (!perm.ok) { res.status(403).json({ error: perm.reason }); return; }
    await anotarReciente(u.sub, String(req.params.id));   // T6 · «Recientes»
    try {
      const buf = await readFileBytes(f);
      res.setHeader("Content-Type", resolveMime(f.nombre, f.mime));
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(f.nombre)}"`);
      res.setHeader("Content-Length", String(buf.length));
      res.end(buf);
    } catch (e: any) {
      console.error("[drive/download]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // -------- PREVIEW: stream inline --------
  // Cada apertura por `/raw` o `/download` anota el archivo en «Recientes» de quien lo pidió.
  // Va DESPUÉS de la comprobación de acceso, nunca antes: anotar algo que no se pudo abrir dejaría
  // en la pantalla de alguien el nombre de un archivo que no tiene derecho a ver.
  app.get("/api/drive/files/:id/raw", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT * FROM gozz.drive_files WHERE id = $1", [String(req.params.id)]);
    const f = rows[0];
    if (!f) { res.status(404).json({ error: "not_found" }); return; }
    const perm = await canAccessFile(u, f, "read");
    if (!perm.ok) { res.status(403).json({ error: perm.reason }); return; }
    await anotarReciente(u.sub, String(req.params.id));   // T6 · «Recientes»
    try {
      const buf = await readFileBytes(f);
      const mime = resolveMime(f.nombre, f.mime);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.nombre)}"`);
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("Accept-Ranges", "bytes");
      res.end(buf);
    } catch (e: any) {
      console.error("[drive/raw]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // -------- PREVIEW: miniatura (galeria de documentos) --------
  //
  // 🔴 LA ACL VA PRIMERO, Y ES LA MISMA QUE LA DE `/raw`. Una miniatura es el contenido del
  // archivo, mas pequenio: si aqui la comprobacion fuera mas laxa, este endpoint seria una puerta
  // trasera a documentos que su duenio no ha compartido — y una que nadie vigila, porque "solo es
  // una imagen pequenia".
  //
  // 404 para todo lo que no se sabe rasterizar. No se genera una imagen de "sin vista previa": eso
  // es un objeto mas que guardar y una mentira que cachear. El frontend ya cae al icono.
  app.get("/api/drive/files/:id/thumb", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT * FROM gozz.drive_files WHERE id = $1", [String(req.params.id)]);
    const f = rows[0];
    if (!f) { res.status(404).json({ error: "not_found" }); return; }
    const perm = await canAccessFile(u, f, "read");
    if (!perm.ok) { res.status(403).json({ error: perm.reason }); return; }

    // Tipo y tamanio se deciden ANTES de leer un solo byte: si el tope se comprobara despues de
    // traerse el objeto, no protegeria de nada. Ver `lib/drive-thumbs.ts`.
    const d = decidir(f);
    if (!d.ok) { res.status(404).json({ error: d.motivo }); return; }

    const servir = (buf: Buffer) => {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", String(buf.length));
      // ⚠️ SIN `immutable`, a proposito. La URL lleva el id de la FILA, no el hash del contenido:
      // si alguien re-sube contenido distinto, el sha cambia pero la URL no. Con `immutable` el
      // navegador ensenaria la miniatura vieja para siempre y no habria forma de sacarlo de ahi.
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(buf);
    };

    try {
      // 1 · ¿Ya esta hecha? `d.clave` es null cuando la fila no tiene sha256 (ver `claveMiniatura`).
      if (d.clave && r2Enabled) {
        const h = await headObject(d.clave).catch(() => null);
        if (h?.ok) { servir(await getObject(d.clave)); return; }
      }

      // 2 · Generar. Un tipo soportado que no se deja rasterizar (corrupto, PDF sin paginas,
      //     `pdftoppm` ausente) da 404, no 500: para quien mira es lo mismo que un .docx.
      const mini = await generarMiniatura(await readFileBytes(f), d.herramienta);
      if (!mini) { res.status(404).json({ error: "no_se_pudo_generar" }); return; }

      // 3 · Guardar la derivada, si se puede identificar el contenido. `putObject` ya lleva
      //     If-None-Match:*, asi que dos peticiones a la vez no se pisan: la segunda recibe 412 y
      //     se queda con lo que hay. No hace falta bloqueo propio.
      //     Que falle el guardado NO puede costarle la miniatura al usuario: ya la tenemos.
      if (d.clave && r2Enabled) {
        await putObject(d.clave, mini, "image/jpeg").catch((e: any) =>
          console.warn("[drive/thumb] no se pudo cachear la miniatura:", e?.message));
      }

      servir(mini);
    } catch (e: any) {
      console.error("[drive/thumb]", e?.message);
      res.status(404).json({ error: "no_se_pudo_generar" });
    }
  });

  // -------- PREVIEW: extract text (Word/Excel/PDF/etc) --------
  app.get("/api/drive/files/:id/extract", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT * FROM gozz.drive_files WHERE id = $1", [String(req.params.id)]);
    const f = rows[0];
    if (!f) { res.status(404).json({ error: "not_found" }); return; }
    const perm = await canAccessFile(u, f, "read");
    if (!perm.ok) { res.status(403).json({ error: perm.reason }); return; }

    const ext = (f.nombre || "").toLowerCase().split(".").pop() || "";
    const mime = (f.mime || "").toLowerCase();
    try {
      const buf = await readFileBytes(f);
      const max = 200_000; // 200k chars cap

      // .docx → mammoth convertToHtml para preservar formato (negritas, listas, tablas, headings)
      if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ buffer: buf });
        const html = result.value || "";
        res.json({ kind: "docx", html: html.slice(0, max * 2), truncated: html.length > max * 2 });
        return;
      }

      // .xlsx / .xls → xlsx (sheetjs) → HTML por hoja preservando formato/headers
      if (ext === "xlsx" || ext === "xls" || ext === "xlsm" || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
        // FIX 2026-05-13: wrap in try/catch — sheets vacías o corruptas crashean sheet_to_html
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buf, { type: "buffer", cellStyles: true });
          const sheets: { name: string; html: string; rows: number; cols: number }[] = [];
          let totalChars = 0;
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
            let html: string;
            try {
              html = XLSX.utils.sheet_to_html(ws, { id: "sh-" + sheetName, editable: false });
            } catch {
              html = "<table><tr><td><em>Hoja vacía o sin datos legibles</em></td></tr></table>";
            }
            sheets.push({
              name: sheetName,
              html: html,
              rows: range ? range.e.r - range.s.r + 1 : 0,
              cols: range ? range.e.c - range.s.c + 1 : 0,
            });
            totalChars += html.length;
            if (totalChars > max * 3) break;
          }
          res.json({ kind: "xlsx", sheets, truncated: totalChars > max * 3 });
          return;
        } catch (e: any) {
          console.error("[drive/extract xlsx]", e?.message);
          res.json({ kind: "xlsx", text: null, hint: "preview_unavailable", truncated: false, error_detail: e?.message });
          return;
        }
      }

      // texto plano
      if (
        mime.startsWith("text/") ||
        ["txt", "csv", "md", "json", "xml", "log", "html", "htm"].includes(ext) ||
        mime === "application/json" ||
        mime === "application/xml"
      ) {
        const text = buf.toString("utf-8");
        res.json({ kind: ext || "txt", text: text.slice(0, max), truncated: text.length > max });
        return;
      }

      // PDF: extracción básica (con pdf-parse si está instalada). Si falla, el frontend usará /raw + iframe nativo.
      if (ext === "pdf" || mime === "application/pdf") {
        res.json({ kind: "pdf", text: null, hint: "use_raw_iframe", truncated: false });
        return;
      }

      // imagen: que el frontend use /raw como <img src>
      if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
        res.json({ kind: "image", text: null, hint: "use_raw_img", truncated: false });
        return;
      }

      // .pptx → unzip + extract text per slide
      if (ext === "pptx" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
        try {
          const JSZip = (await import("jszip")).default;
          const xml2js = await import("xml2js");
          const zip = await JSZip.loadAsync(buf);
          const slideFiles = Object.keys(zip.files)
            .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
            .sort((a, b) => {
              const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
              const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
              return na - nb;
            });
          const slides: { number: number; title: string; content: string[] }[] = [];
          const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
          for (let i = 0; i < slideFiles.length; i++) {
            const xml = await zip.files[slideFiles[i]].async("string");
            const parsed = await parser.parseStringPromise(xml);
            const texts: string[] = [];
            const collectText = (node: unknown): void => {
              if (!node) return;
              if (typeof node === "string") { if (node.trim()) texts.push(node.trim()); return; }
              if (Array.isArray(node)) { for (const x of node) collectText(x); return; }
              if (typeof node === "object") {
                const obj = node as Record<string, unknown>;
                if (typeof obj["a:t"] === "string") texts.push(obj["a:t"] as string);
                else if (Array.isArray(obj["a:t"])) {
                  for (const t of obj["a:t"]) if (typeof t === "string" && t.trim()) texts.push(t.trim());
                }
                for (const k of Object.keys(obj)) {
                  if (k.startsWith("$")) continue;
                  collectText(obj[k]);
                }
              }
            };
            collectText(parsed);
            const title = texts[0] || "Slide " + (i + 1);
            const content = texts.slice(1).filter((t) => t && t !== title);
            slides.push({ number: i + 1, title, content });
          }
          res.json({ kind: "pptx", slides, total_slides: slides.length });
          return;
        } catch (e) {
          console.error("[drive/extract pptx]", e);
          res.json({ kind: "pptx", text: null, hint: "preview_unavailable", truncated: false });
          return;
        }
      }

      res.json({ kind: ext || "unknown", text: null, hint: "preview_unavailable", truncated: false });
    } catch (e: any) {
      console.error("[drive/extract]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });


  // Renombrar archivo. Admin global o user dueño de la rama.
  app.patch("/api/drive/files/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const { nombre } = req.body || {};
    if (!nombre) { res.status(400).json({ error: "nombre requerido" }); return; }
    const rows = await query<any>("SELECT folder_id FROM gozz.drive_files WHERE id=$1", [String(req.params.id)]);
    if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    const folder = await getFolder(rows[0].folder_id);
    if (!folder || !(await canEditFolder(u, folder))) { res.status(403).json({ error: "forbidden" }); return; }
    await query("UPDATE gozz.drive_files SET nombre=$1, updated_at=NOW() WHERE id=$2", [String(nombre).slice(0, 250), String(req.params.id)]);
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // MOVER ARCHIVOS A OTRA CARPETA — T2, pedido en la reunión del 2026-08-24
  //
  // «Que si por ejemplo, por error, yo los subí todos aquí, entonces yo los marco y le doy mover
  // a la selección y moverlos a la carpeta.» Hasta hoy no había forma: para mover un archivo
  // había que DESCARGARLO y volver a SUBIRLO en el destino, que además le cambia el autor y la
  // fecha y deja el original en la papelera. Eso es lo que hacía Briset a mano.
  //
  // 🔴 MOVER NO ES BORRAR. Es un `UPDATE` de `folder_id`: el archivo no se toca, los bytes de R2
  // no se tocan (la clave es por contenido, no por carpeta) y no interviene ningún ciclo de
  // papelera. Por eso no hay palabra escrita que teclear en la confirmación (§10.7): la palabra
  // se pide cuando el efecto es inmediato E IRREVERSIBLE, y esto se deshace moviendo de vuelta.
  //
  // La bitácora hace que eso sea cierto y no una promesa: una fila de `auditoria` con la carpeta
  // de origen DE CADA archivo. Sin ella, deshacer sería adivinar por fecha.
  //
  // ⚠️ Colisión de nombre: la identidad de un archivo en el Drive es POR NOMBRE dentro de su
  // carpeta (mig. `0050`). Se reutiliza `resolverNombreUnico` bajo el MISMO advisory lock que el
  // upload y la restauración — es el tercer sitio que lo necesita, y escribir aquí un cuarto
  // contador propio es cómo dos archivos acaban llamándose igual.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const MAX_MOVER = 200;   // el listado pagina de 50 en 50 y el tope del servidor es 200

  app.post("/api/drive/files/mover", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const destino = String(req.body?.destino_folder_id || "");
    const idsCrudos = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = Array.from(new Set(idsCrudos.map((x: any) => String(x)).filter((x: string) => UUID_RE.test(x))));

    if (!UUID_RE.test(destino)) { res.status(400).json({ error: "destino_invalido" }); return; }
    if (ids.length === 0) { res.status(400).json({ error: "sin_archivos" }); return; }
    if (ids.length > MAX_MOVER) { res.status(400).json({ error: "demasiados", maximo: MAX_MOVER }); return; }

    // (1) El destino, primero: si no se puede escribir ahí, no hace falta mirar nada más.
    const permDestino = await canAccessFolder(u, destino, "write");
    if (!permDestino.ok) {
      res.status(permDestino.reason === "not_found" ? 404 : 403).json({ error: permDestino.reason });
      return;
    }

    const archivos = await query<any>(
      `SELECT id, folder_id, nombre FROM gozz.drive_files
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids]
    );
    if (archivos.length === 0) { res.status(404).json({ error: "sin_archivos_vivos" }); return; }

    // (2) Los orígenes. Sacar un archivo de una carpeta la modifica, así que hace falta permiso
    //     de escritura ALLÍ también — el mismo que exige borrarlo.
    //
    //     🔴 Se comprueban TODOS antes de mover NINGUNO. Un movimiento a medias deja al usuario
    //     con la selección repartida entre dos carpetas y sin saber cuáles pasaron: es peor que
    //     un 403 limpio. Hoy la selección vive dentro de una sola carpeta, así que en la práctica
    //     es una comprobación; se hace sobre el conjunto porque mañana puede no serlo.
    const origenes = Array.from(new Set(archivos.map((f: any) => String(f.folder_id))));
    for (const origen of origenes) {
      const permOrigen = await canAccessFolder(u, origen, "write");
      if (!permOrigen.ok) { res.status(403).json({ error: "forbidden_origen" }); return; }
    }

    // (3) Los que ya están en el destino no son un error: no hay nada que hacer con ellos.
    const porMover = archivos.filter((f: any) => String(f.folder_id) !== destino);
    const yaEstaban = archivos.length - porMover.length;
    if (porMover.length === 0) { res.json({ movidos: 0, ya_estaban: yaEstaban, renombrados: 0 }); return; }

    const antes = porMover.map((f: any) => ({ id: f.id, folder_id: f.folder_id, nombre: f.nombre }));
    let renombrados = 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const f of porMover) {
        const { base } = splitNombre(f.nombre);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${destino}/${base.toLowerCase()}`]);
        const nombre = await resolverNombreUnico(client, destino, f.nombre);
        if (nombre !== f.nombre) renombrados++;
        await client.query(
          "UPDATE gozz.drive_files SET folder_id=$1, nombre=$2, updated_at=now() WHERE id=$3",
          [destino, nombre, f.id]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // (4) La bitácora, DESPUÉS del commit y fuera de él: si escribirla fallara, lo que no puede
    //     pasar es que se caiga un movimiento que ya es correcto. Un fallo aquí se registra y se
    //     sigue — mismo criterio que el resto de bitácoras del proyecto.
    try {
      await query(
        `INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
         VALUES ($1, 'drive_mover_archivos', 'drive_files', $2, $3::jsonb, $4::jsonb)`,
        [
          u.sub, destino,
          JSON.stringify({ archivos: antes }),
          JSON.stringify({ destino_folder_id: destino, movidos: porMover.length, renombrados }),
        ]
      );
    } catch (e: any) {
      console.error("[drive mover] no se pudo registrar la bitácora:", e?.message);
    }

    res.json({ movidos: porMover.length, ya_estaban: yaEstaban, renombrados });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // COMPARTIR — T5 (reunión del 2026-08-24)
  //
  // «Que yo en MyDrive pueda darle clic y, en vez de solo abrir, pueda darle compartir. Y ahí yo
  // puedo darle los permisos: si quiero que edite, que solamente lo vea.»
  //
  // 🔴 SOLO SE COMPARTE LO PROPIO. El destino tiene que estar dentro del «Mi unidad» de quien
  // comparte, y eso lo decide `esMiRama` — que NO tiene atajo de admin, a diferencia de
  // `canEditFolder`. Un admin entra a muchos sitios, pero repartir accesos sobre el espacio
  // personal de otra persona no es una de sus atribuciones.
  //
  // 🔴 NO HAY COMPARTIR POR VÍNCULO. Se descartó el 2026-08-24: los archivos de este CRM se
  // sirven siempre por proxy con ACL, y un enlace que funcione sin sesión rompe esa premisa.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // DESTACADOS Y RECIENTES — T6 (reunión del 2026-08-24)
  //
  // 🔴 EL ÁMBITO DE UN DESTACADO LO DECIDE EL SERVIDOR, NO QUIEN LLAMA, y esto es lo único de
  // toda la tanda que tiene consecuencias de verdad.
  //
  // Si la ruta aceptara `ambito` del cuerpo, cualquiera podría destacar una carpeta de SU unidad
  // personal como `compania`. Los destacados de compañía los ve todo el equipo, así que eso
  // publicaría el NOMBRE de una carpeta privada —«Divorcio», «Contrato con X»— a las quince
  // personas de la empresa. No haría falta ni malicia: bastaría un campo mal puesto en el cliente.
  //
  // Por eso el ámbito se DERIVA de dónde vive la cosa: bajo la rama de la compañía es
  // `compania`, y en cualquier otro sitio es `personal`. El cliente dice QUÉ destacar; nunca
  // PARA QUIÉN se ve.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /** Los destacados de quien pregunta: los de la compañía (que ve todo el equipo) y los suyos. */
  app.get("/api/drive/destacados", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const filas = await query<any>(
      `SELECT d.id, d.ambito, d.folder_id, d.file_id, d.created_at, d.user_id,
              us.nombre AS puesta_por,
              df.nombre AS carpeta_nombre,
              da.nombre AS archivo_nombre, da.mime AS archivo_mime, da.size_bytes AS archivo_size
         FROM gozz.drive_destacados d
         JOIN gozz.users us ON us.id = d.user_id
         LEFT JOIN gozz.drive_folders df ON df.id = d.folder_id AND df.deleted_at IS NULL
         LEFT JOIN gozz.drive_files   da ON da.id = d.file_id   AND da.deleted_at IS NULL
        WHERE d.ambito = 'compania' OR (d.ambito = 'personal' AND d.user_id = $1)
        ORDER BY d.created_at DESC`,
      [u.sub]
    );
    // Lo que se fue a la papelera deja de listarse: la estrella sigue puesta —si se restaura,
    // vuelve— pero un enlace a algo que ya no está solo sirve para dar un error al pulsarlo.
    const vivos = filas
      .filter((f: any) => (f.folder_id ? f.carpeta_nombre : f.archivo_nombre) != null)
      .map((f: any) => ({
        id: f.id,
        ambito: f.ambito,
        tipo: f.folder_id ? "carpeta" : "archivo",
        folder_id: f.folder_id,
        file_id: f.file_id,
        nombre: f.folder_id ? f.carpeta_nombre : f.archivo_nombre,
        mime: f.archivo_mime ?? null,
        size_bytes: f.archivo_size ?? null,
        puesta_por: f.puesta_por,
        mia: String(f.user_id) === String(u.sub),
      }));
    res.json({
      compania: vivos.filter((v: any) => v.ambito === "compania"),
      personales: vivos.filter((v: any) => v.ambito === "personal"),
    });
  });

  /** Destacar. El ámbito lo pone el servidor según dónde viva la cosa (ver la nota de arriba). */
  app.post("/api/drive/destacados", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const objetivo = await resolverObjetivoCompartible(req.body?.folder_id, req.body?.file_id);
    if (!objetivo.ok) { res.status(objetivo.estado!).json({ error: objetivo.error }); return; }

    // Se exige poder LEERLO. Destacar lo que no puedes ver metería su nombre en tu pantalla.
    const permiso = objetivo.file_id
      ? await canAccessFile(u, { id: objetivo.file_id, folder_id: objetivo.folderId! }, "read")
      : await canAccessFolder(u, objetivo.folderId!, "read");
    if (!permiso.ok) { res.status(403).json({ error: permiso.reason ?? "forbidden" }); return; }

    const ambito = await ambitoDeDestacado(objetivo.folderId!);

    const fila = await query<any>(
      `INSERT INTO gozz.drive_destacados (folder_id, file_id, ambito, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [objetivo.folder_id, objetivo.file_id, ambito, u.sub]
    );
    // `DO NOTHING` y no un error: destacar dos veces lo mismo es un doble clic, no un fallo. Se
    // devuelve lo que hay, que es el estado real.
    if (fila[0]) { res.json({ destacado: fila[0] }); return; }
    const yaEstaba = await query<any>(
      `SELECT * FROM gozz.drive_destacados
        WHERE COALESCE(folder_id, file_id) = $1 AND (ambito = 'compania' OR user_id = $2)
        LIMIT 1`,
      [objetivo.folder_id ?? objetivo.file_id, u.sub]
    );
    res.json({ destacado: yaEstaba[0] ?? null, ya_estaba: true });
  });

  /** Quitar la estrella: quien la puso, o un admin. Decisión de Juan del 2026-08-24. */
  app.delete("/api/drive/destacados/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const d = (await query<any>(
      "SELECT id, user_id FROM gozz.drive_destacados WHERE id = $1", [String(req.params.id)]
    ))[0];
    if (!d) { res.status(404).json({ error: "not_found" }); return; }
    if (String(d.user_id) !== String(u.sub) && !isAdminUser(u)) {
      res.status(403).json({ error: "no_la_pusiste" }); return;
    }
    await query("DELETE FROM gozz.drive_destacados WHERE id = $1", [String(req.params.id)]);
    res.json({ ok: true });
  });

  /** Lo que ha abierto esta persona, lo más reciente primero. */
  app.get("/api/drive/recientes", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const filas = await query<any>(
      `SELECT r.file_id, r.visto_at, a.nombre, a.mime, a.size_bytes, a.folder_id, f.nombre AS carpeta
         FROM gozz.drive_recientes r
         JOIN gozz.drive_files a ON a.id = r.file_id AND a.deleted_at IS NULL
         LEFT JOIN gozz.drive_folders f ON f.id = a.folder_id
        WHERE r.user_id = $1
        ORDER BY r.visto_at DESC
        LIMIT ${MAX_RECIENTES}`,
      [u.sub]
    );
    res.json({ recientes: filas });
  });

  /** La búsqueda de personas del selector: paginada de 10 en 10 y con buscador, como se pidió. */
  app.get("/api/drive/usuarios-para-compartir", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const qRaw = (req.query.q ?? "").toString().trim();
    const q = qRaw ? qRaw.replace(/[\\%_]/g, (c) => "\\" + c) : null;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    // Diez por página, y es el número que pidió Juan: «imaginate que la organización tenga más de
    // 100 empleados, son muchos usuarios, entonces se pegaría».
    const pageSize = 10;
    const rows = await query<any>(
      `SELECT id, nombre, email, count(*) OVER() AS total
         FROM gozz.users
        WHERE id <> $1 AND COALESCE(activo, true) = true
          AND ($2::text IS NULL OR lower(nombre) LIKE '%' || lower($2) || '%'
                                OR lower(email)  LIKE '%' || lower($2) || '%')
        ORDER BY nombre NULLS LAST, email
        LIMIT $3 OFFSET $4`,
      [u.sub, q, pageSize, (page - 1) * pageSize]
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    res.json({
      usuarios: rows.map(({ total: _t, ...r }: any) => r),
      total, page, pageSize, hasMore: page * pageSize < total,
    });
  });

  /**
   * Qué he compartido YO, en ids. Es lo que permite pintar el icono de personita sobre una
   * carpeta compartida — «que tengan el muñequito de que se compartió, como para saber».
   *
   * Se pide una vez por sesión de pantalla y no por carpeta: son pocas filas (lo que una persona
   * comparte), y meter la marca en el listado obligaría a tocar las tres consultas que devuelven
   * carpetas y a acordarse de las tres cada vez que cambie algo.
   */
  app.get("/api/drive/comparticiones/mias", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const filas = await query<any>(
      `SELECT DISTINCT folder_id, file_id FROM gozz.drive_comparticiones WHERE compartido_por = $1`,
      [u.sub]
    );
    res.json({
      carpetas: filas.filter((f: any) => f.folder_id).map((f: any) => String(f.folder_id)),
      archivos: filas.filter((f: any) => f.file_id).map((f: any) => String(f.file_id)),
    });
  });

  /** Con quién está compartida una carpeta o un archivo. Solo lo ve su dueño. */
  app.get("/api/drive/comparticiones", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const objetivo = await resolverObjetivoCompartible(req.query.folder_id, req.query.file_id);
    if (!objetivo.ok) { res.status(objetivo.estado!).json({ error: objetivo.error }); return; }
    if (!(await esMiRama(u.sub, objetivo.folderId!))) { res.status(403).json({ error: "no_es_tuyo" }); return; }

    const filas = await query<any>(
      `SELECT c.id, c.permiso, c.created_at, c.updated_at,
              us.id AS usuario_id, us.nombre AS usuario_nombre, us.email AS usuario_email
         FROM gozz.drive_comparticiones c
         JOIN gozz.users us ON us.id = c.compartido_con
        WHERE ${objetivo.file_id ? "c.file_id" : "c.folder_id"} = $1
        ORDER BY us.nombre NULLS LAST, us.email`,
      [objetivo.file_id ?? objetivo.folder_id]
    );
    res.json({ comparticiones: filas });
  });

  /** Compartir. Si ya estaba compartido con esa persona, se ACTUALIZA el permiso (§2.8). */
  app.post("/api/drive/comparticiones", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const permiso = String(req.body?.permiso ?? "");
    // 🔴 Un permiso que no está en la lista se RECHAZA; no se coacciona al más seguro (§2.8.3).
    // `permiso === "editor" ? "editor" : "lector"` guardaría un «editorr» como solo lectura sin
    // decir nada, y quien lo pidió se quedaría creyendo que concedió la edición.
    if (permiso !== "lector" && permiso !== "editor") { res.status(400).json({ error: "permiso_invalido" }); return; }
    const con = String(req.body?.compartido_con ?? "");
    if (!UUID_RE.test(con)) { res.status(400).json({ error: "usuario_invalido" }); return; }
    if (con === u.sub) { res.status(400).json({ error: "no_a_uno_mismo" }); return; }

    const objetivo = await resolverObjetivoCompartible(req.body?.folder_id, req.body?.file_id);
    if (!objetivo.ok) { res.status(objetivo.estado!).json({ error: objetivo.error }); return; }
    if (!(await esMiRama(u.sub, objetivo.folderId!))) { res.status(403).json({ error: "no_es_tuyo" }); return; }

    const destinatario = await query<any>(
      "SELECT id FROM gozz.users WHERE id = $1 AND COALESCE(activo, true) = true", [con]
    );
    if (!destinatario[0]) { res.status(404).json({ error: "usuario_no_disponible" }); return; }

    const columna = objetivo.file_id ? "file_id" : "folder_id";
    const fila = await query<any>(
      `INSERT INTO gozz.drive_comparticiones (folder_id, file_id, compartido_con, compartido_por, permiso)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (${columna}, compartido_con) WHERE ${columna} IS NOT NULL
       DO UPDATE SET permiso = EXCLUDED.permiso, compartido_por = EXCLUDED.compartido_por, updated_at = now()
       RETURNING *`,
      [objetivo.folder_id, objetivo.file_id, con, u.sub, permiso]
    );
    // Se devuelve la fila TAL COMO QUEDÓ GUARDADA, no lo que se pidió: así la pantalla pinta el
    // estado de la base y no su propia suposición (§2.8.4).
    res.json({ comparticion: fila[0] });
  });

  /** Cambiar el permiso. `UPDATE`, nunca `DELETE` + `INSERT` (§2.8.1). */
  app.patch("/api/drive/comparticiones/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const permiso = String(req.body?.permiso ?? "");
    if (permiso !== "lector" && permiso !== "editor") { res.status(400).json({ error: "permiso_invalido" }); return; }

    const carpeta = await carpetaDeComparticion(String(req.params.id));
    if (carpeta === "no_existe") { res.status(404).json({ error: "not_found" }); return; }
    if (!carpeta || !(await esMiRama(u.sub, carpeta))) { res.status(403).json({ error: "no_es_tuyo" }); return; }

    const fila = await query<any>(
      "UPDATE gozz.drive_comparticiones SET permiso = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [String(req.params.id), permiso]
    );
    res.json({ comparticion: fila[0] });
  });

  /** Dejar de compartir. Aquí sí se borra la fila: es un permiso vivo, no una bitácora (§0.2). */
  app.delete("/api/drive/comparticiones/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const carpeta = await carpetaDeComparticion(String(req.params.id));
    if (carpeta === "no_existe") { res.status(404).json({ error: "not_found" }); return; }
    if (!carpeta || !(await esMiRama(u.sub, carpeta))) { res.status(403).json({ error: "no_es_tuyo" }); return; }
    await query("DELETE FROM gozz.drive_comparticiones WHERE id = $1", [String(req.params.id)]);
    res.json({ ok: true });
  });

  /**
   * «Compartidos conmigo», agrupado POR PERSONA.
   *
   * «Debería ser algo así como una carpeta por el contacto: si Sarahy me compartió algo, que se le
   * creó una carpeta a Sarahy… pero únicamente si ella ha compartido algo conmigo.» De ahí que se
   * agrupe por quien comparte y que no aparezca nadie que no te haya dado nada.
   */
  app.get("/api/drive/compartidos-conmigo", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const filas = await query<any>(
      `SELECT c.id, c.permiso, c.folder_id, c.file_id, c.created_at,
              us.id AS de_id, us.nombre AS de_nombre, us.email AS de_email,
              df.nombre AS carpeta_nombre,
              da.nombre AS archivo_nombre, da.mime AS archivo_mime, da.size_bytes AS archivo_size
         FROM gozz.drive_comparticiones c
         JOIN gozz.users us ON us.id = c.compartido_por
         LEFT JOIN gozz.drive_folders df ON df.id = c.folder_id AND df.deleted_at IS NULL
         LEFT JOIN gozz.drive_files   da ON da.id = c.file_id   AND da.deleted_at IS NULL
        WHERE c.compartido_con = $1
        ORDER BY us.nombre NULLS LAST, us.email, c.created_at DESC`,
      [u.sub]
    );

    // Lo que el dueño mandó a la papelera desaparece de aquí. La compartición sigue viva —si lo
    // restaura, vuelve—, pero enseñar una fila cuyo destino ya no está sería ofrecer un enlace
    // roto. Por eso los `LEFT JOIN` traen el nombre y se filtra por él.
    const vivos = filas.filter((f: any) => (f.folder_id ? f.carpeta_nombre : f.archivo_nombre) != null);

    const porPersona = new Map<string, any>();
    for (const f of vivos) {
      const g = porPersona.get(f.de_id) ?? { id: f.de_id, nombre: f.de_nombre, email: f.de_email, items: [] };
      g.items.push({
        comparticion_id: f.id,
        permiso: f.permiso,
        tipo: f.folder_id ? "carpeta" : "archivo",
        folder_id: f.folder_id,
        file_id: f.file_id,
        nombre: f.folder_id ? f.carpeta_nombre : f.archivo_nombre,
        mime: f.archivo_mime ?? null,
        size_bytes: f.archivo_size ?? null,
      });
      porPersona.set(f.de_id, g);
    }
    res.json({ personas: [...porPersona.values()], total: vivos.length });
  });

  // Soft-delete archivo (mover a papelera). Admin global o user dueño de la rama.
  app.delete("/api/drive/files/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const rows = await query<any>("SELECT id, folder_id FROM gozz.drive_files WHERE id=$1 AND deleted_at IS NULL", [String(req.params.id)]);
    if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    // Eliminar archivo (a papelera) lo puede hacer quien tenga permiso de ESCRITURA en la carpeta:
    // mismo criterio que subir (oportunidades abiertas a todo el equipo + Mi Drive propio).
    const perm = await canAccessFile(u, rows[0], "write");
    if (!perm.ok) { res.status(perm.reason === "not_found" ? 404 : 403).json({ error: perm.reason }); return; }
    // Nivel 1 = papelera. Invariante: deleted_at set <=> ciclo != 'activo'. Captura origen_ref para el fallback de restore.
    const origen = await resolverOrigenRef(rows[0].folder_id);
    await query(
      "UPDATE gozz.drive_files SET deleted_at = NOW(), deleted_by = $2, ciclo = 'papelera', origen_ref = $3 WHERE id = $1",
      [String(req.params.id), u.sub, JSON.stringify(origen)]
    );
    res.json({ ok: true, soft: true, ciclo: "papelera" });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ENVIAR VARIOS ARCHIVOS A LA PAPELERA — pedido el 2026-08-25
  //
  // «A la hora de seleccionar no me aparece por ningún lado la opción de eliminar o mover a la
  // papelera.» La selección múltiple llegó con la T2 y solo sabía mover.
  //
  // 🔴 ESTO NO BORRA NADA (§0). Es el mismo archivado lógico del borrado de uno: `deleted_at`,
  // `ciclo='papelera'` y `origen_ref` para poder restaurar. Los bytes de R2 no se tocan, y la
  // papelera tiene su propio flujo de restauración. Por eso el diálogo NO pide teclear una
  // palabra (§10.7): la palabra es para lo inmediato E IRREVERSIBLE, y esto se deshace.
  //
  // Se calca del endpoint de mover: permisos de TODOS los orígenes antes de tocar ninguno, una
  // sola fila de `auditoria` con la carpeta de cada archivo, y `resolverOrigenRef` reutilizado —
  // no se inventa aquí una segunda forma de recordar de dónde salió cada cosa.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  app.post("/api/drive/files/papelera", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const idsCrudos = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = Array.from(new Set(idsCrudos.map((x: any) => String(x)).filter((x: string) => UUID_RE.test(x))));

    if (ids.length === 0) { res.status(400).json({ error: "sin_archivos" }); return; }
    if (ids.length > MAX_MOVER) { res.status(400).json({ error: "demasiados", maximo: MAX_MOVER }); return; }

    const archivos = await query<any>(
      `SELECT id, folder_id, nombre FROM gozz.drive_files
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids]
    );
    if (archivos.length === 0) { res.status(404).json({ error: "sin_archivos_vivos" }); return; }

    // 🔴 Todos los permisos antes de archivar ninguno. Media selección en la papelera y media
    // fuera es peor que un rechazo limpio: hay que ir a buscar cuáles pasaron para deshacerlo.
    const origenes = Array.from(new Set(archivos.map((f: any) => String(f.folder_id))));
    for (const origen of origenes) {
      const perm = await canAccessFolder(u, origen, "write");
      if (!perm.ok) { res.status(403).json({ error: perm.reason ?? "forbidden" }); return; }
    }

    // `origen_ref` se resuelve por carpeta, no por archivo: los de la misma carpeta comparten
    // origen y resolverlo N veces sería N consultas para el mismo resultado.
    const refPorCarpeta = new Map<string, any>();
    for (const origen of origenes) refPorCarpeta.set(origen, await resolverOrigenRef(origen));

    const antes = archivos.map((f: any) => ({ id: f.id, folder_id: f.folder_id, nombre: f.nombre }));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const f of archivos) {
        await client.query(
          `UPDATE gozz.drive_files
              SET deleted_at = NOW(), deleted_by = $2, ciclo = 'papelera', origen_ref = $3
            WHERE id = $1`,
          [f.id, u.sub, JSON.stringify(refPorCarpeta.get(String(f.folder_id)))]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // La bitácora, después del commit y sin poder tumbarlo: mismo criterio que en mover.
    try {
      await query(
        `INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
         VALUES ($1, 'drive_archivar_archivos', 'drive_files', $2, $3::jsonb, $4::jsonb)`,
        [u.sub, String(origenes[0]), JSON.stringify({ archivos: antes }), JSON.stringify({ enviados: archivos.length, ciclo: "papelera" })]
      );
    } catch (e: any) {
      console.error("[drive papelera] no se pudo registrar la bitácora:", e?.message);
    }

    res.json({ enviados: archivos.length, ciclo: "papelera" });
  });

  // ==================== PAPELERA (admin only) ====================

  // Papelera Nivel 1 (ciclo='papelera') como LISTA UNIFICADA paginada server-side. Gating: admin.
  //   Contexto (opportunity_id | contact_id | mi_drive=1) restringe al subárbol (igual que antes).
  //   Paginación: ?page=1 ?pageSize=100 (offset/limit + count(*) OVER()).
  //   Filtros: ?kind=folder|file  ?tipo=<taxonomía>  ?usuario=<uuid deleted_by>  ?desde=<ISO> ?hasta=<ISO> (sobre deleted_at).
  //   ?solo_total=1 → { total } del contexto (sin filtros, para el badge). Respuesta: { items, total, page, pageSize, usuarios }.
  app.get("/api/drive/trash", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    let ctxIds: string[] | null = null;
    try {
      const opId = (req.query.opportunity_id || "").toString();
      const contactId = (req.query.contact_id || "").toString();
      const miDrive = ["1", "true"].includes((req.query.mi_drive || "").toString());
      if (opId) { const f = await resolveOportunidadFolder(opId, u.sub); ctxIds = await subtreeFolderIds(f.id); }
      else if (contactId) {
        const cf = await query<any>("SELECT id FROM gozz.drive_folders WHERE tipo='contact' AND contacto_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1", [contactId]);
        ctxIds = cf[0] ? await subtreeFolderIds(cf[0].id) : [];
      } else if (miDrive) { const f = await resolveUserFolder(u.sub, u.sub); ctxIds = await subtreeFolderIds(f.id); }
    } catch (e: any) { res.status(400).json({ error: e?.message }); return; }

    // Badge liviano: total del contexto (sin filtros).
    if (req.query.solo_total) {
      const r = await query<any>(`${TRASH_UNIFICADO_CTE} SELECT count(*)::int AS total FROM u`, [ctxIds]);
      res.json({ total: r[0]?.total ?? 0 });
      return;
    }

    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "100"), 10) || 100));
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const offset = (page - 1) * pageSize;
    const dir = req.query.orden === "asc" ? "ASC" : "DESC"; // literal fijo, no viene del usuario
    const kind = req.query.kind === "folder" || req.query.kind === "file" ? String(req.query.kind) : null;
    const tipo = TIPOS_VALIDOS.has(String(req.query.tipo)) ? String(req.query.tipo) : null;
    const usuario = UUID_RE.test(String(req.query.usuario)) ? String(req.query.usuario) : null;
    const parseFecha = (v: any): string | null => (v && !isNaN(Date.parse(String(v))) ? String(v) : null);
    const desde = parseFecha(req.query.desde);
    const hasta = parseFecha(req.query.hasta);

    // Filas de la página + total filtrado en un solo viaje. El filtro `tipo` solo aplica a archivos.
    const rows = await query<any>(
      `${TRASH_UNIFICADO_CTE}
       SELECT u.*, usr.nombre AS deleted_by_nombre, count(*) OVER() AS total
         FROM u
         LEFT JOIN gozz.users usr ON usr.id = u.deleted_by
        WHERE ($2::text        IS NULL OR u.kind = $2)
          AND ($3::text        IS NULL OR (u.kind = 'file' AND ${kindExpr("u.mime", "u.nombre")} = $3))
          AND ($4::uuid        IS NULL OR u.deleted_by = $4)
          AND ($5::timestamptz IS NULL OR u.deleted_at >= $5)
          AND ($6::timestamptz IS NULL OR u.deleted_at <= $6)
        ORDER BY u.deleted_at ${dir}, u.id
        LIMIT $7 OFFSET $8`,
      [ctxIds, kind, tipo, usuario, desde, hasta, pageSize, offset]
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    const items = rows.map(({ total: _t, ...rest }: any) => rest);

    // Facet de usuarios que eliminaron (para el dropdown), sin acotar por los demás filtros.
    const usuarios = await query<any>(
      `${TRASH_UNIFICADO_CTE}
       SELECT DISTINCT usr.id, usr.nombre
         FROM u JOIN gozz.users usr ON usr.id = u.deleted_by
        ORDER BY usr.nombre`,
      [ctxIds]
    );

    res.json({ items, total, page, pageSize, usuarios });
  });

  // Restaurar carpeta (cascada)
  app.post("/api/drive/trash/restore/folder/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    await query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM gozz.drive_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM gozz.drive_folders f JOIN tree t ON f.parent_id = t.id
       )
       UPDATE gozz.drive_folders SET deleted_at = NULL, deleted_by = NULL WHERE id IN (SELECT id FROM tree)`,
      [String(req.params.id)]
    );
    // Reactiva SOLO los archivos que estaban en papelera (ciclo='papelera'); los que escalaron a
    // cuarentena/conservado NO se tocan (siguen en su nivel). Coherente con el invariante.
    await query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM gozz.drive_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM gozz.drive_folders f JOIN tree t ON f.parent_id = t.id
       )
       UPDATE gozz.drive_files SET deleted_at = NULL, deleted_by = NULL, ciclo = 'activo'
        WHERE folder_id IN (SELECT id FROM tree) AND ciclo = 'papelera'`,
      [String(req.params.id)]
    );
    res.json({ ok: true });
  });

  // Restaurar archivo individual (sirve para papelera / cuarentena / conservado). Resuelve destino con fallback
  // (origen vivo → General del contacto → "Sin ubicación") y colisión de nombre con (N) bajo advisory lock.
  app.post("/api/drive/trash/restore/file/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const rows = await query<any>(
      "SELECT id, folder_id, nombre, origen_ref FROM gozz.drive_files WHERE id=$1 AND deleted_at IS NOT NULL",
      [String(req.params.id)]
    );
    const file = rows[0];
    if (!file) { res.status(404).json({ error: "not_found" }); return; }
    const target = await resolverDestinoRestore(file, u.sub);   // nunca falla, nunca pierde
    // Colisión de nombre bajo el mismo advisory lock que el upload (carpeta + base en minúsculas).
    const { base } = splitNombre(file.nombre);
    const client = await pool.connect();
    let restored: any;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${target}/${base.toLowerCase()}`]);
      const nombre = await resolverNombreUnico(client, target, file.nombre);
      const r = await client.query(
        `UPDATE gozz.drive_files
            SET folder_id=$1, nombre=$2, ciclo='activo', deleted_at=NULL, deleted_by=NULL,
                purgar_en=NULL, conservado_en=NULL, conservado_por=NULL, updated_at=now()
          WHERE id=$3 RETURNING *`,
        [target, nombre, String(req.params.id)]
      );
      restored = r.rows[0];
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, file: restored, folder_id: target });
  });

  // "Borrar" carpeta desde papelera → Nivel 2 CUARENTENA. B1 NO borra físico (ni disco ni R2; eso es B2).
  // Sus archivos en papelera escalan a cuarentena; la carpeta queda soft-deleted (su limpieza física la ve B2).
  app.delete("/api/drive/trash/folder/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const r = await query<any>(
      `WITH RECURSIVE tree AS (
         SELECT id FROM gozz.drive_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM gozz.drive_folders f JOIN tree t ON f.parent_id = t.id
       )
       UPDATE gozz.drive_files SET ciclo = 'cuarentena', purgar_en = now() + interval '30 days'
        WHERE folder_id IN (SELECT id FROM tree) AND ciclo = 'papelera' RETURNING id`,
      [String(req.params.id)]
    );
    res.json({ ok: true, cuarentena: r.length });
  });

  // "Borrar" archivo desde papelera → Nivel 2 CUARENTENA. B1 NO borra físico ni R2.
  app.delete("/api/drive/trash/file/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const r = await query<any>(
      "UPDATE gozz.drive_files SET ciclo = 'cuarentena', purgar_en = now() + interval '30 days' WHERE id = $1 AND ciclo = 'papelera' RETURNING id",
      [String(req.params.id)]
    );
    res.json({ ok: true, cuarentena: r.length });
  });

  // Vaciar papelera → mueve TODO lo que esté en papelera a Nivel 2 CUARENTENA. B1 NO borra físico ni R2.
  app.delete("/api/drive/trash/empty", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const r = await query<any>(
      "UPDATE gozz.drive_files SET ciclo = 'cuarentena', purgar_en = now() + interval '30 days' WHERE ciclo = 'papelera' RETURNING id",
      []
    );
    res.json({ ok: true, cuarentena: r.length });
  });

  // Nivel 2 (admin): cuarentena + conservados.
  app.get("/api/drive/trash/cuarentena", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const files = await query<any>(
      `SELECT df.id, df.nombre, df.mime, df.size_bytes, df.ciclo, df.purgar_en, df.conservado_en,
              df.deleted_at, df.deleted_by, du.nombre AS deleted_by_nombre,
              df.conservado_por, cu.nombre AS conservado_por_nombre,
              df.folder_id, df.origen_ref
         FROM gozz.drive_files df
         LEFT JOIN gozz.users du ON du.id = df.deleted_by
         LEFT JOIN gozz.users cu ON cu.id = df.conservado_por
        WHERE df.ciclo IN ('cuarentena','conservado')
        ORDER BY df.ciclo, df.purgar_en NULLS LAST, df.deleted_at DESC`
    );
    res.json({ files });
  });

  // Conservar (admin): saca un archivo de cuarentena y lo marca conservado (sin vencimiento).
  app.post("/api/drive/trash/conservar/file/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const r = await query<any>(
      "UPDATE gozz.drive_files SET ciclo = 'conservado', conservado_en = now(), conservado_por = $2, purgar_en = NULL WHERE id = $1 AND ciclo = 'cuarentena' RETURNING id",
      [String(req.params.id), u.sub]
    );
    if (!r.length) { res.status(404).json({ error: "not_found_or_not_cuarentena" }); return; }
    res.json({ ok: true, ciclo: "conservado" });
  });

  // Borrado PERMANENTE (admin) de una fila del Drive en cuarentena/conservado. ⚠️ IRREVERSIBLE: corre el núcleo
  // de purga (bitácora + DELETE de la fila + borrado del objeto R2 SOLO si es huérfano). Fase B2.
  app.delete("/api/drive/trash/purge/file/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!isAdminUser(u)) { res.status(403).json({ error: "admin_only" }); return; }
    const id = String(req.params.id);
    const row = (await query<any>("SELECT id, ciclo FROM gozz.drive_files WHERE id = $1", [id]))[0];
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    if (row.ciclo !== "cuarentena" && row.ciclo !== "conservado") {
      res.status(400).json({ error: "solo_cuarentena_o_conservado" }); return;
    }
    try {
      const r = await purgeDriveFiles([id], { origen: "manual", borradoPor: u.sub });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      console.error("[drive purge manual]", e?.message);
      res.status(500).json({ error: e?.message || "purge_failed" });
    }
  });
}

function isAdminUser(u: { nivel?: string }): boolean {
  return u?.nivel === "super_admin" || u?.nivel === "admin";
}

// Permite editar/eliminar si:
// - es admin (cualquier carpeta no estructural), o
// - la carpeta cae bajo el "user folder" del propio usuario (Mi Drive personal).
async function canEditFolder(user: { sub: string; nivel: string }, folder: Folder): Promise<boolean> {
  if (isAdminUser(user)) return true;
  // Buscar el user folder en la cadena ancestral
  const chain = await getAncestors(folder.id);
  const userFolder = chain.find((f) => f.tipo === "user");
  return !!(userFolder && userFolder.owner_user_id === user.sub);
}
