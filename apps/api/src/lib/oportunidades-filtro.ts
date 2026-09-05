// ============================================================================================
// FILTRO DE OPORTUNIDADES — una sola definición, tres consumidores.
//
// POR QUÉ EXISTE: hasta ahora el tablero pedía `terminal_limit=150` y **filtraba en el navegador**
// sobre ese array ya recortado, mientras el badge de cada columna salía de un `count(*)` SIN NINGÚN
// WHERE. Resultado medido: con el filtro "Asilo", GANADO enseñaba 2 casos y su badge decía 6.920.
// El sistema nunca dijo "hay 2 asilos ganados": dijo "de mi muestra de 150, 2 son de asilo".
//
// Es la misma causa raíz que C6/D2 en Contactos —`LIMIT` sin `OFFSET` y conteos por otro camino—,
// en otro módulo. Y la cura es la misma: **el filtro se construye UNA vez y lo usan la lista, el
// contador de cada etapa y la paginación**. Si el contador y las filas se calcularan por separado,
// volveríamos a tener un número que miente, que es peor que no tener número.
//
// 🔴 DOS PLANOS QUE NO SE MEZCLAN, y es la distinción que hace correcto este fichero:
//
//   FILTROS SEMÁNTICOS (los de aquí): qué oportunidades le interesan al usuario — trámite,
//   asignado, SLA, búsqueda, etapa, rango de fechas. **Los conteos por etapa se calculan con
//   ESTOS**, porque la pregunta "¿cuántos asilos ganados hay?" no depende de cuántos se hayan
//   cargado en pantalla.
//
//   CLÁUSULAS DE MUESTREO (`estado=abiertas`, `terminal_limit`, `limit`): cuánto se trae para no
//   inflar el payload. Son del transporte, no del significado, y **NO entran en los conteos**: si
//   entraran, el contador volvería a describir la muestra en vez de la realidad.
// ============================================================================================

/** Valor especial del filtro de trámite: las oportunidades SIN trámite asignado. */
export const SIN_TRAMITE = "sin_tramite";

/**
 * Sobre qué columna se aplica el rango `desde`/`hasta`.
 *
 * 🔴 LISTA BLANCA, Y ES OBLIGATORIA. Un nombre de columna **no puede ir como placeholder `$n`**
 * —Postgres no lo admite—, así que acaba concatenado en el SQL. La única forma segura de dejar
 * elegir columna es que el valor no venga del usuario sino de esta lista: lo que llega por query
 * string se usa para *seleccionar* una de estas constantes, nunca para construir el SQL. Es la
 * excepción declarada a §3.1, y así se cumple igual.
 */
export const CAMPOS_FECHA = {
  /** Cuándo se creó el caso. La de siempre: es la conducta previa y sigue siendo la de por defecto. */
  created_at: "o.created_at",
  /** Cuándo se ganó. ⚠️ La tiene una minoría de las ganadas — ver `sin_fecha`. */
  fecha_completada: "o.fecha_completada",
} as const;

export type CampoFecha = keyof typeof CAMPOS_FECHA;
export const CAMPO_FECHA_POR_DEFECTO: CampoFecha = "created_at";
const esCampoFecha = (v: any): v is CampoFecha => Object.prototype.hasOwnProperty.call(CAMPOS_FECHA, String(v));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETAPA_RE = /^[a-z0-9_]{1,40}$/;
const SLA_VALIDOS = new Set(["on_track", "warning", "vencido", "completado"]);

export interface FiltrosOportunidades {
  q?: string;
  /** uuid de `tramites_config`, o `SIN_TRAMITE`. */
  tramite?: string;
  /** uuid: coincide como preparador O como vendedor, que es como lo entiende la pantalla. */
  asignado?: string;
  sla?: string;
  /** Solo las del usuario que pregunta. Necesita `userId`. */
  solo_mios?: boolean;
  etapa?: string;
  /** Rango de fechas (ISO). Sobre la columna que diga `campo_fecha`. */
  desde?: string;
  hasta?: string;
  /** Qué fecha se filtra. Por defecto `created_at`, que es la conducta de siempre. */
  campo_fecha?: CampoFecha;
}

const fechaValida = (v: any): string | undefined => {
  const s = String(v ?? "").trim();
  return s && !isNaN(Date.parse(s)) ? s : undefined;
};

/**
 * Normaliza lo que llega por query string. Lo que no encaja se descarta en silencio en vez de
 * llegar al SQL: un `sla=; DROP TABLE` no es un error del usuario, es ruido, y el filtro
 * simplemente no se aplica.
 */
