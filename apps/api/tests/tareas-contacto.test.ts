// ============================================================================================
// TAREAS LIGADAS A UN CONTACTO — que el vínculo se escriba bien y se pueda encontrar
//
// Entrega del 2026-09-02. Hasta hoy `tareas.contacto_id` existía, la API lo devolvía resuelto en
// `contacto_nombre`… y **ninguna pantalla lo enseñaba ni lo dejaba elegir**. Lo que se prueba aquí
// es la mitad del servidor: quién acaba siendo el cliente de la tarea, y que se pueda filtrar y
// buscar por él.
//
// 🔴 Lo que NO cubre este montaje está escrito en `setup/app-de-pruebas.ts`. Un verde de aquí dice
// que la RUTA se comporta bien; no dice que la aplicación arranque.
//
// 🔴 CERO RED (§9.3): `socket.js` y `push.js` se simulan. Crear una tarea emite eventos y manda
// notificaciones push; ninguna de las dos cosas tiene nada que ver con lo que se está probando, y
// las push salen contra un servicio externo de verdad.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

// Los mocks van ANTES de cualquier import que arrastre estos módulos.
vi.mock("../src/shared/socket.js", () => ({ emitToUser: vi.fn(), emitToGrupo: vi.fn(), emitToAll: vi.fn() }));
vi.mock("../src/push.js", () => ({ sendPushToUser: vi.fn(async () => undefined) }));

import request from "supertest";

import { query } from "../src/shared/db.js";
import { VINCULO_DISCORDANTE } from "../src/lib/tarea-vinculo.js";
import { cookieDe, crearAppDePruebas } from "./setup/app-de-pruebas.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

const app = crearAppDePruebas();

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

type Usuario = { id: string; email: string; nivel: string };

async function crearUsuario(nivel = "usuario"): Promise<Usuario> {
  const email = `tarea-contacto-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba',$2,true) RETURNING id`,
    [email, nivel]
  );
  return { id: r[0].id, email, nivel };
}

async function crearContacto(nombre: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache (nombre_completo, email)
     VALUES ($1,$2) RETURNING id`,
    [nombre, `${sufijo()}@pruebas.invalid`]
  );
  return r[0].id;
}

/** `contactoId` a null a propósito en un caso: la columna es NULLABLE y ese es el borde. */
async function crearOportunidad(contactoId: string | null, nombre: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (contacto_id, nombre_caso, etapa)
     VALUES ($1,$2,'nuevo') RETURNING id`,
    [contactoId, nombre]
  );
  return r[0].id;
}

const sesion = (u: Usuario) => cookieDe({ sub: u.id, email: u.email, nivel: u.nivel });

