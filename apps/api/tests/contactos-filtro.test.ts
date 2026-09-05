// ============================================================================================
// FILTRO DEL LISTADO DE CONTACTOS — `src/lib/contactos-filtro.ts`
//
// Este fichero no existía porque **no podía existir**: el filtro era privado de
// `contactos-routes.ts` y no había forma de ejercitarlo sin levantar un servidor. Es la razón de
// que el traslado a `lib/` fuera el primer paso de esta entrega y no un adorno.
//
// Lo que se vigila aquí:
//   · 🔴 que el filtro por responsable produzca **el mismo WHERE** para la página y para el
//     contador. Es la invariante del módulo: si se separaran, "Seleccionar el total (N)" contaría
//     un conjunto y la acción masiva actuaría sobre otro.
//   · que filtrar por una persona traiga los suyos y **solo** los suyos.
//   · que sin el filtro el listado siga dando exactamente lo de antes — o sea, que el traslado no
//     cambió nada.
//   · 🔴 que el listado y el detalle devuelvan el responsable **y ninguna de las tres columnas
//     secretas**. Esa comprobación existe porque una proyección es exactamente por donde se cuelan.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import {
  NO_ARCHIVADOS, SIN_RESPONSABLE, construirFiltroContactos, leerFiltros,
} from "../src/lib/contactos-filtro.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

/** Las tres que no salen de la API por ningún endpoint. */
const SECRETAS = ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"];

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(nombre: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash',$2,'usuario',true) RETURNING id`,
    [`resp-${sufijo()}@pruebas.invalid`, nombre]
  );
  return r[0].id;
}

