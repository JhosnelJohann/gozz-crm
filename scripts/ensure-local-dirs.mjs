// scripts/ensure-local-dirs.mjs
// Crea las carpetas locales de subida de archivos (SOLO desarrollo local).
// Alojan archivos de PRUEBA y están git-ignored (.gitignore: data/). Nunca se versionan.
// Idempotente y a prueba de fallos: nunca rompe la instalación (siempre exit 0).
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dirs = [join(root, "data", "uploads"), join(root, "data", "uploads", "avatars")];
  for (const d of dirs) { mkdirSync(d, { recursive: true }); console.log("✓ carpeta lista:", d); }
  console.log("\nEn apps/api/.env (solo local) define:  UPLOADS_DIR=" + join(root, "data", "uploads"));
} catch (e) {
  console.warn("[setup:local-dirs] aviso:", e?.message || e);
}
process.exit(0);
