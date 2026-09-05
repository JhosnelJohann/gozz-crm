// ============================================================================================
// CAMBIO DE ETAPA EN MASA — `src/lib/oportunidades-etapa.ts` + `0069`
//
// 🔴 LO QUE ESTO PROTEGE. Un cambio de etapa NO es un `UPDATE`: dispara las automatizaciones de la
// etapa destino, reparte puntos a los vendedores y escribe `fecha_completada`. Nada de eso se ve
// desde la pantalla. Si el camino masivo no pasara por la misma lógica que el individual,
// tendríamos **dos semánticas para la misma acción** y la masiva sería la que no dispara nada — un
// agujero que solo se descubre cuando alguien pregunta por qué no le llegaron sus tareas.
//
// Por eso aquí se comprueba el EFECTO (la tarea creada, los puntos, la fecha), no solo que la
// columna `etapa` cambió.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import {
  MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA,
  aprobarSolicitudEtapa,
  cambiarEtapaMasivo,
  crearSolicitudEtapa,
  parsearCambios,
  previaCambioEtapa,
  rechazarSolicitudEtapa,
  seleccionCuadraConCambios,
} from "../src/lib/oportunidades-etapa.js";
import { puede, tiposQuePuedeAprobar } from "../src/lib/permisos.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

const PERMISO_MASIVO = "cambiar_etapa_masivo";
const PERMISO_APROBAR = "aprobar_oportunidad_etapa";

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(nivel = "usuario", activo = true): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Caso de etapas',$2,$3) RETURNING id`,
    [`etapa-${sufijo()}@pruebas.invalid`, nivel, activo]
  );
  return r[0].id;
}
const conceder = (userId: string, permiso: string) =>
  query("INSERT INTO gozz.user_permisos (user_id, permiso) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, permiso]);

/** Una etapa propia por caso: las pruebas no se pisan entre sí ni dependen del seed. */
async function crearEtapa(d: { esGanado?: boolean; obligatorios?: string[]; activa?: boolean } = {}): Promise<string> {
  const key = `etp_${sufijo().replace(/-/g, "_")}`;
  await query(
    `INSERT INTO gozz.pipeline_stages (key, label, color, orden, es_terminal, es_ganado, campos_obligatorios, activa)
     VALUES ($1,$2,'#5C6670',999,false,$3,$4::jsonb,$5)`,
    [key, key, !!d.esGanado, JSON.stringify(d.obligatorios ?? []), d.activa !== false]
  );
  return key;
}

async function crearOportunidad(etapa: string, extra: Record<string, any> = {}): Promise<string> {
  const cols = ["nombre_caso", "etapa", ...Object.keys(extra)];
  const vals = [`Caso ${sufijo()}`, etapa, ...Object.values(extra)];
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (${cols.join(",")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    vals
  );
  return r[0].id;
}

const etapaDe = async (id: string) =>
  (await query<any>("SELECT etapa FROM gozz.oportunidades WHERE id = $1", [id]))[0]?.etapa;

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("validación de la petición", () => {
  it("rechaza un mapa vacío, un id que no es uuid y una etapa con forma rara", () => {
    expect(parsearCambios({}).error).toBeTruthy();
    expect(parsearCambios(null).error).toBeTruthy();
    expect(parsearCambios([]).error).toBeTruthy();
    expect(parsearCambios({ "no-soy-uuid": "ganado" }).error).toMatch(/id inválido/);
    expect(parsearCambios({ "00000000-0000-0000-0000-000000000001": "GANADO; DROP TABLE x" }).error).toMatch(/no es una etapa válida/);
    expect(parsearCambios({ "00000000-0000-0000-0000-000000000001": "ganado" }).cambios).toEqual({
      "00000000-0000-0000-0000-000000000001": "ganado",
    });
  });

  it("🔴 la selección y el mapa tienen que hablar de lo mismo", () => {
    const a = "00000000-0000-0000-0000-00000000000a";
    const b = "00000000-0000-0000-0000-00000000000b";
    expect(seleccionCuadraConCambios([a, b], { [a]: "ganado" })).toMatch(/sin etapa destino/);
    expect(seleccionCuadraConCambios([a], { [a]: "ganado", [b]: "ganado" })).toMatch(/no están en la selección/);
    expect(seleccionCuadraConCambios([a, b], { [a]: "ganado", [b]: "perdido" })).toBeNull();
  });

  it("el tope está declarado, no es un recorte silencioso", async () => {
    const cambios: Record<string, string> = {};
    for (let i = 0; i < MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA + 1; i++) {
      cambios[`00000000-0000-0000-0000-${String(i).padStart(12, "0")}`] = "ganado";
    }
    await expect(cambiarEtapaMasivo(cambios, { userId: await crearUsuario() }))
      .rejects.toThrow(new RegExp(`${MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA}`));
  });
});

describe("el cambio en masa", () => {
  it("mueve las que puede y devuelve las transiciones", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen), await crearOportunidad(origen)];
    const cambios = Object.fromEntries(ids.map((id) => [id, destino]));

    const r = await cambiarEtapaMasivo(cambios, { userId: user });

    expect(r.cambiadas).toBe(3);
    expect(r.omitidas).toHaveLength(0);
    expect(r.transiciones).toEqual([{ desde: origen, hasta: destino, n: 3 }]);
    for (const id of ids) expect(await etapaDe(id)).toBe(destino);
  });

  it("cada fila puede ir a una etapa distinta — es la razón de que `cambios` sea un mapa", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const a = await crearEtapa();
    const b = await crearEtapa();
    const id1 = await crearOportunidad(origen);
    const id2 = await crearOportunidad(origen);

    await cambiarEtapaMasivo({ [id1]: a, [id2]: b }, { userId: user });

    expect(await etapaDe(id1)).toBe(a);
    expect(await etapaDe(id2)).toBe(b);
  });

  it("🔴 a la que le faltan campos obligatorios NO se mueve, el resto sí, y se dice cuál y por qué", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const exigente = await crearEtapa({ obligatorios: ["preparador_id"] });
    const conPreparador = await crearOportunidad(origen, { preparador_id: user });
    const sinPreparador = await crearOportunidad(origen);

    const r = await cambiarEtapaMasivo(
      { [conPreparador]: exigente, [sinPreparador]: exigente },
      { userId: user }
    );

    expect(r.cambiadas).toBe(1);
    expect(await etapaDe(conPreparador)).toBe(exigente);
    // 🔴 No aborta al resto: la que falla se queda quieta y se informa.
    expect(await etapaDe(sinPreparador)).toBe(origen);
    expect(r.omitidas).toHaveLength(1);
    expect(r.omitidas[0].id).toBe(sinPreparador);
    expect(r.omitidas[0].motivo).toMatch(/campos obligatorios/);
    expect(r.omitidas[0].faltan).toEqual(["preparador_id"]);
  });

  it("omite las que ya están en esa etapa y las que no existen, sin tocar nada más", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const quieta = await crearOportunidad(destino);
    const movible = await crearOportunidad(origen);
    const fantasma = "00000000-0000-0000-0000-0000000000ff";

    const r = await cambiarEtapaMasivo(
      { [quieta]: destino, [movible]: destino, [fantasma]: destino },
      { userId: user }
    );

    expect(r.cambiadas).toBe(1);
    expect(r.omitidas.map((o) => o.motivo).sort()).toEqual(["la oportunidad ya no existe", "ya está en esa etapa"]);
  });

  it("si NINGUNA es aplicable no escribe nada y no deja auditoría de operación", async () => {
    const user = await crearUsuario("admin");
    const destino = await crearEtapa();
    const yaAhi = await crearOportunidad(destino);
    const r = await cambiarEtapaMasivo({ [yaAhi]: destino }, { userId: user });
    expect(r.cambiadas).toBe(0);
    expect(r.auditoriaId).toBeNull();
  });
});

