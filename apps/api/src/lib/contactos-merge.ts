import { pool, query } from "../shared/db.js";
import { tieneColumnasTrazabilidad } from "./contactos-archivado.js";

// ============================================================================================
// MOTOR DE FUSIÓN DE CONTACTOS — portado de scripts/dedup-contactos.mjs SIN cambiar su semántica.
//
// Fusionar = el MAESTRO sobrevive conservando su `id`, el PERDEDOR queda archivado apuntando a él,
// y todo lo que colgaba del perdedor pasa al maestro. NADA se borra (§0 de CONVENCIONES) y todo
// queda en `contactos_merge_log`, agrupado por `corrida_id`, de forma que `revertir()` puede
// deshacerlo entero.
//
// ⚠️ DOS PLANOS QUE NO SE MEZCLAN — es el error conceptual más fácil de cometer aquí:
//
//   PLANO RELACIONAL (oportunidades, tareas, documentos, notas, carpetas de Drive, correos…):
//   NO SE ELIGE NADA. TODO se reasigna al maestro, siempre. Los archivos de los dos contactos
//   terminan colgando del resultante. No hay descarte posible, ni pregunta al usuario, ni forma
//   de perder un expediente por un clic. NO lo hagas configurable.
//
//   PLANO ESCALAR (nombre, teléfono, email, a_number, pasaporte_*, direccion_*, estatus_*…):
//   aquí y SOLO aquí elige el humano, porque un campo escalar tiene un único valor y hay que
//   decidir cuál sobrevive.
//
// DIFERENCIA CON EL CLI: el script masivo NUNCA pisa un valor lleno del maestro (solo rellena
// huecos). Esta versión sí puede, porque la UI es una herramienta de auditoría manual donde el
// humano arma el "contacto ideal" campo por campo. Eso vive en el parámetro OPCIONAL
// `valoresElegidos`: sin él, la conducta es idéntica a la del script.
//
// NOTA DE DEUDA: hoy esta lógica está DUPLICADA con scripts/dedup-contactos.mjs. El script es
// `.mjs` en la raíz y se ejecuta sin build; este módulo es TS bajo apps/api/src (compila a dist/).
// Unificarlos obligaría a que el CLI dependa de un build previo, así que se dejó el script intacto
// a propósito. Si tocas la semántica de aquí, TÓCALA TAMBIÉN ALLÍ.
// ============================================================================================

const SCHEMA = "gozz";

/** Identificadores seguros: TODO lo que se interpola en SQL pasa por aquí antes. */
const ID_RE = /^[a-z_][a-z0-9_]*$/;

const vacio = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const aTexto = (v: any): string | null =>
  v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v);

// --------------------------------------------------------------------------------------------
// R6 — QUÉ SE REASIGNA Y QUÉ SE CONGELA
//
// Criterio: ¿algún proceso CONSULTA esta tabla para decidir dónde escribir en el futuro?
//   Sí  → se reasigna (es un mapeo vivo).
//   No, solo la lee un humano → se congela (es historia, reescribirla la falsifica).
// --------------------------------------------------------------------------------------------

/**
 * Tablas CON FK que aun así NO se reasignan: su columna referenciante es parte de su PROPIA PK,
 * así que reasignar chocaría si el maestro ya tiene fila. Son estado no crítico del coach de IA y
 * su FK es CASCADE, de modo que se quedan apuntando al perdedor archivado sin romper nada.
 */
const EXCLUIR_REASIGNACION = new Set(["followup_coach_messages", "followup_coach_state"]);

/**
 * Bitácoras históricas: NO llevan FK (por eso el descubrimiento dinámico no las ve) y NO deben
 * llevarla nunca. Se listan aquí de forma explícita para que quede constancia de la decisión y
 * como defensa: si alguien les declarase una FK en el futuro, el motor las ignoraría igualmente
 * en vez de empezar a reescribir historia en silencio.
 *
 * 🔴🔴 EXCLUSIÓN CRÍTICA — `contactos_merge_log` 🔴🔴
 * ES LA BITÁCORA QUE PERMITE DESHACER LAS FUSIONES. SI ALGUIEN LE DECLARA UNA FK HACIA
 * contactos_cache, EL DESCUBRIMIENTO DINÁMICO REESCRIBIRÍA EL REGISTRO DE LAS PROPIAS FUSIONES
 * (ganador_id / perdedor_id) Y `revertir()` QUEDARÍA CORRUPTO **SIN QUE SALTE NINGÚN ERROR**:
 * el revert "funcionaría", devolvería filas y dejaría la base mal. NUNCA SE REASIGNA. NUNCA SE
 * LE PONE FK.
 */
