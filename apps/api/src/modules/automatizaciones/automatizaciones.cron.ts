// Mismo patrón que el "break monitor" de clock-routes.ts: sondeo cada 60s de lo que ya venció,
// en vez de programar un setTimeout por recordatorio (más simple, y sobrevive un reinicio del
// proceso sin perder recordatorios — lo que ya venció mientras estaba caído se procesa al volver).
import * as service from "./automatizaciones.service.js";

let _started = false;

export function startRecordatoriosCron(): void {
  if (_started) return;
  _started = true;
  setInterval(() => {
    service.procesarRecordatoriosPendientes().catch((e: any) => console.error("[automatizaciones-cron]", e?.message || e));
  }, 60_000);
  console.log("[automatizaciones] cron de recordatorios iniciado (cada 60s)");
}
