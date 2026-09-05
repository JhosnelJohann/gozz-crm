// ============================================================================================
// T3 · LOS DOCUMENTOS DE UN CONTACTO, POR NEGOCIACIÓN — pruebas de ruta
//
// El endpoint tiene que servir a DOS formas de árbol que conviven hoy en producción:
//
//   · 6.935 carpetas de negociación cuelgan de `Trámites` (todo lo anterior a la migración a R2)
//   ·   282 cuelgan de la carpeta del contacto (mig. `0046`/`0047`)
//
// Una implementación que bajara desde la carpeta del contacto funcionaría para 266 contactos y
// devolvería vacío para los otros treinta y un mil. Y devolver vacío no da error: se lee como
// «este cliente no tiene documentos». Por eso hay una prueba para cada forma.
//
// La otra que muerde es el duplicado: en la segunda forma, bajar desde la carpeta del contacto
// se traga las negociaciones enteras y cada archivo saldría dos veces.
//
// 🔴 Todo sintético, en la base desechable. Cero red.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/shared/socket.js", () => ({ emitToUser: vi.fn(), emitToGrupo: vi.fn(), emitToAll: vi.fn() }));

import request from "supertest";

import { query } from "../src/shared/db.js";
import { cookieDe, crearAppDePruebas } from "./setup/app-de-pruebas.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

const app = crearAppDePruebas();

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

type Usuario = { id: string; email: string; nivel: string };

async function crearUsuario(nivel: string): Promise<Usuario> {
  const email = `docs-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba',$2,true) RETURNING id`,
    [email, nivel]
  );
  return { id: r[0].id, email, nivel };
}
const sesion = (u: Usuario) => cookieDe({ sub: u.id, email: u.email, nivel: u.nivel });

async function crearContacto(nombre: string) {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache (nombre_completo) VALUES ($1) RETURNING id`, [nombre]
  );
  return r[0].id as string;
}
async function crearNegociacion(contactoId: string, nombre: string) {
  const r = await query<any>(
    `INSERT INTO gozz.oportunidades (contacto_id, nombre_caso, etapa) VALUES ($1,$2,'nuevo') RETURNING id`,
    [contactoId, nombre]
  );
  return r[0].id as string;
}
async function crearCarpeta(nombre: string, tipo: string, parentId: string | null, creador: string, extra: { oportunidad_id?: string; contacto_id?: string; seccion?: string } = {}) {
  const r = await query<any>(
    `INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, created_by, oportunidad_id, contacto_id, seccion)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [nombre, tipo, parentId, creador, extra.oportunidad_id ?? null, extra.contacto_id ?? null, extra.seccion ?? null]
  );
  return r[0].id as string;
}
async function crearArchivo(folderId: string, nombre: string, subidoPor: string, borrado = false) {
  const r = await query<any>(
    `INSERT INTO gozz.drive_files (folder_id, nombre, mime, size_bytes, uploaded_by, deleted_at, ciclo)
     VALUES ($1,$2,'application/pdf',1024,$3,$4,$5) RETURNING id`,
    [folderId, nombre, subidoPor, borrado ? new Date().toISOString() : null, borrado ? "papelera" : "activo"]
  );
  return r[0].id as string;
}

let jefa: Usuario;
let tramites = "";

const pedir = (contactoId: string, u: Usuario) =>
  request(app).get(`/api/contactos/${contactoId}/documentos`).set("Cookie", sesion(u));