const TABLAS_CONGELADAS = new Set([
  "contactos_merge_log", // 🔴 ver el párrafo de arriba antes de tocar esto
]);

export interface FkContacto {
  esquema: string;
  tabla: string;
  columna: string;
  pk: string;
}

/**
 * Descubre dinámicamente TODA columna que referencia contactos_cache por FK declarada.
 *
 * Es dinámico a propósito: una tabla nueva con su FK entra sola, sin tocar el motor. El precio es
 * que una tabla SIN FK es invisible — por eso la 0058 declaró la de `contactos_notas`.
 */
export async function descubrirFKs(): Promise<{ fks: FkContacto[]; omitidas: string[] }> {
  const rows = await query<any>(
    `select n.nspname as esquema, c.relname as tabla, a.attname as columna,
            (select a2.attname
               from pg_index i
               join pg_attribute a2 on a2.attrelid = c.oid and a2.attnum = i.indkey[0]
              where i.indrelid = c.oid and i.indisprimary and i.indnkeyatts = 1
              limit 1) as pk
       from pg_constraint con
       join pg_class c      on c.oid = con.conrelid
       join pg_namespace n  on n.oid = c.relnamespace
       join pg_class ref    on ref.oid = con.confrelid
       join pg_namespace rn on rn.oid = ref.relnamespace
       cross join lateral unnest(con.conkey) as k(attnum)
       join pg_attribute a  on a.attrelid = c.oid and a.attnum = k.attnum
      where con.contype = 'f' and rn.nspname = $1 and ref.relname = 'contactos_cache'
      order by 2, 3`,
    [SCHEMA]
  );

  const fks: FkContacto[] = [];
  const omitidas: string[] = [];
  for (const r of rows) {
    if (TABLAS_CONGELADAS.has(r.tabla)) { omitidas.push(`${r.tabla}.${r.columna}: bitácora histórica (R6) — se congela`); continue; }
    if (EXCLUIR_REASIGNACION.has(r.tabla)) { omitidas.push(`${r.tabla}.${r.columna}: la columna es parte de su propia PK; el FK es CASCADE y no rompe nada`); continue; }
    // Sin PK de una sola columna no se puede loguear la reasignación con precisión, y sin log
    // preciso no hay revert posible. Preferimos no tocarla a dejarla irreversible.
    if (!r.pk) { omitidas.push(`${r.esquema}.${r.tabla}.${r.columna}: sin PK de una sola columna`); continue; }
    if (![r.esquema, r.tabla, r.columna, r.pk].every((x: string) => ID_RE.test(x))) {
      omitidas.push(`${r.esquema}.${r.tabla}.${r.columna}: identificador no seguro`);
      continue;
    }
    fks.push(r as FkContacto);
  }
  return { fks, omitidas };
}

// --------------------------------------------------------------------------------------------
// Columnas ESCALARES enriquecibles (el plano donde elige el humano)
// --------------------------------------------------------------------------------------------
const EXACTOS = new Set(["a_number", "ssn_encrypted", "fecha_nacimiento", "whatsapp", "email", "telefono"]);
const PREFIJOS = ["pasaporte_", "direccion_", "estatus_"];
const esEnriquecible = (col: string) =>
  EXACTOS.has(col) || PREFIJOS.some((p) => col.startsWith(p)) || col.includes("uscis") ||
  col.endsWith("_tramites");

export interface ColumnasElegibles {
  elegibles: string[];
  /** Columna → por qué NO se puede elegir. La UI las muestra en gris con este motivo. */
  noElegibles: Record<string, string>;
}

/**
 * Campos que el MOTOR fusiona pero que NADIE elige desde la interfaz.
 *
 * Son los tres secretos de R11 (SSN y credenciales USCIS). La distinción importa y no es evidente:
 *  · El motor DEBE seguir tratándolos como enriquecibles, para que el comportamiento clásico de
 *    "rellenar huecos" no pierda un SSN que solo tenía el perdedor.
 *  · La interfaz NO puede ofrecerlos: el preview no manda sus valores (R11), así que el modal los
 *    pintaría como dos casillas vacías. Si el usuario marcase la del perdedor, el servidor leería
 *    el SSN REAL y lo escribiría encima del SSN REAL del maestro — una mutación invisible de un
 *    dato sensible, provocada por una pantalla que muestra "vacío" en las dos columnas. Y el aviso
 *    de "vas a reemplazar N valores" tampoco lo detectaría, porque se calcula sobre lo que la UI ve.
 * Por eso: si no se pueden ver, no se pueden elegir.
 */