const filaTarea = async (id: string) =>
  (await query<any>("SELECT * FROM gozz.tareas WHERE id = $1", [id]))[0];

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /api/tareas · de qué cliente queda la tarea", () => {
  it("con contacto y sin oportunidad, se guarda tal cual", async () => {
    const u = await crearUsuario();
    const contacto = await crearContacto("Ana de Prueba");

    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Llamar en una semana", contacto_id: contacto });

    expect(r.status).toBe(200);
    expect((await filaTarea(r.body.tarea.id)).contacto_id).toBe(contacto);
  });

  /**
   * 🔴 LA REGLA QUE NO EXISTÍA EN ESTA RUTA. `POST /api/oportunidades/:id/tareas` ya derivaba el
   * contacto de la oportunidad; esta no, así que la misma tarea salía con cliente o sin él según
   * por dónde se hubiera creado.
   */
  it("con oportunidad y SIN contacto, el cliente lo pone la oportunidad", async () => {
    const u = await crearUsuario();
    const contacto = await crearContacto("Bruno de Prueba");
    const oportunidad = await crearOportunidad(contacto, "Asilo de Bruno");

    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Revisar expediente", oportunidad_id: oportunidad });

    expect(r.status).toBe(200);
    expect((await filaTarea(r.body.tarea.id)).contacto_id).toBe(contacto);
  });

  it("con los dos y concordantes, adelante", async () => {
    const u = await crearUsuario();
    const contacto = await crearContacto("Carla de Prueba");
    const oportunidad = await crearOportunidad(contacto, "Permiso de Carla");

    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Coherente", contacto_id: contacto, oportunidad_id: oportunidad });

    expect(r.status).toBe(200);
    expect((await filaTarea(r.body.tarea.id)).contacto_id).toBe(contacto);
  });

  /**
   * 🔴 No se coacciona al «más probable»: pisar en silencio el contacto que alguien eligió lo
   * dejaría creyendo que guardó otra cosa. Y **no se crea nada**, que es la mitad que se olvida
   * comprobar de un 400.
   */
  it("con los dos y DISCORDANTES, 400 — y no se crea ninguna tarea", async () => {
    const u = await crearUsuario();
    const ana = await crearContacto("Ana Discordante");
    const bruno = await crearContacto("Bruno Discordante");
    const casoDeBruno = await crearOportunidad(bruno, "Caso de Bruno");

    const antes = await query<any>("SELECT count(*)::int AS n FROM gozz.tareas");

    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Imposible", contacto_id: ana, oportunidad_id: casoDeBruno });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe(VINCULO_DISCORDANTE);

    const despues = await query<any>("SELECT count(*)::int AS n FROM gozz.tareas");
    expect(despues[0].n).toBe(antes[0].n);
  });

  /**
   * 🔴 EL BORDE QUE SE OLVIDA: `oportunidades.contacto_id` es NULLABLE. Si se diera por hecho que
   * toda oportunidad trae cliente, aquí se rechazaría —o se escribiría un null encima— una
   * combinación perfectamente válida.
   */
  it("una oportunidad SIN cliente no impone nada: se respeta el contacto que venga", async () => {
    const u = await crearUsuario();
    const contacto = await crearContacto("Diana de Prueba");
    const huerfana = await crearOportunidad(null, "Caso viejo sin cliente");

    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Con caso huérfano", contacto_id: contacto, oportunidad_id: huerfana });

    expect(r.status).toBe(200);
    expect((await filaTarea(r.body.tarea.id)).contacto_id).toBe(contacto);
  });

  it("y sin contacto ni oportunidad, la tarea se crea sin cliente", async () => {
    const u = await crearUsuario();
    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Tarea suelta" });

    expect(r.status).toBe(200);
    expect((await filaTarea(r.body.tarea.id)).contacto_id).toBeNull();
  });

  /** Decisión 4 de Juan David (2026-09-02): sin barrera de permisos. Se congela a propósito. */
  it("un usuario normal puede crear una tarea a cualquier contacto", async () => {
    const u = await crearUsuario("usuario");
    const contacto = await crearContacto("De otro cualquiera");

    const r = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Sin barrera, a propósito", contacto_id: contacto });

    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/tareas/:id · mover el vínculo", () => {
  it("cambiar de oportunidad arrastra el cliente, no deja el de antes", async () => {
    const u = await crearUsuario();
    const ana = await crearContacto("Ana Traslado");
    const bruno = await crearContacto("Bruno Traslado");
    const casoDeBruno = await crearOportunidad(bruno, "Caso de Bruno");

    const creada = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Se muda", contacto_id: ana });
    expect(creada.status).toBe(200);

    const r = await request(app).patch(`/api/tareas/${creada.body.tarea.id}`).set("Cookie", sesion(u))
      .send({ oportunidad_id: casoDeBruno });

    expect(r.status).toBe(200);
    // Si el contacto se quedara en Ana, la tarea diría ser de una persona y del caso de otra.
    expect((await filaTarea(creada.body.tarea.id)).contacto_id).toBe(bruno);
  });

  it("mandar un par discordante en el PATCH es 400", async () => {
    const u = await crearUsuario();
    const ana = await crearContacto("Ana PATCH");
    const bruno = await crearContacto("Bruno PATCH");
    const casoDeBruno = await crearOportunidad(bruno, "Caso de Bruno");

    const creada = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "No se muda" });

    const r = await request(app).patch(`/api/tareas/${creada.body.tarea.id}`).set("Cookie", sesion(u))
      .send({ contacto_id: ana, oportunidad_id: casoDeBruno });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe(VINCULO_DISCORDANTE);
  });

  /**
   * ⚠️ NO SE VALIDA HACIA ATRÁS. Una tarea que ya tenga un par incoherente —las hubo, porque nada
   * lo impedía— se sigue pudiendo editar. La regla mira lo que trae la petición, no la fila.
   */
  it("editar el título de una tarea con un par viejo incoherente sigue funcionando", async () => {
    const u = await crearUsuario();
    const ana = await crearContacto("Ana Legado");
    const bruno = await crearContacto("Bruno Legado");
    const casoDeBruno = await crearOportunidad(bruno, "Caso de Bruno");

    // Se siembra la incoherencia por debajo, como la habría dejado el código de antes.
    const fila = await query<any>(
      `INSERT INTO gozz.tareas (titulo, propietario_id, responsable_id, contacto_id, oportunidad_id)
       VALUES ('Vieja e incoherente',$1,$1,$2,$3) RETURNING id`,
      [u.id, ana, casoDeBruno]
    );

    const r = await request(app).patch(`/api/tareas/${fila[0].id}`).set("Cookie", sesion(u))
      .send({ titulo: "Título nuevo" });

    expect(r.status).toBe(200);
    const t = await filaTarea(fila[0].id);
    expect(t.titulo).toBe("Título nuevo");
    // Y no se le ha tocado el vínculo por la espalda.
    expect(t.contacto_id).toBe(ana);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("GET /api/tareas · encontrar las de un cliente", () => {
  it("filtra por contacto", async () => {
    const u = await crearUsuario();
    const ana = await crearContacto("Ana Filtro");
    const bruno = await crearContacto("Bruno Filtro");

    const suya = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "De Ana", contacto_id: ana });
    await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "De Bruno", contacto_id: bruno });

    const r = await request(app).get(`/api/tareas?contacto_id=${ana}`).set("Cookie", sesion(u));

    expect(r.status).toBe(200);
    const ids = r.body.tareas.map((t: any) => t.id);
    expect(ids).toContain(suya.body.tarea.id);
    expect(r.body.tareas.every((t: any) => t.contacto_id === ana)).toBe(true);
  });

  it("la respuesta trae el nombre del cliente resuelto, para poder pintarlo", async () => {
    const u = await crearUsuario();
    const nombre = `Ana Resuelta ${sufijo()}`;
    const contacto = await crearContacto(nombre);
    await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Con nombre", contacto_id: contacto });

    const r = await request(app).get(`/api/tareas?contacto_id=${contacto}`).set("Cookie", sesion(u));
    expect(r.body.tareas[0].contacto_nombre).toBe(nombre);
  });

  /**
   * 🔴 El buscador miraba título, descripción y el nombre del caso. Una tarea que cuelga de un
   * contacto y NO de una oportunidad —que es el caso entero de esta entrega— no aparecía por
   * ninguna de las tres.
   */
  it("el buscador la encuentra por el nombre del cliente, sin oportunidad de por medio", async () => {
    const u = await crearUsuario();
    const apellido = `Buscable${sufijo()}`;
    const contacto = await crearContacto(`Ana ${apellido}`);
    const creada = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Un título que no dice el nombre", contacto_id: contacto });

    const r = await request(app).get(`/api/tareas?q=${apellido}`).set("Cookie", sesion(u));

    expect(r.status).toBe(200);
    expect(r.body.tareas.map((t: any) => t.id)).toContain(creada.body.tarea.id);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 cancelar una tarea NO la borra", () => {
  /**
   * Decisión 5 de Juan David (2026-09-02): «eliminar» es cancelar. Esta prueba es la que sostiene
   * esa decisión — si algún día alguien cablea el botón al `DELETE` físico que sigue existiendo
   * (`tareas-routes.ts`, deuda declarada), esto se pone rojo.
   */
  it("la fila sigue existiendo y se puede volver a encontrar", async () => {
    const u = await crearUsuario();
    const contacto = await crearContacto("Ana Cancelada");
    const creada = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Se cancela", contacto_id: contacto });

    const r = await request(app).patch(`/api/tareas/${creada.body.tarea.id}`).set("Cookie", sesion(u))
      .send({ estado: "cancelada" });
    expect(r.status).toBe(200);

    const fila = await filaTarea(creada.body.tarea.id);
    expect(fila).toBeTruthy();
    expect(fila.estado).toBe("cancelada");

    const listada = await request(app)
      .get(`/api/tareas?contacto_id=${contacto}&estado=cancelada`).set("Cookie", sesion(u));
    expect(listada.body.tareas.map((t: any) => t.id)).toContain(creada.body.tarea.id);
  });

  it("y se puede reabrir, que es lo que la hace reversible", async () => {
    const u = await crearUsuario();
    const creada = await request(app).post("/api/tareas").set("Cookie", sesion(u))
      .send({ titulo: "Se cancela y vuelve" });

    await request(app).patch(`/api/tareas/${creada.body.tarea.id}`).set("Cookie", sesion(u))
      .send({ estado: "cancelada" });
    const r = await request(app).patch(`/api/tareas/${creada.body.tarea.id}`).set("Cookie", sesion(u))
      .send({ estado: "pendiente" });

    expect(r.status).toBe(200);
    expect((await filaTarea(creada.body.tarea.id)).estado).toBe("pendiente");
  });
});
