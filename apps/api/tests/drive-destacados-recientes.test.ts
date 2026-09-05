// ============================================================================================
// T6 · DESTACADOS Y RECIENTES — pruebas de ruta
//
// 🔴 LA QUE IMPORTA ES LA DEL ÁMBITO. Los destacados de compañía los ve TODO el equipo, así que
// si el ámbito se aceptara del cuerpo, cualquiera podría marcar una carpeta de su unidad personal
// como `compania` y publicar su NOMBRE —«Divorcio», «Contrato con X»— a los quince de la empresa.
// No haría falta malicia: bastaría un campo mal puesto en el cliente. El servidor lo DERIVA de
// dónde vive la cosa, y eso tiene su prueba.
//
// 🔴 Sin raíz sembrada, a propósito. Ver la guarda de `drive-visibilidad.test.ts`.
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
  const email = `dest-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba',$2,true) RETURNING id`,
    [email, nivel]
  );
  return { id: r[0].id, email, nivel };
}
const sesion = (u: Usuario) => cookieDe({ sub: u.id, email: u.email, nivel: u.nivel });

async function crearCarpeta(nombre: string, tipo: string, parentId: string | null, creador: string, owner?: string) {
  const r = await query<any>(
    `INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, created_by, owner_user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [nombre, tipo, parentId, creador, owner ?? null]
  );
  return r[0].id as string;
}
async function crearArchivo(folderId: string, nombre: string, subidoPor: string) {
  const r = await query<any>(
    `INSERT INTO gozz.drive_files (folder_id, nombre, mime, size_bytes, uploaded_by, ciclo)
     VALUES ($1,$2,'application/pdf',1024,$3,'activo') RETURNING id`,
    [folderId, nombre, subidoPor]
  );
  return r[0].id as string;
}

let ana: Usuario, beto: Usuario, jefa: Usuario;
let compania = "", deLaEmpresa = "", miDriveDeAna = "", privadaDeAna = "", archivoPrivado = "";

const destacar = (u: Usuario, body: any) =>
  request(app).post("/api/drive/destacados").set("Cookie", sesion(u)).send(body);
const listar = (u: Usuario) => request(app).get("/api/drive/destacados").set("Cookie", sesion(u));

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);

  ana = await crearUsuario("usuario");
  beto = await crearUsuario("usuario");
  jefa = await crearUsuario("admin");

  compania = await crearCarpeta("Drive de la compañía", "company", null, jefa.id);
  deLaEmpresa = await crearCarpeta("Videos de capacitación", "custom", compania, jefa.id);

  const usuarios = await crearCarpeta("Usuarios", "users_root", null, ana.id);
  miDriveDeAna = await crearCarpeta("Ana", "user", usuarios, ana.id, ana.id);
  privadaDeAna = await crearCarpeta("Divorcio", "custom", miDriveDeAna, ana.id);
  archivoPrivado = await crearArchivo(privadaDeAna, "sentencia.pdf", ana.id);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 A · el ámbito lo decide el servidor, no quien llama", () => {
  it("lo que vive bajo la compañía se destaca como `compania` y lo ve todo el equipo", async () => {
    const r = await destacar(ana, { folder_id: deLaEmpresa });
    expect(r.status).toBe(200);
    expect(r.body.destacado.ambito).toBe("compania");

    // Beto no lo destacó y ni siquiera es quien lo puso: lo ve igual.
    const suyo = await listar(beto);
    expect(suyo.body.compania.map((x: any) => x.nombre)).toContain("Videos de capacitación");
  });

  it("🔴 una carpeta PRIVADA se destaca como `personal` aunque se pida `compania`", async () => {
    // El caso que de verdad importa. Si el ámbito viniera del cuerpo, el nombre «Divorcio»
    // aparecería en la pantalla de las quince personas de la empresa.
    const r = await destacar(ana, { folder_id: privadaDeAna, ambito: "compania" });
    expect(r.status).toBe(200);
    expect(r.body.destacado.ambito).toBe("personal");

    const deBeto = await listar(beto);
    expect(JSON.stringify(deBeto.body)).not.toContain("Divorcio");
    const deJefa = await listar(jefa);
    expect(JSON.stringify(deJefa.body)).not.toContain("Divorcio");
  });

  it("los destacados personales de Ana son suyos y salen en su lista", async () => {
    const r = await listar(ana);
    expect(r.body.personales.map((x: any) => x.nombre)).toContain("Divorcio");
    expect(r.body.personales.every((x: any) => x.mia)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("B · una estrella por cosa", () => {
  it("destacar dos veces lo mismo no duplica ni da error: es un doble clic", async () => {
    const otra = await crearCarpeta("Plantillas", "custom", compania, jefa.id);
    const uno = await destacar(jefa, { folder_id: otra });
    const dos = await destacar(jefa, { folder_id: otra });
    expect(uno.status).toBe(200);
    expect(dos.status).toBe(200);
    expect(dos.body.ya_estaba).toBe(true);

    const n = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_destacados WHERE folder_id=$1", [otra]
    );
    expect(n[0].n).toBe(1);
  });

  it("🔴 en la compañía la estrella es GLOBAL: otra persona no puede poner una segunda", async () => {
    const otra = await crearCarpeta("Manual", "custom", compania, jefa.id);
    await destacar(jefa, { folder_id: otra });
    const deAna = await destacar(ana, { folder_id: otra });
    expect(deAna.status).toBe(200);
    const n = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_destacados WHERE folder_id=$1", [otra]
    );
    expect(n[0].n).toBe(1);              // una sola, la de quien llegó primero
  });

  it("en lo personal, cada uno tiene la suya sobre la misma cosa", async () => {
    // Dos personas pueden destacar la misma carpeta de una oportunidad sin pisarse.
    const abierta = await crearCarpeta("Caso compartido", "opportunity", null, jefa.id);
    await destacar(ana, { folder_id: abierta });
    await destacar(beto, { folder_id: abierta });
    const n = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_destacados WHERE folder_id=$1", [abierta]
    );
    expect(n[0].n).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("C · quitar la estrella", () => {
  it("la quita quien la puso", async () => {
    const otra = await crearCarpeta("Para quitar", "custom", compania, jefa.id);
    const puesta = await destacar(ana, { folder_id: otra });
    const id = puesta.body.destacado.id;

    const r = await request(app).delete(`/api/drive/destacados/${id}`).set("Cookie", sesion(ana));
    expect(r.status).toBe(200);
  });

  it("y un admin también, aunque no sea suya", async () => {
    const otra = await crearCarpeta("Para que la quite la jefa", "custom", compania, jefa.id);
    const puesta = await destacar(ana, { folder_id: otra });
    const r = await request(app).delete(`/api/drive/destacados/${puesta.body.destacado.id}`).set("Cookie", sesion(jefa));
    expect(r.status).toBe(200);
  });

  it("🔴 pero NO un compañero cualquiera", async () => {
    // «La quita quien la puso, y los admin.» Beto no es ninguna de las dos cosas.
    const otra = await crearCarpeta("De Ana", "custom", compania, jefa.id);
    const puesta = await destacar(ana, { folder_id: otra });
    const r = await request(app).delete(`/api/drive/destacados/${puesta.body.destacado.id}`).set("Cookie", sesion(beto));
    expect(r.status).toBe(403);

    const sigue = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_destacados WHERE id=$1", [puesta.body.destacado.id]
    );
    expect(sigue[0].n).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 D · no se destaca lo que no se puede ver", () => {
  it("Beto no puede destacar una carpeta del Mi Drive de Ana", async () => {
    // Destacar lo que no puedes ver metería su nombre en tu propia pantalla.
    const r = await destacar(beto, { folder_id: privadaDeAna });
    expect(r.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("E · lo que se fue a la papelera", () => {
  it("deja de listarse, aunque la estrella siga puesta", async () => {
    const temp = await crearCarpeta("Se borra", "custom", compania, jefa.id);
    await destacar(jefa, { folder_id: temp });
    expect(JSON.stringify((await listar(jefa)).body)).toContain("Se borra");

    await query("UPDATE gozz.drive_folders SET deleted_at = now() WHERE id = $1", [temp]);
    expect(JSON.stringify((await listar(jefa)).body)).not.toContain("Se borra");

    // La fila sigue: si el dueño la restaura, la estrella vuelve.
    const n = await query<any>("SELECT count(*)::int AS n FROM gozz.drive_destacados WHERE folder_id=$1", [temp]);
    expect(n[0].n).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("F · Recientes", () => {
  it("abrir un archivo lo anota, y volver a abrirlo NO lo duplica", async () => {
    const abierta = await crearCarpeta("Caso", "opportunity", null, jefa.id);
    const doc = await crearArchivo(abierta, "acta.pdf", jefa.id);

    await request(app).get(`/api/drive/files/${doc}/download`).set("Cookie", sesion(ana));
    await request(app).get(`/api/drive/files/${doc}/download`).set("Cookie", sesion(ana));

    const n = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_recientes WHERE user_id=$1 AND file_id=$2",
      [ana.id, doc]
    );
    expect(n[0].n).toBe(1);

    const r = await request(app).get("/api/drive/recientes").set("Cookie", sesion(ana));
    expect(r.status).toBe(200);
    expect(r.body.recientes.map((x: any) => x.nombre)).toContain("acta.pdf");
  });

  it("🔴 son POR PERSONA: a Beto no le aparece lo que abrió Ana", async () => {
    // «De manera que al usuario no le aparezcan movimientos de otros usuarios.»
    const r = await request(app).get("/api/drive/recientes").set("Cookie", sesion(beto));
    expect(r.body.recientes.map((x: any) => x.nombre)).not.toContain("acta.pdf");
  });

  it("🔴 NO se anota lo que no se pudo abrir", async () => {
    // Anotar un 403 dejaría en la pantalla de alguien el nombre de un archivo que no tiene
    // derecho a ver — que es exactamente lo contrario de lo que protege la ACL.
    const r = await request(app).get(`/api/drive/files/${archivoPrivado}/download`).set("Cookie", sesion(beto));
    expect(r.status).toBe(403);

    const n = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_recientes WHERE user_id=$1 AND file_id=$2",
      [beto.id, archivoPrivado]
    );
    expect(n[0].n).toBe(0);
  });

  it("🔴 la lista está acotada a 200 por persona", async () => {
    // Sin tope, esto se convierte en la tabla más grande del sistema. Se siembran 205 filas
    // directamente —abrir 205 archivos por HTTP no probaría nada más y tardaría— y se comprueba
    // que la poda del endpoint las deja en 200.
    const abierta = await crearCarpeta("Muchos", "opportunity", null, jefa.id);
    const ids: string[] = [];
    for (let i = 0; i < 205; i++) ids.push(await crearArchivo(abierta, `doc-${i}.pdf`, jefa.id));
    for (const id of ids) {
      await query(
        `INSERT INTO gozz.drive_recientes (user_id, file_id, visto_at)
         VALUES ($1, $2, now() - ($3 || ' minutes')::interval)`,
        [beto.id, id, String(ids.indexOf(id))]
      );
    }
    expect((await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_recientes WHERE user_id=$1", [beto.id]
    ))[0].n).toBe(205);

    // Una apertura más dispara la poda.
    const unoMas = await crearArchivo(abierta, "el-ultimo.pdf", jefa.id);
    await request(app).get(`/api/drive/files/${unoMas}/download`).set("Cookie", sesion(beto));

    const n = (await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_recientes WHERE user_id=$1", [beto.id]
    ))[0].n;
    expect(n).toBe(200);

    // Y el que se acaba de abrir es el que se queda, no el que se cae.
    const sigue = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_recientes WHERE user_id=$1 AND file_id=$2",
      [beto.id, unoMas]
    );
    expect(sigue[0].n).toBe(1);
  });
});
