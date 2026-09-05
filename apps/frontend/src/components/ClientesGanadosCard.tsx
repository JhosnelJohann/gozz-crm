"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trophy, TrendUp, ArrowRight, Sparkle, CurrencyDollar } from "@/lib/bootstrap-icons";
import { NumberTicker } from "@/components/magic/NumberTicker";
import { cn } from "@/lib/utils";

interface Ganado {
  id: string;
  nombre_caso: string;
  etapa: "aprobado" | "completado";
  valor_total: string | number;
  updated_at: string;
  contacto_id: string | null;
  contacto_nombre: string | null;
  tramite_nombre: string | null;
  tramite_codigo: string | null;
  formulario_uscis: string | null;
  preparador_nombre: string | null;
}

interface Data {
  ganados: Ganado[];
  total_count: number;
  total_valor: number;
}

function relativeEs(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return "ahora";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return mins === 1 ? "hace 1 min" : `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "hace 1 día" : `hace ${days} días`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return weeks === 1 ? "hace 1 semana" : `hace ${weeks} semanas`;
  const months = Math.floor(days / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}

function safeNumber(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? 0 : n;
}

function getInitials(name: string | null | undefined, fallback: string = "?"): string {
  const s = (name || fallback).trim();
  if (!s) return "?";
  return s.split(/\s+/).map((w) => w[0] || "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

export function ClientesGanadosCard() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats/clientes-ganados")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        // Defensive shape normalization
        setData({
          ganados: Array.isArray(d?.ganados) ? d.ganados : [],
          total_count: safeNumber(d?.total_count),
          total_valor: safeNumber(d?.total_valor)
        });
      })
      .catch(() => {
        if (cancelled) return;
        setData({ ganados: [], total_count: 0, total_valor: 0 });
        setError(true);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full opacity-40"
          style={{
            background: "radial-gradient(circle, rgba(87,80,232,0.35), transparent 60%)",
            filter: "blur(60px)"
          }}
        />
        <div
          className="absolute -bottom-24 -left-24 w-[260px] h-[260px] rounded-full opacity-30"
          style={{
            background: "radial-gradient(circle, rgba(67,168,71,0.35), transparent 60%)",
            filter: "blur(60px)"
          }}
        />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(87,80,232,0.04) 1px, transparent 1px),linear-gradient(to bottom, rgba(87,80,232,0.04) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 70% 50% at 50% 50%, black 40%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 50% at 50% 50%, black 40%, transparent 80%)"
          }}
        />
        {[
          { x: "15%", y: "20%", delay: 0 },
          { x: "82%", y: "35%", delay: 1.5 },
          { x: "25%", y: "75%", delay: 3 },
          { x: "70%", y: "82%", delay: 2 }
        ].map((s, i) => (
          <div
            key={i}
            className="absolute text-brand-orange animate-float"
            style={{ left: s.x, top: s.y, animationDelay: `${s.delay}s`, opacity: 0.35 }}
          >
            <Sparkle className="h-4 w-4" weight="fill" />
          </div>
        ))}
      </div>

      {/* HEADER */}
      <div className="relative z-10 p-6 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-brand-orange">
            <Trophy className="h-4 w-4" weight="duotone" />
            Clientes ganados · Esta semana
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-ui uppercase tracking-[0.15em] text-brand-green">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-green" />
            </span>
            LIVE
          </div>
        </div>

        <h3 className="font-display text-2xl font-black leading-tight mb-4">
          Ganados de la <span className="text-gradient-orange">semana</span>
        </h3>

        <div className="flex items-center gap-6">
          <div>
            <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-500">Casos</div>
            <div className="font-display text-3xl font-black tabular-nums">
              <NumberTicker value={data ? data.total_count : null} />
            </div>
          </div>
          <div className="h-10 w-px bg-black/10 dark:bg-white/10" />
          <div>
            <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-500">Valor total</div>
            <div className="font-display text-3xl font-black tabular-nums text-gradient-orange">
              <NumberTicker value={data ? data.total_valor : null} prefix="$" />
            </div>
          </div>
          <div className="flex-1" />
          <TrendUp className="h-8 w-8 text-brand-green" weight="duotone" />
        </div>
      </div>

      <div className="relative z-10 mx-6 h-px bg-gradient-to-r from-transparent via-brand-orange/30 to-transparent" />

      <div className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
        {data === null ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl skeleton" />
            ))}
          </div>
        ) : data.ganados.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-full bg-brand-orange/30 blur-2xl animate-pulse-glow" />
              <Trophy className="relative h-14 w-14 text-brand-orange" weight="duotone" />
            </div>
            <div className="font-display font-black text-lg mb-1">Aún no hay casos ganados</div>
            <div className="text-xs text-neutral-500 max-w-xs">
              {error ? "No se pudo cargar. Intenta recargar la página." : "¡Vamos por el primero! Los casos aprobados o completados en los últimos 7 días aparecerán aquí."}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.ganados.map((g, i) => {
              const displayName = g.contacto_nombre || g.nombre_caso || "Cliente";
              const initials = getInitials(displayName);
              const badge = g.etapa === "aprobado"
                ? { bg: "bg-brand-green/15", text: "text-brand-green", label: "Aprobado" }
                : { bg: "bg-brand-blue/15", text: "text-brand-blue", label: "Completado" };
              const relTime = relativeEs(g.updated_at);
              const valor = safeNumber(g.valor_total);
              return (
                <motion.button
                  key={g.id || i}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.4 }}
                  onClick={() => g.id && router.push(`/oportunidades/${g.id}`)}
                  className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-brand-orange/5 hover:translate-x-1 transition-all text-left"
                >
                  <div className="relative shrink-0">
                    <div className="absolute inset-0 rounded-xl bg-brand-orange/30 blur-md opacity-0 group-hover:opacity-100 transition" />
                    <div className="relative h-11 w-11 rounded-xl gradient-orange flex items-center justify-center text-white font-ui font-bold text-xs shadow-glow">
                      {initials}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="font-display font-black text-sm truncate">
                        {displayName}
                      </div>
                      {g.formulario_uscis && (
                        <span className="text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-blue/10 text-brand-blue shrink-0">
                          {g.formulario_uscis}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-ui">
                      <span className={cn("px-1.5 py-0.5 rounded uppercase tracking-wider font-bold text-[9px]", badge.bg, badge.text)}>
                        {badge.label}
                      </span>
                      {relTime && <span className="truncate">{relTime}</span>}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-0.5 font-display font-black text-sm text-gradient-orange tabular-nums">
                      <CurrencyDollar className="h-3 w-3 text-brand-orange" weight="bold" />
                      {valor.toFixed(0)}
                    </div>
                    <ArrowRight className="h-3 w-3 ml-auto text-neutral-300 group-hover:text-brand-orange group-hover:translate-x-1 transition-all mt-0.5" weight="bold" />
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative z-10 h-1 gradient-aurora opacity-70" />
    </div>
  );
}
