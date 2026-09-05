// ============================================================================================
// LO QUE COMPARTEN LOS DOS TABLEROS DE TAREAS
//
// Hay dos: `KanbanTareas` (por estado) y `TareasPorFecha` (por fecha límite). Se escribieron por
// separado y no compartían **nada**, y eso ya salió caro una vez: el fallo de las canceladas que
// desaparecían era, en el fondo, que un tablero buscaba la tarea en una lista y no en las tres.
// Al darle arrastre al segundo tablero habría habido dos copias del mismo mecanismo con las mismas
// tres formas de equivocarse. Aquí está la versión única.
//
// Lo que NO está aquí es el aspecto de las tarjetas: son distintas a propósito —la de fecha lleva
// el botón de completar y la fecha en largo— y unificarlas sería un rediseño, no una extracción.
// ============================================================================================

import type { TareaRow } from "@/components/tareas/TaskCard";

/**
 * Cuántos píxeles hay que arrastrar antes de que empiece el arrastre.
 *
 * No es un detalle estético: las tarjetas también se pulsan para abrir la ficha, y sin este umbral
 * un clic con un temblor de un píxel se interpreta como arrastre y la tarea no se abre.
 */
export const DISTANCIA_ARRASTRE = 6;

/**
 * 🔴 Busca una tarea en TODAS las listas que le pases, no solo en la activa.
 *
 * El listado por defecto excluye completadas y canceladas —son 25.000+ filas—, así que llegan por
 * su propia petición. Un tablero que solo mire `tareas` no encuentra una cancelada, y arrastrarla
 * de vuelta a «Pendiente» no hace nada: es exactamente el «no se puede recuperar» que esta tanda
 * vino a arreglar. Que la búsqueda tenga un solo sitio es lo que evita que vuelva a pasar.
 */
export function buscarEnListas(id: string, ...listas: (TareaRow[] | undefined)[]): TareaRow | null {
  for (const lista of listas) {
    const t = lista?.find((x) => x.id === id);
    if (t) return t;
  }
  return null;
}

/**
 * Un repartidor que no mete la misma tarea dos veces.
 *
 * Hace falta porque justo después de mover una tarea la recarga la trae por **dos** caminos: sigue
 * en la lista activa que ya estaba en memoria y además llega en la carga aparte de completadas o
 * canceladas. Sin deduplicar, la tarjeta aparece repetida y el contador miente.
 */
export function agruparSinRepetir<K extends string>(claves: readonly K[]) {
  const grupos = Object.fromEntries(claves.map((k) => [k, [] as TareaRow[]])) as Record<K, TareaRow[]>;
  const vistos = new Set<string>();
  const poner = (t: TareaRow, k: K) => {
    if (vistos.has(t.id)) return;
    vistos.add(t.id);
    grupos[k].push(t);
  };
  return { grupos, poner };
}

/**
 * Lo único que un arrastre puede cambiar.
 *
 * Casi siempre va UN campo: mover de columna en un tablero no puede tocar lo que el otro tablero
 * enseña. La excepción es **retomar** una tarea dada por terminada, que la devuelve a «pendiente»
 * y le pone plazo a la vez.
 *
 * 🔴 Los dos campos van en UNA sola petición, y por eso la tercera variante existe. Encadenar dos
 * llamadas dejaría la tarea reabierta sin plazo, o con plazo y todavía cancelada, si la segunda
 * fallara — y nadie sabría cuál de las dos pasó.
 */
export type CambioDeTarea =
  | { estado: TareaRow["estado"] }
  | { fecha_limite: string | null }
  | { estado: TareaRow["estado"]; fecha_limite: string | null };

/**
 * Manda el cambio y dice si se guardó. No enseña el aviso: cada tablero dice una cosa distinta
 * —uno el estado nuevo, el otro la fecha exacta— y meterlo aquí obligaría a pasarle el texto.
 *
 * ⚠️ Sin prueba automática: es una llamada de red y `apps/frontend` solo tiene pruebas de lógica
 * pura (FASE 1, `CONVENCIONES §9.1`). Se comprueba en el guion de staging.
 */
export async function guardarCambioDeTarea(id: string, cambio: CambioDeTarea): Promise<boolean> {
  const r = await fetch(`/api/tareas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambio),
  });
  return r.ok;
}

// ============================================================================================
// 🔴 UNA TARJETA NO PUEDE QUEDARSE INVISIBLE
//
// Los dos tableros ocultaban la tarjeta de origen mientras se arrastra, para que no se viera
// duplicada con la copia que sigue al puntero (`DragOverlay`). Lo hacían con `opacity: 0` atado a
// `isDragging`, que es **estado interno de dnd-kit**: si ese estado se queda encendido por lo que
// sea, la tarjeta desaparece de la pantalla y no vuelve.
//
// Visto en staging: la columna Canceladas marcaba 2 y solo se veía una; en el DOM estaban las dos,
// y la que no se veía tenía `style="opacity: 0; transform: none;"`.
//
// Una tarea que existe y no se ve es PEOR que una que se ve mal: quien la buscaba cree que la ha
// perdido. Es el mismo daño que la tanda anterior cerró con las canceladas que desaparecían.
//
// Por eso la opacidad deja de poder valer 0. Se atenúa lo justo para distinguirla de la copia que
// va con el puntero, y **el peor caso posible pasa a ser una tarjeta pálida** —que se ve, se pulsa
// y se puede volver a arrastrar— en vez de una tarjeta que no está.
// ============================================================================================

/**
 * Lo pálida que se ve la tarjeta de origen mientras se arrastra su copia.
 *
 * ⚠️ El valor importa por los dos lados: suficientemente baja para que se note cuál se está
 * moviendo, y **nunca 0**.
 */
export const OPACIDAD_ARRASTRANDO = 0.35;

/**
 * La opacidad de una tarjeta del tablero.
 *
 * 🔴 NO DEVUELVE 0 PARA NINGUNA ENTRADA, y esa es toda la función. Es una línea de código con una
 * prueba encima porque la garantía no está en lo que calcula, sino en lo que **no puede** devolver.
 */
export function opacidadDeTarjeta(arrastrando: boolean): number {
  return arrastrando ? OPACIDAD_ARRASTRANDO : 1;
}
