// ============================================================
// crm-email-worker — proceso pm2 SEPARADO que corre el loop de sincronización IMAP.
// ------------------------------------------------------------
// Por qué existe: email-sync conecta por IMAP a ~13 buzones. Cuando el mailserver
// flapea (EHOSTUNREACH intermitente / rate-limit a la ráfaga de conexiones), la
// tormenta de reconexiones llegaba a trabar el event loop. Si eso pasa DENTRO del
// proceso de la API, /api/health deja de responder y el watchdog reinicia crm-api
// → el CRM "se cae". Aislando el sync en su propio proceso, un flap del correo
// como mucho atrasa la importación de emails: la API (y el CRM) siguen intactos.
//
// No levanta Express ni socket.io: el sync solo escribe en la BD (los usuarios leen
// los correos vía las rutas HTTP que siguen en crm-api). Comparte la misma base de
// datos vía su propio pool (db.ts).
// ============================================================
import "dotenv/config";
import { startEmailSyncLoop } from "./email-routes.js";

// Que un error async del socket IMAP no mate el worker (igual que en la API).
process.on("uncaughtException", (err) => {
  console.error("[email-worker uncaughtException]", err instanceof Error ? err.stack || err.message : err);
});
process.on("unhandledRejection", (reason: any) => {
  console.error("[email-worker unhandledRejection]", reason instanceof Error ? reason.stack || reason.message : reason);
});

console.log("[email-worker] iniciando — email-sync aislado del proceso de la API");
startEmailSyncLoop();
