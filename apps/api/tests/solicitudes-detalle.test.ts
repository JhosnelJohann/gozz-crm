// ============================================================================================
// DETALLE DE UNA SOLICITUD — `src/lib/solicitudes-detalle.ts`
//
// 🔴 LO QUE PROTEGE. La bandeja enseñaba "2 oportunidades → nuevo" y el motivo. Quien aprueba no
// sabía CUÁLES eran esas dos, ni de qué clientes — y su nombre queda firmando en `aprobador_id`.
// Aquí se comprueba que el detalle enseña **el estado de hoy** y que **marca lo que ya no cuadra**
// con lo que se pidió: lo que se omite en silencio es lo que acaba ejecutándose sin que nadie lo
// mirara.
//
// El caso central es el del tiempo: entre pedir y aprobar pasan horas. La etapa que había AL PEDIR
// no está guardada en ninguna columna — se reconstruye desde `gozz.auditoria`, y eso es lo que
// hace falta probar de verdad.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import { crearSolicitudEtapa, cambiarEtapaMasivo } from "../src/lib/oportunidades-etapa.js";
import { detalleSolicitud } from "../src/lib/solicitudes-detalle.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(nivel = "usuario"): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash',$2,$3,true) RETURNING id`,
    [`detalle-${sufijo()}@pruebas.invalid`, `Persona ${sufijo()}`, nivel]
  );
  return r[0].id;
}

