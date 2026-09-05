import type { Express, Request, Response } from "express";
import { z } from "zod";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { auditarCambiosDeEtapa } from "./lib/auditoria-etapa.js";

// Paleta preset de 20 colores para trámites
export const PALETA_TRAMITES = [
  "#FF8609","#2196C9","#43A847","#E53935","#FFB51C","#8B4EE6","#FF5E8A","#00B8D4",
  "#FFA200","#7B1FA2","#F06292","#00897B","#5D4037","#3949AB","#D81B60","#6A1B9A",
  "#00695C","#EF6C00","#AD1457","#283593"
];

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

// ==================== Helper: ejecutar automations al entrar en etapa ====================
export async function runStageAutomations(opId: string, newStageKey: string, actorUserId?: string) {
  try {
    const stages = await query<any>(
      "SELECT id, key, campos_obligatorios FROM gozz.pipeline_stages WHERE key = $1 AND activa = true",
      [newStageKey]
    );
    const stage = stages[0];
    if (!stage) return;
    const autos = await query<any>(
      "SELECT id, tipo, config FROM gozz.stage_automations WHERE stage_id = $1 AND activa = true ORDER BY orden ASC, created_at ASC",
      [stage.id]
    );
    for (const a of autos) {
      try {
        await executeAutomation(a.tipo, a.config || {}, opId, actorUserId);
        await query(
          "INSERT INTO gozz.stage_automation_logs (oportunidad_id, stage_id, automation_id, estado, resultado) VALUES ($1,$2,$3,'ok',$4::jsonb)",
          [opId, stage.id, a.id, JSON.stringify({ tipo: a.tipo })]
        );
      } catch (err: any) {
        await query(
          "INSERT INTO gozz.stage_automation_logs (oportunidad_id, stage_id, automation_id, estado, resultado) VALUES ($1,$2,$3,'error',$4::jsonb)",
          [opId, stage.id, a.id, JSON.stringify({ error: err?.message || String(err) })]
        );
      }
    }
  } catch (e: any) {
    console.error("[automations]", e?.message);
  }
}

async function executeAutomation(tipo: string, config: any, opId: string, actorUserId?: string) {
  const op = (await query<any>("SELECT * FROM gozz.oportunidades WHERE id = $1", [opId]))[0];
  if (!op) return;

  if (tipo === "crear_tarea") {
    const titulo = renderTemplate(config.titulo || "Tarea automática", { op });
    const descripcion = renderTemplate(config.descripcion || "", { op });
    const responsable_id = config.responsable_id || op.preparador_id || op.vendedor_id || actorUserId || null;
    const dias = Number(config.due_dias || 0);
    const fecha_limite = dias > 0 ? new Date(Date.now() + dias * 86400000).toISOString() : null;
    await query(
      `INSERT INTO gozz.tareas (titulo, descripcion, propietario_id, responsable_id, estado, prioridad, fecha_limite, oportunidad_id)
       VALUES ($1,$2,$3,$4,'pendiente',COALESCE($5,'normal'),$6,$7)`,
      [titulo, descripcion, actorUserId || null, responsable_id, config.prioridad || "normal", fecha_limite, opId]
    );
    return;
  }

  if (tipo === "enviar_webhook") {
    if (!config.url) throw new Error("webhook url requerida");
    const body = renderTemplate(JSON.stringify(config.payload || { oportunidad_id: opId }), { op });
    const res = await fetch(config.url, {
      method: config.method || "POST",
      headers: { "Content-Type": "application/json", ...(config.headers || {}) },
      body,
    });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
    return;
  }

  if (tipo === "notificar") {
    const target = config.user_id || op.preparador_id || op.vendedor_id;
    if (!target) return;
    const titulo = renderTemplate(config.titulo || "Notificación de oportunidad", { op });
    const mensaje = renderTemplate(config.mensaje || "Oportunidad actualizada", { op });
    await query(
      `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
       VALUES ($1,'oportunidad',$2,$3,COALESCE($4,'normal'),$5)`,
      [target, titulo, mensaje, config.prioridad || "normal", `/oportunidades/${opId}`]
    );
    return;
  }

  if (tipo === "asignar_preparador") {
    if (config.user_id) {
      await query("UPDATE gozz.oportunidades SET preparador_id = $1 WHERE id = $2", [config.user_id, opId]);
    }
    return;
  }

  if (tipo === "enviar_email") {
    console.log(`[automations] enviar_email pendiente para ${opId} (módulo correo requerido)`);
    return;
  }

  if (tipo === "mover_tras_dias") {
    return;
  }
}

