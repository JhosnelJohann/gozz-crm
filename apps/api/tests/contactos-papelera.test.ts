// ============================================================================================
// LA PAPELERA DE CONTACTOS Y LA TRAZABILIDAD DEL ARCHIVADO — D8, D9 y D10
//
// La Ola 0 hizo el archivado reversible en la API y nunca construyó la pantalla, así que la vuelta
// existía para el sistema pero no para la persona que se equivoca. Lo que se prueba aquí es que la
// papelera enseña lo que hace falta, en el orden que hace falta, sin filtrar lo que no debe salir,
// y que la fusión por fin deja constancia de cuándo y quién.
//
// 🔴 Todo sintético y en la base desechable. Y hay un caso dedicado a lo contrario de lo habitual:
// comprobar que NO se escribió nada sobre las filas históricas (§0).
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import { archivarContactos, comprobarDesarchivado, esArchivadoAutomatico, tieneColumnasTrazabilidad } from "../src/lib/contactos-archivado.js";
import { MOTIVO_FUSION_INTERFAZ, fusionar } from "../src/lib/contactos-merge.js";
import { COLS_PAPELERA, ORDEN_PAPELERA, listarPapelera } from "../src/lib/contactos-papelera.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { crearContacto, crearParDuplicado, usuarioDePruebas } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

/** El WHERE de la papelera tal y como lo arma el constructor único cuando `archivados=1`. */
const WHERE_ARCHIVADOS = "COALESCE(archivado, false) = true";

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
  // Sin la 0056 la papelera se degrada a propósito, pero entonces estos casos no probarían lo suyo.
  expect(await tieneColumnasTrazabilidad(), "la base de pruebas trae el esquema real, con la 0056").toBe(true);
});

const sinHijos = { ops: 0, tareas: 0, notas: 0, correos: 0, documentos: 0 };

