// ============================================================================================
// EXPORTACIÓN DE OPORTUNIDADES — qué sale, cuántas y en qué orden
//
// Una fila por oportunidad. ⚠️ Consecuencia que hay que saber ANTES de usar el fichero: un cliente
// con tres asilos ganados **aparece tres veces**, y si el CSV se sube tal cual a un CRM externo recibe
// tres mensajes. No es un defecto —exportar oportunidades es exactamente eso— pero conviene que
// un CRM externo deduplique por teléfono al importar. La exportación deduplicada por contacto llegará
// con la entrega de contactos.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 R11 — ES EL MAYOR RIESGO DE ESTA ENTREGA
// ════════════════════════════════════════════════════════════════════════════════════════════
// Esto produce **un fichero con datos de clientes que sale del edificio**, y la consulta une con
// `gozz.contactos_cache`, que guarda **SSN y credenciales de USCIS en claro** pese al sufijo
// `_enc`: `ssn_encrypted`, `clave_uscis_enc`, `clave_correo_uscis_enc`.
//
// La defensa es que **no hay camino para pedirlos**: el SELECT se arma EXCLUSIVAMENTE con las
// expresiones de `COLUMNAS_EXPORTABLES`, nunca con lo que mande el cliente y nunca con un `SELECT
// *`. Una clave fuera de la lista es un 400, no una columna más.
//
// Y hay una prueba que **genera el fichero y hace grep de los tres nombres sobre el contenido
// real**. Comprobar la lista es comprobar la intención; comprobar el fichero es comprobar el
// resultado — y es el resultado el que se le manda a un tercero.
// ============================================================================================

import { query } from "../shared/db.js";
import type { ColumnaSalida } from "./exportacion.js";
import type { Seleccion } from "./seleccion.js";
import { construirFiltroOportunidades, leerFiltrosOportunidades } from "./oportunidades-filtro.js";

const SCHEMA = "gozz";

/**
 * El FROM de la exportación.
 *
 * ⚠️ Los alias `o`, `c` y `tc` son los que espera `construirFiltroOportunidades`: **tienen que
 * llamarse así** o el WHERE compartido no compila. Los dos que se añaden aquí —`uv` para el
 * vendedor y `ps` para el nombre visible de la etapa— no los toca el filtro.
 */
const FROM_EXPORTACION = `
  FROM ${SCHEMA}.oportunidades o
  LEFT JOIN ${SCHEMA}.contactos_cache c   ON c.id  = o.contacto_id
  LEFT JOIN ${SCHEMA}.tramites_config tc  ON tc.id = o.tipo_tramite_id
  LEFT JOIN ${SCHEMA}.users up            ON up.id = o.preparador_id
  LEFT JOIN ${SCHEMA}.users uv            ON uv.id = o.vendedor_id
  LEFT JOIN ${SCHEMA}.pipeline_stages ps  ON ps.key = o.etapa`;

export interface ColumnaExportable extends ColumnaSalida {
  /** Para agrupar en el modal. No viaja al SQL. */
  grupo: string;
  /** La expresión SQL. **Es la única fuente del SELECT**: nunca se interpola nada del cliente. */
  sql: string;
  /** Si va marcada al abrir el modal. */
  pordefecto: boolean;
}

/**
 * 🔴 LA LISTA BLANCA. Lo que no está aquí no se puede exportar, y no hay parámetro que lo cambie.
 *
 * Las fechas se formatean en la base y no en JS para que salgan igual en CSV y en XLSX, y en un
 * formato que Excel y un CRM externo entienden sin pelearse.
 * ⚠️ `to_char` sobre un `timestamptz` usa la zona horaria de la SESIÓN de Postgres, no la del
 * usuario del CRM. Es la misma limitación declarada del filtro de fechas del tablero.
 */
