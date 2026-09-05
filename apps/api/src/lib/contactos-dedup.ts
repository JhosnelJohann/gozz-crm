import { query } from "../shared/db.js";
import DOMINIOS from "./dominios-propios.json";

// ============================================================================================
// SEÑALES DEL FILTRO "DUPLICADOS POR REVISAR"
//
// Este módulo existe porque el filtro es la herramienta con la que un equipo HUMANO decide qué
// contactos se fusionan, y fusionar es irreversible en la práctica. Todo lo de aquí cambia QUÉ SE
// MUESTRA y CÓMO SE EXPLICA. 🔴 Nada de esto toca datos: las marcas `revision_dedup` se quedan
// donde están (CONVENCIONES §0). Un grupo que aquí se oculta sigue marcado en la base.
// ============================================================================================

// --------------------------------------------------------------------------------------------
// D4 — Los dominios de correo de la propia agencia
// --------------------------------------------------------------------------------------------
/**
 * 🔴 LISTA AMPLIABLE. Si mañana la agencia usa otro dominio, se añade en
 * `apps/api/src/lib/dominios-propios.json` y con eso basta: es la ÚNICA fuente de verdad, y la
 * leen los dos sitios que la necesitan.
 *
 * QUÉ PROBLEMA RESUELVE: el grupo `email:facturacion@gozz-agencia.com` juntaba a dos
 * clientes reales sin ninguna relación entre sí, solo porque alguien había puesto el email de
 * facturación DE LA AGENCIA en las dos fichas. Quien se fiara del filtro y fusionara ese grupo
 * mezclaba dos expedientes. Un correo nuestro no identifica a una persona: identifica a la casa.
 *
 * POR QUÉ LA LISTA VIVE EN UN `.json` Y NO EN ESTE `.ts`: la tiene que leer TAMBIÉN
 * `scripts/dedup-contactos.mjs`, que es quien PONE las marcas. Ese script es `.mjs` suelto y se
 * ejecuta sin build, así que no puede importar TypeScript (misma razón por la que el motor de
 * fusión está duplicado allí; ver la nota de deuda en `contactos-merge.ts`). Un `.json` sí lo
 * pueden consumir los dos: aquí por `import` —`resolveJsonModule`, y `tsc` lo copia a `dist/`— y
 * allí leyéndolo del disco. Si se arregla solo uno de los dos lados, el otro sigue generando las
 * marcas malas.
 */
export const DOMINIOS_PROPIOS: string[] = DOMINIOS;

/** El dominio de un email, en minúsculas. `null` si no lo parece. */
export function dominioDeEmail(email: string | null | undefined): string | null {
  const v = String(email ?? "").trim().toLowerCase();
  const i = v.lastIndexOf("@");
  return i > 0 && i < v.length - 1 ? v.slice(i + 1) : null;
}

export function esEmailDeDominioPropio(email: string | null | undefined): boolean {
  const d = dominioDeEmail(email);
  return d !== null && DOMINIOS_PROPIOS.includes(d);
}

/**
 * ¿La clave de un grupo de dedup (`email:…` / `tel:…`) es un correo nuestro?
 * Solo aplica a las claves de email: agrupar por teléfono nuestro no se ha observado.
 */
export function esClaveDeDominioPropio(clave: string | null | undefined): boolean {
  const v = String(clave ?? "").trim().toLowerCase();
  return v.startsWith("email:") && esEmailDeDominioPropio(v.slice("email:".length));
}

// --------------------------------------------------------------------------------------------
// D2 + D4 — Qué grupos se ENSEÑAN en "duplicados por revisar"
// --------------------------------------------------------------------------------------------

/**
 * Los fragmentos de WHERE del filtro. Viven aquí y no en `contactos-routes.ts` para que exista
 * UNA sola definición: la usan el listado, el contador de la cabecera y la resolución de la
 * selección masiva —todos pasan por el constructor único de filtro— y las pruebas ejercitan
 * exactamente esto, no una copia.
 *
 * `addP` es el mismo acumulador de parámetros del llamador: nada se interpola en el SQL.
 */
export function sqlDuplicadosRevisables(addP: (v: any) => string): string[] {
  return [
    `revision_dedup = true AND revision_dedup_grupo IS NOT NULL`,

    // ---- D2: fuera lo que NO se puede fusionar ----
    // Fusionar exige EXACTAMENTE 2 contactos vivos, así que un contacto marcado que se quedó sin
    // pareja activa no es accionable: ocupa sitio y no se puede hacer nada con él.
    // Medido en staging: 43 grupos con un solo miembro activo frente a 15 con pareja viva → de las
    // 73 filas que listaba, 43 eran ruido. Se generó cuando Leads→Clientes archivó a la pareja de
    // esos grupos y la marca se quedó puesta en el superviviente.
    // 🔴 NO se limpian las marcas: se OCULTAN (§0). El dato se queda donde está.
    `EXISTS (SELECT 1 FROM gozz.contactos_cache c2
              WHERE c2.revision_dedup_grupo = contactos_cache.revision_dedup_grupo
                AND c2.revision_dedup = true
                AND COALESCE(c2.archivado, false) = false
                AND c2.id <> contactos_cache.id)`,

    // ---- D4: fuera los grupos formados por un correo NUESTRO ----
    // Ver el bloque de DOMINIOS_PROPIOS. `split_part` sobre la clave (`email:<addr>`) compara el
    // dominio EXACTO — nada de LIKE, que trataría un `_` del dominio como comodín.
    `NOT (lower(revision_dedup_grupo) LIKE 'email:%'
          AND split_part(lower(revision_dedup_grupo), '@', 2) = ANY(${addP(DOMINIOS_PROPIOS)}::text[]))`,
  ];
}

