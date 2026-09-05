// ============================================================================================
// LA BITÁCORA DE UN CAMBIO DE ETAPA
//
// 🔴 POR QUÉ HAY UNA FUNCIÓN PARA ESTO. Que todo cambio de etapa deje fila en `gozz.auditoria`
// no es higiene: es de lo que depende el detalle de una solicitud para decir *"esta oportunidad ya
// no está donde estaba cuando se pidió"* en las solicitudes anteriores a que se guardara el origen.
// Había dos caminos en el código que movían la etapa **sin dejar rastro** —al retirar una etapa del
// pipeline y al completar una oportunidad—, y el segundo la pone en `ganado`, que es justo el
// cambio que deja obsoleta una solicitud pendiente.
//
// Estando repartida por tres ficheros, la forma de la fila se iba a separar en cuanto alguien
// tocara una de las tres. Aquí hay una sola, y es la del cambio individual (`index.ts`):
// `datos_antes.etapa` / `datos_despues.etapa`.
// ============================================================================================

import { query } from "../shared/db.js";

const SCHEMA = "gozz";

export interface CambioAuditable {
  id: string;
  /** La etapa que tenía. `null` si no se pudo leer — no se inventa. */
  antes: string | null;
  despues: string;
  /** El texto de la acción. Se pasa por fila porque el motivo del cambio no siempre es el mismo. */
  accion: string;
}

/**
 * Escribe UNA fila por oportunidad **en una sola sentencia**, no en un bucle (§3.6).
 *
 * Es una fila por registro y no una de la operación: esto es lo que se lee desde la pestaña
 * Actividad de cada caso. Quien además necesite deshacer un lote entero escribe, aparte, su fila de
 * operación — lo hace el cambio masivo de etapa.
 *
 * No lanza: una bitácora que rompe la operación que estaba registrando es peor que la falta de la
 * fila. Se registra el error y se sigue, igual que hace el cambio individual.
 */
export async function auditarCambiosDeEtapa(
  cambios: CambioAuditable[],
  opts: { userId: string | null }
): Promise<number> {
  const filas = cambios.filter((c) => c && c.id && c.antes !== c.despues);
  if (filas.length === 0) return 0;
  try {
    await query(
      `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       SELECT $1, x.accion, 'oportunidades', x.registro_id, x.antes, x.despues
         FROM unnest($2::text[], $3::text[], $4::jsonb[], $5::jsonb[])
              AS x(accion, registro_id, antes, despues)`,
      [
        opts.userId,
        filas.map((c) => c.accion),
        filas.map((c) => String(c.id)),
        filas.map((c) => JSON.stringify({ etapa: c.antes })),
        filas.map((c) => JSON.stringify({ etapa: c.despues })),
      ]
    );
    return filas.length;
  } catch (e: any) {
    console.error("[auditoria etapa]", e?.message);
    return 0;
  }
}
