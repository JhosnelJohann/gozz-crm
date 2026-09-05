import { pool, query } from "../shared/db.js";

// ============================================================================
// ARCHIVADO LÓGICO DE CONTACTOS — única fuente de verdad (CONVENCIONES §3.5).
//
// En este CRM NADA se borra: "eliminar un contacto" es marcarlo `archivado = true`. La fila
// sobrevive con todo lo que cuelga de ella (oportunidades, tareas, documentos, notas, emails) y
// la operación es reversible. El borrado físico definitivo existe SOLO como script manual de
// super_admin sobre archivados antiguos, y nunca se dispara desde la API.
//
// ⚠️ POR QUÉ ESTE MÓDULO ES DELICADO — leer antes de tocarlo:
// Hasta la OLA 0, `DELETE /api/contactos/:id` hacía un DELETE físico. Ese DELETE estaba
// accidentalmente protegido: 4 FKs hacia contactos_cache están en ON DELETE NO ACTION
// (oportunidades.contacto_id, oportunidades.referido_por_contacto_id, tareas.contacto_id,
// drive_folders.contacto_id), así que Postgres lo abortaba con 23503 en cuanto el contacto tenía
// UNA sola relación. Al pasar a archivado lógico esa red de seguridad DESAPARECE: ahora se puede
// archivar un contacto con 12 oportunidades sin que nada proteste. Eso se compensa con:
//   · contarImpacto() → la UI dice EXACTAMENTE qué arrastra, antes de confirmar.
//   · el registro obligatorio en gozz.auditoria que hace archivarContactos().
//   · la purga, que excluye a cualquier contacto con relaciones.
// Si quitas cualquiera de las tres, el sistema queda más permisivo que antes sin compensación.
//
// Las 2 FKs en ON DELETE CASCADE (followup_coach_messages / followup_coach_state) NO se tocan:
// al no haber DELETE dejan de dispararse, y el historial del coach sobrevive apuntando al
// contacto archivado. Es lo correcto.
// ============================================================================

const SCHEMA = "gozz";

export interface ImpactoContacto {
  id: string;
  nombre_completo: string | null;
  archivado: boolean;
  oportunidades: number;
  tareas: number;
  documentos: number;
  carpetas_drive: number;
  notas: number;
  emails: number;
  coach_mensajes: number;
  /** Suma de todo lo anterior. 0 = el contacto no arrastra nada. */
  total: number;
}

/**
 * Conteos REALES de lo que arrastra cada contacto (nunca estimados), para la confirmación
 * informada previa a archivar.
 *
 * UNA sola consulta para N contactos, no una por contacto: cada relación se agrega con
 * `WHERE ... = ANY($1) GROUP BY 1` y se une por LEFT JOIN contra `unnest($1)`. Con selección
 * masiva esto es la diferencia entre 1 viaje y N viajes (CONVENCIONES §3.6).
 *
 * `documentos` no es un conteo directo: los archivos no cuelgan del contacto sino de las carpetas
 * de su subárbol de Drive, así que se desciende recursivamente desde la carpeta tipo='contact'.
 */