describe("🔴 los efectos: el masivo dispara lo mismo que el individual", () => {
  it("ejecuta las automatizaciones de la etapa destino — una tarea por oportunidad", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const stageId = (await query<any>("SELECT id FROM gozz.pipeline_stages WHERE key = $1", [destino]))[0].id;
    const titulo = `Automática ${sufijo()}`;
    await query(
      `INSERT INTO gozz.stage_automations (stage_id, tipo, config, activa, orden)
       VALUES ($1,'crear_tarea',$2::jsonb,true,1)`,
      [stageId, JSON.stringify({ titulo, responsable_id: user })]
    );

    const ids = [await crearOportunidad(origen), await crearOportunidad(origen)];
    await cambiarEtapaMasivo(Object.fromEntries(ids.map((id) => [id, destino])), { userId: user });

    const [{ n }] = await query<any>("SELECT count(*)::int AS n FROM gozz.tareas WHERE titulo = $1", [titulo]);
    expect(n, "una tarea por oportunidad, como haría el cambio individual").toBe(2);
    const [{ logs }] = await query<any>(
      "SELECT count(*)::int AS logs FROM gozz.stage_automation_logs WHERE stage_id = $1 AND estado = 'ok'", [stageId]
    );
    expect(logs).toBe(2);
  });

  it("reparte puntos y escribe `fecha_completada` al pasar a una etapa ganada", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const ganada = await crearEtapa({ esGanado: true });
    const id = await crearOportunidad(origen, { valor_total: 1000, vendedor_id: user });

    await cambiarEtapaMasivo({ [id]: ganada }, { userId: user });

    const [op] = await query<any>(
      "SELECT puntos_asignados, fecha_completada FROM gozz.oportunidades WHERE id = $1", [id]
    );
    expect(op.puntos_asignados).toBe(true);
    expect(op.fecha_completada).not.toBeNull();
  });

  it("la previa cuenta los efectos EN VIVO, sin escribir nada", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const ganada = await crearEtapa({ esGanado: true });
    const stageId = (await query<any>("SELECT id FROM gozz.pipeline_stages WHERE key = $1", [ganada]))[0].id;
    await query(
      `INSERT INTO gozz.stage_automations (stage_id, tipo, config, activa, orden)
       VALUES ($1,'crear_tarea',$2::jsonb,true,1)`,
      [stageId, JSON.stringify({ titulo: `Prev ${sufijo()}` })]
    );
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen), await crearOportunidad(origen)];

    const previa = await previaCambioEtapa(Object.fromEntries(ids.map((id) => [id, ganada])));

    expect(previa.aplicables).toBe(3);
    expect(previa.automatizaciones, "1 automatización × 3 oportunidades").toBe(3);
    expect(previa.puntos).toBe(3);
    expect(previa.fechas_completada).toBe(3);
    // 🔴 Y no ha escrito nada.
    for (const id of ids) expect(await etapaDe(id)).toBe(origen);
  });
});

