"use client";
import { motion } from "framer-motion";
import { Inbox, Sparkles } from "@/lib/bootstrap-icons";
import { ShimmerButton } from "@/components/magic/ShimmerButton";

export function EmailEmptyState({ onConnectMailbox }: { onConnectMailbox?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-12 relative overflow-hidden">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 rounded-full bg-brand-orange/20 blur-2xl animate-pulse-glow" />
        <div className="relative h-24 w-24 rounded-full gradient-orange flex items-center justify-center shadow-glow-lg">
          <Inbox className="h-10 w-10 text-white" strokeWidth={1.5} />
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.2em] font-bold mb-3"
      >
        <Sparkles className="h-3.5 w-3.5" /> Bandeja vacía
      </motion.div>
      <motion.h3
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="font-display text-2xl font-black mb-2"
      >
        No hay correos <span className="text-gradient-orange">aún</span>
      </motion.h3>
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-sm text-neutral-500 max-w-sm mb-6"
      >
        Los correos aparecerán aquí automáticamente. Si aún no conectaste tu cuenta, empieza abajo.
      </motion.p>
      {onConnectMailbox && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <ShimmerButton onClick={onConnectMailbox}>
            Conectar buzón
          </ShimmerButton>
        </motion.div>
      )}
    </div>
  );
}
