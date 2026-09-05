// ============================================================================================
// T1 · EL ESCONDITE DE LAS RAMAS DE CLIENTES — pruebas de ruta
//
// Lo que se protege aquí NO es "que no se vean cosas": es que **esconder al enumerar** y **quitar
// el permiso** sigan siendo dos cosas distintas. El día que alguien confunda las dos, el equipo se
// queda sin los documentos de sus clientes y las suites siguen en verde si nadie lo escribió.
//
// Por eso la prueba que más importa de este fichero es la del bloque D: un usuario raso pidiendo
// la carpeta de un contacto POR SU ID y recibiendo **200 con contenido**. Si esa se pone roja, el
// arreglo no es tocar la prueba (§9.4): es que el escondite se coló en `canAccessFolder`.
//
// 🔴 EL ÁRBOL SE SIEMBRA UNA SOLA VEZ, en `beforeAll`, y no por prueba. `hijosDelNodoContactos` y
// `visibleFolders` resuelven la raíz con `WHERE tipo='root' … LIMIT 1`: con dos raíces sembradas
// por dos pruebas distintas, cuál gana depende del orden físico de las filas. Sería el clásico
// verde que se vuelve rojo un martes.
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

const ID_NODO_CONTACTOS = "virtual:contactos";

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

type Usuario = { id: string; email: string; nivel: string };

async function crearUsuario(nivel: string): Promise<Usuario> {
  const email = `vis-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba',$2,true) RETURNING id`,
    [email, nivel]
  );
  return { id: r[0].id, email, nivel };
}

const sesion = (u: Usuario) => cookieDe({ sub: u.id, email: u.email, nivel: u.nivel });

async function crearCarpeta(
  nombre: string,
  tipo: string,
  parentId: string | null,
  creador: string
): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.drive_folders (nombre, tipo, parent_id, created_by)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [nombre, tipo, parentId, creador]
  );
  return r[0].id;
}

/** Los nombres de las carpetas que trae una respuesta, sea del árbol o del panel. */
const nombresDe = (filas: any[]): string[] => (filas ?? []).map((f: any) => f.nombre);

// El árbol de pruebas, con la MISMA forma que producción.
let jefe: Usuario;      // super_admin
let jefa: Usuario;      // admin  — no es super_admin, y esa es la gracia
let curra: Usuario;     // usuario raso
let raiz = "";
let compania = "";
let usuariosRoot = "";
let tramites = "";
let tramitesBitrix = "";
let fichaContacto = "";
let casoBajoTramites = "";
let archivoDelContacto = "";