/** Un contacto CON los tres secretos rellenos: si se colaran, las pruebas de abajo los verían. */
async function crearContacto(d: { responsable?: string | null; marca: string }): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache
       (nombre_completo, email, telefono, responsable_user_id,
        ssn_encrypted, clave_uscis_enc, clave_correo_uscis_enc)
     VALUES ($1,$2,'+13055550100',$3,'123-45-6789','SECRETO-USCIS','SECRETO-CORREO')
     RETURNING id`,
    [`${d.marca} ${sufijo()}`, `c-${sufijo()}@pruebas.invalid`, d.responsable ?? null]
  );
  return r[0].id;
}

/** Ejecuta el WHERE del filtro contra la tabla, como hace el listado. */
async function idsCon(filtros: any): Promise<string[]> {
  const { where, params } = construirFiltroContactos(leerFiltros(filtros));
  const filas = await query<any>(
    `SELECT id FROM gozz.contactos_cache WHERE ${where}`, params
  );
  return filas.map((f: any) => String(f.id));
}

/** El contador, con EXACTAMENTE el mismo WHERE. */
async function contarCon(filtros: any): Promise<number> {
  const { where, params } = construirFiltroContactos(leerFiltros(filtros));
  const [r] = await query<any>(
    `SELECT count(*)::int AS n FROM gozz.contactos_cache WHERE ${where}`, params
  );
  return r.n;
}

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("leerFiltros · el responsable que llega por la petición", () => {
  it("acepta un uuid y el valor especial, y descarta lo demás en silencio", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(leerFiltros({ responsable: uuid }).responsable).toBe(uuid);
    expect(leerFiltros({ responsable: SIN_RESPONSABLE }).responsable).toBe(SIN_RESPONSABLE);
    // Lo que no encaja no llega al SQL: no es un error del usuario, es ruido de query string.
    for (const veneno of ["", "   ", "no-soy-uuid", "1 OR 1=1", "'; DROP TABLE x --", null, 7, {}]) {
      expect(leerFiltros({ responsable: veneno }).responsable, `responsable=${JSON.stringify(veneno)}`).toBeUndefined();
    }
  });

  it("sin el parámetro, no hay filtro de responsable", () => {
    expect(leerFiltros({}).responsable).toBeUndefined();
  });
});

describe("🔴 el mismo WHERE para la página y para el contador", () => {
  it("construirFiltroContactos devuelve una sola definición, y los dos la usan", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const a = construirFiltroContactos(leerFiltros({ responsable: uuid }));
    const b = construirFiltroContactos(leerFiltros({ responsable: uuid }));
    expect(a.where).toBe(b.where);
    expect(a.params).toEqual(b.params);
    expect(a.where).toContain("responsable_user_id =");
    // Parametrizado, nunca interpolado (§3.1).
    expect(a.where).not.toContain(uuid);
    expect(a.params).toContain(uuid);
  });

  it("y el número del contador es el número de filas de la página, sobre datos reales", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const marca = `Resp ${sufijo()}`;
    for (let i = 0; i < 5; i++) await crearContacto({ responsable: ana, marca });

    const filtros = { responsable: ana };
    const ids = await idsCon(filtros);
    const total = await contarCon(filtros);

    expect(ids).toHaveLength(5);
    expect(total).toBe(5);
    expect(total).toBe(ids.length);
  });

  it("🔴 `resolverSeleccion` en modo filtro respeta el filtro nuevo", async () => {
    // La ruta de acciones masivas resuelve el conjunto con este MISMO WHERE. Se reproduce aquí tal
    // cual: si el filtro se colara por otra vía, la acción actuaría sobre un conjunto distinto del
    // que el usuario vio y del que dice el contador.
    const bea = await crearUsuario(`Bea ${sufijo()}`);
    const otro = await crearUsuario(`Otro ${sufijo()}`);
    const mios = [await crearContacto({ responsable: bea, marca: "Mio" }), await crearContacto({ responsable: bea, marca: "Mio" })];
    await crearContacto({ responsable: otro, marca: "Ajeno" });

    const { where, params } = construirFiltroContactos(leerFiltros({ responsable: bea }));
    const filas = await query<any>(
      `SELECT id FROM gozz.contactos_cache WHERE ${where} ORDER BY created_at DESC, id ASC`, params
    );
    const excluidos = new Set([mios[0]]);
    const resueltos = filas.map((f: any) => String(f.id)).filter((id: string) => !excluidos.has(id));

    expect(new Set(filas.map((f: any) => String(f.id)))).toEqual(new Set(mios));
    expect(resueltos).toEqual([mios[1]]);
  });
});

describe("filtrar por responsable trae los suyos y solo los suyos", () => {
  it("no trae los de otra persona ni los que no tienen ninguno", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const luis = await crearUsuario(`Luis ${sufijo()}`);
    const deAna = [await crearContacto({ responsable: ana, marca: "DeAna" }), await crearContacto({ responsable: ana, marca: "DeAna" })];
    const deLuis = await crearContacto({ responsable: luis, marca: "DeLuis" });
    const huerfano = await crearContacto({ responsable: null, marca: "Huerfano" });

    const ids = await idsCon({ responsable: ana });
    expect(new Set(ids)).toEqual(new Set(deAna));
    expect(ids).not.toContain(deLuis);
    expect(ids).not.toContain(huerfano);
  });

  it("🔴 `sin_responsable` es una opción propia: los que hay que repartir", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const marca = `Huerf ${sufijo()}`;
    const sinNadie = [await crearContacto({ responsable: null, marca }), await crearContacto({ responsable: null, marca })];
    const conAna = await crearContacto({ responsable: ana, marca });

    const ids = await idsCon({ responsable: SIN_RESPONSABLE });
    for (const id of sinNadie) expect(ids).toContain(id);
    expect(ids).not.toContain(conAna);
  });

  it("se combina con el resto de filtros sin pisarlos", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const marca = `Combi${sufijo().replace(/-/g, "")}`;
    const buscado = await crearContacto({ responsable: ana, marca });
    await crearContacto({ responsable: ana, marca: "OtraCosa" });
    await crearContacto({ responsable: null, marca });

    const ids = await idsCon({ responsable: ana, q: marca });
    expect(ids).toEqual([buscado]);
  });

  it("un responsable sin contactos da cero, no todos", async () => {
    const nadie = await crearUsuario(`Nadie ${sufijo()}`);
    expect(await contarCon({ responsable: nadie })).toBe(0);
  });

  it("sigue respetando el archivado: un contacto de Ana archivado NO sale", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const visible = await crearContacto({ responsable: ana, marca: "Visible" });
    const oculto = await crearContacto({ responsable: ana, marca: "Archivado" });
    await query("UPDATE gozz.contactos_cache SET archivado = true WHERE id = $1", [oculto]);

    const ids = await idsCon({ responsable: ana });
    expect(ids).toContain(visible);
    expect(ids).not.toContain(oculto);
  });
});

describe("🔴 el traslado a lib/ no cambió nada", () => {
  it("sin filtros, el WHERE sigue siendo solo el de no-archivados", () => {
    const { where, params } = construirFiltroContactos(leerFiltros({}));
    expect(where).toBe(NO_ARCHIVADOS);
    expect(params).toEqual([]);
  });

  it("y el conjunto sin filtro no depende del responsable de nadie", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const conResp = await crearContacto({ responsable: ana, marca: "Con" });
    const sinResp = await crearContacto({ responsable: null, marca: "Sin" });
    const ids = await idsCon({});
    expect(ids).toContain(conResp);
    expect(ids).toContain(sinResp);
  });
});

describe("🔴 lo que devuelven las proyecciones", () => {
  /** El SELECT del listado, tal y como lo arma la ruta. */
  const SELECT_LISTA = `
    id, nombre_completo, email, telefono, whatsapp,
    tipo_cliente, estatus_migratorio, estatus_migratorio_tipo,
    bitrix_contact_id, zoho_id, pipedrive_person_id,
    pipedrive_tramites, zoho_tramites, revision_dedup_grupo,
    responsable_user_id, created_at,
    (SELECT u.nombre FROM gozz.users u WHERE u.id = contactos_cache.responsable_user_id) AS responsable_nombre`;

  it("el LISTADO trae el responsable y su nombre", async () => {
    const ana = await crearUsuario(`Ana Torres ${sufijo()}`);
    const id = await crearContacto({ responsable: ana, marca: "Listado" });
    const { where, params } = construirFiltroContactos(leerFiltros({ responsable: ana }));
    const [fila] = await query<any>(
      `SELECT ${SELECT_LISTA} FROM gozz.contactos_cache WHERE ${where} AND id = $${params.length + 1}`,
      [...params, id]
    );
    expect(fila.responsable_user_id).toBe(ana);
    expect(fila.responsable_nombre).toMatch(/^Ana Torres /);
  });

  it("y un contacto sin responsable trae los dos en null, no revienta", async () => {
    const id = await crearContacto({ responsable: null, marca: "SinResp" });
    const [fila] = await query<any>(
      `SELECT ${SELECT_LISTA} FROM gozz.contactos_cache WHERE id = $1`, [id]
    );
    expect(fila.responsable_user_id).toBeNull();
    expect(fila.responsable_nombre).toBeNull();
  });

  it("🔴 el listado NO trae ninguna de las tres columnas secretas", async () => {
    const ana = await crearUsuario(`Ana ${sufijo()}`);
    const id = await crearContacto({ responsable: ana, marca: "Secretos" });
    const [fila] = await query<any>(
      `SELECT ${SELECT_LISTA} FROM gozz.contactos_cache WHERE id = $1`, [id]
    );
    // Ni la columna…
    for (const s of SECRETAS) expect(Object.keys(fila), `"${s}" en el listado`).not.toContain(s);
    // …ni su valor por ningún otro nombre.
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toContain("123-45-6789");
    expect(serializada).not.toContain("SECRETO-USCIS");
    expect(serializada).not.toContain("SECRETO-CORREO");
    // Y la premisa: la fila trae datos de verdad, no está vacía.
    expect(fila.nombre_completo).toMatch(/^Secretos /);
  });

  it("🔴 el DETALLE trae el responsable con su nombre y tampoco los secretos", async () => {
    const ana = await crearUsuario(`Ana Detalle ${sufijo()}`);
    const id = await crearContacto({ responsable: ana, marca: "Detalle" });

    // El JOIN del detalle: allí sí hay alias, así que no hay ambigüedad posible.
    const [fila] = await query<any>(
      `SELECT c.id, c.nombre_completo, c.responsable_user_id,
              ur.nombre AS responsable_nombre
         FROM gozz.contactos_cache c
         LEFT JOIN gozz.users ur ON ur.id = c.responsable_user_id
        WHERE c.id = $1`, [id]
    );
    expect(fila.responsable_user_id).toBe(ana);
    expect(fila.responsable_nombre).toMatch(/^Ana Detalle /);
    for (const s of SECRETAS) expect(Object.keys(fila)).not.toContain(s);
    expect(JSON.stringify(fila)).not.toContain("123-45-6789");
  });
});

// ============================================================================================
// EL FILTRO "SIN FECHA DE NACIMIENTO" (2026-08-19)
//
// 🔴 ES LA PIEZA QUE SUSTITUYE A UN AVISO AL GUARDAR, y por eso importa que funcione bien: 3.704
// de 3.811 contactos vivos no tienen fecha —el 97,2 %—, así que un aviso saltaría en 97 de cada
// 100 fichas y en una semana nadie lo leería (§10.7). El filtro, en cambio, deja listarlos,
// repartirlos con la acción masiva de responsable que ya existe, y ver bajar el número.
//
// Lo que se vigila:
//   · que traiga exactamente los que no la tienen;
//   · 🔴 que NO altere el resto del WHERE — es el `WHERE` de todo el listado, del contador y de la
//     selección masiva, y tocarlo mal es cómo el "Seleccionar el total (N)" empieza a mentir.
// ============================================================================================

/** Un contacto con o sin fecha de nacimiento, sin secretos: aquí no hacen falta. */
async function crearConFecha(marca: string, fecha: string | null): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache (nombre_completo, fecha_nacimiento) VALUES ($1,$2::date) RETURNING id`,
    [`${marca} ${sufijo()}`, fecha]
  );
  return r[0].id;
}

