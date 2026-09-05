// ============================================================================================
// QUÉ TAREAS VEO — creadas por mí, asignadas a mí, o las que observo
//
// Entrega del 2026-09-02. Hasta hoy «Mis tareas» era `responsable_id = yo y nada más`, así que
// **en cuanto delegabas una tarea desaparecía de tu pantalla**: quien la encargaba no podía ver en
// qué estado iba. El caso que lo destapó, en staging: una tarea creada por Briset y asignada a Juan
// David no aparecía al filtrar por Briset ni buscando su título.
//
// 🔴 Lo que NO cubre este montaje está en `setup/app-de-pruebas.ts`.
// 🔴 CERO RED (§9.3): socket y push simulados.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/shared/socket.js", () => ({ emitToUser: vi.fn(), emitToGrupo: vi.fn(), emitToAll: vi.fn() }));
vi.mock("../src/push.js", () => ({ sendPushToUser: vi.fn(async () => undefined) }));

import request from "supertest";

import { query } from "../src/shared/db.js";
import { VINCULO_INVALIDO } from "../src/lib/tareas-vinculo.js";
import { cookieDe, crearAppDePruebas } from "./setup/app-de-pruebas.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

const app = crearAppDePruebas();

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

type Usuario = { id: string; email: string; nivel: string };

async function crearUsuario(nivel = "usuario"): Promise<Usuario> {
  const email = `vinculo-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba',$2,true) RETURNING id`,
    [email, nivel]
  );
  return { id: r[0].id, email, nivel };
}

