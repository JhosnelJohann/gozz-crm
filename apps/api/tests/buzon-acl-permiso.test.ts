// ============================================================================================
// CAMBIAR EL PERMISO DE UNA PERSONA SOBRE UN BUZÓN — `src/lib/buzon-acl.ts`
//
// `buzon_acl.permiso` decide si quien tiene acceso compartido a un buzón solo lo LEE o además
// puede ENVIAR en nombre de esa dirección. Hasta ahora se podía dar acceso y quitarlo, pero no
// cambiarlo: para bajar a alguien de `enviar` a `ver` había que borrarle la fila y volver a darle
// de alta.
//
// 🔴 LO QUE SE VIGILA AQUÍ NO ES QUE LA COLUMNA CAMBIE —eso es papeleo— sino:
//   · que se pueda BAJAR, no solo subir: es el caso que motivó la entrega, y el que el POST de al
//     lado ya cubría a medias con un comentario que dice "upgrade";
//   · que el acceso NO se interrumpa: la fila es la misma antes y después, no una nueva;
//   · que un valor que no es ninguno de los dos se RECHACE en vez de guardarse como `ver`;
//   · que una fila de OTRO buzón no se pueda tocar pasando su id;
//   · y que el efecto real llegue a la regla que decide quién envía.
//
// 🔴 Todo sintético, en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import { PERMISOS_ACL, cambiarPermisoAcl, esPermisoAcl } from "../src/lib/buzon-acl.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(posiciones: string[] | null = null): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo, posiciones)
     VALUES ($1,'no-es-un-hash','Persona','usuario',true,$2::jsonb) RETURNING id`,
    [`acl-${sufijo()}@pruebas.invalid`, posiciones ? JSON.stringify(posiciones) : null]
  );
  return r[0].id;
}

/** Mismo relleno mínimo que `buzon-propietario.test.ts`: la tabla exige host/puerto de IMAP y SMTP. */
async function crearBuzon(ownerId: string): Promise<string> {
  const correo = `buzon-${sufijo()}@pruebas.invalid`;
  const r = await query<any>(
    `INSERT INTO gozz.buzones_email
       (owner_user_id, email, display_name, imap_host, imap_port, imap_ssl, imap_user, imap_password_enc,
        smtp_host, smtp_port, smtp_ssl, activo)
     VALUES ($1,$2,'Buzón','imap.invalid',993,true,$2,'clave-del-buzon','smtp.invalid',465,true,true)
     RETURNING id`,
    [ownerId, correo]
  );
  return r[0].id;
}

async function darAcceso(
  buzonId: string,
  permiso: "ver" | "enviar",
  quien: { userId?: string; posicion?: string }
): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.buzon_acl (buzon_id, user_id, posicion, permiso)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [buzonId, quien.userId ?? null, quien.posicion ?? null, permiso]
  );
  return r[0].id;
}

const permisoGuardado = async (aclId: string): Promise<string | null> =>
  (await query<any>("SELECT permiso FROM gozz.buzon_acl WHERE id = $1", [aclId]))[0]?.permiso ?? null;

/**
 * 🔴 LA MISMA REGLA QUE DECIDE EL ENVÍO EN PRODUCCIÓN (`userCanSeeBuzon`, `email-routes.ts:43`).
 *
 * Se reproduce aquí —igual que en `buzon-propietario.test.ts`, y con el mismo riesgo declarado—
 * porque esa función es privada del fichero de rutas: si allí cambiara, esto no se enteraría. Se
 * acepta porque la alternativa es quedarse en "la columna dice enviar", que no prueba que la
 * persona pueda enviar. Sacarla a `lib/` cerraría el hueco en los dos tests; es entrega aparte.
 */
async function puedeEnviar(userId: string, buzonId: string): Promise<boolean> {
  const b = (await query<any>("SELECT owner_user_id FROM gozz.buzones_email WHERE id = $1", [buzonId]))[0];
  if (!b) return false;
  if (b.owner_user_id === userId) return true;
  const usr = (await query<any>("SELECT posiciones FROM gozz.users WHERE id = $1", [userId]))[0];
  const posiciones: string[] = Array.isArray(usr?.posiciones) ? usr.posiciones : [];
  const acls = await query<any>("SELECT user_id, posicion, permiso FROM gozz.buzon_acl WHERE buzon_id = $1", [buzonId]);
  return acls.some(
    (a: any) => (a.user_id === userId || (a.posicion && posiciones.includes(a.posicion))) && a.permiso === "enviar"
  );
}

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("cambiar el permiso en los dos sentidos", () => {
  it("🔴 BAJA de 'leer + enviar' a 'solo leer' — el caso que antes obligaba a borrar y volver a agregar", async () => {
    const buzon = await crearBuzon(await crearUsuario());
    const persona = await crearUsuario();
    const acl = await darAcceso(buzon, "enviar", { userId: persona });

    // La premisa: hoy sí puede enviar. Sin esto el assert de abajo pasaría por vacío.
    expect(await puedeEnviar(persona, buzon)).toBe(true);

    const r = await cambiarPermisoAcl(buzon, acl, "ver");
    expect(r.ok).toBe(true);
    expect((r as any).antes).toBe("enviar");
    expect((r as any).acl.permiso).toBe("ver");
    expect((r as any).cambio).toBe(true);

    expect(await permisoGuardado(acl)).toBe("ver");
    expect(await puedeEnviar(persona, buzon), "ya no debe poder enviar").toBe(false);
  });

  it("sube de 'solo leer' a 'leer + enviar'", async () => {
    const buzon = await crearBuzon(await crearUsuario());
    const persona = await crearUsuario();
    const acl = await darAcceso(buzon, "ver", { userId: persona });
    expect(await puedeEnviar(persona, buzon)).toBe(false);

    const r = await cambiarPermisoAcl(buzon, acl, "enviar");
    expect(r.ok).toBe(true);
    expect((r as any).cambio).toBe(true);
    expect(await puedeEnviar(persona, buzon)).toBe(true);
  });

  it("🔴 el acceso NO se interrumpe: es la MISMA fila, no una nueva", async () => {
    // Es el motivo de que exista este endpoint. Borrar y volver a agregar dejaba a la persona sin
    // acceso en medio, y si la segunda mitad no llegaba a ocurrir, sin acceso del todo.
    const buzon = await crearBuzon(await crearUsuario());
    const persona = await crearUsuario();
    const acl = await darAcceso(buzon, "enviar", { userId: persona });

    const r = await cambiarPermisoAcl(buzon, acl, "ver");
    expect((r as any).acl.id, "el id de la fila tiene que ser el mismo").toBe(acl);

    const filas = await query<any>("SELECT id FROM gozz.buzon_acl WHERE buzon_id = $1", [buzon]);
    expect(filas, "una fila, la de siempre: ni dos ni cero").toHaveLength(1);
  });

  it("funciona igual sobre un acceso POR POSICIÓN, no solo por persona", async () => {
    const buzon = await crearBuzon(await crearUsuario());
    const posicion = `Preparadores ${sufijo()}`;
    const alguien = await crearUsuario([posicion]);
    const acl = await darAcceso(buzon, "enviar", { posicion });
    expect(await puedeEnviar(alguien, buzon)).toBe(true);

    const r = await cambiarPermisoAcl(buzon, acl, "ver");
    expect(r.ok).toBe(true);
    expect((r as any).acl.posicion).toBe(posicion);
    expect((r as any).acl.user_id).toBeNull();
    expect(await puedeEnviar(alguien, buzon), "y le baja a todos los de esa posición").toBe(false);
  });

  it("pedir el permiso que ya tenía no es un error, pero se dice que no cambió nada", async () => {
    const buzon = await crearBuzon(await crearUsuario());
    const acl = await darAcceso(buzon, "ver", { userId: await crearUsuario() });

    const r = await cambiarPermisoAcl(buzon, acl, "ver");
    expect(r.ok).toBe(true);
    expect((r as any).cambio, "no movió nada; decir 'hecho' sugeriría lo contrario").toBe(false);
    expect((r as any).antes).toBe("ver");
    expect(await permisoGuardado(acl)).toBe("ver");
  });
});

describe("🔴 lo que NO se acepta", () => {
  it("un valor que no es ninguno de los dos se RECHAZA, no se guarda como 'ver'", async () => {
    // El POST de al lado hace `permiso === "enviar" ? "enviar" : "ver"`: un "enviarr" se guarda
    // como `ver` en silencio y quien lo pidió cree que concedió el envío. Aquí no.
    const buzon = await crearBuzon(await crearUsuario());
    const persona = await crearUsuario();
    const acl = await darAcceso(buzon, "enviar", { userId: persona });

    for (const malo of ["enviarr", "VER", "admin", "", "  ", null, undefined, 1, true, ["ver"]]) {
      const r = await cambiarPermisoAcl(buzon, acl, malo as any);
      expect(r.ok, `aceptó ${JSON.stringify(malo)}`).toBe(false);
      expect((r as any).motivo).toBe("permiso_invalido");
    }

    // Y sobre todo: no ha tocado la fila. Un rechazo no puede dejar a la persona peor que estaba.
    expect(await permisoGuardado(acl)).toBe("enviar");
    expect(await puedeEnviar(persona, buzon)).toBe(true);
  });

  it("🔴 una fila de OTRO buzón no se toca, aunque se pase su id", async () => {
    // El dueño se comprueba contra el buzón de la URL. Si la fila no tuviera que ser de ESE buzón,
    // quien administra uno podría editar la ACL de cualquier otro.
    const ajeno = await crearBuzon(await crearUsuario());
    const propio = await crearBuzon(await crearUsuario());
    const acl = await darAcceso(ajeno, "enviar", { userId: await crearUsuario() });

    const r = await cambiarPermisoAcl(propio, acl, "ver");
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toBe("no_encontrada");
    expect(await permisoGuardado(acl), "la fila ajena sigue intacta").toBe("enviar");
  });

  it("una fila que no existe da 'no encontrada', no un fallo raro", async () => {
    const buzon = await crearBuzon(await crearUsuario());
    const r = await cambiarPermisoAcl(buzon, "00000000-0000-0000-0000-0000000000fd", "ver");
    expect((r as any).motivo).toBe("no_encontrada");
  });
});

describe("la lista de permisos", () => {
  it("sigue siendo exactamente 'ver' y 'enviar' — si se añade un tercero, esto avisa", async () => {
    // La pantalla pinta dos botones y `userCanSeeBuzon` solo distingue `enviar` del resto. Un
    // valor nuevo aquí sin tocar esos dos sitios sería un permiso que nadie sabe representar.
    expect([...PERMISOS_ACL]).toEqual(["ver", "enviar"]);
    expect(esPermisoAcl("ver")).toBe(true);
    expect(esPermisoAcl("enviar")).toBe(true);
    expect(esPermisoAcl("Enviar")).toBe(false);
  });
});
