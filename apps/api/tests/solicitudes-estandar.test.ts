// ============================================================================================
// UN SOLO ESTÁNDAR DE SOLICITUDES — migraciones 0065 · 0066 · 0067
//
// Antes de esta entrega había CUATRO tablas de solicitudes con TRES convenciones distintas, y las
// vistas tapaban la divergencia traduciendo el estado a la salida. Sólo una de las cuatro
// —`contacto_solicitudes`— tenía el trigger anti-reapertura: en las otras tres, un `UPDATE` suelto
// devolvía a 'pendiente' una solicitud de dinero ya resuelta y se volvía a aplicar. Con solicitudes
// de dinero reales en producción, eso era una puerta abierta, no una hipótesis.
//
// Aquí se prueba el contrato tabla por tabla —**no sólo la de contactos**— porque el defecto era
// justamente que lo que valía para una no valía para las otras.
//
// Ver `docs/CONVENCIONES.md` §10.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { usuarioDePruebas } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

/** Las cuatro tablas del estándar, con lo que cada una necesita para poder insertar una fila. */
interface Familia {
  tabla: string;
  tipo: string;
  /**
   * ¿La tabla rellena `tipo` sola con su DEFAULT?
   *
   * Sí en las tres tablas cuya familia tiene UN solo valor de `tipo_solicitud`: el DEFAULT es la
   * única respuesta posible y además deja intactos los `INSERT` que ya existían sin la columna.
   * NO en `contacto_solicitudes`, cuya familia tiene dos ('contacto_archivar', 'contacto_exportar'):
   * ahí un DEFAULT elegiría por el que llama, que es peor que exigirle que lo diga.
   */
  autoTipo: boolean;
  /** Columnas propias del tipo, además del marco común. */
  extra: () => Promise<Record<string, any>>;
}

let userId = "";
let opId = "";
let pagoId = "";

const FAMILIAS: Familia[] = [
  {
    tabla: "oportunidad_monto_solicitudes",
    tipo: "oportunidad_monto",
    autoTipo: true,
    extra: async () => ({ oportunidad_id: opId, monto_propuesto: 1234.5, monto_anterior: 1000 }),
  },
  {
    tabla: "oportunidad_pago_solicitudes",
    tipo: "oportunidad_pago",
    autoTipo: true,
    extra: async () => ({ oportunidad_id: opId, pago_id: pagoId, cambios_propuestos: JSON.stringify({ monto: 99 }) }),
  },
  {
    tabla: "oportunidad_descuento_solicitudes",
    tipo: "oportunidad_descuento",
    autoTipo: true,
    extra: async () => ({ oportunidad_id: opId, monto: 50 }),
  },
  {
    tabla: "contacto_solicitudes",
    tipo: "contacto_exportar",
    autoTipo: false,
    extra: async () => ({ tipo: "contacto_exportar", seleccion: JSON.stringify({ ids: [] }), contactos_afectados: 0 }),
  },
];

/** Inserta una solicitud 'pendiente' en la tabla que sea y devuelve su id. */
async function crearPendiente(f: Familia): Promise<string> {
  const extra = await f.extra();
  const cols = ["solicitante_id", "motivo", "estado", ...Object.keys(extra)];
  const vals = [userId, `caso ${f.tabla}`, "pendiente", ...Object.values(extra)];
  const marcas = vals.map((_, i) => `$${i + 1}`);
  const r = await query<any>(
    `INSERT INTO gozz.${f.tabla} (${cols.join(", ")}) VALUES (${marcas.join(", ")}) RETURNING id`,
    vals
  );
  return r[0].id;
}

