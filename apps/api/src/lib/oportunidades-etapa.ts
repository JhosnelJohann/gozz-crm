// ============================================================================================
// CAMBIO DE ETAPA EN MASA — el motor
//
// 🔴 UN CAMBIO DE ETAPA NO ES UN `UPDATE`. El endpoint individual dispara tres cosas más, y en
// lote se multiplican por N:
//
//   · `runStageAutomations()`  → las automatizaciones activas de la etapa destino. Una de tipo
//     `crear_tarea` sobre 100 oportunidades crea **100 tareas** en las bandejas de la gente.
//   · `asignarPuntosSiGanada()` → reparte puntos a los vendedores y escribe `fecha_completada`.
//     **No es configurable**: es código fijo y siempre corre.
//   · `validarCamposObligatorios()` → hay etapas que exigen campos rellenos.
//
// Por eso este módulo **llama a las mismas funciones que el cambio individual** en vez de escribir
// su propio `UPDATE … WHERE id = ANY(...)`. Un update masivo directo crearía **dos semánticas para
// la misma acción**, y la masiva sería la que no dispara nada: un agujero silencioso que solo se
// descubre cuando alguien pregunta por qué no le llegaron las tareas.
//
// Vive en `lib/` y no dentro de la ruta para que las pruebas ejerciten ESTA función y no una copia
// suya, que es lo único que hace que el test signifique algo (§9).
// ============================================================================================

import { query } from "../shared/db.js";
import { runStageAutomations, validarCamposObligatorios } from "../pipeline-routes.js";
import { asignarPuntosSiGanada } from "../reportes-routes.js";

const SCHEMA = "gozz";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETAPA_RE = /^[a-z0-9_]{1,40}$/;

/**
 * Tope DECLARADO por operación. No es un recorte silencioso: pasarse devuelve error con el número.
 *
 * Por qué 200 y no 5.000 como las tareas masivas de Contactos: allí cada contacto cuesta una fila;
 * aquí cada oportunidad cuesta una validación, un UPDATE, las automatizaciones de su etapa destino
 * (que pueden ser inserciones, webhooks salientes…), el reparto de puntos y dos filas de auditoría.
 * Un lote de 200 ya son más de mil consultas en una sola petición.
 */
export const MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA = 200;

/**
 * Lo que la INTERFAZ manda: `{ oportunidad_id: etapa_destino }`. Cada fila del modal puede ir a una
 * etapa distinta.
 */
export type MapaCambios = Record<string, string>;

/** Lo que se GUARDA por cada oportunidad: de dónde venía y a dónde va. */
export interface CambioSolicitado {
  /** La etapa que tenía **cuando se pidió**. `null` en las solicitudes anteriores a este cambio. */
  desde: string | null;
  hasta: string;
}

/**
 * El mapa tal y como puede estar en la base.
 *
 * 🔴 CONVIVEN DOS FORMAS, a propósito:
 *   · **escalar** (`"ganado"`) — la antigua: solo el destino, sin origen.
 *   · **objeto** (`{desde, hasta}`) — la nueva.
 *
 * Las solicitudes pendientes escritas antes de este cambio siguen con la forma antigua y **no se
 * migran**: reconstruirles el `desde` sería escribir en la base, como si fuera un dato registrado,
 * exactamente la misma conjetura que hace la vía de respaldo — y con la misma incertidumbre, pero
 * ya sin la marca de que es una conjetura. Se quedan como están, la reconstrucción por `auditoria`
 * las sigue cubriendo, y mueren solas cuando se resuelvan.
 */
export type MapaCambiosGuardado = Record<string, string | CambioSolicitado>;

/** Normaliza cualquiera de las dos formas a la nueva. Un escalar es un destino sin origen. */
export function normalizarCambios(raw: MapaCambiosGuardado | MapaCambios): Record<string, CambioSolicitado> {
  const out: Record<string, CambioSolicitado> = {};
  for (const [id, v] of Object.entries(raw || {})) {
    if (v && typeof v === "object") out[id] = { desde: (v as CambioSolicitado).desde ?? null, hasta: String((v as CambioSolicitado).hasta) };
    else out[id] = { desde: null, hasta: String(v) };
  }
  return out;
}

