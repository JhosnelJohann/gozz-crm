// ============================================================================================
// ¿ESTE ARCHIVO PODRIA TENER MINIATURA?
//
// La respuesta de verdad la tiene el SERVIDOR: `GET /api/drive/files/:id/thumb` responde 404 para
// lo que no sabe rasterizar. Esto es solo la conjetura del cliente, y sirve para dos cosas:
//   · no pedir una miniatura de un `.docx`, que seria una peticion garantizada a 404 por cada
//     tarjeta de la galeria;
//   · pintar el icono directamente en vez de un hueco que se rellena y luego se descarta.
//
// ⚠️ ES UNA CONJETURA, NO LA REGLA. Si esto y el servidor discrepan, gana el servidor: el `onError`
// del `<img>` cae al icono. Por eso puede permitirse ser aproximada — lo que NO puede es ser
// optimista con tipos que el servidor rechaza siempre, porque eso son peticiones a 404 en cadena.
//
// 🔴 HEIC NO ENTRA, igual que en el servidor (`lib/drive-thumbs.ts`). Ningun navegador los pinta y
// `sharp` no los lee sin libheif, asi que su miniatura no existe y no existira en esta etapa.
// Cualquier regla del tipo «empieza por `image/`» los aceptaria, porque su mime es `image/heic`:
// por eso aqui la lista de lo que se acepta es EXPLICITA.
// ============================================================================================

/** Las mismas extensiones que el servidor sabe reducir. Sin `heic`, sin `svg`. */
const EXTENSIONES_CON_MINIATURA = ["jpg", "jpeg", "png", "webp", "gif", "pdf"];

/**
 * ¿Merece la pena pedirle la miniatura al servidor?
 *
 * Mira la extension ADEMAS del mime porque **el mime falta a menudo**: los documentos importados
 * de Pipedrive y Zoho —que son justo los de la ficha del contacto— llegan con `mime` nulo. Con
 * solo el mime, esa galeria no pediria ni una miniatura y se quedaria como estaba.
 */
export function puedeTenerMiniatura(mime: string | null | undefined, nombre: string | null | undefined): boolean {
  const ext = ((nombre || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (EXTENSIONES_CON_MINIATURA.includes(ext)) return true;

  const m = (mime || "").toLowerCase().trim();
  if (m === "application/pdf") return true;
  if (m === "image/jpg") return true; // variante no estandar que aparece en datos importados
  return m.startsWith("image/") && EXTENSIONES_CON_MINIATURA.includes(m.slice("image/".length));
}

/**
 * De donde se piden los bytes de una miniatura.
 *
 * 🔴 SON DOS CAMINOS Y NO SON EQUIVALENTES:
 *
 *   · CON id de Drive → `/api/drive/files/:id/thumb`, que devuelve **~320 px**. Medido sobre un
 *     fichero real: 8,7 KB frente a los 291,6 KB del original. Es lo que se quiere siempre que se
 *     pueda.
 *
 *   · SIN id, con una URL directa → **esa URL, que sirve el ARCHIVO ENTERO**. Es peor y se sabe.
 *     Se usa igualmente porque la alternativa es no ensenar nada: el panel de archivos sin
 *     identificar sirve tambien ficheros de `/uploads/`, que no estan en `drive_files` y para los
 *     que **no existe endpoint de miniatura**. Arreglar el peso quitandole la vista previa a esa
 *     rama no seria un arreglo.
 *
 *     Montar un `/thumb` para `/uploads` es otra entrega: implica decidir donde se cachean esas
 *     derivadas —no hay `sha256` con el que componer la clave— y eso no se improvisa aqui.
 *
 * Nunca las dos: el `id` manda, porque cuando existe siempre es la opcion barata.
 */
export function urlDeMiniatura(o: { id?: string | null; urlDirecta?: string | null }): string | null {
  if (o.id) return `/api/drive/files/${o.id}/thumb`;
  return o.urlDirecta || null;
}

/** ¿Esta miniatura baja el archivo entero? Solo para poder decirlo donde toque. */
export const bajaElArchivoEntero = (o: { id?: string | null; urlDirecta?: string | null }): boolean =>
  !o.id && !!o.urlDirecta;
