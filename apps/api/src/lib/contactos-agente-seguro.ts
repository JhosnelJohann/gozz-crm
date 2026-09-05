import { query } from "../shared/db.js";

// ============================================================================================
// EL AGENTE DE SEGURO DE SALUD DE UN CONTACTO — las reglas de escritura
//
// El campo existe para **segmentar la cartera por agente** y calificar leads. Esa justificación
// manda sobre todo lo de aquí: **si el dato no se puede agrupar, el campo no sirve**. Cada regla
// de este módulo protege esa agrupación de una forma distinta de ensuciarse.
//
// Son dos columnas, excluyentes:
//   · `agente_seguro_id`   → un usuario del CRM
//   · `agente_seguro_otro` → un nombre escrito a mano, solo para "Otro"
// El CHECK de la migración 0070 impide que las dos estén rellenas a la vez, y lo impide en la
// BASE porque la API no es el único camino: un UPDATE suelto o una importación también escriben.
// ============================================================================================

export const AGENTE_NO_VALIDO =
  "Ese agente de seguro no está disponible. Elige a alguien del equipo o escribe el nombre en «Otro».";

export type ResultadoAgente =
  | { ok: true; agente_seguro_id: string | null; agente_seguro_otro: string | null }
  | { ok: false; error: string };

/**
 * Resuelve qué se va a guardar, o dice que no se guarda nada.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 UN AGENTE QUE NO EXISTE O ESTÁ INACTIVO SE **RECHAZA**. NO SE COACCIONA A NULO.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Es literalmente `CONVENCIONES §2.8.3`. Allí el caso real fue un `"enviarr"` que se guardaba en
 * silencio como "solo leer", y quien lo mandó se quedó creyendo que había concedido el envío.
 *
 * Aquí el equivalente es peor, porque el campo es de segmentación: un id que no vale guardado como
 * `NULL` sale del CRM como **"contacto sin agente"**, y quien lo puso cree que lo segmentó. El
 * error no aparece al guardar — aparece meses después, cuando una campaña deja fuera a gente que
 * sí tenía agente y nadie sabe por qué falta.
 *
 * ⚠️ **Inactivo cuenta como no válido, y ese caso es real, no teórico.** En la base hay un
 * `Julio Laya` inactivo con el mismo apellido que una de las dos agentes: una comprobación
 * de "existe" a secas lo aceptaría. Por eso se mira `activo`, y por eso en ningún sitio de esta
 * funcionalidad se busca a nadie por apellido.
 *
 * ⚠️ Lo que YA ESTABA GUARDADO no se toca aunque el agente se dé de baja después. Ese dato es
 * histórico y es cierto; lo que no se permite es ASIGNAR a alguien que ya no está. La ficha se
 * encarga de decir que ese agente ya no está disponible (§4.7).
 */
export async function resolverAgenteSeguro(d: {
  agente_seguro_id?: string | null;
  agente_seguro_otro?: string | null;
}): Promise<ResultadoAgente> {
  const id = d.agente_seguro_id ?? null;
  const otro = typeof d.agente_seguro_otro === "string" ? d.agente_seguro_otro.trim() : d.agente_seguro_otro ?? null;

  // Elegir persona limpia el texto y viceversa: son excluyentes y el CHECK de la base lo exige.
  // Se normaliza aquí en vez de dejar que reviente el CHECK porque un 500 de Postgres no le dice
  // nada a quien está rellenando una ficha.
  if (id) {
    if (!(await esAgenteAsignable(id))) return { ok: false, error: AGENTE_NO_VALIDO };
    return { ok: true, agente_seguro_id: id, agente_seguro_otro: null };
  }

  // Un texto en blanco es "no hay agente", no un agente que se llama "   ".
  return { ok: true, agente_seguro_id: null, agente_seguro_otro: otro || null };
}

/** ¿Se le puede ASIGNAR este agente hoy? Existe y sigue activo. */
export async function esAgenteAsignable(userId: string): Promise<boolean> {
  const filas = await query(
    "SELECT 1 FROM gozz.users WHERE id = $1 AND COALESCE(activo, true) = true LIMIT 1",
    [userId]
  );
  return filas.length > 0;
}

/**
 * ¿Este cambio deja al contacto SIN seguro de salud?
 *
 * Cuando `tiene_seguro_salud` deja de ser `true`, **las dos columnas del agente se limpian a la
 * vez**. Un contacto "sin seguro" con un agente asignado es el estado contradictorio que ensucia
 * justo la segmentación para la que se pidió el campo: al agrupar por agente aparecerían personas
 * que no tienen seguro.
 *
 * Se comprueba `=== false` y también `null`: los tres estados de la columna son sí / no / no se
 * sabe, y solo el primero justifica que haya un agente.
 */
