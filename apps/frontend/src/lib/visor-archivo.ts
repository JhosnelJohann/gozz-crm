// ============================================================================================
// QUÉ SABE PINTAR EL VISOR DE ARCHIVOS — la clasificación, aparte del componente
//
// Había DOS visores en el proyecto y no eran el mismo peor hecho: cada uno sabía cosas que el otro
// no. `FilePreviewModal` extraía Word, Excel y PowerPoint **en el servidor**; la página `/view`
// reproducía **vídeo y audio** y pintaba **CSV**, que la modal no sabía hacer.
//
// 🔴 POR ESO ESTO ESTÁ AQUÍ Y CON PRUEBAS. Fusionar los dos visores es fusionar dos conjuntos de
// capacidades, y la forma de estropearlo no es un error de compilación: es que una extensión caiga
// en la rama de «descargar» y el chat deje de reproducir notas de voz **sin que nada falle**. Nadie
// se entera hasta que alguien manda un audio.
//
// La otra mitad de la decisión es si hay `id` de Drive:
//   · CON id  → se puede llamar a `/api/drive/files/:id/extract`, que es lo que saca el texto de un
//               Word, las hojas de un Excel y las diapositivas de un PowerPoint.
//   · SIN id  → solo lo que el navegador pinta por sí mismo. Para ofimática, descarga.
//
// 🔴 Y NO SE INVENTA UN VISOR EXTERNO PARA TAPAR ESE HUECO. La página `/view` lo intentaba con
// `view.officeapps.live.com` y `docs.google.com`, y **no funcionaba**: `/uploads` y `/raw` exigen
// sesión, así que esos servidores recibían un 401 y no veían nada. Lo único que conseguía era
// mandarle a dos terceros la URL interna del CRM en cada apertura de un `.pptx`.
// ============================================================================================

export interface OrigenArchivo {
  /** De dónde se bajan los bytes. Siempre hay una. */
  url: string;
  nombre: string;
  mime: string | null;
  /** El id de Drive, si el archivo es del Drive. Es lo que habilita la extracción en servidor. */
  id?: string;
}

export type ModoVisor =
  | "pdf"
  | "imagen"
  | "video"
  | "audio"
  | "csv"
  | "texto"
  /** HTML pintado como pagina, dentro de un iframe aislado. Ver `clasificarParaVisor`. */
  | "html"
  /** Ofimática con id: el servidor la convierte (`/extract`). */
  | "extraccion"
  /** No se sabe pintar aquí: se ofrece descargar, diciendo por qué. */
  | "descarga";

const ext = (nombre: string): string =>
  ((nombre || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

/** Las listas salen de `app/view/page.tsx`, que es donde estaban probadas por el uso. */
const EXT_IMAGEN = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
const EXT_VIDEO = ["mp4", "webm", "mov"];
const EXT_AUDIO = ["mp3", "wav", "ogg", "m4a"];
const EXT_CSV = ["csv", "tsv"];
const EXT_TEXTO = ["md", "txt", "log", "json", "xml", "yaml", "yml", "js", "ts", "tsx", "jsx", "css", "sh", "py"];
/**
 * 🔴 `html` SALIO de `EXT_TEXTO` en la T4 (2026-08-24). Estaba ahi, asi que un HTML se pintaba
 * como codigo fuente: se veian las etiquetas, no la pagina. «Necesito un visor de HTML porque hay
 * muchos que me botan HTML… me toca descargarlo y verlo en la computadora.»
 */
const EXT_HTML = ["html", "htm"];
const EXT_OFIMATICA = ["doc", "docx", "rtf", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp"];

/** ¿Es un formato de ofimática? Se mira aparte porque su respuesta depende de si hay `id`. */
export function esOfimatica(nombre: string, mime: string | null): boolean {
  const e = ext(nombre);
  const m = (mime || "").toLowerCase();
  if (EXT_OFIMATICA.includes(e)) return true;
  return ["wordprocessingml", "msword", "spreadsheetml", "excel", "presentationml", "powerpoint"]
    .some((t) => m.includes(t));
}

/**
 * Cómo hay que pintar este archivo.
 *
 * ⚠️ SE MIRA LA EXTENSIÓN ADEMÁS DEL MIME, y no es redundante: los archivos importados de
 * Pipedrive, Zoho y Bitrix llegan con `mime` nulo muy a menudo, y son justo los que más se abren.
 * Mirando solo el mime, medio Drive caería en «descargar».
 *
 * ⚠️ El `.webm` es de vídeo Y de audio. Se resuelve como vídeo, que es lo que hacía `/view`: un
 * `<video>` con una pista de solo audio se oye igual, mientras que un `<audio>` con vídeo dentro
 * no se ve. Ante la duda, la opción que no pierde nada.
 */
export function clasificarParaVisor(o: { nombre: string; mime: string | null; id?: string }): ModoVisor {
  const e = ext(o.nombre);
  const m = (o.mime || "").toLowerCase();

  if (e === "pdf" || m === "application/pdf") return "pdf";
  if (EXT_IMAGEN.includes(e) || m.startsWith("image/")) return "imagen";
  if (EXT_VIDEO.includes(e) || m.startsWith("video/")) return "video";
  if (EXT_AUDIO.includes(e) || m.startsWith("audio/")) return "audio";
  // Antes que `texto`: `html` estaba en aquella lista y ganaba, que es por lo que se veia el
  // codigo en vez de la pagina.
  if (EXT_HTML.includes(e) || m === "text/html") return "html";
  if (EXT_CSV.includes(e)) return "csv";
  if (EXT_TEXTO.includes(e) || m === "text/plain" || m === "text/markdown") return "texto";

  // 🔴 La única rama que depende del `id`. Sin él no hay a quién pedirle la conversión, así que se
  // ofrece descargar en vez de fingir una vista previa que no existe.
  if (esOfimatica(o.nombre, o.mime)) return o.id ? "extraccion" : "descarga";

  return "descarga";
}

/**
 * ¿Hace falta bajarse el contenido como texto para pintarlo?
 *
 * `html` tambien: se baja y se mete en el `srcdoc` de un iframe AISLADO. No se apunta el iframe a
 * la URL del archivo, y esa diferencia es la que importa — servido desde nuestro propio origen, un
 * HTML subido por cualquiera correria en el contexto del CRM.
 */
export const necesitaTexto = (modo: ModoVisor): boolean => modo === "csv" || modo === "texto" || modo === "html";

/**
 * Parte un CSV en filas y columnas para pintarlo como tabla.
 *
 * Corta a 500 filas, igual que hacía `/view`: un CSV de exportación puede traer decenas de miles y
 * pintarlas todas cuelga la pestaña. Se dice en pantalla cuando se ha cortado — un recorte
 * silencioso haría creer que el archivo tiene menos datos de los que tiene.
 */
export const MAX_FILAS_CSV = 500;

export function filasDeCsv(contenido: string): { filas: string[][]; recortado: boolean } {
  const todas = (contenido || "").split(/\r?\n/).filter((l) => l.length > 0);
  return { filas: todas.slice(0, MAX_FILAS_CSV).map((l) => l.split(",")), recortado: todas.length > MAX_FILAS_CSV };
}
