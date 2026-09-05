import { pool, query } from "../shared/db.js";

// ============================================================================================
// ACCIONES MASIVAS SOBRE CONTACTOS — cambiar responsable y crear tareas (OLA 3 · F1, F3)
//
// Las dos llevaban meses deshabilitadas con "próximamente" en el desplegable de la barra.
//
// ⚠️ REGLA QUE MANDA EN TODO ESTE FICHERO (§3.6): **una sentencia sobre el conjunto**, nunca un
// bucle de N sentencias. Con "seleccionar el total" el conjunto son miles de contactos, y un
// UPDATE por contacto son miles de viajes a la base dentro de la misma transacción. Lo mismo vale
// para la auditoría: `unnest` de arrays paralelos mete las N filas de golpe conservando el valor
// de cada una. Es el patrón que ya usa `archivarContactos()`.
//
// 🔴 Y UNA NOTIFICACIÓN, NO N. Asignar 3.806 contactos a alguien no puede dejarle 3.806 filas en
// `notificaciones` ni dispararle 3.806 eventos de socket: eso no es avisar, es inutilizar la
// campanita. Se manda una que resume, con su `emitToUser` detrás (§3.4).
// ============================================================================================

const SCHEMA = "gozz";

// --------------------------------------------------------------------------------------------
// A · CAMBIAR RESPONSABLE
// --------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee `responsableId` del cuerpo distinguiendo AUSENTE de `null`.
 *
 * 🔴 NO SON LO MISMO Y LA DIFERENCIA CUESTA CARO. `null` explícito significa "quítales el
 * responsable"; un campo que no viene significa que el cliente se lo dejó. Si se tratan igual, un
 * `undefined` —un typo en la clave, un estado de React sin inicializar— asigna "sin responsable" a
 * cientos de contactos sin que nadie lo haya pedido y sin que salte nada.
 *
 * Vive aquí y no dentro de la ruta para que sea comprobable.
 */
export function leerResponsableId(body: any): { responsableId?: string | null; error?: string } {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "responsableId")) {
    return { error: "responsableId requerido. Para quitar el responsable manda responsableId: null de forma explícita." };
  }
  const crudo = body.responsableId;
  if (crudo === null) return { responsableId: null };
  if (typeof crudo === "string" && UUID_RE.test(crudo)) return { responsableId: crudo };
  return { error: "responsableId debe ser un uuid o null" };
}

/**
 * ¿Se le pueden asignar contactos a este usuario? Se comprueba ANTES de escribir nada: un
 * responsable inexistente o dado de baja tiene que ser un 400, no un UPDATE que deja cientos de
 * contactos apuntando a basura.
 */
export async function validarResponsableAsignable(
  responsableId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (responsableId === null) return { ok: true };   // quitar el responsable siempre es válido
  const [usuario] = await query<any>(
    `SELECT id, nombre, COALESCE(activo, true) AS activo FROM ${SCHEMA}.users WHERE id = $1`,
    [responsableId]
  );
  if (!usuario) return { ok: false, error: "el responsable indicado no existe" };
  if (!usuario.activo) return { ok: false, error: `"${usuario.nombre}" está inactivo: no se le pueden asignar contactos` };
  return { ok: true };
}

export interface ResultadoResponsable {
  /** Contactos a los que de verdad se les cambió el responsable. */
  cambiados: number;
  /** Ya tenían ese responsable: no se tocaron y no generan auditoría (idempotencia). */
  sin_cambios: number;
  /** Para el aviso: a quién hay que notificar y cuántos contactos le tocan. */
  notificar?: { userId: string; contactos: number };
}

/**
 * Asigna (o quita, con `responsableId = null`) el responsable de un conjunto de contactos.
 *
 * Todo en UNA transacción: si la auditoría falla, la asignación se revierte. El registro no es
 * "mejor esfuerzo" — sin el responsable ANTERIOR en `datos_antes` la acción no es reversible ni
 * revisable, que es justo lo que hace falta cuando alguien reasigna 500 fichas por error.
 *
 * Idempotente: los que ya tenían ese responsable se ignoran y no generan fila de auditoría.
 */
