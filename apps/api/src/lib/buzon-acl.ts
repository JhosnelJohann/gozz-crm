// ============================================================================================
// EL PERMISO DE UNA PERSONA SOBRE UN BUZÓN COMPARTIDO — cambiarlo sin retirarle el acceso
//
// `gozz.buzon_acl` dice quién entra a un buzón que no es suyo y qué puede hacer dentro: `ver`
// (leer la bandeja) o `enviar` (leer **y además** escribir en nombre de esa dirección). La regla que
// lo aplica es `userCanSeeBuzon` en `email-routes.ts`.
//
// 🔴 POR QUÉ EXISTE ESTE FICHERO: había cómo dar acceso y cómo quitarlo, pero no cómo CAMBIARLO. El
// único camino para pasar a alguien de `enviar` a `ver` era borrarle la fila y volver a agregarlo
// con el otro permiso. Eso no es una molestia de dos clics — es un procedimiento que, en el hueco
// entre el borrado y el alta, deja a la persona sin acceso, y que si se interrumpe a la mitad
// (alguien cierra el modal, se va la conexión) la deja **fuera del buzón** cuando lo que se quería
// era solo bajarle un permiso. Corregir un permiso no puede pasar por retirarlo.
//
// ⚠️ ESTO NO DECIDE QUIÉN PUEDE TOCARLO. La autorización —dueño del buzón o admin— es de la ruta,
// que es donde está el usuario que pide. Aquí solo se valida el permiso y se cambia la fila.
// ============================================================================================

import { query } from "../shared/db.js";

/**
 * Los dos únicos valores válidos. `permiso` es un TEXT con DEFAULT 'ver' y **sin CHECK** en la base
 * (`0009_email.sql`), así que la columna aceptaría cualquier cadena: la lista vive aquí.
 */
export const PERMISOS_ACL = ["ver", "enviar"] as const;

export type PermisoAcl = (typeof PERMISOS_ACL)[number];

export const esPermisoAcl = (v: unknown): v is PermisoAcl =>
  typeof v === "string" && (PERMISOS_ACL as readonly string[]).includes(v);

export type FilaAcl = {
  id: string;
  user_id: string | null;
  posicion: string | null;
  permiso: PermisoAcl;
};

export type ResultadoCambioPermiso =
  | { ok: true; acl: FilaAcl; antes: PermisoAcl; cambio: boolean }
  | { ok: false; motivo: "permiso_invalido" | "no_encontrada" };

/**
 * Cambia el permiso de UNA fila de acceso, dejándola donde está.
 *
 * 🔴 NO COERCIONA UN VALOR RARO A `ver`, que es lo que hace el POST de al lado
 * (`body.permiso === "enviar" ? "enviar" : "ver"`). Ahí un `permiso: "enviarr"` se guarda como
 * `ver` sin decir nada, y quien lo pidió se queda creyendo que concedió el envío. En un cambio de
 * permisos, adivinar es peor que fallar: un valor que no es ninguno de los dos se rechaza.
 *
 * 🔴 Se filtra TAMBIÉN por `buzon_id`, no solo por el id de la fila. Sin eso, quien administra un
 * buzón podría editar la ACL de otro cualquiera pasando su id: el dueño se comprueba contra el
 * buzón de la URL, así que la fila tiene que ser de ESE buzón para que la comprobación signifique
 * algo.
 *
 * Distingue "no cambió nada" de "cambió" (`cambio`) porque no es lo mismo para quien lo pide:
 * pedir el permiso que ya tenía es correcto y no es un error, pero decirle "hecho" sugiere que
 * movió algo. El valor anterior sale de la MISMA sentencia que escribe el nuevo —subconsulta sobre
 * la misma instantánea—, no de un SELECT previo que otra petición podría dejar obsoleto.
 */
export async function cambiarPermisoAcl(
  buzonId: string,
  aclId: string,
  permiso: unknown
): Promise<ResultadoCambioPermiso> {
  if (!esPermisoAcl(permiso)) return { ok: false, motivo: "permiso_invalido" };

  const filas = await query<any>(
    `UPDATE gozz.buzon_acl a
        SET permiso = $3
       FROM (SELECT id, permiso FROM gozz.buzon_acl WHERE id = $1 AND buzon_id = $2) antes
      WHERE a.id = antes.id
      RETURNING a.id, a.user_id, a.posicion, a.permiso, antes.permiso AS permiso_antes`,
    [aclId, buzonId, permiso]
  );
  if (filas.length === 0) return { ok: false, motivo: "no_encontrada" };

  const f = filas[0];
  return {
    ok: true,
    acl: { id: f.id, user_id: f.user_id, posicion: f.posicion, permiso: f.permiso },
    antes: f.permiso_antes,
    cambio: f.permiso_antes !== f.permiso,
  };
}
