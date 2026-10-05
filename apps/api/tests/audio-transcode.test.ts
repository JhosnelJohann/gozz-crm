// ============================================================================================
// NOTAS DE VOZ — `src/modules/whatsapp/audio-transcode.ts`
//
// Lo que se vigila: que un audio como el que graba el navegador (webm/opus en Chrome, m4a en
// Safari) salga convertido al ÚNICO formato que WhatsApp reproduce como nota de voz (OGG + Opus,
// mono, 48 kHz) y con su duración real. Mandar el webm tal cual era la causa de "no deja enviar
// audios". Usa el ffmpeg real de `ffmpeg-static` (el mismo que corre en producción).
// ============================================================================================
import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";

import { aOggOpus, duracionDesdeLogFfmpeg } from "../src/modules/whatsapp/audio-transcode.js";

/** Genera un audio de prueba (tono de 440 Hz) en el formato pedido, como lo haría un navegador. */
function audioDePrueba(formato: "webm" | "mp4", segundos: number): Buffer {
  const codec = formato === "webm" ? ["-c:a", "libopus"] : ["-c:a", "aac"];
  const extra = formato === "mp4" ? ["-movflags", "frag_keyframe+empty_moov"] : [];
  const r = spawnSync(ffmpegPath as unknown as string, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${segundos}`,
    "-ac", "2", ...codec, ...extra, "-f", formato, "pipe:1",
  ], { maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}

function sondear(buf: Buffer): string {
  const r = spawnSync(ffmpegPath as unknown as string, ["-hide_banner", "-i", "pipe:0", "-f", "null", "-"], { input: buf });
  return r.stderr.toString();
}

describe("Notas de voz — conversión a OGG/Opus", () => {
  it("un webm/opus de Chrome sale como OGG Opus mono 48 kHz con su duración", async () => {
    const { buffer, segundos } = await aOggOpus(audioDePrueba("webm", 3));
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(buffer.includes(Buffer.from("OpusHead"))).toBe(true);
    expect(sondear(buffer)).toMatch(/Audio: opus, 48000 Hz, mono/);
    expect(segundos).toBe(3);
  });

  it("un m4a/aac de Safari también se convierte", async () => {
    const { buffer, segundos } = await aOggOpus(audioDePrueba("mp4", 2));
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(segundos).toBeGreaterThanOrEqual(2);
    expect(segundos).toBeLessThanOrEqual(3);
  });

  it("rechaza con un error claro un archivo que no es audio", async () => {
    await expect(aOggOpus(Buffer.from("esto no es un audio"))).rejects.toThrow(/No se pudo convertir el audio/);
  });

  it("rechaza un audio vacío", async () => {
    await expect(aOggOpus(Buffer.alloc(0))).rejects.toThrow(/vacío/);
  });

  it("duracionDesdeLogFfmpeg toma el ÚLTIMO time= del progreso", () => {
    expect(duracionDesdeLogFfmpeg("size=1kB time=00:00:01.00 ...\rsize=2kB time=00:01:02.50 bitrate")).toBeCloseTo(62.5);
    expect(duracionDesdeLogFfmpeg("sin progreso")).toBeNull();
  });
});
