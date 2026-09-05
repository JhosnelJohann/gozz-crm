// ============================================================================================
// EL PROPIETARIO DE UN BUZÓN — designarlo al crear y cambiarlo después
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 POR QUÉ ESTO NO ES UN CAMPO MÁS
// ════════════════════════════════════════════════════════════════════════════════════════════
// `buzones_email.owner_user_id` decide **quién ve el correo de ese buzón** (`userCanSeeBuzon`) y
// quién recibe el aviso cuando se desconecta. Cambiarlo **entrega la correspondencia de una
// persona a otra**: es la acción de más consecuencia del módulo, y hasta ahora no había forma de
// hacerla —el propietario se fijaba al crear con el `u.sub` de quien conectaba y ahí se quedaba
// para siempre.
//
// De ahí las tres cosas que este módulo hace y que no son adorno: comprobar el permiso **contra la
// base**, tratar la colisión del índice único con un mensaje que se entienda, y dejar constancia.
// ============================================================================================

import { query } from "../shared/db.js";
import { emitToUser } from "../shared/socket.js";
import { esAdminEnBase } from "./permisos.js";

const SCHEMA = "gozz";

/**
 * Quién debe ser el propietario de un buzón que se está creando.
 *
 * 🔴 `owner_user_id` en el body es OPCIONAL y **solo lo respeta un admin**. Para cualquier otro se
 * ignora en silencio y el dueño es quien conecta: si no, cualquiera podría dejar un buzón a nombre
 * de otra persona —y con ello, meterle correspondencia en su bandeja— sin que nadie lo autorizara.
 *
 * La comprobación va aquí, en el servidor. Que el cliente mande o no el campo no decide nada.
 */
export async function resolverPropietarioAlCrear(
  solicitado: string | null | undefined,
  actorId: string
): Promise<{ ownerId: string; error?: string }> {
  const pedido = String(solicitado ?? "").trim();
  if (!pedido || pedido === actorId) return { ownerId: actorId };

  // 🔴 `esAdminEnBase`, NO el `isAdmin(u)` del JWT que usa el resto de este módulo. Los tokens
  // duran 365 días y no se refrescan: a un admin degradado le durarían los poderes hasta un año, y
  // esta acción entrega el acceso al correo de otra persona. Es la deuda D11, conocida y declarada;
  // lo que no se hace es añadir deuda nueva justo aquí.
  if (!(await esAdminEnBase(actorId))) return { ownerId: actorId };

  const destino = await usuarioActivo(pedido);
  if (!destino) return { ownerId: actorId, error: "El usuario indicado como propietario no existe o está inactivo" };
  return { ownerId: pedido };
}

/** El usuario destino tiene que existir Y estar activo: un buzón a nombre de una baja se pierde. */
async function usuarioActivo(userId: string): Promise<{ id: string; nombre: string | null } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  const [u] = await query<any>(
    `SELECT id, nombre FROM ${SCHEMA}.users WHERE id = $1 AND COALESCE(activo, true) = true`,
    [userId]
  );
  return u ?? null;
}

export type ResultadoCambioPropietario =
  | { ok: true; buzonId: string; anterior: string; nuevo: string; auditoriaId: string; aclRetirada: boolean }
  | { ok: false; motivo: "no_encontrado" }
  | { ok: false; motivo: "sin_permiso" }
  | { ok: false; motivo: "destino_invalido" }
  | { ok: false; motivo: "sin_cambio" }
  | { ok: false; motivo: "colision"; mensaje: string };

/**
 * Cambia el propietario. **Solo un admin**, comprobado contra la base.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 LA COLISIÓN DEL ÍNDICE ÚNICO
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `buzones_email` tiene `UNIQUE (owner_user_id, email)`. Si el propietario nuevo YA tiene ese mismo
 * correo conectado, el UPDATE viola el índice y Postgres devuelve un `23505`, que sin tratar sale
 * como un **500 genérico**: la persona lee "error interno" cuando lo que pasa es algo perfectamente
 * explicable. Se comprueba antes y **además** se captura el error, porque entre la comprobación y
 * el UPDATE cabe una carrera y el índice es el único que no se equivoca.
 *
 * ⚠️ La comprobación previa usa `LOWER(email)` y el índice no. Un mismo correo con distinta caja
 * cabría dos veces en la tabla; el índice no lo impediría y el aviso previo sí. Es más estricto que
 * la base a propósito: dos buzones que solo se distinguen por mayúsculas son el mismo buzón.
 */