describe("D10 · la fusión deja cuándo y quién", () => {
  it("una fusión nueva escribe archivado_at, archivado_por y el motivo de origen", async () => {
    // Antes escribía `archivado`, `archivado_motivo` y `fusionado_en_contacto_id` y nada más,
    // mientras la ruta normal de archivado sí ponía el quién/cuándo. Consecuencia: en una papelera
    // ordenada por "lo último archivado arriba", los perdedores de fusión caían al fondo.
    const { maestroId, perdedorId, userId } = await crearParDuplicado();
    const antes = new Date();

    await fusionar(maestroId, perdedorId, { userId, motivo: MOTIVO_FUSION_INTERFAZ });

    const [p] = await query<any>(
      `SELECT archivado, archivado_at, archivado_por, archivado_motivo, fusionado_en_contacto_id
         FROM gozz.contactos_cache WHERE id = $1`,
      [perdedorId]
    );
    expect(p.archivado).toBe(true);
    expect(p.archivado_at, "sin esto la papelera lo manda al fondo").not.toBeNull();
    expect(new Date(p.archivado_at).getTime()).toBeGreaterThanOrEqual(antes.getTime() - 5000);
    expect(p.archivado_por).toBe(userId);
    expect(p.archivado_motivo).toBe(MOTIVO_FUSION_INTERFAZ);
    expect(p.fusionado_en_contacto_id).toBe(maestroId);
  });

  it("🔴 el motivo nuevo SIGUE contando como archivado automático (R12)", async () => {
    // `esArchivadoAutomatico()` clasifica por PREFIJO contra ["lead_sin_oportunidad", "fusionado"],
    // y de esa clasificación depende la regla de resurrección: un archivado automático puede
    // revivir si el sync lo vuelve a traer, uno manual no. Un motivo que no empezara por
    // `fusionado` convertiría al perdedor de una fusión en un archivado manual, en silencio.
    expect(esArchivadoAutomatico(MOTIVO_FUSION_INTERFAZ)).toBe(true);
    expect(esArchivadoAutomatico("fusionado (dedup)")).toBe(true);
    expect(esArchivadoAutomatico("eliminado por usuario")).toBe(false);
  });

  it("D9 · una fusión de la interfaz se distingue de una del CLI por el motivo", async () => {
    const a = await crearParDuplicado();
    const b = await crearParDuplicado();

    await fusionar(a.maestroId, a.perdedorId, { userId: a.userId, motivo: MOTIVO_FUSION_INTERFAZ });
    await fusionar(b.maestroId, b.perdedorId, { userId: null });   // el CLI no pasa motivo

    const motivos = new Map(
      (await query<any>(
        `SELECT id, archivado_motivo FROM gozz.contactos_cache WHERE id = ANY($1::uuid[])`,
        [[a.perdedorId, b.perdedorId]]
      )).map((r) => [r.id, r.archivado_motivo])
    );
    expect(motivos.get(a.perdedorId)).toBe("fusionado (interfaz)");
    expect(motivos.get(b.perdedorId)).toBe("fusionado (dedup)");
    expect(motivos.get(a.perdedorId)).not.toBe(motivos.get(b.perdedorId));
  });

  it("🔴 §0 · una fusión nueva NO toca las filas históricas: los NULL siguen NULL y los motivos viejos, intactos", async () => {
    // Hay ~27.800 contactos archivados sin fecha, casi todos de corridas masivas. La tentación es
    // rellenarlos para que la papelera ordene bien; sería INVENTAR HISTORIA — escribir una fecha
    // que nunca se registró y que nadie podría distinguir de una real. Es el mismo defecto que se
    // cazó en la mig. 0060. Se arregla hacia delante, y esto lo vigila.
    const historicoA = await crearContacto({ nombre: "Histórico sin fecha A", email: "hist-a@pruebas.invalid", telefono: "+1600000001", hijos: sinHijos });
    const historicoB = await crearContacto({ nombre: "Histórico sin fecha B", email: "hist-b@pruebas.invalid", telefono: "+1600000002", hijos: sinHijos });
    // Se dejan como los dejó una corrida masiva vieja: archivados, con motivo, SIN fecha ni autor.
    await query(
      `UPDATE gozz.contactos_cache
          SET archivado = true, archivado_motivo = 'lead_sin_oportunidad:LEADS-CLEANUP-01',
              archivado_at = NULL, archivado_por = NULL
        WHERE id = ANY($1::uuid[])`,
      [[historicoA, historicoB]]
    );
    const fotoAntes = await query<any>(
      `SELECT id, archivado_at, archivado_por, archivado_motivo FROM gozz.contactos_cache
        WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[historicoA, historicoB]]
    );

    const { maestroId, perdedorId, userId } = await crearParDuplicado();
    await fusionar(maestroId, perdedorId, { userId, motivo: MOTIVO_FUSION_INTERFAZ });

    const fotoDespues = await query<any>(
      `SELECT id, archivado_at, archivado_por, archivado_motivo FROM gozz.contactos_cache
        WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[historicoA, historicoB]]
    );
    expect(fotoDespues).toEqual(fotoAntes);
    for (const f of fotoDespues) {
      expect(f.archivado_at, "sigue sin fecha, como debe").toBeNull();
      expect(f.archivado_por).toBeNull();
      expect(f.archivado_motivo).toBe("lead_sin_oportunidad:LEADS-CLEANUP-01");
    }
  });

  it("revertir una fusión deja también el archivado_at y el archivado_por como estaban", async () => {
    // Si el UPDATE escribiera esas dos columnas sin loguearlas, tras revertir el contacto volvería
    // activo pero con la marca de archivado puesta: visible y mintiendo. Se loguean, y esto lo fija.
    const { maestroId, perdedorId, userId } = await crearParDuplicado();
    const r = await fusionar(maestroId, perdedorId, { userId, motivo: MOTIVO_FUSION_INTERFAZ });
    const { revertir } = await import("../src/lib/contactos-merge.js");
    await revertir(r.corrida_id);

    const [p] = await query<any>(
      `SELECT archivado, archivado_at, archivado_por, archivado_motivo FROM gozz.contactos_cache WHERE id = $1`,
      [perdedorId]
    );
    expect(p.archivado === true).toBe(false);
    expect(p.archivado_at).toBeNull();
    expect(p.archivado_por).toBeNull();
    expect(p.archivado_motivo).toBeNull();
  });
});

