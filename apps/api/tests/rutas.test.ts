// ============================================================================================
// PRUEBAS DE RUTA — las tres afirmaciones que hoy no protege nada automático
//
// Las otras 377 pruebas de esta suite ejercitan **funciones y SQL, nunca una ruta**. Eso deja sin
// cubrir justo lo más caro: la ACL y los códigos de estado. Los tres casos de aquí abajo se
// demostraron a mano con `curl` una vez, y el montaje se tiró — o sea que un refactor de rutas
// dentro de tres meses podría aflojar una ACL **con las dos suites en verde**.
//
// 🔴 SON UNAS POCAS AFIRMACIONES, NO COBERTURA. No se mide un porcentaje: se trata de que estas
// concretas dejen de depender de que alguien se acuerde de comprobarlas. Cada bloque se añadió con
// su entrega y su motivo; ampliar el alcance por ampliarlo es otra cosa. Y lo que este montaje NO
// cubre está escrito en `setup/app-de-pruebas.ts`.
//
// 🔴 NO HACE FALTA `sharp` NI `pdftoppm`. El archivo sembrado es un `.docx`, así que la ruta de la
// miniatura decide "no sé rasterizar esto" sin tocar un binario. La prueba sigue demostrando lo
// único que importa: que la diferencia entre los dos usuarios es la ACL y no el contenido.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

// Los mocks van ANTES de importar nada que arrastre estos módulos: `vi.mock` se eleva, pero
// dejarlos arriba y a la vista es lo que evita que alguien añada un import encima sin pensarlo.
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

async function crearUsuario(nivel = "usuario", activo = true): Promise<Usuario> {
  const email = `ruta-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba',$2,$3) RETURNING id`,
    [email, nivel, activo]
  );
  return { id: r[0].id, email, nivel };
}

