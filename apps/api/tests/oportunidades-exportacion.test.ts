// ============================================================================================
// EXPORTACIÓN DE OPORTUNIDADES — `lib/exportacion.ts` + `lib/oportunidades-exportacion.ts`
//
// 🔴 ES EL ÚNICO PUNTO DEL CRM POR DONDE LOS DATOS DE CLIENTES SALEN A UN TERCERO, así que lo que
// se comprueba aquí no es que la función "funcione": es el FICHERO.
//
//   · R11 — se genera el fichero de verdad y se hace **grep de los tres campos sensibles sobre su
//     contenido**. Comprobar la lista blanca es comprobar la intención; comprobar el fichero es
//     comprobar el resultado, y es el resultado el que se manda fuera.
//   · El escapado del CSV — un nombre con una coma **parte la fila sin dar ningún error** y el
//     fichero entra mal en un CRM externo. Se prueba parseando el CSV de vuelta, no mirando la cadena.
//   · El BOM — sin él Excel abre los acentos rotos y el fichero parece corrupto.
//   · Que lo exportado sea **exactamente** lo que cuenta la pantalla, en los dos modos.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { Writable } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import {
  BOM_UTF8, escaparCsv, escribirCsv, escribirExportacion, escribirXlsx, esFormato,
} from "../src/lib/exportacion.js";
import {
  COLUMNAS_EXPORTABLES, columnasParaLaInterfaz, contarExportables, iterarExportables,
  registrarExportacion, validarColumnas, whereDeSeleccion,
} from "../src/lib/oportunidades-exportacion.js";
import { nombreFichero } from "../src/oportunidades-exportacion-routes.js";
import { puede } from "../src/lib/permisos.js";
import { parsearSeleccion } from "../src/lib/seleccion.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

/** Los tres campos que NO pueden salir del edificio. Nombres reales de `contactos_cache`. */
const SENSIBLES = ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"];

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

/** Acumula lo escrito, como haría el `res` de Express pero sin salir a la red. */
function crearBuzon() {
  const trozos: Buffer[] = [];
  const w = new Writable({
    write(chunk, _enc, cb) { trozos.push(Buffer.from(chunk)); cb(); },
  });
  return {
    stream: w,
    texto: () => Buffer.concat(trozos).toString("utf8"),
    bytes: () => Buffer.concat(trozos),
  };
}

async function crearTramite(nombre: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.tramites_config (nombre, codigo, formulario_uscis) VALUES ($1,$2,$3) RETURNING id`,
    [nombre, `cod_${sufijo().replace(/-/g, "_")}`, "I-589"]
  );
  return r[0].id;
}

/** Un contacto CON los tres campos sensibles rellenos: si se colaran, el grep los vería. */
async function crearContactoConSecretos(nombre: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache
       (nombre_completo, telefono, whatsapp, email, ssn_encrypted, clave_uscis_enc, clave_correo_uscis_enc)
     VALUES ($1,'+1 305 555 0100','+13055550100',$2,'123-45-6789','SECRETO-USCIS','SECRETO-CORREO')
     RETURNING id`,
    [nombre, `cliente-${sufijo()}@pruebas.invalid`]
  );
  return r[0].id;
}

