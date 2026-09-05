// ============================================================================================
// OPORTUNIDADES — filtrado en servidor, conteos que cuadran y paginación
//
// EL DEFECTO QUE ESTO CIERRA: el tablero pedía `terminal_limit=150`, filtraba **en el navegador**
// sobre esa muestra, y el badge de cada columna salía de un `count(*)` sin ningún WHERE. Con el
// filtro "Asilo", GANADO enseñaba 2 casos y su badge decía 6.920. El sistema nunca dijo "hay 2
// asilos ganados": dijo "de mi muestra de 150, 2 son de asilo".
//
// Lo que se prueba aquí es lo que hace que ese número deje de mentir:
//   · el filtro devuelve el CONJUNTO REAL, contrastado contra un `count(*)` con el mismo WHERE;
//   · 🔴 el contador de cada etapa cuadra con las filas, para cualquier combinación de filtros;
//   · la paginación es estable de ida y vuelta, y la última página es alcanzable;
//   · 🔴 y la llamada SIN parámetros sigue devolviendo lo de siempre — lo que protege al
//     desplegable de `EmailDetailDrawer`, que se rompería en silencio.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import {
  SIN_TRAMITE, construirFiltroOportunidades, consultarOportunidades,
  hayFiltros, leerFiltrosOportunidades,
} from "../src/lib/oportunidades-filtro.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { usuarioDePruebas } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

/** El mismo `query` del runtime: los tests ejercitan la función real, no una copia. */
const consultar = (opts: any) => consultarOportunidades(query, opts);

