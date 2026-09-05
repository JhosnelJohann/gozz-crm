// ============================================================================================
// LOS ARCHIVOS DE UNA CONVERSACIÓN — para poder recorrerlos con las flechas del visor
//
// El visor (`FilePreviewModal`) sabe navegar desde siempre: acepta `onPrev`, `onNext` y `posicion`,
// y las usan el Drive, la papelera y la ficha del contacto. **El chat no se las pasaba**, y no
// podía: montaba un visor dentro de cada mensaje, y un mensaje no tiene forma de saber qué otros
// archivos hay en la conversación. Se adjuntan seis documentos, se abre uno, y no hay manera de
// llegar al siguiente sin cerrar y buscarlo a mano.
//
// El chat ya había resuelto esto para las IMÁGENES (`IMAGES_IN_MSGS` en `ChatMessages.tsx`), con su
// lightbox y su «3 / 6». Lo que no es imagen se quedó sin equivalente.
//
// 🔴 POR QUÉ EL PREDICADO VIVE AQUÍ Y NO SUELTO EN EL COMPONENTE. La lista que recorren las flechas
// y la lista de mensajes que pintan una tarjeta de archivo tienen que ser LA MISMA. Si divergen, el
// «2 / 6» miente y la flecha te lleva a un archivo distinto del que enseña la miniatura de al lado.
// Es la misma regla que `CONVENCIONES §4.8`: quien clasifica y quien recorre comparten la frontera.
// ============================================================================================

/** Lo mínimo que hace falta de un mensaje. Se pide así, y no `ChatMensaje` entero, para que esto
 *  no dependa del componente y se pueda probar sin navegador. */
export interface MensajeConPosibleArchivo {
  id: string;
  tipo: string;
  archivo_url: string | null;
}

/**
 * ¿Este mensaje pinta una tarjeta de archivo?
 *
 * ⚠️ Imagen, vídeo y audio quedan fuera **a propósito**: el chat los reproduce dentro de la propia
 * burbuja, y las imágenes tienen además su propio visor con zoom. Meterlos aquí mezclaría dos
 * recorridos y haría que la flecha saltara de un PDF a una nota de voz.
 */
export function esMensajeDeArchivo<T extends MensajeConPosibleArchivo>(
  m: T,
): m is T & { archivo_url: string } {
  // Es un predicado de tipo, no un `boolean` a secas, y no es adorno: asi quien lo use se queda con
  // `archivo_url` ya estrechado a `string` y no necesita un `!` que apague al compilador justo
  // donde este si sabia algo.
  return !!m.archivo_url && m.tipo !== "imagen" && m.tipo !== "video" && m.tipo !== "audio";
}

/** Los archivos de la conversación, en el orden en que están en la conversación. */
export function archivosDeLaConversacion<T extends MensajeConPosibleArchivo>(
  mensajes: T[],
): (T & { archivo_url: string })[] {
  return (mensajes || []).filter(esMensajeDeArchivo);
}

/** Dónde está el archivo abierto dentro del recorrido. `null` si ya no está — porque lo borraron
 *  mientras se miraba, que en un chat en vivo pasa. */
export function posicionDeArchivo(
  lista: MensajeConPosibleArchivo[],
  id: string | null,
): { indice: number; total: number } | null {
  if (!id) return null;
  const indice = lista.findIndex((m) => m.id === id);
  return indice < 0 ? null : { indice, total: lista.length };
}

/**
 * El id del archivo `paso` posiciones más allá, o `null` si no hay.
 *
 * 🔴 NO DA LA VUELTA. En los extremos devuelve `null` y el visor desactiva la flecha, igual que en
 * el Drive y en la ficha del contacto. (El lightbox de imágenes del chat sí da la vuelta; es otra
 * decisión, más vieja, y no se toca aquí.)
 *
 * ⚠️ Se trabaja con el **id**, no con el índice. Es chat en vivo: si llega o se borra un mensaje
 * mientras el visor está abierto, un índice guardado apunta de pronto a otro archivo y te lo cambia
 * bajo el cursor. El id no.
 */
export function vecinoDeArchivo(
  lista: MensajeConPosibleArchivo[],
  id: string | null,
  paso: number,
): string | null {
  const pos = posicionDeArchivo(lista, id);
  if (!pos) return null;
  const destino = pos.indice + paso;
  if (destino < 0 || destino >= pos.total) return null;
  return lista[destino].id;
}