describe("D8 · la papelera", () => {
  it("pone arriba lo archivado más recientemente, incluidos los perdedores de fusión", async () => {
    // Es LA razón de ser de la pantalla: quien acaba de equivocarse tiene que encontrar su contacto
    // en la primera página. Antes se ordenaba por `created_at` y lo archivado hace un minuto caía
    // en la página ~300.
    const userId = await usuarioDePruebas();
    const s = Date.now().toString(36);

    // (1) Un histórico sin fecha: tiene que quedar por DEBAJO de todo lo que sí la tiene.
    const historico = await crearContacto({ nombre: `Histórico ${s}`, email: `h-${s}@pruebas.invalid`, telefono: "+1610000001", hijos: sinHijos });
    await query(
      `UPDATE gozz.contactos_cache SET archivado = true, archivado_motivo = 'basura', archivado_at = NULL WHERE id = $1`,
      [historico]
    );

    // (2) Uno archivado a mano por el camino normal.
    const aMano = await crearContacto({ nombre: `A mano ${s}`, email: `m-${s}@pruebas.invalid`, telefono: "+1610000002", hijos: sinHijos });
    await archivarContactos([aMano], { userId, motivo: "eliminado por usuario" });

    // (3) Y el más reciente de todos: un perdedor de fusión. Es el que D10 mandaba al fondo.
    const { maestroId, perdedorId } = await crearParDuplicado();
    await fusionar(maestroId, perdedorId, { userId, motivo: MOTIVO_FUSION_INTERFAZ });

    const { items } = await listarPapelera(WHERE_ARCHIVADOS, [], 50, 0);
    const orden = items.map((c) => c.id);

    expect(orden[0], "el perdedor de fusión es lo último archivado: va primero").toBe(perdedorId);
    expect(orden.indexOf(aMano)).toBeGreaterThan(-1);
    expect(orden.indexOf(perdedorId)).toBeLessThan(orden.indexOf(aMano));
    expect(orden.indexOf(aMano), "los que tienen fecha van antes que los que no").toBeLessThan(orden.indexOf(historico));

    // Y el nombre de quien archivó llega resuelto, no como un uuid.
    const fila = items.find((c) => c.id === perdedorId);
    expect(fila.archivado_por).toBe(userId);
    expect(fila.archivado_por_nombre).toBe("Suite de pruebas");
    expect(fila.fusionado_en_contacto_id).toBe(maestroId);
  });

  it("el desempate por id es estable: paginar no repite ni se salta filas", async () => {
    // Sin el desempate, dos filas con el mismo `archivado_at` —y una corrida masiva archiva miles
    // en el mismo instante— pueden salir en dos páginas o en ninguna. Es la lección de C6.
    expect(ORDEN_PAPELERA).toContain("id ASC");

    const userId = await usuarioDePruebas();
    const s = Date.now().toString(36);
    const lote: string[] = [];
    for (let i = 0; i < 7; i++) {
      lote.push(await crearContacto({ nombre: `Lote ${s}-${i}`, email: `lote-${s}-${i}@pruebas.invalid`, telefono: `+162000000${i}`, hijos: sinHijos }));
    }
    // Una sola sentencia: los 7 comparten `archivado_at` al milisegundo, que es el caso peligroso.
    await archivarContactos(lote, { userId, motivo: `lote_sintetico:${s}` });

    const where = `${WHERE_ARCHIVADOS} AND archivado_motivo = $1`;
    const p1 = await listarPapelera(where, [`lote_sintetico:${s}`], 3, 0);
    const p2 = await listarPapelera(where, [`lote_sintetico:${s}`], 3, 3);
    const p3 = await listarPapelera(where, [`lote_sintetico:${s}`], 3, 6);
    const recorrido = [...p1.items, ...p2.items, ...p3.items].map((c) => c.id);

    expect(recorrido).toHaveLength(7);
    expect(new Set(recorrido).size, "ninguna fila repetida entre páginas").toBe(7);
    expect(new Set(recorrido)).toEqual(new Set(lote));
  });

  it("🔴 R11 · lo devuelto NO trae ssn_encrypted ni las credenciales USCIS", async () => {
    // Se comprueba sobre el OBJETO DEVUELTO, no sobre la lista de columnas: lo que importa es lo
    // que sale por la API, y una lista correcta con una consulta equivocada no protege nada.
    const userId = await usuarioDePruebas();
    const s = Date.now().toString(36);
    const conSecretos = await crearContacto({
      nombre: `Con secretos ${s}`, email: `sec-${s}@pruebas.invalid`, telefono: "+1630000001",
      ssn: `SSN-NO-DEBE-SALIR-${s}`, hijos: sinHijos,
    });
    await query(
      `UPDATE gozz.contactos_cache
          SET clave_uscis_enc = $2, clave_correo_uscis_enc = $3 WHERE id = $1`,
      [conSecretos, `CLAVE-USCIS-${s}`, `CLAVE-CORREO-${s}`]
    );
    await archivarContactos([conSecretos], { userId, motivo: `secretos_sintetico:${s}` });

    const { items } = await listarPapelera(`${WHERE_ARCHIVADOS} AND archivado_motivo = $1`, [`secretos_sintetico:${s}`], 10, 0);
    expect(items).toHaveLength(1);

    for (const campo of ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"]) {
      expect(Object.keys(items[0]), `${campo} no puede venir en la respuesta`).not.toContain(campo);
    }
    // Y por si alguien lo colara con otro nombre: el VALOR tampoco aparece en ningún sitio.
    const serializado = JSON.stringify(items[0]);
    expect(serializado).not.toContain("SSN-NO-DEBE-SALIR");
    expect(serializado).not.toContain("CLAVE-USCIS");
    expect(serializado).not.toContain("CLAVE-CORREO");
    // La proyección declarada tampoco los nombra, que es la otra mitad de la defensa.
    for (const campo of ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"]) {
      expect(COLS_PAPELERA).not.toContain(campo);
    }
  });

  it("el filtro por motivo separa lo archivado a mano de lo que arrastró una corrida", async () => {
    const userId = await usuarioDePruebas();
    const s = Date.now().toString(36);
    const aMano = await crearContacto({ nombre: `Mano ${s}`, email: `f1-${s}@pruebas.invalid`, telefono: "+1640000001", hijos: sinHijos });
    const deCorrida = await crearContacto({ nombre: `Corrida ${s}`, email: `f2-${s}@pruebas.invalid`, telefono: "+1640000002", hijos: sinHijos });
    await archivarContactos([aMano], { userId, motivo: `mano_sintetico:${s}` });
    await archivarContactos([deCorrida], { userId, motivo: `corrida_sintetica:${s}` });

    const soloMano = await listarPapelera(`${WHERE_ARCHIVADOS} AND archivado_motivo ILIKE $1`, [`%mano_sintetico:${s}%`], 10, 0);
    expect(soloMano.items.map((c) => c.id)).toEqual([aMano]);
  });
});