async function crearTramite(nombre: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.tramites_config (nombre, codigo) VALUES ($1, $2) RETURNING id`,
    [nombre, nombre.toLowerCase().replace(/[^a-z0-9]/g, "_")]
  );
  return r[0].id;
}

async function crearOportunidad(d: {
  nombre: string; etapa: string; tramite?: string | null;
  preparador?: string | null; vendedor?: string | null; sla?: string | null; contacto?: string | null;
}): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (nombre_caso, etapa, tipo_tramite_id, preparador_id, vendedor_id, sla_estado, contacto_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [d.nombre, d.etapa, d.tramite ?? null, d.preparador ?? null, d.vendedor ?? null, d.sla ?? null, d.contacto ?? null]
  );
  return r[0].id;
}

/** El `count(*)` con EXACTAMENTE el mismo WHERE. Es contra esto que se contrasta la lista. */
async function contarConMismoWhere(filtros: any, userId: string | null = null): Promise<number> {
  const { where, params } = construirFiltroOportunidades(filtros, userId);
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

describe("🔴 compatibilidad · la llamada SIN parámetros no cambia", () => {
  it("devuelve el mismo conjunto que una consulta sin filtro ni límite", async () => {
    // `EmailDetailDrawer` llama a `/api/oportunidades` sin un solo parámetro y espera la lista
    // COMPLETA para poblar su desplegable. Si la paginación fuese el comportamiento por defecto,
    // esa pantalla se quedaría corta **sin dar ningún error** y nadie se enteraría hasta que
    // alguien no encontrase su caso. Este test es lo que impide que eso pase inadvertido.
    const s = Date.now().toString(36);
    const t = await crearTramite(`Compat ${s}`);
    for (let i = 0; i < 5; i++) await crearOportunidad({ nombre: `Compat ${s}-${i}`, etapa: i % 2 ? "ganado" : "nuevo", tramite: t });

    const filtros = leerFiltrosOportunidades({});
    expect(hayFiltros(filtros), "sin query string no hay ningún filtro").toBe(false);

    const r = await consultar({ filtros, userId: null });
    const todas = await query<any>(`SELECT id FROM gozz.oportunidades`);

    expect(r.oportunidades).toHaveLength(todas.length);
    expect(new Set(r.oportunidades.map((o: any) => o.id))).toEqual(new Set(todas.map((o: any) => o.id)));
    // Y sin paginar no aparecen los campos de paginación: la forma de la respuesta es la de antes.
    expect(r.page).toBeUndefined();
    expect(r.total).toBeUndefined();
    expect(r.counts).toBeTruthy();
  });

  it("los parámetros de muestreo de siempre siguen funcionando igual", async () => {
    const s = Date.now().toString(36);
    await crearOportunidad({ nombre: `Muestreo abierta ${s}`, etapa: "nuevo" });
    await crearOportunidad({ nombre: `Muestreo ganada ${s}`, etapa: "ganado" });

    const abiertas = await consultar({
      filtros: leerFiltrosOportunidades({}), userId: null, muestreo: { estado: "abiertas" },
    });
    expect(abiertas.oportunidades.every((o: any) => !["ganado", "perdido"].includes(o.etapa))).toBe(true);

    // 🔴 Y los CONTEOS siguen siendo del total, no de la muestra: el muestreo es transporte, no
    // significado. Si entrara en los conteos, el badge volvería a describir lo cargado.
    const ganadasReales = await query<any>(`SELECT count(*)::int AS n FROM gozz.oportunidades WHERE etapa = 'ganado'`);
    expect(abiertas.counts.ganado ?? 0).toBe(ganadasReales[0].n);
  });
});

describe("filtrar por trámite devuelve el CONJUNTO REAL, no una muestra", () => {
  it("las filas coinciden con el count(*) del mismo WHERE", async () => {
    const s = Date.now().toString(36);
    const asilo = await crearTramite(`Asilo ${s}`);
    const otro = await crearTramite(`Otro ${s}`);
    for (let i = 0; i < 7; i++) await crearOportunidad({ nombre: `Asilo ganado ${s}-${i}`, etapa: "ganado", tramite: asilo });
    for (let i = 0; i < 3; i++) await crearOportunidad({ nombre: `Otro ganado ${s}-${i}`, etapa: "ganado", tramite: otro });

    const filtros = leerFiltrosOportunidades({ tramite: asilo, etapa: "ganado" });
    const r = await consultar({ filtros, userId: null });

    expect(r.oportunidades).toHaveLength(7);
    expect(r.oportunidades).toHaveLength(await contarConMismoWhere(filtros));
    expect(r.oportunidades.every((o: any) => o.tipo_tramite_id === asilo)).toBe(true);
  });

  it("🔴 el contador de la etapa CUADRA con las filas — el badge deja de mentir", async () => {
    // Este es el defecto entero, en un test: antes el badge salía de un `count(*)` sin WHERE, así
    // que decía 6.920 mientras la columna enseñaba 2.
    const s = Date.now().toString(36);
    const t = await crearTramite(`Badge ${s}`);
    for (let i = 0; i < 4; i++) await crearOportunidad({ nombre: `Badge ganado ${s}-${i}`, etapa: "ganado", tramite: t });
    for (let i = 0; i < 2; i++) await crearOportunidad({ nombre: `Badge nuevo ${s}-${i}`, etapa: "nuevo", tramite: t });
    // Ruido de otro trámite en las mismas etapas: si el contador ignorara el filtro, los contaría.
    for (let i = 0; i < 9; i++) await crearOportunidad({ nombre: `Ruido ${s}-${i}`, etapa: "ganado" });

    const base = { tramite: t };
    const ganado = await consultar({ filtros: leerFiltrosOportunidades({ ...base, etapa: "ganado" }), userId: null });
    const nuevo = await consultar({ filtros: leerFiltrosOportunidades({ ...base, etapa: "nuevo" }), userId: null });

    // El contador de CADA etapa se calcula con los filtros pero SIN restringir por etapa, que es lo
    // que necesita el tablero para pintar los cinco badges de una sola respuesta.
    expect(ganado.counts.ganado).toBe(4);
    expect(ganado.counts.nuevo).toBe(2);
    expect(ganado.oportunidades).toHaveLength(ganado.counts.ganado);
    expect(nuevo.oportunidades).toHaveLength(nuevo.counts.nuevo);
    // Y los dos ven los mismos contadores, porque los filtros son los mismos.
    expect(nuevo.counts).toEqual(ganado.counts);
  });

  it("el contador cuadra con las filas para CUALQUIER combinación de filtros", async () => {
    const s = Date.now().toString(36);
    const t1 = await crearTramite(`Combi A ${s}`);
    const t2 = await crearTramite(`Combi B ${s}`);
    const ana = await usuarioDePruebas();
    const eva = (await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1,'x','Eva Combi','usuario') RETURNING id`, [`eva-combi-${s}@pruebas.invalid`]
    ))[0].id;

    await crearOportunidad({ nombre: `C1 ${s}`, etapa: "ganado", tramite: t1, preparador: ana, sla: "vencido" });
    await crearOportunidad({ nombre: `C2 ${s}`, etapa: "ganado", tramite: t1, preparador: eva, sla: "vencido" });
    await crearOportunidad({ nombre: `C3 ${s}`, etapa: "ganado", tramite: t2, preparador: ana, sla: "vencido" });
    await crearOportunidad({ nombre: `C4 ${s}`, etapa: "nuevo", tramite: t1, preparador: ana, sla: "on_track" });

    for (const filtrosCrudos of [
      { tramite: t1 },
      { tramite: t1, asignado: ana },
      { tramite: t1, asignado: ana, sla: "vencido" },
      { asignado: eva },
      { sla: "vencido", etapa: "ganado" },
      { q: `C1 ${s}` },
    ]) {
      const filtros = leerFiltrosOportunidades(filtrosCrudos);
      const r = await consultar({ filtros, userId: null });
      const esperado = await contarConMismoWhere(filtros);
      expect(r.oportunidades.length, JSON.stringify(filtrosCrudos)).toBe(esperado);
      // Y la suma de los contadores por etapa es el total bajo esos filtros, sin la etapa.
      const sinEtapa = await contarConMismoWhere({ ...filtros, etapa: undefined });
      const suma = Object.values(r.counts).reduce((a, b) => a + b, 0);
      expect(suma, `suma de counts con ${JSON.stringify(filtrosCrudos)}`).toBe(sinEtapa);
    }
  });

  it("los filtros combinados dan la INTERSECCIÓN, no la unión", async () => {
    const s = Date.now().toString(36);
    const t = await crearTramite(`Inter ${s}`);
    const ana = await usuarioDePruebas();
    const bueno = await crearOportunidad({ nombre: `Bueno ${s}`, etapa: "ganado", tramite: t, preparador: ana, sla: "vencido" });
    await crearOportunidad({ nombre: `Otro trámite ${s}`, etapa: "ganado", preparador: ana, sla: "vencido" });
    await crearOportunidad({ nombre: `Otro asignado ${s}`, etapa: "ganado", tramite: t, sla: "vencido" });
    await crearOportunidad({ nombre: `Otro sla ${s}`, etapa: "ganado", tramite: t, preparador: ana, sla: "on_track" });

    const r = await consultar({
      filtros: leerFiltrosOportunidades({ tramite: t, asignado: ana, sla: "vencido", etapa: "ganado" }),
      userId: null,
    });
    expect(r.oportunidades.map((o: any) => o.id)).toEqual([bueno]);
  });

  it("«asignado» encuentra tanto al preparador como al vendedor", async () => {
    // Para quien filtra, "asignado a Ana" es cualquiera de los dos papeles.
    const s = Date.now().toString(36);
    const t = await crearTramite(`Papeles ${s}`);
    const ana = (await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1,'x','Ana Papeles','usuario') RETURNING id`, [`ana-papeles-${s}@pruebas.invalid`]
    ))[0].id;
    const comoPreparador = await crearOportunidad({ nombre: `Prep ${s}`, etapa: "nuevo", tramite: t, preparador: ana });
    const comoVendedor = await crearOportunidad({ nombre: `Vend ${s}`, etapa: "nuevo", tramite: t, vendedor: ana });
    await crearOportunidad({ nombre: `Ajena ${s}`, etapa: "nuevo", tramite: t });

    const r = await consultar({ filtros: leerFiltrosOportunidades({ tramite: t, asignado: ana }), userId: null });
    expect(new Set(r.oportunidades.map((o: any) => o.id))).toEqual(new Set([comoPreparador, comoVendedor]));
  });
});

describe("🔴 «Sin trámite» es una categoría, no un hueco", () => {
  it("devuelve exactamente las de tipo_tramite_id IS NULL, y el contador cuadra", async () => {
    // Medido en producción: 242 oportunidades sin trámite, **223 de ellas ganadas**. Hoy no
    // aparecen bajo ningún filtro —el desplegable solo ofrece trámites concretos—, así que nadie
    // puede encontrarlas para corregirlas y son invisibles para cualquier campaña. Se enseña el
    // hueco, igual que el "sin usuario registrado" de la papelera de contactos.
    const s = Date.now().toString(36);
    const t = await crearTramite(`ConTramite ${s}`);
    const sin1 = await crearOportunidad({ nombre: `Sin trámite A ${s}`, etapa: "ganado" });
    const sin2 = await crearOportunidad({ nombre: `Sin trámite B ${s}`, etapa: "ganado" });
    const con = await crearOportunidad({ nombre: `Con trámite ${s}`, etapa: "ganado", tramite: t });

    const filtros = leerFiltrosOportunidades({ tramite: SIN_TRAMITE, etapa: "ganado" });
    const r = await consultar({ filtros, userId: null });
    const ids = r.oportunidades.map((o: any) => o.id);

    expect(ids).toEqual(expect.arrayContaining([sin1, sin2]));
    expect(ids).not.toContain(con);
    expect(r.oportunidades.every((o: any) => o.tipo_tramite_id === null)).toBe(true);
    expect(r.oportunidades).toHaveLength(await contarConMismoWhere(filtros));
    expect(r.counts.ganado).toBe(r.oportunidades.length);
  });

  it("con «todos los trámites» esas filas SÍ salen; solo desaparecen al filtrar por uno concreto", async () => {
    const s = Date.now().toString(36);
    const t = await crearTramite(`Todos ${s}`);
    const sinTramite = await crearOportunidad({ nombre: `Huérfana ${s}`, etapa: "nuevo" });
    await crearOportunidad({ nombre: `Con ${s}`, etapa: "nuevo", tramite: t });

    const todos = await consultar({ filtros: leerFiltrosOportunidades({ etapa: "nuevo" }), userId: null });
    expect(todos.oportunidades.map((o: any) => o.id)).toContain(sinTramite);

    const concreto = await consultar({ filtros: leerFiltrosOportunidades({ etapa: "nuevo", tramite: t }), userId: null });
    expect(concreto.oportunidades.map((o: any) => o.id), "al filtrar por un trámite concreto, fuera").not.toContain(sinTramite);
  });
});

describe("paginación por columna", () => {
  /** Un lote con el MISMO created_at: es el caso en que el desempate por id se gana el sueldo. */
  async function loteEnElMismoInstante(n: number, etapa: string, marca: string): Promise<string[]> {
    const r = await query<any>(
      `INSERT INTO gozz.oportunidades (nombre_caso, etapa, created_at)
       SELECT $1 || '-' || g, $2, now() FROM generate_series(1, $3) g RETURNING id`,
      [marca, etapa, n]
    );
    return r.map((x: any) => x.id);
  }

  it("🔴 el recorrido 1 → 2 → 3 → 2 → 1 devuelve las MISMAS filas al volver", async () => {
    // Sin el desempate por `id`, dos filas con el mismo `created_at` —y las importaciones masivas
    // crearon miles en el mismo instante— pueden salir en dos páginas o en ninguna al paginar.
    // Es la lección de C6, y por eso el lote de este test comparte `created_at` al milisegundo:
    // si el orden dependiera solo de la fecha, este caso sería un sorteo.
    const s = Date.now().toString(36);
    const t = await crearTramite(`Pag ${s}`);
    const ids = await loteEnElMismoInstante(45, "ganado", `Pag ${s}`);
    await query(`UPDATE gozz.oportunidades SET tipo_tramite_id = $1 WHERE id = ANY($2::uuid[])`, [t, ids]);

    const filtros = leerFiltrosOportunidades({ tramite: t, etapa: "ganado" });
    const pagina = async (p: number) =>
      (await consultar({ filtros, userId: null, page: p, pageSize: 20 })).oportunidades.map((o: any) => o.id);

    const ida1 = await pagina(1), ida2 = await pagina(2), ida3 = await pagina(3);
    const vuelta2 = await pagina(2), vuelta1 = await pagina(1);

    expect(ida1).toHaveLength(20);
    expect(ida2).toHaveLength(20);
    expect(ida3).toHaveLength(5);
    expect(vuelta2, "la página 2 al volver es la misma que a la ida").toEqual(ida2);
    expect(vuelta1, "y la 1 también").toEqual(ida1);
    // Y las tres páginas no comparten ni una fila.
    expect(new Set([...ida1, ...ida2, ...ida3]).size).toBe(45);
  });

  it("recorrer todas las páginas no repite ni se salta ninguna fila", async () => {
    const s = Date.now().toString(36);
    const t = await crearTramite(`Recorrido ${s}`);
    const ids = await loteEnElMismoInstante(45, "ganado", `Rec ${s}`);
    await query(`UPDATE gozz.oportunidades SET tipo_tramite_id = $1 WHERE id = ANY($2::uuid[])`, [t, ids]);

    const filtros = leerFiltrosOportunidades({ tramite: t, etapa: "ganado" });
    const primera = await consultar({ filtros, userId: null, page: 1, pageSize: 20 });
    expect(primera.total).toBe(45);
    expect(primera.totalPages).toBe(3);

    const recorrido: string[] = [];
    for (let p = 1; p <= primera.totalPages!; p++) {
      const r = await consultar({ filtros, userId: null, page: p, pageSize: 20 });
      recorrido.push(...r.oportunidades.map((o: any) => o.id));
    }
    expect(recorrido).toHaveLength(45);
    expect(new Set(recorrido).size, "ninguna repetida").toBe(45);
    expect(new Set(recorrido)).toEqual(new Set(ids));

    // La última página es ALCANZABLE y trae las 5 que faltan: nada queda fuera.
    const ultima = await consultar({ filtros, userId: null, page: 3, pageSize: 20 });
    expect(ultima.oportunidades).toHaveLength(5);
    // Y una página más allá del final está vacía, no da error ni repite la última.
    const masAlla = await consultar({ filtros, userId: null, page: 4, pageSize: 20 });
    expect(masAlla.oportunidades).toHaveLength(0);
  });

  it("el total de la paginación cuadra con el contador de su etapa", async () => {
    const s = Date.now().toString(36);
    const t = await crearTramite(`Total ${s}`);
    const ids = await loteEnElMismoInstante(12, "preparacion", `Tot ${s}`);
    await query(`UPDATE gozz.oportunidades SET tipo_tramite_id = $1 WHERE id = ANY($2::uuid[])`, [t, ids]);

    const r = await consultar({
      filtros: leerFiltrosOportunidades({ tramite: t, etapa: "preparacion" }),
      userId: null, page: 1, pageSize: 20,
    });
    expect(r.total).toBe(12);
    expect(r.counts.preparacion).toBe(12);
    expect(r.total).toBe(r.counts.preparacion);
  });
});
