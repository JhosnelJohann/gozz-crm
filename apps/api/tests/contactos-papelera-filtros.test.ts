// ============================================================================================
// LOS FILTROS DE LA PAPELERA — por autor y por rango de fechas
//
// Replican los de la papelera del Drive: mismos nombres de parámetro (`usuario`, `desde`, `hasta`)
// y el mismo calendario, aquí sobre `archivado_por` / `archivado_at`.
//
// Lo que más importa de este fichero son dos casos: el BORDE del rango —las 23:30 del último día
// tienen que entrar, es el fallo clásico— y que las filas sin fecha quedan fuera Y SE PUEDEN
// CONTAR, porque esa cifra es la que evita que alguien crea que se han perdido 27.800 contactos.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import { archivarContactos, tieneColumnasTrazabilidad } from "../src/lib/contactos-archivado.js";
import {
  SIN_USUARIO, autoresDePapelera, contarArchivadosSinFecha, listarPapelera,
  sqlFiltrosPapelera, type FiltrosPapelera,
} from "../src/lib/contactos-papelera.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { crearContacto, usuarioDePruebas } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
  expect(await tieneColumnasTrazabilidad()).toBe(true);
});

const sinHijos = { ops: 0, tareas: 0, notas: 0, correos: 0, documentos: 0 };

/**
 * Lo que de verdad ve la pantalla con unos filtros puestos: las filas Y el total, construidos con
 * el MISMO WHERE que arma la ruta, porque `sqlFiltrosPapelera` es la única definición de esas
 * cláusulas. Si el contador y las filas se calcularan por separado volvería el defecto D2 — una
 * lista que dice 73 y enseña 30.
 */
async function loQueVeLaPapelera(f: FiltrosPapelera): Promise<{ ids: string[]; total: number }> {
  const params: any[] = [];
  const addP = (v: any) => { params.push(v); return `$${params.length}`; };
  const where = ["COALESCE(archivado, false) = true", ...sqlFiltrosPapelera(f, addP)].join(" AND ");
  const [pagina, conteo] = await Promise.all([
    listarPapelera(where, params, 200, 0),
    query<any>(`SELECT count(*)::int AS total FROM gozz.contactos_cache WHERE ${where}`, params),
  ]);
  return { ids: pagina.items.map((c) => c.id), total: conteo[0].total };
}

