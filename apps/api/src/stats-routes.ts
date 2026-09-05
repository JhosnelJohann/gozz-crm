import type { Express } from "express";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";

export function registerStatsRoutes(app: Express) {
  app.get("/api/stats/clientes-ganados", requireAuth, async (_req, res) => {
  const rows = await query<any>(`
    SELECT
      o.id, o.nombre_caso, o.etapa, o.valor_total, o.updated_at,
      c.id AS contacto_id, c.nombre_completo AS contacto_nombre,
      tc.nombre AS tramite_nombre, tc.codigo AS tramite_codigo, tc.formulario_uscis,
      u_prep.nombre AS preparador_nombre
    FROM gozz.oportunidades o
    LEFT JOIN gozz.contactos_cache c ON c.id = o.contacto_id
    LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
    LEFT JOIN gozz.users u_prep ON u_prep.id = o.preparador_id
    WHERE o.etapa IN ('aprobado','completado')
      AND o.updated_at >= NOW() - INTERVAL '7 days'
    ORDER BY o.updated_at DESC
    LIMIT 20
  `);
  const totals = await query<any>(`
    SELECT
      COUNT(*)::int AS total_count,
      COALESCE(SUM(valor_total), 0)::float AS total_valor
    FROM gozz.oportunidades
    WHERE etapa IN ('aprobado','completado')
      AND updated_at >= NOW() - INTERVAL '7 days'
  `);
  res.json({
    ganados: rows,
    total_count: totals[0]?.total_count || 0,
    total_valor: totals[0]?.total_valor || 0
  });
  });

  app.get("/api/stats", requireAuth, async (_req, res) => {
  const stats = await query<any>(`
    SELECT
      (SELECT COUNT(*)::int FROM gozz.contactos_cache WHERE COALESCE(archivado, false) = false) AS contactos,
      (SELECT COUNT(*)::int FROM gozz.oportunidades) AS oportunidades,
      (SELECT COUNT(*)::int FROM gozz.oportunidades WHERE etapa NOT IN ('ganado','perdido','completado','cancelado')) AS en_progreso,
      (SELECT COUNT(*)::int FROM gozz.oportunidades WHERE sla_estado = 'vencido') AS sla_vencido,
      (SELECT COUNT(*)::int FROM gozz.tareas WHERE estado NOT IN ('completada','cancelada')) AS tareas_pendientes,
      (SELECT COUNT(*)::int FROM gozz.users WHERE activo = true) AS usuarios_activos
  `);
  // Desgloses para el dashboard (server-side) — evita que el dashboard baje TODAS las oportunidades (~1.4MB).
  const [porEtapaRows, porSlaRows, totRows] = await Promise.all([
    query<any>("SELECT etapa, count(*)::int AS n FROM gozz.oportunidades GROUP BY etapa"),
    query<any>("SELECT sla_estado, count(*)::int AS n FROM gozz.oportunidades GROUP BY sla_estado"),
    query<any>("SELECT COALESCE(SUM(valor_total),0)::float8 AS valor, COALESCE(SUM(balance_pendiente),0)::float8 AS balance FROM gozz.oportunidades"),
  ]);
  const por_etapa: Record<string, number> = {};
  for (const r of porEtapaRows) por_etapa[r.etapa] = r.n;
  const por_sla: Record<string, number> = {};
  for (const r of porSlaRows) if (r.sla_estado) por_sla[r.sla_estado] = r.n;
  res.json({
    stats: {
      ...stats[0],
      por_etapa,
      por_sla,
      valor_total: totRows[0]?.valor || 0,
      balance_total: totRows[0]?.balance || 0,
    },
  });
  });

}
