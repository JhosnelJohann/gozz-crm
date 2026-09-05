// ============================================================================================
// LOS TRES DATOS SENSIBLES DE UN CONTACTO — `src/lib/contactos-sensibles.ts`
//
// El SSN y las credenciales de la cuenta USCIS del cliente. R11 los sacó de todas las proyecciones
// y los dejó de SOLO ESCRITURA; esto abre **una** puerta para volver a leerlos, con bitácora
// obligatoria.
//
// 🔴 POR LA PUERTA PASA TODO EL EQUIPO, no solo los admin: quien prepara un caso necesita entrar a
// la cuenta USCIS del cliente. Lo que estos tests vigilan, entonces, no es que la puerta esté
// cerrada — es que **está abierta a quien debe y sigue dejando rastro de cada paso**.
//
// Lo que se vigila aquí:
//   · quién pasa y quién no — que un usuario normal SÍ, y que uno dado de baja NO aunque conserve
//     un token vivo (el único caso que hoy separa la puerta de un `return true`);
//   · 🔴 que la bitácora quede ANTES de entregar, y que **si no se puede anotar, no se entrega**;
//   · 🔴 que la bitácora NO guarde los valores: sería un segundo sitio del que robarlos, y encima
//     inmutable;
//   · 🔴 REGRESIÓN: que las tres columnas sigan FUERA del detalle y del listado. Que nadie las
//     meta en `COLS_DETALLE` "para simplificar" dentro de seis meses.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

import { pool, query } from "../src/shared/db.js";
import { CAMPOS_SENSIBLES, leerDatosSensibles } from "../src/lib/contactos-sensibles.js";
import { construirFiltroContactos, leerFiltros } from "../src/lib/contactos-filtro.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

/** Los valores que NO pueden salir por ningún otro camino que el endpoint dedicado. */
const SSN = "123-45-6789";
const CLAVE_USCIS = "ClaveUscisSecreta!";
const CLAVE_CORREO = "ClaveCorreoSecreta!";
const VALORES = [SSN, CLAVE_USCIS, CLAVE_CORREO];

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(nivel = "usuario", activo = true): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona',$2,$3) RETURNING id`,
    [`sensibles-${sufijo()}@pruebas.invalid`, nivel, activo]
  );
  return r[0].id;
}

/** Un contacto CON los tres rellenos: si no los tuviera, los asserts pasarían por vacío. */
async function crearContactoConSecretos(): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache
       (nombre_completo, email, ssn_encrypted, clave_uscis_enc, clave_correo_uscis_enc)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [`Cliente ${sufijo()}`, `c-${sufijo()}@pruebas.invalid`, SSN, CLAVE_USCIS, CLAVE_CORREO]
  );
  return r[0].id;
}