export async function asignarResponsable(
  ids: string[],
  responsableId: string | null,
  opts: { userId: string | null }
): Promise<ResultadoResponsable> {
  const unicos = [...new Set((ids || []).filter(Boolean))];
  if (unicos.length === 0) return { cambiados: 0, sin_cambios: 0 };

  const client = await pool.connect();
  try {
    await client.query("begin");

    // El estado ANTES, en una consulta. `IS DISTINCT FROM` y no `<>` porque NULL entra en juego en
    // los dos lados: quitar el responsable a quien no tiene ninguno no es un cambio.
    const previos = (await client.query(
      `SELECT id, nombre_completo, responsable_user_id
         FROM ${SCHEMA}.contactos_cache
        WHERE id = ANY($1::uuid[])
        FOR UPDATE`,
      [unicos]
    )).rows;

    const objetivo = previos.filter((c: any) => (c.responsable_user_id ?? null) !== responsableId);
    const sinCambios = previos.length - objetivo.length;
    if (objetivo.length === 0) {
      await client.query("commit");
      return { cambiados: 0, sin_cambios: sinCambios };
    }
    const idsObjetivo = objetivo.map((c: any) => c.id);

    // UNA sentencia para todo el conjunto (§3.6).
    await client.query(
      `UPDATE ${SCHEMA}.contactos_cache
          SET responsable_user_id = $2, updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [idsObjetivo, responsableId]
    );

    // Auditoría, también en UNA sentencia. `datos_antes` lleva el responsable que había: es lo
    // único que permite deshacer una reasignación masiva equivocada.
    await client.query(
      `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       SELECT $1, x.accion, 'contactos_cache', x.registro_id, x.antes, x.despues
         FROM unnest($2::text[], $3::text[], $4::jsonb[], $5::jsonb[])
              AS x(accion, registro_id, antes, despues)`,
      [
        opts.userId,
        objetivo.map((c: any) =>
          responsableId
            ? `Cambió el responsable del contacto "${c.nombre_completo || "(sin nombre)"}"`
            : `Quitó el responsable del contacto "${c.nombre_completo || "(sin nombre)"}"`),
        idsObjetivo,
        objetivo.map((c: any) => JSON.stringify({ responsable_user_id: c.responsable_user_id ?? null })),
        objetivo.map(() => JSON.stringify({ responsable_user_id: responsableId })),
      ]
    );

    await client.query("commit");
    return {
      cambiados: objetivo.length,
      sin_cambios: sinCambios,
      notificar: responsableId ? { userId: responsableId, contactos: objetivo.length } : undefined,
    };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------------------------------------
// B · CREAR UNA TAREA POR CONTACTO
// --------------------------------------------------------------------------------------------

/**
 * 🔴 TOPE DECLARADO. No recorta en silencio: por encima de esto la ruta devuelve 400 con el número.
 *
 * Está por encima de los ~3.810 contactos activos, así que "seleccionar el total" del listado
 * normal cabe entero. Existe porque con el filtro de archivados la selección puede traer 27.800
 * contactos, y crear 27.800 tareas con un clic no puede ser posible por accidente. Un tope que
 * recorta sin avisar es peor que no tenerlo: hace creer que se crearon todas.
 */
export const MAX_TAREAS_POR_OPERACION = 5000;

export interface CamposTareaMasiva {
  titulo: string;
  descripcion?: string | null;
  responsable_id?: string | null;
  observadores?: string[];
  estado?: string;
  prioridad?: string;
  fecha_inicio?: string | null;
  fecha_limite?: string | null;
  checklist?: { texto: string; hecho?: boolean }[];
}

export interface ResultadoTareasMasivas {
  creadas: number;
  /** Los ids de las tareas creadas. Es lo que hace REVERSIBLE la operación — ver abajo. */
  tareaIds: string[];
  auditoriaId: string;
  notificar?: { userId: string; tareas: number };
}

/**
 * Crea UNA tarea por contacto.
 *
 * Son N tareas y no hay alternativa: `tareas.contacto_id` es escalar con FK, no existe tabla puente
 * contacto↔tarea. La gente espera "una tarea para todos" y el esquema no lo permite, así que la
 * interfaz lo dice con todas las letras.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ LA AUDITORÍA GUARDA LOS IDS DE LAS TAREAS CREADAS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Crear 3.806 tareas por error es un desastre operativo, y **borrarlas está prohibido** (§0: nada
 * se borra físicamente). El camino de vuelta es CANCELARLAS (`estado = 'cancelada'`), y para eso
 * hay que saber cuáles salieron de la misma operación.
 *
 * Sin esa lista, deshacer obliga a adivinar por fecha de creación —"las tareas de las 15:42"—, y
 * eso no es una operación reversible: es arqueología, y arrastra las tareas que otra persona creara
 * en ese mismo minuto. Con los ids, deshacer es un UPDATE acotado y exacto:
 *
 *   UPDATE gozz.tareas SET estado = 'cancelada'
 *    WHERE id = ANY (ARRAY(SELECT jsonb_array_elements_text(datos_despues->'tarea_ids')::uuid
 *                            FROM gozz.auditoria WHERE id = '<auditoria_id>'));
 *
 * Es UNA fila de auditoría para toda la operación, no una por tarea: lo que se audita es "se
 * crearon estas N tareas de golpe", y partirlo en N filas perdería justo la agrupación que hace
 * falta para deshacerlo.
 *
 * NO se crea `chat_grupos` por tarea, a diferencia del endpoint individual: serían N grupos y N
 * mensajes de sistema. `ensureChatGrupoForTarea()` es idempotente y se llama también al abrir el
 * chat de una tarea, así que el grupo aparece cuando alguien lo necesita.
 */
export async function crearTareasParaContactos(
  contactoIds: string[],
  campos: CamposTareaMasiva,
  opts: { userId: string }
): Promise<ResultadoTareasMasivas> {
  const unicos = [...new Set((contactoIds || []).filter(Boolean))];
  if (unicos.length === 0) throw new Error("la selección no incluye ningún contacto");
  if (unicos.length > MAX_TAREAS_POR_OPERACION) {
    throw new Error(
      `la selección son ${unicos.length} contactos y el máximo por operación es ${MAX_TAREAS_POR_OPERACION}. ` +
      `Afina el filtro y hazlo por tandas.`
    );
  }

  const responsableId = campos.responsable_id || opts.userId;
  const observadores = JSON.stringify(campos.observadores ?? []);
  const checklist = JSON.stringify(campos.checklist ?? []);

  const insertar = async (client: any) => (await client.query(
    `INSERT INTO ${SCHEMA}.tareas
       (titulo, descripcion, propietario_id, responsable_id, observadores,
        estado, prioridad, fecha_inicio, fecha_limite, contacto_id, checklist)
     SELECT $1, $2, $3, $4, $5::jsonb,
            COALESCE($6, 'pendiente'), COALESCE($7, 'normal'),
            $8, $9, c.id, $10::jsonb
       FROM unnest($11::uuid[]) AS c(id)
     RETURNING id, contacto_id`,
    [
      campos.titulo, campos.descripcion ?? null, opts.userId, responsableId, observadores,
      campos.estado ?? null, campos.prioridad ?? null,
      campos.fecha_inicio ?? null, campos.fecha_limite ?? null, checklist,
      unicos,
    ]
  )).rows;

  const client = await pool.connect();
  try {
    await client.query("begin");

    let filas: any[];
    try {
      filas = await insertar(client);
    } catch (e: any) {
      // Misma defensa que el endpoint individual: la secuencia `numero_tarea` puede quedar
      // desincronizada tras una importación, y entonces el INSERT choca con su índice único.
      // Se resincroniza al MAX y se reintenta UNA vez.
      if (e?.code === "23505" && String(e?.constraint || "").includes("numero_tarea")) {
        await client.query("rollback");
        await query(`SELECT setval('${SCHEMA}.tareas_numero_tarea_seq', (SELECT COALESCE(MAX(numero_tarea),0) FROM ${SCHEMA}.tareas))`);
        await client.query("begin");
        filas = await insertar(client);
      } else { throw e; }
    }

    const tareaIds = filas.map((f) => f.id as string);

    // UNA fila de auditoría para toda la operación, con los ids dentro. Ver el bloque de arriba.
    const aud = (await client.query(
      `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       VALUES ($1, $2, 'tareas', NULL, $3::jsonb, $4::jsonb) RETURNING id`,
      [
        opts.userId,
        `Creó ${tareaIds.length} tarea(s) en masa: "${campos.titulo}"`,
        JSON.stringify({ contactos: unicos.length }),
        JSON.stringify({
          titulo: campos.titulo,
          responsable_id: responsableId,
          tareas_creadas: tareaIds.length,
          // 🔴 La lista que permite CANCELARLAS si la operación fue un error. Sin ella, deshacer
          // sería adivinar por fecha.
          tarea_ids: tareaIds,
          contacto_ids: unicos,
        }),
      ]
    )).rows[0];

    await client.query("commit");
    return {
      creadas: tareaIds.length,
      tareaIds,
      auditoriaId: aud.id,
      notificar: responsableId !== opts.userId ? { userId: responsableId, tareas: tareaIds.length } : undefined,
    };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
