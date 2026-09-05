// ============================================================================================
// AUTORIZACIÓN — `src/lib/permisos.ts`
//
// Lo que se prueba aquí guarda las tres puertas de aprobación de solicitudes de dinero. El defecto
// que cierra esta entrega: `puedeEditarMontoDirecto` leía el rol del **JWT**, y los tokens de este
// CRM duran **365 días y no se refrescan**. A un admin degradado le duraban los poderes hasta un
// año, y a un usuario desactivado con el permiso puesto no se le paraba en ninguna parte.
//
// Por eso los casos de aquí NO son "¿devuelve true?": son "¿deja de poder EN EL ACTO cuando cambia
// la base, sin volver a entrar?".
//
// Ver `docs/CONVENCIONES.md` §2.
// ============================================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { pool, query } from "../src/shared/db.js";
import { esAdminEnBase, puede, puedeEditarMontoDirecto } from "../src/lib/permisos.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

const PERMISO = "editar_monto";

/** Un usuario sintético por caso: el email lleva sufijo para que los casos no se pisen. */
let contador = 0;
async function crearUsuario(nivel: string, activo: boolean): Promise<string> {
  const email = `permisos-${Date.now().toString(36)}-${++contador}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1, 'no-es-un-hash', 'Caso de permisos', $2, $3) RETURNING id`,
    [email, nivel, activo]
  );
  return r[0].id;
}

const conceder = (userId: string, permiso = PERMISO) =>
  query("INSERT INTO gozz.user_permisos (user_id, permiso) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, permiso]);

const revocar = (userId: string, permiso = PERMISO) =>
  query("DELETE FROM gozz.user_permisos WHERE user_id = $1 AND permiso = $2", [userId, permiso]);

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // La base es desechable y `global-setup` la tira entera; esto es sólo higiene entre ficheros.
  await query("DELETE FROM gozz.user_permisos WHERE permiso = $1", [PERMISO]);
});