async function crearEtapa(d: { obligatorios?: string[]; label?: string } = {}): Promise<string> {
  const key = `dtl_${sufijo().replace(/-/g, "_")}`;
  await query(
    `INSERT INTO gozz.pipeline_stages (key, label, color, orden, es_terminal, es_ganado, campos_obligatorios, activa)
     VALUES ($1,$2,'#5C6670',999,false,false,$3::jsonb,true)`,
    [key, d.label ?? `Etapa ${key}`, JSON.stringify(d.obligatorios ?? [])]
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

const codigos = (d: any, id: string) =>
  d.items.find((i: any) => i.id === id)!.discrepancias.map((x: any) => x.codigo);

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("el detalle enseña qué se está aprobando", () => {
  it("una fila por oportunidad del mapa, con su etapa actual y la solicitada", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa({ label: "En preparación" });
    const destino = await crearEtapa({ label: "Ganado del test" });
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen)];
    const s = await crearSolicitudEtapa(Object.fromEntries(ids.map((id) => [id, destino])), { userId: solicitante });

    const r = await detalleSolicitud(s.id, aprobador);
    expect(r.ok).toBe(true);
    const d = (r as any).detalle;

    expect(d.items).toHaveLength(2);
    expect(new Set(d.items.map((i: any) => i.id))).toEqual(new Set(ids));
    for (const it of d.items) {
      // Etiquetas visibles, no las claves internas (§4.7).
      expect(it.actual).toBe("En preparación");
      expect(it.solicitado).toBe("Ganado del test");
      expect(it.discrepancias).toHaveLength(0);
    }
  });

  it("trae lo que hace reconocible el caso: trámite, contacto, valor y responsable", async () => {
    const solicitante = await crearUsuario();
    const responsable = await crearUsuario();
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const tramite = (await query<any>(
      `INSERT INTO gozz.tramites_config (nombre, codigo) VALUES ($1,$2) RETURNING id`,
      [`Asilo ${sufijo()}`, `asilo_${sufijo().replace(/-/g, "_")}`]
    ))[0].id;
    const contacto = (await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo) VALUES ($1) RETURNING id`,
      [`Cliente ${sufijo()}`]
    ))[0].id;
    const id = await crearOportunidad(origen, {
      tipo_tramite_id: tramite, contacto_id: contacto, valor_total: 1500, preparador_id: responsable,
    });
    const s = await crearSolicitudEtapa({ [id]: destino }, { userId: solicitante });

    const d = ((await detalleSolicitud(s.id, solicitante)) as any).detalle;
    const campos = Object.fromEntries(d.items[0].campos.map((c: any) => [c.etiqueta, c.valor]));

    expect(campos["Trámite"]).toMatch(/^Asilo /);
    expect(campos["Contacto"]).toMatch(/^Cliente /);
    expect(campos["Valor"]).toBe("$1500");
    expect(campos["Responsable"]).toBeTruthy();
  });
});

describe("🔴 las discrepancias: el estado de HOY, no la foto de ayer", () => {
  it("una que cambió de etapa DESPUÉS de pedirse sale marcada, y dice dónde estaba", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa({ label: "Origen" });
    const otra = await crearEtapa({ label: "Se la llevaron aquí" });
    const destino = await crearEtapa({ label: "Destino" });
    const movida = await crearOportunidad(origen);
    const quieta = await crearOportunidad(origen);
    const s = await crearSolicitudEtapa({ [movida]: destino, [quieta]: destino }, { userId: solicitante });

    // Alguien la mueve por el camino normal — que es el que deja fila en `auditoria`.
    await cambiarEtapaMasivo({ [movida]: otra }, { userId: aprobador });

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;

    expect(codigos(d, movida)).toContain("cambio_de_estado");
    const texto = d.items.find((i: any) => i.id === movida).discrepancias
      .find((x: any) => x.codigo === "cambio_de_estado").texto;
    expect(texto).toContain("Origen");                 // dónde estaba al pedirse
    expect(texto).toContain("Se la llevaron aquí");    // dónde está hoy
    // Y la que nadie tocó no se marca.
    expect(codigos(d, quieta)).toHaveLength(0);

    // El resumen agregado, que es lo que la confirmación tiene que enseñar.
    expect(d.discrepancias.total).toBe(1);
    expect(d.discrepancias.resumen.find((x: any) => x.codigo === "cambio_de_estado")?.n).toBe(1);
  });

  it("🔴 la detecta AUNQUE el cambio no dejara rastro en la bitácora — es el caso que la motiva", async () => {
    // El origen se guarda AL PEDIR, así que comparar no depende de que alguien auditara. Aquí la
    // etapa se cambia con un UPDATE crudo: ningún camino de la aplicación escribe así, pero es
    // exactamente lo que hacían dos endpoints del proyecto antes de esta entrega, y lo que hace
    // cualquier arreglo a mano en la base. La reconstrucción por `auditoria` NO lo vería.
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa({ label: "De aquí" });
    const otra = await crearEtapa({ label: "Se la llevaron sin auditar" });
    const destino = await crearEtapa({ label: "A donde iba" });
    const id = await crearOportunidad(origen);
    const s = await crearSolicitudEtapa({ [id]: destino }, { userId: solicitante });

    await query("UPDATE gozz.oportunidades SET etapa = $1 WHERE id = $2", [otra, id]);
    // Se comprueba que, efectivamente, no hay rastro: si lo hubiera, este test no probaría nada.
    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.auditoria
        WHERE tabla_afectada='oportunidades' AND registro_id=$1 AND datos_antes ? 'etapa'`, [id]
    );
    expect(n, "el UPDATE crudo no debe haber dejado bitácora").toBe(0);

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;
    expect(codigos(d, id)).toContain("cambio_de_estado");
    const texto = d.items[0].discrepancias.find((x: any) => x.codigo === "cambio_de_estado").texto;
    expect(texto).toContain("De aquí");
    expect(texto).toContain("Se la llevaron sin auditar");
  });

  it("una que YA está en la etapa destino sale marcada: no hay nada que hacer con ella", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const id = await crearOportunidad(origen);
    const s = await crearSolicitudEtapa({ [id]: destino }, { userId: solicitante });

    await cambiarEtapaMasivo({ [id]: destino }, { userId: aprobador });

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;
    expect(codigos(d, id)).toContain("ya_en_destino");
  });

  it("una que ya no existe sale marcada, no se omite en silencio", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const destino = await crearEtapa();
    const viva = await crearOportunidad(await crearEtapa());
    const condenada = await crearOportunidad(await crearEtapa());
    const s = await crearSolicitudEtapa({ [viva]: destino, [condenada]: destino }, { userId: solicitante });

    await query("DELETE FROM gozz.oportunidades WHERE id = $1", [condenada]);

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;
    // 🔴 Siguen siendo DOS filas: la que desapareció se enseña diciendo que desapareció.
    expect(d.items).toHaveLength(2);
    expect(codigos(d, condenada)).toEqual(["no_existe"]);
    expect(d.items.find((i: any) => i.id === condenada).actual).toBeNull();
  });

  it("una que no pasaría la validación sale marcada ANTES de ejecutar, con qué le falta", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const exigente = await crearEtapa({ obligatorios: ["preparador_id"] });
    const sinPreparador = await crearOportunidad(origen);
    const s = await crearSolicitudEtapa({ [sinPreparador]: exigente }, { userId: solicitante });

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;
    expect(codigos(d, sinPreparador)).toContain("faltan_campos");
    expect(d.items[0].discrepancias.find((x: any) => x.codigo === "faltan_campos").detalle).toEqual(["preparador_id"]);
  });

  it("sin nada raro, no inventa discrepancias", async () => {
    const solicitante = await crearUsuario();
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    const d = ((await detalleSolicitud(s.id, solicitante)) as any).detalle;
    expect(d.discrepancias.total).toBe(0);
    expect(d.discrepancias.resumen).toEqual([]);
  });
});