const filasAuditoria = (contactoId: string) =>
  query<any>(
    `SELECT user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues,
            datos_despues::text AS txt
       FROM gozz.auditoria WHERE registro_id = $1 AND tabla_afectada = 'contactos_cache'`,
    [contactoId]
  );

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("quién puede leerlos", () => {
  it("🔴 un usuario NORMAL los recibe, los tres, SIN ninguna fila en `user_permisos`", async () => {
    const normal = await crearUsuario("usuario");
    const contacto = await crearContactoConSecretos();

    // La premisa primero: el contacto SÍ los tiene guardados. Sin esto, el assert de abajo pasaría
    // por vacío y este test no probaría nada.
    const [fila] = await query<any>(
      "SELECT ssn_encrypted, clave_uscis_enc, clave_correo_uscis_enc FROM gozz.contactos_cache WHERE id = $1",
      [contacto]
    );
    expect(fila.ssn_encrypted).toBe(SSN);
    expect(fila.clave_uscis_enc).toBe(CLAVE_USCIS);
    expect(fila.clave_correo_uscis_enc).toBe(CLAVE_CORREO);

    // Y la otra mitad de la premisa: no se le ha dado nada. Si este `count` no fuera 0, el test
    // seguiría pasando pero probaría lo de antes —"con permiso sí"— en vez de lo de ahora.
    const [{ n }] = await query<any>(
      "SELECT count(*)::int AS n FROM gozz.user_permisos WHERE user_id = $1", [normal]
    );
    expect(n, "no debe hacer falta concederle nada: pasa por ser del equipo").toBe(0);

    const r = await leerDatosSensibles(contacto, normal);
    expect(r.ok).toBe(true);
    expect((r as any).datos).toEqual({
      ssn_encrypted: SSN, clave_uscis_enc: CLAVE_USCIS, clave_correo_uscis_enc: CLAVE_CORREO,
    });
  });

  it("y puede leer los de CUALQUIER contacto, no solo los suyos — aquí no hay filtro por responsable", async () => {
    // No es un efecto colateral que se nos haya escapado: está asumido y escrito en la cabecera de
    // `lib/contactos-sensibles.ts`. Queda como test para que, si alguien decide más adelante que
    // cada quien vea solo su cartera, este fallo le diga que el cambio es a propósito y dónde.
    const otro = await crearUsuario("usuario");
    const responsable = await crearUsuario("usuario");
    const [{ id: contacto }] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, ssn_encrypted, responsable_user_id)
       VALUES ($1,$2,$3) RETURNING id`,
      [`De otro ${sufijo()}`, SSN, responsable]
    );

    const r = await leerDatosSensibles(contacto, otro);
    expect(r.ok).toBe(true);
    expect((r as any).datos.ssn_encrypted).toBe(SSN);
  });

  it("un admin también, por rol", async () => {
    const admin = await crearUsuario("admin");
    const contacto = await crearContactoConSecretos();

    const r = await leerDatosSensibles(contacto, admin);
    expect(r.ok).toBe(true);
    expect((r as any).datos.clave_uscis_enc).toBe(CLAVE_USCIS);
  });

  it("🔴 un usuario DESACTIVADO NO, aunque su token siga siendo válido", async () => {
    // Es el caso que separa esta puerta de un `return true`: `requireAuth` solo mira la firma del
    // JWT, y los de este CRM duran 365 días. A quien se va se le pone `activo = false`, y eso tiene
    // que cortarle el acceso HOY, no cuando le caduque el token.
    const apagado = await crearUsuario("usuario", false);
    const contacto = await crearContactoConSecretos();

    const r = await leerDatosSensibles(contacto, apagado);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("sin_permiso");

    const serializada = JSON.stringify(r);
    for (const v of VALORES) expect(serializada, `se coló "${v}" en la respuesta`).not.toContain(v);
  });

  it("🔴 un rechazo no deja fila en la bitácora: se anota lo que se lee, no lo que se intenta", async () => {
    const apagado = await crearUsuario("usuario", false);
    const contacto = await crearContactoConSecretos();
    await leerDatosSensibles(contacto, apagado);
    expect(await filasAuditoria(contacto)).toHaveLength(0);
  });

  it("sin sesión tampoco, y un contacto inexistente se distingue de un rechazo", async () => {
    const contacto = await crearContactoConSecretos();
    expect((await leerDatosSensibles(contacto, null) as any).motivo).toBe("sin_permiso");
    const normal = await crearUsuario("usuario");
    expect((await leerDatosSensibles("00000000-0000-0000-0000-0000000000ff", normal) as any).motivo).toBe("no_encontrado");
  });

  it("un contacto sin nada guardado devuelve los tres en null, no revienta", async () => {
    const admin = await crearUsuario("admin");
    const [{ id }] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo) VALUES ($1) RETURNING id`, [`Vacío ${sufijo()}`]
    );
    const r = await leerDatosSensibles(id, admin);
    expect(r.ok).toBe(true);
    expect((r as any).datos).toEqual({ ssn_encrypted: null, clave_uscis_enc: null, clave_correo_uscis_enc: null });
  });
});