describe("🔴 la auditoría permite reconstruir y deshacer", () => {
  it("deja una fila por oportunidad y una de la operación, con las etapas previas", async () => {
    const user = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen)];

    const r = await cambiarEtapaMasivo(Object.fromEntries(ids.map((id) => [id, destino])), { userId: user });

    // Una por oportunidad: es lo que se lee desde la pestaña Actividad de cada caso.
    const porCaso = await query<any>(
      `SELECT registro_id, datos_antes, datos_despues FROM gozz.auditoria
        WHERE registro_id = ANY($1::text[]) AND tabla_afectada = 'oportunidades'`,
      [ids]
    );
    expect(porCaso).toHaveLength(2);
    for (const f of porCaso) {
      expect(f.datos_antes).toEqual({ etapa: origen });
      expect(f.datos_despues).toEqual({ etapa: destino });
    }

    // Y la de la operación, con los ids y sus etapas previas.
    const [op] = await query<any>("SELECT * FROM gozz.auditoria WHERE id = $1", [r.auditoriaId]);
    expect(op.registro_id).toBe("operacion_masiva");
    expect(op.datos_antes.oportunidades).toHaveLength(2);
    expect(new Set(op.datos_antes.oportunidades.map((x: any) => x.id))).toEqual(new Set(ids));
  });

  it("y con esa fila se DESHACE: cada oportunidad vuelve a su etapa anterior", async () => {
    const user = await crearUsuario("admin");
    const a = await crearEtapa();
    const b = await crearEtapa();
    const destino = await crearEtapa();
    const desdeA = await crearOportunidad(a);
    const desdeB = await crearOportunidad(b);

    const r = await cambiarEtapaMasivo({ [desdeA]: destino, [desdeB]: destino }, { userId: user });
    expect(await etapaDe(desdeA)).toBe(destino);

    // El deshacer documentado en la cabecera del motor, ejecutado tal cual.
    await query(
      `UPDATE gozz.oportunidades o SET etapa = x.antes
         FROM (SELECT (e->>'id')::uuid AS id, e->>'antes' AS antes
                 FROM gozz.auditoria a, jsonb_array_elements(a.datos_antes->'oportunidades') e
                WHERE a.id = $1) x
        WHERE o.id = x.id`,
      [r.auditoriaId]
    );

    // 🔴 Cada una a la SUYA, no todas a la misma: por eso la bitácora guarda la etapa de cada fila.
    expect(await etapaDe(desdeA)).toBe(a);
    expect(await etapaDe(desdeB)).toBe(b);
  });
});

