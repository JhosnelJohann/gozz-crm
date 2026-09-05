// ============================================================================================
// LA BITÁCORA DE UN CAMBIO DE ETAPA — `src/lib/auditoria-etapa.ts`
//
// 🔴 QUÉ PROTEGE. Que todo cambio de etapa deje fila en `gozz.auditoria` no es higiene: de eso
// depende el detalle de una solicitud para decir *"esta oportunidad ya no está donde estaba"* en las
// solicitudes anteriores a que se guardara el origen. Había dos caminos que movían la etapa **sin
// dejar rastro**:
//
//   · `pipeline-routes` — reasignación en bloque al retirar una etapa del pipeline.
//   · `reportes-routes` — completar una oportunidad, que la pone en **ganado**: justo el cambio que
//     deja obsoleta una solicitud pendiente.
//
// ⚠️ LO QUE ESTE FICHERO **NO** PRUEBA: que esos dos endpoints llamen a esta función. Se prueba la
// función, no el cableado, porque el proyecto no tiene infraestructura de test HTTP y extraer los
// endpoints enteros a `lib/` habría sido cambiarlos, que es justo lo que el encargo prohíbe. El
// cableado se verifica en pantalla — está en el guion de staging.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

import { pool, query } from "../src/shared/db.js";
import { auditarCambiosDeEtapa } from "../src/lib/auditoria-etapa.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Bitácora','admin',true) RETURNING id`,
    [`bitacora-${sufijo()}@pruebas.invalid`]
  );
  return r[0].id;
}

async function crearOportunidad(etapa: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (nombre_caso, etapa) VALUES ($1,$2) RETURNING id`,
    [`Caso ${sufijo()}`, etapa]
  );
  return r[0].id;
}

const filasDe = (id: string) =>
  query<any>(
    `SELECT user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues
       FROM gozz.auditoria WHERE registro_id = $1 ORDER BY created_at`,
    [id]
  );

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("la fila que deja", () => {
  it("una fila por oportunidad, con la etapa anterior correcta y la forma del cambio individual", async () => {
    const user = await crearUsuario();
    const id = await crearOportunidad("estaba_aqui");

    const n = await auditarCambiosDeEtapa(
      [{ id, antes: "estaba_aqui", despues: "ganado", accion: "Finalizó la oportunidad como GANADA (completar)" }],
      { userId: user }
    );

    expect(n).toBe(1);
    const [f] = await filasDe(id);
    expect(f.tabla_afectada).toBe("oportunidades");
    expect(f.registro_id).toBe(id);
    expect(f.user_id).toBe(user);
    // La MISMA forma que el cambio individual: es lo que hace que `etapasAlPedir` las encuentre.
    expect(f.datos_antes).toEqual({ etapa: "estaba_aqui" });
    expect(f.datos_despues).toEqual({ etapa: "ganado" });
    expect(f.accion).toMatch(/GANADA/);
  });

  it("una etapa anterior desconocida se registra como nula, no se inventa", async () => {
    const id = await crearOportunidad("x");
    await auditarCambiosDeEtapa([{ id, antes: null, despues: "ganado", accion: "sin origen" }], { userId: await crearUsuario() });
    const [f] = await filasDe(id);
    expect(f.datos_antes).toEqual({ etapa: null });
  });

  it("no escribe nada cuando la etapa no cambia de verdad", async () => {
    const id = await crearOportunidad("igual");
    const n = await auditarCambiosDeEtapa([{ id, antes: "igual", despues: "igual", accion: "no pasó nada" }], { userId: await crearUsuario() });
    expect(n).toBe(0);
    expect(await filasDe(id)).toHaveLength(0);
  });

  it("con la lista vacía no toca la base", async () => {
    const espia = vi.spyOn(pool, "query");
    expect(await auditarCambiosDeEtapa([], { userId: null })).toBe(0);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe("🔴 el masivo: una fila por oportunidad en UNA sola sentencia", () => {
  it("registra las N con su etapa anterior, en un solo INSERT", async () => {
    // Es el caso de retirar una etapa del pipeline: todo lo que había en ella se mueve en bloque.
    const user = await crearUsuario();
    const retirada = `retirada_${sufijo().replace(/-/g, "_")}`;
    const destino = `destino_${sufijo().replace(/-/g, "_")}`;
    const ids = [await crearOportunidad(retirada), await crearOportunidad(retirada), await crearOportunidad(retirada)];

    const espia = vi.spyOn(pool, "query");
    const n = await auditarCambiosDeEtapa(
      ids.map((id) => ({ id, antes: retirada, despues: destino, accion: `Cambió la etapa a "${destino}" (se retiró la etapa "${retirada}")` })),
      { userId: user }
    );

    expect(n).toBe(3);
    // 🔴 UNA sentencia sobre el conjunto, no un bucle de tres (§3.6).
    expect(espia).toHaveBeenCalledTimes(1);
    espia.mockRestore();

    for (const id of ids) {
      const [f] = await filasDe(id);
      expect(f.datos_antes).toEqual({ etapa: retirada });
      expect(f.datos_despues).toEqual({ etapa: destino });
      expect(f.accion).toContain("se retiró la etapa");
    }
  });

  it("cada fila lleva SU etapa anterior aunque vengan mezcladas", async () => {
    const user = await crearUsuario();
    const a = await crearOportunidad("desde_a");
    const b = await crearOportunidad("desde_b");

    await auditarCambiosDeEtapa(
      [
        { id: a, antes: "desde_a", despues: "comun", accion: "mezcla" },
        { id: b, antes: "desde_b", despues: "comun", accion: "mezcla" },
      ],
      { userId: user }
    );

    expect((await filasDe(a))[0].datos_antes).toEqual({ etapa: "desde_a" });
    expect((await filasDe(b))[0].datos_antes).toEqual({ etapa: "desde_b" });
  });

  it("las que no cambian se descartan y las demás se escriben igual", async () => {
    const user = await crearUsuario();
    const cambia = await crearOportunidad("origen");
    const quieta = await crearOportunidad("destino");

    const n = await auditarCambiosDeEtapa(
      [
        { id: cambia, antes: "origen", despues: "destino", accion: "sí" },
        { id: quieta, antes: "destino", despues: "destino", accion: "no" },
      ],
      { userId: user }
    );

    expect(n).toBe(1);
    expect(await filasDe(cambia)).toHaveLength(1);
    expect(await filasDe(quieta)).toHaveLength(0);
  });
});

describe("no rompe lo que estaba registrando", () => {
  it("un fallo al escribir la bitácora no lanza: se registra y se sigue", async () => {
    // Una bitácora que tumba la operación que venía a registrar es peor que la falta de la fila.
    const espia = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("la base dijo que no"));
    const n = await auditarCambiosDeEtapa(
      [{ id: "00000000-0000-0000-0000-0000000000aa", antes: "a", despues: "b", accion: "x" }],
      { userId: null }
    );
    expect(n).toBe(0);
    espia.mockRestore();
  });
});