describe("🔴 la bitácora", () => {
  it("una lectura correcta deja EXACTAMENTE UNA fila, con quién y de qué contacto", async () => {
    // Con un usuario normal a propósito: ahora que pasa todo el equipo, este es el caso corriente,
    // y es justo del que hay que poder responder "¿quién miró las claves de este cliente?".
    const normal = await crearUsuario("usuario");
    const contacto = await crearContactoConSecretos();

    const r = await leerDatosSensibles(contacto, normal);
    expect(r.ok).toBe(true);

    const filas = await filasAuditoria(contacto);
    expect(filas, "una por lectura, ni cero ni dos").toHaveLength(1);
    const f = filas[0];
    expect(f.user_id).toBe(normal);
    expect(f.registro_id).toBe(contacto);
    expect(f.accion).toBe("Consultó los datos sensibles de un contacto");
    expect(f.datos_despues).toEqual({ campos: [...CAMPOS_SENSIBLES] });
  });

  it("🔴 y NO guarda los valores: sería un segundo sitio del que robarlos, y encima inmutable", async () => {
    const admin = await crearUsuario("admin");
    const contacto = await crearContactoConSecretos();
    await leerDatosSensibles(contacto, admin);

    const [f] = await filasAuditoria(contacto);
    const todo = JSON.stringify(f);
    for (const v of VALORES) expect(todo, `la bitácora guardó "${v}"`).not.toContain(v);
    // Pero sí dice QUÉ se entregó: los nombres.
    expect(f.txt).toContain("clave_uscis_enc");
  });

  it("registra solo los campos que de verdad se entregaron con contenido", async () => {
    const admin = await crearUsuario("admin");
    const [{ id }] = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, clave_uscis_enc) VALUES ($1,$2) RETURNING id`,
      [`Solo una ${sufijo()}`, CLAVE_USCIS]
    );
    await leerDatosSensibles(id, admin);
    const [f] = await filasAuditoria(id);
    expect(f.datos_despues).toEqual({ campos: ["clave_uscis_enc"] });
  });

  it("dos lecturas dejan dos filas: cada consulta se anota", async () => {
    const admin = await crearUsuario("admin");
    const contacto = await crearContactoConSecretos();
    await leerDatosSensibles(contacto, admin);
    await leerDatosSensibles(contacto, admin);
    expect(await filasAuditoria(contacto)).toHaveLength(2);
  });

  it("🔴 si la bitácora falla, la respuesta NO trae los valores", async () => {
    // Es lo contrario de la exportación, donde el registro va después y no lanza. Allí la descarga
    // ya ocurrió; aquí el fallo posible es el otro: entregar una clave sin dejar rastro.
    const admin = await crearUsuario("admin");
    const contacto = await crearContactoConSecretos();

    const original = pool.query.bind(pool);
    const espia = vi.spyOn(pool, "query").mockImplementation(((texto: any, params?: any) => {
      if (typeof texto === "string" && texto.includes("INSERT INTO gozz.auditoria")) {
        return Promise.reject(new Error("la bitácora dijo que no"));
      }
      return original(texto, params);
    }) as any);

    const r = await leerDatosSensibles(contacto, admin);
    espia.mockRestore();

    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("sin_bitacora");
    // 🔴 Lo que importa: los valores NO están en la respuesta.
    const serializada = JSON.stringify(r);
    for (const v of VALORES) expect(serializada, `se entregó "${v}" sin dejar rastro`).not.toContain(v);
    // Y no quedó fila a medias.
    expect(await filasAuditoria(contacto)).toHaveLength(0);
  });
});

describe("🔴 REGRESIÓN · las tres columnas siguen fuera de las proyecciones", () => {
  /** La proyección del DETALLE, tal y como la arma la ruta (`COLS_DETALLE` + banderas). */
  const COLS_DETALLE_ESPERADAS = `
    id, nombre_completo, nombre, apellido, segundo_nombre, email, correo_personal, telefono, whatsapp,
    a_number, itin, pasaporte_numero, estatus_migratorio, correo_uscis, usuario_uscis,
    tipo_cliente, etiquetas, archivado, revision_dedup, responsable_user_id, created_at`;

  it("el DETALLE no devuelve ninguna de las tres, solo las banderas `tiene_*`", async () => {
    const contacto = await crearContactoConSecretos();
    const [fila] = await query<any>(
      `SELECT ${COLS_DETALLE_ESPERADAS},
              (ssn_encrypted IS NOT NULL AND ssn_encrypted <> '') AS tiene_ssn,
              (clave_uscis_enc IS NOT NULL AND clave_uscis_enc <> '') AS tiene_clave_uscis
         FROM gozz.contactos_cache WHERE id = $1`, [contacto]
    );
    for (const c of CAMPOS_SENSIBLES) expect(Object.keys(fila), `"${c}" en el detalle`).not.toContain(c);
    const serializada = JSON.stringify(fila);
    for (const v of VALORES) expect(serializada).not.toContain(v);
    // Las banderas sí, y dicen la verdad: hay valor guardado, sin decir cuál.
    expect(fila.tiene_ssn).toBe(true);
    expect(fila.tiene_clave_uscis).toBe(true);
  });

  it("🔴 la constante del código sigue enumerando las tres — si alguien la recorta, esto cae", async () => {
    expect([...CAMPOS_SENSIBLES].sort()).toEqual(
      ["clave_correo_uscis_enc", "clave_uscis_enc", "ssn_encrypted"]
    );
  });

  it("el LISTADO tampoco las devuelve", async () => {
    const contacto = await crearContactoConSecretos();
    const { where, params } = construirFiltroContactos(leerFiltros({}));
    const [fila] = await query<any>(
      `SELECT id, nombre_completo, email, telefono, whatsapp, tipo_cliente,
              estatus_migratorio, estatus_migratorio_tipo, responsable_user_id, created_at
         FROM gozz.contactos_cache WHERE ${where} AND id = $${params.length + 1}`,
      [...params, contacto]
    );
    expect(fila, "la premisa: el contacto sale en el listado").toBeTruthy();
    for (const c of CAMPOS_SENSIBLES) expect(Object.keys(fila)).not.toContain(c);
    for (const v of VALORES) expect(JSON.stringify(fila)).not.toContain(v);
  });
});