export const CAMPOS_NO_ELEGIBLES_POR_SENSIBLES = ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"];
export const MOTIVO_SENSIBLE = "Dato sensible: no se muestra ni se elige desde aquí. Si el maestro lo tiene vacío, se conserva el del otro contacto automáticamente.";

/**
 * Qué columnas puede elegir el humano. Se resuelve contra el esquema REAL, no contra una lista
 * escrita a mano, porque varias columnas de contactos_cache nacieron fuera de migraciones.
 *
 * Dos exclusiones que NO son cosméticas (resueltas contra el esquema real, no una lista fija —
 * aplican a cualquier columna futura que caiga en estos dos casos, no solo a las de hoy):
 *  · ARRAY: pasarles un valor por parámetro revienta con "malformed array literal".
 *  · ÍNDICE ÚNICO: copiarla al maestro mientras el perdedor archivado conserva la suya VIOLA el
 *    índice único. El maestro conserva su id de origen; el perdedor el suyo.
 */
export async function columnasEnriquecibles(): Promise<ColumnasElegibles> {
  const cols = await query<any>(
    `select column_name, data_type, udt_name from information_schema.columns
      where table_schema = $1 and table_name = 'contactos_cache'`,
    [SCHEMA]
  );
  const unicas = new Set(
    (await query<any>(
      `select distinct a.attname as columna
         from pg_index i
         join pg_class c on c.oid = i.indrelid
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral unnest(i.indkey) as k(attnum)
         join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
        where n.nspname = $1 and c.relname = 'contactos_cache'
          and (i.indisunique or i.indisprimary)`,
      [SCHEMA]
    )).map((r) => r.columna)
  );

  const elegibles: string[] = [];
  const noElegibles: Record<string, string> = {};
  for (const r of cols) {
    const col = r.column_name as string;
    if (!esEnriquecible(col) || !ID_RE.test(col)) continue;      // no es un campo de datos del contacto
    const esArray = r.data_type === "ARRAY" || String(r.udt_name || "").startsWith("_");
    if (esArray) { noElegibles[col] = "Campo de lista (array): no se puede fusionar valor a valor. El maestro conserva el suyo."; continue; }
    if (unicas.has(col)) { noElegibles[col] = "Identificador de origen con índice único: copiarlo al maestro mientras el archivado conserva el suyo rompería la base."; continue; }
    elegibles.push(col);
  }
  // Estas dos nunca son elegibles y conviene que la UI lo diga explícitamente.
  noElegibles["id"] = "El maestro conserva su id: es al que apuntan todos los enlaces y relaciones.";
  noElegibles["created_at"] = "Fecha de creación original de cada ficha.";
  return { elegibles: elegibles.sort(), noElegibles };
}

// --------------------------------------------------------------------------------------------
// Heurística del maestro sugerido (la misma del script)
// --------------------------------------------------------------------------------------------
export interface CandidatoFusion {
  id: string;
  nombre_completo: string | null;
  updated_at: string | null;
  created_at: string | null;
  archivado: boolean;
  [k: string]: any;
}

const camposConDato = (c: CandidatoFusion) => Object.values(c).filter((v) => !vacio(v)).length;

/**
 * Más oportunidades → más campos con dato → `updated_at` más reciente. Devuelve también POR QUÉ,
 * porque la UI tiene que explicarle al usuario de dónde sale la sugerencia.
 */
export function sugerirMaestro(
  candidatos: CandidatoFusion[],
  numOps: Map<string, number>
): { maestroId: string; motivo: string } {
  const ordenados = [...candidatos].sort((a, b) => {
    const opsA = numOps.get(a.id) || 0, opsB = numOps.get(b.id) || 0;
    if (opsB !== opsA) return opsB - opsA;
    const cA = camposConDato(a), cB = camposConDato(b);
    if (cB !== cA) return cB - cA;
    return +new Date(b.updated_at || b.created_at || 0) - +new Date(a.updated_at || a.created_at || 0);
  });
  const g = ordenados[0], otro = ordenados[1];
  let motivo = "es el más completo";
  if (otro) {
    const opsG = numOps.get(g.id) || 0, opsO = numOps.get(otro.id) || 0;
    if (opsG !== opsO) motivo = `tiene más oportunidades (${opsG} frente a ${opsO})`;
    else if (camposConDato(g) !== camposConDato(otro)) motivo = `tiene más campos con dato (${camposConDato(g)} frente a ${camposConDato(otro)})`;
    else motivo = "se actualizó más recientemente";
  }
  return { maestroId: g.id, motivo };
}