const nombresDe = (files: any[]) => (files ?? []).map((f: any) => f.nombre);

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
  jefa = await crearUsuario("admin");
  // 🔴 ESTE FICHERO NO SIEMBRA UNA RAÍZ, y no es un descuido.
  //
  // La base desechable es UNA para toda la suite. `drive-visibilidad.test.ts` siembra la suya y
  // varias consultas del backend resuelven la raíz con `WHERE tipo='root' … LIMIT 1`: con dos
  // raíces, cuál gana depende del orden físico de las filas y las pruebas del otro fichero se
  // caen — o peor, pasan hoy y fallan mañana. Ya avisaba de esto el comentario de aquel fichero,
  // y aquí se cayó en ello igualmente.
  //
  // Este endpoint no necesita raíz: busca por `oportunidad_id` y por `contacto_id`, nunca
  // bajando desde el árbol. Las carpetas de aquí cuelgan de nada a propósito.
  tramites = await crearCarpeta("Trámites", "opportunities_root", null, jefa.id);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 A · las DOS formas de árbol que conviven en producción", () => {
  it("forma VIEJA — la carpeta de la negociación cuelga de «Trámites» (6.935 casos)", async () => {
    const contacto = await crearContacto(`Vieja ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Asilo");
    const carpeta = await crearCarpeta("Asilo", "opportunity", tramites, jefa.id, { oportunidad_id: nego });
    const seccion = await crearCarpeta("Comprobantes de Pago", "custom", carpeta, jefa.id, { seccion: "pagos" });
    await crearArchivo(carpeta, "solicitud.pdf", jefa.id);
    await crearArchivo(seccion, "recibo.pdf", jefa.id);

    const r = await pedir(contacto, jefa);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    const g = r.body.grupos.find((x: any) => x.oportunidad_id === nego);
    expect(g).toBeTruthy();
    // Los de las subcarpetas de sección cuentan: ahí es donde vive casi todo.
    expect(nombresDe(g.files).sort()).toEqual(["recibo.pdf", "solicitud.pdf"]);
  });

  it("forma NUEVA — la carpeta de la negociación cuelga de la del contacto (282 casos)", async () => {
    const contacto = await crearContacto(`Nueva ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Residencia");
    const delContacto = await crearCarpeta("Cliente", "contact", null, jefa.id, { contacto_id: contacto });
    const carpeta = await crearCarpeta("Residencia", "opportunity", delContacto, jefa.id, { oportunidad_id: nego });
    await crearArchivo(carpeta, "i485.pdf", jefa.id);

    const r = await pedir(contacto, jefa);
    expect(r.status).toBe(200);
    const g = r.body.grupos.find((x: any) => x.oportunidad_id === nego);
    expect(nombresDe(g.files)).toEqual(["i485.pdf"]);
  });

  it("🔴 en la forma NUEVA, un archivo de la negociación NO sale además en «General»", async () => {
    // El duplicado que se produce al bajar desde la carpeta del contacto sin cortar en las
    // negociaciones. No da error: el mismo documento aparece dos veces y el total miente.
    const contacto = await crearContacto(`Sin duplicar ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Ciudadanía");
    const delContacto = await crearCarpeta("Cliente", "contact", null, jefa.id, { contacto_id: contacto });
    const carpeta = await crearCarpeta("Ciudadanía", "opportunity", delContacto, jefa.id, { oportunidad_id: nego });
    await crearArchivo(carpeta, "n400.pdf", jefa.id);

    const r = await pedir(contacto, jefa);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);                                  // una vez, no dos
    const general = r.body.grupos.find((x: any) => x.tipo === "general");
    expect(general).toBeUndefined();                               // no hay cajón de sastre que crear
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("B · los grupos", () => {
  it("«General» recoge lo que cuelga del contacto y no de ninguna negociación", async () => {
    const contacto = await crearContacto(`Con general ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Asilo");
    const delContacto = await crearCarpeta("Cliente", "contact", null, jefa.id, { contacto_id: contacto });
    const general = await crearCarpeta("General", "custom", delContacto, jefa.id, { seccion: "general" });
    const carpeta = await crearCarpeta("Asilo", "opportunity", delContacto, jefa.id, { oportunidad_id: nego });
    await crearArchivo(general, "pasaporte.pdf", jefa.id);
    await crearArchivo(carpeta, "declaracion.pdf", jefa.id);

    const r = await pedir(contacto, jefa);
    const g = r.body.grupos.find((x: any) => x.tipo === "general");
    expect(nombresDe(g.files)).toEqual(["pasaporte.pdf"]);
    expect(r.body.grupos[r.body.grupos.length - 1].tipo).toBe("general");   // va el último
  });

  it("una negociación SIN documentos sale igual, vacía", async () => {
    // Que salga vacía informa; que no salga se lee como que esa negociación no existe.
    const contacto = await crearContacto(`Vacía ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Todavía nada");

    const r = await pedir(contacto, jefa);
    const g = r.body.grupos.find((x: any) => x.oportunidad_id === nego);
    expect(g).toBeTruthy();
    expect(g.files).toEqual([]);
    expect(g.nombre).toBe("Todavía nada");
  });

  it("un contacto sin negociaciones ni carpeta devuelve vacío, no un error", async () => {
    const contacto = await crearContacto(`Pelado ${sufijo()}`);
    const r = await pedir(contacto, jefa);
    expect(r.status).toBe(200);
    expect(r.body.grupos).toEqual([]);
    expect(r.body.total).toBe(0);
  });

  it("los documentos de OTRO contacto no se cuelan", async () => {
    const mio = await crearContacto(`Mío ${sufijo()}`);
    const ajeno = await crearContacto(`Ajeno ${sufijo()}`);
    const negoAjena = await crearNegociacion(ajeno, "Lo del vecino");
    const carpetaAjena = await crearCarpeta("Lo del vecino", "opportunity", tramites, jefa.id, { oportunidad_id: negoAjena });
    await crearArchivo(carpetaAjena, "no-es-mio.pdf", jefa.id);

    const r = await pedir(mio, jefa);
    expect(r.body.total).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain("no-es-mio.pdf");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("C · lo que no debe aparecer", () => {
  it("un archivo en la papelera no cuenta", async () => {
    const contacto = await crearContacto(`Con papelera ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Asilo");
    const carpeta = await crearCarpeta("Asilo", "opportunity", tramites, jefa.id, { oportunidad_id: nego });
    await crearArchivo(carpeta, "vivo.pdf", jefa.id);
    await crearArchivo(carpeta, "borrado.pdf", jefa.id, true);

    const r = await pedir(contacto, jefa);
    expect(r.body.total).toBe(1);
    expect(JSON.stringify(r.body)).not.toContain("borrado.pdf");
  });

  it("un contacto que no existe da 404", async () => {
    const r = await pedir("00000000-0000-4000-8000-000000000123", jefa);
    expect(r.status).toBe(404);
  });

  it("🔴 solo viajan metadatos: ni una clave del almacén ni una ruta de disco", async () => {
    // Los BYTES los sirve `/api/drive/files/:id/raw`, que sí comprueba la ACL. Un listado que
    // filtrara `r2_key` o `local_path` daría una vía para pedir el objeto por fuera del proxy.
    const contacto = await crearContacto(`Metadatos ${sufijo()}`);
    const nego = await crearNegociacion(contacto, "Asilo");
    const carpeta = await crearCarpeta("Asilo", "opportunity", tramites, jefa.id, { oportunidad_id: nego });
    await crearArchivo(carpeta, "doc.pdf", jefa.id);

    const r = await pedir(contacto, jefa);
    const cuerpo = JSON.stringify(r.body);
    expect(cuerpo).not.toContain("r2_key");
    expect(cuerpo).not.toContain("local_path");
    expect(cuerpo).not.toContain("sha256");
    expect(cuerpo).not.toContain("ghl_url");
  });
});
