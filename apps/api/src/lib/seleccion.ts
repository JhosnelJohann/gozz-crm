// ============================================================================================
// EL CONTRATO DE SELECCIÓN — compartido por TODAS las acciones masivas
//
// Lo estrenó Contactos (archivar, fusionar, tareas, responsable) y lo usan ya el cambio masivo de
// etapa y la exportación de oportunidades. Vive aquí y no dentro de `contactos-routes.ts` porque
// **no es del dominio de contactos**: es la forma en que la interfaz dice "sobre estos" o "sobre
// todo lo que cumple este filtro", y una segunda copia sería una segunda validación que se separa.
//
// 🔴 POR QUÉ EXISTE EL MODO `filtro`. Con "seleccionar el total" pueden ser decenas de miles de
// ids: mandarlos en un body es lo que este contrato viene a evitar. Se manda **el filtro que el
// usuario tenía puesto** y el servidor resuelve el conjunto con **el mismo WHERE de la pantalla**,
// que es lo único que garantiza que la acción actúe sobre exactamente lo que se vio.
//
// `excluidos` es lo que el usuario desmarcó después de pulsar "seleccionar el total": el conjunto
// es "todo lo que cumple el filtro MENOS éstos".
// ============================================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Seleccion =
  | { modo: "ids"; ids: string[] }
  | { modo: "filtro"; filtros?: any; excluidos?: string[] };

/**
 * Valida lo que llega en `body.seleccion`.
 *
 * Devuelve error en vez de descartar en silencio: un id mal formado aquí no es ruido de query
 * string, es una fila que el usuario creyó estar incluyendo.
 */
export function parsearSeleccion(body: any): { seleccion?: Seleccion; error?: string } {
  const s = body?.seleccion;
  if (!s || typeof s !== "object") return { error: "seleccion requerida" };
  if (s.modo === "ids") {
    const ids = Array.isArray(s.ids) ? s.ids.map((x: any) => String(x)) : [];
    if (ids.length === 0) return { error: "seleccion.ids vacía" };
    if (!ids.every((id: string) => UUID_RE.test(id))) return { error: "seleccion.ids contiene ids inválidos" };
    return { seleccion: { modo: "ids", ids: [...new Set<string>(ids)] } };
  }
  if (s.modo === "filtro") {
    const excluidos = Array.isArray(s.excluidos) ? s.excluidos.map((x: any) => String(x)) : [];
    if (!excluidos.every((id: string) => UUID_RE.test(id))) return { error: "seleccion.excluidos contiene ids inválidos" };
    return { seleccion: { modo: "filtro", filtros: s.filtros ?? {}, excluidos } };
  }
  return { error: "seleccion.modo debe ser 'ids' o 'filtro'" };
}
