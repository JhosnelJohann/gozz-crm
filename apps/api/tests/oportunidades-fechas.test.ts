// ============================================================================================
// OPORTUNIDADES — filtro por rango de fechas, con selector de columna
//
// Hasta ahora `desde`/`hasta` corrían siempre sobre `created_at`. Ahora se puede elegir entre
// **fecha de creación** y **fecha de ganado** (`fecha_completada`), y eso trae dos cosas que hay
// que probar, no suponer:
//
//   1. 🔴 EL BORDE DEL RANGO. Es el fallo clásico: `hasta` a las 00:00 del último día deja fuera
//      todo ese día. El popover manda `23:59:59.999` (`endOfDay`) y aquí se comprueba que eso es
//      lo que salva al último día — y que sin ello se perdería.
//
//   2. 🔴 LAS QUE NO TIENEN LA FECHA. Solo 431 de las 6.920 ganadas en producción tienen
//      `fecha_completada`. Un rango sobre esa columna deja fuera al 94% — correctamente, porque lo
//      que no tiene fecha no cae en ningún rango— y **el sistema tiene que decir cuántas son**.
//      Lo que NO se hace es colarlas en el resultado ni rellenarles la fecha.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import {
  CAMPO_FECHA_POR_DEFECTO, construirFiltroOportunidades, consultarOportunidades,
  hayFiltros, leerFiltrosOportunidades,
} from "../src/lib/oportunidades-filtro.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

const consultar = (opts: any) => consultarOportunidades(query, opts);

let contador = 0;
/** Un trámite por caso: acota las aserciones a las filas de ese caso y no a toda la base. */
async function crearTramite(): Promise<string> {
  const s = `${Date.now().toString(36)}-${++contador}`;
  const r = await query<any>(
    `INSERT INTO gozz.tramites_config (nombre, codigo) VALUES ($1,$2) RETURNING id`,
    [`Fechas ${s}`, `fechas_${s}`]
  );
  return r[0].id;
}

