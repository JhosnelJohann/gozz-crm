"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Download, AudioLines } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

// Limita reflows midiendo solo cuando cambia ≥ ~16ms
function smoothRaf(getValue: () => number, setValue: (v: number) => void, active: () => boolean) {
  let raf = 0;
  const loop = () => {
    if (!active()) return;
    setValue(getValue());
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

interface Props {
  url: string;
  filename?: string | null;
  mime?: string | null;
  isMe: boolean;
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// Generar bars estáticos por URL (hash simple)
function pseudoBars(url: string, count = 38): number[] {
  let seed = 0;
  for (let i = 0; i < url.length; i++) seed = (seed * 31 + url.charCodeAt(i)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };
  return Array.from({ length: count }, () => 0.25 + rnd() * 0.75);
}

export function AudioMessage({ url, filename, mime, isMe }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const bars = useMemo(() => pseudoBars(url), [url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = rate;
  }, [rate]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  // RAF loop para actualizar currentTime fluido a 60fps
  useEffect(() => {
    if (!playing) return;
    let active = true;
    const stop = smoothRaf(
      () => audioRef.current?.currentTime || 0,
      setCurrent,
      () => active && !!audioRef.current && !audioRef.current.paused
    );
    return () => { active = false; stop(); };
  }, [playing]);

  const onLoaded = () => {
    setLoaded(true);
    const a = audioRef.current;
    if (a && isFinite(a.duration)) setDuration(a.duration);
  };

  const seekTo = (clientX: number, target: HTMLDivElement) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setCurrent(a.currentTime);
  };

  const cycleRate = () => {
    const rates = [1, 1.5, 2, 0.75];
    const idx = rates.indexOf(rate);
    setRate(rates[(idx + 1) % rates.length]);
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className={cn(
      "min-w-[260px] max-w-[340px] flex items-center gap-3 py-1"
    )}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={onLoaded}
        onDurationChange={onLoaded}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime || 0)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />

      <button
        onClick={toggle}
        className={cn(
          "h-11 w-11 rounded-full flex items-center justify-center shrink-0 shadow-md transition active:scale-95 hover:scale-105",
          isMe
            ? "bg-white text-pink-600 ring-1 ring-white/40"
            : "bg-gradient-to-br from-brand-orange to-neon-magenta text-white"
        )}
        aria-label={playing ? "Pausar" : "Reproducir"}
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 ml-0.5 fill-current" />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          onClick={(e) => seekTo(e.clientX, e.currentTarget)}
          className="flex items-end gap-0.5 h-8 cursor-pointer group"
        >
          {bars.map((v, i) => {
            const isPlayed = (i / bars.length) * 100 < pct;
            const h = 4 + v * 24;
            return (
              <div
                key={i}
                style={{ height: `${h}px` }}
                className={cn(
                  "w-1 rounded-full group-hover:opacity-90",
                  isMe
                    ? (isPlayed
                        ? "bg-white"
                        : "bg-white/35")
                    : (isPlayed
                        ? "bg-brand-orange"
                        : "bg-neutral-300 dark:bg-white/20")
                )}
              />
            );
          })}
        </div>
        <div className={cn("mt-1 flex items-center gap-2 text-[10px] tabular-nums font-ui",
          isMe
            ? "text-white/85"
            : "text-neutral-600 dark:text-white/60"
        )}>
          <AudioLines className={cn("h-3 w-3", isMe ? "text-white/90" : "text-brand-orange")} />
          <span className="font-bold">{fmt(current)}</span>
          <span className="opacity-60">/</span>
          <span className="font-semibold">{loaded ? fmt(duration) : "--:--"}</span>
          <button
            onClick={cycleRate}
            className={cn(
              "ml-auto h-5 px-1.5 rounded-md text-[10px] font-bold transition",
              isMe
                ? "bg-white/20 hover:bg-white/35 text-white"
                : "bg-neutral-200 hover:bg-neutral-300 text-neutral-800 dark:bg-white/10 dark:hover:bg-white/15 dark:text-white/90"
            )}
            title="Velocidad"
          >
            {rate}x
          </button>
          <a
            href={url}
            download={filename || true}
            target="_blank"
            rel="noopener"
            className={cn(
              "h-5 w-5 rounded-md flex items-center justify-center transition",
              isMe
                ? "hover:bg-white/25 text-white"
                : "hover:bg-neutral-200 text-neutral-700 dark:hover:bg-white/10 dark:text-white/90"
            )}
            title="Descargar"
          >
            <Download className="h-3 w-3" strokeWidth={2.5} />
          </a>
        </div>
      </div>
    </div>
  );
}
