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
  app.use("/uploads", requireAuth, express.static(UPLOADS_DIR));

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
