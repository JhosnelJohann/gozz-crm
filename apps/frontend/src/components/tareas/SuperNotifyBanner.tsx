"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Megaphone, X, ArrowRight } from "@/lib/bootstrap-icons";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { initialsOf } from "@/lib/auth-user";

interface SuperNotifyEvent {
  tarea_id: string;
  tarea_titulo: string;
  from_user_id: string;
  from_nombre: string;
  from_foto: string | null;
  mensaje: string;
  timestamp: string;
}

export function SuperNotifyBanner() {
  const router = useRouter();
  const [queue, setQueue] = useState<SuperNotifyEvent[]>([]);

  useEffect(() => {
    const s = getSocket();
    const handler = (ev: SuperNotifyEvent) => {
      setQueue((q) => [...q, ev]);
      // Sonido breve
      try {
        const a = new Audio("/sounds/notify.mp3");
        a.volume = 0.35;
        a.play().catch(() => {});
      } catch {}
    };
    s.on("tarea:super-notify", handler);
    return () => { s.off("tarea:super-notify", handler); };
  }, []);

  const current = queue[0];

  const dismiss = () => setQueue((q) => q.slice(1));
  const goToTarea = () => {
    if (!current) return;
    router.push(`/tareas?id=${current.tarea_id}`);
    dismiss();
  };

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.timestamp}
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          className="fixed top-0 left-0 right-0 z-[80] px-4 pt-3"
        >
          <motion.div
            animate={{ boxShadow: ["0 8px 32px -8px rgba(229,57,53,0.45)", "0 12px 48px -8px rgba(229,57,53,0.6)", "0 8px 32px -8px rgba(229,57,53,0.45)"] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="mx-auto max-w-4xl rounded-2xl bg-gradient-to-r from-brand-red to-brand-orange text-white flex items-center gap-3 px-4 py-3"
          >
            <motion.div
              animate={{ rotate: [0, -12, 12, -12, 12, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.5 }}
              className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"
            >
              <Megaphone className="h-5 w-5" strokeWidth={2.2} />
            </motion.div>

            {current.from_foto ? (
              <img src={current.from_foto} className="h-8 w-8 rounded-full border-2 border-white/80 object-cover shrink-0" alt="" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-white/20 text-[10px] font-bold flex items-center justify-center shrink-0">
                {initialsOf(current.from_nombre || "?")}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-ui uppercase tracking-[0.12em] opacity-90">
                {current.from_nombre} te llama en una tarea
              </div>
              <div className="font-display font-bold text-sm truncate">
                <span className="opacity-80 font-normal">{current.tarea_titulo}:</span> {current.mensaje}
              </div>
            </div>

            <button
              onClick={goToTarea}
              className="h-9 px-4 rounded-xl bg-white text-brand-red font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-white/90 flex items-center gap-1.5 transition-colors shrink-0"
            >
              Ver
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>

            <button
              onClick={dismiss}
              className="h-9 w-9 rounded-xl hover:bg-white/15 flex items-center justify-center shrink-0"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>

            {queue.length > 1 && (
              <span className="h-6 px-2 rounded-full bg-white/25 text-[10px] font-bold flex items-center">
                +{queue.length - 1}
              </span>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