/** Solo los destinos: es lo que necesitan la validación y la ejecución. */
export const destinosDe = (raw: MapaCambiosGuardado | MapaCambios): MapaCambios =>
  Object.fromEntries(Object.entries(normalizarCambios(raw)).map(([id, c]) => [id, c.hasta]));

export interface OportunidadOmitida {
  id: string;
  nombre_caso: string | null;
  etapa_actual: string | null;
  etapa_destino: string;
  motivo: string;
  /** Los campos de `pipeline_stages.campos_obligatorios` que están vacíos. */
  faltan?: string[];
}

export interface ResultadoCambioEtapa {
  cambiadas: number;
  /** Las que NO se movieron, con su motivo. No abortan al resto. */
  omitidas: OportunidadOmitida[];
  /** La fila de auditoría de la OPERACIÓN, la que permite deshacerla. */
  auditoriaId: string | null;
  /** Transiciones realmente aplicadas, para el mensaje de vuelta. */
  transiciones: { desde: string | null; hasta: string; n: number }[];
}

/**
 * Valida y normaliza el mapa que llega por el body.
 *
 * Devuelve error en vez de descartar en silencio: aquí un id mal formado no es ruido de query
 * string, es una fila que el usuario creyó estar moviendo.
 */
export function parsearCambios(raw: any): { cambios?: MapaCambios; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "cambios debe ser un objeto { oportunidad_id: etapa }" };
  const entradas = Object.entries(raw as Record<string, any>);
  if (entradas.length === 0) return { error: "cambios está vacío" };
  const cambios: MapaCambios = {};
  for (const [id, etapa] of entradas) {
    if (!UUID_RE.test(id)) return { error: `cambios contiene un id inválido: ${id}` };
    const e = String(etapa ?? "").trim();
    if (!ETAPA_RE.test(e)) return { error: `cambios["${id}"] no es una etapa válida` };
    cambios[id] = e;
  }
  return { cambios };
}

/**
 * Comprueba que la selección y el mapa hablan de lo mismo.
 *
 * Son redundantes a propósito: el mapa YA es la selección. Pero si la interfaz manda un mapa que no
 * cubre lo seleccionado —o cubre de más— eso es un defecto suyo, y es mejor que el servidor lo diga
 * que aplicar un subconjunto que nadie pidió.
 */
export function seleccionCuadraConCambios(ids: string[], cambios: MapaCambios): string | null {
  const enMapa = new Set(Object.keys(cambios));
  const enSeleccion = new Set(ids);
  const faltan = [...enSeleccion].filter((id) => !enMapa.has(id));
  const sobran = [...enMapa].filter((id) => !enSeleccion.has(id));
  if (faltan.length) return `la selección incluye ${faltan.length} oportunidad(es) sin etapa destino en 'cambios'`;
  if (sobran.length) return `'cambios' incluye ${sobran.length} oportunidad(es) que no están en la selección`;
  return null;
}

interface FilaOportunidad {
  id: string;
  nombre_caso: string | null;
  etapa: string | null;
  fecha_completada: string | null;
  puntos_asignados: boolean | null;
}

