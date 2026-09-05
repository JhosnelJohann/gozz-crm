import { query } from "../shared/db.js";

// ==============================================================================================
// EL CLIENTE DE UNA TAREA, RESUELTO EN EL SERVIDOR — la misma regla para las tres rutas que escriben
//
// Una tarea puede colgar de un contacto, de una oportunidad, o de los dos. Y una oportunidad ya
// tiene su propio contacto, así que el par tiene que ser coherente: una tarea que dice ser del
// cliente A y del caso de B no se puede leer de ninguna forma sensata.
//
// 🔴 POR QUÉ ESTO NO VIVE SOLO EN LA PANTALLA. La regla ya existía —`POST /api/oportunidades/:id/
// tareas` derivaba el contacto de la oportunidad—, pero **solo en una de las tres rutas que crean
// tareas**. Las otras dos escribían lo que les llegara. Que la coherencia dependa de que el
// formulario se acuerde es cómo se tuerce en cuanto aparece un cuarto sitio que escribe.
// `CONVENCIONES §4.8`: quien clasifica y quien escribe comparten las fronteras, y §3.5: la lógica
// compartida vive en `lib/`, no duplicada por fichero de rutas.
//
// ⚠️ ESTO NO VALIDA HACIA ATRÁS. Solo mira **lo que trae la petición**, nunca la fila que ya
// estaba. Una tarea antigua con un par incoherente se puede seguir editando; lo que se rechaza es
// que alguien mande la contradicción **ahora**. Comparar contra lo guardado convertiría un dato
// viejo en un formulario que no se puede guardar, que es justo lo que no se hace aquí.
// ==============================================================================================

/**
 * El mensaje, en castellano y sin nombres de tabla, de columna ni de permiso (§4.7). Dice qué
 * hacer, no solo qué está mal.
 */
export const VINCULO_DISCORDANTE =
  "Esta tarea no puede ser de un cliente y de la oportunidad de otro. Deja solo uno de los dos.";

export interface VinculoPedido {
  oportunidad_id?: string | null;
  contacto_id?: string | null;
}

export type VinculoResuelto =
  | { ok: true; contactoId: string | null | undefined }
  | { ok: false; error: string };

/**
 * Devuelve qué `contacto_id` hay que escribir, o el motivo del rechazo.
 *
 * Tres caminos:
 *
 *  1. **Sin oportunidad** → lo que venga. No hay nada con qué contrastar.
 *  2. **Con oportunidad que tiene cliente** → si la petición no trae contacto, se **deriva** el de
 *     la oportunidad; si lo trae y es el mismo, adelante; si lo trae y es otro, **400**.
 *     🔴 No se coacciona al «más probable»: pisar en silencio lo que alguien eligió deja a quien lo
 *     pidió creyendo que guardó otra cosa. Igual que en §2.8.3 del contrato, aquí fallar es mejor
 *     que adivinar.
 *  3. **Con oportunidad SIN cliente** (`oportunidades.contacto_id` es NULLABLE) → no hay conflicto
 *     posible y se respeta lo que venga, incluido un contacto puesto a mano.
 *
 * Devolver `undefined` —y no `null`— cuando la petición no menciona el contacto es deliberado: en
 * un `PATCH` parcial, «no lo menciona» y «ponlo a vacío» son cosas distintas, y un `null` no las
 * distingue.
 */
export async function resolverContactoDeTarea(d: VinculoPedido): Promise<VinculoResuelto> {
  if (!d.oportunidad_id) return { ok: true, contactoId: d.contacto_id };

  const op = (await query<any>(
    "SELECT contacto_id FROM gozz.oportunidades WHERE id = $1",
    [d.oportunidad_id]
  ))[0];

  // La oportunidad no existe: no es asunto de esta regla. La clave foránea dirá lo suyo, igual que
  // decía antes de que esto existiera.
  if (!op) return { ok: true, contactoId: d.contacto_id };

  const contactoDeLaOportunidad: string | null = op.contacto_id ?? null;
  if (!contactoDeLaOportunidad) return { ok: true, contactoId: d.contacto_id };

  if (d.contacto_id == null) return { ok: true, contactoId: contactoDeLaOportunidad };
  if (d.contacto_id === contactoDeLaOportunidad) return { ok: true, contactoId: d.contacto_id };

  return { ok: false, error: VINCULO_DISCORDANTE };
}