export const COLUMNAS_EXPORTABLES: ColumnaExportable[] = [
  // ── Caso ──────────────────────────────────────────────────────────────────────────────────
  { clave: "nombre_caso",       etiqueta: "Caso",              grupo: "Caso",     pordefecto: true,  sql: "o.nombre_caso" },
  { clave: "etapa",             etiqueta: "Etapa",             grupo: "Caso",     pordefecto: true,  sql: "COALESCE(ps.label, o.etapa)" },
  { clave: "tramite",           etiqueta: "Trámite",           grupo: "Caso",     pordefecto: true,  sql: "tc.nombre" },
  { clave: "formulario_uscis",  etiqueta: "Formulario USCIS",  grupo: "Caso",     pordefecto: false, sql: "tc.formulario_uscis" },
  // ── Cliente ───────────────────────────────────────────────────────────────────────────────
  { clave: "contacto",          etiqueta: "Contacto",          grupo: "Cliente",  pordefecto: true,  sql: "c.nombre_completo" },
  { clave: "telefono",          etiqueta: "Teléfono",          grupo: "Cliente",  pordefecto: true,  sql: "c.telefono" },
  { clave: "whatsapp",          etiqueta: "WhatsApp",          grupo: "Cliente",  pordefecto: false, sql: "c.whatsapp" },
  { clave: "email",             etiqueta: "Email",             grupo: "Cliente",  pordefecto: true,  sql: "c.email" },
  // ── Dinero ────────────────────────────────────────────────────────────────────────────────
  { clave: "valor_total",       etiqueta: "Valor total",       grupo: "Dinero",   pordefecto: true,  sql: "o.valor_total" },
  { clave: "balance_pendiente", etiqueta: "Balance pendiente", grupo: "Dinero",   pordefecto: false, sql: "o.balance_pendiente" },
  // ── Personas ──────────────────────────────────────────────────────────────────────────────
  { clave: "preparador",        etiqueta: "Preparador",        grupo: "Personas", pordefecto: false, sql: "up.nombre" },
  { clave: "vendedor",          etiqueta: "Vendedor",          grupo: "Personas", pordefecto: false, sql: "uv.nombre" },
  // ── Plazos ────────────────────────────────────────────────────────────────────────────────
  // 🔴 Traducido, no en crudo. `o.sla_estado` guarda el identificador interno (`on_track`), y un
  // fichero que se abre en Excel o se sube a un CRM externo es texto de cara al usuario: §4.7 aplica
  // igual que en pantalla. Las cuatro etiquetas son **las mismas** que pinta `SLABadge.tsx`, no
  // unas nuevas: si el fichero y la pantalla llamaran distinto a lo mismo, uno de los dos sobra.
  //
  // El `ELSE` devuelve el valor original a propósito: si mañana aparece un estado que nadie mapeó,
  // que salga su identificador y **se note**, en vez de convertirse en una celda vacía que nadie
  // relaciona con nada. Mismo criterio que la etapa, que también traduce con `COALESCE`.
  {
    clave: "sla_estado", etiqueta: "Estado SLA", grupo: "Plazos", pordefecto: false,
    sql: `CASE o.sla_estado
            WHEN 'on_track'   THEN 'A tiempo'
            WHEN 'warning'    THEN 'Atención'
            WHEN 'vencido'    THEN 'Vencido'
            WHEN 'completado' THEN 'Cerrado'
            ELSE o.sla_estado
          END`,
  },
  { clave: "sla_fecha_limite",  etiqueta: "Fecha límite SLA",  grupo: "Plazos",   pordefecto: false, sql: "to_char(o.sla_fecha_limite, 'YYYY-MM-DD')" },
  { clave: "created_at",        etiqueta: "Fecha de creación", grupo: "Plazos",   pordefecto: false, sql: "to_char(o.created_at, 'YYYY-MM-DD HH24:MI')" },
  { clave: "fecha_completada",  etiqueta: "Fecha de ganado",   grupo: "Plazos",   pordefecto: false, sql: "to_char(o.fecha_completada, 'YYYY-MM-DD')" },
];

const POR_CLAVE = new Map(COLUMNAS_EXPORTABLES.map((c) => [c.clave, c]));

/** Lo que el modal necesita para pintarse: sin el SQL, que no es asunto del navegador. */
export const columnasParaLaInterfaz = () =>
  COLUMNAS_EXPORTABLES.map(({ clave, etiqueta, grupo, pordefecto }) => ({ clave, etiqueta, grupo, pordefecto }));

/**
 * Valida lo que pidió el cliente **contra la lista blanca**, no al revés.
 *
 * Devuelve las columnas en el ORDEN DE LA LISTA, no en el que llegaron: así dos exportaciones con
 * las mismas columnas producen la misma cabecera, que es lo que espera quien automatice la carga.
 */
