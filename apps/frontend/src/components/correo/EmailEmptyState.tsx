"use client";
import { motion } from "framer-motion";
import { Sparkle } from "@/lib/bootstrap-icons";
import { MoonMark } from "@/components/magic/MoonMark";
import { ShimmerButton } from "@/components/magic/ShimmerButton";

const SPARKLES = [
  { top: "8%", left: "18%", delay: 0 },
  { top: "22%", left: "78%", delay: 0.5 },
  { top: "72%", left: "72%", delay: 1 }
];

export function EmailEmptyState({ onConnectMailbox }: { onConnectMailbox?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-12 relative overflow-hidden">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
        className="relative mb-6 h-24 w-24"
      >
        {SPARKLES.map((s, i) => (
          <motion.div
            key={i}
            className="absolute"
            style={{ top: s.top, left: s.left }}
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: s.delay }}
          >
            <Sparkle size={12} weight="fill" className="text-brand-primary" />
          </motion.div>
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <MoonMark size={64} animated />
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-brand-primary text-xs font-semibold mb-3"
      >
        Bandeja vacía
      </motion.div>
      <motion.h3
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="font-display text-2xl font-bold mb-2"
      >
        Tu bandeja está <span className="text-brand-primary">en calma</span>
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