async function crearOportunidad(d: {
  nombre?: string; etapa?: string; tramite?: string | null; contacto?: string | null;
  valor?: number; creada?: Date; sla?: string | null;
}): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (nombre_caso, etapa, tipo_tramite_id, contacto_id, valor_total, created_at, sla_estado)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()),$7) RETURNING id`,
    [d.nombre ?? `Caso ${sufijo()}`, d.etapa ?? "nuevo", d.tramite ?? null, d.contacto ?? null,
     d.valor ?? 1000, d.creada ?? null, d.sla ?? null]
  );
  return r[0].id;
}

const TODAS = COLUMNAS_EXPORTABLES.map((c) => c.clave);
const cols = (claves: string[]) => validarColumnas(claves).columnas!;

/** Parser de CSV con comillas, para comprobar el escapado de verdad y no por inspección visual. */
function parsearCsv(texto: string): string[][] {
  const sin = texto.startsWith(BOM_UTF8) ? texto.slice(BOM_UTF8.length) : texto;
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;
  for (let i = 0; i < sin.length; i++) {
    const ch = sin[i];
    if (enComillas) {
      if (ch === '"') {
        if (sin[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') { enComillas = true; continue; }
    if (ch === ",") { fila.push(campo); campo = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; continue; }
    campo += ch;
  }
  if (campo !== "" || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("la lista blanca de columnas", () => {
  it("🔴 los tres campos sensibles NO están, y no hay forma de pedirlos", () => {
    const claves = COLUMNAS_EXPORTABLES.map((c) => c.clave);
    const sql = COLUMNAS_EXPORTABLES.map((c) => c.sql).join(" ");
    for (const s of SENSIBLES) {
      expect(claves, `"${s}" no puede estar entre las columnas exportables`).not.toContain(s);
      expect(sql, `ninguna expresión SQL puede tocar "${s}"`).not.toContain(s);
    }
    // Y ninguna expresión es un comodín sobre la tabla que los guarda.
    expect(sql).not.toContain("c.*");
    expect(sql).not.toContain("*");
  });

  it("una columna fuera de la lista se rechaza, no se ignora", () => {
    expect(validarColumnas(["nombre_caso", "ssn_encrypted"]).error).toMatch(/no permitidas/);
    expect(validarColumnas(["clave_uscis_enc"]).error).toMatch(/no permitidas/);
    expect(validarColumnas(["telefono", "inventada"]).error).toMatch(/inventada/);
    expect(validarColumnas([]).error).toMatch(/al menos una/);
    expect(validarColumnas(null).error).toBeTruthy();
    expect(validarColumnas("nombre_caso").error).toBeTruthy();
  });

  it("acepta las de la lista y las devuelve en el orden de la lista, no en el que llegaron", () => {
    const r = validarColumnas(["email", "nombre_caso", "etapa"]);
    expect(r.error).toBeUndefined();
    // Dos exportaciones con las mismas columnas producen la misma cabecera, venga como venga el body.
    expect(r.columnas!.map((c) => c.clave)).toEqual(["nombre_caso", "etapa", "email"]);
  });

  it("la interfaz recibe las columnas SIN el SQL", () => {
    for (const c of columnasParaLaInterfaz()) {
      expect(c).not.toHaveProperty("sql");
      expect(c.grupo).toBeTruthy();
    }
    expect(new Set(columnasParaLaInterfaz().map((c) => c.grupo)))
      .toEqual(new Set(["Caso", "Cliente", "Dinero", "Personas", "Plazos"]));
  });
});

describe("🔴 R11 · sobre el FICHERO generado, no sobre la lista", () => {
  it("ningún campo sensible aparece en el CSV, ni con TODAS las columnas pedidas", async () => {
    const t = await crearTramite(`Asilo ${sufijo()}`);
    const contacto = await crearContactoConSecretos(`Cliente secreto ${sufijo()}`);
    const ids = [
      await crearOportunidad({ tramite: t, contacto, nombre: `Con secretos ${sufijo()}` }),
      await crearOportunidad({ tramite: t, contacto, nombre: `Con secretos ${sufijo()}` }),
    ];
    const seleccion = { modo: "ids" as const, ids };

    const buzon = crearBuzon();
    const n = await escribirCsv(buzon.stream, cols(TODAS), iterarExportables(seleccion, null, cols(TODAS)));
    const texto = buzon.texto();

    expect(n).toBe(2);
    // El fichero SÍ trae los datos que debe traer — si estuviera vacío, el grep pasaría por nada.
    expect(texto).toContain("Con secretos");
    expect(texto).toContain("+1 305 555 0100");

    // 🔴 El grep: ni el nombre de la columna, ni su valor.
    for (const s of SENSIBLES) expect(texto, `"${s}" en el fichero`).not.toContain(s);
    expect(texto).not.toContain("123-45-6789");
    expect(texto).not.toContain("SECRETO-USCIS");
    expect(texto).not.toContain("SECRETO-CORREO");
  });

  it("tampoco en el XLSX", async () => {
    const contacto = await crearContactoConSecretos(`Cliente xlsx ${sufijo()}`);
    const ids = [await crearOportunidad({ contacto, nombre: `Xlsx ${sufijo()}` })];
    const buzon = crearBuzon();
    await escribirXlsx(buzon.stream, cols(TODAS), iterarExportables({ modo: "ids", ids }, null, cols(TODAS)));

    // Un .xlsx es un zip: los textos van comprimidos, así que se busca sobre los bytes en crudo y
    // además se descomprime para mirar el XML de verdad.
    const bytes = buzon.bytes();
    expect(bytes.length).toBeGreaterThan(0);
    const crudo = bytes.toString("latin1");
    for (const s of SENSIBLES) expect(crudo, `"${s}" en los bytes del xlsx`).not.toContain(s);
    expect(crudo).not.toContain("123-45-6789");
  });
});

describe("el conjunto exportado es el mismo que cuenta la pantalla", () => {
  it("modo `ids`: exporta exactamente los marcados", async () => {
    const t = await crearTramite(`Marcados ${sufijo()}`);
    const dentro = [await crearOportunidad({ tramite: t }), await crearOportunidad({ tramite: t })];
    await crearOportunidad({ tramite: t }); // no marcada

    const seleccion = { modo: "ids" as const, ids: dentro };
    expect(await contarExportables(seleccion, null)).toBe(2);

    const buzon = crearBuzon();
    const n = await escribirCsv(buzon.stream, cols(["nombre_caso"]), iterarExportables(seleccion, null, cols(["nombre_caso"])));
    expect(n).toBe(2);
    expect(parsearCsv(buzon.texto())).toHaveLength(3); // cabecera + 2
  });

  it("🔴 modo `filtro`: el número que exporta es el que devuelve el contador, con el MISMO WHERE", async () => {
    const t = await crearTramite(`Filtro ${sufijo()}`);
    for (let i = 0; i < 5; i++) await crearOportunidad({ tramite: t, etapa: "ganado" });
    for (let i = 0; i < 3; i++) await crearOportunidad({ tramite: t, etapa: "nuevo" });

    const seleccion = { modo: "filtro" as const, filtros: { tramite: t, etapa: "ganado" }, excluidos: [] };
    const total = await contarExportables(seleccion, null);
    expect(total).toBe(5);

    // Contrastado contra la base con el mismo WHERE, no contra la propia función.
    const { where, params } = whereDeSeleccion(seleccion, null);
    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.oportunidades o
         LEFT JOIN gozz.contactos_cache c ON c.id = o.contacto_id
         LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
        WHERE ${where}`, params
    );
    expect(n).toBe(5);

    const buzon = crearBuzon();
    const filas = await escribirCsv(buzon.stream, cols(["nombre_caso"]), iterarExportables(seleccion, null, cols(["nombre_caso"])));
    expect(filas).toBe(total);
  });

  it("respeta los excluidos de 'seleccionar el total'", async () => {
    const t = await crearTramite(`Excluidos ${sufijo()}`);
    const ids = [await crearOportunidad({ tramite: t }), await crearOportunidad({ tramite: t }), await crearOportunidad({ tramite: t })];
    const seleccion = { modo: "filtro" as const, filtros: { tramite: t }, excluidos: [ids[0]] };
    expect(await contarExportables(seleccion, null)).toBe(2);
  });

  it("🔴 la etapa NO está restringida a ganadas", async () => {
    const t = await crearTramite(`Etapas ${sufijo()}`);
    await crearOportunidad({ tramite: t, etapa: "ganado" });
    await crearOportunidad({ tramite: t, etapa: "perdido" });
    await crearOportunidad({ tramite: t, etapa: "nuevo" });
    // Sin filtro de etapa salen las tres; con "perdido", sale la perdida.
    expect(await contarExportables({ modo: "filtro", filtros: { tramite: t }, excluidos: [] }, null)).toBe(3);
    expect(await contarExportables({ modo: "filtro", filtros: { tramite: t, etapa: "perdido" }, excluidos: [] }, null)).toBe(1);
  });
});

