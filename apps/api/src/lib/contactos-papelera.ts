import { query } from "../shared/db.js";
import { tieneColumnasTrazabilidad } from "./contactos-archivado.js";

// ============================================================================================
// LA PAPELERA DE CONTACTOS (D8)
//
// La Ola 0 sustituyó el borrado físico por archivado lógico y REVERSIBLE: el motor, la
// trazabilidad (mig. 0056), el opt-in `?archivados=1` y el endpoint de vuelta. Lo que nunca
// construyó es la pantalla, y sin ella la reversibilidad era teórica — existía en la API, no para
// quien se equivoca.
//
// 🔴 NO ES UNA RUTA NUEVA. Es el listado de siempre con `archivados=1`, que ya es admin-only y ya
// pasa por el constructor único de filtro. Aquí vive solo lo PROPIO de la papelera —qué columnas y
// en qué orden—, para no duplicar filtro, paginación ni contador, que es justo de donde salieron
// los defectos que la Ola 1 arregló.
// ============================================================================================

const SCHEMA = "gozz";

/**
 * 🔴 PROYECCIÓN EXPLÍCITA, NUNCA `SELECT *` (R11). `contactos_cache` guarda SSN y credenciales
 * USCIS **en claro**, pese al sufijo `_enc`. Lo que no esté en esta lista no sale de la API, y la
 * lista es corta a propósito: la papelera necesita identificar a la persona y explicar el
 * archivado, nada más. No es `COLS_LISTA` recortada por casualidad — es su propio contrato.
 */
export const COLS_PAPELERA = `id, nombre_completo, email, telefono, whatsapp, tipo_cliente,
  created_at, archivado_motivo, fusionado_en_contacto_id`;

/** Solo si la mig. 0056 está aplicada. Ver `tieneColumnasTrazabilidad()`. */
export const COLS_PAPELERA_TRAZABILIDAD = `archivado_at, archivado_por`;

/**
 * El orden natural de una papelera es "lo último archivado, arriba": quien acaba de equivocarse
 * tiene que encontrar su contacto en la PRIMERA página, no en la 300. Antes se ordenaba por
 * `created_at`, que es cuándo se creó el contacto y no tiene nada que ver con cuándo se archivó.
 *
 * `NULLS LAST` porque ~27.800 filas históricas no tienen `archivado_at` y NO se les va a inventar
 * uno: sería escribir una fecha que jamás se registró y que nadie podría distinguir de una real
 * (§0, y la lección de la mig. 0060). Se muestran al final, como lo que son: sin fecha conocida.
 *
 * 🔴 El desempate por `id` NO es opcional: sin él, dos filas con el mismo `archivado_at` —y una
 * corrida masiva archiva miles en el mismo instante— pueden salir en dos páginas o en ninguna.
 * Es la lección de C6 de la Ola 1.
 */
export const ORDEN_PAPELERA = `ORDER BY archivado_at DESC NULLS LAST, created_at DESC, id ASC`;

/** Sin la 0056 la columna no existe: se degrada al orden de siempre en vez de reventar. */
export const ORDEN_PAPELERA_SIN_TRAZABILIDAD = `ORDER BY created_at DESC, id ASC`;

/**
 * Valor especial del filtro por autor: los archivados **sin** `archivado_por`.
 *
 * No es un hueco que tapar: son las corridas masivas de saneamiento, que no las hizo una persona, y
 * hoy son la inmensa mayoría (~27.700 de 27.805) porque `archivado_por` solo se rellena desde la
 * mig. `0056`. Mezclarlas con un usuario concreto sería mentir, y esconderlas dejaría el filtro
 * incapaz de encontrar justo lo que más hay. Es una categoría legítima y se ofrece como tal.
 */
export const SIN_USUARIO = "sin_usuario";

export interface FiltrosPapelera {
  motivo?: string;
  /** uuid de quien archivó, o `SIN_USUARIO`. */
  usuario?: string;
  desde?: string;
  hasta?: string;
}

/**
 * Las cláusulas propias de la papelera. Viven aquí y las compone el **constructor único de filtro**
 * de `contactos-routes.ts`, igual que las de dedup: así el listado, el contador de la cabecera y la
 * selección masiva comparten WHERE —un total que no cuadre con las filas es el defecto D2 otra
 * vez— y las pruebas ejercitan exactamente esto, no una copia.
 *
 * `addP` es el acumulador de parámetros del llamador: nada se interpola en el SQL.
 *
 * Los nombres de parámetro (`usuario`, `desde`, `hasta`) son los mismos que los de la papelera del
 * Drive a propósito, para que las dos pantallas se lean igual.
 */
export function sqlFiltrosPapelera(f: FiltrosPapelera, addP: (v: any) => string): string[] {
  const wheres: string[] = [];

  // Por MOTIVO. Coincidencia parcial a propósito: los motivos de corrida llevan sufijo
  // (`lead_sin_oportunidad:LEADS-CLEANUP-01`), así que buscar el prefijo tiene que valer.
  if (f.motivo) wheres.push(`archivado_motivo ILIKE ${addP(`%${f.motivo}%`)}`);

  // Por AUTOR. `SIN_USUARIO` no es "sin filtro": es su propia categoría (ver la constante).
  if (f.usuario) {
    wheres.push(f.usuario === SIN_USUARIO ? `archivado_por IS NULL` : `archivado_por = ${addP(f.usuario)}::uuid`);
  }

  // Por FECHA DE ARCHIVADO. Los dos extremos son opcionales e independientes.
  // ⚠️ Con cualquiera de los dos puesto, las filas con `archivado_at IS NULL` quedan fuera POR
  // CONSTRUCCIÓN: si no sabemos cuándo se archivaron, no caen en ningún rango. Es correcto y no se
  // arregla colándolas ni inventándoles fecha — se ENSEÑA el hueco, y para eso está
  // `contarArchivadosSinFecha()`.
  //
  // El extremo `hasta` llega ya cerrado a las 23:59:59.999 desde `DateRangePopover` (`endOfDay`),
  // así que este `<=` incluye el día completo. No se recorta aquí ni se le suma un día.
  if (f.desde) wheres.push(`archivado_at >= ${addP(f.desde)}::timestamptz`);
  if (f.hasta) wheres.push(`archivado_at <= ${addP(f.hasta)}::timestamptz`);

  return wheres;
}

