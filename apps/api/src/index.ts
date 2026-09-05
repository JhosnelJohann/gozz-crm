import "dotenv/config";
import { createHttpApp } from "./shared/http-server.js";
import { registerErrorHandler } from "./shared/error-handler.js";
import { initSocket, emitToUser } from "./shared/socket.js";
import { query, pool } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { PORT, COOKIE_SECURE } from "./shared/env.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerOportunidadesRoutes } from "./modules/oportunidades/oportunidades.routes.js";
import { registerStatsRoutes } from "./stats-routes.js";
import { registerCatalogosRoutes } from "./catalogos-routes.js";
import { registerNotificacionesRoutes } from "./notificaciones-routes.js";
import { registerChatRoutes } from "./chat-routes.js";
import { registerVideollamadasRoutes } from "./videollamadas-routes.js";
import { registerPushRoutes } from "./push-routes.js";
import { registerPhase6Routes } from "./phase6-routes.js";
import { registerAIProxy } from "./ai-proxy.js";
import { registerDetailRoutes } from "./detail-routes.js";
import { registerPipelineRoutes } from "./pipeline-routes.js";
import { registerEmailRoutes, startEmailSyncLoop } from "./email-routes.js";
import { registerDriveRoutes, startDriveCuarentenaGcLoop } from "./drive-routes.js";
import { registerClockRoutes, startBreakMonitor } from "./clock-routes.js";
import { registerRecognitionsRoutes, startRecognitionsCron } from "./recognitions-routes.js";
import { registerTareasRoutes } from "./tareas-routes.js";
import { registerInternalRoutes } from "./internal-routes.js";
import { registerAplicacionesRoutes } from "./aplicaciones-routes.js";
import { registerReportesRoutes } from "./reportes-routes.js";
import { registerContactosRoutes } from "./modules/contactos/contactos.routes.js";
import { registerUploadsRoutes } from "./uploads-routes.js";
import { registerConfiguracionRoutes } from "./configuracion-routes.js";
import { registerOportunidadesEtapaRoutes } from "./oportunidades-etapa-routes.js";
import { registerOportunidadesExportacionRoutes } from "./oportunidades-exportacion-routes.js";

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err instanceof Error ? err.stack || err.message : err);
});
process.on("unhandledRejection", (reason: any) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.stack || reason.message : reason);
});

const { app, httpServer, upload } = createHttpApp();

// ============================================================
// Health
// ============================================================
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gozz-api", socket: true, ts: new Date().toISOString() });
});

// ============================================================
// Health
// ============================================================
app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ ok: false, error: e?.message || "db" });
  }
});


registerAuthRoutes(app);



registerStatsRoutes(app);
registerCatalogosRoutes(app);
registerNotificacionesRoutes(app);
// ============================================================
// Contactos
// ============================================================
// Contactos router extraído en contactos-routes.ts — se monta abajo
registerContactosRoutes(app);

registerOportunidadesRoutes(app);



// ============================================================
// Tareas (router extraído)
// ============================================================
registerTareasRoutes(app);
registerPushRoutes(app);
registerInternalRoutes(app);
registerAplicacionesRoutes(app);

// ============================================================
// Reportes + pagos + notas + organigrama
// ============================================================
registerReportesRoutes(app);
registerUploadsRoutes(app);

startDriveCuarentenaGcLoop();  // GC de cuarentena vencida (Fase B2) — INERTE salvo DRIVE_GC_ENABLED=1

// ============================================================
// Configuración admin (departamentos, seguridad, prefs, webhooks)
// ============================================================
registerConfiguracionRoutes(app);

registerChatRoutes(app, upload);
registerVideollamadasRoutes(app);

// ============================================================
// Server start
// ============================================================
registerPhase6Routes(app);
registerAIProxy(app);
registerDetailRoutes(app);
registerPipelineRoutes(app);
registerEmailRoutes(app);
registerDriveRoutes(app);
registerClockRoutes(app);
registerRecognitionsRoutes(app);
registerOportunidadesEtapaRoutes(app);
registerOportunidadesExportacionRoutes(app);

registerErrorHandler(app);

// Puente tiempo real del correo: el worker (sin socket) hace NOTIFY 'email_nuevo' al importar
// correos; aquí (la API, que sí tiene socket.io) escuchamos con LISTEN en una conexión dedicada y
// reenviamos 'email:nuevo' a los usuarios con acceso al buzón para que la bandeja se refresque sola.
async function startEmailNotifyListener() {
  try {
    const client = await pool.connect();
    client.on("error", (err: any) => {
      console.error("[email-notify] client error, reconectando:", err?.message || err);
      try { client.release(); } catch {}
      setTimeout(() => { startEmailNotifyListener().catch(() => {}); }, 5000);
    });
    client.on("notification", async (msg: any) => {
      if (msg.channel !== "email_nuevo") return;
      let payload: any = {};
      try { payload = JSON.parse(msg.payload || "{}"); } catch { return; }
      const buzonId = payload.buzon_id;
      if (!buzonId) return;
      try {
        const users = await query<any>(
          `SELECT DISTINCT u.id FROM gozz.users u
           WHERE u.activo = true AND (
             u.id = (SELECT owner_user_id FROM gozz.buzones_email WHERE id = $1)
             OR u.id IN (SELECT user_id FROM gozz.buzon_acl WHERE buzon_id = $1 AND user_id IS NOT NULL)
             OR EXISTS (SELECT 1 FROM gozz.buzon_acl a
                        WHERE a.buzon_id = $1 AND a.posicion IS NOT NULL AND u.posiciones::jsonb ? a.posicion)
           )`,
          [buzonId]
        );
        for (const row of users) emitToUser(String(row.id), "email:nuevo", { buzon_id: buzonId, imported: payload.imported || 0 });
      } catch (e: any) {
        console.error("[email-notify] resolve users error:", e?.message || e);
      }
    });
    await client.query("LISTEN email_nuevo");
    console.log("[email-notify] LISTEN email_nuevo activo");
  } catch (e: any) {
    console.error("[email-notify] no se pudo iniciar, reintentando:", e?.message || e);
    setTimeout(() => { startEmailNotifyListener().catch(() => {}); }, 5000);
  }
}

initSocket(httpServer);
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[crm-api] listening on :${PORT} (cookie_secure=${COOKIE_SECURE}, socket.io enabled)`);
  if (process.env.EMAIL_SYNC_IN_API === "1") startEmailSyncLoop(); // email-sync corre en proceso worker separado (crm-email-worker); ver email-worker.ts
  startEmailNotifyListener().catch(() => {}); // puente NOTIFY→socket para correo en tiempo real
  startBreakMonitor();
  startRecognitionsCron();
});