describe("🔴 la forma ANTIGUA sigue cubierta por la reconstrucción", () => {
  it("una solicitud sin origen guardado detecta la discrepancia por `auditoria`", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa({ label: "Origen viejo" });
    const otra = await crearEtapa({ label: "Movida después" });
    const destino = await crearEtapa({ label: "Destino viejo" });
    const id = await crearOportunidad(origen);

    // Escrita a mano con la forma antigua: destino escalar, sin `desde`.
    const s = (await query<any>(
      `INSERT INTO gozz.oportunidad_etapa_solicitudes
         (solicitante_id, cambios, oportunidades_afectadas) VALUES ($1,$2::jsonb,1) RETURNING *`,
      [solicitante, JSON.stringify({ [id]: destino })]
    ))[0];

    // Se mueve por el camino que SÍ audita — que es lo único que cubre a las viejas.
    await cambiarEtapaMasivo({ [id]: otra }, { userId: aprobador });

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;
    expect(codigos(d, id)).toContain("cambio_de_estado");
    const texto = d.items[0].discrepancias.find((x: any) => x.codigo === "cambio_de_estado").texto;
    expect(texto).toContain("Origen viejo");
    expect(texto).toContain("Movida después");
    // Y el resto del detalle funciona igual: destino, campos y efectos.
    expect(d.items[0].solicitado).toBe("Destino viejo");
    expect(d.efectos).toBeTruthy();
  });
});

describe("los efectos van recalculados, no los del momento de pedirla", () => {
  it("los trae con los números de hoy y sin escribir nada", async () => {
    const solicitante = await crearUsuario();
    const aprobador = await crearUsuario("admin");
    const origen = await crearEtapa();
    const destino = await crearEtapa();
    const ids = [await crearOportunidad(origen), await crearOportunidad(origen)];
    const s = await crearSolicitudEtapa(Object.fromEntries(ids.map((id) => [id, destino])), { userId: solicitante });

    // Alguien activa una automatización DESPUÉS de que se pidiera la solicitud.
    const stageId = (await query<any>("SELECT id FROM gozz.pipeline_stages WHERE key = $1", [destino]))[0].id;
    await query(
      `INSERT INTO gozz.stage_automations (stage_id, tipo, config, activa, orden)
       VALUES ($1,'crear_tarea',$2::jsonb,true,1)`,
      [stageId, JSON.stringify({ titulo: `Post ${sufijo()}` })]
    );

    const d = ((await detalleSolicitud(s.id, aprobador)) as any).detalle;
    // 🔴 La cuenta es de AHORA: quien aprueba es quien ejecuta.
    expect(d.efectos.automatizaciones).toBe(2);
    expect(d.efectos.aplicables).toBe(2);

    // Y no ha movido nada.
    for (const id of ids) {
      expect((await query<any>("SELECT etapa FROM gozz.oportunidades WHERE id=$1", [id]))[0].etapa).toBe(origen);
    }
  });
});

describe("quién puede verlo", () => {
  it("quien la pidió sí, aunque no pueda aprobarla", async () => {
    const solicitante = await crearUsuario();
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    const r = await detalleSolicitud(s.id, solicitante);
    expect(r.ok).toBe(true);
    expect((r as any).detalle.solicitud.puede_aprobar).toBe(false);
  });

  it("quien puede aprobar ese tipo, sí — y se le marca que puede", async () => {
    const solicitante = await crearUsuario();
    const otro = await crearUsuario();
    await query("INSERT INTO gozz.user_permisos (user_id, permiso) VALUES ($1,'aprobar_oportunidad_etapa')", [otro]);
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    const r = await detalleSolicitud(s.id, otro);
    expect(r.ok).toBe(true);
    expect((r as any).detalle.solicitud.puede_aprobar).toBe(true);
  });

  it("🔴 quien ni la pidió ni puede aprobarla, NO — son nombres de clientes", async () => {
    const solicitante = await crearUsuario();
    const ajeno = await crearUsuario();
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    const r = await detalleSolicitud(s.id, ajeno);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("sin_permiso");
  });

  it("sin sesión tampoco", async () => {
    const solicitante = await crearUsuario();
    const s = await crearSolicitudEtapa({ [await crearOportunidad(await crearEtapa())]: await crearEtapa() }, { userId: solicitante });
    expect((await detalleSolicitud(s.id, null)).ok).toBe(false);
  });

  it("una solicitud que no existe se distingue de una sin permiso", async () => {
    const r = await detalleSolicitud("00000000-0000-0000-0000-0000000000ff", await crearUsuario("admin"));
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("no_encontrada");
  });
});
