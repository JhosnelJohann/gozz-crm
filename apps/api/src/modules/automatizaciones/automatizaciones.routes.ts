import type { Express, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../shared/auth-middleware.js";
import { esAdminEnBase } from "../../lib/permisos.js";
import * as whatsappRepo from "../whatsapp/whatsapp.repository.js";
import { verificarAcceso as verificarAccesoConexionWhatsApp } from "../whatsapp/whatsapp.service.js";
import * as service from "./automatizaciones.service.js";
import {
  CrearAgenteIASchema,
  ActualizarAgenteIASchema,
  CrearReglaSchema,
  ActualizarReglaSchema,
  CrearRecordatorioSchema,
  RespuestaAgenteSchema,
} from "./automatizaciones.schemas.js";

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "";

function requireN8nSecret(req: Request, res: Response, next: NextFunction) {
  const got = req.header("X-N8N-Secret") || "";
  if (!N8N_WEBHOOK_SECRET || got !== N8N_WEBHOOK_SECRET) {
    res.status(401).json({ error: "invalid_n8n_secret" });
    return;
  }
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = (req as any).user;
  if (!(await esAdminEnBase(u?.sub))) { res.status(403).json({ error: "Solo un administrador puede hacer esto" }); return; }
  next();
}

export function registerAutomatizacionesRoutes(app: Express) {
  // ---- Agentes de IA ----
  app.get("/api/automatizaciones/agentes", requireAuth, async (_req, res) => {
    res.json({ agentes: await service.listarAgentesIA() });
  });

  app.post("/api/automatizaciones/agentes", requireAuth, requireAdmin, async (req, res) => {
    const parsed = CrearAgenteIASchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const agente = await service.crearAgenteIA(parsed.data.nombre, parsed.data.email, parsed.data.n8nWebhookUrl ?? null);
      res.json({ agente });
    } catch (e: any) {
      res.status(400).json({ error: e?.code === "23505" ? "Ya existe un usuario con ese correo" : (e?.message || "No se pudo crear el agente") });
    }
  });

  app.patch("/api/automatizaciones/agentes/:id", requireAuth, requireAdmin, async (req, res) => {
    const parsed = ActualizarAgenteIASchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const agente = await service.actualizarAgenteIA(String(req.params.id), parsed.data);
      res.json({ agente });
    } catch (e: any) {
      res.status(404).json({ error: e?.message || "No se pudo actualizar el agente" });
    }
  });

  // ---- Reglas ----
  app.get("/api/automatizaciones/reglas", requireAuth, async (_req, res) => {
    res.json({ reglas: await service.listarReglas() });
  });

  app.post("/api/automatizaciones/reglas", requireAuth, requireAdmin, async (req, res) => {
    const parsed = CrearReglaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const regla = await service.crearRegla({
        nombre: parsed.data.nombre,
        etapaId: parsed.data.etapaId ?? null,
        tagId: parsed.data.tagId ?? null,
        agenteId: parsed.data.agenteId,
        asignarConversacion: parsed.data.asignarConversacion,
      });
      res.json({ regla });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo crear la regla" });
    }
  });

  app.patch("/api/automatizaciones/reglas/:id", requireAuth, requireAdmin, async (req, res) => {
    const parsed = ActualizarReglaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const regla = await service.actualizarRegla(String(req.params.id), parsed.data);
      res.json({ regla });
    } catch (e: any) {
      res.status(404).json({ error: e?.message || "No se pudo actualizar la regla" });
    }
  });

  app.delete("/api/automatizaciones/reglas/:id", requireAuth, requireAdmin, async (req, res) => {
    await service.eliminarRegla(String(req.params.id));
    res.json({ ok: true });
  });

  // ---- Recordatorios ----
  app.get("/api/automatizaciones/recordatorios", requireAuth, async (_req, res) => {
    res.json({ recordatorios: await service.listarRecordatorios() });
  });

  app.post("/api/automatizaciones/recordatorios", requireAuth, async (req, res) => {
    const parsed = CrearRecordatorioSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const u = (req as any).user;
    const d = parsed.data;
    // Solo puede programar un recordatorio de WhatsApp para una conversación cuya conexión ya
    // puede ver — mismo control que usa el propio módulo de WhatsApp para leer/escribir mensajes.
    if (d.canal === "whatsapp" && d.conversacionId) {
      const conversacion = await whatsappRepo.getConversacion(d.conversacionId);
      if (!conversacion) { res.status(404).json({ error: "Conversación no encontrada" }); return; }
      const acceso = await verificarAccesoConexionWhatsApp(conversacion.conexion_id, u.sub, u.nivel);
      if (!acceso) { res.status(403).json({ error: "No tienes acceso a esa conversación" }); return; }
    }
    try {
      const recordatorio = await service.crearRecordatorio({
        canal: d.canal,
        conversacionId: d.conversacionId ?? null,
        contactoId: d.contactoId ?? null,
        buzonId: d.buzonId ?? null,
        asunto: d.asunto ?? null,
        mensaje: d.mensaje,
        programadoPara: d.programadoPara,
        creadoPor: u.sub,
      });
      res.json({ recordatorio });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo crear el recordatorio" });
    }
  });

  app.delete("/api/automatizaciones/recordatorios/:id", requireAuth, async (req, res) => {
    try {
      await service.cancelarRecordatorio(String(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo cancelar" });
    }
  });

  // ---- Webhook entrante de n8n: el workflow responde EN NOMBRE de un agente de IA ----
  app.post("/api/automatizaciones/n8n/mensaje", requireN8nSecret, async (req, res) => {
    const parsed = RespuestaAgenteSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const mensaje = await service.recibirRespuestaAgente(parsed.data.conversacion_id, parsed.data.agente_id, parsed.data.contenido);
      res.json({ ok: true, mensaje });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo enviar la respuesta" });
    }
  });
}
