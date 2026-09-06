import { cn } from "@/lib/utils";

/**
 * Tarjeta plana blanca — el primitivo base del rediseño 2026. Distinta de `GlassCard`
 * (translúcida, se mantiene para donde se quiera ese efecto explícitamente).
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl2 bg-bg-canvas dark:bg-bg-darkcard border border-black/5 dark:border-white/[0.06] shadow-card-light transition-shadow hover:shadow-card-light-hover",
        className
      )}
      {...props}
    />
  );
}
