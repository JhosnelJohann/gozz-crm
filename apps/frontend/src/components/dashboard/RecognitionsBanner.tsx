"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Clock, TrendingUp, Sparkles, Heart } from "@/lib/bootstrap-icons";

type Stat = { value: string; label: string };

const MEDALS: Record<string, { icon: string; label: string; grad: string; ring: string; congrats: string }> = {
  puntualidad: {
    icon: "🏅", label: "Puntualidad", grad: "from-[#1E9BD7] via-[#2DB39A] to-[#43A847]",
    ring: "shadow-[0_0_0_4px_rgba(67,168,71,0.25)]",
    congrats: "Por su puntualidad y compromiso con la empresa 🙌",
  },
  vendedor_semana: {
    icon: "🥇", label: "Vendedor de la semana", grad: "from-[#FFC83D] via-[#FF9D26] to-[#FF6A00]",
    ring: "shadow-[0_0_0_4px_rgba(87,80,232,0.3)]",
    congrats: "Por su esfuerzo y excelencia cerrando casos 🔥",
  },
  preparador_semana: {
    icon: "👏", label: "Preparador de la semana", grad: "from-[#9B5DE5] via-[#C04AC9] to-[#F06292]",
    ring: "shadow-[0_0_0_4px_rgba(192,74,201,0.3)]",
    congrats: "Por su dedicación preparando cada caso 💜",
  },
};

// Convierte la metadata cruda en estadísticas legibles (nada de "dias: 5 · minutos_tarde: 0")
function statsFor(tipo: string, md: any): Stat[] {
  if (!md || typeof md !== "object") return [];
  if (tipo === "puntualidad") {
    const dias = Number(md.dias ?? 0);
    const tarde = Number(md.minutos_tarde ?? 0);
    return [
      { value: String(dias), label: dias === 1 ? "día a tiempo" : "días a tiempo" },
      tarde === 0
        ? { value: "0", label: "atrasos en la semana" }
        : { value: String(tarde), label: tarde === 1 ? "minuto de atraso" : "minutos de atraso" },
    ];
  }
  if (tipo === "vendedor_semana") {
    const v = Number(md.ventas ?? 0);
    return [{ value: `$${v.toLocaleString("en-US")}`, label: "en ventas cerradas" }];
  }
  if (tipo === "preparador_semana") {
    const c = Number(md.casos ?? 0);
    return [{ value: String(c), label: c === 1 ? "caso preparado" : "casos preparados" }];
  }
  // genérico: muestra valores sin las claves técnicas
  return Object.values(md).map((v) => ({ value: String(v), label: "" }));
}

// "1 jun – 7 jun"
function rangoSemana(inicio?: string): string {
  if (!inicio) return "";
  try {
    const dia = String(inicio).slice(0, 10); // soporta "2026-06-01" o ISO "2026-06-01T00:00:00.000Z"
    const d0 = new Date(dia + "T12:00:00");
    if (isNaN(d0.getTime())) return "";
    const d1 = new Date(d0.getTime() + 6 * 86400000);
    const f = (d: Date) => d.toLocaleDateString("es", { day: "numeric", month: "short" });
    return `${f(d0)} – ${f(d1)}`;
  } catch { return ""; }
}

// Chispas flotantes decorativas dentro de la tarjeta
function FloatingSparkles() {
  const dots = [
    { top: "12%", left: "8%", d: 0 }, { top: "70%", left: "14%", d: 0.6 },
    { top: "26%", left: "88%", d: 1.1 }, { top: "82%", left: "82%", d: 0.3 },
    { top: "48%", left: "50%", d: 1.5 },
  ];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {dots.map((p, i) => (
        <motion.div
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full bg-white"
          style={{ top: p.top, left: p.left }}
          animate={{ opacity: [0, 1, 0], scale: [0.5, 1.4, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: p.d, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

export function RecognitionsBanner() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => {
    fetch("/api/recognitions/actuales").then((r) => r.json()).then((d) => setItems(d.recognitions || []));
  }, []);
  if (!items || items.length === 0) return null;

  const rango = rangoSemana(items[0]?.semana_inicio);

  return (
    <section className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-0">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        {/* Encabezado de la sección */}
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-gold to-brand-orange flex items-center justify-center shadow-glow shrink-0">
            <Trophy className="h-5 w-5 text-white" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg sm:text-2xl font-black leading-none">Ganadores de la semana</h2>
              <motion.span animate={{ rotate: [0, 12, -8, 0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 1.5 }}>
                <Sparkles className="h-5 w-5 text-brand-gold shrink-0" />
              </motion.span>
            </div>
            <p className="text-[12px] text-neutral-500 mt-0.5 truncate">
              Reconocimientos del equipo{rango ? ` · semana del ${rango}` : ""}
            </p>
          </div>
        </div>

        {/* Tarjetas de ganadores */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it: any, idx: number) => {
            const meta = MEDALS[it.tipo] || { icon: "🎖️", label: it.tipo, grad: "from-slate-500 to-slate-700", ring: "", congrats: "¡Gran trabajo esta semana!" };
            const stats = statsFor(it.tipo, it.metadata);
            return (
              <motion.div
                key={it.id}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.1 * idx, type: "spring", stiffness: 220, damping: 20 }}
                whileHover={{ scale: 1.025, y: -3 }}
                className={`group relative rounded-3xl p-5 bg-gradient-to-br ${meta.grad} text-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] overflow-hidden`}
              >
                {/* Glow + brillo de fondo */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.35),transparent_55%)] pointer-events-none" />
                <FloatingSparkles />
                {/* Barrido de luz */}
                <motion.div
                  className="absolute -inset-y-2 -left-1/2 w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none"
                  animate={{ x: ["0%", "320%"] }}
                  transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
                />

                {/* Cinta de felicitación */}
                <div className="relative flex items-center justify-between mb-3">
                  <span className="px-2.5 py-1 rounded-full bg-white/25 backdrop-blur text-[10px] font-ui uppercase tracking-wider font-black">
                    🎉 ¡Felicidades!
                  </span>
                  <span className="text-[10px] font-ui uppercase tracking-[0.15em] font-bold opacity-90">{meta.label}</span>
                </div>

                {/* Foto + nombre */}
                <div className="relative flex items-center gap-4">
                  <div className="relative shrink-0">
                    {it.foto_perfil_url ? (
                      <img src={it.foto_perfil_url} alt={it.nombre} className={`h-16 w-16 rounded-full object-cover border-2 border-white/70 ${meta.ring}`} />
                    ) : (
                      <div className={`h-16 w-16 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-3xl border-2 border-white/70 ${meta.ring}`}>{meta.icon}</div>
                    )}
                    <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white flex items-center justify-center text-base shadow-md">{meta.icon}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-black text-xl leading-tight truncate">{it.nombre}</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] opacity-90 font-ui">
                      <Heart className="h-3 w-3" fill="currentColor" /> {meta.congrats}
                    </div>
                  </div>
                </div>

                {/* Estadísticas pulcras */}
                {stats.length > 0 && (
                  <div className="relative mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))` }}>
                    {stats.map((s, k) => (
                      <div key={k} className="rounded-2xl bg-white/15 backdrop-blur px-3 py-2 text-center">
                        <div className="font-display font-black text-lg leading-none tabular-nums">{s.value}</div>
                        {s.label && <div className="text-[10px] opacity-85 mt-1 leading-tight">{s.label}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
}
