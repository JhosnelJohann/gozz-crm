import type { Express, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { UPLOADS_ROOT, shard, putUploadedBytesToR2 } from "../../lib/storage.js";
import * as whatsappService from "../whatsapp/whatsapp.service.js";
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
  N8nEnviarMensajeSchema,
  N8nEtapaSchema,
  N8nTagSchema,
  N8nAsignarSchema,
} from "./automatizaciones.schemas.js";

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || "";

function requireN8nSecret(req: Request, res: Response, next: NextFunction) {
  const got = Buffer.from(req.header("X-N8N-Secret") || "");
  const want = Buffer.from(N8N_WEBHOOK_SECRET);
  // Comparación en tiempo constante: un `!==` deja medir cuántos caracteres coinciden.
  if (!N8N_WEBHOOK_SECRET || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
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

const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
const EXT_POR_TIPO: Record<string, string> = { imagen: ".jpg", video: ".mp4", audio: ".ogg", archivo: ".bin" };

/** Descarga la media que manda n8n (URL pública) y la guarda como adjunto propio de la
 * conversación — mismo almacenamiento que los adjuntos que sube el equipo. Solo http(s), con
 * límite de tamaño y tiempo, para que una URL mala no cuelgue ni llene el servidor. */
async function descargarMediaN8n(conversacionId: string, url: string, tipo: string, nombre?: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Solo se aceptan URLs http(s)");
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!r.ok) throw new Error(`No se pudo descargar la media (HTTP ${r.status})`);
  const largo = Number(r.headers.get("content-length") || 0);
  if (largo > MEDIA_MAX_BYTES) throw new Error("La media supera 16 MB");
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > MEDIA_MAX_BYTES) throw new Error("La media está vacía o supera 16 MB");
  const base = (nombre || path.basename(u.pathname) || "adjunto").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
  const ext = path.extname(base) || EXT_POR_TIPO[tipo] || ".bin";
  const dirRel = `whatsapp/n8n/${shard(conversacionId)}/${conversacionId}`;
  const filename = `${Date.now()}_${path.basename(base, path.extname(base))}${ext}`;
  await fs.promises.mkdir(path.join(UPLOADS_ROOT, dirRel), { recursive: true });
  await fs.promises.writeFile(path.join(UPLOADS_ROOT, dirRel, filename), buf);
  const archivoUrl = `/uploads/${dirRel}/${filename}`;
  // Fallo ruidoso a propósito (igual que las subidas por HTTP en lib/storage.ts): el worker de
  // WhatsApp corre en otra máquina y lee el adjunto desde R2 — sin él, el envío fallaría después.
  await putUploadedBytesToR2(archivoUrl, buf, r.headers.get("content-type") || undefined).catch((e: any) => {
    throw new Error(`No se pudo guardar la media en el almacenamiento: ${e?.message || e}`);
  });
  return { archivoUrl, archivoNombre: nombre || filename, archivoTamanio: buf.length };
}

/** Errores de "no existe" → 404; el resto de validaciones de negocio → 400. */
function responderError(res: Response, e: any, porDefecto: string) {
  const msg = e?.message || porDefecto;
  res.status(/no encontrad/i.test(msg) ? 404 : 400).json({ error: msg });
}

export function registerAutomatizacionesRoutes(app: Express) {
  // Etapa y asignación → eventos de n8n (`conversacion.etapa`, `conversacion.asignada`) para los
  // agentes suscritos. `emitirEventoN8n` nunca lanza.
  whatsappService.eventosConversacion.on("etapa", ({ conversacionId, etapaId }) => {
    service.emitirEventoN8n("conversacion.etapa", conversacionId, { etapa_id: etapaId }).catch(() => {});
  });
  whatsappService.eventosConversacion.on("asignada", ({ conversacionId, asignadoA }) => {
    service.emitirEventoN8n("conversacion.asignada", conversacionId, { asignado_a: asignadoA }).catch(() => {});
  });

  // ---- Agentes de IA ----
  app.get("/api/automatizaciones/agentes", requireAuth, async (_req, res) => {
    res.json({ agentes: await service.listarAgentesIA() });
  });

  app.post("/api/automatizaciones/agentes", requireAuth, requireAdmin, async (req, res) => {
    const parsed = CrearAgenteIASchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const agente = await service.crearAgenteIA(parsed.data.nombre, parsed.data.email, parsed.data.n8nWebhookUrl ?? null, parsed.data.n8nEventos ?? []);
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

  // ---- API para n8n: todo con el header X-N8N-Secret (docs/N8N-INTEGRACION.md) ----
  app.get("/api/n8n/conversaciones/:id/contexto", requireN8nSecret, async (req, res) => {
    const contexto = await service.n8nContexto(String(req.params.id));
    if (!contexto) { res.status(404).json({ error: "Conversación no encontrada" }); return; }
    res.json(contexto);
  });

  app.post("/api/n8n/conversaciones/:id/mensajes", requireN8nSecret, async (req, res) => {
    const parsed = N8nEnviarMensajeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const id = String(req.params.id);
    const d = parsed.data;
    try {
      const media = d.tipo !== "texto" && d.archivo_url
        ? { tipo: d.tipo, ...(await descargarMediaN8n(id, d.archivo_url, d.tipo, d.archivo_nombre)) }
        : undefined;
      const mensaje = await service.recibirRespuestaAgente(id, d.agente_id, d.contenido ?? null, media);
      res.json({ ok: true, mensaje });
    } catch (e: any) {
      responderError(res, e, "No se pudo enviar el mensaje");
    }
  });

  app.patch("/api/n8n/conversaciones/:id/etapa", requireN8nSecret, async (req, res) => {
    const parsed = N8nEtapaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const conversacion = await service.n8nCambiarEtapa(String(req.params.id), { id: parsed.data.etapa_id, key: parsed.data.etapa_key });
      res.json({ ok: true, conversacion });
    } catch (e: any) {
      responderError(res, e, "No se pudo cambiar la etapa");
    }
  });

  app.post("/api/n8n/conversaciones/:id/tags", requireN8nSecret, async (req, res) => {
    const parsed = N8nTagSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const tags = await service.n8nEtiquetar(String(req.params.id), {
        tagId: parsed.data.tag_id, nombre: parsed.data.tag_nombre, accion: parsed.data.accion, crear: parsed.data.crear_si_no_existe,
      });
      res.json({ ok: true, tags });
    } catch (e: any) {
      responderError(res, e, "No se pudo etiquetar");
    }
  });

  app.patch("/api/n8n/conversaciones/:id/asignar", requireN8nSecret, async (req, res) => {
    const parsed = N8nAsignarSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    try {
      const conversacion = await service.n8nAsignar(String(req.params.id), parsed.data.usuario_id);
      res.json({ ok: true, conversacion });
    } catch (e: any) {
      responderError(res, e, "No se pudo asignar");
    }
  });

  // ---- Webhook entrante de n8n (forma original, se mantiene por compatibilidad) ----
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