// --------------------------------------------------------------------------------------------
// D5 — Cuánto se parecen dos nombres
// --------------------------------------------------------------------------------------------

/**
 * QUÉ HABÍA ANTES Y POR QUÉ NO SERVÍA: la señal era `nombre normalizado de A !== nombre normalizado
 * de B`, es decir, igualdad exacta. Dos duplicados reales casi nunca tienen el nombre escrito
 * idéntico —si lo tuvieran, la dedup automática ya los habría fusionado sin pedir revisión—, así
 * que el aviso salía en CASI TODO lo que llegaba a esa pantalla. Un aviso que aparece siempre no
 * informa: quien audita aprende a ignorarlo en dos días, y el día que sea una familia de verdad lo
 * salta igual. En staging, 9 de los 15 grupos accionables son familias reales: el caso peligroso es
 * el mayoritario.
 *
 * 🔴 POR QUÉ NO BASTA CON UN UMBRAL DE `similarity()`, MEDIDO Y NO SUPUESTO:
 * las dos clases SE SOLAPAN. Sobre formas sintéticas con la misma forma que las reales:
 *
 *   FAMILIA  hermanos, apellidos largos ... 0.7586   ← más alto que un duplicado
 *   DUPLICADO segundo nombre largo ......... 0.5122   ← más bajo que una familia
 *
 * Cualquier corte único deja mal clasificado uno de los dos. La similitud global mide "cuánto texto
 * comparten", y eso premia a dos hermanos que comparten dos apellidos largos por encima de una
 * misma persona con un segundo nombre de más.
 *
 * LO QUE SÍ SEPARA: mirar los nombres como CONJUNTOS DE PALABRAS y preguntarse *quién tiene una
 * palabra que el otro no*. A nivel de token la señal es limpísima —medido: dos nombres de pila
 * distintos dan `similarity()` **0.0000** (bruno/ximena, ana/eva, maria/fernanda)—:
 *
 *   · Si CADA ficha tiene un nombre propio que la otra no tiene  → son DOS PERSONAS → familia.
 *   · Si una ficha es la otra más palabras (segundo nombre, apellido de casada, inicial)
 *                                                                → es LA MISMA PERSONA → duplicado.
 *
 * Y por encima de todo eso, una regla dura: si un nombre describe un PARENTESCO ("Esposa de …",
 * "Sra … madre") y el otro no, es familia, diga lo que diga la similitud.
 */

/** Sin acentos, en minúsculas, sin puntuación y con los espacios colapsados. */
export function normalizarNombre(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Partículas que no identifican a nadie: no cuentan como "una palabra que el otro no tiene". */
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "da", "do", "dos", "van", "von"]);

/**
 * Palabras que describen un VÍNCULO, no a una persona. Ampliable.
 * Se han visto fichas creadas literalmente como "Esposa de <titular>" en los casos de asilo, donde
 * el dependiente no tenía nombre propio en el sistema todavía.
 */
const MARCADORES_PARENTESCO = new Set([
  "esposa", "esposo", "conyuge", "pareja", "hijo", "hija", "hijastro", "hijastra",
  "madre", "padre", "mama", "papa", "mamá", "papá", "hermano", "hermana",
  "abuelo", "abuela", "nieto", "nieta", "tio", "tia", "primo", "prima",
  "sobrino", "sobrina", "suegro", "suegra", "cunado", "cunada",
  "dependiente", "familiar", "pariente", "beneficiario", "beneficiaria",
  "sr", "sra", "srta", "senor", "senora", "senorita",
]);

export function tokenizarNombre(s: string | null | undefined): string[] {
  return normalizarNombre(s).split(" ").filter((t) => t.length > 0 && !PARTICULAS.has(t));
}

export const esMarcadorDeParentesco = (t: string) => MARCADORES_PARENTESCO.has(t);

// ---- Umbrales. Justificados con medidas, no a ojo. Ver el bloque de arriba y las pruebas. ----

/**
 * Dos tokens son "la misma palabra escrita distinto" a partir de aquí.
 * Medido: nombres de pila distintos dan **0.0000** (bruno/ximena, ana/eva, maria/fernanda,
 * quintero/salas, villalobos/echeverry). Erratas que conservan los trigramas dan 0.55–0.62
 * (quintero/quintro, villalobos/villalobs). Lo más alto medido entre dos palabras genuinamente
 * distintas fue 0.3333 (salas/sales). 0.4 deja margen a los dos lados.
 */
