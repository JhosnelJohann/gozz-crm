// ============================================================
// gozz-whatsapp-worker — proceso pm2 SEPARADO que sostiene las conexiones de WhatsApp (Baileys).
// ------------------------------------------------------------
// Por qué existe: mismo razonamiento que apps/api/src/email-worker.ts (léase su comentario) —
// una conexión externa de larga duración no debe compartir proceso con el que sirve
// /api/health. Un corte/reconexión de WhatsApp no puede tumbar gozz-api ni al resto del CRM.
//
// No levanta Express ni socket.io: solo escribe en la BD y notifica por Postgres NOTIFY
// ('whatsapp_evento'); gozz-api escucha ese canal (LISTEN, en index.ts) y reenvía por socket.io a
// los usuarios con acceso a la conexión — igual que el puente que ya existe para 'email_nuevo'.
// En sentido contrario, gozz-api notifica 'whatsapp_iniciar' / 'whatsapp_desconectar' /
// 'whatsapp_enviar'; este worker las escucha y actúa.
// ============================================================
import "dotenv/config";
import { pool } from "./shared/db.js";
import * as cm from "./modules/whatsapp/whatsapp-connection-manager.js";

process.on("uncaughtException", (err) => {
  console.error("[whatsapp-worker uncaughtException]", err instanceof Error ? err.stack || err.message : err);
});
process.on("unhandledRejection", (reason: any) => {
  console.error("[whatsapp-worker unhandledRejection]", reason instanceof Error ? reason.stack || reason.message : reason);
});

async function startListener() {
  try {
    const client = await pool.connect();
    client.on("error", (err: any) => {
      console.error("[whatsapp-worker] client error, reconectando:", err?.message || err);
      try { client.release(); } catch {}
      setTimeout(() => { startListener().catch(() => {}); }, 5000);
    });
    client.on("notification", async (msg: any) => {
      let payload: any = {};
      try { payload = JSON.parse(msg.payload || "{}"); } catch { return; }
      try {
        if (msg.channel === "whatsapp_iniciar") await cm.iniciarConexion(payload.conexion_id);
        else if (msg.channel === "whatsapp_desconectar") await cm.detenerConexion(payload.conexion_id);
        else if (msg.channel === "whatsapp_enviar") await cm.enviarMensajePendiente(payload.mensaje_id);
      } catch (e: any) {
        console.error(`[whatsapp-worker] error manejando ${msg.channel}:`, e?.message);
      }
    });
    await client.query("LISTEN whatsapp_iniciar");
    await client.query("LISTEN whatsapp_desconectar");
    await client.query("LISTEN whatsapp_enviar");
    console.log("[whatsapp-worker] LISTEN activo (whatsapp_iniciar / whatsapp_desconectar / whatsapp_enviar)");
  } catch (e: any) {
    console.error("[whatsapp-worker] no se pudo iniciar el listener, reintentando:", e?.message || e);
    setTimeout(() => { startListener().catch(() => {}); }, 5000);
  }
}

console.log("[whatsapp-worker] iniciando — WhatsApp aislado del proceso de la API");
cm.reconectarActivas().catch((e) => console.error("[whatsapp-worker] reconectarActivas:", e?.message));
cm.reenviarPendientesAlArrancar().catch((e) => console.error("[whatsapp-worker] reenviarPendientesAlArrancar:", e?.message));
startListener();