export function leerFiltrosOportunidades(src: any): FiltrosOportunidades {
  const tramite = String(src?.tramite ?? "").trim();
  const asignado = String(src?.asignado ?? "").trim();
  const sla = String(src?.sla ?? "").trim();
  const etapa = String(src?.etapa ?? "").trim();
  return {
    q: String(src?.q ?? "").trim() || undefined,
    tramite: tramite === SIN_TRAMITE || UUID_RE.test(tramite) ? tramite : undefined,
    asignado: UUID_RE.test(asignado) ? asignado : undefined,
    sla: SLA_VALIDOS.has(sla) ? sla : undefined,
    solo_mios: ["1", "true", "yes"].includes(String(src?.solo_mios ?? "").toLowerCase()) || src?.solo_mios === true,
    etapa: ETAPA_RE.test(etapa) ? etapa : undefined,
    desde: fechaValida(src?.desde),
    hasta: fechaValida(src?.hasta),
    // Un valor desconocido cae al de siempre en vez de dar error: mismo criterio que el resto.
    campo_fecha: esCampoFecha(src?.campo_fecha) ? src.campo_fecha : CAMPO_FECHA_POR_DEFECTO,
  };
}

/** La columna real, resuelta desde la lista blanca. Nunca desde lo que mandó el usuario. */
const columnaFecha = (f: FiltrosOportunidades): string =>
  CAMPOS_FECHA[f.campo_fecha ?? CAMPO_FECHA_POR_DEFECTO] ?? CAMPOS_FECHA[CAMPO_FECHA_POR_DEFECTO];

/** ¿Trae el usuario algún filtro semántico puesto? Sirve para no cambiar de conducta sin motivo. */
export const hayFiltros = (f: FiltrosOportunidades): boolean =>
  !!(f.q || f.tramite || f.asignado || f.sla || f.solo_mios || f.etapa || f.desde || f.hasta);

/**
 * Construye el WHERE + params. `desde` permite continuar la numeración de `$n` del llamador, igual
 * que en `construirFiltroContactos`.
 *
 * Los alias son los de la consulta del tablero: `o` oportunidades, `c` contacto, `tc` trámite.
 *
 * `userId` solo hace falta para `solo_mios`; si no viene, ese filtro se ignora en vez de devolver
 * un conjunto vacío silencioso.
 */
export function construirFiltroOportunidades(
  f: FiltrosOportunidades,
  userId: string | null,
  desde = 0
): { where: string; params: any[] } {
  const params: any[] = [];
  const addP = (v: any) => { params.push(v); return `$${desde + params.length}`; };
  const wheres: string[] = [];

  if (f.q) {
    // Búsqueda por nombre del caso, del contacto o del trámite: los tres sitios donde la gente
    // busca. Parametrizada, como todo lo demás (§3.1).
    const p = addP(`%${f.q}%`);
    wheres.push(`(o.nombre_caso ILIKE ${p} OR c.nombre_completo ILIKE ${p} OR tc.nombre ILIKE ${p})`);
  }

  if (f.tramite === SIN_TRAMITE) {
    // 🔴 Las oportunidades sin trámite asignado. Medido en producción: 242, de ellas 223 GANADAS.
    // Hoy son invisibles —el filtro solo ofrece trámites concretos— y por tanto imposibles de
    // segmentar para una campaña y también de encontrar para corregirlas. Se enseña el hueco en vez
    // de esconderlo, la misma idea que el "sin usuario registrado" de la papelera de contactos.
    wheres.push(`o.tipo_tramite_id IS NULL`);
  } else if (f.tramite) {
    wheres.push(`o.tipo_tramite_id = ${addP(f.tramite)}::uuid`);
  }

  if (f.asignado) {
    // Preparador O vendedor: para quien filtra, "asignado a Ana" es cualquiera de los dos papeles.
    const p = addP(f.asignado);
    wheres.push(`(o.preparador_id = ${p}::uuid OR o.vendedor_id = ${p}::uuid)`);
  }

  if (f.sla) wheres.push(`o.sla_estado = ${addP(f.sla)}`);

  if (f.solo_mios && userId) {
    const p = addP(userId);
    wheres.push(`(o.preparador_id = ${p}::uuid OR o.vendedor_id = ${p}::uuid)`);
  }

  if (f.etapa) wheres.push(`o.etapa = ${addP(f.etapa)}`);

  // El rango va sobre la columna que diga `campo_fecha`. Y una fila con esa columna en NULL
  // **queda fuera**, porque `NULL >= x` no es cierto. No es un descuido: si no sabemos cuándo pasó
  // algo, no cabe en ningún rango. Lo que NO se hace es colarla para que "no falte" — se cuenta y
  // se enseña el hueco (ver `sin_fecha` en `consultarOportunidades`).
  const col = columnaFecha(f);
  if (f.desde) wheres.push(`${col} >= ${addP(f.desde)}::timestamptz`);
  if (f.hasta) wheres.push(`${col} <= ${addP(f.hasta)}::timestamptz`);

  return { where: wheres.join(" AND "), params };
}

