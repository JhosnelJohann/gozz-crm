import type { Express, Request, Response } from "express";
import type { Multer } from "multer";
import fs from "fs";
import path from "path";
import { requireAuth } from "../../shared/auth-middleware.js";
import { UPLOADS_DIR } from "../../shared/env.js";
import { placeUploadedFile } from "../../lib/storage.js";
import * as service from "./whatsapp.service.js";
import * as repo from "./whatsapp.repository.js";
import {
  CrearConexionSchema,
  EnviarMensajeSchema,
  CrearTagSchema,
  ActualizarEtapaSchema,
  AsignarConversacionSchema,
  VincularContactoSchema,
} from "./whatsapp.schemas.js";

async function requireAccesoConexion(req: Request, res: Response, conexionId: string): Promise<boolean> {
  const u = (req as any).user;
  const ok = await service.verificarAcceso(conexionId, u.sub, u.nivel);
  if (!ok) { res.status(403).json({ error: "No tienes acceso a esta conexión de WhatsApp" }); return false; }
  return true;
}

/** Resuelve la conversación y valida acceso a su conexión. Responde el error y retorna null si falla. */
async function resolverConversacionConAcceso(req: Request, res: Response, conversacionId: string) {
  const conversacion = await repo.getConversacion(conversacionId);
  if (!conversacion) { res.status(404).json({ error: "Conversación no encontrada" }); return null; }
  const ok = await requireAccesoConexion(req, res, conversacion.conexion_id);
  if (!ok) return null;
  return conversacion;
}