export interface AutorPapelera {
  /** `null` = archivados sin autor registrado (corridas masivas). Es una categoría, no un hueco. */
  id: string | null;
  nombre: string | null;
  n: number;
}

/**
 * Las opciones del desplegable "archivado por", SACADAS DE LOS DATOS.
 *
 * No se lista `gozz.users`: son 16 usuarios y casi todos devolverían cero, porque
 * `archivado_por` solo se rellena desde la mig. `0056`. Un desplegable lleno de opciones vacías no
 * es un filtro, es ruido. Aquí solo aparece quien de verdad tiene contactos archivados a su nombre,
 * con su conteo y ordenado por conteo descendente.
 *
 * La fila con `id = null` son los ~27.700 sin autor: se agrupa en SQL como una más
 * (`GROUP BY archivado_por` mete los NULL en su propio grupo) y se ofrece como opción propia. Todo
 * se agrupa en la base, no trayendo filas para cruzarlas en JS (§3.6).
 */
export async function autoresDePapelera(): Promise<AutorPapelera[]> {
  if (!(await tieneColumnasTrazabilidad())) return [];
  return query<AutorPapelera>(
    `SELECT c.archivado_por AS id, u.nombre, count(*)::int AS n
       FROM ${SCHEMA}.contactos_cache c
       LEFT JOIN ${SCHEMA}.users u ON u.id = c.archivado_por
      WHERE COALESCE(c.archivado, false) = true
      GROUP BY c.archivado_por, u.nombre
      ORDER BY n DESC, u.nombre ASC NULLS LAST`
  );
}

/**
 * Cuántos archivados NO tienen fecha y por tanto no pueden caer en ningún rango.
 *
 * 🔴 ES LA CIFRA QUE EVITA UN SUSTO. Con "últimos 30 días" puesto, la papelera enseña cuatro filas
 * de 27.805; sin decir por qué, cualquiera concluye que se han perdido 27.800 contactos. No se
 * cuelan en el resultado para que "no falten" ni se les inventa fecha: se enseña el hueco, igual
 * que cada fila enseña su "sin fecha registrada".
 *
 * Se cuenta con el resto de filtros activos (motivo, búsqueda, autor) pero SIN el rango — el
 * llamador pasa ese WHERE—, porque la pregunta es "de lo que estás mirando, cuánto se queda fuera
 * por no tener fecha", no "cuántos hay en toda la base".
 */
export async function contarArchivadosSinFecha(where: string, params: any[]): Promise<number> {
  if (!(await tieneColumnasTrazabilidad())) return 0;
  const r = await query<any>(
    `SELECT count(*)::int AS n FROM ${SCHEMA}.contactos_cache
      WHERE ${where} AND archivado_at IS NULL`,
    params
  );
  return r[0]?.n ?? 0;
}

export interface PaginaPapelera {
  items: any[];
  /** false = la mig. 0056 no está aplicada en este entorno; no hay quién/cuándo que mostrar. */
  trazabilidad: boolean;
}

/**
 * Una página de la papelera. Recibe el WHERE ya construido por el constructor único de filtro
 * (nada de duplicarlo aquí) y su lista de parámetros.
 *
 * EL NOMBRE DE QUIEN ARCHIVÓ se resuelve en una consulta APARTE sobre los ids de la página, no con
 * un subselect correlacionado. La primera versión lo hacía correlacionado y se descartó midiéndolo:
 * el planificador lo evalúa por cada fila que atraviesa el `OFFSET`, no solo por las devueltas, así
 * que el coste crecía con la profundidad de la página — 60 ms en la primera, 475 ms en la última,
 * con 27.800 evaluaciones. Con la consulta aparte la última página baja a ~162 ms y la primera a
 * ~59 ms, y son como mucho 100 ids que casi siempre resuelven 2 o 3 usuarios distintos.
 * (Tampoco con JOIN: el WHERE del constructor referencia `contactos_cache` sin alias.)
 */
export async function listarPapelera(
  where: string,
  params: any[],
  pageSize: number,
  offset: number
): Promise<PaginaPapelera> {
  const trazabilidad = await tieneColumnasTrazabilidad();
  const cols = trazabilidad ? `${COLS_PAPELERA}, ${COLS_PAPELERA_TRAZABILIDAD}` : COLS_PAPELERA;
  const orden = trazabilidad ? ORDEN_PAPELERA : ORDEN_PAPELERA_SIN_TRAZABILIDAD;

  const items = await query<any>(
    `SELECT ${cols} FROM ${SCHEMA}.contactos_cache
      WHERE ${where} ${orden} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  if (trazabilidad && items.length) {
    const autores = [...new Set(items.map((c) => c.archivado_por).filter(Boolean))];
    const nombres = autores.length
      ? new Map(
          (await query<any>(`SELECT id, nombre FROM ${SCHEMA}.users WHERE id = ANY($1::uuid[])`, [autores]))
            .map((u) => [u.id, u.nombre] as [string, string])
        )
      : new Map<string, string>();
    for (const c of items) c.archivado_por_nombre = c.archivado_por ? nombres.get(c.archivado_por) ?? null : null;
  }

  return { items, trazabilidad };
}
