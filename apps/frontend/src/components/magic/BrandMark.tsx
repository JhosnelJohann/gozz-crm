"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Si false, se muestra sin animaciones (ideal para sidebar compacto) */
  animated?: boolean;
  /** Mostrar ™ */
  tm?: boolean;
  /** Tono de fondo donde vive (para elegir el mix correcto). "dark" | "light" */
  surface?: "dark" | "light";
}

const SIZES: Record<NonNullable<Props["size"]>, { main: string; tm: string; gap: string; icon: string }> = {
  sm: { main: "text-sm leading-tight", tm: "text-[8px]", gap: "gap-0.5", icon: "text-sm" },
  md: { main: "text-xl leading-[1.05]", tm: "text-[10px]", gap: "gap-1", icon: "text-xl" },
  lg: { main: "text-4xl md:text-5xl leading-[0.95] tracking-tight", tm: "text-sm", gap: "gap-1.5", icon: "text-4xl md:text-5xl" },
  xl: { main: "text-6xl md:text-7xl leading-[0.9] tracking-tighter", tm: "text-xl", gap: "gap-2", icon: "text-6xl md:text-7xl" },
};

export function BrandMark({ size = "md", className, animated = true, tm = true, surface = "dark" }: Props) {
  const s = SIZES[size];
  const isDark = surface === "dark";

  return (
    <motion.div
      initial={animated ? { opacity: 0, y: 6 } : undefined}
      animate={animated ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
      className={cn("inline-flex items-center select-none", s.gap, className)}
    >
      {/* Isotipo · luna creciente */}
      <i
        aria-hidden
        className={cn("bi bi-moon-fill shrink-0", s.icon)}
        style={{ color: "#5750E8" }}
      />

      <span className="relative inline-block">
        {/* Capa 1 · gradient principal (base del texto) */}
        <span
          className={cn(
            "brand-mark-base font-inter font-black",
            s.main,
            "bg-clip-text text-transparent",
            "bg-[linear-gradient(100deg,#5750E8_0%,#33359D_50%,#5750E8_100%)]",
            "bg-[length:200%_100%]",
            animated && "animate-brand-shift"
          )}
          style={{ WebkitTextStroke: isDark ? "0" : "0" }}
        >
          GOZZ
        </span>

        {/* Capa 2 · shimmer holográfico superpuesto */}
        {animated && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 font-inter font-black",
              s.main,
              "bg-clip-text text-transparent",
              "bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.65)_45%,rgba(255,255,255,0.95)_50%,rgba(255,255,255,0.65)_55%,transparent_70%)]",
              "bg-[length:300%_100%]",
              "animate-brand-shimmer"
            )}
            style={{ mixBlendMode: "screen" }}
          >
            GOZZ
          </span>
        )}

        {/* Capa 3 · subrayado de marca con beam */}
        {(size === "lg" || size === "xl") && (
          <span
            aria-hidden
            className="absolute -bottom-[0.15em] left-0 right-[1.8em] h-[0.08em] rounded-full bg-[linear-gradient(90deg,transparent_0%,#5750E8_25%,#33359D_75%,transparent_100%)] opacity-70"
          />
        )}
      </span>

      {tm && (
        <motion.sup
          initial={animated ? { opacity: 0, scale: 0.6, rotate: -12 } : undefined}
          animate={animated ? { opacity: 1, scale: 1, rotate: 0 } : undefined}
          transition={{ type: "spring", stiffness: 280, damping: 18, delay: 0.35 }}
          className={cn(
            "inline-flex items-center justify-center font-inter font-extrabold tracking-wider align-top mt-[0.15em]",
            s.tm,
            isDark ? "text-white/70" : "text-slate-700",
          )}
          style={{ letterSpacing: "0.02em" }}
          title="Marca registrada"
        >
          ™
        </motion.sup>
      )}
    </motion.div>
  );
}
