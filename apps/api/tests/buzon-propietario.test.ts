// ============================================================================================
// EL PROPIETARIO DE UN BUZÓN — `src/lib/buzon-propietario.ts`
//
// 🔴 `owner_user_id` decide **quién ve el correo de ese buzón** (`userCanSeeBuzon`) y quién recibe
// sus avisos. Cambiarlo entrega la correspondencia de una persona a otra: es la acción de más
// consecuencia del módulo de correo.
//
// Por eso la prueba que importa no es que la columna cambie —eso es papeleo— sino **que el acceso
// cambie con ella**, comprobado por la MISMA regla que decide el acceso en producción.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

// El cambio de propietario emite por socket. No hay servidor aquí, así que se simula: lo que se
// prueba es la decisión y la constancia, no el transporte.
vi.mock("../src/shared/socket.js", () => ({ emitToUser: vi.fn(), emitToGrupo: vi.fn() }));

import { query } from "../src/shared/db.js";
import {
  cambiarPropietario, notificarNuevoPropietario, resolverPropietarioAlCrear,
} from "../src/lib/buzon-propietario.js";
import { buildLoginCandidates } from "../src/email-routes.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(nivel = "usuario", activo = true): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash',$2,$3,$4) RETURNING id`,
    [`buzon-${sufijo()}@pruebas.invalid`, `Persona ${sufijo()}`, nivel, activo]
  );
  return r[0].id;
}

const CLAVE = "contrasena-secreta-del-buzon";

async function crearBuzon(ownerId: string, email?: string): Promise<{ id: string; email: string }> {
  const correo = email ?? `buzon-${sufijo()}@dominio.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.buzones_email
       (owner_user_id, email, display_name, imap_host, imap_port, imap_ssl, imap_user, imap_password_enc,
        smtp_host, smtp_port, smtp_ssl)
     VALUES ($1,$2,'Buzón','imap.invalid',993,true,$2,$3,'smtp.invalid',465,true) RETURNING id, email`,
    [ownerId, correo, CLAVE]
  );
  return r[0];
}

/**
 * 🔴 LA MISMA REGLA QUE DECIDE EL ACCESO EN PRODUCCIÓN (`userCanSeeBuzon`, `email-routes.ts`).
 *
 * Se reproduce aquí porque esa función es privada del fichero de rutas. Reproducir la regla y no
 * llamarla tiene un riesgo declarado: si allí cambiara, esto no se enteraría. Se acepta porque la
 * alternativa —no probar el efecto y quedarse con "la columna cambió"— es justo lo que no dice
 * nada. Las dos ramas que importan son las de aquí: dueño, o fila de ACL.
 */
