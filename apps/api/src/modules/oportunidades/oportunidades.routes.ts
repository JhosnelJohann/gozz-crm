import type { Express } from "express";
import type { Oportunidad } from "@gozz/shared-types";
import { requireAuth } from "../../shared/auth-middleware.js";
import { OportunidadSchema } from "./oportunidades.schemas.js";
import * as oportunidadesService from "./oportunidades.service.js";

export function registerOportunidadesRoutes(app: Express) {
  // ============================================================================================
  // 🔴 ESTE ENDPOINT NO PUEDE CAMBIAR DE CONDUCTA PARA QUIEN YA LO USA.
  //
  // `components/correo/EmailDetailDrawer.tsx` lo llama SIN NINGÚN PARÁMETRO y espera la lista
  // completa para poblar el desplegable con el que se vincula un correo a una oportunidad. Si la
  // paginación pasara a ser el comportamiento por defecto, esa pantalla se rompería EN SILENCIO:
  // el desplegable se quedaría corto y nadie se enteraría hasta que alguien no encontrase su caso.
  // Los parámetros nuevos son OPCIONALES y sin ellos la respuesta es la de siempre. Tiene test
  // propio (`oportunidades-filtro.test.ts`), no un comentario.
  //
  // MUESTREO (histórico, intacto): ?estado=abiertas · ?terminal_limit=N · ?limit=N
  // SEMÁNTICOS (nuevos, opcionales): ?tramite=(uuid|sin_tramite) ?asignado= ?sla= ?solo_mios=1
  //                                  ?etapa= ?desde= ?hasta= ?campo_fecha=(created_at|fecha_completada)
  //                                  ·   paginación: ?page= ?pageSize=
  //
  // `campo_fecha` elige sobre QUÉ fecha corre el rango. Con `fecha_completada` la respuesta trae
  // además `sin_fecha` (por etapa): cuántas quedan fuera por no tenerla. No es decorativo — solo
  // 431 de 6.920 ganadas la tienen, así que sin ese número el filtro miente por omisión.
  //
  // ⚠️ Los CONTEOS usan el mismo WHERE semántico que la lista. Antes salían de un `count(*)` sin
  // ningún WHERE, y por eso el badge decía 6.920 mientras la columna enseñaba 2. Un total que no
  // cuadra con las filas es peor que no tener total: es el defecto D2 de Contactos.
  app.get("/api/oportunidades", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const resultado = await oportunidadesService.listar({ userId: u?.sub ?? null, query: req.query as any });
    if ("error" in resultado) { res.status(400).json({ error: resultado.error }); return; }
    res.json(resultado.resultado);
  });

  app.post("/api/oportunidades", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const parsed = OportunidadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const oportunidad: Oportunidad = await oportunidadesService.crear(parsed.data, u?.sub || null, req.body?.tramites_extra);
    res.json({ oportunidad });
  });

  app.patch("/api/oportunidades/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const parsed = OportunidadSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

    const resultado = await oportunidadesService.actualizar(String(req.params.id), parsed.data, u?.sub || null);
    if (resultado.tipo === "sin_cambios") { res.json({ ok: true }); return; }
    if (resultado.tipo === "error") {
      res.status(resultado.error.status).json(
        resultado.error.missing ? { error: resultado.error.error, missing: resultado.error.missing } : { error: resultado.error.error }
      );
      return;
    }
    const oportunidad: Oportunidad = resultado.oportunidad;
    res.json({ oportunidad });
  });

  app.delete("/api/oportunidades/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u?.nivel !== "super_admin" && u?.nivel !== "admin") {
      res.status(403).json({ error: "Solo admins pueden eliminar oportunidades" });
      return;
    }
    await oportunidadesService.eliminar(String(req.params.id), u?.sub);
    res.json({ ok: true });
  });
}