// --------------------------------------------------------------------------------------------
// Bitácora
// --------------------------------------------------------------------------------------------
async function log(
  client: any,
  corrida: string,
  d: { accion: string; perdedor?: string | null; ganador?: string | null; tabla?: string | null; registro?: string | null; campo?: string | null; antes?: string | null; despues?: string | null }
) {
  await client.query(
    `insert into ${SCHEMA}.contactos_merge_log
       (corrida_id, accion, perdedor_id, ganador_id, tabla, registro_id, campo, valor_antes, valor_despues)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [corrida, d.accion, d.perdedor ?? null, d.ganador ?? null, d.tabla ?? null, d.registro ?? null, d.campo ?? null, d.antes ?? null, d.despues ?? null]
  );
}

/**
 * D9 — el motivo con el que la INTERFAZ archiva al perdedor.
 *
 * El CLI (`scripts/dedup-contactos.mjs`) y el valor por defecto de `fusionar()` conservan
 * `'fusionado (dedup)'`: hasta ahora las dos vías escribían lo mismo y en la ficha de un contacto
 * archivado era imposible saber si lo había fusionado una persona en pantalla o una corrida masiva.
 * Importa porque hay un guard entero dedicado a que nadie confunda las dos cosas: el endpoint de
 * revert RECHAZA las corridas masivas del CLI (§3.7 del guion de pruebas).
 *
 * 🔴 EL PREFIJO `fusionado` NO ES DECORATIVO. `esArchivadoAutomatico()`
 * (`contactos-archivado.ts`) clasifica por PREFIJO contra `["lead_sin_oportunidad", "fusionado"]`,
 * y de esa clasificación depende la regla de resurrección R12: un archivado "automático" puede
 * revivir si el sync lo vuelve a traer, uno "manual" no. Un motivo que no empiece por `fusionado`
 * convertiría al perdedor de una fusión en un archivado manual y el sync dejaría de poder tocarlo.
 * Si algún día se cambia este texto, tiene que seguir empezando igual.
 */
export const MOTIVO_FUSION_INTERFAZ = "fusionado (interfaz)";

export interface ResultadoFusion {
  corrida_id: string;
  maestroId: string;
  perdedorId: string;
  reasignaciones: number;
  camposEscritos: string[];
  /** Campos donde la elección del humano PISÓ un valor no vacío del maestro. */
  camposPisados: string[];
}

/**
 * Fusiona DOS contactos (D1: exactamente dos). Todo en una transacción: si algo falla, no queda
 * nada a medias.
 *
 * @param valoresElegidos `{ campo: contactoIdDeOrigen }`. OPCIONAL. Si no se pasa, se comporta
 *   EXACTAMENTE como el script masivo (rellenar solo huecos del maestro, nunca pisar). Si se pasa,
 *   para esos campos manda la elección del humano AUNQUE el maestro ya tenga valor.
 *   Cada escritura —también las que pisan— se loguea con `valor_antes`, que es lo que permite que
 *   `revertir()` siga funcionando sin tocarlo. Sin ese log, revertir dejaría el contacto corrupto.
 *
 *   🔴 Los tres campos de `CAMPOS_NO_ELEGIBLES_POR_SENSIBLES` se RECHAZAN aquí. Ojo con la
 *   distinción, que no es evidente: lo prohibido es ELEGIRLOS, no que el motor los fusione. La
 *   regla de huecos los sigue tratando como cualquier otro campo —si el maestro tiene el SSN vacío
 *   y el perdedor lo tiene, se conserva—, porque lo contrario perdería un dato que solo tenía uno
 *   de los dos.
 */
export async function fusionar(
  maestroId: string,
  perdedorId: string,
  opts: { valoresElegidos?: Record<string, string>; userId?: string | null; motivo?: string } = {}
): Promise<ResultadoFusion> {
  if (maestroId === perdedorId) throw new Error("el maestro y el perdedor no pueden ser el mismo contacto");

  const { fks } = await descubrirFKs();
  const { elegibles } = await columnasEnriquecibles();
  const setElegibles = new Set(elegibles);

  // Defensa en profundidad: la ruta ya valida, pero el motor no confía en su llamador.
  //
  // Los sensibles van PRIMERO y por su propia rama, con su propio mensaje: `setElegibles` los
  // contiene a propósito —el motor tiene que poder fusionarlos por la regla de huecos— así que el
  // filtro de abajo jamás los pararía. Hasta que se añadió esto, la frase de la línea de arriba era
  // falsa justo para los tres campos donde más caro sale: la única barrera vivía en la ruta
  // (`contactos-routes.ts`), y un llamador que no la repitiera escribía un SSN real encima de otro
  // SSN real sin que saltara nada. Lo encontró la suite (`tests/contactos-merge.test.ts`).
  for (const [campo, origen] of Object.entries(opts.valoresElegidos || {})) {
    if (CAMPOS_NO_ELEGIBLES_POR_SENSIBLES.includes(campo)) {
      throw new Error(`campo sensible no elegible: ${campo}. ${MOTIVO_SENSIBLE}`);
    }
    if (!setElegibles.has(campo)) throw new Error(`campo no elegible: ${campo}`);
    if (origen !== maestroId && origen !== perdedorId) throw new Error(`origen ajeno a esta fusión para el campo ${campo}`);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    // FOR UPDATE: bloquea las dos filas para que nadie las archive o edite a mitad de la fusión.
    const filas = (await client.query(
      `select * from ${SCHEMA}.contactos_cache where id = any($1::uuid[]) for update`,
      [[maestroId, perdedorId]]
    )).rows;
    const maestro = filas.find((r: any) => r.id === maestroId);
    const perdedor = filas.find((r: any) => r.id === perdedorId);
    if (!maestro || !perdedor) throw new Error("alguno de los contactos no existe");
    if (maestro.archivado === true || perdedor.archivado === true) throw new Error("no se puede fusionar un contacto archivado");

    const corrida = (await client.query("select gen_random_uuid() as id")).rows[0].id as string;
    let reasignaciones = 0;
    const camposEscritos: string[] = [];
    const camposPisados: string[] = [];

    // ---- 1) PLANO RELACIONAL: TODO lo del perdedor pasa al maestro. Sin elección posible. ----
    for (const fk of fks) {
      const tablaFull = `${fk.esquema}.${fk.tabla}`;
      const esAutoRef = fk.esquema === SCHEMA && fk.tabla === "contactos_cache";
      // En la auto-referencia se evita crear un self-loop en el maestro.
      const sql = esAutoRef
        ? `update ${tablaFull} set ${fk.columna} = $1 where ${fk.columna} = $2 and ${fk.pk} <> $1 returning ${fk.pk} as pk`
        : `update ${tablaFull} set ${fk.columna} = $1 where ${fk.columna} = $2 returning ${fk.pk} as pk`;
      const { rows } = await client.query(sql, [maestroId, perdedorId]);
      for (const r of rows) {
        await log(client, corrida, { accion: "reasignar_fk", perdedor: perdedorId, ganador: maestroId, tabla: tablaFull, registro: r.pk, campo: fk.columna, antes: perdedorId, despues: maestroId });
        reasignaciones++;
      }
    }

    // ---- 2) PLANO ESCALAR: aquí y solo aquí manda la elección del humano ----
    for (const col of elegibles) {
      const origen = opts.valoresElegidos?.[col];
      let valor: any;
      if (origen) {
        valor = origen === maestroId ? maestro[col] : perdedor[col];
        if (aTexto(valor) === aTexto(maestro[col])) continue;   // no cambia nada: ni se escribe ni se loguea
        if (!vacio(maestro[col])) camposPisados.push(col);       // pisa un valor lleno: legítimo, pero se cuenta
      } else {
        // Sin elección explícita: conducta clásica del script — solo rellenar huecos, nunca pisar.
        if (!vacio(maestro[col]) || vacio(perdedor[col])) continue;
        valor = perdedor[col];
      }
      await client.query(
        `update ${SCHEMA}.contactos_cache set ${col} = $1 where id = $2`,
        [typeof valor === "object" && valor !== null ? JSON.stringify(valor) : valor, maestroId]
      );
      await log(client, corrida, { accion: "enriquecer", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: maestroId, campo: col, antes: aTexto(maestro[col]), despues: aTexto(valor) });
      camposEscritos.push(col);
      maestro[col] = valor;
    }

    // ---- 3) Archivar al perdedor (estado previo logueado ANTES de escribir → reversible) ----
    //
    // D10 — TRAZABILIDAD. Hasta aquí la fusión archivaba sin `archivado_at` ni `archivado_por`,
    // mientras que la ruta normal de archivado sí los ponía. Consecuencia: en la papelera, ordenada
    // por "lo último archivado arriba", los perdedores de fusión caían al fondo — justo los que más
    // falta hace mirar. Ahora se escriben aquí también.
    //
    // ⚠️ CON LA MISMA DEFENSA QUE LA OLA 0: la mig. 0056 puede no estar aplicada (el deploy es
    // automático, `pnpm migrate` se corre a mano, y entre los dos momentos hay ventana). Nombrar
    // columnas inexistentes haría que fusionar devolviera 500. Se pregunta al catálogo una vez.
    //
    // 🔴 Y SE LOGUEAN, que es lo que las hace reversibles: `revertir()` reproduce `valor_antes` de
    // cada par (registro, campo). Si se escribieran sin loguear, tras revertir una fusión el
    // contacto volvería activo pero con la marca de archivado puesta — visible y mintiendo.
    //
    // El instante se captura en una variable en vez de usar `now()` dentro del UPDATE para que el
    // valor escrito y el logueado sean el MISMO. (Da igual a efectos de reloj —`now()` es el inicio
    // de la transacción— pero así no hay dos fuentes para el mismo dato.)
    const motivo = opts.motivo || "fusionado (dedup)";
    const conTrazabilidad = await tieneColumnasTrazabilidad();
    const ahora = (await client.query("select now() as t")).rows[0].t as Date;

    await log(client, corrida, { accion: "archivar", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: perdedorId, campo: "archivado", antes: String(!!perdedor.archivado), despues: "true" });
    await log(client, corrida, { accion: "archivar", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: perdedorId, campo: "archivado_motivo", antes: aTexto(perdedor.archivado_motivo), despues: motivo });
    await log(client, corrida, { accion: "archivar", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: perdedorId, campo: "fusionado_en_contacto_id", antes: aTexto(perdedor.fusionado_en_contacto_id), despues: maestroId });

    const setsArchivado = [`archivado = true`, `archivado_motivo = $1`, `fusionado_en_contacto_id = $2`];
    const paramsArchivado: any[] = [motivo, maestroId, perdedorId];
    if (conTrazabilidad) {
      await log(client, corrida, { accion: "archivar", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: perdedorId, campo: "archivado_at", antes: aTexto(perdedor.archivado_at), despues: aTexto(ahora) });
      await log(client, corrida, { accion: "archivar", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: perdedorId, campo: "archivado_por", antes: aTexto(perdedor.archivado_por), despues: aTexto(opts.userId ?? null) });
      paramsArchivado.push(ahora, opts.userId ?? null);
      setsArchivado.push(`archivado_at = $4`, `archivado_por = $5`);
    }
    await client.query(
      `update ${SCHEMA}.contactos_cache set ${setsArchivado.join(", ")} where id = $3`,
      paramsArchivado
    );

    // ---- 3-bis) Si venían del mismo grupo de "duplicados por revisar", el grupo queda resuelto ----
    // El motor automático los marcó para ojo humano; ese ojo humano acaba de decidir. Se limpia el
    // flag de TODOS los miembros del grupo (no solo de estos dos: si quedara uno suelto, seguiría
    // apareciendo como candidato sin nadie con quien compararlo). Va logueado, así que el revert
    // lo restaura como cualquier otro cambio.
    const grupo = maestro.revision_dedup_grupo || perdedor.revision_dedup_grupo;
    if (grupo && maestro.revision_dedup_grupo === perdedor.revision_dedup_grupo) {
      const miembros = (await client.query(
        `select id, revision_dedup, revision_dedup_grupo from ${SCHEMA}.contactos_cache
          where revision_dedup_grupo = $1 and revision_dedup = true for update`, [grupo]
      )).rows;
      for (const mb of miembros) {
        await log(client, corrida, { accion: "marcar_revision", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: mb.id, campo: "revision_dedup", antes: String(!!mb.revision_dedup), despues: "false" });
        await log(client, corrida, { accion: "marcar_revision", perdedor: perdedorId, ganador: maestroId, tabla: `${SCHEMA}.contactos_cache`, registro: mb.id, campo: "revision_dedup_grupo", antes: aTexto(mb.revision_dedup_grupo), despues: null });
      }
      if (miembros.length) {
        await client.query(
          `update ${SCHEMA}.contactos_cache set revision_dedup = false, revision_dedup_grupo = null
            where revision_dedup_grupo = $1 and revision_dedup = true`, [grupo]
        );
      }
    }

    // ---- 4) Auditoría general del CRM (quién fusionó qué) ----
    await client.query(
      `insert into ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       values ($1, $2, 'contactos_cache', $3, $4::jsonb, $5::jsonb)`,
      [
        opts.userId ?? null,
        `Fusionó "${perdedor.nombre_completo || "(sin nombre)"}" dentro de "${maestro.nombre_completo || "(sin nombre)"}"`,
        maestroId,
        JSON.stringify({ maestro_id: maestroId, perdedor_id: perdedorId, perdedor_nombre: perdedor.nombre_completo }),
        JSON.stringify({ corrida_id: corrida, reasignaciones, campos_escritos: camposEscritos, campos_pisados: camposPisados }),
      ]
    );

    await client.query("commit");
    return { corrida_id: corrida, maestroId, perdedorId, reasignaciones, camposEscritos, camposPisados };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Deshace una corrida entera desde la bitácora: reasignaciones de FK, enriquecimientos (incluidos
 * los que PISARON) y el archivado del perdedor. El log NO se borra — es auditoría (R10).
 *
 * ORDEN DE REPLAY — importa y no es obvio:
 * Se recorre en orden INVERSO DE ESCRITURA (`seq DESC`, la secuencia de la mig. 0060). Si un mismo
 * par (registro_id, campo) se escribió más de una vez en la corrida, aplicar los `valor_antes` de
 * más reciente a más antiguo deja al final el valor ORIGINAL, que es el que había antes de tocar
 * nada.
 *
 * ⚠️ NO se puede ordenar por `created_at`: es `default now()` y `now()` devuelve el instante de
 * inicio de la transacción, así que todas las filas de una misma fusión comparten timestamp; el
 * desempate caía en `id`, que es un uuid ALEATORIO. El orden era, literalmente, azar.
 *
 * `NULLS LAST` + el desempate viejo son para las filas anteriores a la 0060, que tienen `seq` NULL
 * y cuyo orden real ya no se puede reconstruir.
 */
export async function revertir(corridaId: string): Promise<{ filas: number; porAccion: Record<string, number> }> {
  const rows = await query<any>(
    `select id, accion, tabla, registro_id, campo, valor_antes
       from ${SCHEMA}.contactos_merge_log
      where corrida_id = $1
      order by seq desc nulls last, created_at desc, id desc`,
    [corridaId]
  );
  if (rows.length === 0) return { filas: 0, porAccion: {} };

  const pkCache = new Map<string, string | null>();
  const pkDeTabla = async (client: any, esquema: string, tabla: string) => {
    const key = `${esquema}.${tabla}`;
    if (pkCache.has(key)) return pkCache.get(key)!;
    const r = await client.query(
      `select a.attname as pk
         from pg_index i
         join pg_class c on c.oid = i.indrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
        where n.nspname = $1 and c.relname = $2 and i.indisprimary and i.indnkeyatts = 1`,
      [esquema, tabla]
    );
    const pk = r.rows[0]?.pk || null;
    pkCache.set(key, pk);
    return pk;
  };

  const porAccion: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const r of rows) {
      const [esq, tab] = String(r.tabla || "").split(".");
      if (!ID_RE.test(esq || "") || !ID_RE.test(tab || "") || !ID_RE.test(r.campo || "")) {
        throw new Error(`identificador inválido en el log: ${r.tabla} / ${r.campo}`);
      }
      const pk = await pkDeTabla(client, esq, tab);
      if (!pk || !ID_RE.test(pk)) throw new Error(`sin PK de una columna para ${r.tabla}: no se puede revertir con precisión`);
      await client.query(`update ${esq}.${tab} set ${r.campo} = $1 where ${pk} = $2`, [r.valor_antes, r.registro_id]);
      porAccion[r.accion] = (porAccion[r.accion] || 0) + 1;
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { filas: rows.length, porAccion };
}