export async function contarImpacto(ids: string[]): Promise<ImpactoContacto[]> {
  const unicos = [...new Set((ids || []).filter(Boolean))];
  if (unicos.length === 0) return [];

  const rows = await query<any>(
    `WITH RECURSIVE objetivo AS (
       SELECT c.id, c.nombre_completo, COALESCE(c.archivado, false) AS archivado
         FROM ${SCHEMA}.contactos_cache c
        WHERE c.id = ANY($1::uuid[])
     ),
     -- Subárbol de Drive de cada contacto: raíz tipo='contact' + todos sus descendientes.
     -- Se arrastra contacto_id en la recursión para poder agrupar al final.
     drive_sub AS (
       SELECT f.id, f.contacto_id
         FROM ${SCHEMA}.drive_folders f
        WHERE f.tipo = 'contact' AND f.contacto_id = ANY($1::uuid[]) AND f.deleted_at IS NULL
       UNION ALL
       SELECT h.id, s.contacto_id
         FROM ${SCHEMA}.drive_folders h
         JOIN drive_sub s ON h.parent_id = s.id
        WHERE h.deleted_at IS NULL
     ),
     ops AS (
       SELECT contacto_id AS id, count(*)::int n FROM ${SCHEMA}.oportunidades
        WHERE contacto_id = ANY($1::uuid[]) GROUP BY 1
     ),
     tar AS (
       SELECT contacto_id AS id, count(*)::int n FROM ${SCHEMA}.tareas
        WHERE contacto_id = ANY($1::uuid[]) GROUP BY 1
     ),
     carp AS (
       SELECT contacto_id AS id, count(*)::int n FROM drive_sub GROUP BY 1
     ),
     docs AS (
       SELECT s.contacto_id AS id, count(*)::int n
         FROM drive_sub s
         JOIN ${SCHEMA}.drive_files df ON df.folder_id = s.id AND df.deleted_at IS NULL
        GROUP BY 1
     ),
     nts AS (
       SELECT contacto_id AS id, count(*)::int n FROM ${SCHEMA}.contactos_notas
        WHERE contacto_id = ANY($1::uuid[]) GROUP BY 1
     ),
     mails AS (
       SELECT contacto_id AS id, count(*)::int n FROM ${SCHEMA}.emails
        WHERE contacto_id = ANY($1::uuid[]) GROUP BY 1
     ),
     coach AS (
       SELECT user_id AS id, count(*)::int n FROM ${SCHEMA}.followup_coach_messages
        WHERE user_id = ANY($1::uuid[]) GROUP BY 1
     )
     SELECT o.id, o.nombre_completo, o.archivado,
            COALESCE(ops.n, 0)   AS oportunidades,
            COALESCE(tar.n, 0)   AS tareas,
            COALESCE(docs.n, 0)  AS documentos,
            COALESCE(carp.n, 0)  AS carpetas_drive,
            COALESCE(nts.n, 0)   AS notas,
            COALESCE(mails.n, 0) AS emails,
            COALESCE(coach.n, 0) AS coach_mensajes
       FROM objetivo o
       LEFT JOIN ops   ON ops.id   = o.id
       LEFT JOIN tar   ON tar.id   = o.id
       LEFT JOIN carp  ON carp.id  = o.id
       LEFT JOIN docs  ON docs.id  = o.id
       LEFT JOIN nts   ON nts.id   = o.id
       LEFT JOIN mails ON mails.id = o.id
       LEFT JOIN coach ON coach.id = o.id
      ORDER BY o.nombre_completo NULLS LAST, o.id`,
    [unicos]
  );

  return rows.map((r) => ({
    id: r.id,
    nombre_completo: r.nombre_completo,
    archivado: r.archivado,
    oportunidades: r.oportunidades,
    tareas: r.tareas,
    documentos: r.documentos,
    carpetas_drive: r.carpetas_drive,
    notas: r.notas,
    emails: r.emails,
    coach_mensajes: r.coach_mensajes,
    total:
      r.oportunidades + r.tareas + r.documentos + r.carpetas_drive +
      r.notas + r.emails + r.coach_mensajes,
  }));
}

// ---------------------------------------------------------------------------------------------
// Compatibilidad con la migración 0056 (archivado_at / archivado_por).
//
// TEMPORAL — retirar cuando la 0056 esté aplicada en local, staging y prod.
// El deploy es automático al mergear, pero `pnpm migrate` se corre A MANO. Entre ambos momentos
// hay una ventana en la que el código nuevo convive con el esquema viejo; si el UPDATE nombrara
// columnas inexistentes, archivar devolvería 500 en producción. Se resuelve preguntando UNA vez
// al catálogo (resultado cacheado en el proceso) y armando el SET en consecuencia. Sin la 0056 el
// archivado funciona igual; solo se pierde el quién/cuándo en la fila (queda en `auditoria`).
// ---------------------------------------------------------------------------------------------
let columnasTrazabilidad: boolean | null = null;

