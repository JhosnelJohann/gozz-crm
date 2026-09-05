import type { Express, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "./shared/auth-middleware.js";
import { query } from "./shared/db.js";
import { placeUploadedFile } from "./lib/storage.js";
import { deleteUploadsIfUnreferenced } from "./lib/uploads-cleanup.js";

const AI_URL = process.env.AI_URL || "http://127.0.0.1:8100";
const DOCS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";

const upload = multer({
  dest: "/tmp/crm-ai-uploads/",
  limits: { fileSize: 100 * 1024 * 1024 }
});

fs.mkdirSync("/tmp/crm-ai-uploads/", { recursive: true });
fs.mkdirSync(DOCS_DIR, { recursive: true });

async function forwardMultipart(url: string, filePath: string, fileName: string, mimeType: string, extraFields: Record<string, string> = {}) {
  const fd = new FormData();
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
  fd.append("file", blob, fileName);
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
  const r = await fetch(url, { method: "POST", body: fd });
  const txt = await r.text();
  let data: any;
  try { data = JSON.parse(txt); } catch { data = { error: txt }; }
  return { status: r.status, data };
}

export function registerAIProxy(app: Express) {
  // Health of AI service
  app.get("/api/ai/health", requireAuth, async (_req, res) => {
    try {
      const r = await fetch(`${AI_URL}/health`);
      const data: any = await r.json();
      res.json(data);
    } catch (e: any) {
      res.status(503).json({ ok: false, error: "AI service unreachable", detail: e.message });
    }
  });

  // Analyze document (PDF upload) — preserva archivo y apendea historial
  app.post("/api/ai/analyze-document", requireAuth, upload.single("file"), async (req, res) => {
    const f = (req as any).file;
    if (!f) { res.status(400).json({ error: "No file" }); return; }
    try {
      const { status, data } = await forwardMultipart(
        `${AI_URL}/analyze-document`,
        f.path,
        f.originalname,
        f.mimetype,
        req.body.tipo_tramite ? { tipo_tramite: req.body.tipo_tramite } : {}
      );

      // Persist file for future access (only if análisis OK)
      let stored: { url: string; filename: string; mime: string; size: number } | null = null;
      if (status === 200 && data.ok && req.body.oportunidad_id) {
        const ext = path.extname(f.originalname || "") || "";
        const base = path.basename(f.originalname || "documento", ext).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
        const storedName = `${Date.now()}_${base}${ext}`;
        try {
          const url = placeUploadedFile(f.path, "oportunidad_ia", { opId: req.body.oportunidad_id }, storedName);
          stored = { url, filename: f.originalname, mime: f.mimetype, size: f.size };
        } catch (e) {
          // if move fails, just skip persistence
          stored = null;
        }

        const entry = {
          id: randomUUID(),
          analyzed_at: new Date().toISOString(),
          file: stored,
          analysis: data.analysis
        };
        await query(
          `UPDATE gozz.oportunidades
             SET documentos = COALESCE(documentos, '{}'::jsonb)
                              || jsonb_build_object(
                                   'ultimo_analisis', $1::jsonb,
                                   'ultimo_analisis_at', NOW()::text,
                                   'historial_analisis',
                                     COALESCE(documentos->'historial_analisis', '[]'::jsonb) || $2::jsonb
                                 )
           WHERE id = $3`,
          [JSON.stringify(data.analysis), JSON.stringify([entry]), req.body.oportunidad_id]
        );
        (data as any).entry = entry;
      }

      fs.unlink(f.path, () => {});
      res.status(status).json(data);
    } catch (e: any) {
      if (f?.path) fs.unlink(f.path, () => {});
      res.status(500).json({ error: e.message });
    }
  });

  // Eliminar entry del historial
  app.delete("/api/ai/analyze-document/:opId/:entryId", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u?.nivel !== "super_admin" && u?.nivel !== "admin") {
      res.status(403).json({ error: "Solo administradores pueden eliminar documentos" });
      return;
    }
    const rows = await query<any>(
      "SELECT documentos FROM gozz.oportunidades WHERE id = $1",
      [req.params.opId]
    );
    if (!rows[0]) { res.status(404).json({ error: "Oportunidad no encontrada" }); return; }
    const hist: any[] = Array.isArray(rows[0].documentos?.historial_analisis) ? rows[0].documentos.historial_analisis : [];
    const target = hist.find((h) => h.id === req.params.entryId);
    const filtered = hist.filter((h) => h.id !== req.params.entryId);
    await query(
      `UPDATE gozz.oportunidades
         SET documentos = COALESCE(documentos, '{}'::jsonb) || jsonb_build_object('historial_analisis', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(filtered), req.params.opId]
    );
    res.json({ ok: true, historial: filtered });
    // Borrar el archivo del entry si ya nadie lo referencia (tras actualizar la BD).
    if (target?.file?.url) deleteUploadsIfUnreferenced([target.file.url], { origen: "cascade_ia", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup ai-entry]", e?.message));
  });

  // Voice-to-task: upload audio -> transcribe -> extract-task
  app.post("/api/ai/voice-to-task", requireAuth, upload.single("file"), async (req, res) => {
    const u = (req as any).user;
    const f = (req as any).file;
    if (!f) { res.status(400).json({ error: "No file" }); return; }
    try {
      // 1. Transcribe
      const { status: st1, data: d1 } = await forwardMultipart(
        `${AI_URL}/transcribe`,
        f.path,
        f.originalname || "audio.webm",
        f.mimetype || "audio/webm"
      );
      fs.unlink(f.path, () => {});
      if (st1 !== 200 || !d1.ok) {
        res.status(st1).json({ error: "transcribe failed", detail: d1 });
        return;
      }
      const texto = d1.text as string;

      // 2. Extract task
      const r2 = await fetch(`${AI_URL}/extract-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripcion: texto })
      });
      const d2: any = await r2.json();
      if (!r2.ok) { res.status(r2.status).json({ error: "extract failed", detail: d2 }); return; }

      res.json({
        ok: true,
        transcripcion: texto,
        tarea: d2.tarea
      });
    } catch (e: any) {
      if (f?.path) fs.unlink(f.path, () => {});
      res.status(500).json({ error: e.message });
    }
  });

  // Confirm voice task -> create tarea (con asignación, etiquetas, urgente, oportunidad)
  app.post("/api/ai/voice-to-task/confirm", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const {
      titulo,
      descripcion,
      prioridad,
      fecha_limite,
      transcripcion,
      responsable_id,
      oportunidad_id,
      contacto_id,
      urgente,
      etiquetas
    } = req.body;
    if (!titulo) { res.status(400).json({ error: "Titulo requerido" }); return; }
    const respId = responsable_id || u.sub;
    const prio = prioridad || "normal";
    const isUrgente = !!urgente || prio === "urgente";
    const tags = Array.isArray(etiquetas) ? etiquetas : [];
    const rows = await query<any>(
      `INSERT INTO gozz.tareas (
         titulo, descripcion, propietario_id, responsable_id,
         estado, prioridad, urgente, fecha_limite,
         oportunidad_id, contacto_id, etiquetas,
         creada_por_ia, transcripcion_origen
       )
       VALUES ($1, $2, $3, $4,
               'pendiente', $5, $6, $7,
               $8, $9, $10::jsonb,
               true, $11)
       RETURNING *`,
      [titulo, descripcion ?? null, u.sub, respId,
       prio, isUrgente, fecha_limite ?? null,
       oportunidad_id ?? null, contacto_id ?? null, JSON.stringify(tags),
       transcripcion ?? null]
    );
    const tarea = rows[0];
    // Notificación al responsable si no es el creador
    if (respId !== u.sub) {
      try {
        await query(
          `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
           VALUES ($1, 'tarea_asignada', $2, $3, $4, $5, $6::jsonb)`,
          [
            respId,
            "Nueva tarea asignada (Voz)",
            tarea.titulo,
            isUrgente ? "critica" : (prio === "alta" ? "alta" : "normal"),
            `/tareas?id=${tarea.id}`,
            JSON.stringify({ tarea_id: tarea.id, origen: "voice-to-task" })
          ]
        );
      } catch (e) { /* best effort */ }
    }
    res.json({ tarea });
  });

  // Chat with Claude (context-aware assistant)
  app.post("/api/ai/chat", requireAuth, async (req, res) => {
    const { message, context } = req.body;
    if (!message) { res.status(400).json({ error: "Message requerido" }); return; }
    try {
      const r = await fetch(`${AI_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, context })
      });
      const data: any = await r.json();
      res.status(r.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Summarize videollamada by ID (uses stored transcripcion_txt)
  app.post("/api/ai/summarize-videocall/:id", requireAuth, async (req, res) => {
    const rows = await query<any>(
      "SELECT id, nombre_sala, transcripcion_txt FROM gozz.videollamadas WHERE id = $1",
      [req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "No encontrada" }); return; }
    const vc = rows[0];
    if (!vc.transcripcion_txt) { res.status(400).json({ error: "Sin transcripción" }); return; }
    try {
      const r = await fetch(`${AI_URL}/summarize-videocall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripcion: vc.transcripcion_txt, titulo_reunion: vc.nombre_sala })
      });
      const data: any = await r.json();
      if (r.ok && data.ok) {
        await query(
          "UPDATE gozz.videollamadas SET resumen_ia = $1::jsonb, tono_reunion = $2, tareas_detectadas = $3::jsonb WHERE id = $4",
          [JSON.stringify(data.resumen), data.resumen.tono_reunion, JSON.stringify(data.resumen.tareas_detectadas || []), vc.id]
        );
      }
      res.status(r.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