describe("quién puede: `cambiar_etapa_masivo`", () => {
  it("un usuario normal NO lo tiene; con la fila puesta, sí; un admin lo tiene sin fila", async () => {
    const normal = await crearUsuario("usuario");
    const admin = await crearUsuario("admin");
    expect(await puede(normal, PERMISO_MASIVO)).toBe(false);
    await conceder(normal, PERMISO_MASIVO);
    expect(await puede(normal, PERMISO_MASIVO)).toBe(true);
    expect(await puede(admin, PERMISO_MASIVO)).toBe(true);
  });

  it("🔴 el permiso NO viene sembrado: nadie lo tiene por una fila de `user_permisos`", async () => {
    const [{ n }] = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.user_permisos WHERE permiso IN ($1,$2) AND user_id NOT IN (SELECT id FROM gozz.users WHERE email LIKE 'etapa-%@pruebas.invalid')",
      [PERMISO_MASIVO, PERMISO_APROBAR]
    );
    expect(n, "la 0069 no siembra permisos — se conceden cuando se decida a quién").toBe(0);
  });
});

describe("la solicitud: sin permiso y en lote, no se aplica NADA", () => {
  it("🔴 guarda DE DÓNDE VENÍA cada una, no solo a dónde va", async () => {
    const user = await crearUsuario("usuario");
    const a = await crearEtapa();
    const b = await crearEtapa();
    const destino = await crearEtapa();
    const desdeA = await crearOportunidad(a);
    const desdeB = await crearOportunidad(b);

    const s = await crearSolicitudEtapa({ [desdeA]: destino, [desdeB]: destino }, { userId: user, motivo: "cierre de mes" });

    // El origen es el que tenía CADA una en el momento de pedirlo — no uno común.
    expect(s.cambios).toEqual({
      [desdeA]: { desde: a, hasta: destino },
      [desdeB]: { desde: b, hasta: destino },
    });
    expect(s.estado).toBe("pendiente");
    expect(s.tipo).toBe("oportunidad_etapa");
    // La base no puede imponer esta igualdad con un CHECK (haría falta subconsulta): la garantiza
    // `crearSolicitudEtapa`, y esto es lo que lo comprueba.
    expect(s.oportunidades_afectadas).toBe(2);
    // 🔴 Y no se ha movido una sola etapa.
    expect(await etapaDe(desdeA)).toBe(a);
    expect(await etapaDe(desdeB)).toBe(b);
  });

  it("una que ya no existe se guarda con origen desconocido, no con uno inventado", async () => {
    const user = await crearUsuario("usuario");
    const destino = await crearEtapa();
    const fantasma = "00000000-0000-0000-0000-0000000000fe";
    const s = await crearSolicitudEtapa({ [fantasma]: destino }, { userId: user });
    expect(s.cambios).toEqual({ [fantasma]: { desde: null, hasta: destino } });
  });

  it("aparece en la vista unificada con el shape común y sin `oportunidad_id`", async () => {
    const user = await crearUsuario("usuario");
    const destino = await crearEtapa();
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: destino }, { userId: user });

    const [v] = await query<any>("SELECT * FROM gozz.vi_solicitudes_oportunidades WHERE id = $1", [s.id]);
    expect(v.tipo).toBe("oportunidad_etapa");
    // Escalar y esto afecta a N: va NULL a propósito, y los ids viajan en `detalle`.
    expect(v.oportunidad_id).toBeNull();
    expect(v.estado).toBe("pendiente");
    expect(Object.keys(v.detalle.cambios)).toHaveLength(1);
    expect(v.detalle.oportunidades_afectadas).toBe(1);
  });
});

