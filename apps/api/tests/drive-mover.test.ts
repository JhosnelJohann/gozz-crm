// ============================================================================================
// T2 · MOVER ARCHIVOS A OTRA CARPETA — pruebas de ruta
//
// Lo que se protege aquí no es "que mover funcione": es que **mover no pierda ni pise nada**.
// Un movimiento que sale bien casi siempre es fácil; los tres casos que muerden son la colisión
// de nombre, el permiso del ORIGEN y que un rechazo no deje la selección repartida a medias.
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
  const email = `mover-${sufijo()}@pruebas.invalid`;
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

async function crearArchivo(folderId: string, nombre: string, subidoPor: string, borrado = false) {
  const r = await query<any>(
    `INSERT INTO gozz.drive_files (folder_id, nombre, mime, size_bytes, uploaded_by, deleted_at, ciclo)
     VALUES ($1,$2,'application/pdf',1024,$3,$4,$5) RETURNING id`,
    [folderId, nombre, subidoPor, borrado ? new Date().toISOString() : null, borrado ? "papelera" : "activo"]
  );
  return r[0].id as string;
}

const dondeEsta = async (fileId: string) => {
  const r = await query<any>("SELECT folder_id, nombre FROM gozz.drive_files WHERE id=$1", [fileId]);
  return r[0] as { folder_id: string; nombre: string };
};

let ana: Usuario;      // usuario raso, dueña de su Mi Drive
let jefa: Usuario;     // admin
let compania = "";     // todos leen, nadie raso escribe
let usuariosRoot = "";
let miDriveDeAna = "";
let carpetaA = "";     // dentro del Mi Drive de Ana
let carpetaB = "";     // idem

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);

  ana = await crearUsuario("usuario");
  jefa = await crearUsuario("admin");

  // 🔴 SIN RAÍZ. La base desechable es UNA para toda la suite y los ficheros corren en PARALELO;
  // varias consultas del backend resuelven la raíz con `WHERE tipo='root' … LIMIT 1`. Con dos
  // raíces sembradas por dos ficheros distintos, cuál gana depende del orden físico de las filas,
  // así que las pruebas de `drive-visibilidad.test.ts` pasan o fallan según el día. Pasó: este
  // fichero tenía una y la suite iba en verde por suerte hasta que dejó de irlo.
  //
  // Aquí no hace falta: `canAccessFolder` mira los TIPOS de la cadena de ancestros, y una carpeta
  // de compañía sin padre sigue siendo una carpeta de compañía.
  compania = await crearCarpeta("Drive de la compañía", "company", null, jefa.id);
  usuariosRoot = await crearCarpeta("Usuarios", "users_root", null, jefa.id);
  miDriveDeAna = await crearCarpeta("Ana", "user", usuariosRoot, ana.id, ana.id);
  carpetaA = await crearCarpeta("Origen", "custom", miDriveDeAna, ana.id);
  carpetaB = await crearCarpeta("Destino", "custom", miDriveDeAna, ana.id);
});