async function puedeVer(userId: string, buzonId: string): Promise<boolean> {
  const [b] = await query<any>("SELECT owner_user_id FROM gozz.buzones_email WHERE id = $1", [buzonId]);
  if (!b) return false;
  if (b.owner_user_id === userId) return true;
  const [{ posiciones }] = await query<any>("SELECT posiciones FROM gozz.users WHERE id = $1", [userId]);
  const pos: string[] = Array.isArray(posiciones) ? posiciones : [];
  const acls = await query<any>("SELECT user_id, posicion FROM gozz.buzon_acl WHERE buzon_id = $1", [buzonId]);
  return acls.some((a: any) => a.user_id === userId || (a.posicion && pos.includes(a.posicion)));
}

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("al crear: quién queda como propietario", () => {
  it("🔴 un usuario NO admin que manda `owner_user_id` ajeno: se IGNORA y el dueño es él", async () => {
    const normal = await crearUsuario("usuario");
    const otro = await crearUsuario("usuario");
    const r = await resolverPropietarioAlCrear(otro, normal);
    expect(r.ownerId, "no se acepta que alguien deje un buzón a nombre de otro").toBe(normal);
    expect(r.error).toBeUndefined();   // no es un error: es que ese campo no es suyo
  });

  it("un admin sí puede designar a otra persona", async () => {
    const admin = await crearUsuario("admin");
    const destino = await crearUsuario("usuario");
    const r = await resolverPropietarioAlCrear(destino, admin);
    expect(r.ownerId).toBe(destino);
  });

  it("sin el campo, el dueño es quien conecta — para admin y para el resto", async () => {
    const admin = await crearUsuario("admin");
    const normal = await crearUsuario("usuario");
    expect((await resolverPropietarioAlCrear(null, admin)).ownerId).toBe(admin);
    expect((await resolverPropietarioAlCrear(undefined, normal)).ownerId).toBe(normal);
    expect((await resolverPropietarioAlCrear("", normal)).ownerId).toBe(normal);
  });

  it("un admin que apunta a un usuario INACTIVO recibe error, no un buzón perdido", async () => {
    const admin = await crearUsuario("admin");
    const baja = await crearUsuario("usuario", false);
    const r = await resolverPropietarioAlCrear(baja, admin);
    expect(r.error).toMatch(/no existe o está inactivo/);
  });

  it("y a un usuario que no existe, tampoco", async () => {
    const admin = await crearUsuario("admin");
    expect((await resolverPropietarioAlCrear("00000000-0000-0000-0000-0000000000ff", admin)).error).toBeTruthy();
    // Ni siquiera intenta consultar algo que no es un uuid.
    expect((await resolverPropietarioAlCrear("no-soy-uuid", admin)).error).toBeTruthy();
  });

  it("🔴 un admin DESACTIVADO ya no lo es: se le ignora el campo", async () => {
    // `esAdminEnBase` exige `activo`. Con el `isAdmin(u)` del JWT esto pasaría.
    const apagado = await crearUsuario("admin", false);
    const destino = await crearUsuario("usuario");
    expect((await resolverPropietarioAlCrear(destino, apagado)).ownerId).toBe(apagado);
  });
});

describe("buildLoginCandidates", () => {
  it("prioriza el correo completo y deja como fallback el usuario local para proveedores con login dual", () => {
    expect(buildLoginCandidates("juan.duque", "juan.duque@gozz-agencia.com")).toEqual([
      "juan.duque@gozz-agencia.com",
      "juan.duque",
    ]);
  });

  it("deduplica variantes repetidas y respeta el orden seguro para cualquier host", () => {
    expect(buildLoginCandidates("juan.duque@gozz-agencia.com", "juan.duque@gozz-agencia.com")).toEqual([
      "juan.duque@gozz-agencia.com",
      "juan.duque",
    ]);
  });
});

describe("al cambiar: quién puede", () => {
  it("🔴 un usuario NO admin recibe 'sin permiso', aunque sea el dueño del buzón", async () => {
    const dueno = await crearUsuario("usuario");
    const otro = await crearUsuario("usuario");
    const buzon = await crearBuzon(dueno);
    const r = await cambiarPropietario(buzon.id, otro, dueno);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("sin_permiso");
    // Y no ha tocado nada.
    expect(await puedeVer(dueno, buzon.id)).toBe(true);
    expect(await puedeVer(otro, buzon.id)).toBe(false);
  });

  it("un admin sí", async () => {
    const admin = await crearUsuario("admin");
    const dueno = await crearUsuario("usuario");
    const destino = await crearUsuario("usuario");
    const buzon = await crearBuzon(dueno);
    expect((await cambiarPropietario(buzon.id, destino, admin)).ok).toBe(true);
  });

  it("un admin desactivado, no", async () => {
    const apagado = await crearUsuario("admin", false);
    const buzon = await crearBuzon(await crearUsuario());
    const r = await cambiarPropietario(buzon.id, await crearUsuario(), apagado);
    expect((r as any).motivo).toBe("sin_permiso");
  });

  it("un buzón que no existe da 'no encontrado', no un fallo raro", async () => {
    const admin = await crearUsuario("admin");
    const r = await cambiarPropietario("00000000-0000-0000-0000-0000000000fe", await crearUsuario(), admin);
    expect((r as any).motivo).toBe("no_encontrado");
  });

  it("un destino inactivo se rechaza", async () => {
    const admin = await crearUsuario("admin");
    const buzon = await crearBuzon(await crearUsuario());
    const baja = await crearUsuario("usuario", false);
    const r = await cambiarPropietario(buzon.id, baja, admin);
    expect((r as any).motivo).toBe("destino_invalido");
  });

  it("cambiarlo por el que ya es no cuenta como cambio", async () => {
    const admin = await crearUsuario("admin");
    const dueno = await crearUsuario("usuario");
    const buzon = await crearBuzon(dueno);
    expect((await cambiarPropietario(buzon.id, dueno, admin) as any).motivo).toBe("sin_cambio");
  });
});

