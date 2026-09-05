"use client";
import { useEffect, useRef } from "react";
import { File, Image as ImageIcon, Video } from "@/lib/bootstrap-icons";

export type AttachKind = "file" | "image" | "video";

interface Props {
  onPick: (kind: AttachKind) => void;
  onClose: () => void;
}

const OPTIONS: { kind: AttachKind; label: string; Icon: any; tint: string }[] = [
  { kind: "image", label: "Imagen", Icon: ImageIcon, tint: "from-brand-orange to-neon-magenta" },
  { kind: "video", label: "Video",  Icon: Video,     tint: "from-neon-purple to-neon-blue" },
  { kind: "file",  label: "Archivo",Icon: File,      tint: "from-brand-blue to-brand-green" },
];

export function AttachMenu({ onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-12 left-0 z-30 glass rounded-2xl p-1.5 w-40 shadow-glass dark:shadow-glass-dark border border-white/20"
    >
      {OPTIONS.map(({ kind, label, Icon, tint }) => (
        <button
          key={kind}
          type="button"
          onClick={() => { onPick(kind); onClose(); }}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-sm text-fg-light dark:text-fg-dark hover:bg-brand-orange/10 transition"
        >
          <span className={`h-8 w-8 rounded-full bg-gradient-to-br ${tint} flex items-center justify-center text-white shrink-0`}>
            <Icon className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <span className="font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
}
