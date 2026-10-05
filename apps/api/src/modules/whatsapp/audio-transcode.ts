// Conversión de notas de voz al único formato que WhatsApp reproduce como "nota de voz" (PTT):
// OGG contenedor + códec Opus, mono, 48 kHz.
//
// Por qué hace falta: el grabador del navegador (components/chat/AudioRecorder.tsx) produce lo que
// el navegador soporte — `audio/webm;codecs=opus` en Chrome/Edge, `audio/mp4` en Safari. WhatsApp no
// reproduce ninguno de los dos como nota de voz: mandar el webm tal cual era la causa real de
// "no deja enviar audios" (al cliente le llegaba un adjunto roto, no una nota de voz).
//
// `ffmpeg-static` trae el binario dentro de node_modules — no hace falta instalar ffmpeg en el VPS.
// Todo va por stdin/stdout (sin archivos temporales) y es asíncrono: este código corre dentro del
// worker que sostiene TODAS las conexiones de WhatsApp, no puede bloquear el event loop.
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

const TIMEOUT_MS = 60_000;

export interface AudioTranscodificado {
  buffer: Buffer;
  /** Duración en segundos (redondeada hacia arriba, mínimo 1) — WhatsApp la muestra en la burbuja. */
  segundos: number;
}

/** Último `time=HH:MM:SS.xx` del progreso de ffmpeg = duración real del audio de salida. Se usa el
 * progreso y no el `Duration:` de la entrada porque los webm de MediaRecorder no traen duración en
 * la cabecera (sale `N/A`). */
export function duracionDesdeLogFfmpeg(stderr: string): number | null {
  const matches = [...stderr.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const s = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Number.isFinite(s) ? s : null;
}

export function aOggOpus(entrada: Buffer): Promise<AudioTranscodificado> {
  if (!ffmpegPath) return Promise.reject(new Error("ffmpeg no está disponible en este sistema"));
  if (!entrada.length) return Promise.reject(new Error("El audio está vacío"));

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, [
      "-hide_banner", "-nostdin", "-loglevel", "info",
      "-i", "pipe:0",
      "-vn", "-map_metadata", "-1",
      "-ac", "1", "-ar", "48000",
      "-c:a", "libopus", "-b:a", "32k", "-application", "voip",
      "-f", "ogg", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

    const out: Buffer[] = [];
    let stderr = "";
    let terminado = false;
    const terminar = (err: Error | null, val?: AudioTranscodificado) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(val!);
    };
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      terminar(new Error("La conversión del audio tardó demasiado"));
    }, TIMEOUT_MS);

    proc.stdout.on("data", (c: Buffer) => out.push(c));
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); if (stderr.length > 64_000) stderr = stderr.slice(-32_000); });
    proc.on("error", (e) => terminar(e));
    proc.on("close", (code) => {
      const buffer = Buffer.concat(out);
      if (code !== 0 || !buffer.length) {
        const motivo = stderr.trim().split(/\r?\n/).slice(-1)[0] || `código ${code}`;
        terminar(new Error(`No se pudo convertir el audio a nota de voz: ${motivo}`));
        return;
      }
      const dur = duracionDesdeLogFfmpeg(stderr);
      terminar(null, { buffer, segundos: Math.max(1, Math.ceil(dur ?? 1)) });
    });

    // EPIPE si ffmpeg muere antes de leer toda la entrada — el error real llega por "close".
    proc.stdin.on("error", () => {});
    proc.stdin.end(entrada);
  });
}