/**
 * Exportada porque el motor de fusión (`contactos-merge.ts`) también archiva y necesita EXACTAMENTE
 * la misma defensa: sin ella, en un entorno sin la 0056 la fusión reventaría al nombrar columnas
 * que no existen. Una sola fuente de verdad y una sola consulta al catálogo, cacheada.
 */
export async function tieneColumnasTrazabilidad(): Promise<boolean> {
  if (columnasTrazabilidad !== null) return columnasTrazabilidad;
  const rows = await query<any>(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'contactos_cache'
        AND column_name IN ('archivado_at', 'archivado_por')`,
    [SCHEMA]
  );
  columnasTrazabilidad = (rows[0]?.n ?? 0) === 2;
  if (!columnasTrazabilidad) {
    console.warn("[contactos-archivado] migración 0056 no aplicada: se archiva sin archivado_at/archivado_por (el quién/cuándo queda solo en auditoria)");
  }
  return columnasTrazabilidad;
}

export interface ResultadoArchivado {
  /** Contactos sobre los que se escribió de verdad. */
  afectados: ImpactoContacto[];
  /** Contactos que ya estaban en el estado pedido: no se tocaron (idempotencia). */
  sin_cambios: string[];
}

export interface OpcionesArchivado {
  /** uuid del usuario que ejecuta. null = proceso automático. */
  userId: string | null;
  motivo: string;
}

/**
 * Archiva contactos (soft delete) y deja constancia en gozz.auditoria, con los CONTEOS DEL
 * MOMENTO — para que dentro de un año se sepa qué arrastraba ese contacto cuando se archivó.
 *
 * Todo en UNA transacción: si la auditoría falla, el archivado se revierte. El registro no es
 * "best effort" como en otros sitios del proyecto; aquí es parte de la operación.
 * Idempotente: los que ya estaban archivados se ignoran y NO generan fila de auditoría.
 */
export async function archivarContactos(ids: string[], opts: OpcionesArchivado): Promise<ResultadoArchivado> {
  return cambiarEstadoArchivado(ids, opts, true);
}

/**
 * Desarchiva contactos y lo audita igual. El archivado es reversible de verdad: este es el camino
 * de vuelta. Limpia motivo y trazabilidad, pero NO toca `fusionado_en_contacto_id`: deshacer una
 * FUSIÓN no es esto — eso lo hace el revert del motor de dedup por `corrida_id`, que además
 * devuelve las FKs reasignadas. Desarchivar a mano al perdedor de una fusión lo dejaría visible
 * pero vacío, así que ese caso se bloquea en la ruta.
 */
export async function desarchivarContactos(ids: string[], opts: OpcionesArchivado): Promise<ResultadoArchivado> {
  return cambiarEstadoArchivado(ids, opts, false);
}

// =============================================================================================
// RESURRECCIÓN — desarchivado AUTOMÁTICO del flujo Leads→Clientes.
//
// Varios caminos desarchivan solos cuando un contacto pasa a ser cliente (p. ej. crear una
// oportunidad). Eso es correcto para
// los archivados AUTOMÁTICOS —el contacto se archivó por ser un lead sin oportunidad, y acaba de
// dejar de serlo—, pero NO para los archivados A MANO: si alguien "eliminó" un contacto desde el
// CRM y el sync lo revive en silencio, el borrado lógico no vale nada.
//
// La distinción se hace por el MOTIVO, que es el único dato que dice quién lo archivó y por qué.
// =============================================================================================

/** Prefijos de `archivado_motivo` que marcan un archivado automático, reversible por el sistema. */
const MOTIVOS_ARCHIVADO_AUTOMATICO = ["lead_sin_oportunidad", "fusionado"];

/** ¿Este archivado lo hizo un proceso (true) o una persona (false)? Sin motivo → se trata como
 *  manual: ante la duda se PRESERVA la decisión humana, que es la regla del proyecto. */
export function esArchivadoAutomatico(motivo: string | null | undefined): boolean {
  const m = String(motivo ?? "").trim().toLowerCase();
  if (!m) return false;
  return MOTIVOS_ARCHIVADO_AUTOMATICO.some((p) => m.startsWith(p));
}

// ---------------------------------------------------------------------------------------------
// ¿Se puede devolver este contacto al listado?
//
// La regla vive AQUÍ y no dentro de la ruta para que se pueda probar y para que haya una sola
// fuente de verdad: la papelera (D8) necesita saber lo mismo que el endpoint, y si cada uno
// decidiera por su cuenta, la pantalla acabaría ofreciendo un botón que el servidor rechaza.
// ---------------------------------------------------------------------------------------------
export interface ComprobacionDesarchivado {
  existe: boolean;
  bloqueado: boolean;
  error?: string;
  fusionado_en_contacto_id?: string | null;
}

/**
 * 🔴 UN PERDEDOR DE FUSIÓN NO SE DESARCHIVA A MANO. Sus oportunidades, tareas, notas y archivos ya
 * se reasignaron al ganador, así que reaparecería VISIBLE Y VACÍO, y con datos duplicados a medias.
 * Deshacer una fusión no es esto: es revertir su corrida completa en el motor de dedup, que además
 * devuelve las FKs a su sitio.
 */
export async function comprobarDesarchivado(id: string): Promise<ComprobacionDesarchivado> {
  const c = (await query<any>(
    `SELECT id, archivado, fusionado_en_contacto_id FROM ${SCHEMA}.contactos_cache WHERE id = $1`,
    [id]
  ))[0];
  if (!c) return { existe: false, bloqueado: false };
  if (c.fusionado_en_contacto_id) {
    return {
      existe: true,
      bloqueado: true,
      error: "Este contacto se archivó al fusionarlo con otro. Para recuperarlo hay que revertir la fusión completa, no desarchivarlo.",
      fusionado_en_contacto_id: c.fusionado_en_contacto_id,
    };
  }
  return { existe: true, bloqueado: false, fusionado_en_contacto_id: null };
}

export interface ResultadoResurreccion {
  /** true si el contacto quedó activo tras la llamada por acción de ésta. */
  desarchivado: boolean;
  /** true si estaba archivado A MANO y se respetó (no se desarchivó). */
  bloqueado: boolean;
  motivo_original?: string | null;
}

/**
 * Desarchiva un contacto SOLO si su archivado fue automático. Si lo archivó una persona, lo deja
 * como está y registra el intento en `gozz.auditoria` — quién o qué proceso quiso revivirlo.
 * Ese registro es el punto: sin él, el intento sería invisible y nadie sabría por qué un contacto
 * "eliminado" sigue apareciendo en un flujo automático.
 *
 * No lanza: se llama desde caminos de sync que no deben romperse por esto.
 */
export async function desarchivarAutomatico(
  contactoId: string,
  opts: { origen: string; userId?: string | null }
): Promise<ResultadoResurreccion> {
  if (!contactoId) return { desarchivado: false, bloqueado: false };
  try {
    const c = (await query<any>(
      `SELECT id, nombre_completo, archivado, archivado_motivo
         FROM ${SCHEMA}.contactos_cache WHERE id = $1`, [contactoId]
    ))[0];
    if (!c || c.archivado !== true) return { desarchivado: false, bloqueado: false };

    if (!esArchivadoAutomatico(c.archivado_motivo)) {
      await query(
        `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
         VALUES ($1, $2, 'contactos_cache', $3, $4::jsonb, $5::jsonb)`,
        [
          opts.userId ?? null,
          `Intento de desarchivar automáticamente el contacto "${c.nombre_completo || "(sin nombre)"}" (${opts.origen}): BLOQUEADO, lo archivó una persona`,
          c.id,
          JSON.stringify({ archivado: true, archivado_motivo: c.archivado_motivo, origen_intento: opts.origen }),
          JSON.stringify({ archivado: true, resultado: "bloqueado" }),
        ]
      ).catch((e: any) => console.error("[resurreccion auditoria]", e?.message));
      console.warn(`[resurreccion] ${opts.origen}: contacto ${c.id} sigue archivado (motivo manual: "${c.archivado_motivo}")`);
      return { desarchivado: false, bloqueado: true, motivo_original: c.archivado_motivo };
    }

    // Archivado automático → se comporta como siempre: desarchiva sin ruido.
    await query(
      `UPDATE ${SCHEMA}.contactos_cache SET archivado = false, archivado_motivo = NULL WHERE id = $1 AND archivado IS TRUE`,
      [c.id]
    );
    return { desarchivado: true, bloqueado: false, motivo_original: c.archivado_motivo };
  } catch (e: any) {
    console.error("[resurreccion]", opts.origen, e?.message);
    return { desarchivado: false, bloqueado: false };
  }
}

async function cambiarEstadoArchivado(
  ids: string[],
  opts: OpcionesArchivado,
  archivar: boolean
): Promise<ResultadoArchivado> {
  const unicos = [...new Set((ids || []).filter(Boolean))];
  if (unicos.length === 0) return { afectados: [], sin_cambios: [] };

  // Los conteos se miden ANTES de escribir: son el estado que se audita.
  const impacto = await contarImpacto(unicos);
  const objetivo = impacto.filter((c) => c.archivado !== archivar);
  const sinCambios = impacto.filter((c) => c.archivado === archivar).map((c) => c.id);
  if (objetivo.length === 0) return { afectados: [], sin_cambios: sinCambios };

  const conTrazabilidad = await tieneColumnasTrazabilidad();
  const idsObjetivo = objetivo.map((c) => c.id);

  // SET y params se arman a la vez para que la cantidad de placeholders coincida SIEMPRE con la
  // de parámetros: al desarchivar no hay motivo ni autor que escribir, así que $2 no existe.
  const sets: string[] = [];
  const params: any[] = [idsObjetivo];
  if (archivar) {
    params.push(opts.motivo);
    sets.push(`archivado = true`, `archivado_motivo = $${params.length}`);
    if (conTrazabilidad) {
      params.push(opts.userId);
      sets.push(`archivado_at = now()`, `archivado_por = $${params.length}`);
    }
  } else {
    sets.push(`archivado = false`, `archivado_motivo = NULL`);
    if (conTrazabilidad) sets.push(`archivado_at = NULL`, `archivado_por = NULL`);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Una sola sentencia para todo el conjunto (§3.6): nada de UPDATE por contacto en un bucle.
    await client.query(
      `UPDATE ${SCHEMA}.contactos_cache SET ${sets.join(", ")}, updated_at = now() WHERE id = ANY($1::uuid[])`,
      params
    );
    // Auditoría en UNA sola sentencia (§3.6). Antes era un INSERT por contacto dentro del bucle:
    // con "seleccionar el total" eso son miles de viajes a la base en una misma transacción.
    // `unnest` de arrays paralelos mete las N filas de golpe manteniendo el valor por contacto.
    await client.query(
      `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       SELECT $1, x.accion, 'contactos_cache', x.registro_id, x.antes, x.despues
         FROM unnest($2::text[], $3::text[], $4::jsonb[], $5::jsonb[])
              AS x(accion, registro_id, antes, despues)`,
      [
        opts.userId,
        objetivo.map((c) =>
          archivar
            ? `Archivó el contacto "${c.nombre_completo || "(sin nombre)"}"`
            : `Desarchivó el contacto "${c.nombre_completo || "(sin nombre)"}"`),
        objetivo.map((c) => c.id),
        objetivo.map((c) => JSON.stringify({
          archivado: c.archivado,
          // El estado del contacto en el momento del cambio: qué arrastraba. Sin esto, dentro
          // de un año la fila de auditoría no dice nada sobre el alcance de lo que se hizo.
          arrastraba: {
            oportunidades: c.oportunidades, tareas: c.tareas, documentos: c.documentos,
            carpetas_drive: c.carpetas_drive, notas: c.notas, emails: c.emails,
            coach_mensajes: c.coach_mensajes, total: c.total,
          },
        })),
        objetivo.map(() => JSON.stringify({ archivado: archivar, archivado_motivo: archivar ? opts.motivo : null })),
      ]
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }

  return { afectados: objetivo, sin_cambios: sinCambios };
}