const sesion = (u: Usuario) => cookieDe({ sub: u.id, email: u.email, nivel: u.nivel });

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 A · la miniatura NO es una puerta trasera al archivo", () => {
  it("un ADMIN ajeno recibe 403 sobre el drive personal de otra persona, y la dueña no", async () => {
    // Se apoya en la invariante más fuerte de `canAccessFolder`: «Universal: NADIE accede al drive
    // personal ajeno (ni admins)».
    //
    // 🔴 QUE BETO SEA ADMIN ES EL PUNTO DE LA PRUEBA. Un 403 a un usuario raso no distingue una
    // ACL bien puesta de una comprobación de rol perezosa: las dos darían 403. Que un ADMIN reciba
    // 403 solo puede explicarlo la regla de la carpeta personal, que es la que hay que proteger.
    const ana = await crearUsuario("usuario");
    const beto = await crearUsuario("admin");

    const [carpeta] = await query<any>(
      `INSERT INTO gozz.drive_folders (nombre, tipo, owner_user_id, created_by)
       VALUES ($1,'user',$2,$2) RETURNING id`,
      [`Drive de Ana ${sufijo()}`, ana.id]
    );
    const [archivo] = await query<any>(
      `INSERT INTO gozz.drive_files (folder_id, nombre, mime, size_bytes, uploaded_by, sha256)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [carpeta.id, "documento-sintetico.docx",
       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
       2048, ana.id, "b".repeat(64)]
    );

    const deBeto = await request(app).get(`/api/drive/files/${archivo.id}/thumb`).set("Cookie", sesion(beto));
    const deAna = await request(app).get(`/api/drive/files/${archivo.id}/thumb`).set("Cookie", sesion(ana));

    expect(deBeto.status, "un admin ajeno NO entra al drive personal de otra persona").toBe(403);
    expect(deBeto.body?.error).toBe("forbidden_user_folder");

    // Y la dueña NO recibe 403. Recibe 404 porque un .docx no se sabe rasterizar, y eso es
    // exactamente lo que hace la prueba independiente de `sharp` y de `pdftoppm`: lo que se
    // compara es el permiso, no el contenido.
    expect(deAna.status, "la dueña pasa la ACL; su 404 es por el tipo de archivo").toBe(404);
    expect(deAna.body?.error).toBe("tipo_no_soportado");
    expect(deAna.status).not.toBe(403);
  });

  it("sin sesión no se llega ni a la ACL", async () => {
    const r = await request(app).get(`/api/drive/files/00000000-0000-0000-0000-0000000000aa/thumb`);
    expect(r.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 B · los datos sensibles no se leen sin permiso", () => {
  it("una persona DADA DE BAJA con el token todavía válido recibe 403, y el cuerpo no trae ni un valor", async () => {
    // Quién cae aquí hoy: los tokens de este CRM duran 365 días y no se refrescan, así que a quien
    // se va se le pone `activo = false` pero su token sigue firmado y válido hasta un año. Esta
    // ruta consulta la BASE en cada petición justamente por eso. Si alguien la cambiara por una
    // comprobación contra el token, un ex-empleado leería credenciales USCIS durante meses.
    const baja = await crearUsuario("usuario", false);

    const [contacto] = await query<any>(
      `INSERT INTO gozz.contactos_cache
         (nombre_completo, ssn_encrypted, clave_uscis_enc, clave_correo_uscis_enc)
       VALUES ($1,'123-45-6789','ClaveUscisSecreta','ClaveCorreoSecreta') RETURNING id`,
      [`Cliente sintetico ${sufijo()}`]
    );

    const r = await request(app)
      .get(`/api/contactos/${contacto.id}/datos-sensibles`)
      .set("Cookie", sesion(baja));

    expect(r.status).toBe(403);

    // 🔴 SE MIRA EL CUERPO, NO SOLO EL CÓDIGO. Un 403 que traiga el dato en el JSON sigue siendo
    // una fuga: el navegador no lo pintaría, pero está en la respuesta, en los logs y en el
    // historial de red de quien la pidió.
    const serializada = JSON.stringify(r.body);
    for (const secreto of ["123-45-6789", "ClaveUscisSecreta", "ClaveCorreoSecreta"]) {
      expect(serializada, `se coló "${secreto}" en la respuesta`).not.toContain(secreto);
    }
    expect(r.body?.error, "y se le dice qué pasa, sin nombrar columnas").toContain("no está activa");

    // Tampoco puede quedar rastro de la lectura: no hubo lectura que anotar.
    const filas = await query<any>(
      `SELECT id FROM gozz.auditoria WHERE registro_id = $1 AND tabla_afectada = 'contactos_cache'`,
      [contacto.id]
    );
    expect(filas, "un rechazo no deja fila en la bitácora").toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 C · la fecha de nacimiento NO impide el alta, pero una fecha mal escrita sí", () => {
  // 🔴 CAMBIO DE CONDUCTA (2026-08-31). Hasta hoy esta prueba afirmaba lo contrario: que el alta
  // sin fecha daba 400. Se reescribe porque **cambió el contrato, por decisión de Juan** —el alta
  // rápida desde una oportunidad pedía la fecha en un formulario que no tenía el campo—, no
  // porque estorbara (§9.4). Lo que se conserva es lo que de verdad protegía: que la regla del
  // alta no se cuele en la edición, y que un dato mal escrito no entre callando.

  it("el alta SIN fecha da 200 y guarda el contacto sin fecha", async () => {
    const alguien = await crearUsuario("usuario");
    const nombre = `ZZ Contacto Sintetico Sin Fecha ${sufijo()}`;

    const alta = await request(app)
      .post("/api/contactos")
      .set("Cookie", sesion(alguien))
      // Email y teléfono SIGUEN siendo obligatorios (tanda C3): van puestos a propósito, para que
      // lo único en juego aquí sea la fecha.
      .send({ nombre_completo: nombre, email: "sin.fecha@pruebas.invalid", telefono: "+13055550100" });

    expect(alta.status, "🔴 si esto da 400, la fecha volvió a ser obligatoria").toBe(200);
    expect(alta.body?.contacto?.id, "y devuelve el contacto creado").toBeTruthy();

    const [fila] = await query<any>(
      `SELECT fecha_nacimiento FROM gozz.contactos_cache WHERE id = $1`, [alta.body.contacto.id]
    );
    expect(fila.fecha_nacimiento, "sin fecha es NULL, no una fecha inventada").toBeNull();
  });

  it("🔴 el alta con la fecha VACÍA tampoco falla — y no acaba en un 500 de Postgres", async () => {
    // Es lo que manda un formulario dejado en blanco. `""` contra una columna `date` es un error
    // 22007: sin la normalización, esto sería un 500 con el alta perdida.
    const alguien = await crearUsuario("usuario");
    const nombre = `ZZ Contacto Fecha Vacia ${sufijo()}`;

    const alta = await request(app)
      .post("/api/contactos")
      .set("Cookie", sesion(alguien))
      .send({ nombre_completo: nombre, email: "vacia@pruebas.invalid", telefono: "+13055550101", fecha_nacimiento: "" });

    expect(alta.status, "ni 500 ni 400: la cadena vacía es «no hay fecha»").toBe(200);
    const [fila] = await query<any>(
      `SELECT fecha_nacimiento FROM gozz.contactos_cache WHERE id = $1`, [alta.body.contacto.id]
    );
    expect(fila.fecha_nacimiento).toBeNull();
  });

  it("una fecha IMPOSIBLE se rechaza con 400, y no deja fila", async () => {
    const alguien = await crearUsuario("usuario");
    const nombre = `ZZ Contacto Fecha Imposible ${sufijo()}`;

    const alta = await request(app)
      .post("/api/contactos")
      .set("Cookie", sesion(alguien))
      // El 31 de febrero no lo rechaza JavaScript: se desborda al 3 de marzo. Sin la comprobación,
      // entraría en la base convertido en otro día y nadie lo sabría.
      .send({ nombre_completo: nombre, email: "imposible@pruebas.invalid", telefono: "+13055550102", fecha_nacimiento: "1990-02-31" });

    expect(alta.status, "ni 500 ni 200: un 400 con motivo").toBe(400);
    expect(typeof alta.body?.error, "el mensaje es una frase, no la lista de zod").toBe("string");
    // §4.7: el texto de cara al usuario no nombra la columna ni la tabla.
    expect(alta.body.error).not.toContain("fecha_nacimiento");
    expect(alta.body.error).not.toContain("contactos_cache");
    expect(alta.body.error).toContain("fecha de nacimiento");

    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.contactos_cache WHERE nombre_completo = $1`, [nombre]
    );
    expect(n, "un alta rechazada no deja fila").toBe(0);
  });

  it("🔴 editar un contacto que no tiene fecha sigue dando 200, y vaciarla también", async () => {
    // La ASIMETRÍA es lo que hay que garantizar: si alguien endurece el esquema compartido, deja
    // sin poder guardar a los 3.704 contactos vivos sin fecha — el 97,2 % de la cartera.
    const alguien = await crearUsuario("usuario");

    const [viejo] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, telefono)
       VALUES ($1,'+13055550100') RETURNING id, fecha_nacimiento`,
      [`ZZ Contacto Antiguo ${sufijo()}`]
    );
    expect(viejo.fecha_nacimiento, "la premisa: nace sin fecha").toBeNull();

    const edicion = await request(app)
      .patch(`/api/contactos/${viejo.id}`)
      .set("Cookie", sesion(alguien))
      .send({ telefono: "+13055550200" });

    expect(edicion.status, "🔴 si esto da 400, la regla del alta se coló en la edición").toBe(200);

    const [despues] = await query<any>(
      `SELECT telefono, fecha_nacimiento FROM gozz.contactos_cache WHERE id = $1`, [viejo.id]
    );
    expect(despues.telefono, "el cambio entró").toBe("+13055550200");
    expect(despues.fecha_nacimiento, "y no se le inventó una fecha por el camino").toBeNull();

    // ── y el defecto que destapaba esta entrega: BORRAR la fecha de una ficha que la tenía ──
    // `DateField` escribe `""` al vaciarse y la ficha manda el formulario entero, así que esto es
    // literalmente lo que viaja. Sin la normalización, Postgres devuelve 22007 y sale un 500.
    const [conFecha] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, fecha_nacimiento)
       VALUES ($1,'1980-03-12') RETURNING id`,
      [`ZZ Contacto Con Fecha ${sufijo()}`]
    );

    const vaciado = await request(app)
      .patch(`/api/contactos/${conFecha.id}`)
      .set("Cookie", sesion(alguien))
      .send({ fecha_nacimiento: "" });

    expect(vaciado.status, "🔴 vaciar la fecha no puede ser un 500").toBe(200);
    const [tras] = await query<any>(
      `SELECT fecha_nacimiento FROM gozz.contactos_cache WHERE id = $1`, [conFecha.id]
    );
    expect(tras.fecha_nacimiento, "la fecha se borró de verdad").toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 D · el agente de seguro que no vale se RECHAZA, no se guarda como «sin agente»", () => {
  // El campo existe para SEGMENTAR la cartera por agente. Por eso un id que no vale no se puede
  // coaccionar a NULL (§2.8.3): saldría del CRM como "contacto sin agente" y quien lo puso creería
  // que segmentó. El error no aparecería al guardar — aparecería meses después, cuando una campaña
  // deje fuera a gente que sí tenía agente y nadie sepa por qué falta.

  /** Un contacto con seguro, que es la premisa para que el campo tenga sentido. */
  async function contactoConSeguro(): Promise<string> {
    const [c] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, tiene_seguro_salud)
       VALUES ($1, true) RETURNING id`,
      [`ZZ Contacto con seguro ${sufijo()}`]
    );
    return c.id;
  }

  it("🔴 un agente que NO EXISTE devuelve 400, y no escribe nada", async () => {
    const quien = await crearUsuario("usuario");
    const contacto = await contactoConSeguro();

    const r = await request(app)
      .patch(`/api/contactos/${contacto}`)
      .set("Cookie", sesion(quien))
      .send({ agente_seguro_id: "00000000-0000-0000-0000-0000000000ee" });

    expect(r.status, "ni 200 con el campo a null, ni 500").toBe(400);
    expect(typeof r.body?.error).toBe("string");
    // §4.7: el mensaje no nombra la columna ni enseña el uuid que se intentó meter.
    expect(r.body.error).not.toContain("agente_seguro_id");
    expect(r.body.error).not.toContain("00000000");

    const [despues] = await query<any>(
      `SELECT agente_seguro_id, agente_seguro_otro FROM gozz.contactos_cache WHERE id = $1`, [contacto]
    );
    expect(despues.agente_seguro_id, "un rechazo no deja rastro").toBeNull();
    expect(despues.agente_seguro_otro).toBeNull();
  });

  it("🔴 un usuario INACTIVO también devuelve 400 — es el caso que «existe» no atrapa", async () => {
    // En la base real hay un `Julio Laya` INACTIVO con el mismo apellido que una de las dos
    // agentes. Una comprobación de existencia a secas lo aceptaría, y el contacto quedaría
    // segmentado bajo alguien que ya no trabaja aquí. Por eso se mira `activo`, y por eso en toda
    // esta funcionalidad no se busca a nadie por apellido.
    const quien = await crearUsuario("usuario");
    const baja = await crearUsuario("usuario", false);
    const contacto = await contactoConSeguro();

    const r = await request(app)
      .patch(`/api/contactos/${contacto}`)
      .set("Cookie", sesion(quien))
      .send({ agente_seguro_id: baja.id });

    expect(r.status).toBe(400);

    const [despues] = await query<any>(
      `SELECT agente_seguro_id FROM gozz.contactos_cache WHERE id = $1`, [contacto]
    );
    expect(despues.agente_seguro_id).toBeNull();
  });

  it("un agente ACTIVO sí se guarda, para que los dos 400 de arriba signifiquen algo", async () => {
    const quien = await crearUsuario("usuario");
    const agente = await crearUsuario("admin");
    const contacto = await contactoConSeguro();

    const r = await request(app)
      .patch(`/api/contactos/${contacto}`)
      .set("Cookie", sesion(quien))
      .send({ agente_seguro_id: agente.id });

    expect(r.status).toBe(200);
    const [despues] = await query<any>(
      `SELECT agente_seguro_id, agente_seguro_otro FROM gozz.contactos_cache WHERE id = $1`, [contacto]
    );
    expect(despues.agente_seguro_id).toBe(agente.id);
    expect(despues.agente_seguro_otro, "elegir persona limpia el texto").toBeNull();
  });

  it("«Otro» guarda el texto y deja el uuid en NULL", async () => {
    const quien = await crearUsuario("usuario");
    const contacto = await contactoConSeguro();

    const r = await request(app)
      .patch(`/api/contactos/${contacto}`)
      .set("Cookie", sesion(quien))
      .send({ agente_seguro_id: null, agente_seguro_otro: "Agencia de fuera" });

    expect(r.status).toBe(200);
    const [despues] = await query<any>(
      `SELECT agente_seguro_id, agente_seguro_otro FROM gozz.contactos_cache WHERE id = $1`, [contacto]
    );
    expect(despues.agente_seguro_otro).toBe("Agencia de fuera");
    expect(despues.agente_seguro_id).toBeNull();
  });

  it("🔴 marcar que NO tiene seguro limpia LAS DOS columnas", async () => {
    const quien = await crearUsuario("usuario");
    const agente = await crearUsuario("admin");
    const contacto = await contactoConSeguro();

    await request(app).patch(`/api/contactos/${contacto}`).set("Cookie", sesion(quien))
      .send({ agente_seguro_id: agente.id });
    const [antes] = await query<any>(`SELECT agente_seguro_id FROM gozz.contactos_cache WHERE id = $1`, [contacto]);
    expect(antes.agente_seguro_id, "la premisa: tenía agente").toBe(agente.id);

    const r = await request(app).patch(`/api/contactos/${contacto}`).set("Cookie", sesion(quien))
      .send({ tiene_seguro_salud: false });
    expect(r.status).toBe(200);

    const [despues] = await query<any>(
      `SELECT tiene_seguro_salud, agente_seguro_id, agente_seguro_otro FROM gozz.contactos_cache WHERE id = $1`, [contacto]
    );
    expect(despues.tiene_seguro_salud).toBe(false);
    expect(despues.agente_seguro_id, "sin seguro no puede quedar agente").toBeNull();
    expect(despues.agente_seguro_otro).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 E · el nombre se RECOMPONE desde las partes, y nunca se borra por accidente", () => {
  // El encabezado de la ficha dejó de ser un `<input>` sobre `nombre_completo` y pasó a ser una
  // etiqueta compuesta. Para que eso funcione, la pantalla **dejó de mandar `nombre_completo`** y
  // el servidor lo recalcula desde las partes.
  //
  // 🔴 Ese camino ya existía en `buildNombreCompleto` pero era INALCANZABLE: la ficha siempre
  // mandaba `nombre_completo`, y esa función devuelve lo que recibe si se lo mandan. Al dejar de
  // mandarlo pasa a ser el camino vivo, así que entra aquí — con su salvaguarda, que es lo único
  // que separa esto de borrarle el nombre a 33 contactos.

  it("editar las partes recompone `nombre_completo` solo", async () => {
    const quien = await crearUsuario("usuario");
    const [c] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, nombre, apellido)
       VALUES ('Ana Perez','Ana','Perez') RETURNING id`
    );

    const r = await request(app).patch(`/api/contactos/${c.id}`).set("Cookie", sesion(quien))
      .send({ nombre: "Ana", segundo_nombre: "Maria", apellido: "Perez Ruiz" });
    expect(r.status).toBe(200);

    const [d] = await query<any>(`SELECT nombre_completo FROM gozz.contactos_cache WHERE id = $1`, [c.id]);
    expect(d.nombre_completo).toBe("Ana Maria Perez Ruiz");
  });

  it("🔴 vaciar LAS TRES partes NO deja al contacto sin nombre", async () => {
    // Es el caso de los 33 contactos cuyo único nombre vive en `nombre_completo` porque entró
    // entero desde Pipedrive/Zoho/Bitrix y nadie lo repartió nunca. Recalcular a ciegas ahí
    // escribiría una cadena vacía y les borraría el nombre — sin error, sin aviso y sin vuelta.
    const quien = await crearUsuario("usuario");
    const [c] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, nombre, apellido)
       VALUES ('Juan Antonio Tercero Lopez','Juan','Lopez') RETURNING id`
    );

    const r = await request(app).patch(`/api/contactos/${c.id}`).set("Cookie", sesion(quien))
      .send({ nombre: "", segundo_nombre: "", apellido: "" });
    expect(r.status).toBe(200);

    const [d] = await query<any>(`SELECT nombre_completo FROM gozz.contactos_cache WHERE id = $1`, [c.id]);
    expect(d.nombre_completo, "el nombre guardado sigue ahí").toBe("Juan Antonio Tercero Lopez");
  });

  it("un contacto SIN partes conserva su nombre al editar cualquier otra cosa", async () => {
    // La ficha manda el formulario entero en cada guardado, así que los tres campos viajan vacíos
    // aunque quien edita solo tocara el teléfono. Si eso recalculara, bastaría con guardar una vez
    // para perder el nombre.
    const quien = await crearUsuario("usuario");
    const [c] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo) VALUES ('Juan Antonio Tercero Lopez') RETURNING id`
    );

    await request(app).patch(`/api/contactos/${c.id}`).set("Cookie", sesion(quien))
      .send({ telefono: "+13055550111", nombre: null, segundo_nombre: null, apellido: null });

    const [d] = await query<any>(
      `SELECT nombre_completo, telefono FROM gozz.contactos_cache WHERE id = $1`, [c.id]);
    expect(d.telefono).toBe("+13055550111");
    expect(d.nombre_completo).toBe("Juan Antonio Tercero Lopez");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 F · email y teléfono se exigen al CREAR, y la edición sigue sin exigirlos", () => {
  // Misma asimetría que la fecha de nacimiento, y por el mismo motivo medido: de 3.811 contactos
  // vivos, **670 no tienen email**. Endurecer `ContactoFullSchema` —que comparten POST y PATCH—
  // dejaría sin poder guardar a cualquiera que abriese una de esas fichas a cambiar un teléfono.

  const alta = (extra: Record<string, unknown> = {}) => ({
    nombre_completo: "ZZ Contacto Sintetico",
    fecha_nacimiento: "1980-03-12",
    email: "zz-sintetico@pruebas.invalid",
    telefono: "+13055550100",
    ...extra,
  });

  it("🔴 sin email da 400, y no crea nada", async () => {
    const quien = await crearUsuario("usuario");
    const r = await request(app).post("/api/contactos").set("Cookie", sesion(quien))
      .send(alta({ email: undefined }));

    expect(r.status).toBe(400);
    expect(typeof r.body?.error).toBe("string");
    expect(r.body.error, "§4.7: no nombra la columna").not.toContain("email:");
    expect(r.body.error.toLowerCase()).toContain("email");

    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.contactos_cache WHERE nombre_completo = $1`, ["ZZ Contacto Sintetico"]);
    expect(n).toBe(0);
  });

  it("🔴 sin teléfono da 400", async () => {
    const quien = await crearUsuario("usuario");
    const r = await request(app).post("/api/contactos").set("Cookie", sesion(quien))
      .send(alta({ telefono: "   " }));
    expect(r.status).toBe(400);
    expect(r.body.error.toLowerCase()).toContain("teléfono");
  });

  it("un email con forma imposible también da 400", async () => {
    const quien = await crearUsuario("usuario");
    for (const malo of ["no-es-un-email", "sin@punto", "@sinlocal.com", "espacios @ mal.com"]) {
      const r = await request(app).post("/api/contactos").set("Cookie", sesion(quien))
        .send(alta({ email: malo }));
      expect(r.status, malo).toBe(400);
    }
  });

  it("⚠️ WhatsApp SIGUE opcional: con los tres obligatorios y sin él, se crea", async () => {
    // Decisión de Juan: no todo el mundo lo usa, y exigirlo obligaría a inventárselo.
    const quien = await crearUsuario("usuario");
    const r = await request(app).post("/api/contactos").set("Cookie", sesion(quien))
      .send(alta({ nombre_completo: `ZZ Con WhatsApp vacio ${sufijo()}` }));
    expect(r.status).toBe(200);
  });

  it("🔴 EDITAR un contacto que NO tiene email sigue dando 200 — protege a 670 fichas", async () => {
    const quien = await crearUsuario("usuario");
    const [viejo] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, telefono) VALUES ($1,'+13055550101')
       RETURNING id, email`, [`ZZ Sin email ${sufijo()}`]);
    expect(viejo.email, "la premisa: nace sin email").toBeNull();

    const r = await request(app).patch(`/api/contactos/${viejo.id}`).set("Cookie", sesion(quien))
      .send({ telefono: "+13055550202" });

    expect(r.status, "🔴 si esto da 400, la regla del alta se coló en la edición").toBe(200);
    const [d] = await query<any>(`SELECT telefono, email FROM gozz.contactos_cache WHERE id = $1`, [viejo.id]);
    expect(d.telefono).toBe("+13055550202");
    expect(d.email, "y no se le inventó un email").toBeNull();
  });

  it("🔴 la respuesta trae el correo bajo la clave `email`, venga de donde venga", async () => {
    // Es el arreglo entero de la tanda: había DOS columnas y cada pantalla leía una, así que un
    // contacto con solo `correo_personal` salía sin email en el listado. El servidor resuelve
    // ahora en un solo sitio y el frontend lee una sola clave.
    const quien = await crearUsuario("usuario");
    const [c] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, correo_personal)
       VALUES ($1,'solo-el-viejo@pruebas.invalid') RETURNING id`, [`ZZ Solo correo viejo ${sufijo()}`]);

    const r = await request(app).get(`/api/contactos/${c.id}`).set("Cookie", sesion(quien));
    expect(r.status).toBe(200);
    expect(r.body?.contacto?.email, "durante la ventana de despliegue, el COALESCE lo rescata")
      .toBe("solo-el-viejo@pruebas.invalid");
    expect(r.body?.contacto, "y `correo_personal` ya no viaja a la pantalla")
      .not.toHaveProperty("correo_personal");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 G · los agentes que la ficha ofrece salen del servidor, no del código del navegador", () => {
  // 🔴 EL MOTIVO NO ES DE ESTILO. Staging y producción son **bases distintas**: las mismas dos
  // personas tienen un `id` diferente en cada una. Un uuid escrito en el frontend funcionaría en un
  // entorno y en el otro no encontraría a nadie — en silencio, guardando "sin agente" mientras
  // quien lo puso cree que segmentó. El servidor los resuelve por email, que sí es estable.

  it("sin sesión, 401: la lista del equipo no es pública", async () => {
    const r = await request(app).get("/api/contactos/agentes-seguro");
    expect(r.status).toBe(401);
  });

  it("devuelve SOLO a los agentes, con su id de ESTE entorno y su nombre de la base", async () => {
    const quien = await crearUsuario("usuario");

    // Ruido: gente del equipo que NO es agente. Antes la ficha los ofrecía a todos.
    const ruido1 = await crearUsuario("usuario");
    const ruido2 = await crearUsuario("admin");

    // ⚠️ `ON CONFLICT` porque el email es UNICO y `contactos-agente-seguro.test.ts` siembra el
    // mismo: los dos ficheros comparten la base desechable (`fileParallelism: false`), asi que la
    // siembra tiene que dar igual quien corra primero.
    const [jhosnel] = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ('jhosnel.laya@gmail.com','no-es-un-hash','Jhosnel Laya','admin',true)
       ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true RETURNING id`
    );

    const r = await request(app).get("/api/contactos/agentes-seguro").set("Cookie", sesion(quien));
    expect(r.status).toBe(200);
    // Por pertenencia y no por igualdad exacta: la lista depende de si existe el OTRO agente, que
    // otro fichero de la suite puede haber sembrado. Lo que esta prueba afirma es que la agente SALE
    // y que el resto del equipo NO, que es lo que cambio en esta tanda.
    expect(r.body.agentes).toContainEqual({ id: jhosnel.id, nombre: "Jhosnel Laya" });
    for (const intruso of [ruido1.id, ruido2.id]) {
      expect(r.body.agentes.map((a: any) => a.id), "nadie mas del equipo").not.toContain(intruso);
    }

    // Y el id que devuelve es el de ESTA base — que es justo lo que un uuid en el frontend no
    // podría saber.
    expect(r.body.agentes[0].id).toBe(jhosnel.id);
  });

  it("🔴 un agente dado de baja deja de ofrecerse, y no queda una opción muerta", async () => {
    const quien = await crearUsuario("usuario");
    const [u] = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ('alessandro.garagozzo@gozz-agencia.com','no-es-un-hash','Alessandro Garagozzo','super_admin',false)
       ON CONFLICT (email) DO UPDATE SET activo = false RETURNING id`
    );
    const r = await request(app).get("/api/contactos/agentes-seguro").set("Cookie", sesion(quien));
    expect(r.body.agentes.map((a: any) => a.id)).not.toContain(u.id);
  });

  it("⚠️ acotar la LISTA no acota lo que el servidor ACEPTA", async () => {
    // Son cosas distintas: restringir las opciones es una decisión de interfaz; rechazar un valor
    // imposible es de integridad. En staging ya hay un contacto guardado con un agente, y
    // estrechar la validación lo dejaría sin poder guardarse.
    const quien = await crearUsuario("usuario");
    const otro = await crearUsuario("usuario");   // activo, pero NO es agente
    const [c] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, tiene_seguro_salud)
       VALUES ($1, true) RETURNING id`, [`ZZ Con seguro ${sufijo()}`]
    );

    const r = await request(app).patch(`/api/contactos/${c.id}`).set("Cookie", sesion(quien))
      .send({ agente_seguro_id: otro.id });
    expect(r.status, "sigue aceptando a cualquier usuario activo").toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 H · al retomar una tarea, `fecha_completada` NO se queda pegada", () => {
  // Hasta ahora `fecha_completada` solo se ESCRIBÍA: `PATCH` ponía `NOW()` al completar y nadie la
  // borraba nunca. Daba igual, porque no había forma de sacar una tarea de «completada» desde el
  // tablero. Ahora sí la hay —una completada o una cancelada se retoman arrastrándolas a una
  // columna de fecha— y sin limpiarla quedaría una tarea PENDIENTE CON FECHA DE COMPLETADA.
  //
  // 🔴 ESTO NO SE VE POR LA PANTALLA, y es la razón de que la prueba sea de ruta y mire la BASE.
  // El orden del listado solo consulta esa columna cuando el estado es «completada»; pero
  // `reportes-routes.ts` cuenta `completadas_hoy / _semana / _mes` filtrando **solo** por
  // `fecha_completada`, sin mirar el estado. Un dato que miente en un informe no lo caza nadie.

  const leer = async (id: string) =>
    (await query<any>(
      "SELECT estado, fecha_completada, fecha_limite, titulo FROM gozz.tareas WHERE id = $1", [id]
    ))[0];

  async function sembrarTarea(dueno: Usuario, estado = "pendiente") {
    const [t] = await query<any>(
      `INSERT INTO gozz.tareas (titulo, estado, propietario_id, responsable_id, fecha_limite)
       VALUES ($1, $2, $3, $3, NOW() + interval '2 days') RETURNING id`,
      [`Tarea de prueba ${sufijo()}`, estado, dueno.id]
    );
    return t.id as string;
  }

  it("🔴 completar y volver a abrir deja la fecha de completado en NULL", async () => {
    const ana = await crearUsuario("usuario");
    const id = await sembrarTarea(ana);

    // 1 · Completar. Aquí es donde se escribe `fecha_completada = NOW()`.
    const completar = await request(app)
      .patch(`/api/tareas/${id}`)
      .set("Cookie", sesion(ana))
      .send({ estado: "completada" });
    expect(completar.status).toBe(200);

    const completada = await leer(id);
    expect(completada.estado).toBe("completada");
    expect(completada.fecha_completada, "sin esto la prueba no demuestra nada").not.toBeNull();

    // 2 · Retomarla. LOS DOS CAMPOS EN UNA SOLA PETICIÓN — es lo que manda el tablero al soltar
    // una completada en una columna de fecha. Encadenar dos dejaría la tarea reabierta sin plazo,
    // o con plazo y todavía completada, si la segunda fallara.
    const nuevoPlazo = new Date(Date.now() + 5 * 86400000).toISOString();
    const reabrir = await request(app)
      .patch(`/api/tareas/${id}`)
      .set("Cookie", sesion(ana))
      .send({ estado: "pendiente", fecha_limite: nuevoPlazo });
    expect(reabrir.status).toBe(200);

    const reabierta = await leer(id);
    expect(reabierta.estado).toBe("pendiente");
    expect(reabierta.fecha_completada, "🔴 se quedó pegada").toBeNull();
    expect(new Date(reabierta.fecha_limite).toISOString(), "y el plazo nuevo se guardó").toBe(nuevoPlazo);
  });

  it("🔴 y por eso el informe deja de contarla como completada", async () => {
    // El predicado exacto de `reportes-routes.ts` (`completadas_hoy / _semana / _mes`). Es el que
    // NO mira el estado, así que es el único que notaría la diferencia. Con la fecha pegada
    // contaría 1, y contradiría al contador `completadas` de esa misma respuesta, que sí va por
    // estado.
    const ana = await crearUsuario("usuario");
    const id = await sembrarTarea(ana);

    await request(app).patch(`/api/tareas/${id}`).set("Cookie", sesion(ana)).send({ estado: "completada" });
    const [antes] = await query<any>(
      `SELECT COUNT(*) FILTER (WHERE t.fecha_completada >= date_trunc('day', now()))::int AS completadas_hoy,
              COUNT(*) FILTER (WHERE t.estado = 'completada')::int AS completadas
         FROM gozz.tareas t WHERE t.id = $1`, [id]
    );
    expect(antes).toEqual({ completadas_hoy: 1, completadas: 1 });

    await request(app).patch(`/api/tareas/${id}`).set("Cookie", sesion(ana))
      .send({ estado: "pendiente", fecha_limite: null });
    const [despues] = await query<any>(
      `SELECT COUNT(*) FILTER (WHERE t.fecha_completada >= date_trunc('day', now()))::int AS completadas_hoy,
              COUNT(*) FILTER (WHERE t.estado = 'completada')::int AS completadas
         FROM gozz.tareas t WHERE t.id = $1`, [id]
    );
    expect(despues, "los dos contadores tienen que decir lo mismo").toEqual({ completadas_hoy: 0, completadas: 0 });
  });

  it("una CANCELADA retomada también queda limpia y con su plazo nuevo", async () => {
    const ana = await crearUsuario("usuario");
    const id = await sembrarTarea(ana, "cancelada");

    const r = await request(app).patch(`/api/tareas/${id}`).set("Cookie", sesion(ana))
      .send({ estado: "pendiente", fecha_limite: null });
    expect(r.status).toBe(200);

    const t = await leer(id);
    expect(t.estado).toBe("pendiente");
    expect(t.fecha_completada).toBeNull();
    expect(t.fecha_limite, "«Sin fecha límite» deja la tarea viva y sin plazo").toBeNull();
  });

  it("⚠️ editar OTRA cosa de una completada no le borra la fecha de completado", async () => {
    // La limpieza solo se aplica cuando el PATCH trae `estado`. Cambiarle el título a una tarea
    // completada no puede hacer que deje de contar como completada en el informe.
    const ana = await crearUsuario("usuario");
    const id = await sembrarTarea(ana);
    await request(app).patch(`/api/tareas/${id}`).set("Cookie", sesion(ana)).send({ estado: "completada" });

    const r = await request(app).patch(`/api/tareas/${id}`).set("Cookie", sesion(ana))
      .send({ titulo: "Un título nuevo y más largo" });
    expect(r.status).toBe(200);

    const t = await leer(id);
    expect(t.titulo).toBe("Un título nuevo y más largo");
    expect(t.estado).toBe("completada");
    expect(t.fecha_completada, "🔴 se borró sin que nadie tocara el estado").not.toBeNull();
  });

  it("volver a completarla vuelve a poner la fecha", async () => {
    const ana = await crearUsuario("usuario");
    const id = await sembrarTarea(ana);
    const patch = (body: any) => request(app).patch(`/api/tareas/${id}`).set("Cookie", sesion(ana)).send(body);

    await patch({ estado: "completada" });
    await patch({ estado: "pendiente", fecha_limite: null });
    expect((await leer(id)).fecha_completada).toBeNull();

    await patch({ estado: "completada" });
    expect((await leer(id)).fecha_completada).not.toBeNull();
  });
});