describe("🔴 compatibilidad: las solicitudes con la forma ANTIGUA siguen funcionando", () => {
  /** Una solicitud como las que hay pendientes hoy: `cambios` con el destino escalar, sin origen. */
  async function crearSolicitudFormaAntigua(cambios: Record<string, string>, userId: string) {
    const r = await query<any>(
      `INSERT INTO gozz.oportunidad_etapa_solicitudes
         (solicitante_id, cambios, oportunidades_afectadas, motivo)
       VALUES ($1, $2::jsonb, $3, 'forma antigua') RETURNING *`,
      [userId, JSON.stringify(cambios), Object.keys(cambios).length]
    );
    return r[0];
  }

  it("se resuelve y se EJECUTA igual que una nueva", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen)];
    // Escalar, no objeto: es la forma que ya está escrita en la base.
    const s = await crearSolicitudFormaAntigua(Object.fromEntries(ids.map((id) => [id, destino])), solicitante);
    expect(s.cambios[ids[0]]).toBe(destino);

    const r = await aprobarSolicitudEtapa(s.id, { userId: aprobador });

    expect(r.ok).toBe(true);
    expect((r as any).solicitud.estado).toBe("ejecutada");
    expect((r as any).resultado.cambiadas).toBe(2);
    for (const id of ids) expect(await etapaDe(id)).toBe(destino);
  });

  it("la previa la entiende sin traducirla a mano", async () => {
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const id = await crearOportunidad(origen);
    // Directamente la forma antigua, tal cual saldría de la base.
    const previa = await previaCambioEtapa({ [id]: destino } as any);
    expect(previa.aplicables).toBe(1);
    expect(previa.transiciones).toEqual([{ desde: origen, hasta: destino, n: 1 }]);
  });

  it("y la nueva también, con el mismo resultado", async () => {
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const id = await crearOportunidad(origen);
    const previa = await previaCambioEtapa({ [id]: { desde: origen, hasta: destino } } as any);
    expect(previa.aplicables).toBe(1);
    expect(previa.transiciones).toEqual([{ desde: origen, hasta: destino, n: 1 }]);
  });

  it("🔴 no se migran: las viejas se quedan como están", async () => {
    const solicitante = await crearUsuario("usuario");
    const destino = await crearEtapa();
    const id = await crearOportunidad(await crearEtapa());
    const s = await crearSolicitudFormaAntigua({ [id]: destino }, solicitante);

    // Leerla no la reescribe: reconstruirle el origen sería escribir una conjetura como si fuera
    // un dato registrado. Se deja morir cuando se resuelva.
    await previaCambioEtapa(s.cambios);
    const [fila] = await query<any>("SELECT cambios FROM gozz.oportunidad_etapa_solicitudes WHERE id=$1", [s.id]);
    expect(fila.cambios[id]).toBe(destino);
  });
});