export const UMBRAL_TOKEN = 0.4;

/**
 * Cuando una ficha CONTIENE a la otra (tiene sus palabras y alguna más), pedimos además esta
 * similitud global para llamarlo duplicado. Medido, los supersets legítimos van de 0.5122
 * (dos nombres de más) a 0.8824. Por debajo de 0.45 hay tanto texto ajeno que la conclusión deja
 * de estar sostenida: eso es `dudoso`, no un veredicto.
 */
export const UMBRAL_SUPERSET = 0.45;

export type NivelParecido = "probable_duplicado" | "dudoso" | "probable_familia";

export interface ParecidoNombres {
  /** `similarity()` de pg_trgm sobre los nombres normalizados. 0..1. */
  similitud: number;
  nivel: NivelParecido;
  /** Por qué salió ese nivel, en una frase, para poder enseñarlo en pantalla. */
  motivo: string;
  /** Compatibilidad: el frontend viejo lee este booleano. Ahora se DERIVA del nivel. */
  posible_familia: boolean;
}

/**
 * Compara dos nombres y devuelve la señal graduada.
 *
 * Usa `pg_trgm`, que la migración `0054` ya declara (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) y
 * que está instalada en staging y producción. Todo va en UNA consulta: la similitud global y la
 * matriz de similitudes token a token (a lo sumo unas decenas de pares).
 */
export async function analizarParecidoNombres(
  nombreA: string | null | undefined,
  nombreB: string | null | undefined
): Promise<ParecidoNombres> {
  const na = normalizarNombre(nombreA);
  const nb = normalizarNombre(nombreB);
  const tokensA = tokenizarNombre(nombreA);
  const tokensB = tokenizarNombre(nombreB);

  // Sin nombre en alguno de los dos no hay nada que comparar, y afirmar que son la misma persona
  // sería peor que decir "no lo sé".
  if (!na || !nb || tokensA.length === 0 || tokensB.length === 0) {
    return {
      similitud: 0,
      nivel: "dudoso",
      motivo: "Al menos uno de los dos contactos no tiene un nombre utilizable: no se puede juzgar el parecido.",
      posible_familia: false,
    };
  }

  const [fila] = await query<any>(
    `SELECT similarity($1, $2)::float8 AS global,
            COALESCE((SELECT jsonb_agg(jsonb_build_array(a.t, b.t, similarity(a.t, b.t)))
                        FROM unnest($3::text[]) a(t)
                        CROSS JOIN unnest($4::text[]) b(t)), '[]'::jsonb) AS pares`,
    [na, nb, tokensA, tokensB]
  );
  const similitud = Number(fila?.global ?? 0);
  const pares: [string, string, number][] = fila?.pares ?? [];

  // Regla dura y primera: un nombre que describe un vínculo no es un nombre.
  const parentescoA = tokensA.some(esMarcadorDeParentesco);
  const parentescoB = tokensB.some(esMarcadorDeParentesco);
  if (parentescoA !== parentescoB) {
    return {
      similitud,
      nivel: "probable_familia",
      motivo:
        "Uno de los dos nombres describe un PARENTESCO (por ejemplo «Esposa de…»), no a una persona con nombre propio. " +
        "Es el patrón típico de titular y dependiente compartiendo teléfono o email.",
      posible_familia: true,
    };
  }

  const emparejado = (t: string, otros: string[]) =>
    otros.some((u) => pares.some(([x, y, s]) => ((x === t && y === u) || (x === u && y === t)) && s >= UMBRAL_TOKEN));

  const sueltosA = tokensA.filter((t) => !emparejado(t, tokensB));
  const sueltosB = tokensB.filter((t) => !emparejado(t, tokensA));

  if (sueltosA.length > 0 && sueltosB.length > 0) {
    return {
      similitud,
      nivel: "probable_familia",
      motivo:
        `Cada ficha tiene un nombre que la otra no tiene («${sueltosA.join(" ")}» frente a ` +
        `«${sueltosB.join(" ")}»). Comparten teléfono o email, pero apuntan a DOS personas distintas.`,
      posible_familia: true,
    };
  }

  if (sueltosA.length === 0 && sueltosB.length === 0) {
    return {
      similitud,
      nivel: "probable_duplicado",
      motivo: "Los dos nombres están formados por las mismas palabras: es la misma persona escrita de dos maneras.",
      posible_familia: false,
    };
  }

  // Uno contiene al otro: segundo nombre, apellido de casada, una inicial…
  const extra = (sueltosA.length ? sueltosA : sueltosB).join(" ");
  if (similitud >= UMBRAL_SUPERSET) {
    return {
      similitud,
      nivel: "probable_duplicado",
      motivo: `Un nombre es el otro con algo más («${extra}»): encaja con la misma persona registrada dos veces.`,
      posible_familia: false,
    };
  }
  return {
    similitud,
    nivel: "dudoso",
    motivo:
      `Un nombre contiene al otro, pero con mucho texto de diferencia («${extra}»). No hay señal suficiente ` +
      `para decidir: compruébalo a mano antes de fusionar.`,
    posible_familia: false,
  };
}
