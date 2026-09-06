import type { Express } from "express";
import crypto from "crypto";
import { customAlphabet } from "nanoid";
import { query } from "./shared/db.js";
import { hashPassword, requireAuth, verifyPassword } from "./shared/auth-middleware.js";
import multerPkg from "multer";
import pathModule from "path";
import fsModule from "fs";

const AVATAR_DIR = (process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads") + "/avatars";
try { fsModule.mkdirSync(AVATAR_DIR, { recursive: true }); } catch {}
const avatarStorage = multerPkg.diskStorage({
  destination: AVATAR_DIR,
  filename: (req, file, cb) => {
    const ext = pathModule.extname(file.originalname).toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    cb(null, `user-${req.params.id}${safeExt}`);
  }
});
const avatarUpload = multerPkg({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Solo imágenes permitidas"));
    cb(null, true);
  }
});


const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", 32);

function hashKey(plain: string) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

export function registerPhase6Routes(app: Express) {
  // ---------------- API Keys ----------------
  app.get("/api/admin/api-keys", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin") { res.status(403).json({ error: "Solo super_admin" }); return; }
    const rows = await query(
      `SELECT id, nombre, key_prefix, activo, ultimo_uso, total_requests, expira_at, created_at
       FROM gozz.api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [u.sub]
    );
    res.json({ keys: rows });
  });

  app.post("/api/admin/api-keys", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin") { res.status(403).json({ error: "Solo super_admin" }); return; }
    const { nombre } = req.body;
    if (!nombre) { res.status(400).json({ error: "Nombre requerido" }); return; }

    const rawKey = "tua_" + nanoid();
    const prefix = rawKey.slice(0, 12);
    const hash = hashKey(rawKey);

    const rows = await query<any>(
      `INSERT INTO gozz.api_keys (user_id, nombre, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, key_prefix, created_at`,
      [u.sub, nombre, prefix, hash]
    );
    // Plaintext key SOLO se muestra aquí una vez
    res.json({ key: rows[0], plaintext: rawKey });
  });

  app.delete("/api/admin/api-keys/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin") { res.status(403).json({ error: "Solo super_admin" }); return; }
    await query("DELETE FROM gozz.api_keys WHERE id = $1 AND user_id = $2", [req.params.id, u.sub]);
    res.json({ ok: true });
  });

  // ---------------- Users CRUD ----------------
  app.post("/api/admin/users", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin" && u.nivel !== "admin") { res.status(403).json({ error: "Sin permisos" }); return; }
    const { email, nombre, password, nivel_acceso, posiciones } = req.body;
    if (!email || !nombre || !password) { res.status(400).json({ error: "Campos requeridos" }); return; }
    if (nivel_acceso === "super_admin") { res.status(403).json({ error: "No se puede crear super_admin" }); return; }
    try {
      const hash = await hashPassword(password);
      const rows = await query<any>(
        `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, posiciones, activo)
         VALUES ($1, $2, $3, COALESCE($4, 'usuario'), $5::jsonb, true)
         RETURNING id, email, nombre, nivel_acceso, posiciones, created_at`,
        [email.toLowerCase(), hash, nombre, nivel_acceso, JSON.stringify(posiciones || [])]
      );
      res.json({ user: rows[0] });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/admin/users/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin" && u.nivel !== "admin") { res.status(403).json({ error: "Sin permisos" }); return; }
    const body = req.body || {};
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 2;
    const simpleCols = [
      "nombre", "activo", "telefono", "telefono_personal", "departamento",
      "fecha_ingreso", "cumpleanos", "genero", "bio", "zona_horaria", "foto_perfil_url"
    ];
    for (const col of simpleCols) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        values.push(body[col] === "" ? null : body[col]);
      }
    }
    if (body.nivel_acceso !== undefined && body.nivel_acceso !== "super_admin") {
      updates.push(`nivel_acceso = $${idx++}`);
      values.push(body.nivel_acceso);
    }
    if (body.posiciones !== undefined) {
      updates.push(`posiciones = $${idx++}::jsonb`);
      values.push(JSON.stringify(body.posiciones));
    }
    if (body.password) {
      const hash = await hashPassword(body.password);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }
    if (updates.length === 0) { res.json({ ok: true }); return; }
    updates.push(`updated_at = NOW()`);
    try {
      const rows = await query<any>(
        `UPDATE gozz.users SET ${updates.join(", ")} WHERE id = $1
         RETURNING id, email, nombre, nivel_acceso, activo, posiciones, telefono, telefono_personal,
                   departamento, fecha_ingreso, cumpleanos, genero, bio, zona_horaria, foto_perfil_url`,
        [req.params.id, ...values]
      );
      res.json({ user: rows[0] });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin") { res.status(403).json({ error: "Solo super_admin" }); return; }
    try {
      await query("DELETE FROM gozz.users WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  // ---------------- Self edit (current user) ----------------
  app.patch("/api/users/me", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const body = req.body || {};
    const whitelist = ["nombre", "telefono", "telefono_personal", "cumpleanos", "genero", "bio", "zona_horaria"];
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 2;
    for (const col of whitelist) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        values.push(body[col] === "" ? null : body[col]);
      }
    }
    if (updates.length === 0) { res.json({ ok: true }); return; }
    updates.push(`updated_at = NOW()`);
    try {
      const rows = await query<any>(
        `UPDATE gozz.users SET ${updates.join(", ")} WHERE id = $1
         RETURNING id, email, nombre, nivel_acceso, posiciones, foto_perfil_url, online, zona_horaria,
                   activo, ultimo_login, telefono, telefono_personal, departamento,
                   fecha_ingreso, cumpleanos, genero, bio`,
        [u.sub, ...values]
      );
      res.json({ user: rows[0] });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/users/me/password", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) { res.status(400).json({ error: "Contrasenas requeridas" }); return; }
    if (new_password.length < 8) { res.status(400).json({ error: "Nueva contrasena minimo 8 caracteres" }); return; }
    const rows = await query<any>("SELECT password_hash FROM gozz.users WHERE id = $1", [u.sub]);
    if (!rows[0]) { res.status(404).json({ error: "Usuario no existe" }); return; }
    const ok = await verifyPassword(current_password, rows[0].password_hash);
    if (!ok) { res.status(400).json({ error: "Contrasena actual incorrecta" }); return; }
    const hash = await hashPassword(new_password);
    await query("UPDATE gozz.users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [hash, u.sub]);
    res.json({ ok: true });
  });

  app.post("/api/users/me/foto", requireAuth, (req, res, next) => {
    // override filename to use req.user.sub
    (req as any).params.id = (req as any).user.sub;
    next();
  }, avatarUpload.single("foto"), async (req, res) => {
    const u = (req as any).user;
    const f: any = (req as any).file;
    if (!f) { res.status(400).json({ error: "Archivo requerido (campo: foto)" }); return; }
    const url = `/uploads/avatars/${f.filename}`;
    try {
      const rows = await query<any>(
        "UPDATE gozz.users SET foto_perfil_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, foto_perfil_url",
        [url, u.sub]
      );
      res.json({ foto_perfil_url: url, user: rows[0] });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---------------- User detail (readable by any authenticated user) ----------------
  app.get("/api/users/:id", requireAuth, async (req, res) => {
    const rows = await query<any>(
      `SELECT id, email, nombre, nivel_acceso, posiciones, foto_perfil_url, online, zona_horaria,
              activo, ultimo_login, created_at, telefono, telefono_personal, departamento,
              fecha_ingreso, cumpleanos, genero, bio
         FROM gozz.users WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "No encontrado" }); return; }
    res.json({ user: rows[0] });
  });

  // ---------------- Avatar upload ----------------
  app.post("/api/admin/users/:id/foto", requireAuth, (req, res, next) => {
    const u = (req as any).user;
    if (u.nivel !== "super_admin" && u.nivel !== "admin") { res.status(403).json({ error: "Sin permisos" }); return; }
    next();
  }, avatarUpload.single("foto"), async (req, res) => {
    const f: any = (req as any).file;
    if (!f) { res.status(400).json({ error: "Archivo requerido (campo: foto)" }); return; }
    const url = `/uploads/avatars/${f.filename}`;
    try {
      const rows = await query<any>(
        "UPDATE gozz.users SET foto_perfil_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, foto_perfil_url",
        [url, req.params.id]
      );
      if (!rows[0]) { res.status(404).json({ error: "Usuario no existe" }); return; }
      res.json({ foto_perfil_url: url, user: rows[0] });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

}
