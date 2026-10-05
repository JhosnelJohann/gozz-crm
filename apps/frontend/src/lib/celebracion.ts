"use client";
// Explosión de partículas para celebrar un cierre ("Cliente ganado"). Un canvas temporal encima de
// todo, sin dependencias, que se borra solo al terminar. No hace nada con prefers-reduced-motion.

export function celebrar(x: number = innerWidth / 2, y: number = innerHeight / 3, color = "#43A847", cantidad = 150): void {
  if (typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = document.createElement("canvas");
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  Object.assign(cv.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "9999" });
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  if (!ctx) { cv.remove(); return; }
  ctx.scale(dpr, dpr);
  const paleta = [color, "#5b4dff", "#9a3df5", "#ffb547", "#ff4d7e", "#33d1ff"];
  const parts = Array.from({ length: cantidad }, () => {
    const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 9;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, vida: 1, t: 3 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: paleta[Math.floor(Math.random() * paleta.length)], cuadrado: Math.random() < 0.6 };
  });
  const paso = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let vivas = 0;
    for (const p of parts) {
      if (p.vida <= 0) continue;
      vivas++;
      p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vida -= 0.012;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.vida); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.cuadrado) ctx.fillRect(-p.t / 2, -p.t / 4, p.t, p.t / 2); else { ctx.beginPath(); ctx.arc(0, 0, p.t / 2.4, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (vivas) requestAnimationFrame(paso); else cv.remove();
  };
  requestAnimationFrame(paso);
}
