"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface MoonMarkProps {
  size?: number;
  className?: string;
  /** Flota suave + brillo pulsante — para el hero de login y el estado vacío. */
  animated?: boolean;
}

/**
 * Isotipo de GOZZ en SVG inline (no `<img>`) para poder animarlo con Framer Motion.
 * Espejo del símbolo estático en `public/logo-gozz.svg` (favicon / <img> donde no hace
 * falta animación).
 */
export function MoonMark({ size = 40, className, animated = false }: MoonMarkProps) {
  const svg = (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("shrink-0", className)}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#5750E8" />
      <path d="M21 12.79A9 9 0 0 1 12.9 21 7 7 0 0 0 21 12.79z" fill="#8B85F0" />
      <motion.path
        d="M18.5 5.5l0.6 1.4 1.4 0.6-1.4 0.6-0.6 1.4-0.6-1.4-1.4-0.6 1.4-0.6z"
        fill="#8B85F0"
        animate={animated ? { opacity: [0.4, 1, 0.4] } : undefined}
        transition={animated ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
      <motion.path
        d="M21.2 9.8l0.35 0.85 0.85 0.35-0.85 0.35-0.35 0.85-0.35-0.85-0.85-0.35 0.85-0.35z"
        fill="#5750E8"
        animate={animated ? { opacity: [1, 0.35, 1] } : undefined}
        transition={animated ? { duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.6 } : undefined}
      />
    </svg>
  );

  if (!animated) return svg;

  return (
    <motion.div
      className="inline-flex"
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      {svg}
    </motion.div>
  );
}
