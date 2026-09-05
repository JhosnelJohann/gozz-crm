import type { Express } from "express";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";

/** Catálogos de solo lectura: trámites, usuarios (directorio) y departamentos. */
export function registerCatalogosRoutes(app: Express) {
  app.get("/api/tramites", requireAuth, async (_req, res) => {
  const rows = await query(
    "SELECT id, nombre, codigo, formulario_uscis, descripcion, valor_base, sla_dias, puntaje_preparador, puntaje_vendedor, puntaje_manager_ventas, puntaje_manager_preparacion, puntaje_manager_general, color, es_tramite_administrativo, activo FROM gozz.tramites_config WHERE activo = true ORDER BY nombre"
  );
  res.json({ tramites: rows });
});

  app.get("/api/users", requireAuth, async (_req, res) => {
  const rows = await query(
    "SELECT id, email, nombre, nivel_acceso, posiciones, foto_perfil_url, activo, online, ultimo_login, departamento FROM gozz.users ORDER BY nombre"
  );
  res.json({ users: rows });
});

  app.get("/api/departamentos", requireAuth, async (_req, res) => {
  const rows = await query("SELECT id, nombre, color FROM gozz.departamentos ORDER BY nombre");
  res.json({ departamentos: rows });
});
}