describe("aprobar y rechazar", () => {
  it("aprobar EJECUTA por el mismo camino: mueve, audita y dispara los efectos", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const ganada = await crearEtapa({ esGanado: true });
    const ids = [await crearOportunidad(origen, { valor_total: 500, vendedor_id: solicitante }), await crearOportunidad(origen)];
    const s = await crearSolicitudEtapa(Object.fromEntries(ids.map((id) => [id, ganada])), { userId: solicitante });

    const r = await aprobarSolicitudEtapa(s.id, { userId: aprobador });

    expect(r.ok).toBe(true);
    const ok = r as any;
    expect(ok.solicitud.estado).toBe("ejecutada");
    expect(ok.solicitud.ejecutada_at).not.toBeNull();
    expect(ok.solicitud.resultado.cambiadas).toBe(2);
    for (const id of ids) expect(await etapaDe(id)).toBe(ganada);
    // Los efectos, no solo la columna.
    const [op] = await query<any>("SELECT puntos_asignados FROM gozz.oportunidades WHERE id = $1", [ids[0]]);
    expect(op.puntos_asignados).toBe(true);
  });

  it("🔴 avisa si el conjunto cambió entre pedir y aprobar, y no ejecuta a ciegas", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen)];
    const s = await crearSolicitudEtapa(Object.fromEntries(ids.map((id) => [id, destino])), { userId: solicitante });

    // Alguien mueve una a mano entre pedir y aprobar.
    await query("UPDATE gozz.oportunidades SET etapa = $1 WHERE id = $2", [destino, ids[0]]);

    const parado = await aprobarSolicitudEtapa(s.id, { userId: aprobador });
    expect(parado.ok).toBe(false);
    expect((parado as any).motivo).toBe("conjunto_cambiado");
    expect((parado as any).afectadas_al_pedir).toBe(2);
    expect((parado as any).aplicables_ahora).toBe(1);
    // Sigue pendiente: no se tocó nada.
    expect((await query<any>("SELECT estado FROM gozz.oportunidad_etapa_solicitudes WHERE id=$1", [s.id]))[0].estado).toBe("pendiente");

    // Con la confirmación del aprobador, se ejecuta lo que queda aplicable.
    const r = await aprobarSolicitudEtapa(s.id, { userId: aprobador, confirmarCambios: true });
    expect(r.ok).toBe(true);
    expect((r as any).resultado.cambiadas).toBe(1);
  });

  it("dos aprobaciones simultáneas: solo una gana (CAS)", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const destino = await crearEtapa();
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: destino }, { userId: solicitante });

    const [a, b] = await Promise.all([
      aprobarSolicitudEtapa(s.id, { userId: aprobador }).catch((e) => ({ ok: false, motivo: String(e?.message) })),
      aprobarSolicitudEtapa(s.id, { userId: aprobador }).catch((e) => ({ ok: false, motivo: String(e?.message) })),
    ]);
    expect([a.ok, b.ok].filter(Boolean), "exactamente una aprobación gana").toHaveLength(1);
  });

  it("rechazar exige motivo y deja la solicitud rechazada sin mover nada", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const id = await crearOportunidad(origen);
    const s = await crearSolicitudEtapa({ [id]: destino }, { userId: solicitante });

    await expect(rechazarSolicitudEtapa(s.id, { userId: aprobador, motivoRechazo: "   " })).rejects.toThrow(/obligatorio/);

    const r = await rechazarSolicitudEtapa(s.id, { userId: aprobador, motivoRechazo: "no toca todavía" });
    expect(r?.estado).toBe("rechazada");
    expect(r?.motivo_rechazo).toBe("no toca todavía");
    expect(await etapaDe(id)).toBe(origen);
  });

  it("una solicitud ya resuelta no se vuelve a aprobar", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    await rechazarSolicitudEtapa(s.id, { userId: aprobador, motivoRechazo: "no" });
    const r = await aprobarSolicitudEtapa(s.id, { userId: aprobador });
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("no_pendiente");
  });
});

describe("🔴 el trigger: de un estado terminal no se vuelve", () => {
  it("una EJECUTADA no se devuelve a pendiente", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    await aprobarSolicitudEtapa(s.id, { userId: aprobador });

    await expect(
      query("UPDATE gozz.oportunidad_etapa_solicitudes SET estado='pendiente' WHERE id=$1", [s.id])
    ).rejects.toThrow(/estado terminal/);
  });

  it("una RECHAZADA tampoco", async () => {
    const solicitante = await crearUsuario("usuario");
    const aprobador = await crearUsuario("admin");
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    await rechazarSolicitudEtapa(s.id, { userId: aprobador, motivoRechazo: "no" });

    await expect(
      query("UPDATE gozz.oportunidad_etapa_solicitudes SET estado='pendiente' WHERE id=$1", [s.id])
    ).rejects.toThrow(/estado terminal/);
  });
});

