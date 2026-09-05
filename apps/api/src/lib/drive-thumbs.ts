import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ============================================================================================
// MINIATURAS DE LOS ARCHIVOS DEL DRIVE — la derivada, nunca el original
//
// Hasta ahora la galeria pintaba `<img src=".../raw">`, y `/raw` devuelve el ARCHIVO ENTERO: una
// tarjeta de 200 px descargaba el JPG completo. Esto genera una imagen pequenia de verdad.
//
// El fichero esta partido en dos mitades a proposito:
//   · las DECISIONES son funciones puras y exportadas —que herramienta toca, si pasa el tope, cual
//     es la clave de cache—, y por tanto se prueban sin `sharp`, sin `pdftoppm` y sin red;
//   · la GENERACION toca binarios y ficheros, y se prueba simulandola.
// La suite no puede depender de que la maquina que la corre tenga poppler instalado.
//
// ⚠️ DEPENDENCIA DE SISTEMA: `pdftoppm` (paquete `poppler-utils`) NO esta en el repositorio. Hoy
// esta en el servidor; una maquina reconstruida podria no tenerlo. Por eso su ausencia **degrada a
// 404**, nunca revienta: ver `rasterizarPdf`.
// ============================================================================================

/**
 * Un solo ancho, constante del SERVIDOR.
 *
 * No se acepta un `?w=` del cliente: un ancho libre multiplica el cache —un objeto en R2 por cada
 * numero que se le ocurra a alguien— y convierte el endpoint en una forma de generar trabajo a
 * voluntad. Si algun dia hacen falta dos tamanios, seran dos constantes de aqui.
 */
export const ANCHO_MINIATURA = 320;

/**
 * Por encima de esto no se rasteriza: 404, y la galeria ensenia el icono.
 *
 * Sin tope, una peticion cuesta lo que quiera quien la hace. Se comprueba contra `size_bytes` de la
 * fila, ANTES de leer un solo byte del objeto.
 */
export const TAMANO_MAXIMO_ENTRADA = 25 * 1024 * 1024;

/** Cuantas generaciones pueden estar en marcha a la vez. Ver `conSemaforo`. */
export const MAX_GENERACIONES_SIMULTANEAS = 4;

/** Segundos que se le dan a `pdftoppm` antes de darlo por perdido. */
const TIMEOUT_PDFTOPPM_MS = 10_000;

export type Herramienta = "sharp" | "pdftoppm";

/** Extensiones de imagen que `sharp` sabe leer SIN plugins. `heic` NO esta, y es deliberado. */
const EXTENSIONES_IMAGEN = ["jpg", "jpeg", "png", "webp", "gif"];

/**
 * Que herramienta rasteriza este archivo, o `null` si no se sabe.
 *
 * 🔴 NO PASA POR `resolveMime`, Y ESA ES LA PARTE IMPORTANTE. `EXT_TO_MIME` mapea `heic` a
 * `image/heic`, asi que cualquier regla del tipo «empieza por `image/`» aceptaria los HEIC — y
 * ni el navegador los pinta ni `sharp` los lee sin libheif. Aqui la lista de lo que se acepta es
 * EXPLICITA: se dice lo que entra, no lo que se descarta.
 *
 * HEIC devolviendo `null` (y por tanto 404 → icono) no es un pendiente: es la respuesta correcta.
 *
 * ⚠️ Mira el mime declarado Y la extension porque **el mime falta a menudo**: los archivos
 * importados de Pipedrive y Zoho llegan con `mime` nulo, y son justo los que se ven en la ficha
 * del contacto. Con solo el mime, la galeria del contacto no ensenaria ni una miniatura.
 */