/** Una tarea escrita directo en la base: así se controla exactamente quién es quién. */
async function crearTarea(o: {
  titulo: string; propietario: string; responsable: string; observadores?: string[];
}): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.tareas (titulo, propietario_id, responsable_id, observadores, estado)
     VALUES ($1,$2,$3,$4::jsonb,'pendiente') RETURNING id`,
    [o.titulo, o.propietario, o.responsable, JSON.stringify(o.observadores || [])]
  );
  return r[0].id;
}

const sesion = (u: Usuario) => cookieDe({ sub: u.id, email: u.email, nivel: u.nivel });

const idsDe = (body: any) => (body.tareas || []).map((t: any) => t.id);

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 el caso que motivó la entrega: delegar una tarea no la hace desaparecer", () => {
  it("quien la CREÓ la ve, y quien la tiene ASIGNADA también", async () => {
    const briset = await crearUsuario();
    const juan = await crearUsuario();
    const tarea = await crearTarea({ titulo: `Delegada ${sufijo()}`, propietario: briset.id, responsable: juan.id });

    // Antes de esto, Briset no la veía por ningún lado: solo se listaba por responsable.
    const deBriset = await request(app).get("/api/tareas").set("Cookie", sesion(briset));
    expect(idsDe(deBriset.body)).toContain(tarea);

    const deJuan = await request(app).get("/api/tareas").set("Cookie", sesion(juan));
    expect(idsDe(deJuan.body)).toContain(tarea);
  });
});

describe("las cuatro opciones del filtro", () => {
  it("`creador` la enseña solo a quien la creó · `asignado` solo a quien la tiene", async () => {
    const briset = await crearUsuario();
    const juan = await crearUsuario();
    const tarea = await crearTarea({ titulo: `Cuatro ${sufijo()}`, propietario: briset.id, responsable: juan.id });

    const brisetCreador = await request(app).get("/api/tareas?vinculo=creador").set("Cookie", sesion(briset));
    expect(idsDe(brisetCreador.body)).toContain(tarea);
    const brisetAsignado = await request(app).get("/api/tareas?vinculo=asignado").set("Cookie", sesion(briset));
    expect(idsDe(brisetAsignado.body)).not.toContain(tarea);

    const juanAsignado = await request(app).get("/api/tareas?vinculo=asignado").set("Cookie", sesion(juan));
    expect(idsDe(juanAsignado.body)).toContain(tarea);
    const juanCreador = await request(app).get("/api/tareas?vinculo=creador").set("Cookie", sesion(juan));
    expect(idsDe(juanCreador.body)).not.toContain(tarea);
  });

  /**
   * 🔴 `observador` es EXCLUYENTE, y es lo que se pidió: no suma a «por defecto», lo sustituye.
   * Quien lo elige quiere mirar SOLO esa bandeja.
   */
  it("`observador` enseña las que observo y NADA más", async () => {
    const yo = await crearUsuario();
    const otra = await crearUsuario();
    const observada = await crearTarea({
      titulo: `Observada ${sufijo()}`, propietario: otra.id, responsable: otra.id, observadores: [yo.id],
    });
    const mia = await crearTarea({ titulo: `Mía ${sufijo()}`, propietario: yo.id, responsable: yo.id });

    const r = await request(app).get("/api/tareas?vinculo=observador").set("Cookie", sesion(yo));
    expect(idsDe(r.body)).toContain(observada);
    expect(idsDe(r.body)).not.toContain(mia);
  });

  /**
   * 🔴 La otra mitad, y la que protege lo que la regla vieja protegía: «por defecto» NO arrastra
   * lo que uno solo observa. Ser observador es mirar, no tener la tarea.
   */
  it("por defecto NO se cuelan las que solo observo", async () => {
    const yo = await crearUsuario();
    const otra = await crearUsuario();
    const observada = await crearTarea({
      titulo: `Solo observo ${sufijo()}`, propietario: otra.id, responsable: otra.id, observadores: [yo.id],
    });

    const r = await request(app).get("/api/tareas").set("Cookie", sesion(yo));
    expect(idsDe(r.body)).not.toContain(observada);
  });

  it("un valor que no está en la lista es 400, no un «por defecto» silencioso", async () => {
    const yo = await crearUsuario();
    const r = await request(app).get("/api/tareas?vinculo=creadorr").set("Cookie", sesion(yo));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(VINCULO_INVALIDO);
  });

  it("sin el parámetro se aplica el valor por defecto, no un error", async () => {
    const yo = await crearUsuario();
    const r = await request(app).get("/api/tareas").set("Cookie", sesion(yo));
    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 los contadores cuadran con las filas — en las cuatro opciones", () => {
  /**
   * Son DOS consultas distintas con su propio WHERE. Cuando divergen, el chip de arriba dice 15 y
   * el tablero de abajo enseña 30 — el defecto D2 de Oportunidades. Esta es la prueba que impide
   * que vuelva a pasar: si alguien toca una de las dos y no la otra, aquí se pone rojo.
   */
  it("`pendientes` es exactamente el número de pendientes devueltas", async () => {
    const yo = await crearUsuario();
    const otra = await crearUsuario();

    await crearTarea({ titulo: `C ${sufijo()}`, propietario: yo.id, responsable: otra.id });
    await crearTarea({ titulo: `A ${sufijo()}`, propietario: otra.id, responsable: yo.id });
    await crearTarea({ titulo: `CA ${sufijo()}`, propietario: yo.id, responsable: yo.id });
    await crearTarea({
      titulo: `O ${sufijo()}`, propietario: otra.id, responsable: otra.id, observadores: [yo.id],
    });

    for (const vinculo of ["defecto", "creador", "asignado", "observador"]) {
      const r = await request(app).get(`/api/tareas?vinculo=${vinculo}`).set("Cookie", sesion(yo));
      expect(r.status).toBe(200);
      const pendientesDevueltas = (r.body.tareas || []).filter((t: any) => t.estado === "pendiente").length;
      expect({ vinculo, n: r.body.counts?.pendientes }).toEqual({ vinculo, n: pendientesDevueltas });
    }
  });

  it("y los números NO son los mismos entre opciones: si lo fueran, el filtro no filtraría", async () => {
    const yo = await crearUsuario();
    const otra = await crearUsuario();
    await crearTarea({ titulo: `Solo creada ${sufijo()}`, propietario: yo.id, responsable: otra.id });
    await crearTarea({ titulo: `Solo asignada ${sufijo()}`, propietario: otra.id, responsable: yo.id });

    const defecto = await request(app).get("/api/tareas?vinculo=defecto").set("Cookie", sesion(yo));
    const creador = await request(app).get("/api/tareas?vinculo=creador").set("Cookie", sesion(yo));
    expect(defecto.body.counts.pendientes).toBeGreaterThan(creador.body.counts.pendientes);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 el filtro nuevo NO es una rendija para ver de más", () => {
  /**
   * Un usuario normal que mira la bandeja de otra persona solo ve lo que además le concierne. Esa
   * barrera es anterior a esta entrega y `vinculo` no puede aflojarla: si `creador` dejara ver todo
   * lo que creó un compañero, el parámetro sería una puerta trasera.
   */
  it("un usuario normal mirando a otra persona no ve lo que no le concierne", async () => {
    const yo = await crearUsuario("usuario");
    const otra = await crearUsuario("usuario");
    const ajena = await crearTarea({ titulo: `Ajena ${sufijo()}`, propietario: otra.id, responsable: otra.id });
    const compartida = await crearTarea({
      titulo: `Compartida ${sufijo()}`, propietario: otra.id, responsable: otra.id, observadores: [yo.id],
    });

    for (const vinculo of ["defecto", "creador", "asignado", "observador"]) {
      const r = await request(app)
        .get(`/api/tareas?as_user_id=${otra.id}&vinculo=${vinculo}`).set("Cookie", sesion(yo));
      expect(r.status).toBe(200);
      expect({ vinculo, ve: idsDe(r.body).includes(ajena) }).toEqual({ vinculo, ve: false });
    }

    // Y lo que sí le concierne sigue viéndose: la barrera no se ha vuelto un muro.
    const conCreador = await request(app)
      .get(`/api/tareas?as_user_id=${otra.id}&vinculo=creador`).set("Cookie", sesion(yo));
    expect(idsDe(conCreador.body)).toContain(compartida);
  });

  it("un admin sí ve la bandeja completa de otra persona, por creador y por asignado", async () => {
    const jefa = await crearUsuario("admin");
    const otra = await crearUsuario("usuario");
    const creadaPorElla = await crearTarea({
      titulo: `Creada por ella ${sufijo()}`, propietario: otra.id, responsable: jefa.id,
    });

    const r = await request(app)
      .get(`/api/tareas?as_user_id=${otra.id}&vinculo=creador`).set("Cookie", sesion(jefa));
    expect(idsDe(r.body)).toContain(creadaPorElla);
  });

  it("scope=all sigue siendo 403 para quien no es admin", async () => {
    const yo = await crearUsuario("usuario");
    const r = await request(app).get("/api/tareas?scope=all").set("Cookie", sesion(yo));
    expect(r.status).toBe(403);
  });
});