async function crearOportunidad(d: {
  tramite: string; etapa?: string; creada?: Date; ganada?: Date | null; nombre?: string;
}): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (nombre_caso, etapa, tipo_tramite_id, created_at, fecha_completada)
     VALUES ($1,$2,$3,COALESCE($4::timestamptz, NOW()),$5) RETURNING id`,
    [d.nombre ?? `Caso ${++contador}`, d.etapa ?? "ganado", d.tramite, d.creada ?? null, d.ganada ?? null]
  );
  return r[0].id;
}

/** Fecha local concreta, como la construye el navegador antes de mandar el ISO. */
const en = (y: number, m: number, dia: number, h = 12, min = 0) => new Date(y, m - 1, dia, h, min, 0, 0);
/** Lo mismo que hace `endOfDay()` en `DateRangePopover`. */
const finDelDia = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const inicioDelDia = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** El `count(*)` con EXACTAMENTE el mismo WHERE. Es contra esto que se contrasta la lista. */
async function contarConMismoWhere(filtros: any): Promise<number> {
  const { where, params } = construirFiltroOportunidades(filtros, null);
  const [r] = await query<any>(
    `SELECT count(*)::int AS n
       FROM gozz.oportunidades o
       LEFT JOIN gozz.contactos_cache c ON c.id = o.contacto_id
       LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
      ${where ? `WHERE ${where}` : ""}`,
    params
  );
  return r.n;
}

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("el selector de columna", () => {
  it("por defecto es `created_at`: la conducta de siempre no cambia", () => {
    const f = leerFiltrosOportunidades({});
    expect(f.campo_fecha).toBe(CAMPO_FECHA_POR_DEFECTO);
    expect(CAMPO_FECHA_POR_DEFECTO).toBe("created_at");
  });

  it("acepta las dos columnas de la lista blanca", () => {
    expect(leerFiltrosOportunidades({ campo_fecha: "fecha_completada" }).campo_fecha).toBe("fecha_completada");
    expect(leerFiltrosOportunidades({ campo_fecha: "created_at" }).campo_fecha).toBe("created_at");
  });

  it("🔴 cualquier otra cosa cae al valor por defecto y NUNCA llega al SQL", async () => {
    // El nombre de una columna no puede ir como `$n`, así que acaba concatenado. La lista blanca es
    // lo que hace que eso sea seguro: lo que manda el usuario elige una constante, no construye SQL.
    for (const veneno of ["updated_at", "o.created_at", "created_at; DROP TABLE x", "", null, 1, {}]) {
      const f = leerFiltrosOportunidades({ campo_fecha: veneno });
      expect(f.campo_fecha, `campo_fecha=${JSON.stringify(veneno)}`).toBe("created_at");
    }
    const { where } = construirFiltroOportunidades(
      { ...leerFiltrosOportunidades({ campo_fecha: "DROP TABLE x" }), desde: new Date().toISOString() },
      null
    );
    expect(where).toContain("o.created_at");
    expect(where).not.toContain("DROP");
  });

  it("el rango cuenta como filtro; el campo por sí solo, no", () => {
    expect(hayFiltros(leerFiltrosOportunidades({ campo_fecha: "fecha_completada" }))).toBe(false);
    expect(hayFiltros(leerFiltrosOportunidades({ campo_fecha: "fecha_completada", desde: "2026-01-01" }))).toBe(true);
  });
});

describe("un rango sobre `created_at` devuelve solo lo creado dentro", () => {
  it("y deja fuera lo de antes y lo de después", async () => {
    const t = await crearTramite();
    const dentro = [
      await crearOportunidad({ tramite: t, creada: en(2026, 3, 10) }),
      await crearOportunidad({ tramite: t, creada: en(2026, 3, 15) }),
      await crearOportunidad({ tramite: t, creada: en(2026, 3, 20) }),
    ];
    await crearOportunidad({ tramite: t, creada: en(2026, 2, 28) });   // antes
    await crearOportunidad({ tramite: t, creada: en(2026, 4, 1) });    // después

    const filtros = leerFiltrosOportunidades({
      tramite: t,
      campo_fecha: "created_at",
      desde: inicioDelDia(en(2026, 3, 1)).toISOString(),
      hasta: finDelDia(en(2026, 3, 31)).toISOString(),
    });
    const r = await consultar({ filtros, userId: null });

    expect(new Set(r.oportunidades.map((o: any) => o.id))).toEqual(new Set(dentro));
    expect(r.oportunidades).toHaveLength(await contarConMismoWhere(filtros));
  });
});

describe("un rango sobre `fecha_completada` devuelve solo lo ganado dentro", () => {
  it("y no confunde las dos fechas: creada dentro pero ganada fuera NO entra", async () => {
    const t = await crearTramite();
    // La trampa: todas se CREARON en marzo. Lo que las separa es cuándo se GANARON.
    const ganadaEnMarzo = await crearOportunidad({ tramite: t, creada: en(2026, 3, 5), ganada: en(2026, 3, 12) });
    await crearOportunidad({ tramite: t, creada: en(2026, 3, 5), ganada: en(2026, 5, 12) });  // ganada fuera
    await crearOportunidad({ tramite: t, creada: en(2026, 3, 5), ganada: null });             // nunca marcada

    const rangoMarzo = {
      desde: inicioDelDia(en(2026, 3, 1)).toISOString(),
      hasta: finDelDia(en(2026, 3, 31)).toISOString(),
    };

    const porGanado = leerFiltrosOportunidades({ tramite: t, campo_fecha: "fecha_completada", ...rangoMarzo });
    const rGanado = await consultar({ filtros: porGanado, userId: null });
    expect(rGanado.oportunidades.map((o: any) => o.id)).toEqual([ganadaEnMarzo]);

    // Con la MISMA ventana pero sobre `created_at` salen las tres: es la prueba de que el selector
    // cambia de columna de verdad y no es decorativo.
    const porCreacion = leerFiltrosOportunidades({ tramite: t, campo_fecha: "created_at", ...rangoMarzo });
    const rCreacion = await consultar({ filtros: porCreacion, userId: null });
    expect(rCreacion.oportunidades).toHaveLength(3);
  });
});

describe("🔴 el borde del rango — lo que justifica el endOfDay()", () => {
  it("una oportunidad a las 23:30 del último día del rango SÍ entra", async () => {
    const t = await crearTramite();
    const ultimoDia = en(2026, 6, 30);
    const aLas2330 = await crearOportunidad({ tramite: t, creada: en(2026, 6, 30, 23, 30) });

    const filtros = leerFiltrosOportunidades({
      tramite: t,
      desde: inicioDelDia(en(2026, 6, 1)).toISOString(),
      hasta: finDelDia(ultimoDia).toISOString(),       // 23:59:59.999, como manda el popover
    });
    const r = await consultar({ filtros, userId: null });
    expect(r.oportunidades.map((o: any) => o.id)).toContain(aLas2330);
  });

  it("y con `hasta` a las 00:00 de ese mismo día se perdería — por eso NO se reimplementa", async () => {
    const t = await crearTramite();
    await crearOportunidad({ tramite: t, creada: en(2026, 6, 30, 23, 30) });

    const truncado = leerFiltrosOportunidades({
      tramite: t,
      desde: inicioDelDia(en(2026, 6, 1)).toISOString(),
      hasta: inicioDelDia(en(2026, 6, 30)).toISOString(),   // 00:00:00 — el error clásico
    });
    expect((await consultar({ filtros: truncado, userId: null })).oportunidades).toHaveLength(0);
  });

  it("el último milisegundo del día también entra", async () => {
    const t = await crearTramite();
    const alFilo = finDelDia(en(2026, 7, 15));            // 23:59:59.999
    const id = await crearOportunidad({ tramite: t, ganada: alFilo, creada: en(2026, 7, 1) });

    const filtros = leerFiltrosOportunidades({
      tramite: t, campo_fecha: "fecha_completada",
      desde: inicioDelDia(en(2026, 7, 15)).toISOString(),
      hasta: finDelDia(en(2026, 7, 15)).toISOString(),
    });
    expect((await consultar({ filtros, userId: null })).oportunidades.map((o: any) => o.id)).toEqual([id]);
  });
});

describe("🔴 las que no tienen fecha: fuera del rango, pero CONTADAS", () => {
  it("quedan fuera del resultado y `sin_fecha` dice exactamente cuántas son", async () => {
    const t = await crearTramite();
    const conFecha = [
      await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 3, 3) }),
      await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 3, 9) }),
    ];
    // Las importaciones: ganadas, pero sin la fecha que nadie escribió.
    for (let i = 0; i < 7; i++) await crearOportunidad({ tramite: t, etapa: "ganado", ganada: null });

    const filtros = leerFiltrosOportunidades({
      tramite: t, etapa: "ganado", campo_fecha: "fecha_completada",
      desde: inicioDelDia(en(2026, 3, 1)).toISOString(),
      hasta: finDelDia(en(2026, 3, 31)).toISOString(),
    });
    const r = await consultar({ filtros, userId: null, page: 1, pageSize: 20 });

    // No se cuelan: el resultado son solo las que caen en el rango.
    expect(new Set(r.oportunidades.map((o: any) => o.id))).toEqual(new Set(conFecha));
    expect(r.total).toBe(2);

    // Y el aviso dice la verdad: 7 se quedan fuera por no tener la fecha.
    expect(r.sin_fecha).toBeTruthy();
    expect(r.sin_fecha!.ganado).toBe(7);

    // Contrastado contra la base, no contra la propia función.
    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.oportunidades
        WHERE tipo_tramite_id = $1 AND etapa = 'ganado' AND fecha_completada IS NULL`,
      [t]
    );
    expect(r.sin_fecha!.ganado).toBe(n);
  });

  it("y a nadie se le rellena la fecha para que 'no falte'", async () => {
    const t = await crearTramite();
    const huerfana = await crearOportunidad({ tramite: t, etapa: "ganado", ganada: null });

    await consultar({
      filtros: leerFiltrosOportunidades({
        tramite: t, campo_fecha: "fecha_completada",
        desde: inicioDelDia(en(2026, 3, 1)).toISOString(),
        hasta: finDelDia(en(2026, 3, 31)).toISOString(),
      }),
      userId: null,
    });

    const [fila] = await query<any>(`SELECT fecha_completada FROM gozz.oportunidades WHERE id = $1`, [huerfana]);
    expect(fila.fecha_completada).toBeNull();
  });

  it("sin rango puesto no hay `sin_fecha`: la pregunta no existe", async () => {
    const t = await crearTramite();
    await crearOportunidad({ tramite: t, ganada: null });
    const r = await consultar({ filtros: leerFiltrosOportunidades({ tramite: t }), userId: null });
    expect(r.sin_fecha).toBeUndefined();
  });

  it("`sin_fecha` se calcula con el resto de filtros, no sobre toda la base", async () => {
    // La pregunta es "de lo que estás mirando, cuánto se queda fuera". Con el trámite A puesto, las
    // sin fecha del trámite B no cuentan.
    const a = await crearTramite();
    const b = await crearTramite();
    for (let i = 0; i < 3; i++) await crearOportunidad({ tramite: a, etapa: "ganado", ganada: null });
    for (let i = 0; i < 9; i++) await crearOportunidad({ tramite: b, etapa: "ganado", ganada: null });

    const r = await consultar({
      filtros: leerFiltrosOportunidades({
        tramite: a, campo_fecha: "fecha_completada",
        desde: inicioDelDia(en(2026, 3, 1)).toISOString(),
        hasta: finDelDia(en(2026, 3, 31)).toISOString(),
      }),
      userId: null,
    });
    expect(r.sin_fecha!.ganado).toBe(3);
  });

  it("un rango sobre `created_at` no inventa un aviso donde no lo hay", async () => {
    // `created_at` la tienen todas: el aviso debe salir en cero, no con el número de las que no
    // tienen `fecha_completada`.
    const t = await crearTramite();
    for (let i = 0; i < 4; i++) await crearOportunidad({ tramite: t, creada: en(2026, 3, 10), ganada: null });

    const r = await consultar({
      filtros: leerFiltrosOportunidades({
        tramite: t, campo_fecha: "created_at",
        desde: inicioDelDia(en(2026, 3, 1)).toISOString(),
        hasta: finDelDia(en(2026, 3, 31)).toISOString(),
      }),
      userId: null,
    });
    expect(r.oportunidades).toHaveLength(4);
    expect(Object.values(r.sin_fecha ?? {}).reduce((n, x) => n + x, 0)).toBe(0);
  });
});