const estadoDe = async (tabla: string, id: string) =>
  (await query<any>(`SELECT estado FROM gozz.${tabla} WHERE id = $1`, [id]))[0]?.estado;

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);

  userId = await usuarioDePruebas();
  opId = (await query<any>(
    `INSERT INTO gozz.oportunidades (nombre_caso, valor_total) VALUES ('Caso del estándar', 1000) RETURNING id`
  ))[0].id;
  pagoId = (await query<any>(
    `INSERT INTO gozz.oportunidades_pagos (oportunidad_id, monto, metodo) VALUES ($1, 100, 'zelle') RETURNING id`,
    [opId]
  ))[0].id;
});

describe.each(FAMILIAS)("$tabla · forma canónica", (f) => {
  it("tiene las columnas del marco común, con los MISMOS nombres que las otras tres", async () => {
    const cols = (await query<any>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'gozz' AND table_name = $1`,
      [f.tabla]
    )).map((r: any) => r.column_name);

    for (const c of [
      "id", "tipo", "solicitante_id", "motivo", "estado", "aprobador_id",
      "motivo_rechazo", "resultado", "created_at", "resolved_at", "ejecutada_at",
    ]) {
      expect(cols, `${f.tabla} sin la columna canónica "${c}"`).toContain(c);
    }
  });

  it("`tipo` queda puesto y está acotado a su familia", async () => {
    const id = await crearPendiente(f);
    const [fila] = await query<any>(`SELECT tipo FROM gozz.${f.tabla} WHERE id = $1`, [id]);
    // En tres de las cuatro lo pone el DEFAULT sin que el INSERT lo mencione; en contactos lo
    // manda quien inserta, porque la familia tiene dos valores (ver `autoTipo`).
    expect(fila.tipo).toBe(f.tipo);

    // Meter una solicitud de otra familia en esta tabla no se puede: lo corta el CHECK.
    const otra = FAMILIAS.find((x) => x.tipo !== f.tipo)!.tipo;
    await expect(
      query(`UPDATE gozz.${f.tabla} SET tipo = $1 WHERE id = $2`, [otra, id])
    ).rejects.toThrow();
  });

  it(f.autoTipo ? "el DEFAULT de `tipo` deja intactos los INSERT que no lo mencionan" : "`tipo` es obligatorio: la familia tiene más de un valor", async () => {
    if (f.autoTipo) {
      const id = await crearPendiente(f); // `extra` no incluye `tipo` en estas tres
      expect((await query<any>(`SELECT tipo FROM gozz.${f.tabla} WHERE id=$1`, [id]))[0].tipo).toBe(f.tipo);
    } else {
      await expect(
        query(
          `INSERT INTO gozz.contacto_solicitudes (solicitante_id, motivo, seleccion, contactos_afectados)
           VALUES ($1, 'sin tipo', '{}'::jsonb, 0)`,
          [userId]
        )
      ).rejects.toThrow();
    }
  });

  it("acepta LOS CUATRO estados del estándar", async () => {
    const id = await crearPendiente(f);
    expect(await estadoDe(f.tabla, id)).toBe("pendiente");

    await query(
      `UPDATE gozz.${f.tabla} SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2`,
      [userId, id]
    );
    expect(await estadoDe(f.tabla, id)).toBe("aprobada");

    await query(
      `UPDATE gozz.${f.tabla} SET estado='ejecutada', ejecutada_at=NOW(), resultado='{"ok":true}'::jsonb WHERE id=$1`,
      [id]
    );
    expect(await estadoDe(f.tabla, id)).toBe("ejecutada");

    // Y el cuarto, en otra fila: de 'ejecutada' ya no se sale (lo prueba el bloque del trigger).
    const otra = await crearPendiente(f);
    await query(
      `UPDATE gozz.${f.tabla} SET estado='rechazada', aprobador_id=$1, resolved_at=NOW(), motivo_rechazo='no cuadra' WHERE id=$2`,
      [userId, otra]
    );
    expect(await estadoDe(f.tabla, otra)).toBe("rechazada");
  });

  it("rechaza un estado que no es del vocabulario", async () => {
    const id = await crearPendiente(f);
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado = 'aprobado' WHERE id = $1`, [id])
    ).rejects.toThrow();
  });

  it("una resuelta sin aprobador o sin fecha no se puede escribir", async () => {
    const id = await crearPendiente(f);
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado='aprobada', resolved_at=NOW() WHERE id=$1`, [id])
    ).rejects.toThrow();
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado='aprobada', aprobador_id=$1 WHERE id=$2`, [userId, id])
    ).rejects.toThrow();
  });

  it("🔴 rechazar SIN motivo no se puede — es el cambio de conducta de esta entrega", async () => {
    const id = await crearPendiente(f);
    await expect(
      query(
        `UPDATE gozz.${f.tabla} SET estado='rechazada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2`,
        [userId, id]
      )
    ).rejects.toThrow();
  });

  it("marcar ejecutada sin fecha ni resultado no se puede", async () => {
    const id = await crearPendiente(f);
    await query(
      `UPDATE gozz.${f.tabla} SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2`,
      [userId, id]
    );
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado='ejecutada' WHERE id=$1`, [id])
    ).rejects.toThrow();
  });
});

describe.each(FAMILIAS)("$tabla · el trigger anti-reapertura", (f) => {
  it("una RECHAZADA no se reabre", async () => {
    const id = await crearPendiente(f);
    await query(
      `UPDATE gozz.${f.tabla} SET estado='rechazada', aprobador_id=$1, resolved_at=NOW(), motivo_rechazo='no' WHERE id=$2`,
      [userId, id]
    );
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado='pendiente' WHERE id=$1`, [id])
    ).rejects.toThrow(/estado terminal/);
    expect(await estadoDe(f.tabla, id)).toBe("rechazada");
  });

  it("una EJECUTADA no se reabre ni se degrada a aprobada", async () => {
    const id = await crearPendiente(f);
    await query(
      `UPDATE gozz.${f.tabla} SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2`,
      [userId, id]
    );
    await query(
      `UPDATE gozz.${f.tabla} SET estado='ejecutada', ejecutada_at=NOW(), resultado='{"ok":true}'::jsonb WHERE id=$1`,
      [id]
    );
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado='pendiente' WHERE id=$1`, [id])
    ).rejects.toThrow(/estado terminal/);
    await expect(
      query(`UPDATE gozz.${f.tabla} SET estado='aprobada' WHERE id=$1`, [id])
    ).rejects.toThrow(/estado terminal/);
    expect(await estadoDe(f.tabla, id)).toBe("ejecutada");
  });

  it("de APROBADA sí se puede pasar a ejecutada: aprobada no es terminal", async () => {
    // Es la razón de que haya cuatro estados y no tres: si la ejecución falla se reintenta sin
    // perder la aprobación humana.
    const id = await crearPendiente(f);
    await query(
      `UPDATE gozz.${f.tabla} SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2`,
      [userId, id]
    );
    await query(
      `UPDATE gozz.${f.tabla} SET estado='ejecutada', ejecutada_at=NOW(), resultado='{"ok":true}'::jsonb WHERE id=$1`,
      [id]
    );
    expect(await estadoDe(f.tabla, id)).toBe("ejecutada");
  });

  it("tocar otra columna de una terminal sigue permitido: el trigger vigila el ESTADO, no la fila", async () => {
    const id = await crearPendiente(f);
    await query(
      `UPDATE gozz.${f.tabla} SET estado='rechazada', aprobador_id=$1, resolved_at=NOW(), motivo_rechazo='no' WHERE id=$2`,
      [userId, id]
    );
    await query(`UPDATE gozz.${f.tabla} SET motivo_rechazo = 'no, y te explico por qué' WHERE id = $1`, [id]);
    expect(await estadoDe(f.tabla, id)).toBe("rechazada");
  });
});

describe("las cuatro tablas comparten UNA función de trigger", () => {
  it("las cuatro apuntan a gozz.solicitud_no_regresa()", async () => {
    const filas = await query<any>(
      `SELECT c.relname AS tabla, p.proname AS funcion
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'gozz' AND NOT t.tgisinternal
          AND c.relname = ANY($1)`,
      [FAMILIAS.map((f) => f.tabla)]
    );
    expect(filas).toHaveLength(4);
    for (const f of filas) expect(f.funcion, `${f.tabla} usa otra función`).toBe("solicitud_no_regresa");
  });
});

describe("las vistas · un solo shape, y no traducen", () => {
  const shape = (vista: string) =>
    query<any>(
      `SELECT ordinal_position, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'gozz' AND table_name = $1
        ORDER BY ordinal_position`,
      [vista]
    );

  it("las dos tienen exactamente las mismas 15 columnas, tipos y orden", async () => {
    const a = await shape("vi_solicitudes_oportunidades");
    const b = await shape("vi_solicitudes_contactos");
    expect(a).toHaveLength(15);
    // Comparación en los dos sentidos: es el `EXCEPT` de PRUEBAS-STAGING-CONTACTOS §0.2, escrito
    // aquí para que no dependa de que alguien lo corra a mano en staging.
    expect(a).toEqual(b);
    expect(b).toEqual(a);
  });

  it("`ejecutada_at` es columna de primera, no un campo escondido en `detalle`", async () => {
    const a = await shape("vi_solicitudes_oportunidades");
    expect(a.map((c: any) => c.column_name)).toContain("ejecutada_at");
  });

  it("🔴 una solicitud EJECUTADA sale de la vista como 'ejecutada', no traducida a 'aprobada'", async () => {
    const pares: [Familia, string][] = [
      [FAMILIAS[0], "vi_solicitudes_oportunidades"],
      [FAMILIAS[3], "vi_solicitudes_contactos"],
    ];
    for (const [f, vista] of pares) {
      const id = await crearPendiente(f);
      await query(
        `UPDATE gozz.${f.tabla} SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2`,
        [userId, id]
      );
      await query(
        `UPDATE gozz.${f.tabla} SET estado='ejecutada', ejecutada_at=NOW(), resultado='{"ok":true}'::jsonb WHERE id=$1`,
        [id]
      );
      const [v] = await query<any>(`SELECT estado, tipo, ejecutada_at FROM gozz.${vista} WHERE id = $1`, [id]);
      expect(v.estado, `${vista} está traduciendo el estado`).toBe("ejecutada");
      expect(v.tipo).toBe(f.tipo);
      expect(v.ejecutada_at).not.toBeNull();
    }
  });

  it("ninguna de las dos definiciones contiene un CASE sobre el estado", async () => {
    const filas = await query<any>(
      `SELECT viewname FROM pg_views
        WHERE schemaname = 'gozz' AND viewname LIKE 'vi_solicitudes%' AND definition ~* 'CASE'`
    );
    expect(filas.map((r: any) => r.viewname)).toEqual([]);
  });

  it("la vista de oportunidades une las TRES familias y saca `tipo` de la columna", async () => {
    const ids: string[] = [];
    for (const f of FAMILIAS.slice(0, 3)) ids.push(await crearPendiente(f));
    // ⚠️ `ORDER BY tipo` sobre un ENUM ordena por el orden de DECLARACIÓN del enum, no alfabético.
    const filas = await query<any>(
      `SELECT tipo FROM gozz.vi_solicitudes_oportunidades WHERE id = ANY($1) ORDER BY tipo`,
      [ids]
    );
    expect(filas.map((r: any) => r.tipo)).toEqual([
      "oportunidad_monto", "oportunidad_pago", "oportunidad_descuento",
    ]);
  });
});

describe("el ENUM tipo_solicitud", () => {
  it("trae 'oportunidad_etapa', que prepara la entrega siguiente", async () => {
    const vals = (await query<any>(
      `SELECT e.enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'gozz' AND t.typname = 'tipo_solicitud'`
    )).map((r: any) => r.enumlabel);
    expect(vals).toContain("oportunidad_etapa");
  });
});
