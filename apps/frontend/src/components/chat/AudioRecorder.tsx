"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Trash2, Send, Loader2, AudioLines, Pause, Play, ChevronDown, Check } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (file: File, durationMs: number) => Promise<void> | void;
  onCancel?: () => void;
  disabled?: boolean;
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad(m)}:${pad(s)}`;
}

function pickMimeType(): string {
  const cands = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of cands) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function ChatAudioRecorder({ onSend, onCancel, disabled }: Props) {
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "review" | "sending">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  // Selección de micrófono (recordada): por defecto el sistema elige, pero el usuario
  // puede fijar su mic conectado para que no agarre el de la webcam.
  const [micId, setMicId] = useState<string>("");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [showMicMenu, setShowMicMenu] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const mimeRef = useRef<string>("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    stopStream();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, []);

  // Cargar mic recordado + lista de micrófonos disponibles.
  useEffect(() => {
    try { const saved = localStorage.getItem("chat_mic_device"); if (saved) setMicId(saved); } catch {}
    refreshMics();
    const onChange = () => refreshMics();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  const refreshMics = async () => {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      setMics(devs.filter((d) => d.kind === "audioinput"));
    } catch {}
  };

  // Los labels de los dispositivos solo aparecen tras dar permiso de micrófono una vez.
  const ensureLabels = async () => {
    if (mics.length && mics.every((m) => m.label)) return;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch {}
    refreshMics();
  };

  const pickMic = (id: string) => {
    setMicId(id);
    try { localStorage.setItem("chat_mic_device", id); } catch {}
    setShowMicMenu(false);
  };

  const stopStream = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    analyserRef.current = null;
  };

  const startRecording = async () => {
    if (state !== "idle") return;
    setState("requesting");
    setLevels([]);
    setElapsed(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          // Si el usuario fijó un micrófono, usarlo (ideal = no falla si se desconecta).
          ...(micId ? { deviceId: { ideal: micId } } : {}),
        },
      });
      // Tras el primer permiso ya tenemos labels: refrescar la lista para el selector.
      refreshMics();
      streamRef.current = stream;
      const mime = pickMimeType();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setState("review");
        durationRef.current = Date.now() - startedAtRef.current;
        stopStream();
      };
      recorderRef.current = rec;

      // Analyser para waveform
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      startedAtRef.current = Date.now();
      rec.start(100);
      setState("recording");
      drawLoop();
    } catch (e: any) {
      stopStream();
      setState("idle");
      toast.error(e.name === "NotAllowedError" ? "Permiso de micrófono denegado" : "No se pudo iniciar la grabación");
    }
  };

  const drawLoop = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    // RMS → nivel 0..1
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const level = Math.min(1, rms * 2.4);
    setLevels((prev) => {
      const next = [...prev, level];
      if (next.length > 48) next.shift();
      return next;
    });
    setElapsed(Date.now() - startedAtRef.current);
    rafRef.current = requestAnimationFrame(drawLoop);
  };

  const stopRecording = () => {
    if (state !== "recording") return;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const discard = () => {
    if (state === "recording") {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewPlaying(false);
    setPreviewTime(0);
    setLevels([]);
    setElapsed(0);
    chunksRef.current = [];
    setState("idle");
    stopStream();
    onCancel?.();
  };

  const send = async () => {
    if (!previewUrl) return;
    setState("sending");
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      const ext = (blob.type || mimeRef.current || "audio/webm").includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `audio-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`, { type: blob.type || "audio/webm" });
      await onSend(file, durationRef.current || elapsed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setLevels([]);
      setElapsed(0);
      setState("idle");
    } catch (e: any) {
      toast.error(e.message || "No se pudo enviar");
      setState("review");
    }
  };

  const togglePreview = () => {
    const a = previewAudioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPreviewPlaying(true); }
    else { a.pause(); setPreviewPlaying(false); }
  };

  if (state === "idle") {
    return (
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          title="Grabar audio"
          className="h-10 w-10 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center text-neutral-500 hover:text-brand-orange transition disabled:opacity-40"
        >
          <Mic className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => { const next = !showMicMenu; setShowMicMenu(next); if (next) ensureLabels(); }}
          disabled={disabled}
          title="Elegir micrófono"
          className="h-5 w-4 -ml-1.5 flex items-center justify-center text-neutral-400 hover:text-brand-orange transition disabled:opacity-40"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {showMicMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMicMenu(false)} />
            <div className="absolute bottom-12 right-0 z-50 w-64 max-h-72 overflow-auto rounded-xl bg-white dark:bg-[#17171D] border border-neutral-200 dark:border-white/10 shadow-xl py-1.5">
              <div className="px-3 py-1.5 text-[10px] font-ui uppercase tracking-wider text-neutral-400">Micrófono</div>
              <button
                type="button"
                onClick={() => pickMic("")}
                className={cn("w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-white/5", !micId && "text-brand-orange font-semibold")}
              >
                <span className="flex-1 truncate">Predeterminado del sistema</span>
                {!micId && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
              {mics.map((m) => (
                <button
                  key={m.deviceId}
                  type="button"
                  onClick={() => pickMic(m.deviceId)}
                  className={cn("w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-white/5", micId === m.deviceId && "text-brand-orange font-semibold")}
                >
                  <span className="flex-1 truncate">{m.label || "Micrófono"}</span>
                  {micId === m.deviceId && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
              {mics.length === 0 && <div className="px-3 py-2 text-[12px] text-neutral-400">No se detectaron micrófonos</div>}
            </div>
          </>
        )}
      </div>
    );
  }

  // Overlay recording / review
  return (
    <AnimatePresence>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="absolute bottom-[72px] left-3 right-3 z-30"
      >
        <motion.div
          layout
          className={cn(
            "rounded-2xl border shadow-[0_10px_40px_rgba(15,23,42,0.18)] px-4 py-3 flex items-center gap-3 backdrop-blur-xl",
            state === "recording"
              ? "bg-gradient-to-br from-[#1E0B18] via-[#2A0F20] to-[#160818] border-red-500/30 text-white"
              : "bg-white dark:bg-[#17171D] border-slate-200 dark:border-white/10"
          )}
        >
          {state === "requesting" && (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-brand-orange" />
              <span className="text-sm text-slate-600 dark:text-white/80">Esperando permiso del micrófono…</span>
            </>
          )}

          {state === "recording" && (
            <>
              <div className="relative h-10 w-10 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-50" />
                <Mic className="h-5 w-5 text-white relative" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-ui uppercase tracking-wider text-red-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                  Grabando
                </div>
                <div className="flex items-end gap-0.5 h-7 mt-1.5">
                  {Array.from({ length: 48 }).map((_, i) => {
                    const v = levels[i] ?? 0;
                    const h = 3 + v * 26;
                    return (
                      <div
                        key={i}
                        className="w-1 rounded-full bg-gradient-to-t from-brand-orange via-red-400 to-pink-400 transition-[height] duration-75"
                        style={{ height: `${h}px`, opacity: levels[i] === undefined ? 0.25 : 0.92 }}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="text-[13px] font-display font-black tabular-nums text-white/95">{formatDuration(elapsed)}</div>
              <button type="button" onClick={discard} className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition" title="Descartar">
                <Trash2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={stopRecording} className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-red-500 text-white flex items-center justify-center shadow-lg hover:scale-[1.04] active:scale-95 transition" title="Detener">
                <Square className="h-4 w-4 fill-current" />
              </button>
            </>
          )}

          {(state === "review" || state === "sending") && previewUrl && (
            <>
              <audio
                ref={previewAudioRef}
                src={previewUrl}
                onEnded={() => { setPreviewPlaying(false); setPreviewTime(0); }}
                onTimeUpdate={(e) => setPreviewTime((e.currentTarget.currentTime || 0) * 1000)}
                preload="metadata"
              />
              <button
                type="button"
                onClick={togglePreview}
                className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white flex items-center justify-center shadow shrink-0"
                title={previewPlaying ? "Pausar" : "Reproducir"}
              >
                {previewPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 ml-0.5 fill-current" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-ui uppercase tracking-wider text-slate-500 dark:text-white/60 mb-1">
                  <AudioLines className="h-3.5 w-3.5 text-brand-orange" strokeWidth={2} />
                  Audio listo
                  <span className="ml-auto tabular-nums">{formatDuration(previewTime)} / {formatDuration(durationRef.current || elapsed)}</span>
                </div>
                <div className="flex items-end gap-0.5 h-7">
                  {levels.length > 0 ? levels.map((v, i) => {
                    const h = 3 + v * 24;
                    const playedPct = (previewTime / (durationRef.current || elapsed || 1)) * levels.length;
                    const isPlayed = i < playedPct;
                    return (
                      <div key={i} className={cn("w-1 rounded-full transition-colors", isPlayed ? "bg-brand-orange" : "bg-slate-300 dark:bg-white/20")}
                        style={{ height: `${h}px` }} />
                    );
                  }) : (
                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-white/10 relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-orange to-neon-magenta rounded-full"
                        style={{ width: `${((previewTime / (durationRef.current || elapsed || 1)) * 100).toFixed(1)}%` }} />
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={discard} className="h-10 w-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-white/70 flex items-center justify-center transition" title="Descartar">
                <Trash2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={send} disabled={state === "sending"}
                className="h-10 px-4 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-lg flex items-center gap-1.5 hover:scale-[1.03] active:scale-95 transition disabled:opacity-60">
                {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" strokeWidth={2.5} />}
                Enviar
              </button>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