describe("el rango se combina con los demás filtros y el contador cuadra", () => {
  it("trámite + etapa + rango sobre `fecha_completada`", async () => {
    const t = await crearTramite();
    const otro = await crearTramite();
    // Las que deben salir: este trámite, ganadas, con fecha dentro.
    const esperadas = [
      await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 9, 2) }),
      await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 9, 28) }),
    ];
    await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 10, 2) });    // fuera del rango
    await crearOportunidad({ tramite: t, etapa: "perdido", ganada: en(2026, 9, 5) });    // otra etapa
    await crearOportunidad({ tramite: otro, etapa: "ganado", ganada: en(2026, 9, 5) });  // otro trámite
    await crearOportunidad({ tramite: t, etapa: "ganado", ganada: null });               // sin fecha

    const filtros = leerFiltrosOportunidades({
      tramite: t, etapa: "ganado", campo_fecha: "fecha_completada",
      desde: inicioDelDia(en(2026, 9, 1)).toISOString(),
      hasta: finDelDia(en(2026, 9, 30)).toISOString(),
    });
    const r = await consultar({ filtros, userId: null, page: 1, pageSize: 20 });

    expect(new Set(r.oportunidades.map((o: any) => o.id))).toEqual(new Set(esperadas));
    // 🔴 El contador de la etapa cuadra con las filas: es la regla que este módulo vino a arreglar.
    expect(r.total).toBe(2);
    expect(r.counts.ganado).toBe(2);
    expect(r.total).toBe(await contarConMismoWhere(filtros));
  });

  it("los conteos por etapa respetan el rango, y siguen ignorando la etapa elegida", async () => {
    const t = await crearTramite();
    for (let i = 0; i < 5; i++) await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 11, 5) });
    for (let i = 0; i < 2; i++) await crearOportunidad({ tramite: t, etapa: "perdido", ganada: en(2026, 11, 6) });
    await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2027, 1, 5) });   // fuera

    const r = await consultar({
      filtros: leerFiltrosOportunidades({
        tramite: t, etapa: "ganado", campo_fecha: "fecha_completada",
        desde: inicioDelDia(en(2026, 11, 1)).toISOString(),
        hasta: finDelDia(en(2026, 11, 30)).toISOString(),
      }),
      userId: null, page: 1, pageSize: 20,
    });

    expect(r.total).toBe(5);
    expect(r.counts.ganado).toBe(5);
    // El contador de la OTRA etapa también sale, y también respeta el rango.
    expect(r.counts.perdido).toBe(2);
  });

  it("paginar dentro de un rango no repite ni se salta filas", async () => {
    const t = await crearTramite();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await crearOportunidad({ tramite: t, etapa: "ganado", ganada: en(2026, 12, 10) }));

    const filtros = leerFiltrosOportunidades({
      tramite: t, campo_fecha: "fecha_completada",
      desde: inicioDelDia(en(2026, 12, 1)).toISOString(),
      hasta: finDelDia(en(2026, 12, 31)).toISOString(),
    });
    const recorrido: string[] = [];
    for (const p of [1, 2]) {
      const r = await consultar({ filtros, userId: null, page: p, pageSize: 20 });
      recorrido.push(...r.oportunidades.map((o: any) => o.id));
    }
    expect(recorrido).toHaveLength(25);
    expect(new Set(recorrido).size).toBe(25);
    expect(new Set(recorrido)).toEqual(new Set(ids));
  });
});
