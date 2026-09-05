// ============================================================================================
// GLOBAL SETUP — levanta la base desechable antes de todo y la tira al terminar.
//
// Corre UNA vez por invocación de vitest (no por fichero). Lee la cabecera de `test-db.ts` para el
// porqué de que aquí haya un `DROP DATABASE` y por qué no contradice §0.
//
// POR QUÉ `pg_dump --schema-only` Y NO `pnpm migrate`:
// esta base se adoptó con `node scripts/run-migrations.mjs baseline 0029`, es decir, las
// migraciones `0001`–`0028` están marcadas como aplicadas pero **no reconstruyen el esquema desde
// cero**: buena parte de las tablas nacieron fuera de migraciones. Un `pnpm migrate` contra una
// base vacía no produciría `contactos_cache`. El dump del esquema local es la única forma de que
// la suite corra contra el esquema REAL, que es justo lo que hace falta cuando lo que se prueba es
// un motor que descubre las FKs dinámicamente.
// ============================================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import pg from "pg";
import { NOMBRE_BASE_PRUEBAS, urlAdministracion, urlBasePruebas, urlOrigenEsquema } from "./test-db.js";

/**
 * Localiza `pg_dump`. En el PATH si está; si no, en la instalación de Windows. Se puede forzar con
 * la variable `PG_DUMP`. Si no aparece, se para con un mensaje que dice qué hacer: sin esquema no
 * hay pruebas, y fallar aquí es infinitamente mejor que correr contra una base a medias.
 */
function localizarPgDump(): string {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  if (spawnSync("pg_dump", ["--version"], { encoding: "utf8" }).status === 0) return "pg_dump";

  const raiz = "C:\\Program Files\\PostgreSQL";
  if (existsSync(raiz)) {
    const versiones = readdirSync(raiz).sort().reverse();
    for (const v of versiones) {
      const ruta = `${raiz}\\${v}\\bin\\pg_dump.exe`;
      if (existsSync(ruta)) return ruta;
    }
  }
  throw new Error(
    "[pruebas] ABORTADO · no encuentro `pg_dump`.\n" +
      "La suite necesita copiar el esquema de la base local a la base desechable.\n" +
      "Ponlo en el PATH o exporta PG_DUMP con la ruta completa al ejecutable."
  );
}

/**
 * `pg_dump --schema-only` del origen. `--no-owner` y `--no-privileges` porque los roles del
 * servidor local no tienen por qué existir igual, y a las pruebas les da igual quién sea el dueño.
 */
function volcarEsquema(): string {
  const pgDump = localizarPgDump();
  const r = spawnSync(
    pgDump,
    // Solo `gozz`. `public` no se copia por dos razones: la base nueva ya lo trae de
    // `template1` (y el dump intentaría `CREATE SCHEMA public` sobre uno que ya existe), y lo único
    // que vive ahí es `schema_migrations`, que ningún código bajo prueba lee.
    ["--schema-only", "--no-owner", "--no-privileges", "--schema=gozz", urlOrigenEsquema()],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`[pruebas] pg_dump falló (${r.status}):\n${r.stderr || r.error?.message || "(sin stderr)"}`);
  }
  // pg_dump ≥ 17.6 emite `\restrict` / `\unrestrict`, que son meta-comandos de psql y no SQL: el
  // driver los rechazaría. Se quitan todas las líneas que empiezan por `\`.
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("\\"))
    .join("\n");
}

async function conAdmin(fn: (c: pg.Client) => Promise<void>): Promise<void> {
  const c = new pg.Client({ connectionString: urlAdministracion() });
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
  }
}

/**
 * Tira la base si existe. Se llama ANTES de crearla también: si una corrida anterior murió a medio
 * camino (Ctrl-C), la base quedó ahí y hay que empezar de cero, no sobre restos.
 */
async function tirarBase(c: pg.Client): Promise<void> {
  // Sin esto, `DROP DATABASE` falla si quedó algún cliente colgado del pool de una corrida previa.
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [NOMBRE_BASE_PRUEBAS]
  );
  // El nombre es la constante del módulo, nunca una variable: ver el guard en `test-db.ts`.
  await c.query(`DROP DATABASE IF EXISTS ${NOMBRE_BASE_PRUEBAS}`);
}

export async function setup(): Promise<void> {
  const esquema = volcarEsquema();

  await conAdmin(async (c) => {
    await tirarBase(c);
    await c.query(`CREATE DATABASE ${NOMBRE_BASE_PRUEBAS}`);
  });

  const c = new pg.Client({ connectionString: urlBasePruebas() });
  await c.connect();
  try {
    // `pg_trgm` va APARTE del dump y no es opcional: la señal de parecido de nombres
    // (`lib/contactos-dedup.ts`) usa `similarity()`. No viene en el volcado porque éste va filtrado
    // por `--schema=gozz` y la extensión vive en `public`. La migración `0054` ya la declara
    // (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) y está instalada en staging y producción; aquí se
    // crea explícitamente para que la base desechable se parezca a esos entornos y no a una local
    // que pudiera tenerla sin instalar.
    await c.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await c.query(esquema);
  } finally {
    await c.end();
  }

  console.log(`[pruebas] base desechable "${NOMBRE_BASE_PRUEBAS}" creada con el esquema real`);
}

export async function teardown(): Promise<void> {
  await conAdmin(tirarBase);
  console.log(`[pruebas] base desechable "${NOMBRE_BASE_PRUEBAS}" destruida`);
}