/**
 * ORDEN DEL TABLERO Y DE LA LISTA.
 *
 * 🔴 El desempate por `id` NO es opcional. Sin él, dos oportunidades con el mismo `created_at`
 * —y las importaciones masivas crearon miles en el mismo instante— pueden salir en dos páginas
 * distintas o en ninguna al paginar. Es exactamente la lección de C6 en Contactos.
 */
export const ORDEN_OPORTUNIDADES = `ORDER BY o.created_at DESC, o.id ASC`;

/** Tamaños de página admitidos. Lista blanca, no rango: un pageSize=100000 tumba la API. */
export const PAGE_SIZES_OPORTUNIDADES = [20, 50, 100];

// --------------------------------------------------------------------------------------------
// La consulta del tablero
// --------------------------------------------------------------------------------------------

/** Las columnas que salen de la API. Enumeradas para que se vea qué se devuelve. */
export const COLS_OPORTUNIDAD = `
  o.id, o.nombre_caso, o.etapa, o.valor_total, o.balance_pendiente, o.sla_estado, o.sla_fecha_limite, o.created_at,
  o.preparador_id, o.vendedor_id, o.tipo_tramite_id,
  c.id AS contacto_id, c.nombre_completo AS contacto_nombre, c.telefono AS contacto_telefono,
  tc.nombre AS tramite_nombre, tc.codigo AS tramite_codigo, tc.formulario_uscis, tc.color AS tramite_color,
  u.nombre AS preparador_nombre, u.foto_perfil_url AS preparador_avatar,
  (SELECT COUNT(*)::int FROM gozz.tareas t WHERE t.oportunidad_id = o.id AND t.estado NOT IN ('completada','cancelada')) AS tareas_pendientes`;

export const FROM_OPORTUNIDAD = `
  FROM gozz.oportunidades o
  LEFT JOIN gozz.contactos_cache c ON c.id = o.contacto_id
  LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
  LEFT JOIN gozz.users u ON u.id = o.preparador_id`;

export interface MuestreoOportunidades {
  /** `abiertas` = solo no terminales. Parámetro histórico, se conserva tal cual. */
  estado?: string;
  /** Todas las abiertas + las N terminales más recientes. Parámetro histórico. */
  terminalLimit?: number | null;
  /** Tope duro de filas. Parámetro histórico. */
  hardLimit?: number | null;
}

export interface OpcionesConsulta {
  filtros: FiltrosOportunidades;
  userId: string | null;
  muestreo?: MuestreoOportunidades;
  /** Si viene, se pagina. Si no, la respuesta es la de siempre. */
  page?: number;
  pageSize?: number;
}

