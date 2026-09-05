"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

/**
 * Área con scroll horizontal + "botones fantasma" estilo Bitrix: aparecen al pasar el mouse por el
 * área y se ocultan si no hay a dónde desplazar. Al posicionar el mouse SOBRE una flecha, desplaza
 * automáticamente mientras el cursor siga encima. `Shift + rueda` (o gesto horizontal de trackpad)
 * desplaza en toda el área — se escucha en fase de captura para adelantarse a los onWheel de las
 * columnas (que hacen stopPropagation para su scroll vertical).
 *
 *   <HorizontalScrollArea className="pb-4 scrollbar-thin">
 *     <div className="flex gap-4 min-w-max">{columnas}</div>
 *   </HorizontalScrollArea>
 */
export function HorizontalScrollArea({ children, className }: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [hovered, setHovered] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        el.scrollLeft += (e.deltaX || e.deltaY);
        update();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    // Observar el CONTENIDO (crece al cargar datos/columnas), no solo el contenedor: un
    // ResizeObserver sobre el contenedor no dispara cuando el contenido desborda.
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild as Element);
    return () => {
      window.removeEventListener("resize", onResize);
      el.removeEventListener("wheel", onWheel, { capture: true } as any);
      ro.disconnect();
    };
  }, []);

  const stopAuto = () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  const startAuto = (dir: 1 | -1) => {
    stopAuto();
    const step = () => {
      const el = ref.current;
      if (!el) return;
      el.scrollLeft += dir * 14; // px por frame (~60fps)
      update();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  useEffect(() => stopAuto, []);

const btnBase = "absolute top-1/2 -translate-y-1/2 z-20 h-14 w-9 rounded-2xl bg-white/40 dark:bg-neutral-800/40 border border-black/5 dark:border-white/10 shadow-lg flex items-center justify-center text-neutral-700 dark:text-neutral-100 transition-all duration-200 cursor-pointer";

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); stopAuto(); }}
    >
      <div ref={ref} onScroll={update} className={cn("overflow-x-auto", className)}>
        {children}
      </div>
      {canLeft && (
        <button
          type="button" aria-label="Desplazar a la izquierda"
          onMouseEnter={() => startAuto(-1)} onMouseLeave={stopAuto}
          className={cn(btnBase, "left-1", hovered ? "opacity-100" : "opacity-0 pointer-events-none")}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}
      {canRight && (
        <button
          type="button" aria-label="Desplazar a la derecha"
          onMouseEnter={() => startAuto(1)} onMouseLeave={stopAuto}
          className={cn(btnBase, "right-1", hovered ? "opacity-100" : "opacity-0 pointer-events-none")}
        >
          <ChevronRight className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