export function pierdeElSeguro(valor: unknown): boolean {
  return valor === false || valor === null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// QUIÉNES SE OFRECEN EN LA PANTALLA (tanda C4, 2026-08-20)
//
// La ficha ofrecía **todos** los usuarios activos, y no es eso: los agentes de seguro son dos
// personas concretas. El resto del equipo aparecía en una lista donde no pinta nada.
//
// 🔴 SE RESUELVEN POR EMAIL, Y NO POR UUID, Y EL MOTIVO NO ES DE ESTILO.
// Staging y producción son **bases distintas**: las mismas dos personas tienen un `id` diferente
// en cada una. Un uuid escrito en el código funcionaría en un entorno y en el otro no encontraría
// a nadie — **en silencio**, guardando "sin agente" mientras quien lo puso cree que segmentó. El
// email sí es estable entre entornos.
//
// 🔴 TAMPOCO SE ESCRIBE EL NOMBRE. El que se enseña sale de la BASE (§4.7 y porque la base manda):
// si a alguien le corrigen el nombre, la pantalla se entera sola. Aquí solo vive la lista de
// quiénes son, que es lo único que el código tiene que saber.
// ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los dos agentes de seguro, por email y EN EL ORDEN EN QUE SE PINTAN.
 *
 * El orden es el de esta lista y no el alfabético de la base: es una lista de dos y se lee mejor
 * estable. Añadir o quitar un agente es editar esta constante — no una migración, porque los
 * agentes son usuarios y ya existen.
 */
export const EMAILS_AGENTES_SEGURO = [
  "alessandro.garagozzo@gozz-agencia.com",
  "jhosnel.laya@gmail.com",
] as const;

export interface AgenteOfrecido { id: string; nombre: string }

/**
 * Ordena y filtra lo que devuelve la base para que la pantalla lo pinte tal cual.
 *
 * Pura, para poder probarla sin base. Hace tres cosas y las tres importan:
 *   · respeta el orden de `EMAILS_AGENTES_SEGURO`, no el que devuelva Postgres;
 *   · compara el email **sin distinguir mayúsculas** — así entró más de un correo en esta base;
 *   · 🔴 **descarta a quien no esté**. Si uno de los dos no existe en ese entorno, su opción NO se
 *     pinta: ofrecer una opción muerta que al guardar devuelve 400 es peor que no ofrecerla.
 */
export function ordenarAgentesOfrecidos(
  filas: Array<{ id: string; nombre: string | null; email: string | null }>
): AgenteOfrecido[] {
  const porEmail = new Map<string, { id: string; nombre: string | null }>();
  for (const f of filas) {
    const e = (f.email || "").trim().toLowerCase();
    if (e) porEmail.set(e, { id: f.id, nombre: f.nombre });
  }
  // `flatMap` con [] para descartar, en vez de filter + predicado de tipo: la lista de emails es
  // `as const` y el predicado obligaria a repetir su union literal aqui, que es ruido sin valor.
  return EMAILS_AGENTES_SEGURO.flatMap((email) => {
    const u = porEmail.get(email);
    if (!u) return [];
    return [{ id: u.id, nombre: (u.nombre || "").trim() || email }];
  });
}

/**
 * Los agentes que se pueden ofrecer HOY en este entorno: existen y están activos.
 *
 * ⚠️ Esto acota lo que ENSEÑA la pantalla, no lo que ACEPTA el servidor. `resolverAgenteSeguro`
 * sigue admitiendo a cualquier usuario activo, y con razón: en staging ya hay un contacto guardado
 * con un agente, y estrechar la validación lo dejaría sin poder guardarse. Restringir la lista es
 * una decisión de interfaz; rechazar un valor imposible es una de integridad, y son cosas
 * distintas.
 */
export async function listarAgentesSeguro(): Promise<AgenteOfrecido[]> {
  const filas = await query<any>(
    `SELECT id, nombre, email FROM gozz.users
      WHERE lower(btrim(email)) = ANY($1::text[]) AND COALESCE(activo, true) = true`,
    [EMAILS_AGENTES_SEGURO.map((e) => e.toLowerCase())]
  );
  return ordenarAgentesOfrecidos(filas);
}