describe("D8 · lo que la papelera NO puede ofrecer", () => {
  it("🔴 un perdedor de fusión no se puede desarchivar", async () => {
    // Sus oportunidades, tareas y documentos ya están en el ganador: volvería VISIBLE Y VACÍO.
    // Un botón que promete devolverlo sería peor que no tener papelera.
    const { maestroId, perdedorId, userId } = await crearParDuplicado();
    await fusionar(maestroId, perdedorId, { userId, motivo: MOTIVO_FUSION_INTERFAZ });

    const chk = await comprobarDesarchivado(perdedorId);
    expect(chk.existe).toBe(true);
    expect(chk.bloqueado).toBe(true);
    expect(chk.fusionado_en_contacto_id).toBe(maestroId);
    expect(chk.error).toMatch(/revertir la fusión completa/);
  });

  it("uno archivado a mano SÍ se puede desarchivar, y vuelve al listado", async () => {
    const userId = await usuarioDePruebas();
    const s = Date.now().toString(36);
    const c = await crearContacto({ nombre: `Devuelto ${s}`, email: `dev-${s}@pruebas.invalid`, telefono: "+1650000001", hijos: sinHijos });
    await archivarContactos([c], { userId, motivo: "eliminado por usuario" });

    expect((await comprobarDesarchivado(c)).bloqueado).toBe(false);

    const { desarchivarContactos } = await import("../src/lib/contactos-archivado.js");
    await desarchivarContactos([c], { userId, motivo: "desarchivado por usuario" });

    const [f] = await query<any>(
      `SELECT archivado, archivado_motivo, archivado_at, archivado_por FROM gozz.contactos_cache WHERE id = $1`,
      [c]
    );
    expect(f.archivado === true).toBe(false);
    expect(f.archivado_motivo).toBeNull();
    expect(f.archivado_at, "la vuelta limpia la trazabilidad del archivado").toBeNull();
    expect(f.archivado_por).toBeNull();
  });

  it("un id que no existe no se confunde con uno bloqueado", async () => {
    const chk = await comprobarDesarchivado("00000000-0000-0000-0000-000000000000");
    expect(chk.existe).toBe(false);
    expect(chk.bloqueado).toBe(false);
  });
});
