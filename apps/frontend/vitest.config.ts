import path from "node:path";
import { defineConfig } from "vitest/config";

// ============================================================================================
// Configuración de la suite del FRONTEND. Ver `docs/CONVENCIONES.md` §9.
//
// FASE 1: **solo lógica pura** de `src/lib/`. Nada de componentes, nada de red, nada de base de
// datos — aquí no hace falta ninguna de las tres, y por eso esto puede existir sin arrastrar el
// aparato que sí necesita la suite de la API.
//
// 🔴 `environment: "node"` está puesto EXPLÍCITAMENTE, no por omisión. No hay DOM y **no debe
// haberlo en esta fase**: en cuanto aparezca un `jsdom`, empiezan a colarse pruebas de componente
// y esta suite deja de ser lo que se autorizó. Cuando se decida montar la FASE 2, será una
// decisión propia y se verá en el diff de este fichero.
//
// El alias `@` hace falta porque los tests importan `@/lib/…` igual que el resto del código. Se
// resuelve aquí con `node:path` en vez de instalar `vite-tsconfig-paths`: una dependencia menos
// para replicar tres líneas, y así el `paths` del tsconfig y el alias del runner se leen juntos.
// ============================================================================================

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Lista TODOS los casos con su resultado, no solo los que fallan: el reporte de una entrega es
    // la salida literal, y "2 passed" no dice qué se probó. Mismo criterio que la API.
    reporters: ["verbose"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