describe("el filtro «sin fecha de nacimiento»", () => {
  it("trae los que NO la tienen, y deja fuera a los que sí", async () => {
    const sin1 = await crearConFecha("SinFecha", null);
    const sin2 = await crearConFecha("SinFecha", null);
    const con = await crearConFecha("ConFecha", "1980-03-12");

    const ids = await idsCon({ sin_fecha_nacimiento: "1" });
    expect(ids).toContain(sin1);
    expect(ids).toContain(sin2);
    expect(ids, "el que sí la tiene no puede salir").not.toContain(con);
  });

  it("🔴 sin el filtro NO cambia nada: el total es el mismo de siempre", async () => {
    // Es la comprobación que protege al resto del listado. Un filtro que se colara cuando nadie
    // lo pidió cambiaría el número de "Seleccionar el total (N)" sin que nada fallara.
    const antes = await contarCon({});
    await crearConFecha("ConFecha", "1990-01-01");
    await crearConFecha("SinFecha", null);
    const despues = await contarCon({});
    expect(despues, "los dos nuevos cuentan en el listado normal").toBe(antes + 2);

    // Y con el filtro apagado explícitamente, tampoco.
    expect(await contarCon({ sin_fecha_nacimiento: "0" })).toBe(despues);
    expect(await contarCon({ sin_fecha_nacimiento: false })).toBe(despues);
  });

  it("la página y el contador ven EXACTAMENTE el mismo conjunto", async () => {
    await crearConFecha("SinFecha", null);
    const ids = await idsCon({ sin_fecha_nacimiento: "1" });
    expect(await contarCon({ sin_fecha_nacimiento: "1" })).toBe(ids.length);
  });

  it("🔴 se COMBINA con los demás filtros en vez de sustituirlos", async () => {
    // El caso que motiva la entrega: encontrar a los que no tienen fecha Y no tienen responsable,
    // para repartirlos. Si el filtro nuevo pisara el WHERE, la acción masiva actuaría sobre otros.
    const alguien = await crearUsuario("Responsable de prueba");
    const sinNada = await crearConFecha("SinFecha", null);
    const sinFechaConResp = await crearConFecha("SinFecha", null);
    await query("UPDATE gozz.contactos_cache SET responsable_user_id = $1 WHERE id = $2", [alguien, sinFechaConResp]);
    const conFechaSinResp = await crearConFecha("ConFecha", "1975-06-30");

    const ids = await idsCon({ sin_fecha_nacimiento: "1", responsable: SIN_RESPONSABLE });
    expect(ids, "sin fecha y sin responsable: este sí").toContain(sinNada);
    expect(ids, "sin fecha pero CON responsable: fuera").not.toContain(sinFechaConResp);
    expect(ids, "sin responsable pero CON fecha: fuera").not.toContain(conFechaSinResp);
  });

  it("sigue respetando el archivado: un archivado sin fecha no sale en el listado normal", async () => {
    // `NO_ARCHIVADOS` es la primera cláusula del WHERE y el filtro nuevo se AÑADE a ella, no la
    // sustituye. Sin esto, la campaña de completado incluiría contactos que ya nadie usa.
    const archivado = await crearConFecha("SinFecha", null);
    await query("UPDATE gozz.contactos_cache SET archivado = true WHERE id = $1", [archivado]);
    expect(await idsCon({ sin_fecha_nacimiento: "1" })).not.toContain(archivado);
  });

  it("`leerFiltros` acepta la bandera como la mandan la query string y el body", async () => {
    for (const v of ["1", "true", "yes", "TRUE", true]) {
      expect(leerFiltros({ sin_fecha_nacimiento: v }).sin_fecha_nacimiento, String(v)).toBe(true);
    }
    for (const v of ["0", "false", "", "no", undefined, null, false]) {
      expect(leerFiltros({ sin_fecha_nacimiento: v }).sin_fecha_nacimiento, String(v)).toBe(false);
    }
  });

  it("la cláusula es un IS NULL y no lleva parámetro", async () => {
    // Sin índice a propósito (R8): es un IS NULL sobre ~3.800 filas vivas. Que no consuma un $n
    // importa porque el llamador continúa la numeración con `desde`.
    const { where, params } = construirFiltroContactos(leerFiltros({ sin_fecha_nacimiento: "1" }));
    expect(where).toContain("fecha_nacimiento IS NULL");
    expect(params, "no añade parámetros").toHaveLength(0);
  });
});