const NOMBRE_CONTACTO = "Zenaida Melgarejo Prueba";

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);

  jefe = await crearUsuario("super_admin");
  jefa = await crearUsuario("admin");
  curra = await crearUsuario("usuario");

  raiz = await crearCarpeta("Drive del CRM", "root", null, jefe.id);
  compania = await crearCarpeta("Drive de la compañía", "company", raiz, jefe.id);
  usuariosRoot = await crearCarpeta("Usuarios", "users_root", raiz, jefe.id);
  tramites = await crearCarpeta("Trámites", "opportunities_root", raiz, jefe.id);
  tramitesBitrix = await crearCarpeta("Tramites Bitrix", "custom", raiz, jefe.id);

  // Contenido legítimo de la empresa: esto SÍ se ve, y es la mitad de la prueba.
  await crearCarpeta("ManhattanLife", "custom", compania, jefe.id);

  // La ficha de un contacto, que es lo que se esconde de la compañía.
  fichaContacto = await crearCarpeta(NOMBRE_CONTACTO, "contact", compania, jefe.id);
  casoBajoTramites = await crearCarpeta("Caso de prueba", "custom", tramites, jefe.id);

  // 🔴 LA GUARDA DE LA RAÍZ ÚNICA.
  //
  // Este es el único fichero de la suite que puede sembrar una carpeta `root`, porque es el único
  // que la necesita. Si otro la siembra, los ficheros corren en paralelo sobre la MISMA base y
  // `WHERE tipo='root' … LIMIT 1` empieza a devolver una u otra según el orden físico de las
  // filas: las pruebas de aquí se caen sin motivo aparente, o peor, pasan hasta que un día no.
  //
  // Ya ocurrió dos veces —`contacto-documentos` y `drive-mover`—, así que en vez de volver a
  // depurarlo desde cero, aquí queda dicho con todas las letras.
  const raices = await query<any>("SELECT count(*)::int AS n FROM gozz.drive_folders WHERE tipo='root'");
  expect(
    raices[0].n,
    "Hay más de una carpeta `root` en la base de pruebas. Otro fichero de la suite está sembrando " +
    "una, y este es el único que debe hacerlo: mira el comentario de esta guarda."
  ).toBe(1);

  const arch = await query<any>(
    `INSERT INTO gozz.drive_files (folder_id, nombre, mime, size_bytes, uploaded_by, sha256)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [fichaContacto, "pasaporte-sintetico.pdf", "application/pdf", 1024, jefe.id, "c".repeat(64)]
  );
  archivoDelContacto = arch[0].id;
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("A · la raíz del árbol deja de enseñar las ramas de clientes", () => {
  it("un usuario raso solo ve la compañía y los Mi Drive — y el JSON tampoco las trae", async () => {
    // 🔴 Se comprueba el CUERPO, no el código de estado. Un 200 que trae las carpetas escondidas
    // sigue mandando 269 nombres de clientes al navegador de cada empleado: filtrar al pintar no
    // es esconder nada.
    const r = await request(app).get("/api/drive/tree/path").set("Cookie", sesion(curra));
    expect(r.status).toBe(200);

    const hijos = nombresDe(r.body.preload?.[raiz]?.children);
    expect(hijos).toContain("Drive de la compañía");
    expect(hijos).toContain("Usuarios");
    expect(hijos).not.toContain("Trámites");
    expect(hijos).not.toContain("Tramites Bitrix");
    expect(JSON.stringify(r.body)).not.toContain("Tramites Bitrix");
  });

  it("🔴 un ADMIN tampoco las ve: la puerta es super_admin, no 'ser jefe'", async () => {
    // Que un admin las vea o no es UNA LÍNEA (`veRamasDeClientes`). Sin esta prueba, cambiarla por
    // descuido no rompería nada visible: los 6 admin del sistema volverían a tener el desorden y
    // nadie se enteraría hasta la siguiente reunión.
    const r = await request(app).get("/api/drive/tree/path").set("Cookie", sesion(jefa));
    expect(r.status).toBe(200);
    const hijos = nombresDe(r.body.preload?.[raiz]?.children);
    expect(hijos).not.toContain("Trámites");
    expect(hijos).not.toContain("Tramites Bitrix");
  });

  it("el super_admin no las ve sueltas: las ve reagrupadas bajo «Drive Contactos»", async () => {
    // No es que "vea más": es que ve LO MISMO en otro sitio. Si aquí apareciera además `Trámites`
    // suelto, las estaría viendo dos veces.
    const r = await request(app).get("/api/drive/tree/path").set("Cookie", sesion(jefe));
    expect(r.status).toBe(200);
    const hijos = r.body.preload?.[raiz]?.children ?? [];
    expect(nombresDe(hijos)).toContain("Drive Contactos");
    expect(nombresDe(hijos)).not.toContain("Trámites");
    expect(hijos.find((f: any) => f.id === ID_NODO_CONTACTOS)).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("B · el nodo virtual «Drive Contactos»", () => {
  it("reúne las ramas de la raíz y las fichas de contacto de la compañía", async () => {
    const r = await request(app)
      .get(`/api/drive/tree/children?parent_id=${encodeURIComponent(ID_NODO_CONTACTOS)}`)
      .set("Cookie", sesion(jefe));
    expect(r.status).toBe(200);
    const nombres = nombresDe(r.body.children);
    expect(nombres).toContain("Trámites");
    expect(nombres).toContain("Tramites Bitrix");
    expect(nombres).toContain(NOMBRE_CONTACTO);
    // Lo que NO es de clientes se queda fuera: la compañía y los Mi Drive siguen en la raíz.
    expect(nombres).not.toContain("Drive de la compañía");
    expect(nombres).not.toContain("Usuarios");
  });

  it("🔴 a quien no es super_admin le responde 403, no 404", async () => {
    // La diferencia importa: 404 diría "eso no existe" —y es verdad, no existe en la base— cuando
    // lo que pasa es "no es para ti". Se atiende antes de `canAccessFolder` justo por esto.
    const r = await request(app)
      .get(`/api/drive/tree/children?parent_id=${encodeURIComponent(ID_NODO_CONTACTOS)}`)
      .set("Cookie", sesion(curra));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain(NOMBRE_CONTACTO);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("C · «Drive de la compañía» deja de ser el cajón de los clientes", () => {
  it("no lista las fichas de contacto, pero sí lo que es de la empresa", async () => {
    const r = await request(app)
      .get(`/api/drive/tree/children?parent_id=${compania}`)
      .set("Cookie", sesion(curra));
    expect(r.status).toBe(200);
    expect(nombresDe(r.body.children)).toContain("ManhattanLife");
    expect(nombresDe(r.body.children)).not.toContain(NOMBRE_CONTACTO);
  });

  it("tampoco en el PANEL DE CONTENIDO, que es otro endpoint y se olvida fácil", async () => {
    // El árbol y el panel los sirven rutas distintas. Arreglar solo el árbol dejaría que pulsar la
    // carpeta soltara las 269 fichas de golpe — el desorden que se vino a quitar, intacto.
    const r = await request(app).get(`/api/drive/folders/${compania}`).set("Cookie", sesion(curra));
    expect(r.status).toBe(200);
    expect(nombresDe(r.body.children)).toContain("ManhattanLife");
    expect(nombresDe(r.body.children)).not.toContain(NOMBRE_CONTACTO);
  });

  it("y el BUSCADOR no devuelve lo que el árbol esconde", async () => {
    // Escondido en un sitio y saliendo en otro no se lee como una regla: se lee como una avería.
    const r = await request(app)
      .get(`/api/drive/search?scope=${raiz}&q=${encodeURIComponent("Zenaida")}`)
      .set("Cookie", sesion(curra));
    expect(r.status).toBe(200);
    expect(nombresDe(r.body.folders?.items)).not.toContain(NOMBRE_CONTACTO);
    expect(r.body.folders?.total ?? 0).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 D · esconder NO es quitar el permiso — la prueba que sostiene todo lo demás", () => {
  it("un usuario raso sigue abriendo la carpeta de un contacto por su id, con su contenido", async () => {
    // Es como llega la ficha del contacto a sus documentos: por id, nunca navegando el árbol.
    // Si esto se pone rojo, el escondite se metió en `canAccessFolder` y el equipo acaba de
    // perder el acceso a los expedientes de sus clientes. **No se toca la prueba: se revierte.**
    const r = await request(app).get(`/api/drive/folders/${fichaContacto}`).set("Cookie", sesion(curra));
    expect(r.status).toBe(200);
    const archivos = (r.body.files ?? []).map((f: any) => f.id);
    expect(archivos).toContain(archivoDelContacto);
  });

  it("y el árbol de una carpeta bajo «Trámites» no pierde su propio camino", async () => {
    // La pestaña Documentos de una negociación monta este mismo árbol y pide el path de una
    // carpeta que cuelga de `Trámites` — que es una rama escondida. Sin la lista de exentos, la
    // respuesta llegaría sin el eslabón por el que se preguntó y esa pantalla se quedaría sin
    // migas de pan. Este es el caso que justifica que exista `exentos`.
    const r = await request(app)
      .get(`/api/drive/tree/path?folder_id=${casoBajoTramites}`)
      .set("Cookie", sesion(curra));
    expect(r.status).toBe(200);
    expect(r.body.ancestors).toContain(tramites);
    expect(nombresDe(r.body.preload?.[raiz]?.children)).toContain("Trámites");
    expect(nombresDe(r.body.preload?.[tramites]?.children)).toContain("Caso de prueba");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 E · el ORDEN de las migas de pan", () => {
  it("van de la RAÍZ a la carpeta abierta, y no al revés", async () => {
    // Esto faltaba, y su ausencia costó dos defectos a la vez.
    //
    // El endpoint hacía `ancestors.slice().reverse()` sobre una cadena que YA venía de raíz a
    // carpeta, así que las migas se pintaban invertidas y el tramo marcado como «estás aquí» era
    // la raíz. Venía del snapshot inicial y se vio en staging el 2026-08-25.
    //
    // 🔴 Y arrastraba algo peor: `recortarMigas` (T3) busca la raíz del alcance y corta desde
    // ahí. Con la cadena invertida esa raíz caía en la posición 0, el recorte devolvía la cadena
    // ENTERA, y la pestaña Documentos de una negociación seguía ofreciendo el enlace a `Trámites`
    // que la T3 venía a quitar. La prueba unitaria de `recortarMigas` pasaba porque se le pasaba
    // el orden correcto a mano — probaba el contrato, no lo que la API mandaba de verdad.
    //
    // Por eso esta prueba mira la RESPUESTA, que es lo único que la pantalla ve.
    const r = await request(app).get(`/api/drive/folders/${casoBajoTramites}`).set("Cookie", sesion(jefe));
    expect(r.status).toBe(200);

    const cadena = r.body.breadcrumbs as any[];
    expect(cadena.length).toBeGreaterThanOrEqual(3);
    expect(cadena[0].id, "el primer tramo tiene que ser la raíz").toBe(raiz);
    expect(cadena[cadena.length - 1].id, "el último tramo es la carpeta abierta").toBe(casoBajoTramites);
    expect(cadena.map((b) => b.id)).toEqual([raiz, tramites, casoBajoTramites]);
  });

  it("en la raíz, la cadena es solo la raíz", async () => {
    const r = await request(app).get(`/api/drive/folders/${raiz}`).set("Cookie", sesion(jefe));
    expect(r.body.breadcrumbs.map((b: any) => b.id)).toEqual([raiz]);
  });
});