const mover = (u: Usuario, ids: string[], destino: string) =>
  request(app).post("/api/drive/files/mover").set("Cookie", sesion(u)).send({ ids, destino_folder_id: destino });

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("A · el caso que se pidió: marcar varios y moverlos", () => {
  it("mueve la selección entera de una carpeta a otra", async () => {
    const uno = await crearArchivo(carpetaA, `contrato-${sufijo()}.pdf`, ana.id);
    const dos = await crearArchivo(carpetaA, `pasaporte-${sufijo()}.pdf`, ana.id);

    const r = await mover(ana, [uno, dos], carpetaB);
    expect(r.status).toBe(200);
    expect(r.body.movidos).toBe(2);

    expect((await dondeEsta(uno)).folder_id).toBe(carpetaB);
    expect((await dondeEsta(dos)).folder_id).toBe(carpetaB);
  });

  it("los ids repetidos cuentan una vez, no dos", async () => {
    const uno = await crearArchivo(carpetaA, `repetido-${sufijo()}.pdf`, ana.id);
    const r = await mover(ana, [uno, uno, uno], carpetaB);
    expect(r.status).toBe(200);
    expect(r.body.movidos).toBe(1);
  });

  it("un archivo que YA está en el destino no es un error: no hay nada que hacer con él", async () => {
    const quieto = await crearArchivo(carpetaB, `quieto-${sufijo()}.pdf`, ana.id);
    const r = await mover(ana, [quieto], carpetaB);
    expect(r.status).toBe(200);
    expect(r.body.movidos).toBe(0);
    expect(r.body.ya_estaban).toBe(1);
    expect((await dondeEsta(quieto)).folder_id).toBe(carpetaB);
  });

  it("no toca lo que está en la papelera", async () => {
    // Restaurar es otro flujo, con su propio destino y sus reglas. Mover no lo suplanta.
    const enPapelera = await crearArchivo(carpetaA, `borrado-${sufijo()}.pdf`, ana.id, true);
    const r = await mover(ana, [enPapelera], carpetaB);
    expect(r.status).toBe(404);
    expect((await dondeEsta(enPapelera)).folder_id).toBe(carpetaA);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 B · la colisión de nombre, que es donde se pierde un archivo", () => {
  it("si el destino ya tiene ese nombre, el que llega se renombra con (N) y el de allí no se toca", async () => {
    // La identidad de un archivo en el Drive es POR NOMBRE dentro de su carpeta (mig. 0050). Si
    // el que llega se quedara con el nombre tal cual, habría dos «informe.pdf» en la misma
    // carpeta y ninguna forma de distinguirlos desde la pantalla.
    const nombre = `informe-${sufijo()}.pdf`;
    const elQueYaEstaba = await crearArchivo(carpetaB, nombre, ana.id);
    const elQueLlega = await crearArchivo(carpetaA, nombre, ana.id);

    const r = await mover(ana, [elQueLlega], carpetaB);
    expect(r.status).toBe(200);
    expect(r.body.renombrados).toBe(1);

    const llegado = await dondeEsta(elQueLlega);
    const original = await dondeEsta(elQueYaEstaba);
    expect(llegado.folder_id).toBe(carpetaB);
    expect(llegado.nombre).not.toBe(nombre);        // se apartó
    expect(llegado.nombre).toContain("(1)");
    expect(original.nombre).toBe(nombre);           // 🔴 el que ya estaba NO se tocó
  });

  it("mover dos archivos con el mismo nombre a la vez los aparta a los dos", async () => {
    // El contador se resuelve DENTRO de la transacción y archivo a archivo: si se calculara una
    // sola vez para el lote, el segundo pisaría al primero.
    const nombre = `duplicado-${sufijo()}.pdf`;
    const otraOrigen = await crearCarpeta("Otro origen", "custom", miDriveDeAna, ana.id);
    const a = await crearArchivo(carpetaA, nombre, ana.id);
    const b = await crearArchivo(otraOrigen, nombre, ana.id);

    const r = await mover(ana, [a, b], carpetaB);
    expect(r.status).toBe(200);
    expect(r.body.movidos).toBe(2);

    const na = (await dondeEsta(a)).nombre;
    const nb = (await dondeEsta(b)).nombre;
    expect(na).not.toBe(nb);                        // 🔴 dos archivos, dos nombres
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 C · los permisos, y que un rechazo no deje las cosas a medias", () => {
  it("no se puede mover HACIA donde no se puede escribir", async () => {
    // La carpeta de la compañía la lee todo el mundo y solo escribe un admin. Poder leer un sitio
    // no es poder dejar cosas en él.
    const suelto = await crearArchivo(carpetaA, `suelto-${sufijo()}.pdf`, ana.id);
    const r = await mover(ana, [suelto], compania);
    expect(r.status).toBe(403);
    expect((await dondeEsta(suelto)).folder_id).toBe(carpetaA);
  });

  it("🔴 tampoco DESDE donde no se puede escribir — sacar un archivo también modifica su carpeta", async () => {
    // El caso que se olvida: se mira el destino y se da por bueno el origen. Sacar un archivo de
    // la carpeta de la compañía la modifica igual que dejarlo allí.
    const deLaCompania = await crearArchivo(compania, `acta-${sufijo()}.pdf`, jefa.id);
    const r = await mover(ana, [deLaCompania], carpetaB);
    expect(r.status).toBe(403);
    expect((await dondeEsta(deLaCompania)).folder_id).toBe(compania);
  });

  it("🔴 si un solo archivo del lote no se puede mover, NO se mueve ninguno", async () => {
    // Un movimiento a medias deja la selección repartida entre dos carpetas y sin decir cuáles
    // pasaron. Es peor que un rechazo limpio: el usuario no sabe qué deshacer.
    const bueno = await crearArchivo(carpetaA, `bueno-${sufijo()}.pdf`, ana.id);
    const prohibido = await crearArchivo(compania, `prohibido-${sufijo()}.pdf`, jefa.id);

    const r = await mover(ana, [bueno, prohibido], carpetaB);
    expect(r.status).toBe(403);
    expect((await dondeEsta(bueno)).folder_id).toBe(carpetaA);        // el bueno tampoco se movió
    expect((await dondeEsta(prohibido)).folder_id).toBe(compania);
  });

  it("un admin sí puede mover dentro de la compañía", async () => {
    const otra = await crearCarpeta("Plantillas", "custom", compania, jefa.id);
    const doc = await crearArchivo(compania, `plantilla-${sufijo()}.pdf`, jefa.id);
    const r = await mover(jefa, [doc], otra);
    expect(r.status).toBe(200);
    expect((await dondeEsta(doc)).folder_id).toBe(otra);
  });

  it("🔴 ni un admin entra en el Mi Drive ajeno", async () => {
    // Es la invariante más fuerte de `canAccessFolder`, y mover no puede ser la puerta de atrás.
    const doc = await crearArchivo(compania, `intento-${sufijo()}.pdf`, jefa.id);
    const r = await mover(jefa, [doc], carpetaB);
    expect(r.status).toBe(403);
    expect((await dondeEsta(doc)).folder_id).toBe(compania);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("D · la bitácora es lo que hace que esto se pueda deshacer", () => {
  it("registra la carpeta de origen DE CADA archivo, no solo que hubo un movimiento", async () => {
    // Sin el origen por archivo, deshacer un movimiento sería adivinar por fecha — y arrastraría
    // lo que otra persona hubiera movido en ese mismo minuto.
    const uno = await crearArchivo(carpetaA, `bitacora-${sufijo()}.pdf`, ana.id);
    const r = await mover(ana, [uno], carpetaB);
    expect(r.status).toBe(200);

    const filas = await query<any>(
      `SELECT datos_antes, datos_despues FROM gozz.auditoria
        WHERE accion = 'drive_mover_archivos' AND user_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [ana.id]
    );
    expect(filas).toHaveLength(1);
    const antes = filas[0].datos_antes.archivos as any[];
    const suyo = antes.find((a) => a.id === uno);
    expect(suyo).toBeTruthy();
    expect(suyo.folder_id).toBe(carpetaA);                       // de dónde salió
    expect(filas[0].datos_despues.destino_folder_id).toBe(carpetaB);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("E · lo que se rechaza sin llegar a mirar la base", () => {
  it("sin archivos, con un destino que no es un uuid, o con demasiados", async () => {
    expect((await mover(ana, [], carpetaB)).status).toBe(400);
    expect((await mover(ana, ["no-soy-un-uuid"], carpetaB)).status).toBe(400);

    const r = await request(app)
      .post("/api/drive/files/mover")
      .set("Cookie", sesion(ana))
      .send({ ids: [carpetaA], destino_folder_id: "tampoco-soy-un-uuid" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("destino_invalido");

    const muchos = Array.from({ length: 201 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const rr = await mover(ana, muchos, carpetaB);
    expect(rr.status).toBe(400);
    expect(rr.body.maximo).toBe(200);
  });

  it("un destino que no existe da 404, no 500", async () => {
    const uno = await crearArchivo(carpetaA, `huerfano-${sufijo()}.pdf`, ana.id);
    const r = await mover(ana, [uno], "00000000-0000-4000-8000-000000000999");
    expect(r.status).toBe(404);
    expect((await dondeEsta(uno)).folder_id).toBe(carpetaA);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 F · enviar varios a la papelera", () => {
  const aPapelera = (u: Usuario, ids: string[]) =>
    request(app).post("/api/drive/files/papelera").set("Cookie", sesion(u)).send({ ids });

  const estado = async (id: string) => (await query<any>(
    "SELECT deleted_at, ciclo, deleted_by, origen_ref FROM gozz.drive_files WHERE id=$1", [id]
  ))[0];

  it("archiva la selección entera: NO borra, manda a papelera", async () => {
    // §0: nada se borra físicamente. Esto es archivado lógico y reversible.
    const uno = await crearArchivo(carpetaA, `pap-${sufijo()}.pdf`, ana.id);
    const dos = await crearArchivo(carpetaA, `pap-${sufijo()}.pdf`, ana.id);

    const r = await aPapelera(ana, [uno, dos]);
    expect(r.status).toBe(200);
    expect(r.body.enviados).toBe(2);

    for (const id of [uno, dos]) {
      const e = await estado(id);
      expect(e.deleted_at).not.toBeNull();
      expect(e.ciclo).toBe("papelera");
      expect(e.deleted_by).toBe(ana.id);
      // `origen_ref` es lo que permite restaurarlo donde estaba.
      expect(e.origen_ref).toBeTruthy();
    }
  });

  it("🔴 si uno del lote no se puede archivar, NO se archiva ninguno", async () => {
    const bueno = await crearArchivo(carpetaA, `bueno-pap-${sufijo()}.pdf`, ana.id);
    const prohibido = await crearArchivo(compania, `ajeno-pap-${sufijo()}.pdf`, jefa.id);

    const r = await aPapelera(ana, [bueno, prohibido]);
    expect(r.status).toBe(403);
    expect((await estado(bueno)).deleted_at).toBeNull();
    expect((await estado(prohibido)).deleted_at).toBeNull();
  });

  it("deja bitácora con la carpeta de origen de cada archivo", async () => {
    const uno = await crearArchivo(carpetaA, `bit-pap-${sufijo()}.pdf`, ana.id);
    await aPapelera(ana, [uno]);

    const filas = await query<any>(
      `SELECT datos_antes FROM gozz.auditoria
        WHERE accion = 'drive_archivar_archivos' AND user_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [ana.id]
    );
    const suyo = (filas[0].datos_antes.archivos as any[]).find((a) => a.id === uno);
    expect(suyo.folder_id).toBe(carpetaA);
  });

  it("lo que ya está en la papelera no cuenta, y sin ids se rechaza", async () => {
    const yaBorrado = await crearArchivo(carpetaA, `ya-${sufijo()}.pdf`, ana.id, true);
    expect((await aPapelera(ana, [yaBorrado])).status).toBe(404);
    expect((await aPapelera(ana, [])).status).toBe(400);
  });
});
