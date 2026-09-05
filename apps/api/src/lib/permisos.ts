import { query } from "../shared/db.js";

// ════════════════════════════════════════════════════════════════════════════════════════════
// AUTORIZACIÓN — una sola puerta. Ver `docs/CONVENCIONES.md` §2.
//
// Modelo: `nivel_acceso` (admin/super_admin) cubre lo amplio; `gozz.user_permisos` cubre los
// permisos granulares por usuario, sin ensuciar la tabla `users` con una columna por permiso.
//
// 🔴 TODO se resuelve CONTRA LA BASE, nunca contra el JWT. Los tokens duran **365 días y no se
// refrescan**: a quien le retiren el rol de admin lo sigue llevando en su token hasta un año. Un
// `u.nivel` no dice qué es esa persona hoy, dice qué era cuando entró.
// ════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ¿Puede este usuario, AHORA MISMO? Rol amplio o permiso granular, siempre desde la base.
 *
 * **Una sola consulta**, porque `/api/auth/me` la llama en cada carga de página. Y exige `activo`:
 * un usuario desactivado no puede, ni siquiera con la fila de `user_permisos` puesta — antes sí
 * podía, y eso era el agujero.
 *
 * Nombres de permiso (§2.7): `verbo_objeto` para hacer (`editar_monto`, `exportar_contactos`);
 * `aprobar_<valor del ENUM tipo_solicitud>` para aprobar (`aprobar_oportunidad_monto`) — que es lo
 * que hace el permiso derivable del `tipo` de la solicitud, sin `switch` (§10.3).
 */
export async function puede(userId: string | null | undefined, permiso: string): Promise<boolean> {
  if (!userId || !permiso) return false;
  const rows = await query(
    `SELECT 1 FROM gozz.users u
      WHERE u.id = $1 AND COALESCE(u.activo, true) = true
        AND (u.nivel_acceso IN ('admin','super_admin')
             OR EXISTS (SELECT 1 FROM gozz.user_permisos p
                         WHERE p.user_id = u.id AND p.permiso = $2))
      LIMIT 1`,
    [userId, permiso]
  );
  return rows.length > 0;
}

/**
 * ¿QUIÉNES pueden? La misma regla que `puede()`, del revés.
 *
 * Existe para notificar: cuando alguien deja una solicitud hay que avisar **a quien pueda
 * aprobarla**, y eso no es "los admin" — es quien pase la regla, admins incluidos sin nombrarlos.
 * Escribir aquí un `WHERE nivel_acceso IN (...)` sería volver a cablear el rol por la puerta de
 * atrás: quien tenga el permiso granular se enteraría de la solicitud solo si además fuese admin.
 */
export async function quienesPueden(permiso: string): Promise<string[]> {
  if (!permiso) return [];
  const rows = await query<any>(
    `SELECT u.id FROM gozz.users u
      WHERE COALESCE(u.activo, true) = true
        AND (u.nivel_acceso IN ('admin','super_admin')
             OR EXISTS (SELECT 1 FROM gozz.user_permisos p
                         WHERE p.user_id = u.id AND p.permiso = $1))`,
    [permiso]
  );
  return rows.map((r: any) => String(r.id));
}

/**
 * ¿Qué TIPOS de solicitud puede aprobar este usuario?
 *
 * Sale del propio ENUM `tipo_solicitud` aplicando la convención `aprobar_<valor>` (§10.3): **el
 * permiso es derivable del tipo**, así que esto no lleva lista de tipos ni `switch`, y un tipo nuevo
 * queda cubierto en cuanto se añade al ENUM. Una sola consulta, no una por tipo.
 *
 * Para qué hace falta: la bandeja tiene que (a) enseñarle la solicitud a quien pueda resolverla y
 * (b) **no ofrecer el botón a quien no puede usarlo** — enseñarlo para que devuelva 403 es mala UX
 * y confunde sobre quién manda.
 */
export async function tiposQuePuedeAprobar(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const rows = await query<any>(
    `SELECT e.enumlabel::text AS tipo
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'gozz' AND t.typname = 'tipo_solicitud'
        AND EXISTS (
              SELECT 1 FROM gozz.users u
               WHERE u.id = $1 AND COALESCE(u.activo, true) = true
                 AND (u.nivel_acceso IN ('admin','super_admin')
                      OR EXISTS (SELECT 1 FROM gozz.user_permisos p
                                  WHERE p.user_id = u.id AND p.permiso = 'aprobar_' || e.enumlabel)))`,
    [userId]
  );
  return rows.map((r: any) => String(r.tipo));
}

/**
 * ¿Es una persona ACTIVA del CRM, ahora mismo?
 *
 * Es la puerta más baja que existe: no distingue rol ni permiso, solo que la cuenta siga viva.
 *
 * 🔴 NO ES REDUNDANTE CON `requireAuth`. Ese middleware solo verifica la firma del JWT, y los
 * tokens de este CRM **duran 365 días y no se refrescan**: a alguien que se fue de la empresa se le
 * pone `activo = false`, pero su token sigue siendo válido hasta un año. Para todo lo que dé acceso
 * a datos de clientes, "tiene un token" no basta — hay que preguntarle a la base si esa persona
 * sigue estando.
 */
export async function esUsuarioActivo(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const rows = await query(
    "SELECT 1 FROM gozz.users WHERE id = $1 AND COALESCE(activo, true) = true LIMIT 1",
    [userId]
  );
  return rows.length > 0;
}

/**
 * ¿Es admin AHORA MISMO, según la base?
 *
 * Es la puerta del **rol amplio sin permiso nombrado detrás**: los sitios que hoy piden "admin" a
 * secas y todavía no tienen un `verbo_objeto` propio. Cuando lo tengan, pasan a `puede()` y esto
 * desaparece.
 *
 * ⚠️ La mayoría de endpoints antiguos siguen usando el `isAdmin(u)` del JWT (archivar, fusionar,
 * revertir, descuentos). Es deuda conocida y declarada — **D11**, entrega propia —, no un criterio
 * distinto: lo correcto es consultar la base, como hace esto.
 */
export async function esAdminEnBase(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const rows = await query<any>(
    "SELECT nivel_acceso FROM gozz.users WHERE id = $1 AND COALESCE(activo, true) = true",
    [userId]
  );
  const nivel = rows[0]?.nivel_acceso;
  return nivel === "admin" || nivel === "super_admin";
}

/**
 * ¿Puede editar el monto directo de una oportunidad (y, por tanto, aprobar los cambios de monto y
 * de pago)?
 *
 * Conserva el nombre porque tiene 11 puntos de llamada, pero por dentro **ya no mira el JWT**:
 * es `puede(u?.sub, "editar_monto")` y nada más. `u` sigue siendo el payload del token
 * (`{ sub, email, nivel }`), del que solo se usa `sub` — la identidad, que sí es estable.
 */
export async function puedeEditarMontoDirecto(u: any): Promise<boolean> {
  return puede(u?.sub, "editar_monto");
}