/** Un usuario extra con nombre propio, para probar que el filtro separa autores de verdad. */
async function otroUsuario(etiqueta: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
     VALUES ($1, 'no-es-un-hash', $2, 'admin') RETURNING id`,
    [`${etiqueta}@pruebas.invalid`, `Archivador ${etiqueta}`]
  );
  return r[0].id;
}

describe("papelera · filtro por autor", () => {
  it("filtrar por un usuario devuelve solo SUS archivados, y el total coincide con las filas", async () => {
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const otro = await otroUsuario(`autor-${s}`);
    const motivo = `autor_sintetico:${s}`;

    const deSuite = await crearContacto({ nombre: `Suyo suite ${s}`, email: `as-${s}@pruebas.invalid`, telefono: "+1700000001", hijos: sinHijos });
    const deOtro = await crearContacto({ nombre: `Suyo otro ${s}`, email: `ao-${s}@pruebas.invalid`, telefono: "+1700000002", hijos: sinHijos });
    await archivarContactos([deSuite], { userId: suite, motivo });
    await archivarContactos([deOtro], { userId: otro, motivo });

    const r = await loQueVeLaPapelera({ usuario: otro, motivo });
    expect(r.ids).toEqual([deOtro]);
    expect(r.ids).not.toContain(deSuite);
    expect(r.total, "el contador usa el mismo WHERE que las filas").toBe(r.ids.length);
  });

  it("«sin usuario registrado» devuelve exactamente los de archivado_por IS NULL", async () => {
    // Son las corridas masivas de saneamiento: no las hizo una persona. Es una categoría legítima
    // —y hoy la inmensa mayoría de la papelera—, no un hueco que esconder ni que mezclar con nadie.
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const motivo = `nulo_sintetico:${s}`;
    const conAutor = await crearContacto({ nombre: `Con autor ${s}`, email: `ca-${s}@pruebas.invalid`, telefono: "+1710000001", hijos: sinHijos });
    const sinAutor = await crearContacto({ nombre: `Sin autor ${s}`, email: `sa-${s}@pruebas.invalid`, telefono: "+1710000002", hijos: sinHijos });
    await archivarContactos([conAutor], { userId: suite, motivo });
    // Tal y como lo deja una corrida masiva: archivado, con motivo y con fecha, pero sin autor.
    await query(
      `UPDATE gozz.contactos_cache
          SET archivado = true, archivado_motivo = $2, archivado_at = now(), archivado_por = NULL
        WHERE id = $1`,
      [sinAutor, motivo]
    );

    const r = await loQueVeLaPapelera({ usuario: SIN_USUARIO, motivo });
    expect(r.ids).toEqual([sinAutor]);
    expect(r.total).toBe(1);
  });

  it("las opciones del desplegable salen de los DATOS: no listan usuarios sin archivados", async () => {
    // Un desplegable con los 16 usuarios del CRM devolvería cero en casi todos. Eso no es un
    // filtro, es ruido.
    const s = Date.now().toString(36);
    const ocioso = await otroUsuario(`ocioso-${s}`);   // existe, pero no ha archivado nada
    const activo = await usuarioDePruebas();
    const c = await crearContacto({ nombre: `Facet ${s}`, email: `fc-${s}@pruebas.invalid`, telefono: "+1720000001", hijos: sinHijos });
    await archivarContactos([c], { userId: activo, motivo: `facet_sintetico:${s}` });

    const autores = await autoresDePapelera();
    const ids = autores.map((a) => a.id);

    expect(ids, "quien no ha archivado nada no sale").not.toContain(ocioso);
    expect(ids, "quien sí ha archivado, sale").toContain(activo);
    for (const a of autores) expect(a.n, `${a.nombre ?? "(sin usuario)"} tiene conteo`).toBeGreaterThan(0);

    // Ordenadas por conteo descendente: lo que más hay, primero.
    const conteos = autores.map((a) => a.n);
    expect(conteos).toEqual([...conteos].sort((x, y) => y - x));
  });
});

describe("papelera · filtro por rango de fechas", () => {
  it("devuelve solo lo archivado dentro del rango, y deja fuera lo que no tiene fecha", async () => {
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const motivo = `rango_sintetico:${s}`;
    const dentro = await crearContacto({ nombre: `Dentro ${s}`, email: `d-${s}@pruebas.invalid`, telefono: "+1730000001", hijos: sinHijos });
    const fuera = await crearContacto({ nombre: `Fuera ${s}`, email: `f-${s}@pruebas.invalid`, telefono: "+1730000002", hijos: sinHijos });
    const sinFecha = await crearContacto({ nombre: `SinFecha ${s}`, email: `sf-${s}@pruebas.invalid`, telefono: "+1730000003", hijos: sinHijos });

    await archivarContactos([dentro, fuera, sinFecha], { userId: suite, motivo });
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2026-03-15T12:00:00Z' WHERE id = $1`, [dentro]);
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2025-01-10T12:00:00Z' WHERE id = $1`, [fuera]);
    await query(`UPDATE gozz.contactos_cache SET archivado_at = NULL WHERE id = $1`, [sinFecha]);

    const r = await loQueVeLaPapelera({ motivo, desde: "2026-03-01T00:00:00Z", hasta: "2026-03-31T23:59:59.999Z" });
    expect(r.ids).toEqual([dentro]);
    expect(r.ids).not.toContain(fuera);
    expect(r.ids, "sin fecha no cae en ningún rango: es correcto que falte").not.toContain(sinFecha);
    expect(r.total).toBe(1);

    // Y esa ausencia se puede CONTAR, que es lo que la pantalla enseña para que nadie crea que se
    // han perdido datos. Se cuenta con el resto de filtros activos pero SIN el rango.
    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const whereSinRango = ["COALESCE(archivado, false) = true", ...sqlFiltrosPapelera({ motivo }, addP)].join(" AND ");
    expect(await contarArchivadosSinFecha(whereSinRango, params)).toBe(1);
  });

  it("🔴 EL BORDE · un contacto archivado a las 23:30 del último día del rango SÍ entra", async () => {
    // Es el fallo clásico de los rangos: cerrar en la medianoche del último día deja fuera todo lo
    // de ese día. `DateRangePopover` cierra con `endOfDay()` (23:59:59.999) y el backend compara con
    // `<=`, así que el día entra completo. Si alguien "arregla" cualquiera de las dos mitades, esto
    // se pone rojo.
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const motivo = `borde_sintetico:${s}`;
    const alFilo = await crearContacto({ nombre: `Al filo ${s}`, email: `fl-${s}@pruebas.invalid`, telefono: "+1740000001", hijos: sinHijos });
    const diaSiguiente = await crearContacto({ nombre: `Día siguiente ${s}`, email: `ds-${s}@pruebas.invalid`, telefono: "+1740000002", hijos: sinHijos });
    await archivarContactos([alFilo, diaSiguiente], { userId: suite, motivo });
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2026-03-31T23:30:00Z' WHERE id = $1`, [alFilo]);
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2026-04-01T00:30:00Z' WHERE id = $1`, [diaSiguiente]);

    // El `hasta` es exactamente lo que manda el componente: fin del último día.
    const r = await loQueVeLaPapelera({ motivo, desde: "2026-03-01T00:00:00Z", hasta: "2026-03-31T23:59:59.999Z" });
    expect(r.ids, "las 23:30 del último día están DENTRO").toContain(alFilo);
    expect(r.ids, "el día siguiente, no").not.toContain(diaSiguiente);

    // Y para dejar claro dónde estaría el fallo: cerrando a medianoche se perdería.
    const mal = await loQueVeLaPapelera({ motivo, desde: "2026-03-01T00:00:00Z", hasta: "2026-03-31T00:00:00Z" });
    expect(mal.ids).not.toContain(alFilo);
  });

  it("cada extremo del rango funciona por su cuenta", async () => {
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const motivo = `extremos_sintetico:${s}`;
    const viejo = await crearContacto({ nombre: `Viejo ${s}`, email: `v-${s}@pruebas.invalid`, telefono: "+1745000001", hijos: sinHijos });
    const nuevo = await crearContacto({ nombre: `Nuevo ${s}`, email: `n-${s}@pruebas.invalid`, telefono: "+1745000002", hijos: sinHijos });
    await archivarContactos([viejo, nuevo], { userId: suite, motivo });
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2024-01-01T12:00:00Z' WHERE id = $1`, [viejo]);
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2026-01-01T12:00:00Z' WHERE id = $1`, [nuevo]);

    expect((await loQueVeLaPapelera({ motivo, desde: "2025-01-01T00:00:00Z" })).ids).toEqual([nuevo]);
    expect((await loQueVeLaPapelera({ motivo, hasta: "2025-01-01T00:00:00Z" })).ids).toEqual([viejo]);
  });
});