describe("🔴 LO QUE DE VERDAD CAMBIA: el acceso al correo", () => {
  it("tras el cambio, el anterior YA NO ve el buzón y el nuevo SÍ", async () => {
    const admin = await crearUsuario("admin");
    const antes = await crearUsuario("usuario");
    const despues = await crearUsuario("usuario");
    const buzon = await crearBuzon(antes);

    // La premisa: antes del cambio es justo al revés.
    expect(await puedeVer(antes, buzon.id)).toBe(true);
    expect(await puedeVer(despues, buzon.id)).toBe(false);

    const r = await cambiarPropietario(buzon.id, despues, admin);
    expect(r.ok).toBe(true);

    expect(await puedeVer(despues, buzon.id), "el nuevo propietario tiene que ver su correo").toBe(true);
    expect(await puedeVer(antes, buzon.id), "el anterior deja de verlo — es lo que hay que avisar").toBe(false);
  });

  it("si el anterior tenía además una fila de ACL, la conserva: no se le quita en silencio", async () => {
    // Quitársela sería decidir por el admin sin decírselo. Que la retire es decisión suya, visible.
    const admin = await crearUsuario("admin");
    const antes = await crearUsuario("usuario");
    const despues = await crearUsuario("usuario");
    const buzon = await crearBuzon(antes);
    await query("INSERT INTO gozz.buzon_acl (buzon_id, user_id, permiso) VALUES ($1,$2,'ver')", [buzon.id, antes]);

    await cambiarPropietario(buzon.id, despues, admin);
    expect(await puedeVer(antes, buzon.id), "conserva el acceso compartido que ya tenía").toBe(true);
  });

  it("y si el NUEVO tenía una fila de ACL, se borra: ya es suyo por ser dueño", async () => {
    const admin = await crearUsuario("admin");
    const antes = await crearUsuario("usuario");
    const despues = await crearUsuario("usuario");
    const buzon = await crearBuzon(antes);
    await query("INSERT INTO gozz.buzon_acl (buzon_id, user_id, permiso) VALUES ($1,$2,'ver')", [buzon.id, despues]);

    const r = await cambiarPropietario(buzon.id, despues, admin);
    expect((r as any).aclRetirada).toBe(true);
    const acls = await query<any>("SELECT id FROM gozz.buzon_acl WHERE buzon_id = $1 AND user_id = $2", [buzon.id, despues]);
    expect(acls).toHaveLength(0);
    expect(await puedeVer(despues, buzon.id)).toBe(true);   // por dueño, no por ACL
  });
});