describe("🔴 el CSV no se rompe con lo que la gente escribe de verdad", () => {
  it("escapa comas, comillas y saltos de línea (RFC 4180)", () => {
    expect(escaparCsv("simple")).toBe("simple");
    expect(escaparCsv("Pérez, Juan")).toBe('"Pérez, Juan"');
    expect(escaparCsv('Caso "urgente"')).toBe('"Caso ""urgente"""');
    expect(escaparCsv("línea1\nlínea2")).toBe('"línea1\nlínea2"');
    expect(escaparCsv(null)).toBe("");
    expect(escaparCsv(undefined)).toBe("");
    expect(escaparCsv(0)).toBe("0");
    // Un espacio delante también fuerza comillas: sin ellas algunos lectores lo recortan.
    expect(escaparCsv(" 305")).toBe('" 305"');
  });

  it("un nombre con coma y comillas NO parte la fila — parseado de vuelta", async () => {
    const t = await crearTramite(`Comas ${sufijo()}`);
    const contacto = await crearContactoConSecretos(`Apellido, Nombre ${sufijo()}`);
    const nombreCaso = `Asilo "urgente", con coma ${sufijo()}`;
    const id = await crearOportunidad({ tramite: t, contacto, nombre: nombreCaso });

    const columnas = cols(["nombre_caso", "contacto", "telefono", "email"]);
    const buzon = crearBuzon();
    await escribirCsv(buzon.stream, columnas, iterarExportables({ modo: "ids", ids: [id] }, null, columnas));

    const filas = parsearCsv(buzon.texto());
    expect(filas).toHaveLength(2);
    // 🔴 Cuatro columnas, no seis: es lo que la coma habría partido.
    expect(filas[0]).toHaveLength(4);
    expect(filas[1]).toHaveLength(4);
    // Y el valor vuelve intacto, comillas incluidas.
    expect(filas[1][0]).toBe(nombreCaso);
    expect(filas[1][1]).toContain("Apellido, Nombre");
  });

  it("🔴 empieza con BOM UTF-8, o Excel abre los acentos rotos", async () => {
    const id = await crearOportunidad({ nombre: `Rodríguez Muñoz ${sufijo()}` });
    const buzon = crearBuzon();
    await escribirCsv(buzon.stream, cols(["nombre_caso"]), iterarExportables({ modo: "ids", ids: [id] }, null, cols(["nombre_caso"])));

    const bytes = buzon.bytes();
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buzon.texto().startsWith(BOM_UTF8)).toBe(true);
    // Y los acentos llegan bien al otro lado.
    expect(buzon.texto()).toContain("Rodríguez Muñoz");
  });

  it("🔴 el estado del SLA sale traducido, no como identificador interno", async () => {
    // El fichero se abre en Excel y se sube a un CRM externo: es texto de cara al usuario (§4.7). Y las
    // etiquetas son LAS MISMAS que pinta `SLABadge.tsx` — si el fichero y la pantalla llamaran
    // distinto a lo mismo, uno de los dos sobra.
    const id = await crearOportunidad({ nombre: `Con SLA ${sufijo()}`, sla: "on_track" });
    const columnas = cols(["nombre_caso", "sla_estado"]);
    const buzon = crearBuzon();
    await escribirCsv(buzon.stream, columnas, iterarExportables({ modo: "ids", ids: [id] }, null, columnas));
    const texto = buzon.texto();

    // La premisa primero: si el fichero saliera vacío, el segundo assert pasaría por nada.
    const filas = parsearCsv(texto);
    expect(filas).toHaveLength(2);
    expect(filas[1][0]).toContain("Con SLA");

    expect(filas[1][1]).toBe("A tiempo");
    expect(texto, "el identificador interno no puede llegar al fichero").not.toContain("on_track");
  });

  it("traduce los cuatro estados con las mismas etiquetas que la pantalla", async () => {
    const esperado: [string, string][] = [
      ["on_track", "A tiempo"], ["warning", "Atención"], ["vencido", "Vencido"], ["completado", "Cerrado"],
    ];
    // ⚠️ El nombre del caso NO puede llevar el identificador dentro, o el `not.toContain` de abajo
    // se dispararía por la columna equivocada y el test diría lo que no es.
    const ids: string[] = [];
    for (const [crudo] of esperado) ids.push(await crearOportunidad({ sla: crudo, nombre: `Caso SLA ${sufijo()}` }));

    const columnas = cols(["nombre_caso", "sla_estado"]);
    const buzon = crearBuzon();
    await escribirCsv(buzon.stream, columnas, iterarExportables({ modo: "ids", ids }, null, columnas));
    const texto = buzon.texto();

    expect(parsearCsv(texto)).toHaveLength(5);
    for (const [crudo, etiqueta] of esperado) {
      expect(texto, `falta la etiqueta "${etiqueta}"`).toContain(etiqueta);
      expect(texto, `se coló el identificador "${crudo}"`).not.toContain(crudo);
    }
  });

  it("🔴 si aparece un quinto estado, este test cae antes que el fichero salga mal", async () => {
    // El `CASE` lleva un `ELSE o.sla_estado` para que un estado sin traducir salga con su
    // identificador y se note, en vez de convertirse en una celda vacía. **Ese ELSE no se puede
    // ejercitar con datos**: `oportunidades_sla_estado_check` acota la columna a estos cuatro
    // valores exactos, así que un quinto no cabe en la tabla. Lo que sí se puede vigilar es la
    // frontera: el día que alguien añada un estado al CHECK sin añadir su etiqueta, cae aquí y el
    // mensaje dice dónde mirar.
    const [{ d }] = await query<any>(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'oportunidades_sla_estado_check'`
    );
    expect(d, "sin el CHECK, un estado sin etiqueta sí podría llegar al fichero").toBeTruthy();

    const enElCheck = [...String(d).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    const traducidos = ["on_track", "warning", "vencido", "completado"].sort();
    expect(
      enElCheck,
      "hay un estado de SLA que la exportación no traduce — añádelo al CASE de COLUMNAS_EXPORTABLES y a SLABadge.tsx"
    ).toEqual(traducidos);
  });

  it("la cabecera lleva las etiquetas legibles, no las claves internas", async () => {
    const id = await crearOportunidad({});
    const columnas = cols(["nombre_caso", "fecha_completada"]);
    const buzon = crearBuzon();
    await escribirCsv(buzon.stream, columnas, iterarExportables({ modo: "ids", ids: [id] }, null, columnas));
    expect(parsearCsv(buzon.texto())[0]).toEqual(["Caso", "Fecha de ganado"]);
  });
});

describe("los dos formatos", () => {
  it("los reconoce y rechaza cualquier otro", () => {
    expect(esFormato("csv")).toBe(true);
    expect(esFormato("xlsx")).toBe(true);
    expect(esFormato("pdf")).toBe(false);
    expect(esFormato("")).toBe(false);
  });

  it("los dos generan un fichero no vacío con la cabecera correcta", async () => {
    const t = await crearTramite(`Formatos ${sufijo()}`);
    const ids = [await crearOportunidad({ tramite: t }), await crearOportunidad({ tramite: t })];
    const columnas = cols(["nombre_caso", "etapa"]);

    const csv = crearBuzon();
    const nCsv = await escribirExportacion("csv", csv.stream, columnas, iterarExportables({ modo: "ids", ids }, null, columnas));
    expect(nCsv).toBe(2);
    expect(parsearCsv(csv.texto())[0]).toEqual(["Caso", "Etapa"]);

    const xlsx = crearBuzon();
    const nXlsx = await escribirExportacion("xlsx", xlsx.stream, columnas, iterarExportables({ modo: "ids", ids }, null, columnas), "Oportunidades");
    expect(nXlsx).toBe(2);
    const bytes = xlsx.bytes();
    expect(bytes.length).toBeGreaterThan(0);
    // Firma de un zip — un .xlsx lo es. Si saliera vacío o a medias, esto lo caza.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(bytes.toString("latin1")).toContain("xl/worksheets");
  });
});

describe("el recorrido por lotes", () => {
  it("recorre más filas que el lote sin repetir ni saltarse ninguna", async () => {
    // El lote de producción es 1.000; aquí basta con cruzarlo conceptualmente comprobando que el
    // cursor avanza y que el conjunto sale entero y en el orden del tablero.
    const t = await crearTramite(`Lotes ${sufijo()}`);
    const base = new Date("2026-05-01T12:00:00Z").getTime();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(await crearOportunidad({ tramite: t, creada: new Date(base + i * 60000) }));
    }
    const seleccion = { modo: "filtro" as const, filtros: { tramite: t }, excluidos: [] };
    const columnas = cols(["nombre_caso", "created_at"]);

    const vistos: string[] = [];
    for await (const lote of iterarExportables(seleccion, null, columnas)) {
      for (const f of lote) vistos.push(f.nombre_caso);
    }
    expect(vistos).toHaveLength(25);
    expect(new Set(vistos).size).toBe(25);

    // El orden es el del tablero: `created_at DESC`. La última creada sale primera.
    const csvBuzon = crearBuzon();
    await escribirCsv(csvBuzon.stream, columnas, iterarExportables(seleccion, null, columnas));
    const filas = parsearCsv(csvBuzon.texto()).slice(1);
    const fechas = filas.map((f) => f[1]);
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it("🔴 una oportunidad con `created_at` NULL no se queda fuera del recorrido", async () => {
    // `created_at` admite NULL y en `ORDER BY … DESC` Postgres las pone PRIMERO. Un cursor ingenuo
    // (`created_at < $1`) las dejaría fuera **en silencio**, que es justo lo que no se acepta aquí.
    const t = await crearTramite(`Nulos ${sufijo()}`);
    const conFecha = await crearOportunidad({ tramite: t, creada: new Date("2026-04-01T10:00:00Z") });
    const sinFecha = await crearOportunidad({ tramite: t });
    await query("UPDATE gozz.oportunidades SET created_at = NULL WHERE id = $1", [sinFecha]);

    const seleccion = { modo: "filtro" as const, filtros: { tramite: t }, excluidos: [] };
    expect(await contarExportables(seleccion, null)).toBe(2);

    const columnas = cols(["nombre_caso"]);
    const vistos: string[] = [];
    for await (const lote of iterarExportables(seleccion, null, columnas)) for (const f of lote) vistos.push(f.nombre_caso);
    expect(vistos, "las dos tienen que salir, la de fecha nula incluida").toHaveLength(2);

    const nombres = await query<any>(
      "SELECT nombre_caso FROM gozz.oportunidades WHERE id = ANY($1::uuid[])", [[conFecha, sinFecha]]
    );
    expect(new Set(vistos)).toEqual(new Set(nombres.map((r: any) => r.nombre_caso)));
  });
});

describe("🔴 quién puede exportar", () => {
  const PERMISO = "exportar_oportunidades";

  async function crearUsuario(nivel = "usuario", activo = true): Promise<string> {
    const r = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ($1,'no-es-un-hash','Exportador',$2,$3) RETURNING id`,
      [`export-${sufijo()}@pruebas.invalid`, nivel, activo]
    );
    return r[0].id;
  }

  it("un usuario normal NO puede; con el permiso, sí; un admin lo tiene por rol", async () => {
    const normal = await crearUsuario();
    expect(await puede(normal, PERMISO)).toBe(false);
    await query("INSERT INTO gozz.user_permisos (user_id, permiso) VALUES ($1,$2)", [normal, PERMISO]);
    expect(await puede(normal, PERMISO)).toBe(true);
    expect(await puede(await crearUsuario("admin"), PERMISO)).toBe(true);
  });

  it("un usuario DESACTIVADO con el permiso tampoco exporta", async () => {
    const apagado = await crearUsuario("usuario", false);
    await query("INSERT INTO gozz.user_permisos (user_id, permiso) VALUES ($1,$2)", [apagado, PERMISO]);
    expect(await puede(apagado, PERMISO)).toBe(false);
  });

  it("el permiso de exportar CONTACTOS no sirve para exportar oportunidades", async () => {
    // Son dos cosas distintas con dos reglas distintas: `exportar_contactos` es de su entrega.
    const u = await crearUsuario();
    await query("INSERT INTO gozz.user_permisos (user_id, permiso) VALUES ($1,'exportar_contactos')", [u]);
    expect(await puede(u, "exportar_contactos")).toBe(true);
    expect(await puede(u, PERMISO)).toBe(false);
  });

  it("🔴 el permiso NO viene sembrado en ninguna migración", async () => {
    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.user_permisos p
         JOIN gozz.users u ON u.id = p.user_id
        WHERE p.permiso = $1 AND u.email NOT LIKE 'export-%@pruebas.invalid'`,
      [PERMISO]
    );
    expect(n).toBe(0);
  });
});

describe("🔴 la constancia: cada exportación deja rastro", () => {
  it("registra quién, cuántas, con qué alcance y qué columnas", async () => {
    const t = await crearTramite(`Bitácora ${sufijo()}`);
    const ids = [await crearOportunidad({ tramite: t }), await crearOportunidad({ tramite: t })];
    const [{ id: user }] = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ($1,'x','Quien exporta','admin',true) RETURNING id`,
      [`auditor-${sufijo()}@pruebas.invalid`]
    );

    await registrarExportacion({
      userId: user, filas: 2, formato: "csv",
      columnas: ["nombre_caso", "telefono"],
      seleccion: { modo: "ids", ids },
      totalAlContar: 2,
    });

    const [f] = await query<any>(
      `SELECT user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues
         FROM gozz.auditoria WHERE user_id = $1 AND registro_id = 'exportacion'`, [user]
    );
    expect(f).toBeTruthy();
    expect(f.user_id).toBe(user);
    expect(f.accion).toContain("Exportó 2 oportunidades en CSV");
    expect(f.datos_despues.filas).toBe(2);
    expect(f.datos_despues.formato).toBe("csv");
    expect(f.datos_despues.columnas).toEqual(["nombre_caso", "telefono"]);
    expect(f.datos_despues.alcance.modo).toBe("ids");
    expect(f.datos_despues.alcance.n).toBe(2);
  });

  it("guarda el FILTRO cuando el alcance fue 'seleccionar el total'", async () => {
    const [{ id: user }] = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ($1,'x','Total','admin',true) RETURNING id`, [`auditor2-${sufijo()}@pruebas.invalid`]
    );
    await registrarExportacion({
      userId: user, filas: 4321, formato: "xlsx", columnas: ["nombre_caso"],
      seleccion: { modo: "filtro", filtros: { etapa: "ganado", tramite: "abc" }, excluidos: [] },
      totalAlContar: 4321,
    });
    const [f] = await query<any>(
      `SELECT datos_despues FROM gozz.auditoria WHERE user_id = $1 AND registro_id='exportacion'`, [user]
    );
    // El alcance permite reconstruir QUÉ conjunto salió, sin copiar los datos de nadie.
    expect(f.datos_despues.alcance).toEqual({ modo: "filtro", filtros: { etapa: "ganado", tramite: "abc" }, excluidos: [] });
    expect(f.datos_despues.filas).toBe(4321);
  });

  it("🔴 NO guarda el contenido: ni un nombre, ni un teléfono, ni un email", async () => {
    const contacto = await crearContactoConSecretos(`Cliente bitácora ${sufijo()}`);
    const id = await crearOportunidad({ contacto, nombre: `Caso bitácora ${sufijo()}` });
    const [{ id: user }] = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ($1,'x','Sin contenido','admin',true) RETURNING id`, [`auditor3-${sufijo()}@pruebas.invalid`]
    );
    await registrarExportacion({
      userId: user, filas: 1, formato: "csv", columnas: ["contacto", "telefono", "email"],
      seleccion: { modo: "ids", ids: [id] }, totalAlContar: 1,
    });

    const [f] = await query<any>(
      `SELECT datos_despues::text AS txt FROM gozz.auditoria WHERE user_id = $1`, [user]
    );
    // La bitácora dice que salió el teléfono, no CUÁL era.
    expect(f.txt).toContain("telefono");
    expect(f.txt).not.toContain("+1 305 555 0100");
    expect(f.txt).not.toContain("Cliente bitácora");
    for (const s of SENSIBLES) expect(f.txt).not.toContain(s);
  });

  it("un fallo al registrar no lanza: la descarga ya se hizo", async () => {
    await expect(registrarExportacion({
      userId: "no-soy-un-uuid", filas: 1, formato: "csv", columnas: [],
      seleccion: { modo: "ids", ids: [] }, totalAlContar: 1,
    })).resolves.toBeUndefined();
  });
});