export interface PaginaOportunidades {
  oportunidades: any[];
  /** Cuántas hay en CADA etapa con los filtros puestos (sin restringir por etapa). */
  counts: Record<string, number>;
  /**
   * Cuántas quedan FUERA del rango por no tener la fecha, en cada etapa. Solo viene cuando hay un
   * rango activo; si no, la pregunta no existe. Misma forma que `counts` a propósito: el cliente
   * suma las etapas que esté mirando, igual que ya hace con los contadores.
   */
  sin_fecha?: Record<string, number>;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

/**
 * Arma y ejecuta la consulta del tablero.
 *
 * 🔴 SIN OPCIONES, DEVUELVE EXACTAMENTE LO DE SIEMPRE. Es lo que protege a `EmailDetailDrawer`,
 * que llama al endpoint sin un solo parámetro y espera la lista completa: si la paginación fuese el
 * comportamiento por defecto, esa pantalla se quedaría corta **sin dar ningún error**.
 *
 * Vive aquí y no dentro de la ruta para que las pruebas ejerciten esta misma función y no una copia
 * suya — que es lo único que hace que el test de compatibilidad signifique algo.
 */
export async function consultarOportunidades(
  ejecutar: <T = any>(sql: string, params?: any[]) => Promise<T[]>,
  opts: OpcionesConsulta
): Promise<PaginaOportunidades> {
  const { filtros, userId } = opts;
  const paginando = opts.page != null || opts.pageSize != null;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 50;

  const sem = construirFiltroOportunidades(filtros, userId);

  // Cláusulas de muestreo: solo cuando NO se pagina. Con paginación real ya no hace falta recortar
  // a ojo, y mezclar las dos cosas daría totales que no cuadran con las filas.
  const muestreo: string[] = [];
  const paramsMuestreo: any[] = [];
  const m = opts.muestreo ?? {};
  if (!paginando && !filtros.q) {
    if (m.estado === "abiertas") {
      muestreo.push(`o.etapa NOT IN ('ganado','perdido')`);
    } else if (m.terminalLimit != null) {
      // Parametrizado. Antes el número se interpolaba en el SQL: estaba acotado por `Math.min`,
      // pero interpolar valores es lo que §3.1 prohíbe y no hay razón para dejarlo así.
      paramsMuestreo.push(m.terminalLimit);
      muestreo.push(`(o.etapa NOT IN ('ganado','perdido') OR o.id IN (
        SELECT id FROM gozz.oportunidades WHERE etapa IN ('ganado','perdido')
         ORDER BY created_at DESC, id ASC LIMIT $${sem.params.length + paramsMuestreo.length}))`);
    }
  }

  const condiciones = [sem.where, ...muestreo].filter(Boolean);
  const whereSql = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const paramsLista = [...sem.params, ...paramsMuestreo];

  const topeDuro = paginando ? null : (m.hardLimit ?? (filtros.q ? 400 : null));
  let limitSql = topeDuro != null ? `LIMIT ${Number(topeDuro)}` : "";
  const paramsFinal = [...paramsLista];
  if (paginando) {
    paramsFinal.push(pageSize, (page - 1) * pageSize);
    limitSql = `LIMIT $${paramsFinal.length - 1} OFFSET $${paramsFinal.length}`;
  }

  // Los conteos usan el MISMO where semántico pero SIN la etapa: la pregunta es "¿cuántos hay en
  // cada columna con estos filtros?" y restringir por etapa la dejaría sin sentido. El muestreo
  // tampoco entra: si entrara, el contador volvería a describir la muestra en vez de la realidad,
  // que es exactamente el defecto que este cambio viene a corregir.
  const paraConteos = construirFiltroOportunidades({ ...filtros, etapa: undefined }, userId);

  // ============================================================================================
  // 🔴 CUÁNTAS QUEDAN FUERA POR NO TENER LA FECHA
  //
  // Medido en producción: solo **431 de las 6.920 ganadas** tienen `fecha_completada`. Las otras
  // 6.489 son importaciones que nunca pasaron por el flujo que la escribe. Filtrar por "fecha de
  // ganado" deja fuera al **94%** — y un vendedor que ponga "últimos 30 días" verá cuatro filas y
  // concluirá que no se ha ganado nada este mes.
  //
  // No se cuelan en el resultado para que "no falten" y **no se les rellena la fecha**: eso sería
  // inventar historia, y aquí se usaría para decidir a quién se le manda una campaña. Se cuentan y
  // se enseña el hueco, igual que la papelera de contactos (`contarArchivadosSinFecha`).
  //
  // Se calcula con el MISMO WHERE **menos el rango**: la pregunta es "de lo que estás mirando,
  // cuánto se queda fuera", no cuántas hay en toda la base. Y agrupado por etapa, como `counts`,
  // porque el tablero pide una etapa por columna y la lista puede tener una sola seleccionada.
  // ============================================================================================
  const hayRango = !!(filtros.desde || filtros.hasta);
  const paraSinFecha = hayRango
    ? construirFiltroOportunidades({ ...filtros, etapa: undefined, desde: undefined, hasta: undefined }, userId)
    : null;
  const colFecha = columnaFecha(filtros);

  const [oportunidades, countRows, totalRows, sinFechaRows] = await Promise.all([
    ejecutar<any>(`SELECT ${COLS_OPORTUNIDAD} ${FROM_OPORTUNIDAD} ${whereSql} ${ORDEN_OPORTUNIDADES} ${limitSql}`, paramsFinal),
    ejecutar<any>(
      `SELECT o.etapa, count(*)::int AS n ${FROM_OPORTUNIDAD}
        ${paraConteos.where ? `WHERE ${paraConteos.where}` : ""} GROUP BY o.etapa`,
      paraConteos.params
    ),
    paginando
      ? ejecutar<any>(`SELECT count(*)::int AS total ${FROM_OPORTUNIDAD} ${whereSql}`, paramsLista)
      : Promise.resolve([] as any[]),
    paraSinFecha
      ? ejecutar<any>(
          `SELECT o.etapa, count(*)::int AS n ${FROM_OPORTUNIDAD}
            WHERE ${[paraSinFecha.where, `${colFecha} IS NULL`].filter(Boolean).join(" AND ")}
            GROUP BY o.etapa`,
          paraSinFecha.params
        )
      : Promise.resolve([] as any[]),
  ]);

  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.etapa] = r.n;

  let sin_fecha: Record<string, number> | undefined;
  if (paraSinFecha) {
    sin_fecha = {};
    for (const r of sinFechaRows) sin_fecha[r.etapa] = r.n;
  }

  if (!paginando) return { oportunidades, counts, sin_fecha };
  const total = totalRows[0]?.total ?? 0;
  return { oportunidades, counts, sin_fecha, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