describe("🔴 la colisión del índice único", () => {
  it("propietario nuevo que YA tiene ese correo: mensaje que se entiende, no un 500", async () => {
    const admin = await crearUsuario("admin");
    const antes = await crearUsuario("usuario");
    const despues = await crearUsuario("usuario");
    const correo = `choque-${sufijo()}@dominio.invalid`;
    const buzon = await crearBuzon(antes, correo);
    await crearBuzon(despues, correo);        // el destino ya lo tiene conectado

    const r = await cambiarPropietario(buzon.id, despues, admin);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("colision");
    expect((r as any).mensaje).toMatch(/ya tiene ese buzón conectado/);

    // Y el buzón se queda donde estaba: nada a medias.
    const [b] = await query<any>("SELECT owner_user_id FROM gozz.buzones_email WHERE id = $1", [buzon.id]);
    expect(b.owner_user_id).toBe(antes);
  });

  it("la caja del correo no la salva: MISMO@x y mismo@x son el mismo buzón", async () => {
    // El índice único es sobre `email` tal cual, así que no lo vería. La comprobación previa usa
    // `LOWER` a propósito: es más estricta que la base.
    const admin = await crearUsuario("admin");
    const antes = await crearUsuario("usuario");
    const despues = await crearUsuario("usuario");
    const base = `Caja-${sufijo()}@Dominio.invalid`;
    const buzon = await crearBuzon(antes, base.toLowerCase());
    await crearBuzon(despues, base.toUpperCase());

    expect((await cambiarPropietario(buzon.id, despues, admin) as any).motivo).toBe("colision");
  });
});

describe("🔴 la constancia", () => {
  it("deja UNA fila con el id anterior y el nuevo, y SIN la contraseña ni el contenido", async () => {
    const admin = await crearUsuario("admin");
    const antes = await crearUsuario("usuario");
    const despues = await crearUsuario("usuario");
    const buzon = await crearBuzon(antes);

    const r = await cambiarPropietario(buzon.id, despues, admin);
    expect(r.ok).toBe(true);

    const filas = await query<any>(
      `SELECT user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues, datos_despues::text AS txt
         FROM gozz.auditoria WHERE registro_id = $1 AND tabla_afectada = 'buzones_email'`,
      [buzon.id]
    );
    expect(filas, "una fila por cambio, ni cero ni dos").toHaveLength(1);
    const f = filas[0];
    expect(f.user_id, "quién lo hizo").toBe(admin);
    expect(f.datos_antes).toEqual({ owner_user_id: antes });
    expect(f.datos_despues.owner_user_id).toBe(despues);
    expect(f.accion).toContain(buzon.email);

    // 🔴 Ni la contraseña, ni un solo correo: la bitácora registra QUÉ pasó, no el contenido.
    const todo = JSON.stringify(f);
    expect(todo).not.toContain(CLAVE);
    expect(todo).not.toContain("imap_password");
  });

  it("un cambio rechazado NO deja fila: no se registra lo que no ocurrió", async () => {
    const dueno = await crearUsuario("usuario");
    const buzon = await crearBuzon(dueno);
    await cambiarPropietario(buzon.id, await crearUsuario(), dueno);   // sin permiso
    const filas = await query<any>(
      "SELECT id FROM gozz.auditoria WHERE registro_id = $1 AND tabla_afectada = 'buzones_email'", [buzon.id]
    );
    expect(filas).toHaveLength(0);
  });

  it("avisa al nuevo propietario, y el aviso no lleva la contraseña", async () => {
    const nuevo = await crearUsuario("usuario");
    const buzon = await crearBuzon(await crearUsuario());
    await notificarNuevoPropietario(nuevo, buzon);

    const [n] = await query<any>(
      "SELECT titulo, mensaje, metadata, metadata::text AS meta FROM gozz.notificaciones WHERE user_id = $1", [nuevo]
    );
    expect(n).toBeTruthy();
    expect(n.titulo).toContain("responsable de un buzón");
    expect(n.mensaje).toContain(buzon.email);
    expect(n.meta).not.toContain(CLAVE);
  });

  it("un fallo al notificar no lanza: el traspaso ya ocurrió", async () => {
    await expect(
      notificarNuevoPropietario("no-soy-un-uuid", { id: "x", email: "y@z.invalid" })
    ).resolves.toBeUndefined();
  });
});