function renderTemplate(tpl: string, ctx: { op: any }): string {
  return tpl.replace(/\{\{op\.([a-zA-Z_0-9]+)\}\}/g, (_m, k) => String((ctx.op as any)?.[k] ?? ""));
}

export async function validarCamposObligatorios(opId: string, newStageKey: string): Promise<string[]> {
  const stage = (await query<any>(
    "SELECT campos_obligatorios FROM gozz.pipeline_stages WHERE key = $1",
    [newStageKey]
  ))[0];
  const reqd = Array.isArray(stage?.campos_obligatorios) ? stage.campos_obligatorios : [];
  if (reqd.length === 0) return [];
  const op = (await query<any>("SELECT * FROM gozz.oportunidades WHERE id = $1", [opId]))[0];
  if (!op) return [];
  const missing: string[] = [];
  for (const f of reqd) {
    const v = (op as any)[f];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) missing.push(f);
  }
  return missing;
}

// ==================== Registro ====================
export function registerPipelineRoutes(app: Express) {
  app.get("/api/pipeline/stages", requireAuth, async (_req: Request, res: Response) => {
    const rows = await query<any>(
      "SELECT id, key, label, color, orden, es_terminal, es_ganado, campos_obligatorios, activa FROM gozz.pipeline_stages WHERE activa = true ORDER BY orden"
    );
    res.json({ stages: rows });
  });

  const StageSchema = z.object({
    key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, "key debe ser slug (a-z0-9_)"),
    label: z.string().min(1).max(60),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#5C6670"),
    orden: z.number().int().min(1).optional(),
    es_terminal: z.boolean().optional(),
    es_ganado: z.boolean().optional(),
    campos_obligatorios: z.array(z.string()).optional(),
  });

  app.post("/api/pipeline/stages", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const p = StageSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data;
    const orden = d.orden ?? ((await query<any>("SELECT COALESCE(MAX(orden),0)+1 AS n FROM gozz.pipeline_stages"))[0]?.n || 1);
    const rows = await query<any>(
      `INSERT INTO gozz.pipeline_stages (key, label, color, orden, es_terminal, es_ganado, campos_obligatorios)
       VALUES ($1,$2,$3,$4,COALESCE($5,false),COALESCE($6,false),COALESCE($7::jsonb,'[]'::jsonb)) RETURNING *`,
      [d.key, d.label, d.color, orden, d.es_terminal, d.es_ganado, d.campos_obligatorios ? JSON.stringify(d.campos_obligatorios) : null]
    );
    res.json({ stage: rows[0] });
  });

  app.patch("/api/pipeline/stages/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const p = StageSchema.partial().safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data as any;
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const set = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => (k === "campos_obligatorios" ? JSON.stringify(d[k]) : d[k]));
    const rows = await query<any>(
      `UPDATE gozz.pipeline_stages SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json({ stage: rows[0] });
  });

  app.delete("/api/pipeline/stages/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const destKey = (req.query.destino_key as string) || null;
    const st = (await query<any>("SELECT key FROM gozz.pipeline_stages WHERE id = $1", [req.params.id]))[0];
    if (!st) { res.status(404).json({ error: "No encontrada" }); return; }
    const count = (await query<any>("SELECT COUNT(*)::int AS n FROM gozz.oportunidades WHERE etapa = $1", [st.key]))[0].n;
    if (count > 0 && !destKey) { res.status(400).json({ error: "Hay oportunidades en esta etapa. Indica ?destino_key=XXX" }); return; }
    if (count > 0) {
      const dest = (await query<any>("SELECT key FROM gozz.pipeline_stages WHERE key = $1 AND activa = true", [destKey]))[0];
      if (!dest) { res.status(400).json({ error: "destino_key inválida" }); return; }

      // Los ids ANTES de moverlos: después ya no se sabe cuáles eran, porque el WHERE es por etapa.
      const movidas = await query<any>(
        "SELECT id FROM gozz.oportunidades WHERE etapa = $1", [st.key]
      );
      await query("UPDATE gozz.oportunidades SET etapa = $1 WHERE etapa = $2", [destKey, st.key]);

      // ── Bitácora, UNA FILA POR OPORTUNIDAD en UNA sola sentencia ──────────────────────────
      //
      // Retirar una etapa mueve en bloque todo lo que había en ella, y hasta ahora no dejaba
      // rastro: los casos aparecían en otra etapa sin que nada dijera cuándo ni por qué. Misma
      // forma que el cambio individual (`datos_antes.etapa` / `datos_despues.etapa`), y el mismo
      // patrón de `unnest` que usan `archivarContactos()` y el cambio masivo de etapa: una
      // sentencia sobre el conjunto, no un bucle (§3.6).
      await auditarCambiosDeEtapa(
        movidas.map((m: any) => ({
          id: String(m.id),
          antes: st.key,
          despues: String(destKey),
          accion: `Cambió la etapa a "${destKey}" (se retiró la etapa "${st.key}")`,
        })),
        { userId: u?.sub || null }
      );
    }
    await query("UPDATE gozz.pipeline_stages SET activa = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true, movidas: count });
  });

  app.post("/api/pipeline/stages/reorder", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const arr: { id: string; orden: number }[] = req.body?.orden || [];
    for (const r of arr) {
      await query("UPDATE gozz.pipeline_stages SET orden = $1 WHERE id = $2", [r.orden, r.id]);
    }
    res.json({ ok: true });
  });

  app.get("/api/pipeline/stages/:id/automations", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      "SELECT id, tipo, config, activa, orden FROM gozz.stage_automations WHERE stage_id = $1 ORDER BY orden, created_at",
      [req.params.id]
    );
    res.json({ automations: rows });
  });

  const AutoSchema = z.object({
    tipo: z.enum(["crear_tarea","enviar_webhook","notificar","enviar_email","asignar_preparador","mover_tras_dias"]),
    config: z.record(z.any()).default({}),
    activa: z.boolean().optional(),
    orden: z.number().int().optional(),
  });

  app.post("/api/pipeline/stages/:id/automations", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const p = AutoSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const rows = await query<any>(
      `INSERT INTO gozz.stage_automations (stage_id, tipo, config, activa, orden)
       VALUES ($1,$2,$3::jsonb,COALESCE($4,true),COALESCE($5,0)) RETURNING *`,
      [req.params.id, p.data.tipo, JSON.stringify(p.data.config), p.data.activa, p.data.orden]
    );
    res.json({ automation: rows[0] });
  });

  app.patch("/api/pipeline/automations/:aid", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const p = AutoSchema.partial().safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data as any;
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const set = fields.map((k, i) => `${k} = $${i + 2}${k === "config" ? "::jsonb" : ""}`).join(", ");
    const values = fields.map((k) => (k === "config" ? JSON.stringify(d[k]) : d[k]));
    const rows = await query<any>(`UPDATE gozz.stage_automations SET ${set} WHERE id = $1 RETURNING *`, [req.params.aid, ...values]);
    res.json({ automation: rows[0] });
  });

  app.delete("/api/pipeline/automations/:aid", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    await query("DELETE FROM gozz.stage_automations WHERE id = $1", [req.params.aid]);
    res.json({ ok: true });
  });

  const TramiteSchema = z.object({
    nombre: z.string().min(2),
    codigo: z.string().min(1),
    formulario_uscis: z.string().optional().nullable(),
    descripcion: z.string().optional().nullable(),
    valor_base: z.number().optional(),
    sla_dias: z.number().int().optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
    es_tramite_administrativo: z.boolean().optional(),
    puntaje_preparador: z.number().optional(),
    puntaje_vendedor: z.number().optional(),
    puntaje_manager_ventas: z.number().optional(),
    puntaje_manager_preparacion: z.number().optional(),
    puntaje_manager_general: z.number().optional(),
    activo: z.boolean().optional(),
  });

  async function pickSuggestedColor(): Promise<string> {
    const used = await query<any>("SELECT color FROM gozz.tramites_config WHERE activo = true AND color IS NOT NULL");
    const usedSet = new Set<string>(used.map((r: any) => (r.color || "").toUpperCase()));
    for (const c of PALETA_TRAMITES) {
      if (!usedSet.has(c.toUpperCase())) return c;
    }
    const rand = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    return "#" + rand() + rand() + rand();
  }

  app.get("/api/tramites/color-disponible", requireAuth, async (req: Request, res: Response) => {
    const requested = (req.query.color as string) || "";
    const normalized = requested.toUpperCase();
    if (requested) {
      const taken = await query<any>(
        "SELECT id, nombre FROM gozz.tramites_config WHERE activo = true AND UPPER(color) = $1",
        [normalized]
      );
      if (taken[0]) {
        const sugerido = await pickSuggestedColor();
        res.json({ disponible: false, tomado_por: taken[0], sugerido, paleta: PALETA_TRAMITES });
        return;
      }
      res.json({ disponible: true, paleta: PALETA_TRAMITES });
      return;
    }
    const sugerido = await pickSuggestedColor();
    res.json({ disponible: true, sugerido, paleta: PALETA_TRAMITES });
  });

  app.post("/api/tramites", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const p = TramiteSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data;
    if (d.color) {
      const taken = await query<any>("SELECT nombre FROM gozz.tramites_config WHERE activo = true AND UPPER(color) = UPPER($1)", [d.color]);
      if (taken[0]) { res.status(409).json({ error: "Color en uso", tomado_por: taken[0], sugerido: await pickSuggestedColor() }); return; }
    }
    try {
      const rows = await query<any>(
        `INSERT INTO gozz.tramites_config (nombre, codigo, formulario_uscis, descripcion, valor_base, sla_dias, color, es_tramite_administrativo, puntaje_preparador, puntaje_vendedor, puntaje_manager_ventas, puntaje_manager_preparacion, puntaje_manager_general, activo)
         VALUES ($1,$2,$3,$4,COALESCE($5::numeric,0),COALESCE($6::int,30),$7,COALESCE($8,false),COALESCE($9::numeric,0),COALESCE($10::numeric,0),COALESCE($11::numeric,0),COALESCE($12::numeric,0),COALESCE($13::numeric,0),COALESCE($14,true)) RETURNING *`,
        [d.nombre, d.codigo, d.formulario_uscis, d.descripcion, d.valor_base, d.sla_dias, d.color, d.es_tramite_administrativo, d.puntaje_preparador, d.puntaje_vendedor, (d as any).puntaje_manager_ventas, (d as any).puntaje_manager_preparacion, (d as any).puntaje_manager_general, d.activo]
      );
      res.json({ tramite: rows[0] });
    } catch (e: any) {
      if (e?.code === "23505") { res.status(409).json({ error: `Ya existe un tramite con el codigo "${d.codigo}". Usa un codigo distinto.` }); return; }
      console.error("[tramites POST]", e?.message || e);
      res.status(500).json({ error: e?.message || "Error al guardar el tramite" });
    }
  });

  app.patch("/api/tramites/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const p = TramiteSchema.partial().safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: p.error.issues }); return; }
    const d = p.data as any;
    if (d.color) {
      const taken = await query<any>(
        "SELECT id, nombre FROM gozz.tramites_config WHERE activo = true AND UPPER(color) = UPPER($1) AND id != $2",
        [d.color, req.params.id]
      );
      if (taken[0]) { res.status(409).json({ error: "Color en uso", tomado_por: taken[0], sugerido: await pickSuggestedColor() }); return; }
    }
    const fields = Object.keys(d);
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const set = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => d[k]);
    try {
      const rows = await query<any>(
        `UPDATE gozz.tramites_config SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id, ...values]
      );
      res.json({ tramite: rows[0] });
    } catch (e: any) {
      if (e?.code === "23505") { res.status(409).json({ error: `Ya existe un tramite con el codigo "${d.codigo}". Usa un codigo distinto.` }); return; }
      console.error("[tramites PATCH]", e?.message || e);
      res.status(500).json({ error: e?.message || "Error al actualizar el tramite" });
    }
  });

  app.delete("/api/tramites/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    await query("UPDATE gozz.tramites_config SET activo = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  });

  app.post("/api/oportunidades/:id/validar-etapa", requireAuth, async (req: Request, res: Response) => {
    const { nueva_etapa } = req.body || {};
    const missing = await validarCamposObligatorios(String(req.params.id), String(nueva_etapa));
    res.json({ ok: missing.length === 0, missing });
  });
}
