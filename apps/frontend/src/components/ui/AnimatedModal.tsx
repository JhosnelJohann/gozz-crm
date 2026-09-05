"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Shell de modal con transición ESTÁNDAR (rápida, no instantánea) para unificar el comportamiento
 * de aparición de las modales del CRM. Overlay con fade + panel con fade/scale/slide corto.
 *
 * Pensado para uso con montaje condicional del padre (`{open && <AnimatedModal .../>}`): la
 * animación de ENTRADA corre al montar. Se portea a <body> para evitar problemas de stacking.
 */
export function AnimatedModal({
  onClose,
  children,
  panelClassName,
  overlayClassName,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  children: React.ReactNode;
  panelClassName?: string;
  overlayClassName?: string;
  closeOnBackdrop?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);
  if (!mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      onClick={closeOnBackdrop ? onClose : undefined}
      className={cn("fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50", overlayClassName)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
        onClick={(e) => e.stopPropagation()}
        className={panelClassName}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body
  );
}