export function registerWhatsAppRoutes(app: Express, upload: Multer) {
  app.post("/api/whatsapp/upload", requireAuth, upload.single("file"), async (req, res) => {
    const f = (req as any).file;
    if (!f) { res.status(400).json({ error: "No file" }); return; }
    res.json({ url: `/uploads/${f.filename}`, filename: f.originalname, mimetype: f.mimetype, size: f.size });
  });

  // ---- Conexiones ----
  app.get("/api/whatsapp/conexiones", requireAuth, async (req, res) => {
    const u = (req as any).user;
    res.json(await service.listarConexiones(u.sub, u.nivel));
  });

  app.post("/api/whatsapp/conexiones", requireAuth, async (req, res) => {
    const parsed = CrearConexionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const u = (req as any).user;
    const conexion = await service.crearConexion(parsed.data.nombre, u.sub);
    res.json({ conexion });
  });

  app.post("/api/whatsapp/conexiones/:id/iniciar", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await requireAccesoConexion(req, res, id))) return;
    await service.iniciarConexion(id);
    res.json({ ok: true });
  });

  app.delete("/api/whatsapp/conexiones/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await requireAccesoConexion(req, res, id))) return;
    await service.desconectarConexion(id);
    res.json({ ok: true });
  });

  app.get("/api/whatsapp/conexiones/:id/conversaciones", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await requireAccesoConexion(req, res, id))) return;
    const q = req.query as Record<string, string>;
    const conversaciones = await service.listarConversaciones(id, {
      etapaId: q.etapa || undefined,
      tagId: q.tag || undefined,
      archivado: q.archivado === "1" ? true : q.archivado === "0" ? false : undefined,
      q: q.q || undefined,
    });
    res.json({ conversaciones });
  });

  // ---- Etapas ----
  app.get("/api/whatsapp/etapas", requireAuth, async (_req, res) => {
    res.json({ etapas: await service.listarEtapas() });
  });

  // ---- Tags ----
  app.get("/api/whatsapp/tags", requireAuth, async (_req, res) => {
    res.json({ tags: await service.listarTags() });
  });

  app.post("/api/whatsapp/tags", requireAuth, async (req, res) => {
    const parsed = CrearTagSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const tag = await service.crearTag(parsed.data.nombre, parsed.data.color);
    res.json({ tag });
  });

  app.delete("/api/whatsapp/tags/:id", requireAuth, async (req, res) => {
    await service.eliminarTag(String(req.params.id));
    res.json({ ok: true });
  });

  // "Contactar por WhatsApp" desde la ficha del contacto — consigue-o-crea la conversación y la
  // deja vinculada, para poder escribirle de una sin pasar antes por "Vincular".
  app.post("/api/whatsapp/conversaciones/abrir", requireAuth, async (req, res) => {
    const conexionId = String(req.body?.conexion_id || "");
    const contactoId = String(req.body?.contacto_id || "");
    if (!conexionId || !contactoId) { res.status(400).json({ error: "conexion_id y contacto_id son requeridos" }); return; }
    if (!(await requireAccesoConexion(req, res, conexionId))) return;
    try {
      const { conversacionId } = await service.abrirConversacionConContacto(contactoId, conexionId);
      res.json({ conversacion_id: conversacionId });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo abrir la conversación" });
    }
  });

  // Alta rápida de contacto desde "Vincular o crear contacto" en el perfil de una conversación —
  // email OPCIONAL a propósito, solo aquí (ver whatsapp.service.ts crearContactoDesdeWhatsApp).
  // No usa /api/contactos, que sigue exigiendo email para cualquier otro que lo llame.
  app.post("/api/whatsapp/contactos", requireAuth, async (req, res) => {
    const nombre = String(req.body?.nombre_completo || "").trim();
    const telefono = String(req.body?.telefono || "").trim();
    const email = req.body?.email ? String(req.body.email).trim() : null;
    if (nombre.length < 2) { res.status(400).json({ error: "Ponle un nombre al contacto" }); return; }
    if (!telefono) { res.status(400).json({ error: "El teléfono es requerido" }); return; }
    const contacto = await service.crearContactoDesdeWhatsApp(nombre, telefono, email);
    res.json({ contacto });
  });

  // ---- Conversaciones ----
  app.get("/api/whatsapp/conversaciones/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    const conversacion = await resolverConversacionConAcceso(req, res, id);
    if (!conversacion) return;
    res.json({ conversacion: await service.obtenerConversacion(id) });
  });

  app.get("/api/whatsapp/conversaciones/:id/mensajes", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 50;
    const before = req.query.before ? String(req.query.before) : undefined;
    res.json({ mensajes: await service.listarMensajes(id, limit, before) });
  });

  app.post("/api/whatsapp/conversaciones/:id/mensajes", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const parsed = EnviarMensajeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const u = (req as any).user;
    // Si el archivo viene PLANO (recién subido por /api/whatsapp/upload, que no conoce la
    // conversación), moverlo a whatsapp/mensajes/<conversacionId>/ — mismo patrón que /api/chat.
    let d = parsed.data;
    if (d.archivoUrl && /^\/uploads\/[^/]+$/.test(d.archivoUrl)) {
      const fname = d.archivoUrl.replace(/^\/uploads\//, "");
      const flat = path.join(UPLOADS_DIR, fname);
      if (fs.existsSync(flat)) {
        d = { ...d, archivoUrl: placeUploadedFile(flat, "whatsapp_mensaje", { conversacionId: id }, fname) };
      }
    }
    const mensaje = await service.enviarMensaje(id, u.sub, d);
    res.json({ mensaje });
  });

  app.post("/api/whatsapp/conversaciones/:id/leer", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const u = (req as any).user;
    await service.marcarLeida(id, u.sub);
    res.json({ ok: true });
  });

  app.patch("/api/whatsapp/conversaciones/:id/etapa", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const parsed = ActualizarEtapaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    res.json({ conversacion: await service.cambiarEtapa(id, parsed.data.etapa_id) });
  });

  app.patch("/api/whatsapp/conversaciones/:id/asignar", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const parsed = AsignarConversacionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    res.json({ conversacion: await service.asignar(id, parsed.data.asignado_a) });
  });

  app.patch("/api/whatsapp/conversaciones/:id/archivar", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    await service.archivar(id, req.body?.archivado !== false);
    res.json({ ok: true });
  });

  app.post("/api/whatsapp/conversaciones/:id/vincular-contacto", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const parsed = VincularContactoSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    res.json({ conversacion: await service.vincularContactoManual(id, parsed.data.contacto_id) });
  });

  app.post("/api/whatsapp/conversaciones/:id/tags", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const tagId = String(req.body?.tag_id || "");
    if (!tagId) { res.status(400).json({ error: "tag_id requerido" }); return; }
    res.json({ tags: await service.agregarTag(id, tagId) });
  });

  app.delete("/api/whatsapp/conversaciones/:id/tags/:tagId", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    res.json({ tags: await service.quitarTag(id, String(req.params.tagId)) });
  });

  app.post("/api/whatsapp/conversaciones/:id/convertir", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!(await resolverConversacionConAcceso(req, res, id))) return;
    const u = (req as any).user;
    const nombreCaso = String(req.body?.nombre_caso || "").trim();
    if (!nombreCaso) { res.status(400).json({ error: "nombre_caso requerido" }); return; }
    try {
      const oportunidad = await service.convertirAOportunidad(id, u.sub, {
        nombreCaso,
        tipoTramiteId: req.body?.tipo_tramite_id || null,
        valorTotal: req.body?.valor_total,
      });
      res.json({ oportunidad });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo convertir la conversación" });
    }
  });
}
