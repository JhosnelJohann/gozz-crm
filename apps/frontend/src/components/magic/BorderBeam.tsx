import { cn } from "@/lib/utils";

export function BorderBeam({ className, size = 200, duration = 6 }: { className?: string; size?: number; duration?: number }) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit] [border:1px_solid_transparent] ![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]", className)}
      style={{
        backgroundImage: `conic-gradient(from calc(360deg/${duration}*var(--time,0)),transparent 0,#5750E8 10%,#FFBE0B 20%,transparent 30%)`,
        animation: `border-spin ${duration}s linear infinite`
      }}
    />
  );
}
