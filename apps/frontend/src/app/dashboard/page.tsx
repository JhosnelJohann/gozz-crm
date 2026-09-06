"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Users, Briefcase, TrendUp, Warning, CheckSquare, UserCheck,
  Sparkle, ArrowUpRight, Lightning, Fire, Globe as GlobeIcon
} from "@/lib/bootstrap-icons";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { AppShell } from "@/components/AppShell";
import { BrandMark } from "@/components/magic/BrandMark";
import { RecognitionsBanner } from "@/components/dashboard/RecognitionsBanner";
import { BentoGrid, BentoItem } from "@/components/magic/BentoGrid";
import { NumberTicker } from "@/components/magic/NumberTicker";
import { ClientesGanadosCard } from "@/components/ClientesGanadosCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Marquee } from "@/components/magic/Marquee";
import { AuroraBackground } from "@/components/magic/AuroraBackground";
import { GridPattern } from "@/components/magic/GridPattern";
import { ETAPAS } from "@/lib/etapas";

interface Stats {
  contactos: number;
  oportunidades: number;
  en_progreso: number;
  sla_vencido: number;
  tareas_pendientes: number;
  usuarios_activos: number;
  por_etapa?: Record<string, number>;
  por_sla?: Record<string, number>;
  valor_total?: number;
  balance_total?: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notifs, setNotifs] = useState<any[]>([]);

  useEffect(() => {
    // PERF: el dashboard ya NO baja todas las oportunidades (~1.4MB). Los desgloses
    // (por etapa, SLA, totales) vienen calculados en /api/stats (server-side).
    fetch("/api/stats").then((r) => r.json()).then((d) => setStats(d.stats)).catch(() => {});
    fetch("/api/notificaciones").then((r) => r.json()).then((d) => setNotifs(d.notificaciones || [])).catch(() => {});
  }, []);

  const byEtapa = ETAPAS.filter((e) => e.key !== "cancelado").map((e) => ({
    etapa: e.label.slice(0, 4),
    count: stats?.por_etapa?.[e.key] || 0,
    color: e.color
  }));

  const sla = stats?.por_sla || {};
  const bySLA = [
    { name: "A tiempo", value: sla["on_track"] || 0, color: "#43A847" },
    { name: "Atención", value: sla["warning"] || 0, color: "#FFB51C" },
    { name: "Vencido", value: sla["vencido"] || 0, color: "#E53935" },
    { name: "Cerrado", value: sla["completado"] || 0, color: "#5C6670" }
  ].filter((s) => s.value > 0);

  const totalValor = stats?.valor_total || 0;
  const totalBalance = stats?.balance_total || 0;
  const cobrado = totalValor - totalBalance;

  return (
    <AppShell>
      {/* HERO with aurora */}
      <div className="relative overflow-hidden bg-bg-dark text-white">
        <AuroraBackground intensity={0.4} />
        <GridPattern />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-2 text-[11px] font-ui uppercase tracking-[0.2em] text-brand-orange mb-4"
          >
            <Sparkle className="h-3.5 w-3.5" weight="fill" />
            Panel de Control · {new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
            className="font-display text-3xl sm:text-5xl md:text-display-md font-black leading-[1] flex flex-wrap items-baseline gap-3"
          >
            <span className="text-white">Bienvenido a</span>
            <BrandMark size="xl" surface="dark" />
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="mt-4 text-white/60 max-w-xl font-space"
          >
            GOZZ CRM. Dashboard live con data real.
          </motion.p>
        </div>

        {/* Marquee de actividad en el hero */}
        {notifs.length > 0 && (
          <div className="relative z-10 pb-6">
            <Marquee className="py-2">
              {[...notifs, ...notifs, ...notifs].map((n, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/10 whitespace-nowrap">
                  <Lightning className="h-3 w-3 text-brand-orange" weight="fill" />
                  <span className="text-[11px] font-ui uppercase tracking-wider text-white/60">{n.titulo}</span>
                </div>
              ))}
            </Marquee>
          </div>
        )}
      </div>

      {/* Ganadores de la semana — debajo del hero "Bienvenido a GOZZ" */}
      <RecognitionsBanner />

      {/* BENTO GRID */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <BentoGrid>
          {/* Clientes ganados de la semana — 6 cols × 2 rows */}
          <BentoItem span="col-span-12 md:col-span-6" rowSpan="row-span-2" className="min-h-[440px] p-0">
            <ErrorBoundary><ClientesGanadosCard /></ErrorBoundary>
          </BentoItem>

          {/* KPI Contactos — 3 cols */}
          <BentoItem span="col-span-12 sm:col-span-6 md:col-span-3">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-blue/10 flex items-center justify-center mb-4">
                <Users className="h-5 w-5 text-brand-blue" weight="duotone" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">Contactos</div>
              <div className="font-display text-4xl font-black tabular-nums">
                <NumberTicker value={stats ? stats.contactos : null} />
              </div>
              <ArrowUpRight className="absolute top-4 right-4 h-4 w-4 text-neutral-400" weight="bold" />
            </div>
          </BentoItem>

          {/* KPI Oportunidades — 3 cols */}
          <BentoItem span="col-span-12 sm:col-span-6 md:col-span-3">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-orange/10 flex items-center justify-center mb-4">
                <Briefcase className="h-5 w-5 text-brand-orange" weight="duotone" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">Oportunidades</div>
              <div className="font-display text-4xl font-black tabular-nums text-gradient-orange">
                <NumberTicker value={stats ? stats.oportunidades : null} />
              </div>
              <ArrowUpRight className="absolute top-4 right-4 h-4 w-4 text-neutral-400" weight="bold" />
            </div>
          </BentoItem>

          {/* Revenue card — 3 cols */}
          <BentoItem span="col-span-12 md:col-span-3" className="bg-gradient-to-br from-brand-orange/10 to-brand-gold/5">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-orange/20 flex items-center justify-center mb-4">
                <Fire className="h-5 w-5 text-brand-orange" weight="fill" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-brand-orange mb-1">Valor total pipeline</div>
              <div className="font-display text-3xl font-black tabular-nums text-gradient-orange">
                <NumberTicker value={totalValor} prefix="$" />
              </div>
              <div className="mt-2 text-[10px] text-neutral-500">
                Cobrado: <span className="font-bold text-brand-green">${cobrado.toLocaleString()}</span>
              </div>
              <div className="mt-1 text-[10px] text-neutral-500">
                Balance: <span className="font-bold text-brand-red">${totalBalance.toLocaleString()}</span>
              </div>
            </div>
          </BentoItem>

          {/* SLA warning — 3 cols */}
          <BentoItem span="col-span-12 md:col-span-3">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-red/10 flex items-center justify-center mb-4">
                <Warning className="h-5 w-5 text-brand-red" weight="duotone" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">SLA vencido</div>
              <div className="font-display text-4xl font-black tabular-nums text-brand-red">
                <NumberTicker value={stats ? stats.sla_vencido : null} />
              </div>
              {stats && stats.sla_vencido > 0 && (
                <div className="mt-2 text-[10px] text-brand-red font-ui uppercase tracking-wider flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-red animate-pulse" />
                  Atención requerida
                </div>
              )}
            </div>
          </BentoItem>

          {/* Bar chart — 8 cols */}
          <BentoItem span="col-span-12 md:col-span-8">
            <div className="relative h-full p-6 flex flex-col">
              <div className="mb-2">
                <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-brand-orange mb-1">Pipeline distribución</div>
                <h3 className="font-display text-xl font-black">Oportunidades por etapa</h3>
              </div>
              <div className="flex-1 min-h-[200px] -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byEtapa}>
                    <XAxis dataKey="etapa" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(87,80,232,0.08)" }}
                      contentStyle={{ borderRadius: 12, border: "1px solid rgba(87,80,232,0.2)", background: "rgba(255,255,255,0.95)", color: "#0A0A12", backdropFilter: "blur(20px)" }}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                      {byEtapa.map((e, i) => (<Cell key={i} fill={e.color} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </BentoItem>

          {/* Pie SLA — 4 cols */}
          <BentoItem span="col-span-12 md:col-span-4">
            <div className="relative h-full p-6 flex flex-col">
              <div className="mb-2">
                <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-brand-orange mb-1">Estado SLA</div>
                <h3 className="font-display text-xl font-black">Distribución</h3>
              </div>
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={bySLA} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={4}>
                      {bySLA.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, background: "rgba(255,255,255,0.95)", border: "1px solid rgba(16,24,40,0.1)", color: "#0A0A12" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                {bySLA.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    <span className="text-neutral-500 truncate">{s.name} {s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </BentoItem>

          {/* En progreso — 3 cols */}
          <BentoItem span="col-span-12 sm:col-span-6 md:col-span-3">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-green/10 flex items-center justify-center mb-4">
                <TrendUp className="h-5 w-5 text-brand-green" weight="duotone" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">En progreso</div>
              <div className="font-display text-4xl font-black tabular-nums text-brand-green">
                <NumberTicker value={stats ? stats.en_progreso : null} />
              </div>
            </div>
          </BentoItem>

          {/* Tareas — 3 cols */}
          <BentoItem span="col-span-12 sm:col-span-6 md:col-span-3">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-gold/10 flex items-center justify-center mb-4">
                <CheckSquare className="h-5 w-5 text-brand-gold" weight="duotone" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">Tareas pendientes</div>
              <div className="font-display text-4xl font-black tabular-nums">
                <NumberTicker value={stats ? stats.tareas_pendientes : null} />
              </div>
            </div>
          </BentoItem>

          {/* Usuarios — 3 cols */}
          <BentoItem span="col-span-12 sm:col-span-6 md:col-span-3">
            <div className="relative h-full p-6 flex flex-col">
              <div className="h-11 w-11 rounded-xl bg-brand-neutral/10 flex items-center justify-center mb-4">
                <UserCheck className="h-5 w-5 text-brand-neutral" weight="duotone" />
              </div>
              <div className="font-ui text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">Usuarios activos</div>
              <div className="font-display text-4xl font-black tabular-nums">
                <NumberTicker value={stats ? stats.usuarios_activos : null} />
              </div>
            </div>
          </BentoItem>

          {/* Phase status — 3 cols */}
          <BentoItem span="col-span-12 sm:col-span-6 md:col-span-3" className="bg-gradient-to-br from-brand-orange/5 to-transparent">
            <div className="relative h-full p-6 flex flex-col justify-center">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-green/10 text-brand-green font-ui text-[9px] uppercase tracking-[0.15em] mb-3 self-start">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-green animate-pulse" />
                All systems go
              </div>
              <div className="font-display font-black text-sm leading-tight">6 fases desplegadas</div>
              <div className="text-[10px] text-neutral-500 mt-1">FastAPI + Whisper + Claude + Jitsi + Socket.IO</div>
            </div>
          </BentoItem>
        </BentoGrid>
      </div>
    </AppShell>
  );
}
