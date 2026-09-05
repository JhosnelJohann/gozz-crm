// ==============================================================================================
// QUÉ RELACIÓN TENGO YO CON UNA TAREA — un solo predicado, para la lista y para los contadores
//
// Pedido por Juan David el 2026-09-02, sobre staging: «no veo las tareas de las cuales yo soy el
// propietario, solo veo las tareas que tengo asignadas». En cuanto delegabas una tarea, desaparecía
// de tu pantalla y no había forma de seguir su estado.
//
// 🔴 POR QUÉ ESTO ES UN MÓDULO Y NO UN `if` EN EL HANDLER. `GET /api/tareas` hace **dos** consultas:
// la de las filas y la de los contadores de la cabecera, cada una con su `WHERE` escrito aparte.
// Cambiar solo la primera deja el chip diciendo 15 y el tablero enseñando 30 — el defecto D2 de
// Oportunidades, donde un total que no cuadra con las filas resultó peor que no tener total. Las dos
// preguntan aquí. Es `CONVENCIONES §4.8`: quien cuenta y quien lista comparten las fronteras.
//
// ⚠️ ESTO DEVUELVE SQL, PERO NUNCA UN VALOR. Lo que se interpola es el **nombre del placeholder**
// (`$2`), que lo genera quien llama; el uuid viaja siempre por parámetro. Mismo patrón que el
// `involvedSql` que ya vivía en `tareas-routes.ts`.
// ==============================================================================================

/**
 * Las cuatro opciones, tal como se ofrecen en pantalla.
 *
 * 🔴 `observador` es EXCLUYENTE y así se pidió: no suma a `defecto`, lo sustituye. Quien lo elige
 * quiere mirar **solo** esa bandeja. Y por eso `defecto` **no** incluye lo que uno observa: ser
 * observador es mirar, no tener la tarea.
 */
export const VINCULOS = ["defecto", "creador", "asignado", "observador"] as const;
export type Vinculo = (typeof VINCULOS)[number];

export const VINCULO_POR_DEFECTO: Vinculo = "defecto";

/** Sin nombrar columnas ni parámetros internos (§4.7): dice qué se puede pedir, no cómo se llama. */
export const VINCULO_INVALIDO =
  "Solo se puede filtrar por: lo mío, lo que he creado, lo que tengo asignado o lo que observo.";

export function esVinculo(v: unknown): v is Vinculo {
  return typeof v === "string" && (VINCULOS as readonly string[]).includes(v);
}

/**
 * Lee el parámetro de la petición.
 *
 * 🔴 Un valor que no está en la lista se RECHAZA; no se coacciona al más seguro. Un `creadorr` que
 * cayera en «defecto» devolvería otra cosa sin decirlo, y quien filtró se quedaría creyendo que
 * filtró. Ausente sí es válido: significa el valor por defecto.
 */
export function leerVinculo(valor: unknown): { ok: true; vinculo: Vinculo } | { ok: false; error: string } {
  if (valor === undefined || valor === null || valor === "") return { ok: true, vinculo: VINCULO_POR_DEFECTO };
  if (!esVinculo(valor)) return { ok: false, error: VINCULO_INVALIDO };
  return { ok: true, vinculo: valor };
}

/**
 * El trozo de `WHERE` que ata una tarea a una persona.
 *
 * @param p El **placeholder** ya numerado por quien llama (`$2`, `$3`…). Nunca un valor.
 */
export function predicadoDeVinculo(vinculo: Vinculo, p: string): string {
  switch (vinculo) {
    case "creador":
      // `propietario_id` es quien la creó: lo escribe el alta con el usuario de la sesión, y es lo
      // que la ficha enseña como «Creador».
      return `t.propietario_id = ${p}`;
    case "asignado":
      return `t.responsable_id = ${p}`;
    case "observador":
      return `COALESCE(t.observadores,'[]'::jsonb) @> to_jsonb(${p}::text)`;
    case "defecto":
    default:
      return `(t.propietario_id = ${p} OR t.responsable_id = ${p})`;
  }
}
