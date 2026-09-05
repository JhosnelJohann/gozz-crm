// ============================================================================================
// LA BASE DESECHABLE DE LAS PRUEBAS — y el guard que impide que apunten a otra cosa
//
// 🔴 POR QUÉ ESTO NO CONTRADICE `CONVENCIONES.md` §0 (nada se borra físicamente):
// §0 protege DATOS DE NEGOCIO. Lo que esta suite crea y destruye es un ANDAMIO: una base
// `crm_test_fusion` que la propia suite levanta vacía, siembra con fixtures sintéticos y tira al
// terminar. Nunca contiene una fila real, nunca se restaura de un dump de negocio y nunca la lee
// nadie más. Si dentro de seis meses lees un `DROP DATABASE` aquí y te sobresalta: es correcto, y
// lo que lo hace correcto es el guard de abajo, no la buena intención de quien lo escribió.
//
// EL GUARD, tres condiciones, y falla ruidosamente si alguna no se cumple:
//   1. el host es `localhost` o `127.0.0.1` — jamás el VPS;
//   2. el nombre de la base es EXACTAMENTE `crm_test_fusion`;
//   3. ese nombre es una CONSTANTE de este fichero, no se compone de ninguna variable, así que no
//      hay forma de que una env mal puesta lo convierta en `crm_staging` ni en `postgres`.
//
// La conexión de ADMINISTRACIÓN es la única excepción a (2), y no puede no serla: `CREATE DATABASE`
// no se puede ejecutar dentro de la base que crea, hay que emitirlo desde otra. Se conecta a la
// base de mantenimiento `postgres` del servidor LOCAL y solo se usa para dos sentencias, las dos
// nombrando la constante: `DROP DATABASE IF EXISTS crm_test_fusion` y `CREATE DATABASE
// crm_test_fusion`. Ninguna otra consulta pasa por ahí.
// ============================================================================================

import "dotenv/config";

/** 🔴 Constante. No se compone, no se lee de env, no se parametriza. */
export const NOMBRE_BASE_PRUEBAS = "crm_test_fusion";

/** Bases que la suite no puede tocar bajo ningún concepto. */
const BASES_PROHIBIDAS = new Set(["crm_staging", "postgres", "template0", "template1"]);

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1"]);

function parsear(url: string, etiqueta: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[pruebas] ${etiqueta}: DATABASE_URL no es una URL válida`);
  }
  return u;
}

/** Falla ruidosamente si la URL no apunta a la máquina local. */
function exigirLocal(u: URL, etiqueta: string): void {
  if (!HOSTS_LOCALES.has(u.hostname)) {
    throw new Error(
      `[pruebas] ABORTADO · ${etiqueta} apunta a "${u.hostname}", que no es local.\n` +
        `Las pruebas SOLO corren contra localhost. Nunca contra el VPS, ni staging, ni producción.`
    );
  }
}

/**
 * La URL de la base de desarrollo local (`crm_staging`), de donde se copia el ESQUEMA.
 * Solo se lee de ella (`pg_dump --schema-only`): ni una escritura.
 */
export function urlOrigenEsquema(): string {
  const raw = process.env.DATABASE_URL_ORIGEN || process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("[pruebas] ABORTADO · no hay DATABASE_URL: no sé de dónde copiar el esquema.");
  }
  const u = parsear(raw, "el origen del esquema");
  exigirLocal(u, "el origen del esquema");
  if (u.pathname.replace(/^\//, "") === NOMBRE_BASE_PRUEBAS) {
    throw new Error(
      `[pruebas] ABORTADO · el origen del esquema no puede ser la propia base de pruebas.`
    );
  }
  return u.toString();
}

/** La URL de la base DESECHABLE. Es la única contra la que corren los tests. */
export function urlBasePruebas(): string {
  const u = parsear(urlOrigenEsquema(), "la base de pruebas");
  u.pathname = `/${NOMBRE_BASE_PRUEBAS}`;
  u.search = "";
  verificarBasePruebas(u.toString());
  return u.toString();
}

/**
 * Guard reutilizable: lo llama la config de vitest al arrancar y CADA fichero de test antes de
 * abrir el pool. Barato de ejecutar y caro de olvidar, así que se repite a propósito.
 */
export function verificarBasePruebas(url: string): void {
  const u = parsear(url, "la base de pruebas");
  exigirLocal(u, "la base de pruebas");
  const base = u.pathname.replace(/^\//, "");
  if (BASES_PROHIBIDAS.has(base)) {
    throw new Error(
      `[pruebas] ABORTADO · las pruebas intentaron apuntar a "${base}".\n` +
        `Esa base contiene datos reales. La suite solo puede tocar "${NOMBRE_BASE_PRUEBAS}".`
    );
  }
  if (base !== NOMBRE_BASE_PRUEBAS) {
    throw new Error(
      `[pruebas] ABORTADO · la base es "${base}" y tiene que ser exactamente "${NOMBRE_BASE_PRUEBAS}".`
    );
  }
}

/**
 * La URL que la suite YA está usando: la inyecta `vitest.config.ts` en `DATABASE_URL` antes de que
 * se importe nada. Es la que necesita un test que quiera abrir su PROPIO cliente (por ejemplo para
 * simular un proceso rival en la prueba de concurrencia). No se recalcula desde el origen —dentro
 * del worker el origen ya es la base de pruebas y el guard, con razón, lo rechazaría—, pero sí se
 * vuelve a verificar.
 */
export function urlEnUso(): string {
  const raw = process.env.DATABASE_URL || "";
  verificarBasePruebas(raw);
  return raw;
}

/**
 * URL de MANTENIMIENTO, para las dos únicas sentencias que no se pueden emitir desde dentro de la
 * base que crean. Ver la cabecera: por aquí no pasa ninguna otra consulta.
 */
export function urlAdministracion(): string {
  const u = parsear(urlOrigenEsquema(), "la conexión de administración");
  exigirLocal(u, "la conexión de administración");
  u.pathname = "/postgres";
  u.search = "";
  return u.toString();
}
