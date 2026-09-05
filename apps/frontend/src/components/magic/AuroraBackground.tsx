"use client";
import { cn } from "@/lib/utils";

export function AuroraBackground({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}>
      <div
        className="absolute inset-[-50%] animate-[aurora-spin_44s_linear_infinite] [will-change:transform]"
        style={{
          background: "conic-gradient(from 0deg at 50% 50%, #5750E8, #FF006E, #8338EC, #3A86FF, #06FFA5, #5750E8)",
          filter: `blur(64px)`,
          opacity: 0.35 * intensity
        }}
      />
      <div
        className="absolute inset-[-50%] [will-change:transform]"
        style={{
          background: "conic-gradient(from 180deg at 50% 50%, #5750E8, #FFBE0B, #FF006E, #8338EC, #3A86FF, #5750E8)",
          filter: `blur(84px)`,
          opacity: 0.2 * intensity,
          animation: "aurora-spin 60s linear infinite reverse"
        }}
      />
    </div>
  );
}