export function validarColumnas(pedidas: any): { columnas?: ColumnaExportable[]; error?: string } {
  if (!Array.isArray(pedidas) || pedidas.length === 0) return { error: "columnas: elige al menos una" };
  const set = new Set(pedidas.map((c: any) => String(c)));
  const desconocidas = [...set].filter((c) => !POR_CLAVE.has(c));
  if (desconocidas.length > 0) {
    return { error: `columnas no permitidas: ${desconocidas.join(", ")}` };
  }
  return { columnas: COLUMNAS_EXPORTABLES.filter((c) => set.has(c.clave)) };
}

// --------------------------------------------------------------------------------------------
// El conjunto
// --------------------------------------------------------------------------------------------

/**
 * El WHERE de la selección. **El mismo constructor que usa la pantalla**, nunca uno propio.
 *
 * 🔴 Si la exportación construyera su WHERE, el fichero podría no coincidir con lo que el usuario
 * vio — y sería **indetectable hasta que alguien contara las filas**. Es la misma razón por la que
 * los contadores del tablero comparten el WHERE con la lista.
 */
export function whereDeSeleccion(
  seleccion: Seleccion,
  userId: string | null
): { where: string; params: any[] } {
  if (seleccion.modo === "ids") {
    return { where: "o.id = ANY($1::uuid[])", params: [seleccion.ids] };
  }
  const filtros = leerFiltrosOportunidades(seleccion.filtros || {});
  const { where, params } = construirFiltroOportunidades(filtros, userId);
  const wheres = [where].filter(Boolean);
  const excluidos = seleccion.excluidos || [];
  if (excluidos.length > 0) {
    params.push(excluidos);
    wheres.push(`NOT (o.id = ANY($${params.length}::uuid[]))`);
  }
  return { where: wheres.join(" AND ") || "true", params };
}

/**
 * Cuántas van a salir. **Se cuenta en el servidor con el mismo WHERE**, no se estima ni se deduce
 * de lo que el usuario marcó: con "seleccionar el total" no ha visto las filas, y este número es lo
 * único que le dice qué se está llevando. Si miente, se lleva otra cosa y no se entera.
 */
export async function contarExportables(seleccion: Seleccion, userId: string | null): Promise<number> {
  const { where, params } = whereDeSeleccion(seleccion, userId);
  const [r] = await query<any>(`SELECT count(*)::int AS n ${FROM_EXPORTACION} WHERE ${where}`, params);
  return r?.n ?? 0;
}

// --------------------------------------------------------------------------------------------
// La constancia
// --------------------------------------------------------------------------------------------

/**
 * Deja en `gozz.auditoria` que esta exportación ocurrió.
 *
 * 🔴 **Una exportación de datos de clientes que no deja rastro es una fuga sin responsable.** Queda
 * quién, cuándo, cuántas filas salieron, **con qué alcance** y **qué columnas**.
 *
 * ⚠️ SIN EL CONTENIDO. La bitácora registra **que salió, no lo que salió**: ni un nombre, ni un
 * teléfono, ni un email. Lo que se guarda de la selección es su ALCANCE —el filtro que se usó, o
 * los ids pedidos—, que es lo que permite reconstruir *qué conjunto* se llevó sin copiar los datos
 * de los clientes a una tabla que además es inmutable (§0.2). Un id no identifica a nadie fuera de
 * este sistema; un teléfono sí.
 *
 * No lanza: la descarga ya se hizo, y perderla por un fallo al registrarla sería absurdo. Lo que no
 * puede pasar es lo contrario —registrar y no descargar—, y por eso se llama DESPUÉS de escribir,
 * con el número real de filas. Antes sería registrar una intención.
 */
