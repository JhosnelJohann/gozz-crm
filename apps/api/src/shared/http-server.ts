import express, { type Express } from "express";
import "express-async-errors"; // reenvia rechazos async de las rutas al error handler global (Express 4 no lo hace solo)
import { createServer, type Server as HttpServer } from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth } from "./auth-middleware.js";
import { UPLOADS_DIR } from "./env.js";
import { readUploadedFileBytes } from "../lib/storage.js";

// Tabla chica local a esta ruta — a propósito NO se reutiliza la de drive-routes.ts (Drive queda
// fuera de esta migración, ver plan). Solo para el header Content-Type de la respuesta; R2 no
// guarda un content-type confiable propio (nunca se lee directo de R2, siempre por este proxy).
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", bmp: "image/bmp",
  pdf: "application/pdf",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain",
  zip: "application/zip",
};
function guessContentType(rel: string): string {
  const ext = (rel.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  return EXT_MIME[ext] || "application/octet-stream";
}

export interface HttpApp {
  app: Express;
  httpServer: HttpServer;
  upload: multer.Multer;
}

/**
 * Bootstrap del servidor Express: middlewares globales, carpeta de uploads y el multer
 * compartido por las rutas que reciben archivos. No monta ninguna ruta de negocio — eso lo hace
 * cada `register*Routes(app)` por separado, después de llamar a esta factory.
 */
export function createHttpApp(): HttpApp {
  const app = express();
  const httpServer = createServer(app);

  app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "20mb" }));
  app.use(cookieParser());

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  // 🔒 /uploads EXIGE sesión. Antes se servía como estático abierto: cualquiera que conociera
  // (o filtrara) una URL podía descargar comprobantes, firmas y documentos de clientes sin
  // autenticarse — verificado en prod el 2026-07-20 (HTTP 200 desde la IP pública, sin token).
  // Funciona con <img src="/uploads/..."> porque requireAuth lee la cookie `access_token`, que el
  // navegador envía sola en peticiones al mismo origen. cookieParser() ya corrió arriba.
  // Ruta dinámica (ya no express.static): lee de R2 primero cuando está habilitado, disco local
  // como respaldo — mismo patrón "proxy autenticado, nunca URL firmada pública" que Drive.
  app.get("/uploads/*", requireAuth, async (req, res) => {
    const rel = decodeURIComponent(req.params[0] || "");
    if (!rel || rel.includes("..") || rel.includes("\0")) { res.status(400).json({ error: "ruta_invalida" }); return; }
    try {
      const buf = await readUploadedFileBytes("/uploads/" + rel);
      res.setHeader("Content-Type", guessContentType(rel));
      res.setHeader("Content-Length", String(buf.length));
      // Fotos de perfil de WhatsApp: el nombre lleva el hash del contenido (una foto nueva = URL
      // nueva), así que el navegador puede guardarlas una semana sin volver a pedirlas.
      res.setHeader("Cache-Control", rel.startsWith("whatsapp/avatares/") ? "private, max-age=604800, immutable" : "private, max-age=300");
      res.end(buf);
    } catch {
      res.status(404).json({ error: "not_found" });
    }
  });

  const uploadStorage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
      cb(null, `${Date.now()}_${base}${ext}`);
    }
  });
  const upload = multer({ storage: uploadStorage, limits: { fileSize: 100 * 1024 * 1024 } });

  return { app, httpServer, upload };
}
