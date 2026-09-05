import { defineConfig } from "vitest/config";
import { urlBasePruebas } from "./tests/setup/test-db.js";

// ============================================================================================
// Configuración de la suite. Ver `docs/CONVENCIONES.md` §9.
//
// `env.DATABASE_URL` se resuelve AQUÍ, al cargar la config, y no en un fichero de setup, porque
// `src/db.ts` crea el pool EN EL MOMENTO DE IMPORTARSE. Si la variable llegara más tarde, el pool
// ya estaría apuntando a la base de desarrollo. Resolverla en la config garantiza que ningún
// módulo del código de producción se importe con la URL equivocada.
// (`db.ts` hace `import "dotenv/config"`, pero dotenv NO pisa las variables ya presentes, así que
// el `.env` de desarrollo no puede recuperar el control.)
//
// `fileParallelism: false` porque los dos ficheros de test comparten la misma base desechable y
// siembran contactos: en paralelo se pisarían los conteos.
// ============================================================================================

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    env: { DATABASE_URL: urlBasePruebas() },
    // Lista TODOS los casos con su resultado, no solo los que fallan: el reporte de una entrega es
    // la salida literal, y "2 passed" no dice qué se probó.
    reporters: ["verbose"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
