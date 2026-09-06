"use client";
import { useEffect, useRef } from "react";

export function FloatingOrbs({ count = 5, palette = "neon" }: { count?: number; palette?: "neon" | "light-indigo" }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const move = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.querySelectorAll<HTMLDivElement>("[data-orb]").forEach((orb, i) => {
        const depth = 20 + i * 8;
        orb.style.transform = `translate(${x * depth}px, ${y * depth}px)`;
      });
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  // Paleta clara: solo 2 tonos índigo de marca, muy baja opacidad — para fondos claros
  // (login rediseñado 2026). La paleta "neon" original (5 colores arcoíris) se mantiene para
  // las superficies oscuras que no se tocan en esta entrega.
  const orbsByPalette = {
    neon: [
      { size: 280, x: "15%", y: "20%", color: "rgba(87, 80, 232, 0.35)", blur: 80, delay: 0 },
      { size: 220, x: "70%", y: "15%", color: "rgba(255, 0, 110, 0.3)", blur: 90, delay: 1 },
      { size: 320, x: "20%", y: "70%", color: "rgba(131, 56, 236, 0.3)", blur: 100, delay: 2 },
      { size: 200, x: "75%", y: "65%", color: "rgba(58, 134, 255, 0.25)", blur: 85, delay: 0.5 },
      { size: 180, x: "50%", y: "40%", color: "rgba(6, 255, 165, 0.2)", blur: 80, delay: 1.5 },
    ],
    "light-indigo": [
      { size: 380, x: "10%", y: "10%", color: "rgba(87, 80, 232, 0.14)", blur: 100, delay: 0 },
      { size: 320, x: "75%", y: "20%", color: "rgba(51, 53, 157, 0.10)", blur: 110, delay: 1 },
      { size: 300, x: "60%", y: "75%", color: "rgba(87, 80, 232, 0.10)", blur: 100, delay: 0.6 },
    ]
  };
  const orbs = orbsByPalette[palette].slice(0, count);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden pointer-events-none">
      {orbs.map((o, i) => (
        <div
          key={i}
          data-orb
          className="absolute rounded-full transition-transform duration-300 ease-out animate-float"
          style={{
            width: o.size,
            height: o.size,
            left: o.x,
            top: o.y,
            background: o.color,
            filter: `blur(${o.blur}px)`,
            animationDelay: `${o.delay}s`
          }}
        />
      ))}
    </div>
  );
}