describe("papelera · los filtros se combinan", () => {
  it("autor + fecha + motivo dan la intersección, y el total sigue cuadrando", async () => {
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const otro = await otroUsuario(`combi-${s}`);
    const motivo = `combi_sintetico:${s}`;

    const bueno = await crearContacto({ nombre: `Bueno ${s}`, email: `cb-${s}@pruebas.invalid`, telefono: "+1750000001", hijos: sinHijos });
    const otroMotivo = await crearContacto({ nombre: `Otro motivo ${s}`, email: `cm-${s}@pruebas.invalid`, telefono: "+1750000002", hijos: sinHijos });
    const otroAutor = await crearContacto({ nombre: `Otro autor ${s}`, email: `ca2-${s}@pruebas.invalid`, telefono: "+1750000003", hijos: sinHijos });
    const otraFecha = await crearContacto({ nombre: `Otra fecha ${s}`, email: `cf-${s}@pruebas.invalid`, telefono: "+1750000004", hijos: sinHijos });

    await archivarContactos([bueno, otroAutor, otraFecha], { userId: suite, motivo });
    // Motivo DISJUNTO, no un sufijo: el filtro es de coincidencia parcial a propósito (los motivos
    // de corrida llevan sufijo), así que `${motivo}_distinto` seguiría casando con `${motivo}`.
    await archivarContactos([otroMotivo], { userId: suite, motivo: `ajeno_sintetico:${s}` });
    await query(`UPDATE gozz.contactos_cache SET archivado_por = $2 WHERE id = $1`, [otroAutor, otro]);
    await query(
      `UPDATE gozz.contactos_cache SET archivado_at = '2026-05-10T12:00:00Z' WHERE id = ANY($1::uuid[])`,
      [[bueno, otroMotivo, otroAutor]]
    );
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2024-05-10T12:00:00Z' WHERE id = $1`, [otraFecha]);

    const r = await loQueVeLaPapelera({
      motivo, usuario: suite, desde: "2026-05-01T00:00:00Z", hasta: "2026-05-31T23:59:59.999Z",
    });
    expect(r.ids, "solo el que cumple las TRES condiciones").toEqual([bueno]);
    expect(r.total).toBe(1);
  });

  it("🔴 R11 · con los filtros puestos la proyección sigue sin los campos sensibles", async () => {
    // Añadir filtros no puede abrir la puerta a que salga un SSN. Comprobado sobre el objeto
    // devuelto, no sobre la lista de columnas.
    const s = Date.now().toString(36);
    const suite = await usuarioDePruebas();
    const motivo = `r11_filtros:${s}`;
    const c = await crearContacto({
      nombre: `Con secretos filtrado ${s}`, email: `r11-${s}@pruebas.invalid`, telefono: "+1760000001",
      ssn: `SSN-FILTRADO-${s}`, hijos: sinHijos,
    });
    await query(
      `UPDATE gozz.contactos_cache SET clave_uscis_enc = $2, clave_correo_uscis_enc = $3 WHERE id = $1`,
      [c, `CLAVE-USCIS-F-${s}`, `CLAVE-CORREO-F-${s}`]
    );
    await archivarContactos([c], { userId: suite, motivo });
    await query(`UPDATE gozz.contactos_cache SET archivado_at = '2026-06-15T12:00:00Z' WHERE id = $1`, [c]);

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const where = ["COALESCE(archivado, false) = true", ...sqlFiltrosPapelera(
      { motivo, usuario: suite, desde: "2026-06-01T00:00:00Z", hasta: "2026-06-30T23:59:59.999Z" }, addP
    )].join(" AND ");
    const { items } = await listarPapelera(where, params, 10, 0);

    expect(items).toHaveLength(1);
    for (const campo of ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"]) {
      expect(Object.keys(items[0]), `${campo} no puede venir`).not.toContain(campo);
    }
    const serializado = JSON.stringify(items[0]);
    expect(serializado).not.toContain("SSN-FILTRADO");
    expect(serializado).not.toContain("CLAVE-USCIS-F");
    expect(serializado).not.toContain("CLAVE-CORREO-F");
  });
});
