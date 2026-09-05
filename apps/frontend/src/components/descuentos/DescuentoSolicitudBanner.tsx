"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DollarSign, X, ArrowRight, Check, Ban } from "@/lib/bootstrap-icons";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";

interface DescuentoEvent {
  descuento_id: string;
  oportunidad_id: string;
  oportunidad_titulo: string;
  from_user_id: string;
  from_nombre: string;
  from_foto: string | null;
  monto?: number;
  porcentaje?: number;
  motivo: string;
  timestamp: string;
}

export function DescuentoSolicitudBanner() {
  const router = useRouter();
  const { isAdmin } = useCurrentUser();
  const [queue, setQueue] = useState<DescuentoEvent[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    const s = getSocket();
    const handler = (ev: DescuentoEvent) => {
      setQueue((q) => [...q, ev]);
      try {
        const a = new Audio("/sounds/notify.mp3");
        a.volume = 0.4;
        a.play().catch(() => {});
      } catch {}
    };
    s.on("descuento:solicitud", handler);
    return () => { s.off("descuento:solicitud", handler); };
  }, [isAdmin]);

  const current = queue[0];

  const dismiss = () => setQueue((q) => q.slice(1));

  const revisar = async (accion: "aprobar" | "rechazar") => {
    if (!current) return;
    setProcessing(true);
    try {
      const r = await fetch(`/api/descuentos/${current.descuento_id}/revisar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, comentario: "" })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Error"); }
      toast.success(accion === "aprobar" ? "Descuento aprobado" : "Descuento rechazado");
      dismiss();
    } catch (e: any) { toast.error(e.message); } finally { setProcessing(false); }
  };

  const goTo = () => {
    if (!current) return;
    router.push(`/oportunidades/${current.oportunidad_id}`);
    dismiss();
  };

  if (!isAdmin) return null;

  const display = current ? (current.monto ? `$${current.monto}` : `${current.porcentaje}%`) : "";

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.descuento_id}
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          className="fixed top-0 left-0 right-0 z-[80] px-4 pt-3"
        >
          <motion.div
            animate={{ boxShadow: ["0 8px 32px -8px rgba(87,80,232,0.45)", "0 12px 48px -8px rgba(87,80,232,0.6)", "0 8px 32px -8px rgba(87,80,232,0.45)"] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="mx-auto max-w-5xl rounded-2xl bg-gradient-to-r from-brand-orange to-brand-gold text-white flex items-center gap-3 px-4 py-3"
          >
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"
            >
              <DollarSign className="h-5 w-5" strokeWidth={2.2} />
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
                {current.from_nombre} solicita descuento · <strong>{display}</strong>
              </div>
              <div className="font-display font-bold text-sm truncate">
                <span className="opacity-80 font-normal">{current.oportunidad_titulo}:</span> {current.motivo}
              </div>
            </div>

            <button
              onClick={() => revisar("aprobar")}
              disabled={processing}
              className="h-9 px-3 rounded-xl bg-brand-green text-white font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-green-600 flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              Aprobar
            </button>
            <button
              onClick={() => revisar("rechazar")}
              disabled={processing}
              className="h-9 px-3 rounded-xl bg-brand-red text-white font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-red-600 flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-60"
            >
              <Ban className="h-3.5 w-3.5" strokeWidth={2.5} />
              Rechazar
            </button>
            <button
              onClick={goTo}
              className="h-9 px-4 rounded-xl bg-white text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-white/90 flex items-center gap-1.5 transition-colors shrink-0"
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
              <span className="h-6 px-2 rounded-full bg-white/25 text-[10px] font-bold flex items-center shrink-0">
                +{queue.length - 1}
              </span>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
