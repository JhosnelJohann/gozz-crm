// ============================================================================================
// MOTOR DE FUSIÓN — `src/lib/contactos-merge.ts`
//
// Cubre los puntos del guion de staging que allí son INDEMOSTRABLES:
//   §3.3 armado manual con pisado · §3.4 que no se pierde nada · §3.5 grupo resuelto
//   §3.6 revert fila a fila       · R6  la bitácora no se reasigna jamás
//
// Por qué aquí y no en staging: por decisión de producto, en staging no se fusionan contactos
// reales (auditar duplicados es tarea manual de los empleados); y además NINGÚN par de staging
// tiene notas, así que la razón de ser de la migración 0058 no se puede demostrar con datos reales.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query, pool } from "../src/shared/db.js";
import { descubrirFKs, fusionar, revertir } from "../src/lib/contactos-merge.js";
import { verificarBasePruebas, NOMBRE_BASE_PRUEBAS } from "./setup/test-db.js";
import { conteos, crearContacto, crearParDuplicado, filaContacto, hijosDetallados } from "./fixtures.js";

// Guard, otra vez. Es barato y es lo único que separa una suite de un accidente.
verificarBasePruebas(process.env.DATABASE_URL || "");

beforeAll(async () => {
  // No basta con validar la cadena de conexión: se le pregunta al servidor a qué base llegó.
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("motor de fusión · §3.4 no se pierde nada", () => {
  it("el maestro se queda con la SUMA de oportunidades, tareas, notas, correos y carpetas; el perdedor a cero", async () => {
    const { maestroId, perdedorId } = await crearParDuplicado();
    const antesM = await conteos(maestroId);
    const antesP = await conteos(perdedorId);

    await fusionar(maestroId, perdedorId);

    const despuesM = await conteos(maestroId);
    const despuesP = await conteos(perdedorId);

    for (const k of ["oportunidades", "tareas", "notas", "correos", "carpetas"] as const) {
      expect(despuesM[k], `${k} del maestro`).toBe(antesM[k] + antesP[k]);
      expect(despuesP[k], `${k} del perdedor`).toBe(0);
    }
  });

  it("§3.4 · NOTAS: la fusión reasigna contactos_notas (es lo que garantiza la migración 0058)", async () => {
    // Test dedicado a propósito. Antes de la 0058 `contactos_notas` no tenía FK, así que el
    // descubrimiento dinámico no la veía y las notas del perdedor se quedaban colgando de un
    // contacto archivado: desaparecían de la vista del maestro SIN ERROR Y SIN AVISO. Ya estaba
    // pasando con el script masivo de dedup. Nadie lo había comprobado nunca de forma automática.
    const { maestroId, perdedorId } = await crearParDuplicado();

    const notasDelPerdedor = (
      await query<any>(`SELECT id FROM gozz.contactos_notas WHERE contacto_id = $1 ORDER BY id`, [perdedorId])
    ).map((r) => r.id);
    const notasDelMaestro = (
      await query<any>(`SELECT id FROM gozz.contactos_notas WHERE contacto_id = $1 ORDER BY id`, [maestroId])
    ).map((r) => r.id);
    expect(notasDelPerdedor.length, "el fixture tiene que traer notas o el test no prueba nada").toBeGreaterThan(0);

    // La tabla tiene que ser VISIBLE para el descubrimiento dinámico: si no, no hay reasignación.
    const { fks } = await descubrirFKs();
    expect(fks.some((f) => f.tabla === "contactos_notas" && f.columna === "contacto_id")).toBe(true);

    await fusionar(maestroId, perdedorId);

    const notasFinales = (
      await query<any>(`SELECT id FROM gozz.contactos_notas WHERE contacto_id = $1 ORDER BY id`, [maestroId])
    ).map((r) => r.id);

    // Fila a fila: cada nota concreta del perdedor está ahora en el maestro.
    for (const id of notasDelPerdedor) expect(notasFinales, `nota ${id} del perdedor`).toContain(id);
    for (const id of notasDelMaestro) expect(notasFinales, `nota ${id} del maestro`).toContain(id);
    expect(notasFinales.length).toBe(notasDelMaestro.length + notasDelPerdedor.length);
    expect(await query(`SELECT id FROM gozz.contactos_notas WHERE contacto_id = $1`, [perdedorId])).toHaveLength(0);
  });

  it("el perdedor queda archivado = true con fusionado_en_contacto_id apuntando al maestro", async () => {
    const { maestroId, perdedorId } = await crearParDuplicado();
    await fusionar(maestroId, perdedorId);

    const [p] = await query<any>(
      `SELECT archivado, archivado_motivo, fusionado_en_contacto_id
         FROM gozz.contactos_cache WHERE id = $1`,
      [perdedorId]
    );
    expect(p.archivado).toBe(true);
    expect(p.fusionado_en_contacto_id).toBe(maestroId);
    expect(p.archivado_motivo).toBe("fusionado (dedup)");

    // Y el maestro sigue activo: la fusión no archiva a los dos.
    const [m] = await query<any>(`SELECT archivado FROM gozz.contactos_cache WHERE id = $1`, [maestroId]);
    expect(m.archivado === true).toBe(false);
  });
});

describe("motor de fusión · §3.3 armado manual", () => {
  it("una elección que PISA un valor lleno del maestro se escribe, se cuenta, y el log guarda el valor_antes correcto", async () => {
    const { maestroId, perdedorId } = await crearParDuplicado();
    const antes = await filaContacto(maestroId);
    const perdedor = await filaContacto(perdedorId);
    expect(antes.telefono, "el maestro tiene que traer teléfono lleno").toBeTruthy();
    expect(perdedor.telefono).toBeTruthy();
    expect(antes.telefono).not.toBe(perdedor.telefono);

    const r = await fusionar(maestroId, perdedorId, { valoresElegidos: { telefono: perdedorId } });

    expect(r.camposPisados).toContain("telefono");
    expect(r.camposEscritos).toContain("telefono");

    const [m] = await query<any>(`SELECT telefono FROM gozz.contactos_cache WHERE id = $1`, [maestroId]);
    expect(m.telefono).toBe(perdedor.telefono);

    // Sin `valor_antes` correcto el revert dejaría el contacto corrupto: es la fila que lo sostiene.
    const [log] = await query<any>(
      `SELECT valor_antes, valor_despues FROM gozz.contactos_merge_log
        WHERE corrida_id = $1 AND accion = 'enriquecer' AND campo = 'telefono'`,
      [r.corrida_id]
    );
    expect(log, "tiene que existir una fila de log para el campo pisado").toBeTruthy();
    expect(log.valor_antes).toBe(antes.telefono);
    expect(log.valor_despues).toBe(perdedor.telefono);
  });

  it("🔴 fusionar() RECHAZA ssn_encrypted en valoresElegidos", async () => {
    // R11 / corrección I2: los tres campos sensibles no se muestran, luego no se pueden elegir. La
    // ruta (`contactos-routes.ts:716`) ya lo bloquea con un 400; esto comprueba que el MOTOR
    // tampoco se fía de su llamador, que es lo que promete literalmente el comentario de
    // `fusionar()`: *"Defensa en profundidad: la ruta ya valida, pero el motor no confía en su
    // llamador"*.
    //
    // El escenario es el peligroso de verdad: los DOS contactos tienen un SSN real y distinto. Si
    // el motor acepta la elección, escribe un SSN real encima de otro SSN real, en silencio.
    const s = Date.now().toString(36);
    const maestroId = await crearContacto({
      nombre: `Maestro con SSN ${s}`, email: `m-ssn-${s}@pruebas.invalid`, telefono: "+1555000111",
      ssn: `SSN-DEL-MAESTRO-${s}`, hijos: { ops: 1, tareas: 1, notas: 1, correos: 1, documentos: 1 },
    });
    const perdedorId = await crearContacto({
      nombre: `Perdedor con SSN ${s}`, email: `p-ssn-${s}@pruebas.invalid`, telefono: "+1555000222",
      ssn: `SSN-DEL-PERDEDOR-${s}`, hijos: { ops: 1, tareas: 1, notas: 1, correos: 1, documentos: 1 },
    });

    const resultado = await fusionar(maestroId, perdedorId, {
      valoresElegidos: { ssn_encrypted: perdedorId },
    }).then(() => ({ rechazado: false }), () => ({ rechazado: true }));

    const [m] = await query<any>(
      `SELECT ssn_encrypted FROM gozz.contactos_cache WHERE id = $1`, [maestroId]
    );

    // Una sola aserción con los dos hechos, para que el informe de fallo enseñe también el DAÑO
    // (el SSN del maestro pisado) y no solo que la promesa no fue rechazada.
    expect({ rechazado: resultado.rechazado, ssnDelMaestro: m.ssn_encrypted }).toEqual({
      rechazado: true,
      ssnDelMaestro: `SSN-DEL-MAESTRO-${s}`,
    });
  });

  it("si el maestro tiene el SSN vacío y el perdedor lo tiene, el motor SÍ lo conserva", async () => {
    // Conducta deliberada y opuesta a la de arriba: el motor debe seguir rellenando huecos aunque
    // el campo sea sensible, para no perder un SSN que solo tenía el perdedor. Si esto se rompe,
    // se pierde dato real.
    const { maestroId, perdedorId } = await crearParDuplicado();
    const [{ ssn_encrypted: ssnMaestro }] = await query<any>(
      `SELECT ssn_encrypted FROM gozz.contactos_cache WHERE id = $1`, [maestroId]
    );
    const [{ ssn_encrypted: ssnPerdedor }] = await query<any>(
      `SELECT ssn_encrypted FROM gozz.contactos_cache WHERE id = $1`, [perdedorId]
    );
    expect(ssnMaestro).toBeNull();
    expect(ssnPerdedor).toBeTruthy();

    await fusionar(maestroId, perdedorId); // sin valoresElegidos: conducta clásica de rellenar huecos

    const [m] = await query<any>(`SELECT ssn_encrypted FROM gozz.contactos_cache WHERE id = $1`, [maestroId]);
    expect(m.ssn_encrypted).toBe(ssnPerdedor);
  });
});

describe("motor de fusión · §3.5 el grupo queda resuelto", () => {
  it("tras fusionar se limpian revision_dedup y revision_dedup_grupo de TODOS los miembros del grupo", async () => {
    const { maestroId, perdedorId, grupo } = await crearParDuplicado();
    // Un tercero en el mismo grupo: si se quedara marcado, seguiría apareciendo como candidato sin
    // nadie con quien compararse. La espec dice que se limpia el grupo entero, no solo los dos.
    const terceroId = await crearContacto({
      nombre: "Tercero del grupo", email: "tercero@pruebas.invalid", telefono: "+1888888888",
      grupo, hijos: { ops: 0, tareas: 0, notas: 0, correos: 0, documentos: 0 },
    });

    await fusionar(maestroId, perdedorId);

    const filas = await query<any>(
      `SELECT id, revision_dedup, revision_dedup_grupo FROM gozz.contactos_cache
        WHERE id = ANY($1::uuid[])`,
      [[maestroId, perdedorId, terceroId]]
    );
    expect(filas).toHaveLength(3);
    for (const f of filas) {
      expect(f.revision_dedup === true, `revision_dedup de ${f.id}`).toBe(false);
      expect(f.revision_dedup_grupo, `revision_dedup_grupo de ${f.id}`).toBeNull();
    }
  });
});

describe("motor de fusión · §3.6 revert", () => {
  it("revertir() deja maestro y perdedor EXACTAMENTE como estaban, fila a fila y con sus hijos", async () => {
    const { maestroId, perdedorId } = await crearParDuplicado();

    const antes = {
      maestro: await filaContacto(maestroId),
      perdedor: await filaContacto(perdedorId),
      hijosMaestro: await hijosDetallados(maestroId),
      hijosPerdedor: await hijosDetallados(perdedorId),
      conteosMaestro: await conteos(maestroId),
      conteosPerdedor: await conteos(perdedorId),
    };

    // Con pisado, que es el caso que más fácil deja el revert corrupto: si el motor no hubiera
    // logueado el `valor_antes` del campo pisado, aquí el maestro se quedaría con el teléfono ajeno.
    const r = await fusionar(maestroId, perdedorId, { valoresElegidos: { telefono: perdedorId } });
    const rev = await revertir(r.corrida_id);
    expect(rev.filas).toBeGreaterThan(0);

    // Fila a fila, campo por campo (sin `updated_at`: ver el porqué en fixtures.filaContacto).
    expect(await filaContacto(maestroId)).toEqual(antes.maestro);
    expect(await filaContacto(perdedorId)).toEqual(antes.perdedor);

    // Y cada hijo concreto volvió a su dueño, no solo "cuadran los totales".
    expect(await hijosDetallados(maestroId)).toEqual(antes.hijosMaestro);
    expect(await hijosDetallados(perdedorId)).toEqual(antes.hijosPerdedor);
    expect(await conteos(maestroId)).toEqual(antes.conteosMaestro);
    expect(await conteos(perdedorId)).toEqual(antes.conteosPerdedor);
  });
});

describe("motor de fusión · 🔴 R6: contactos_merge_log no se reasigna JAMÁS", () => {
  it("aunque tuviera una FK declarada, el motor la ignora y la bitácora de fusiones anteriores queda intacta", async () => {
    // POR QUÉ ESTE TEST EXISTE, Y POR QUÉ ES EL MÁS IMPORTANTE DE LOS OCHO:
    // el motor descubre qué reasignar leyendo `pg_constraint`. `contactos_merge_log` hoy NO tiene
    // FK, así que es invisible para él por accidente. El día que alguien se la declare —una idea
    // que parece buena: "integridad referencial"— el motor empezaría a reescribir `ganador_id` y
    // `perdedor_id` de las fusiones YA REGISTRADAS. El revert seguiría "funcionando": devolvería
    // filas, no lanzaría ningún error, y dejaría la base mal. Es el fallo silencioso más caro del
    // módulo, y `TABLAS_CONGELADAS` es la defensa. Esto comprueba que la defensa funciona
    // CREANDO la FK de verdad (en la base desechable) en vez de confiar en que nadie la cree.
    const fk1 = "prueba_merge_log_perdedor_fkey";
    const fk2 = "prueba_merge_log_ganador_fkey";
    try {
      await query(`ALTER TABLE gozz.contactos_merge_log
                     ADD CONSTRAINT ${fk1} FOREIGN KEY (perdedor_id) REFERENCES gozz.contactos_cache(id)`);
      await query(`ALTER TABLE gozz.contactos_merge_log
                     ADD CONSTRAINT ${fk2} FOREIGN KEY (ganador_id)  REFERENCES gozz.contactos_cache(id)`);

      // 1) El descubrimiento la ve, y la descarta con su motivo.
      const { fks, omitidas } = await descubrirFKs();
      expect(fks.some((f) => f.tabla === "contactos_merge_log")).toBe(false);
      expect(omitidas.some((o) => o.startsWith("contactos_merge_log.") && o.includes("R6"))).toBe(true);

      // 2) Primera fusión: B dentro de A. Su bitácora queda con ganador_id = A.
      const { maestroId: a, perdedorId: b } = await crearParDuplicado();
      const corrida1 = (await fusionar(a, b)).corrida_id;
      const antes = await query<any>(
        `SELECT id, perdedor_id, ganador_id FROM gozz.contactos_merge_log
          WHERE corrida_id = $1 ORDER BY id`,
        [corrida1]
      );
      expect(antes.length).toBeGreaterThan(0);
      expect(antes.every((f) => f.ganador_id === a)).toBe(true);

      // 3) Segunda fusión, donde A pasa a ser el PERDEDOR. Si el motor reasignara la bitácora,
      //    aquí reescribiría el `ganador_id` de la corrida 1 de A a C: la corrida 1 pasaría a
      //    decir que B se fusionó dentro de C, que es mentira, y su revert restauraría lo que no es.
      const c = await crearContacto({
        nombre: "Tercer contacto", email: "tercero-r6@pruebas.invalid", telefono: "+1777777777",
        hijos: { ops: 1, tareas: 1, notas: 1, correos: 1, documentos: 1 },
      });
      await fusionar(c, a);

      const despues = await query<any>(
        `SELECT id, perdedor_id, ganador_id FROM gozz.contactos_merge_log
          WHERE corrida_id = $1 ORDER BY id`,
        [corrida1]
      );
      expect(despues, "la bitácora de la corrida 1 no puede haber cambiado").toEqual(antes);
      expect(despues.every((f) => f.ganador_id === a), "ganador_id sigue siendo A, no C").toBe(true);
    } finally {
      await query(`ALTER TABLE gozz.contactos_merge_log DROP CONSTRAINT IF EXISTS ${fk1}`);
      await query(`ALTER TABLE gozz.contactos_merge_log DROP CONSTRAINT IF EXISTS ${fk2}`);
      await pool.query("SELECT 1"); // deja el pool en estado limpio para el siguiente fichero
    }
  });
});
