// ============================================================================================
// LA TRAMPA DEL `COALESCE` — por qué las dos ramas de visibilidad NO son simétricas
//
// `contactos_cache.archivado` se creó como `boolean DEFAULT false` **sin NOT NULL** (mig. `0042`),
// así que admite NULL. De ahí sale una asimetría que parece un descuido y no lo es:
//
//   Expresión                             │ una fila con `archivado IS NULL`
//   ──────────────────────────────────────┼──────────────────────────────────
//   COALESCE(archivado, false) = false    │ la INCLUYE   ← el listado normal la necesita
//   archivado = false                     │ la EXCLUYE   (NULL = false → NULL)
//   COALESCE(archivado, false) = true     │ la excluye
//   archivado = true                      │ la excluye   ← por eso la papelera sí puede quitarlo
//
// El día que alguien "normalice" `NO_ARCHIVADOS` quitándole el COALESCE, cualquier contacto con
// `archivado IS NULL` desaparecería del listado, de la búsqueda y de los contadores SIN LANZAR
// NINGÚN ERROR. Hoy hay 0 filas así, de modo que el riesgo es latente y nada lo delataría.
//
// 🔴 ESTE FICHERO ES LO QUE CONVIERTE ESE COMENTARIO EN UNA GARANTÍA. Ejercita las constantes
// REALES —importadas de `contactos-routes.ts`, no copiadas— contra una fila con `archivado = NULL`
// explícito. Si alguien toca `NO_ARCHIVADOS`, se pone rojo.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import { NO_ARCHIVADOS, SOLO_ARCHIVADOS } from "../src/lib/contactos-filtro.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { crearContacto } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

const sinHijos = { ops: 0, tareas: 0, notas: 0, correos: 0, documentos: 0 };

/** Los ids que ve una de las dos ramas de visibilidad, con la expresión REAL del código. */
const idsVisiblesCon = async (expresion: string, ids: string[]): Promise<string[]> =>
  (await query<any>(
    `SELECT id FROM gozz.contactos_cache WHERE ${expresion} AND id = ANY($1::uuid[]) ORDER BY id`,
    [ids]
  )).map((r) => r.id);

describe("la columna archivado admite NULL, y eso condiciona las dos ramas", () => {
  it("🔴 BLINDAJE · un contacto con archivado = NULL SÍ sale en el listado normal", async () => {
    // Si este test se pone rojo, alguien le quitó el `COALESCE` a `NO_ARCHIVADOS` y acaba de hacer
    // invisibles a todos los contactos con `archivado IS NULL`. No es hipotético: la columna los
    // admite, y ningún error saltaría.
    const s = Date.now().toString(36);
    const nulo = await crearContacto({ nombre: `Archivado NULL ${s}`, email: `n-${s}@pruebas.invalid`, telefono: "+1800000001", hijos: sinHijos });
    const activo = await crearContacto({ nombre: `Activo ${s}`, email: `a-${s}@pruebas.invalid`, telefono: "+1800000002", hijos: sinHijos });
    const archivado = await crearContacto({ nombre: `Archivado ${s}`, email: `r-${s}@pruebas.invalid`, telefono: "+1800000003", hijos: sinHijos });

    // Explícitamente NULL, no el default.
    await query(`UPDATE gozz.contactos_cache SET archivado = NULL WHERE id = $1`, [nulo]);
    await query(`UPDATE gozz.contactos_cache SET archivado = true WHERE id = $1`, [archivado]);
    const [chk] = await query<any>(`SELECT archivado FROM gozz.contactos_cache WHERE id = $1`, [nulo]);
    expect(chk.archivado, "el fixture tiene que dejar un NULL de verdad").toBeNull();

    const visibles = await idsVisiblesCon(NO_ARCHIVADOS, [nulo, activo, archivado]);
    expect(visibles, "el NULL no puede desaparecer del listado").toContain(nulo);
    expect(visibles).toContain(activo);
    expect(visibles, "el archivado sí se esconde").not.toContain(archivado);
  });

  it("y NO sale en la papelera: un NULL no es un archivado", async () => {
    const s = Date.now().toString(36);
    const nulo = await crearContacto({ nombre: `NULL papelera ${s}`, email: `np-${s}@pruebas.invalid`, telefono: "+1810000001", hijos: sinHijos });
    const archivado = await crearContacto({ nombre: `Sí archivado ${s}`, email: `sa-${s}@pruebas.invalid`, telefono: "+1810000002", hijos: sinHijos });
    await query(`UPDATE gozz.contactos_cache SET archivado = NULL WHERE id = $1`, [nulo]);
    await query(`UPDATE gozz.contactos_cache SET archivado = true WHERE id = $1`, [archivado]);

    const enPapelera = await idsVisiblesCon(SOLO_ARCHIVADOS, [nulo, archivado]);
    expect(enPapelera).toEqual([archivado].filter((x) => enPapelera.includes(x)));
    expect(enPapelera).toContain(archivado);
    expect(enPapelera).not.toContain(nulo);
  });

  it("🔴 quitar el COALESCE de la rama de archivados NO cambia el conjunto (por eso se pudo quitar)", async () => {
    // Es la equivalencia que justifica el cambio. Se comprueba con datos, no de palabra: las dos
    // expresiones tienen que devolver EXACTAMENTE los mismos ids, incluida la fila NULL.
    const s = Date.now().toString(36);
    const ids: string[] = [];
    for (const [etiqueta, valor] of [["nulo", null], ["falso", false], ["cierto", true]] as const) {
      const id = await crearContacto({ nombre: `Equiv ${etiqueta} ${s}`, email: `eq-${etiqueta}-${s}@pruebas.invalid`, telefono: `+182000000${ids.length}`, hijos: sinHijos });
      await query(`UPDATE gozz.contactos_cache SET archivado = $2 WHERE id = $1`, [id, valor]);
      ids.push(id);
    }

    const conCoalesce = await idsVisiblesCon(`COALESCE(archivado, false) = true`, ids);
    const sinCoalesce = await idsVisiblesCon(SOLO_ARCHIVADOS, ids);
    expect(sinCoalesce).toEqual(conCoalesce);

    // Y la asimetría, en el otro sentido: aquí las dos formas SÍ difieren, y por eso la rama de
    // no-archivados conserva su COALESCE.
    const noArchivadosBien = await idsVisiblesCon(NO_ARCHIVADOS, ids);
    const noArchivadosMal = await idsVisiblesCon(`archivado = false`, ids);
    expect(noArchivadosBien).not.toEqual(noArchivadosMal);
    expect(noArchivadosMal, "sin COALESCE, el NULL se perdería").toHaveLength(noArchivadosBien.length - 1);
  });

  it("las constantes dicen lo que este fichero supone que dicen", () => {
    // Si alguien las reescribe, que falle aquí con el motivo delante en vez de en un caso raro.
    expect(NO_ARCHIVADOS).toBe("COALESCE(archivado, false) = false");
    expect(SOLO_ARCHIVADOS).toBe("archivado = true");
  });
});