/** Las oportunidades del mapa, tal y como están AHORA. Una sola consulta sobre el conjunto (§3.6). */
async function leerOportunidades(ids: string[]): Promise<Map<string, FilaOportunidad>> {
  const filas = await query<FilaOportunidad>(
    `SELECT id, nombre_caso, etapa, fecha_completada, puntos_asignados
       FROM ${SCHEMA}.oportunidades WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return new Map(filas.map((f) => [String(f.id), f]));
}

export interface PreviaCambioEtapa {
  /** Cuántas se moverían de verdad. */
  aplicables: number;
  /** Una línea por transición: "12 de Nuevo pasan a Ganado". */
  transiciones: { desde: string | null; hasta: string; n: number }[];
  /** Cuántas automatizaciones se ejecutarían EN TOTAL (contadas en vivo, no supuestas). */
  automatizaciones: number;
  /** Desglose por etapa destino, para poder decir cuál las dispara. */
  automatizaciones_por_etapa: { etapa: string; activas: number; oportunidades: number }[];
  /** A cuántas se les repartirán puntos (las que van a una etapa ganada y no los tienen ya). */
  puntos: number;
  /** A cuántas se les escribirá `fecha_completada` por primera vez. */
  fechas_completada: number;
  /** Las que no se moverán, con el motivo. */
  omitidas: OportunidadOmitida[];
}

/**
 * Qué pasaría si se aplicara. **No escribe nada.**
 *
 * Existe porque la confirmación tiene que enseñar números REALES, no un texto genérico. Hoy hay
 * cero automatizaciones activas en producción, pero se configuran desde la interfaz: contarlas en
 * el momento es lo único que impide que el aviso mienta el día que alguien active una.
 *
 * Y valida los campos obligatorios ANTES de que el usuario confirme, para que sepa cuáles se van a
 * quedar fuera en vez de enterarse después.
 */
export async function previaCambioEtapa(guardados: MapaCambiosGuardado | MapaCambios): Promise<PreviaCambioEtapa> {
  // Acepta las dos formas: lo que manda la interfaz y lo que hay guardado en una solicitud.
  const cambios = destinosDe(guardados);
  const ids = Object.keys(cambios);
  const actuales = await leerOportunidades(ids);

  // Las etapas destino, con su color/label/es_ganado y cuántas automatizaciones ACTIVAS tienen.
  const destinos = [...new Set(Object.values(cambios))];
  const stages = await query<any>(
    `SELECT s.key, s.label, s.es_ganado, s.activa,
            count(a.id) FILTER (WHERE a.activa) ::int AS automatizaciones
       FROM ${SCHEMA}.pipeline_stages s
       LEFT JOIN ${SCHEMA}.stage_automations a ON a.stage_id = s.id
      WHERE s.key = ANY($1::text[])
      GROUP BY s.key, s.label, s.es_ganado, s.activa`,
    [destinos]
  );
  const porKey = new Map(stages.map((s: any) => [String(s.key), s]));

  const omitidas: OportunidadOmitida[] = [];
  const transiciones = new Map<string, { desde: string | null; hasta: string; n: number }>();
  const porDestino = new Map<string, number>();
  let puntos = 0;
  let fechas = 0;

  for (const [id, destino] of Object.entries(cambios)) {
    const op = actuales.get(id);
    if (!op) {
      omitidas.push({ id, nombre_caso: null, etapa_actual: null, etapa_destino: destino, motivo: "la oportunidad ya no existe" });
      continue;
    }
    const stage = porKey.get(destino);
    if (!stage || stage.activa === false) {
      // Sin la `key` en el texto: es el identificador interno de la etapa y a quien lee no le dice
      // nada — el nombre visible no existe justamente porque la etapa ya no está (§4.7).
      omitidas.push({ id, nombre_caso: op.nombre_caso, etapa_actual: op.etapa, etapa_destino: destino, motivo: "la etapa de destino ya no está disponible" });
      continue;
    }
    if (op.etapa === destino) {
      omitidas.push({ id, nombre_caso: op.nombre_caso, etapa_actual: op.etapa, etapa_destino: destino, motivo: "ya está en esa etapa" });
      continue;
    }
    const faltan = await validarCamposObligatorios(id, destino);
    if (faltan.length > 0) {
      omitidas.push({ id, nombre_caso: op.nombre_caso, etapa_actual: op.etapa, etapa_destino: destino, motivo: "le faltan campos obligatorios", faltan });
      continue;
    }

    const clave = `${op.etapa ?? ""}→${destino}`;
    const t = transiciones.get(clave) ?? { desde: op.etapa, hasta: destino, n: 0 };
    t.n += 1;
    transiciones.set(clave, t);
    porDestino.set(destino, (porDestino.get(destino) ?? 0) + 1);

    if (stage.es_ganado) {
      // `sumarPuntosOportunidad` es idempotente: no vuelve a pagar lo ya pagado.
      if (!op.puntos_asignados) puntos += 1;
      if (!op.fecha_completada) fechas += 1;
    }
  }

  const automatizaciones_por_etapa = [...porDestino.entries()].map(([etapa, oportunidades]) => ({
    etapa,
    activas: Number(porKey.get(etapa)?.automatizaciones ?? 0),
    oportunidades,
  }));

  return {
    aplicables: [...transiciones.values()].reduce((n, t) => n + t.n, 0),
    transiciones: [...transiciones.values()].sort((a, b) => b.n - a.n),
    automatizaciones: automatizaciones_por_etapa.reduce((n, x) => n + x.activas * x.oportunidades, 0),
    automatizaciones_por_etapa,
    puntos,
    fechas_completada: fechas,
    omitidas,
  };
}

/**
 * Aplica el cambio de etapa a cada oportunidad del mapa.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 VALIDA ANTES DE ESCRIBIR, Y NO ABORTA POR UNA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Primero se comprueban las N (existe, la etapa destino existe, no está ya ahí, tiene los campos
 * obligatorios). Las que no pasen **no se mueven, no tumban al resto y vuelven en la respuesta con
 * su motivo**. Fallar entero por una es tan malo como colarla: en un lote de 80, que una a la que
 * le falta el preparador impida mover las otras 79 obliga a jugar a adivinar cuál era.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ DOS NIVELES DE AUDITORÍA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * · UNA FILA POR OPORTUNIDAD, con la etapa anterior — es lo que ya hace el cambio individual, y es
 *   lo que se lee desde la pestaña Actividad de cada caso. Si el masivo no la dejara, mover cien
 *   casos sería invisible en el historial de cada uno.
 * · UNA FILA DE LA OPERACIÓN, con los ids y sus etapas previas — es lo que permite DESHACER. Sin
 *   ella, deshacer obliga a adivinar por fecha ("las de las 15:42") y arrastra lo que otra persona
 *   moviera en ese minuto. Mismo criterio que la creación masiva de tareas de Contactos:
 *
 *     -- Deshacer una operación: devolver cada oportunidad a su etapa anterior.
 *     UPDATE gozz.oportunidades o SET etapa = x.antes
 *       FROM (SELECT (e->>'id')::uuid AS id, e->>'antes' AS antes
 *               FROM gozz.auditoria a,
 *                    jsonb_array_elements(a.datos_antes->'oportunidades') e
 *              WHERE a.id = '<auditoria_id>') x
 *      WHERE o.id = x.id;
 *
 *   ⚠️ Deshacer la etapa **no deshace los efectos**: las tareas creadas siguen ahí, los puntos
 *   siguen asignados y `fecha_completada` no se borra (`asignarPuntosSiGanada` la pone con
 *   `COALESCE(fecha_completada, NOW())`, así que solo la escribe la primera vez y volver a ganar no
 *   la mueve — pero volver atrás tampoco la quita). Está dicho aquí porque quien deshaga tiene que
 *   saberlo, y es justo lo que la confirmación escrita avisa antes de aplicar.
 *
 * Las automatizaciones y los puntos se disparan **después** del UPDATE y con `await`, no
 * fire-and-forget como en el individual: aquí el llamador necesita saber que terminaron para poder
 * escribir `resultado` en la solicitud y responder con números que no mientan.
 */
export async function cambiarEtapaMasivo(
  guardados: MapaCambiosGuardado | MapaCambios,
  opts: { userId: string }
): Promise<ResultadoCambioEtapa> {
  // La ejecución lee `hasta`. El `desde` guardado es la foto de cuando se pidió, no una orden: la
  // etapa de la que se sale es la que tenga la fila HOY, y esa se lee de la tabla más abajo.
  const cambios = destinosDe(guardados);
  const ids = Object.keys(cambios);
  if (ids.length === 0) throw new Error("no hay ninguna oportunidad que cambiar");
  if (ids.length > MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA) {
    throw new Error(
      `son ${ids.length} oportunidades y el máximo por operación es ${MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA}. ` +
      `Hazlo por tandas.`
    );
  }

  // ── Fase 1: validar las N. Nada escrito todavía. ────────────────────────────────────────────
  const previa = await previaCambioEtapa(cambios);
  const omitidos = new Set(previa.omitidas.map((o) => o.id));
  const aplicables = ids.filter((id) => !omitidos.has(id));
  if (aplicables.length === 0) {
    return { cambiadas: 0, omitidas: previa.omitidas, auditoriaId: null, transiciones: [] };
  }

  const actuales = await leerOportunidades(aplicables);

  // ── Fase 2: escribir. Un UPDATE sobre el conjunto, con el destino de cada una (§3.6). ───────
  await query(
    `UPDATE ${SCHEMA}.oportunidades o
        SET etapa = x.destino, updated_at = now()
       FROM unnest($1::uuid[], $2::text[]) AS x(id, destino)
      WHERE o.id = x.id`,
    [aplicables, aplicables.map((id) => cambios[id])]
  );

  // ── Fase 3: la auditoría por oportunidad, también en UNA sentencia. ─────────────────────────
  await query(
    `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
     SELECT $1, x.accion, 'oportunidades', x.registro_id, x.antes, x.despues
       FROM unnest($2::text[], $3::text[], $4::jsonb[], $5::jsonb[])
            AS x(accion, registro_id, antes, despues)`,
    [
      opts.userId,
      aplicables.map((id) => {
        const destino = cambios[id];
        return destino === "ganado" ? "Finalizó la oportunidad como GANADA (cambio masivo)"
          : destino === "perdido" ? "Finalizó la oportunidad como PERDIDA (cambio masivo)"
          : `Cambió la etapa a "${destino}" (cambio masivo)`;
      }),
      aplicables,
      aplicables.map((id) => JSON.stringify({ etapa: actuales.get(id)?.etapa ?? null })),
      aplicables.map((id) => JSON.stringify({ etapa: cambios[id] })),
    ]
  );

  // ── Fase 4: la fila de la OPERACIÓN, la que permite deshacer. ───────────────────────────────
  const detalle = aplicables.map((id) => ({
    id,
    antes: actuales.get(id)?.etapa ?? null,
    despues: cambios[id],
  }));
  const auditoria = await query<any>(
    `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
     VALUES ($1, $2, 'oportunidades', $3, $4::jsonb, $5::jsonb) RETURNING id`,
    [
      opts.userId,
      `Cambio masivo de etapa: ${aplicables.length} oportunidad${aplicables.length === 1 ? "" : "es"}`,
      // `registro_id` es escalar y esto afecta a N: se marca como operación y los ids van al jsonb.
      "operacion_masiva",
      JSON.stringify({ oportunidades: detalle }),
      JSON.stringify({ cambiadas: aplicables.length, transiciones: previa.transiciones }),
    ]
  );

  // ── Fase 5: los efectos, los MISMOS que el cambio individual. ───────────────────────────────
  // Con `await` y en serie: cien webhooks salientes a la vez no son una optimización, son un
  // incidente. Un fallo de una automatización no tumba el lote — el individual también los ignora.
  for (const id of aplicables) {
    const destino = cambios[id];
    try {
      await runStageAutomations(id, destino, opts.userId);
    } catch (e: any) {
      console.error("[etapa-masiva automations]", id, e?.message);
    }
    try {
      await asignarPuntosSiGanada(id, destino);
    } catch (e: any) {
      console.error("[etapa-masiva puntos]", id, e?.message);
    }
  }

  return {
    cambiadas: aplicables.length,
    omitidas: previa.omitidas,
    auditoriaId: auditoria[0]?.id ?? null,
    transiciones: previa.transiciones,
  };
}

// --------------------------------------------------------------------------------------------
// Las solicitudes
// --------------------------------------------------------------------------------------------

export interface SolicitudEtapa {
  id: string;
  tipo: string;
  solicitante_id: string;
  /** Puede venir en la forma antigua o en la nueva: pásalo por `normalizarCambios`. */
  cambios: MapaCambiosGuardado;
  oportunidades_afectadas: number;
  motivo: string | null;
  estado: string;
  aprobador_id: string | null;
  motivo_rechazo: string | null;
  resultado: any;
  created_at: string;
  resolved_at: string | null;
  ejecutada_at: string | null;
}

/**
 * Deja la solicitud. **No aplica nada**: es justo su razón de ser.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 SE GUARDA DE DÓNDE VENÍA CADA UNA, NO SOLO A DÓNDE VA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `desde` es la etapa que la oportunidad tenía **en el momento de pedirlo**: lo que el solicitante
 * vio. Es el mismo principio que `oportunidades_afectadas` — se registra el estado del que se
 * partía, en vez de reconstruirlo después.
 *
 * Con eso, saber si algo cambió entre pedir y aprobar es **comparar dos valores**. Antes había que
 * reconstruir la historia desde `gozz.auditoria`, lo cual funciona pero depende de que **todo**
 * cambio de etapa deje rastro allí, y había caminos que no lo dejaban (los cierra la otra mitad de
 * esta entrega). Un dato registrado no depende de que nadie se acuerde de auditar.
 *
 * `oportunidades_afectadas` se rellena aquí a partir del propio mapa — la base no puede imponerlo
 * con un CHECK (haría falta una subconsulta) y este es el único sitio que escribe la columna.
 */
export async function crearSolicitudEtapa(
  cambios: MapaCambios,
  opts: { userId: string; motivo?: string | null }
): Promise<SolicitudEtapa> {
  const ids = Object.keys(cambios);
  if (ids.length === 0) throw new Error("no hay ninguna oportunidad que cambiar");

  // La etapa de origen, leída AHORA. Una que ya no exista se guarda con `desde: null`: no se
  // inventa, y el detalle la marcará como desaparecida de todas formas.
  const actuales = await leerOportunidades(ids);
  const guardado: Record<string, CambioSolicitado> = Object.fromEntries(
    ids.map((id) => [id, { desde: actuales.get(id)?.etapa ?? null, hasta: cambios[id] }])
  );

  const filas = await query<SolicitudEtapa>(
    `INSERT INTO ${SCHEMA}.oportunidad_etapa_solicitudes
       (solicitante_id, cambios, oportunidades_afectadas, motivo)
     VALUES ($1, $2::jsonb, $3, $4) RETURNING *`,
    [opts.userId, JSON.stringify(guardado), ids.length, opts.motivo?.trim() || null]
  );
  return filas[0];
}

/**
 * Aprueba y EJECUTA, en ese orden y sin atajos.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 CAS: LA TRANSICIÓN ES CONDICIONAL Y ATÓMICA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `UPDATE … WHERE id=$1 AND estado='pendiente' RETURNING *`. Postgres serializa los UPDATE sobre
 * una misma fila, así que de dos aprobaciones simultáneas SOLO UNA ve 'pendiente' y la otra recibe
 * cero filas. Es garantía del motor, no del código. El trigger `solicitud_no_regresa()` cierra el
 * otro camino: devolverla a 'pendiente' con un UPDATE suelto para volver a ejecutarla.
 *
 * 🔴 **Aprobar no es un atajo.** La ejecución pasa por `cambiarEtapaMasivo()`, el mismo camino que
 * el cambio directo: validación, automatizaciones, puntos y auditoría. Si aprobar saltase por
 * encima, tendríamos la tercera semántica de la misma acción.
 *
 * `confirmarCambios: true` es la respuesta del aprobador al aviso de "el conjunto ha cambiado".
 * Sin ella, si el recuento difiere del que había al pedirla, se para y se informa: nunca se ejecuta
 * a ciegas sobre un conjunto distinto del que se aprobó.
 */
export async function aprobarSolicitudEtapa(
  solicitudId: string,
  opts: { userId: string; confirmarCambios?: boolean }
): Promise<
  | { ok: true; solicitud: SolicitudEtapa; resultado: ResultadoCambioEtapa }
  | { ok: false; motivo: "no_pendiente" }
  | { ok: false; motivo: "conjunto_cambiado"; afectadas_al_pedir: number; aplicables_ahora: number; previa: PreviaCambioEtapa }
> {
  const pendiente = (await query<SolicitudEtapa>(
    `SELECT * FROM ${SCHEMA}.oportunidad_etapa_solicitudes WHERE id = $1 AND estado = 'pendiente'`,
    [solicitudId]
  ))[0];
  if (!pendiente) return { ok: false, motivo: "no_pendiente" };

  // Se recalcula ANTES de tocar la solicitud: entre pedir y aprobar alguien pudo mover una de esas
  // oportunidades a mano, o dejarla sin un campo obligatorio.
  const previa = await previaCambioEtapa(pendiente.cambios);
  if (previa.aplicables !== pendiente.oportunidades_afectadas && !opts.confirmarCambios) {
    return {
      ok: false,
      motivo: "conjunto_cambiado",
      afectadas_al_pedir: pendiente.oportunidades_afectadas,
      aplicables_ahora: previa.aplicables,
      previa,
    };
  }

  // CAS. Si otro aprobador se adelantó, aquí se acaba.
  const aprobada = (await query<SolicitudEtapa>(
    `UPDATE ${SCHEMA}.oportunidad_etapa_solicitudes
        SET estado = 'aprobada', aprobador_id = $1, resolved_at = now()
      WHERE id = $2 AND estado = 'pendiente' RETURNING *`,
    [opts.userId, solicitudId]
  ))[0];
  if (!aprobada) return { ok: false, motivo: "no_pendiente" };

  // Se ejecuta a nombre de QUIEN APRUEBA: es quien autoriza el efecto, y es su firma la que tiene
  // que quedar en `auditoria`. Quién lo pidió está en la propia solicitud.
  let resultado: ResultadoCambioEtapa;
  try {
    resultado = await cambiarEtapaMasivo(aprobada.cambios, { userId: opts.userId });
  } catch (e: any) {
    // 🔴 La solicitud se queda en 'aprobada' con el error en `resultado`, NO se marca ejecutada y
    // NO se rechaza: la aprobación humana no se tira por un fallo de la ejecución (§10.2). Se puede
    // reintentar. El CHECK solo exige `ejecutada_at` y `resultado` cuando el estado es 'ejecutada'.
    await query(
      `UPDATE ${SCHEMA}.oportunidad_etapa_solicitudes SET resultado = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ error: e?.message || String(e), fallo_en: "ejecucion" }), solicitudId]
    );
    throw e;
  }

  // `resultado` y `ejecutada_at` van juntos: lo exige el CHECK de coherencia.
  const ejecutada = (await query<SolicitudEtapa>(
    `UPDATE ${SCHEMA}.oportunidad_etapa_solicitudes
        SET estado = 'ejecutada', ejecutada_at = now(), resultado = $1::jsonb
      WHERE id = $2 AND estado = 'aprobada' RETURNING *`,
    [JSON.stringify({
      cambiadas: resultado.cambiadas,
      omitidas: resultado.omitidas,
      transiciones: resultado.transiciones,
      auditoria_id: resultado.auditoriaId,
    }), solicitudId]
  ))[0];

  return { ok: true, solicitud: ejecutada ?? aprobada, resultado };
}

/** Rechaza. El motivo es obligatorio: lo exige el CHECK canónico y, antes que él, el sentido común. */
export async function rechazarSolicitudEtapa(
  solicitudId: string,
  opts: { userId: string; motivoRechazo: string }
): Promise<SolicitudEtapa | null> {
  const motivo = String(opts.motivoRechazo || "").trim();
  if (!motivo) throw new Error("El motivo del rechazo es obligatorio");
  const filas = await query<SolicitudEtapa>(
    `UPDATE ${SCHEMA}.oportunidad_etapa_solicitudes
        SET estado = 'rechazada', aprobador_id = $1, resolved_at = now(), motivo_rechazo = $2
      WHERE id = $3 AND estado = 'pendiente' RETURNING *`,
    [opts.userId, motivo, solicitudId]
  );
  return filas[0] ?? null;
}