export async function registrarExportacion(datos: {
  userId: string | null;
  filas: number;
  formato: string;
  columnas: string[];
  seleccion: Seleccion;
  totalAlContar: number;
}): Promise<void> {
  const alcance = datos.seleccion.modo === "ids"
    ? { modo: "ids", n: datos.seleccion.ids.length, ids: datos.seleccion.ids }
    : { modo: "filtro", filtros: datos.seleccion.filtros ?? {}, excluidos: datos.seleccion.excluidos ?? [] };
  try {
    await query(
      `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       VALUES ($1, $2, 'oportunidades', 'exportacion', NULL, $3::jsonb)`,
      [
        datos.userId,
        `Exportó ${datos.filas} oportunidad${datos.filas === 1 ? "" : "es"} en ${datos.formato.toUpperCase()}`,
        JSON.stringify({
          filas: datos.filas,
          formato: datos.formato,
          columnas: datos.columnas,
          alcance,
          total_al_contar: datos.totalAlContar,
        }),
      ]
    );
  } catch (e: any) {
    console.error("[auditoria exportacion]", e?.message);
  }
}

/** Filas por viaje a la base. Nunca hay más de un lote vivo, sea cual sea el tamaño total. */
export const LOTE = 1000;

/**
 * Recorre el conjunto por lotes, en el MISMO orden que el tablero (`created_at DESC, id ASC`), para
 * que el fichero salga en el orden en que el usuario lo vio.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 KEYSET, NUNCA `OFFSET`
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `OFFSET 6000` obliga a Postgres a producir y descartar seis mil filas antes de devolver la
 * primera útil: el coste crece con la profundidad, y aquí la profundidad puede ser de miles. El
 * cursor va sobre `(created_at, id)`, que es exactamente la clave del orden.
 *
 * ⚠️ EL ORDEN ES MIXTO —`created_at DESC, id ASC`— así que **no se puede usar la comparación de
 * tuplas** `(a,b) < (x,y)`: esa solo vale cuando todas las columnas van en la misma dirección. Hay
 * que escribirlo desplegado.
 *
 * 🔴 Y `o.created_at` ADMITE NULL. En `ORDER BY … DESC` Postgres pone los NULL **primero**, y
 * `created_at < $1` es NULL para esas filas — o sea, **se quedarían fuera del recorrido en
 * silencio**, que es justo lo que este proyecto no acepta. Se recorren en dos tramos: primero el
 * bloque de los NULL ordenado por `id`, y después el resto. Medido en local: 0 filas con
 * `created_at` nulo, pero un recorrido que depende de que un dato opcional nunca sea nulo es un
 * recorte esperando a ocurrir.
 */
export async function* iterarExportables(
  seleccion: Seleccion,
  userId: string | null,
  columnas: ColumnaExportable[]
): AsyncGenerator<Record<string, any>[]> {
  const base = whereDeSeleccion(seleccion, userId);
  // El SELECT sale SOLO de la lista blanca. `id` y `created_at` van aparte, para el cursor.
  const select = columnas.map((c) => `${c.sql} AS "${c.clave}"`).join(", ");

  // `created_at` vuelve de `pg` como `Date`; se devuelve tal cual como parámetro del siguiente lote.
  let cursorCreated: any = undefined;
  let cursorId: string | null = null;
  let enTramoNulos = true;

  for (;;) {
    const params = [...base.params];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres = [base.where];

    if (cursorId === null) {
      // Primera página: desde el principio, que es el bloque de los NULL si lo hay.
    } else if (enTramoNulos) {
      // Seguimos dentro del bloque de `created_at IS NULL`, o ya saltamos al resto.
      wheres.push(`(o.created_at IS NOT NULL OR (o.created_at IS NULL AND o.id > ${addP(cursorId)}))`);
    } else {
      const pk = addP(cursorCreated);
      wheres.push(`o.created_at IS NOT NULL AND (o.created_at < ${pk} OR (o.created_at = ${pk} AND o.id > ${addP(cursorId)}))`);
    }

    const filas = await query<any>(
      `SELECT o.id AS "__id", o.created_at AS "__created", ${select}
       ${FROM_EXPORTACION}
       WHERE ${wheres.join(" AND ")}
       ORDER BY o.created_at DESC, o.id ASC
       LIMIT ${LOTE}`,
      params
    );
    if (filas.length === 0) return;

    const ultima = filas[filas.length - 1];
    cursorCreated = ultima.__created;
    cursorId = String(ultima.__id);
    enTramoNulos = ultima.__created === null;

    // Las dos columnas del cursor no son del fichero: se quitan antes de entregarlo.
    yield filas.map(({ __id, __created, ...resto }) => resto);

    if (filas.length < LOTE) return;
  }
}
