"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "@/lib/bootstrap-icons";
import { useLocalParticipant } from "@livekit/components-react";
import { LocalVideoTrack, Track } from "livekit-client";
import { BackgroundBlur, ProcessorWrapper } from "@livekit/track-processors";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const PRESETS = [
  { id: "none", label: "Sin efecto", className: "bg-zinc-800" },
  { id: "blur-light", label: "Blur suave", className: "bg-zinc-700 backdrop-blur" },
  { id: "blur-strong", label: "Blur fuerte", className: "bg-zinc-600 backdrop-blur-xl" },
];

export function BackgroundPicker({ open, onClose }: Props) {
  const { localParticipant } = useLocalParticipant();
  const [active, setActive] = useState<string>("none");
  const [busy, setBusy] = useState(false);

  const apply = async (id: string) => {
    setBusy(true);
    try {
      const camPub = localParticipant.getTrackPublication(Track.Source.Camera);
      const track = camPub?.track as LocalVideoTrack | undefined;
      if (!track) { toast.error("Cámara no activa"); setBusy(false); return; }
      if (id === "none") {
        await track.stopProcessor();
      } else if (id === "blur-light") {
        await track.setProcessor(BackgroundBlur(5));
      } else if (id === "blur-strong") {
        await track.setProcessor(BackgroundBlur(15));
      }
      setActive(id);
      toast.success("Fondo aplicado");
    } catch (e: any) {
      console.error(e);
      toast.error("No se pudo aplicar el fondo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.95 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(92vw,560px)] bg-[rgba(15,15,25,0.95)] backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-orange" />
                <h3 className="font-display font-black text-lg">Fondo virtual</h3>
              </div>
              <button onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-white/10 flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => apply(p.id)}
                  disabled={busy}
                  className={`group aspect-video rounded-2xl border-2 transition overflow-hidden relative ${
                    active === p.id ? "border-brand-orange ring-2 ring-brand-orange/30" : "border-white/10 hover:border-white/30"
                  } ${p.className}`}
                >
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-black/60 text-[11px] font-ui">
                    {p.label}
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-white/40 font-ui leading-relaxed">
              Procesado local con WebGL. Más presets (GOZZ gradient, mesh, neon) llegarán pronto.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