export function elegirHerramienta(nombre: string, mime: string | null | undefined): Herramienta | null {
  const m = (mime || "").toLowerCase().trim();
  const ext = ((nombre || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

  if (m === "application/pdf" || ext === "pdf") return "pdftoppm";

  // `image/heic` cae aqui y NO se acepta: la comprobacion del mime se hace contra la misma lista
  // de extensiones, no contra el prefijo `image/`.
  if (EXTENSIONES_IMAGEN.includes(ext)) return "sharp";
  if (m.startsWith("image/") && EXTENSIONES_IMAGEN.includes(m.slice("image/".length))) return "sharp";
  if (m === "image/jpg") return "sharp"; // variante no estandar que aparece en datos importados

  return null;
}

/** ¿Pasa del tope? Un tamanio ausente o ilegible NO se considera excedido: se intentara y ya. */
export function superaElTope(sizeBytes: unknown): boolean {
  const n = typeof sizeBytes === "number" ? sizeBytes : Number(sizeBytes);
  return Number.isFinite(n) && n > TAMANO_MAXIMO_ENTRADA;
}

/**
 * La clave de la miniatura en R2, o `null` si este archivo NO se puede cachear.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 SI NO HAY `sha256`, NO HAY CLAVE. Y NO SE INVENTA UNA.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `drive_files.sha256` es TEXT **NULLABLE** (migracion 0025): hay filas antiguas sin hash. La
 * tentacion es componer la clave con el `id`, con el nombre o con el `r2_key`. No se hace, y el
 * motivo no es de estilo:
 *
 * La clave es **content-addressed**: `thumbs/<sha>/320.jpg` significa "la miniatura DE ESTE
 * CONTENIDO". Es lo que hace que el mismo archivo en dos carpetas comparta una sola miniatura. Una
 * clave basada en cualquier otra cosa rompe esa promesa, y una clave de cache equivocada **sirve
 * la miniatura de OTRO documento**. En un CRM de inmigracion eso es ensenarle a alguien el
 * pasaporte de otra persona.
 *
 * Asi que sin hash se genera al vuelo y se sirve **sin cachear**: cuesta CPU en cada peticion, y
 * es el precio correcto.
 */
export function claveMiniatura(sha256: string | null | undefined): string | null {
  const sha = (sha256 || "").trim();
  if (!sha) return null;
  return `thumbs/${sha}/${ANCHO_MINIATURA}.jpg`;
}

export type Decision =
  | { ok: true; herramienta: Herramienta; clave: string | null }
  | { ok: false; motivo: "tipo_no_soportado" | "demasiado_grande" };

/**
 * Todo lo que se puede decidir MIRANDO SOLO LA FILA, antes de tocar un byte.
 *
 * Existe para que la ruta no tenga que encadenar tres comprobaciones a mano y para que ese orden
 * —primero el tipo, luego el tamanio— quede probado en un sitio. El tope se mira antes de leer el
 * objeto: si se leyera primero, el tope no protegeria de nada.
 */
export function decidir(f: { nombre: string; mime: string | null; size_bytes: unknown; sha256: string | null }): Decision {
  const herramienta = elegirHerramienta(f.nombre, f.mime);
  if (!herramienta) return { ok: false, motivo: "tipo_no_soportado" };
  if (superaElTope(f.size_bytes)) return { ok: false, motivo: "demasiado_grande" };
  return { ok: true, herramienta, clave: claveMiniatura(f.sha256) };
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// LA GENERACION — de aqui para abajo se tocan binarios y disco
// ────────────────────────────────────────────────────────────────────────────────────────────

let enCurso = 0;
const cola: Array<() => void> = [];

/**
 * Semaforo: como mucho `MAX_GENERACIONES_SIMULTANEAS` a la vez. Por encima se ESPERA, no se
 * rechaza — quien abre una ficha con 30 documentos quiere sus miniaturas, solo que no todas a la
 * vez.
 *
 * Rasterizar es CPU pura y `pdftoppm` es un proceso del sistema por cada PDF. Sin esto, dos fichas
 * grandes abiertas a la vez ponen de rodillas la API **que atiende todo lo demas**: el CRM entero
 * se arrastraria porque alguien esta mirando fotos.
 */
export async function conSemaforo<T>(fn: () => Promise<T>): Promise<T> {
  if (enCurso >= MAX_GENERACIONES_SIMULTANEAS) {
    await new Promise<void>((resolve) => cola.push(resolve));
  }
  enCurso++;
  try {
    return await fn();
  } finally {
    enCurso--;
    const siguiente = cola.shift();
    if (siguiente) siguiente();
  }
}

/**
 * Reduce una imagen con `sharp`.
 *
 * 🔴 `limitInputPixels` NO se toca. Es la defensa de `sharp` contra una imagen pequenia en disco
 * que descomprime a gigas en memoria (una "bomba de descompresion"): desactivarlo convierte una
 * peticion de 100 KB en un proceso muerto por OOM. `withoutEnlargement` evita agrandar lo que ya
 * era mas pequenio que la miniatura, que gastaria bytes sin anadir nada.
 */
async function reducirImagen(buf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buf)
    .resize({ width: ANCHO_MINIATURA, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
}

/**
 * Rasteriza la PAGINA 1 de un PDF con `pdftoppm`.
 *
 * 🔴 `execFile`, NUNCA `exec` ni una cadena de shell: con `execFile` los argumentos van como
 * vector al proceso y no los interpreta ningun shell, asi que no hay inyeccion posible. Y el
 * nombre del archivo del usuario **no entra ni en la orden ni en la ruta**: los bytes se escriben
 * en un directorio temporal nuestro con un nombre que ponemos nosotros.
 *
 * Devuelve `null` —nunca lanza— cuando el binario no esta (ENOENT), cuando salta el timeout o
 * cuando el PDF no da pagina. La ruta lo traduce a 404 y la galeria ensenia el icono. `pdftoppm`
 * es un paquete del sistema que no controla el repositorio: darlo por hecho es como se rompe una
 * API el dia que alguien levanta una maquina nueva.
 */
async function rasterizarPdf(buf: Buffer): Promise<Buffer | null> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "crm-thumb-"));
  const entrada = path.join(dir, "entrada.pdf");
  const prefijoSalida = path.join(dir, "salida");

  try {
    await fs.promises.writeFile(entrada, buf);
    await execFileAsync(
      "pdftoppm",
      ["-jpeg", "-f", "1", "-l", "1", "-scale-to", String(ANCHO_MINIATURA), entrada, prefijoSalida],
      { timeout: TIMEOUT_PDFTOPPM_MS, maxBuffer: 1024 * 1024 }
    );

    // `pdftoppm` numera la salida y cuantos digitos usa depende del total de paginas
    // (`salida-1.jpg`, `salida-01.jpg`…), asi que se busca en vez de adivinar el nombre.
    const generados = (await fs.promises.readdir(dir)).filter((n) => n.startsWith("salida") && n.endsWith(".jpg"));
    if (generados.length === 0) return null;
    return await fs.promises.readFile(path.join(dir, generados.sort()[0]));
  } catch (e: any) {
    const porQue = e?.code === "ENOENT"
      ? "pdftoppm no esta instalado (paquete del sistema poppler-utils)"
      : e?.killed ? "pdftoppm agoto el tiempo" : e?.message;
    console.warn("[drive/thumb] no se pudo rasterizar el PDF:", porQue);
    return null;
  } finally {
    // Pase lo que pase: un temporal que sobrevive a un error se acumula hasta llenar el disco.
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Genera la miniatura. Devuelve `null` si no se pudo — nunca lanza por culpa del contenido.
 *
 * Un archivo corrupto es un caso corriente en datos importados, no una emergencia: si `sharp` no
 * puede con el, se responde 404 y la galeria pinta el icono, igual que con un `.docx`.
 */
export async function generarMiniatura(buf: Buffer, herramienta: Herramienta): Promise<Buffer | null> {
  return conSemaforo(async () => {
    if (herramienta === "pdftoppm") return rasterizarPdf(buf);
    try {
      return await reducirImagen(buf);
    } catch (e: any) {
      console.warn("[drive/thumb] no se pudo reducir la imagen:", e?.message);
      return null;
    }
  });
}
