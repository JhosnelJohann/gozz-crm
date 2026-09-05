// ============================================================================================
// EL NOMBRE QUE SE LEE EN EL ENCABEZADO DE UN CONTACTO
//
// El encabezado dejó de ser un campo que se teclea y pasó a ser una ETIQUETA: la composición de
// `nombre` + `segundo_nombre` + `apellido`, que son los campos de Información personal. Se edita
// abajo y se ve arriba, en vez de haber dos verdades sobre cómo se llama alguien.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL RESPALDO ES LO QUE HACE SEGURO EL CAMBIO, Y NO ES UN ADORNO
// ════════════════════════════════════════════════════════════════════════════════════════════
// `buildNombreCompleto` (en la API) COMPONE `nombre_completo` a partir de las partes, pero **el
// camino inverso no existe**: nada ha repartido nunca un `nombre_completo` en las tres. Los
// contactos importados de Pipedrive, Zoho y Bitrix entraron con el nombre entero en una sola
// columna, así que hay fichas con el encabezado lleno y los tres campos vacíos.
//
// Medido en producción el 2026-08-20, sobre 3.811 contactos vivos:
//   ·  33 no tienen NINGUNA parte  → sin respaldo se quedarían en "Sin nombre"
//   · 160 no tienen apellido       → sin respaldo perderían el apellido EN PANTALLA:
//                                     «Juan Antonio» donde hoy se lee «Juan Antonio Tercero Lopez»
//
// LA REGLA, EN UNA FRASE: **la etiqueta nunca puede enseñar menos de lo que hoy se ve.**
//
// ⚠️ Y por eso NO se reparte `nombre_completo` de nadie, ni aquí ni en una migración. Partir
// «Juan Antonio Tercero Lopez» es ambiguo —¿`Juan | Antonio | Tercero Lopez` o
// `Juan | Antonio Tercero | Lopez`?— y hay 938 contactos de tres palabras genuinamente ambiguos.
// Son 33 fichas: las rellena una persona, y con este respaldo ninguna se ve mal mientras tanto. Un
// script que acierte el 90 % le pone mal el apellido a tres personas en un CRM de inmigración.
// ============================================================================================

/** Lo que se enseña cuando no hay absolutamente nada. Es lo que ya decía la ficha. */
export const SIN_NOMBRE = "Sin nombre";

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Las palabras de un nombre, normalizadas SOLO para comparar.
 *
 * Sin tildes y en minúsculas, porque la comparación no puede caerse al respaldo por un acento:
 * si las partes dicen «José» y `nombre_completo` dice «Jose», es la misma persona y la
 * composición no es más pobre. Lo que se PINTA es siempre el texto original, con sus tildes.
 */
const palabras = (s: string): string[] =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter(Boolean);

export interface PartesDelNombre {
  nombre?: string | null;
  segundo_nombre?: string | null;
  apellido?: string | null;
  nombre_completo?: string | null;
}

/**
 * El nombre para el encabezado: la composición de las partes, o `nombre_completo` si esa
 * composición diría menos.
 *
 * "Decir menos" se mide por PALABRAS y no por longitud: si `nombre_completo` tiene alguna palabra
 * que la composición no tiene, la composición es más pobre y se usa el respaldo. Comparar
 * longitudes haría caer al respaldo por una tilde o por un espacio doble, y comparar solo "está
 * vacía" dejaría fuera a los 160 sin apellido, que es la mitad del problema.
 *
 * Si la composición tiene palabras que `nombre_completo` no tiene, es MÁS rica —alguien rellenó un
 * segundo nombre que la importación no traía— y entonces gana la composición.
 */
export function nombreParaEncabezado(c: PartesDelNombre): string {
  const compuesto = [texto(c.nombre), texto(c.segundo_nombre), texto(c.apellido)].filter(Boolean).join(" ");
  const completo = texto(c.nombre_completo);

  if (!compuesto) return completo || SIN_NOMBRE;
  if (!completo) return compuesto;

  // ¿Sobra alguna palabra de `nombre_completo` que la composición no cubra? Entonces la
  // composición enseñaría menos, y eso es justo lo que no se permite.
  const enCompuesto = new Set(palabras(compuesto));
  const faltaAlgo = palabras(completo).some((p) => !enCompuesto.has(p));

  return faltaAlgo ? completo : compuesto;
}

/**
 * ¿Se está enseñando el respaldo en vez de la composición?
 *
 * Sirve para que la ficha pueda avisar de que a ese contacto le faltan las partes, que es lo que
 * convierte los 33 en una lista que alguien puede terminar en una mañana. Sin el aviso, el
 * respaldo funciona tan bien que nadie se entera de que hay algo que rellenar.
 */
export function usaRespaldoDeNombre(c: PartesDelNombre): boolean {
  const completo = texto(c.nombre_completo);
  if (!completo) return false;
  return nombreParaEncabezado(c) === completo &&
    [texto(c.nombre), texto(c.segundo_nombre), texto(c.apellido)].filter(Boolean).join(" ") !== completo;
}

/**
 * Un nombre partido en dos líneas para un control estrecho: pila arriba, apellido debajo.
 *
 *   "Alessandro Garagozzo"  →  { titulo: "Alessandro", subtitulo: "Garagozzo" }
 *   "Jhosnel Laya"             →  { titulo: "Jhosnel",     subtitulo: "Laya" }
 *   "Otro"                    →  { titulo: "Otro" }
 *
 * 🔴 LA ÚLTIMA PALABRA ES EL APELLIDO, y es una aproximación deliberada. Aquí NO se está guardando
 * nada: es una etiqueta de un botón de ~90 px, y lo único que decide es dónde cae el salto de
 * línea. Adivinar mal reparte el texto de forma rara; no cambia ningún dato. Es el mismo problema
 * ambiguo que `nombreParaEncabezado` se niega a resolver —«Juan Antonio Tercero Lopez» puede
 * partirse de dos formas—, y por eso allí, donde sí se guardaría, no se adivina y aquí sí.
 *
 * Una sola palabra se queda arriba sin subtítulo: el hueco de la segunda línea lo reserva el
 * componente, así que el segmento no queda más bajo que sus vecinos.
 */
export function nombreEnDosLineas(nombre: string): { titulo: string; subtitulo?: string } {
  const partes = (nombre || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { titulo: "" };
  if (partes.length === 1) return { titulo: partes[0] };
  return { titulo: partes.slice(0, -1).join(" "), subtitulo: partes[partes.length - 1] };
}
