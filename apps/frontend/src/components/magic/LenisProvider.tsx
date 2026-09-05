"use client";
import { useEffect } from "react";
import Lenis from "@studio-freight/lenis";

export function LenisProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1.1,
    } as any);
    let raf = 0;
    const loop = (time: number) => { lenis.raf(time); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    // --- Scroll nativo con la rueda dentro de contenedores scrolleables ---
    // Lenis 1.0.x captura la rueda globalmente y solo respeta el atributo
    // `data-lenis-prevent`. Sin el, las barras de navegacion verticales (sidebar,
    // lista de chats, rails de correo, navs de Drive, paneles, etc.) NO scrollean
    // con la rueda porque Lenis se la "traga" para mover la pagina.
    // Aqui marcamos dinamicamente con `data-lenis-prevent` cualquier contenedor que
    // REALMENTE pueda desplazarse, para que la rueda scrollee ese contenedor.
    // - Solo marcamos los que de verdad desbordan (evita "zonas muertas").
    // - Solo quitamos el atributo de los que nosotros pusimos (no tocamos los
    //   `data-lenis-prevent` escritos a mano en el JSX).
    const SEL =
      '[class*="overflow-y-auto"],[class*="overflow-y-scroll"],[class*="overflow-auto"],' +
      '[class*="overflow-x-auto"],[class*="overflow-x-scroll"],.scrollbar-thin,.column-scrollbar,textarea';
    const managed = new WeakSet<HTMLElement>();
    const refresh = () => {
      document.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
        const s = getComputedStyle(el);
        const canY = (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
        const canX = (s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
        const scrollable = canY || canX;
        if (scrollable && !el.hasAttribute("data-lenis-prevent")) {
          el.setAttribute("data-lenis-prevent", "");
          managed.add(el);
        } else if (!scrollable && managed.has(el)) {
          el.removeAttribute("data-lenis-prevent");
          managed.delete(el);
        }
      });
    };

    // Debounce: el DOM muta mucho (chat, listas). Reescanear como mucho cada ~250ms.
    let t: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => { if (t) return; t = setTimeout(() => { t = null; refresh(); }, 250); };

    refresh();
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    // El crecimiento de un <textarea> al tipear NO muta el DOM (solo cambia el value), así que el
    // MutationObserver no lo detecta. Re-escaneamos también en `input` para marcar textareas que
    // pasan a desbordar y que la rueda scrollee el propio campo y no la página (via Lenis).
    document.addEventListener("input", schedule, true);
    // Reescaneos tras montar (datos que llegan async cambian el tamano scrolleable).
    const t1 = setTimeout(refresh, 600);
    const t2 = setTimeout(refresh, 1800);

    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
      clearTimeout(t1); clearTimeout(t2);
      obs.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("input", schedule, true);
      lenis.destroy();
    };
  }, []);
  return <>{children}</>;
}