describe("puede() · una sola consulta", () => {
  it("resuelve el permiso en UNA consulta a la base", async () => {
    // `/api/auth/me` llama a esto en cada carga de página: dos viajes en vez de uno se notan.
    const u = await crearUsuario("usuario", true);
    await conceder(u);

    const espia = vi.spyOn(pool, "query");
    const r = await puede(u, PERMISO);

    expect(r).toBe(true);
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it("no consulta nada si no hay usuario o no hay permiso que comprobar", async () => {
    const espia = vi.spyOn(pool, "query");

    expect(await puede(null, PERMISO)).toBe(false);
    expect(await puede(undefined, PERMISO)).toBe(false);
    expect(await puede("", PERMISO)).toBe(false);
    expect(await puede("00000000-0000-0000-0000-000000000000", "")).toBe(false);

    expect(espia).not.toHaveBeenCalled();
  });
});

describe("puede() · quién puede y quién no", () => {
  it("un admin activo puede, sin fila en user_permisos", async () => {
    const u = await crearUsuario("admin", true);
    expect(await puede(u, PERMISO)).toBe(true);
  });

  it("un super_admin activo puede", async () => {
    const u = await crearUsuario("super_admin", true);
    expect(await puede(u, PERMISO)).toBe(true);
  });

  it("un usuario normal SIN el permiso no puede", async () => {
    const u = await crearUsuario("usuario", true);
    expect(await puede(u, PERMISO)).toBe(false);
  });

  it("🔴 un usuario normal CON el permiso sí puede — el granular es lo que se estrena", async () => {
    const u = await crearUsuario("usuario", true);
    expect(await puede(u, PERMISO)).toBe(false);
    await conceder(u);
    expect(await puede(u, PERMISO)).toBe(true);
  });

  it("el permiso es por nombre exacto: tener otro no vale", async () => {
    const u = await crearUsuario("usuario", true);
    await conceder(u, "exportar_contactos");
    expect(await puede(u, "exportar_contactos")).toBe(true);
    expect(await puede(u, PERMISO)).toBe(false);
    await revocar(u, "exportar_contactos");
  });

  it("un usuario que no existe no puede", async () => {
    expect(await puede("00000000-0000-0000-0000-000000000000", PERMISO)).toBe(false);
  });
});

describe("🔴 puede() · lo que ANTES estaba roto", () => {
  it("un usuario DESACTIVADO con el permiso puesto NO puede", async () => {
    // Antes sí podía: el helper viejo miraba `user_permisos` sin mirar `activo`.
    const u = await crearUsuario("usuario", false);
    await conceder(u);
    expect(await puede(u, PERMISO)).toBe(false);
  });

  it("un ADMIN desactivado no puede", async () => {
    const u = await crearUsuario("admin", false);
    expect(await puede(u, PERMISO)).toBe(false);
  });

  it("activo NULL cuenta como activo (COALESCE): no se cierra la puerta a los históricos", async () => {
    const u = await crearUsuario("admin", true);
    await query("UPDATE gozz.users SET activo = NULL WHERE id = $1", [u]);
    expect(await puede(u, PERMISO)).toBe(true);
  });

  it("al que se le quita el ROL deja de poder AL INSTANTE, sin volver a entrar", async () => {
    // Éste es el caso del token de 365 días. No hay login de por medio: la misma llamada, la misma
    // sesión, y la respuesta cambia porque la base cambió.
    const u = await crearUsuario("admin", true);
    expect(await puede(u, PERMISO)).toBe(true);

    await query("UPDATE gozz.users SET nivel_acceso = 'usuario' WHERE id = $1", [u]);
    expect(await puede(u, PERMISO)).toBe(false);
  });

  it("al que se le DESACTIVA la cuenta deja de poder al instante", async () => {
    const u = await crearUsuario("usuario", true);
    await conceder(u);
    expect(await puede(u, PERMISO)).toBe(true);

    await query("UPDATE gozz.users SET activo = false WHERE id = $1", [u]);
    expect(await puede(u, PERMISO)).toBe(false);
  });

  it("al que se le REVOCA el permiso deja de poder al instante", async () => {
    const u = await crearUsuario("usuario", true);
    await conceder(u);
    expect(await puede(u, PERMISO)).toBe(true);

    await revocar(u);
    expect(await puede(u, PERMISO)).toBe(false);
  });
});

describe("puedeEditarMontoDirecto() · conserva el nombre, ya no mira el JWT", () => {
  it("ignora el `nivel` del token y hace caso a la base", async () => {
    // El payload dice 'admin'. La base dice 'usuario' sin permiso. Gana la base — que es el arreglo.
    const u = await crearUsuario("usuario", true);
    expect(await puedeEditarMontoDirecto({ sub: u, email: "x@y.z", nivel: "super_admin" })).toBe(false);
  });

  it("con el permiso en la base, da true aunque el token no diga nada", async () => {
    const u = await crearUsuario("usuario", true);
    await conceder(u);
    expect(await puedeEditarMontoDirecto({ sub: u })).toBe(true);
  });

  it("sin payload no revienta: devuelve false", async () => {
    expect(await puedeEditarMontoDirecto(undefined)).toBe(false);
    expect(await puedeEditarMontoDirecto({})).toBe(false);
  });
});

describe("esAdminEnBase() · la puerta del rol amplio", () => {
  it("distingue admin de usuario y respeta `activo`", async () => {
    const admin = await crearUsuario("admin", true);
    const normal = await crearUsuario("usuario", true);
    const apagado = await crearUsuario("admin", false);

    expect(await esAdminEnBase(admin)).toBe(true);
    expect(await esAdminEnBase(normal)).toBe(false);
    expect(await esAdminEnBase(apagado)).toBe(false);
    expect(await esAdminEnBase(null)).toBe(false);
  });

  it("no confunde el permiso granular con el rol: tenerlo NO te hace admin", async () => {
    const u = await crearUsuario("usuario", true);
    await conceder(u);
    expect(await puede(u, PERMISO)).toBe(true);
    expect(await esAdminEnBase(u)).toBe(false);
  });
});
