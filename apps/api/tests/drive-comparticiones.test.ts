// ============================================================================================
// T5 · COMPARTIR — pruebas de ruta
//
// 🔴 ESTO ABRE LA REGLA MÁS DURA QUE TIENE EL DRIVE: «nadie accede al Mi Drive ajeno, ni admins».
// Todo este fichero existe para que esa apertura sea EXACTAMENTE del tamaño que se decidió y ni
// un milímetro más. Las tres que sostienen el resto:
//
//   · sin compartición, la puerta sigue cerrada — también para un admin;
//   · con `lector` se mira y NO se toca;
//   · un admin que no es el destinatario sigue fuera, aunque la carpeta esté compartida.
//
// Si alguna de esas se pone roja, no se ajusta la prueba: se revierte (§9.4).
//
// 🔴 Sin raíz sembrada, a propósito: la base desechable es una para toda la suite y varias
// consultas resuelven la raíz con `LIMIT 1`. Ver la cabecera de `contacto-documentos.test.ts`.
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

async function crearUsuario(nivel: string, nombre = "Persona de prueba"): Promise<Usuario> {
  const email = `comp-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash',$2,$3,true) RETURNING id`,
    [email, nombre, nivel]
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

// Ana comparte; Beto recibe; Carla no pinta nada; Dora es admin y tampoco.
let ana: Usuario, beto: Usuario, carla: Usuario, dora: Usuario;
let miDriveDeAna = "", carpetaDeAna = "", subDeAna = "", archivoDeAna = "";
let miDriveDeBeto = "", carpetaDeBeto = "";

const compartir = (u: Usuario, body: any) =>
  request(app).post("/api/drive/comparticiones").set("Cookie", sesion(u)).send(body);

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);

  ana = await crearUsuario("usuario", "Ana Comparte");
  beto = await crearUsuario("usuario", "Beto Recibe");
  carla = await crearUsuario("usuario", "Carla Ajena");
  dora = await crearUsuario("admin", "Dora Administra");

  const usuarios = await crearCarpeta("Usuarios", "users_root", null, ana.id);
  miDriveDeAna = await crearCarpeta("Ana", "user", usuarios, ana.id, ana.id);
  carpetaDeAna = await crearCarpeta("Contabilidad", "custom", miDriveDeAna, ana.id);
  subDeAna = await crearCarpeta("Facturas", "custom", carpetaDeAna, ana.id);
  archivoDeAna = await crearArchivo(carpetaDeAna, "balance.pdf", ana.id);

  miDriveDeBeto = await crearCarpeta("Beto", "user", usuarios, beto.id, beto.id);
  carpetaDeBeto = await crearCarpeta("Lo de Beto", "custom", miDriveDeBeto, beto.id);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 A · la puerta por defecto sigue cerrada", () => {
  it("sin compartición, nadie entra en el Mi Drive ajeno", async () => {
    const r = await request(app).get(`/api/drive/folders/${carpetaDeAna}`).set("Cookie", sesion(beto));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("forbidden_user_folder");
  });

  it("🔴 tampoco un ADMIN", async () => {
    // Es la invariante que este cambio NO puede haber tocado.
    const r = await request(app).get(`/api/drive/folders/${carpetaDeAna}`).set("Cookie", sesion(dora));
    expect(r.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("B · compartir una carpeta como LECTOR", () => {
  let idComparticion = "";

  it("Ana comparte con Beto y Beto la ve", async () => {
    const r = await compartir(ana, { folder_id: carpetaDeAna, compartido_con: beto.id, permiso: "lector" });
    expect(r.status).toBe(200);
    expect(r.body.comparticion.permiso).toBe("lector");
    idComparticion = r.body.comparticion.id;

    const vista = await request(app).get(`/api/drive/folders/${carpetaDeAna}`).set("Cookie", sesion(beto));
    expect(vista.status).toBe(200);
  });

  it("🔴 alcanza a las SUBCARPETAS, incluidas las que ya estaban dentro", async () => {
    // Compartir una carpeta comparte lo que hay dentro: es lo que espera cualquiera que haya
    // usado un Drive, y el motivo de que el permiso se busque por la CADENA de ancestros.
    const r = await request(app).get(`/api/drive/folders/${subDeAna}`).set("Cookie", sesion(beto));
    expect(r.status).toBe(200);
  });

  it("🔴 y a las que se creen DESPUÉS de compartir", async () => {
    const nueva = await crearCarpeta("Recién hecha", "custom", subDeAna, ana.id);
    const r = await request(app).get(`/api/drive/folders/${nueva}`).set("Cookie", sesion(beto));
    expect(r.status).toBe(200);
  });

  it("🔴 LECTOR mira pero NO toca: no puede borrar un archivo de ahí", async () => {
    const r = await request(app).delete(`/api/drive/files/${archivoDeAna}`).set("Cookie", sesion(beto));
    expect(r.status).toBe(403);
    // Un motivo propio: «no puedes entrar» y «puedes mirar pero no cambiar» no son lo mismo.
    expect(r.body.error).toBe("forbidden_solo_lectura");
    const sigue = await query<any>("SELECT deleted_at FROM gozz.drive_files WHERE id=$1", [archivoDeAna]);
    expect(sigue[0].deleted_at).toBeNull();
  });

  it("🔴 la compartición es NOMINAL: ni Carla ni la admin Dora entran por ella", async () => {
    // El caso que decidió Juan expresamente: «no, solamente el destinatario».
    for (const quien of [carla, dora]) {
      const r = await request(app).get(`/api/drive/folders/${carpetaDeAna}`).set("Cookie", sesion(quien));
      expect(r.status, quien.email).toBe(403);
    }
  });

  it("subir a editor es un UPDATE sobre la MISMA fila, no otra", async () => {
    // §2.8.1: corregir un permiso no puede pasar por retirarlo. Si fuera DELETE+INSERT, entre las
    // dos operaciones la persona se queda sin acceso, y si la segunda no llega, sin acceso del todo.
    const r = await request(app)
      .patch(`/api/drive/comparticiones/${idComparticion}`)
      .set("Cookie", sesion(ana)).send({ permiso: "editor" });
    expect(r.status).toBe(200);
    expect(r.body.comparticion.id).toBe(idComparticion);
    expect(r.body.comparticion.permiso).toBe("editor");

    const filas = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_comparticiones WHERE folder_id=$1 AND compartido_con=$2",
      [carpetaDeAna, beto.id]
    );
    expect(filas[0].n).toBe(1);
  });

  it("y ya como EDITOR sí puede borrar", async () => {
    const r = await request(app).delete(`/api/drive/files/${archivoDeAna}`).set("Cookie", sesion(beto));
    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("C · compartir un ARCHIVO suelto", () => {
  it("se ve el archivo compartido, y NO sus vecinos de carpeta", async () => {
    // El caso que la comprobación por carpeta no puede ver: la carpeta no está compartida.
    const carpeta = await crearCarpeta("Privada", "custom", miDriveDeAna, ana.id);
    const suelto = await crearArchivo(carpeta, "para-beto.pdf", ana.id);
    const vecino = await crearArchivo(carpeta, "no-para-beto.pdf", ana.id);

    const r = await compartir(ana, { file_id: suelto, compartido_con: beto.id, permiso: "lector" });
    expect(r.status).toBe(200);

    const mio = await request(app).get(`/api/drive/files/${suelto}/download`).set("Cookie", sesion(beto));
    expect(mio.status).not.toBe(403);

    const ajeno = await request(app).get(`/api/drive/files/${vecino}/download`).set("Cookie", sesion(beto));
    expect(ajeno.status).toBe(403);

    // Y la carpeta que lo contiene sigue cerrada: compartir un archivo no comparte su carpeta.
    const lista = await request(app).get(`/api/drive/folders/${carpeta}`).set("Cookie", sesion(beto));
    expect(lista.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 D · quién puede repartir accesos", () => {
  it("no se puede compartir lo que no es tuyo", async () => {
    const r = await compartir(beto, { folder_id: carpetaDeAna, compartido_con: carla.id, permiso: "lector" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("no_es_tuyo");
  });

  it("🔴 NI SIQUIERA UN ADMIN reparte accesos sobre el espacio de otra persona", async () => {
    // `esMiRama` no tiene atajo de admin, y esta prueba es la única que lo sostiene: cambiarlo por
    // `canEditFolder` —que sí lo tiene— no rompería nada más y lo abriría entero.
    const r = await compartir(dora, { folder_id: carpetaDeAna, compartido_con: carla.id, permiso: "editor" });
    expect(r.status).toBe(403);
  });

  it("tampoco cambiar ni revocar la compartición de otro", async () => {
    const suya = await compartir(beto, { folder_id: carpetaDeBeto, compartido_con: carla.id, permiso: "lector" });
    expect(suya.status).toBe(200);
    const id = suya.body.comparticion.id;

    const patch = await request(app).patch(`/api/drive/comparticiones/${id}`)
      .set("Cookie", sesion(ana)).send({ permiso: "editor" });
    expect(patch.status).toBe(403);

    const del = await request(app).delete(`/api/drive/comparticiones/${id}`).set("Cookie", sesion(dora));
    expect(del.status).toBe(403);

    const sigue = await query<any>("SELECT permiso FROM gozz.drive_comparticiones WHERE id=$1", [id]);
    expect(sigue[0].permiso).toBe("lector");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("E · lo que se rechaza", () => {
  it("🔴 un permiso que no está en la lista se RECHAZA, no se coacciona al más seguro", async () => {
    // §2.8.3. Guardarlo como «lector» dejaría a quien lo pidió creyendo que concedió la edición.
    const r = await compartir(ana, { folder_id: carpetaDeAna, compartido_con: carla.id, permiso: "editorr" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("permiso_invalido");
    // Acotado a ESTA carpeta: Carla tiene otras comparticiones de bloques anteriores, y contar
    // todas las suyas no probaria nada sobre este rechazo.
    const nada = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_comparticiones WHERE folder_id=$1 AND compartido_con=$2",
      [carpetaDeAna, carla.id]
    );
    expect(nada[0].n).toBe(0);
  });

  it("compartirse algo a uno mismo, sin objetivo, o con los dos a la vez", async () => {
    expect((await compartir(ana, { folder_id: carpetaDeAna, compartido_con: ana.id, permiso: "lector" })).status).toBe(400);
    expect((await compartir(ana, { compartido_con: beto.id, permiso: "lector" })).status).toBe(400);
    expect((await compartir(ana, { folder_id: carpetaDeAna, file_id: archivoDeAna, compartido_con: beto.id, permiso: "lector" })).status).toBe(400);
  });

  it("compartir dos veces lo mismo con la misma persona actualiza, no duplica", async () => {
    const otra = await crearCarpeta("Repetida", "custom", miDriveDeAna, ana.id);
    await compartir(ana, { folder_id: otra, compartido_con: beto.id, permiso: "lector" });
    const dos = await compartir(ana, { folder_id: otra, compartido_con: beto.id, permiso: "editor" });
    expect(dos.status).toBe(200);
    expect(dos.body.comparticion.permiso).toBe("editor");
    const n = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.drive_comparticiones WHERE folder_id=$1", [otra]
    );
    expect(n[0].n).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("F · «Compartidos conmigo»", () => {
  it("agrupa por quien comparte, y solo sale quien te ha dado algo", async () => {
    const r = await request(app).get("/api/drive/compartidos-conmigo").set("Cookie", sesion(beto));
    expect(r.status).toBe(200);
    const deAna = r.body.personas.find((p: any) => p.id === ana.id);
    expect(deAna).toBeTruthy();
    expect(deAna.items.length).toBeGreaterThan(0);
    // Carla no le ha compartido nada a Beto: no tiene por qué salir una carpeta suya vacía.
    expect(r.body.personas.find((p: any) => p.id === carla.id)).toBeUndefined();
  });

  it("a quien no le han compartido nada, la lista le sale vacía y no rota", async () => {
    const r = await request(app).get("/api/drive/compartidos-conmigo").set("Cookie", sesion(dora));
    expect(r.status).toBe(200);
    expect(r.body.personas).toEqual([]);
  });

  it("🔴 lo que el dueño manda a la papelera desaparece de la lista", async () => {
    const temp = await crearCarpeta("Se va a borrar", "custom", miDriveDeAna, ana.id);
    await compartir(ana, { folder_id: temp, compartido_con: beto.id, permiso: "lector" });

    const antes = await request(app).get("/api/drive/compartidos-conmigo").set("Cookie", sesion(beto));
    expect(JSON.stringify(antes.body)).toContain("Se va a borrar");

    await query("UPDATE gozz.drive_folders SET deleted_at = now() WHERE id = $1", [temp]);

    const despues = await request(app).get("/api/drive/compartidos-conmigo").set("Cookie", sesion(beto));
    // Enseñar una fila cuyo destino ya no está sería ofrecer un enlace roto. La compartición
    // sigue viva en la base: si el dueño lo restaura, vuelve.
    expect(JSON.stringify(despues.body)).not.toContain("Se va a borrar");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("G · el selector de personas", () => {
  it("pagina de 10 en 10, busca y nunca se ofrece a uno mismo", async () => {
    const r = await request(app).get("/api/drive/usuarios-para-compartir").set("Cookie", sesion(ana));
    expect(r.status).toBe(200);
    expect(r.body.pageSize).toBe(10);
    expect(r.body.usuarios.length).toBeLessThanOrEqual(10);
    expect(r.body.usuarios.find((x: any) => x.id === ana.id)).toBeUndefined();

    const buscando = await request(app)
      .get("/api/drive/usuarios-para-compartir?q=Beto%20Recibe").set("Cookie", sesion(ana));
    expect(buscando.body.usuarios.map((x: any) => x.id)).toContain(beto.id);
    expect(buscando.body.usuarios.find((x: any) => x.id === carla.id)).toBeUndefined();
  });
});