describe("🔴 el nombre del fichero", () => {
  const FORMA = /^oportunidades_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.(csv|xlsx)$/;

  it("lleva fecha Y hora, y cumple la forma exacta", () => {
    // Solo la fecha hacía indistinguibles dos exportaciones del mismo día: el sistema operativo
    // las desempataba con "(2)", "(3)", que no dice cuándo se sacó cada una.
    expect(nombreFichero("csv")).toMatch(FORMA);
    expect(nombreFichero("xlsx")).toMatch(FORMA);
  });

  it("no lleva ':' ni espacios — acaba en una cabecera HTTP y en un disco de Windows", () => {
    for (const f of ["csv", "xlsx"]) {
      const n = nombreFichero(f);
      expect(n, "los dos puntos son ilegales en Windows").not.toContain(":");
      expect(n).not.toContain(" ");
      // Un solo punto: el de la extensión.
      expect(n.split(".")).toHaveLength(2);
    }
  });

  it("🔴 usa la hora de Miami, NO la de UTC — verano (EDT, -4)", () => {
    // ESTE es el test que fija el fallo. `toISOString()` habría dado `2026-08-14`: la fecha del día
    // siguiente, para una exportación hecha a las 20:30 del día 13 en Miami.
    expect(nombreFichero("csv", new Date("2026-08-14T00:30:00Z"))).toBe("oportunidades_2026-08-13_20-30-00.csv");
  });

  it("🔴 y en invierno también, que el horario de verano no se dé por supuesto (EST, -5)", () => {
    expect(nombreFichero("csv", new Date("2026-01-15T00:30:00Z"))).toBe("oportunidades_2026-01-14_19-30-00.csv");
  });

  it("dos instantes distintos del mismo día dan dos nombres distintos", () => {
    const a = nombreFichero("csv", new Date("2026-08-13T18:22:07Z"));
    const b = nombreFichero("csv", new Date("2026-08-13T18:22:41Z"));
    expect(a).not.toBe(b);
    // Y se distinguen por los SEGUNDOS: dos descargas seguidas caben en el mismo minuto.
    expect(a).toBe("oportunidades_2026-08-13_14-22-07.csv");
    expect(b).toBe("oportunidades_2026-08-13_14-22-41.csv");
  });

  it("la medianoche de Miami no se adelanta ni se atrasa de día", () => {
    // 04:00Z en verano son las 00:00 de Miami: el nombre tiene que llevar ESE día, no el anterior.
    expect(nombreFichero("csv", new Date("2026-08-13T04:00:00Z"))).toBe("oportunidades_2026-08-13_00-00-00.csv");
    // Y un segundo antes sigue siendo el día anterior.
    expect(nombreFichero("csv", new Date("2026-08-13T03:59:59Z"))).toBe("oportunidades_2026-08-12_23-59-59.csv");
  });
});

describe("el contrato de selección compartido", () => {
  it("es el MISMO que usan las demás acciones masivas", () => {
    expect(parsearSeleccion({}).error).toBe("seleccion requerida");
    expect(parsearSeleccion({ seleccion: { modo: "ids", ids: [] } }).error).toMatch(/vacía/);
    expect(parsearSeleccion({ seleccion: { modo: "ids", ids: ["no-uuid"] } }).error).toMatch(/inválidos/);
    expect(parsearSeleccion({ seleccion: { modo: "otro" } }).error).toMatch(/'ids' o 'filtro'/);
    const r = parsearSeleccion({ seleccion: { modo: "filtro", filtros: { etapa: "ganado" } } });
    expect(r.seleccion).toEqual({ modo: "filtro", filtros: { etapa: "ganado" }, excluidos: [] });
  });
});