export async function cambiarPropietario(
  buzonId: string,
  nuevoOwnerId: string,
  actorId: string
): Promise<ResultadoCambioPropietario> {
  // Ver la nota de arriba: contra la base, no contra el token.
  if (!(await esAdminEnBase(actorId))) return { ok: false, motivo: "sin_permiso" };

  const [buzon] = await query<any>(
    `SELECT id, email, owner_user_id FROM ${SCHEMA}.buzones_email WHERE id = $1`, [buzonId]
  );
  if (!buzon) return { ok: false, motivo: "no_encontrado" };

  const destino = await usuarioActivo(nuevoOwnerId);
  if (!destino) return { ok: false, motivo: "destino_invalido" };
  if (buzon.owner_user_id === nuevoOwnerId) return { ok: false, motivo: "sin_cambio" };

  const mensajeColision = "Esa persona ya tiene ese buzón conectado. Desvincúlaselo antes de traspasarle éste.";
  const [yaLoTiene] = await query<any>(
    `SELECT id FROM ${SCHEMA}.buzones_email
      WHERE owner_user_id = $1 AND LOWER(email) = LOWER($2) AND id <> $3 LIMIT 1`,
    [nuevoOwnerId, buzon.email, buzonId]
  );
  if (yaLoTiene) return { ok: false, motivo: "colision", mensaje: mensajeColision };

  const anterior = String(buzon.owner_user_id);
  try {
    await query(
      `UPDATE ${SCHEMA}.buzones_email SET owner_user_id = $1 WHERE id = $2`, [nuevoOwnerId, buzonId]
    );
  } catch (e: any) {
    // El índice es el árbitro final: entre la comprobación de arriba y esta línea cabe una carrera.
    if (e?.code === "23505") return { ok: false, motivo: "colision", mensaje: mensajeColision };
    throw e;
  }

  // Si el nuevo propietario tenía una fila de acceso compartido, sobra: ya es suya por ser dueña.
  // 🔴 El acceso del ANTERIOR no se toca. Que siga viendo el buzón, o no, es una decisión del admin
  // y tiene que ser visible: quitárselo aquí en silencio sería decidir por él sin decírselo.
  const retirada = await query<any>(
    `DELETE FROM ${SCHEMA}.buzon_acl WHERE buzon_id = $1 AND user_id = $2 RETURNING id`,
    [buzonId, nuevoOwnerId]
  );

  // ── Constancia ────────────────────────────────────────────────────────────────────────────
  // 🔴 Esta acción entrega la correspondencia de alguien. Sin rastro, no hay responsable.
  // Van los IDS y nada más: ni la contraseña del buzón, ni un solo correo. Mismo criterio que
  // `registrarExportacion` — la bitácora registra QUÉ pasó, no el contenido de lo que pasó.
  const [audit] = await query<any>(
    `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
     VALUES ($1, $2, 'buzones_email', $3, $4::jsonb, $5::jsonb) RETURNING id`,
    [
      actorId,
      `Cambió el propietario del buzón ${buzon.email}`,
      buzonId,
      JSON.stringify({ owner_user_id: anterior }),
      JSON.stringify({ owner_user_id: nuevoOwnerId, acl_retirada: retirada.length > 0 }),
    ]
  );

  return {
    ok: true,
    buzonId,
    anterior,
    nuevo: nuevoOwnerId,
    auditoriaId: audit.id,
    aclRetirada: retirada.length > 0,
  };
}

/**
 * Avisa al nuevo propietario. Va aparte del cambio y no lanza: el traspaso ya ocurrió, y perderlo
 * porque falle una notificación sería absurdo. Al revés —notificar sin traspasar— sí sería un
 * problema, y por eso se llama DESPUÉS.
 */
export async function notificarNuevoPropietario(
  nuevoOwnerId: string,
  buzon: { id: string; email: string }
): Promise<void> {
  try {
    await query(
      `INSERT INTO ${SCHEMA}.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
       VALUES ($1, 'sistema', $2, $3, 'alta', '/correo', $4::jsonb)`,
      [
        nuevoOwnerId,
        "Ahora eres responsable de un buzón",
        `El buzón ${buzon.email} pasó a tu nombre: su correo aparece en tu sección Correo y los avisos de ese buzón te llegan a ti.`,
        JSON.stringify({ buzon_id: buzon.id, email: buzon.email, motivo: "cambio_propietario" }),
      ]
    );
    // Sin el emit, la campanita no se entera hasta que alguien recargue la página (§3.4).
    emitToUser(nuevoOwnerId, "notificacion:nueva", { tipo: "sistema", buzon_id: buzon.id });
  } catch (e: any) {
    console.error("[buzon] notificarNuevoPropietario fail:", e?.message || e);
  }
}
