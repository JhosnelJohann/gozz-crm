"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TooltipProps {
  label: string;
  side?: "right" | "top" | "bottom" | "left";
  delay?: number;
  children: ReactNode;
}

/**
 * Tooltip a mano (no hay Radix instalado) — mismo patrón de portal+getBoundingClientRect que
 * ya usa `BuzonesRail.tsx` para sus menús. Necesario para el sidebar de solo-iconos: al quitar
 * las etiquetas de texto, el label solo aparece al hover/focus.
 */
export function Tooltip({ label, side = "right", delay = 400, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    timer.current = setTimeout(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 10;
      if (side === "right") setPos({ top: r.top + r.height / 2, left: r.right + gap });
      else if (side === "left") setPos({ top: r.top + r.height / 2, left: r.left - gap });
      else if (side === "top") setPos({ top: r.top - gap, left: r.left + r.width / 2 });
      else setPos({ top: r.bottom + gap, left: r.left + r.width / 2 });
      setOpen(true);
    }, delay);
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const translate =
    side === "right" ? "-translate-y-1/2" :
    side === "left" ? "-translate-y-1/2 -translate-x-full" :
    side === "top" ? "-translate-x-1/2 -translate-y-full" :
    "-translate-x-1/2";

  return (
    <div
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.12 }}
                style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
                className={cn(
                  "pointer-events-none rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap",
                  "bg-bg-sidebar text-white shadow-lg",
                  translate
                )}
              >
                {label}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