describe("quién aprueba: el permiso sale del tipo (§10.3)", () => {
  it("un usuario sin `aprobar_oportunidad_etapa` no tiene el tipo entre los que puede resolver", async () => {
    const normal = await crearUsuario("usuario");
    expect(await puede(normal, PERMISO_APROBAR)).toBe(false);
    expect(await tiposQuePuedeAprobar(normal)).not.toContain("oportunidad_etapa");
  });

  it("con el permiso concedido, el tipo aparece — sin tocar código ni añadirlo a ninguna lista", async () => {
    const normal = await crearUsuario("usuario");
    await conceder(normal, PERMISO_APROBAR);
    expect(await puede(normal, PERMISO_APROBAR)).toBe(true);
    expect(await tiposQuePuedeAprobar(normal)).toContain("oportunidad_etapa");
  });

  it("un admin puede con todos los tipos del ENUM, sin que nadie los nombre", async () => {
    const admin = await crearUsuario("admin");
    const tipos = await tiposQuePuedeAprobar(admin);
    expect(tipos).toContain("oportunidad_etapa");
    expect(tipos).toContain("contacto_exportar");
  });

  it("un usuario DESACTIVADO con el permiso no puede", async () => {
    const apagado = await crearUsuario("usuario", false);
    await conceder(apagado, PERMISO_APROBAR);
    expect(await puede(apagado, PERMISO_APROBAR)).toBe(false);
    expect(await tiposQuePuedeAprobar(apagado)).toHaveLength(0);
  });
});

describe("la forma canónica de la tabla (§10.2)", () => {
  it("tiene el marco común, los CHECK y el trigger compartido", async () => {
    const cols = (await query<any>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='gozz' AND table_name='oportunidad_etapa_solicitudes'`
    )).map((r: any) => r.column_name);
    for (const c of ["id", "tipo", "solicitante_id", "motivo", "estado", "aprobador_id",
                     "motivo_rechazo", "resultado", "created_at", "resolved_at", "ejecutada_at",
                     "cambios", "oportunidades_afectadas"]) {
      expect(cols, `falta la columna canónica "${c}"`).toContain(c);
    }

    const [{ funcion }] = await query<any>(
      `SELECT p.proname AS funcion FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'gozz.oportunidad_etapa_solicitudes'::regclass AND NOT t.tgisinternal`
    );
    expect(funcion).toBe("solicitud_no_regresa");
  });

  it("rechaza un estado fuera del vocabulario y una resuelta sin aprobador", async () => {
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: await crearUsuario() });
    await expect(query("UPDATE gozz.oportunidad_etapa_solicitudes SET estado='aprobado' WHERE id=$1", [s.id])).rejects.toThrow();
    await expect(query("UPDATE gozz.oportunidad_etapa_solicitudes SET estado='aprobada' WHERE id=$1", [s.id])).rejects.toThrow();
  });

  it("no admite un mapa de cambios vacío", async () => {
    await expect(
      query(
        `INSERT INTO gozz.oportunidad_etapa_solicitudes (solicitante_id, cambios, oportunidades_afectadas)
         VALUES ($1, '{}'::jsonb, 1)`,
        [await crearUsuario()]
      )
    ).rejects.toThrow();
  });

  it("🔴 las dos vistas siguen con shape idéntico tras añadir la cuarta rama", async () => {
    const shape = (v: string) => query<any>(
      `SELECT ordinal_position, column_name, data_type FROM information_schema.columns
        WHERE table_schema='gozz' AND table_name=$1 ORDER BY ordinal_position`, [v]
    );
    const a = await shape("vi_solicitudes_oportunidades");
    const b = await shape("vi_solicitudes_contactos");
    expect(a).toHaveLength(15);
    expect(a).toEqual(b);
    expect(b).toEqual(a);
  });

  it("y ninguna traduce el estado (§10.5)", async () => {
    const filas = await query<any>(
      `SELECT viewname FROM pg_views
        WHERE schemaname='gozz' AND viewname LIKE 'vi_solicitudes%' AND definition ~* 'CASE'`
    );
    expect(filas.map((r: any) => r.viewname)).toEqual([]);
  });
});
