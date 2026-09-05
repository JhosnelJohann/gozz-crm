// ==============================================================================================
// LO QUE SE LE PIDE A `GET /api/tareas` — una sola construcción para las tres cargas
//
// La pantalla de Tareas hace TRES peticiones al mismo endpoint: la lista principal, la columna de
// completadas y la de canceladas. Las tres llevan los mismos filtros y solo cambian en el estado.
//
// 🔴 POR QUÉ ESTO ESTÁ AQUÍ Y NO INLINE EN LA PANTALLA. Estaban escritas tres veces, y **ya se ha
// pagado dos veces el mismo error**: al añadir un filtro se le pasaba a una de las tres y las otras
// dos seguían trayendo lo de todo el mundo. No falla ruidosamente — las columnas se pintan
// perfectamente, solo que con tareas que no tocaban—. Escrito una vez, un filtro nuevo entra en las
// tres o en ninguna. Es `CONVENCIONES §4.8`.
//
// ⚠️ Esto NO pide nada por red: devuelve los parámetros. Es la capa que se prueba sin navegador (§9.1).
// ==============================================================================================

/**
 * Qué relación tengo yo con la tarea. Los valores son los del servidor (`lib/tareas-vinculo.ts` de
 * la API) — son un contrato, no texto de pantalla.
 *
 * 🔴 `observador` es EXCLUYENTE: no suma a `defecto`, lo sustituye. Y `defecto` **no** incluye lo
 * que uno solo observa, porque observar es mirar, no tener la tarea.
 */
export const VINCULOS = ["defecto", "creador", "asignado", "observador"] as const;
export type Vinculo = (typeof VINCULOS)[number];

export const VINCULO_POR_DEFECTO: Vinculo = "defecto";

/** Lo que lee la persona. Ni «propietario» ni `propietario_id`: en pantalla es «Creador» (§4.7). */
export const ETIQUETAS_VINCULO: Record<Vinculo, string> = {
  defecto: "Por defecto",
  creador: "Creador",
  asignado: "Asignado",
  observador: "Observador",
};

export function esVinculo(v: unknown): v is Vinculo {
  return typeof v === "string" && (VINCULOS as readonly string[]).includes(v);
}

/** Dónde se recuerda la elección entre visitas. Preferencia de quien mira, no dato de negocio. */
export const CLAVE_VINCULO = "crm_tareas_vinculo";

/**
 * Lo guardado, si vale. Si no —una clave a medio escribir, un valor de una versión anterior, o
 * `localStorage` que ni siquiera se puede leer—, el valor por defecto.
 *
 * Se devuelve un `Vinculo` y nunca `null`: quien llama no tiene que decidir qué hacer con la nada.
 */
export function vinculoGuardado(leer: () => string | null): Vinculo {
  try {
    const v = leer();
    return esVinculo(v) ? v : VINCULO_POR_DEFECTO;
  } catch {
    // Modo incógnito, o el navegador con el almacenamiento capado. Da igual: se usa el de siempre.
    return VINCULO_POR_DEFECTO;
  }
}

export type EstadoFiltro = "todas" | "activas" | "vencidas" | "completadas";

export interface FiltrosDeTareas {
  scope: "mine" | "all";
  vinculo: Vinculo;
  /** Ver la bandeja de otra persona. */
  asUserId?: string | null;
  /** Filtro por cliente, del enlace de la ficha del contacto. */
  contactoId?: string | null;
  q?: string;
  estadoFiltro: EstadoFiltro;
}

/**
 * Los parámetros de una de las tres cargas.
 *
 * @param estadoFijo Lo que distingue a las columnas de completadas y canceladas: piden **ese**
 *   estado y se saltan el filtro de la barra. La lista principal no lo pasa.
 */
export function consultaDeTareas(f: FiltrosDeTareas, estadoFijo?: "completada" | "cancelada"): URLSearchParams {
  const qs = new URLSearchParams({ scope: f.scope });

  if (f.asUserId) qs.set("as_user_id", f.asUserId);
  // Siempre explícito, también cuando es el de por defecto: así lo que se pide se lee en la propia
  // petición y no hay que saberse cuál era el valor implícito para interpretar un log.
  qs.set("vinculo", f.vinculo);

  if (estadoFijo) {
    qs.set("estado", estadoFijo);
  } else if (f.estadoFiltro === "completadas") {
    qs.set("estado", "completada");
  } else if (f.estadoFiltro === "todas") {
    // PERF: el backend excluye completadas y canceladas por defecto (son 25.000+ filas). Solo se
    // piden cuando de verdad se van a enseñar.
    qs.set("include_completed", "true");
  }

  const q = (f.q || "").trim();
  if (q) qs.set("q", q);
  if (f.contactoId) qs.set("contacto_id", f.contactoId);

  return qs;
}
