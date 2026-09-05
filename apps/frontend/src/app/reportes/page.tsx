"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Download, FileSpreadsheet, FileText, Sparkles, Users as UsersIcon, TrendingUp, Filter, X, PieChart as PieChartIcon, ExternalLink } from "@/lib/bootstrap-icons";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";
import { DateRangeField } from "@/components/ui/DateField";
import { FancySelect } from "@/components/ui/FancySelect";

type Scope = "mine" | "all";
type Tab = "puntajes" | "asistencia" | "tareas";

interface PorUsuario { user_id: string; nombre: string; foto_perfil_url: string | null; cargo_codigo: string | null; puntos: string; monto_usd: string; negociaciones: number; }
interface PorTramite { tramite_id: string; tramite_nombre: string; tramite_codigo: string; cantidad: number; puntos: string; monto_usd: string; }
interface Totales { total_puntos: string; total_usd: string; negociaciones: number; }

export default function ReportesPage() {
  const { isAdmin } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("puntajes");
  const [scope, setScope] = useState<Scope>("all");
  const [area, setArea] = useState<"ventas" | "preparacion" | "todos">("ventas");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [userId, setUserId] = useState("");
  const [totales, setTotales] = useState<Totales | null>(null);
  const [porUsuario, setPorUsuario] = useState<PorUsuario[]>([]);
  const [porTramite, setPorTramite] = useState<PorTramite[]>([]);
  const [detalle, setDetalle] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/chat/contactos").then((r) => r.json()).then((d) => setUsuarios(d.contactos || []));
  }, []);

  const buildQs = useCallback(() => {
    const qs = new URLSearchParams();
    qs.set("scope", scope);
    qs.set("area", area);
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);
    if (userId) qs.set("user_id", userId);
    return qs.toString();
  }, [scope, area, desde, hasta, userId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/reportes/puntajes?${buildQs()}`);
      if (!r.ok) {
        if (r.status === 403) { setScope("mine"); toast.error("Sin permiso para ver todo el equipo"); return; }
        throw new Error("Error cargando reportes");
      }
      const d = await r.json();
      setTotales(d.totales);
      setPorUsuario(d.por_usuario || []);
      setPorTramite(d.por_tramite || []);
      setDetalle(d.detalle || []);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }, [buildQs]);

  useEffect(() => { if (tab === "puntajes") load(); }, [tab, load]);

  const maxPuntos = useMemo(() => Math.max(1, ...porTramite.map((t) => Number(t.puntos || 0))), [porTramite]);

  const exportFile = (fmt: "xlsx" | "pdf") => {
    const url = `/api/reportes/puntajes/export.${fmt}?${buildQs()}`;
    window.open(url, "_blank");
  };

  const clearFilters = () => { setDesde(""); setHasta(""); setUserId(""); };
  const hasFilters = desde || hasta || userId;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.12em] mb-3">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              Análisis
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-black leading-tight tracking-tight">
              <span className="text-gradient-orange">Reportes</span>
            </h1>
            <p className="mt-3 text-neutral-500 text-[15px]">
              Puntajes, asistencia y rendimiento del equipo.
            </p>
          </div>
          {tab === "puntajes" && (
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => exportFile("xlsx")}
                className="h-11 px-5 rounded-2xl bg-brand-green text-white font-ui text-[11px] font-bold uppercase tracking-[0.1em] shadow-lg shadow-green-500/25 hover:shadow-xl flex items-center gap-2 transition-shadow"
              >
                <FileSpreadsheet className="h-4 w-4" strokeWidth={2} />
                Excel
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => exportFile("pdf")}
                className="h-11 px-5 rounded-2xl bg-brand-red text-white font-ui text-[11px] font-bold uppercase tracking-[0.1em] shadow-lg shadow-red-500/25 hover:shadow-xl flex items-center gap-2 transition-shadow"
              >
                <FileText className="h-4 w-4" strokeWidth={2} />
                PDF
              </motion.button>
            </div>
          )}
        </motion.div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 mb-5 w-fit">
          {(["puntajes", "asistencia", "tareas"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-9 px-4 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition-all",
                tab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "puntajes" && (
          <>
            {/* Filter bar */}
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="bg-white rounded-2xl border border-neutral-100 p-3 mb-5 flex items-center gap-2 flex-wrap shadow-sm"
            >
              <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100">
                <button onClick={() => setScope("mine")} className={cn("h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", scope === "mine" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>
                  Míos
                </button>
                <button onClick={() => setScope("all")} className={cn("h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", scope === "all" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>
                  Todos
                </button>
              </div>
              <div className="w-px h-7 bg-neutral-200 mx-1" />
              {/* Área: separa reportes de Ventas vs Preparación */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100">
                {([["ventas", "Ventas"], ["preparacion", "Preparación"], ["todos", "Todos"]] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => setArea(val)}
                    className={cn(
                      "h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition",
                      area === val ? "bg-white text-brand-orange shadow-sm" : "text-neutral-500"
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="w-px h-7 bg-neutral-200 mx-1" />
              <DateRangeField
                desde={desde}
                hasta={hasta}
                onChange={(d, h) => { setDesde(d); setHasta(h); }}
              />
              {isAdmin && (
                <FancySelect
                  value={userId}
                  onChange={(v) => { setUserId(v); if (v) setScope("all"); }}
                  options={usuarios.map((u: any) => ({
                    value: String(u.id),
                    label: u.nombre,
                    sub: u.email,
                    avatar: u.foto_perfil_url,
                    initials: u.nombre ? initialsOf(u.nombre) : "??"
                  }))}
                  placeholder="Todos los usuarios"
                  label="Usuario"
                  icon={UsersIcon}
                  width={280}
                />
              )}
              <button onClick={load} className="h-9 px-4 rounded-xl bg-brand-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-brand-gold transition-colors">
                Aplicar
              </button>
              {hasFilters && (
                <button onClick={clearFilters} className="h-9 px-3 rounded-xl text-[10px] font-ui font-bold uppercase tracking-wider text-brand-red hover:bg-red-50 flex items-center gap-1">
                  <X className="h-3 w-3" /> Limpiar
                </button>
              )}
            </motion.div>

            {/* Encabezado del área activa */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-ui uppercase tracking-wider text-neutral-400">Reporte de</span>
              <span className="text-base font-display font-black text-brand-orange">
                {area === "ventas" ? "Ventas" : area === "preparacion" ? "Preparación" : "Todos los puntos"}
              </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <StatCard icon={TrendingUp} label="Total puntos" value={totales ? Number(totales.total_puntos).toFixed(2) : "—"} color="#5750E8" />
              <StatCard icon={UsersIcon} label="Negociaciones" value={totales ? String(totales.negociaciones) : "—"} color="#2196C9" />
            </div>

            {/* Donas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <DonaCard title="Distribución por usuario" icon={UsersIcon} data={porUsuario.map((u) => ({ name: u.nombre, value: Number(u.puntos) }))} />
              <DonaCard title="Distribución por tipo de trámite" icon={PieChartIcon} data={porTramite.map((t) => ({ name: t.tramite_nombre || "Sin trámite", value: Number(t.puntos) }))} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Por usuario */}
              <div className="bg-white rounded-2xl border border-neutral-100 p-5">
                <h3 className="font-display font-black text-base mb-4 flex items-center gap-2">
                  <UsersIcon className="h-4 w-4 text-brand-orange" strokeWidth={2} />
                  Puntos por usuario
                </h3>
                {loading ? (
                  <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg skeleton bg-neutral-100" />)}</div>
                ) : porUsuario.length === 0 ? (
                  <div className="text-center text-[12px] text-neutral-400 py-6">Sin datos en el rango seleccionado</div>
                ) : (
                  <div className="space-y-1.5">
                    {porUsuario.map((u) => (
                      <motion.div
                        key={u.user_id + (u.cargo_codigo || "")}
                        initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors"
                      >
                        {u.foto_perfil_url
                          ? <img src={u.foto_perfil_url} className="h-8 w-8 rounded-full object-cover" alt="" />
                          : <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[10px] font-bold flex items-center justify-center">{initialsOf(u.nombre)}</div>
                        }
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{u.nombre}</div>
                          {u.cargo_codigo && <div className="text-[10px] text-neutral-400 uppercase tracking-wider">{u.cargo_codigo.replace(/_/g, " ")}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-brand-orange">{Number(u.puntos).toFixed(2)}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Por trámite - con barras */}
              <div className="bg-white rounded-2xl border border-neutral-100 p-5">
                <h3 className="font-display font-black text-base mb-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-brand-orange" strokeWidth={2} />
                  Puntos por tipo de trámite
                </h3>
                {loading ? (
                  <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-lg skeleton bg-neutral-100" />)}</div>
                ) : porTramite.length === 0 ? (
                  <div className="text-center text-[12px] text-neutral-400 py-6">Sin datos</div>
                ) : (
                  <div className="space-y-2">
                    {porTramite.map((t, i) => (
                      <motion.div
                        key={t.tramite_id || i}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 * i }}
                        className="group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-sm font-semibold truncate">{t.tramite_nombre || "Sin trámite"}</div>
                          <div className="flex items-center gap-2 text-[11px] text-neutral-500 shrink-0">
                            <span className="font-bold text-neutral-700">{Number(t.puntos).toFixed(2)} pts</span>
                            <span>· {t.cantidad}</span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(Number(t.puntos) / maxPuntos) * 100}%` }}
                            transition={{ delay: 0.05 * i, type: "spring", stiffness: 120, damping: 22 }}
                            className="h-full bg-gradient-to-r from-brand-orange to-brand-gold"
                          />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Detalle */}
            <div className="bg-white rounded-2xl border border-neutral-100 p-5 mt-4 overflow-hidden">
              <h3 className="font-display font-black text-base mb-4">Detalle ({detalle.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500 font-ui">
                      <th className="pb-2 font-semibold">Negociación</th>
                      <th className="pb-2 font-semibold">Trámite</th>
                      <th className="pb-2 font-semibold">Usuario</th>
                      <th className="pb-2 font-semibold">Cargo</th>
                      <th className="pb-2 font-semibold text-right">Puntos</th>
                      <th className="pb-2 font-semibold">Creación</th>
                      <th className="pb-2 font-semibold">Ganado</th>
                      <th className="pb-2 font-semibold text-right">Oportunidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.map((d) => (
                      <tr key={d.id} className="border-b border-neutral-50 hover:bg-neutral-50 transition-colors">
                        <td className="py-2">{d.nombre_caso}</td>
                        <td className="py-2 text-neutral-500">{d.tramite_nombre || "—"}</td>
                        <td className="py-2">{d.usuario_nombre}</td>
                        <td className="py-2 text-[11px] text-neutral-500 uppercase tracking-wider">{d.cargo_codigo?.replace(/_/g, " ") || "—"}</td>
                        <td className="py-2 text-right font-bold">{Number(d.puntos).toFixed(2)}</td>
                        <td className="py-2 text-[11px] text-neutral-500">{d.fecha_creacion_oportunidad ? new Date(d.fecha_creacion_oportunidad).toLocaleDateString("es") : "—"}</td>
                        <td className="py-2 text-[11px] text-neutral-500">{d.fecha ? new Date(d.fecha).toLocaleDateString("es") : "—"}</td>
                        <td className="py-2 text-right">
                          {d.oportunidad_id && (
                            <a
                              href={`/oportunidades/${d.oportunidad_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-orange/10 text-brand-orange text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/20 transition-colors whitespace-nowrap"
                            >
                              <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                              Ver
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === "asistencia" && <AsistenciaTab isAdmin={isAdmin} />}
        {tab === "tareas" && <TareasTab isAdmin={isAdmin} />}
      </div>
    </AppShell>
  );
}

const PALETTE = ["#5750E8", "#FFB51C", "#43A847", "#2196C9", "#E53935", "#8338EC", "#06FFA5", "#FF006E", "#3A86FF", "#FB5607", "#9D174D", "#0EA5E9"];

function DonaCard({ title, icon: Icon, data }: { title: string; icon: any; data: { name: string; value: number }[] }) {
  const filtered = data.filter((d) => d.value > 0);
  const total = filtered.reduce((s, d) => s + d.value, 0);

  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl border border-neutral-100 p-5">
      <h3 className="font-display font-black text-base mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-orange" strokeWidth={2} />
        {title}
      </h3>
      {filtered.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-[12px] text-neutral-400">Sin datos</div>
      ) : (
        <div className="h-[240px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={filtered}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                animationBegin={0}
                animationDuration={700}
              >
                {filtered.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth={2} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#0F172A", border: "none", borderRadius: 12, fontSize: 12, color: "#fff" }}
                formatter={(v: any) => [`${Number(v).toFixed(2)} pts`, ""]}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 11 }}
                verticalAlign="bottom"
                height={36}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center" style={{ paddingBottom: 36 }}>
            <div className="text-center">
              <div className="text-2xl font-black font-display leading-none text-neutral-900">{total.toFixed(1)}</div>
              <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-400 mt-0.5">Total pts</div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <motion.div whileHover={{ y: -2 }} className="bg-white rounded-2xl border border-neutral-100 p-4 flex items-center gap-3 transition-shadow hover:shadow-md">
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15`, color }}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <div>
        <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">{label}</div>
        <div className="text-2xl font-black font-display leading-none mt-0.5" style={{ color }}>{value}</div>
      </div>
    </motion.div>
  );
}

function AsistenciaTab({ isAdmin }: { isAdmin: boolean }) {
  const [scope, setScope] = useState<Scope>(isAdmin ? "all" : "mine");
  const [userId, setUserId] = useState("");
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [resumen, setResumen] = useState<any | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/chat/contactos").then((r) => r.json()).then((d) => setUsuarios(d.contactos || []));
  }, [isAdmin]);

  const buildQs = useCallback(() => {
    const qs = new URLSearchParams({ scope });
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);
    if (userId) qs.set("user_id", userId);
    return qs.toString();
  }, [scope, desde, hasta, userId]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reportes/asistencia?${buildQs()}`)
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries || []);
        setResumen(d.resumen || null);
      })
      .finally(() => setLoading(false));
  }, [buildQs]);

  const fmtMin = (n: number) => {
    if (!n) return "0m";
    const h = Math.floor(n / 60);
    const m = n % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const setPreset = (days: number) => {
    const to = new Date();
    const from = new Date(Date.now() - days * 86400000);
    setDesde(from.toISOString().slice(0, 10));
    setHasta(to.toISOString().slice(0, 10));
  };

  const exportFile = (fmt: "xlsx" | "pdf") => {
    window.open(`/api/reportes/asistencia/export.${fmt}?${buildQs()}`, "_blank");
  };

  return (
    <div className="space-y-4">
      {/* Header con export buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-lg font-black text-neutral-900">Reporte de asistencia</h2>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => exportFile("xlsx")}
            className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-[11px] font-ui font-bold uppercase tracking-wider shadow-md hover:shadow-lg flex items-center gap-1.5"
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => exportFile("pdf")}
            className="h-10 px-4 rounded-xl bg-red-600 text-white text-[11px] font-ui font-bold uppercase tracking-wider shadow-md hover:shadow-lg flex items-center gap-1.5"
          >
            <FileText className="h-4 w-4" /> PDF
          </motion.button>
        </div>
      </div>

      {/* Filter bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-neutral-100 p-3 flex items-center gap-2 flex-wrap shadow-sm"
      >
        <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100">
          <button onClick={() => { setScope("mine"); setUserId(""); }} className={cn("h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", scope === "mine" && !userId ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>Mío</button>
          {isAdmin && <button onClick={() => { setScope("all"); setUserId(""); }} className={cn("h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", scope === "all" && !userId ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>Todos</button>}
        </div>
        <div className="w-px h-7 bg-neutral-200 mx-1" />
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setPreset(d)}
            className="h-9 px-3 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-neutral-100 text-neutral-600"
          >
            {d}d
          </button>
        ))}
        <DateRangeField desde={desde} hasta={hasta} onChange={(d, h) => { setDesde(d); setHasta(h); }} />
        {isAdmin && (
          <FancySelect
            value={userId}
            onChange={(v) => { setUserId(v); if (v) setScope("all"); }}
            options={usuarios.map((u: any) => ({
              value: String(u.id),
              label: u.nombre,
              sub: u.email,
              avatar: u.foto_perfil_url,
              initials: u.nombre ? initialsOf(u.nombre) : "??"
            }))}
            placeholder="Todos los usuarios"
            label="Usuario"
            icon={UsersIcon}
            width={280}
          />
        )}
      </motion.div>

      {/* Stats cards */}
      {resumen && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={UsersIcon} label="Días registrados" value={String(resumen.total_dias)} color="#2196C9" />
          <StatCard icon={TrendingUp} label="Horas trabajadas" value={`${resumen.horas_totales}h`} color="#43A847" />
          <StatCard icon={BarChart3} label="Días tarde" value={String(resumen.dias_tarde)} color="#E53935" />
          <StatCard icon={Sparkles} label="Puntualidad" value={`${resumen.puntualidad_pct}%`} color="#5750E8" />
          <StatCard icon={PieChartIcon} label="Sesiones activas" value={String(resumen.dias_activos)} color="#8338EC" />
        </div>
      )}

      {/* Tabla con cards mejoradas */}
      <div className="bg-white rounded-2xl border border-neutral-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
          <h3 className="font-display font-black text-sm">Detalle de asistencia ({entries.length})</h3>
        </div>
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-lg bg-neutral-100" />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-neutral-400 text-sm">Sin registros en el período</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {entries.map((e) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="px-5 py-3 flex items-center gap-4 hover:bg-neutral-50/50 transition-colors"
              >
                {/* Foto + nombre */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {e.foto_perfil_url
                    ? <img src={e.foto_perfil_url} className="h-10 w-10 rounded-full object-cover" alt="" />
                    : <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[11px] font-bold flex items-center justify-center shrink-0">{initialsOf(e.nombre)}</div>}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{e.nombre}</div>
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
                      {new Date(e.fecha_local).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  </div>
                </div>

                {/* Entrada / Salida */}
                <div className="flex items-center gap-4 text-center shrink-0">
                  <div>
                    <div className="text-[9px] text-neutral-400 uppercase tracking-wider">Entrada</div>
                    <div className="text-sm font-bold tabular-nums">
                      {e.entrada_at ? new Date(e.entrada_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </div>
                  </div>
                  <div className="h-6 w-px bg-neutral-200" />
                  <div>
                    <div className="text-[9px] text-neutral-400 uppercase tracking-wider">Salida</div>
                    <div className={cn("text-sm font-bold tabular-nums", e.activo && "text-emerald-600")}>
                      {e.salida_at ? new Date(e.salida_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "● Activo"}
                    </div>
                  </div>
                </div>

                {/* Trabajado */}
                <div className="text-center shrink-0 min-w-[80px]">
                  <div className="text-[9px] text-neutral-400 uppercase tracking-wider">Trabajado</div>
                  <div className="text-sm font-bold tabular-nums text-neutral-900">{fmtMin(e.minutos_totales || 0)}</div>
                  {e.minutos_break > 0 && (
                    <div className="text-[9px] text-neutral-400">+{e.minutos_break}m break</div>
                  )}
                </div>

                {/* Puntualidad */}
                <div className="shrink-0">
                  {e.fue_tarde ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 text-red-700 text-[11px] font-bold">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      {fmtMin(e.minutos_tarde || 0)} tarde
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      A tiempo
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TareasTab({ isAdmin }: { isAdmin: boolean }) {
  const [scope, setScope] = useState<Scope>(isAdmin ? "all" : "mine");
  const [userId, setUserId] = useState("");
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/chat/contactos").then((r) => r.json()).then((d) => setUsuarios(d.contactos || []));
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ scope });
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      if (userId) qs.set("user_id", userId);
      const r = await fetch(`/api/reportes/tareas?${qs.toString()}`);
      if (!r.ok) {
        if (r.status === 403) { setScope("mine"); toast.error("Sin permiso"); return; }
        throw new Error("Error");
      }
      setData(await r.json());
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }, [scope, desde, hasta, userId]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totales || {};
  const PRIORIDAD_COLORS: Record<string, string> = {
    urgente: "#E53935",
    alta: "#5750E8",
    normal: "#2196C9",
    baja: "#9CA3AF",
  };
  const ESTADO_COLORS: Record<string, string> = {
    pendiente: "#9CA3AF",
    en_progreso: "#2196C9",
    completada: "#43A847",
    cancelada: "#6B7280",
  };

  const tendencia: { fecha: string; creadas: number; completadas: number }[] = data?.tendencia || [];
  const maxTend = Math.max(1, ...tendencia.flatMap((d) => [d.creadas, d.completadas]));

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-neutral-100 p-3 flex items-center gap-2 flex-wrap shadow-sm"
      >
        <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100">
          <button onClick={() => setScope("mine")} className={cn("h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", scope === "mine" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>
            Míos
          </button>
          {isAdmin && (
            <button onClick={() => setScope("all")} className={cn("h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", scope === "all" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}>
              Todos
            </button>
          )}
        </div>
        <div className="w-px h-7 bg-neutral-200 mx-1" />
        <DateRangeField desde={desde} hasta={hasta} onChange={(d, h) => { setDesde(d); setHasta(h); }} />
        {isAdmin && (
          <FancySelect
            value={userId}
            onChange={(v) => { setUserId(v); if (v) setScope("all"); }}
            options={usuarios.map((u: any) => ({
              value: String(u.id),
              label: u.nombre,
              sub: u.email,
              avatar: u.foto_perfil_url,
              initials: u.nombre ? initialsOf(u.nombre) : "??"
            }))}
            placeholder="Todos los usuarios"
            label="Usuario"
            icon={UsersIcon}
            width={280}
          />
        )}
      </motion.div>

      {/* Stats top */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={BarChart3} label="Total tareas" value={t.total ?? "—"} color="#2196C9" />
        <StatCard icon={TrendingUp} label="Pendientes" value={(t.pendientes ?? 0) + (t.en_progreso ?? 0)} color="#5750E8" />
        <StatCard icon={Sparkles} label="Completadas (mes)" value={t.completadas_mes ?? "—"} color="#43A847" />
        <StatCard icon={X} label="Vencidas" value={t.vencidas ?? "—"} color="#E53935" />
      </div>

      {/* Distribuciones por estado + prioridad */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-100 p-5">
          <h3 className="font-display font-black text-base mb-4 flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-brand-orange" /> Por estado
          </h3>
          {loading ? (
            <div className="h-[200px] skeleton rounded-lg bg-neutral-100" />
          ) : data?.por_estado?.length ? (
            <div className="space-y-2">
              {data.por_estado.map((row: any) => {
                const pct = t.total > 0 ? Math.round((row.cantidad / t.total) * 100) : 0;
                return (
                  <div key={row.estado}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold capitalize">{row.estado.replace("_", " ")}</span>
                      <span className="text-neutral-500 tabular-nums">{row.cantidad} · {pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: pct + "%" }}
                        transition={{ type: "spring", stiffness: 120, damping: 22 }}
                        className="h-full rounded-full"
                        style={{ background: ESTADO_COLORS[row.estado] || "#9CA3AF" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-neutral-400 text-xs py-8">Sin tareas</div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-100 p-5">
          <h3 className="font-display font-black text-base mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-brand-orange" /> Por prioridad
          </h3>
          {loading ? (
            <div className="h-[200px] skeleton rounded-lg bg-neutral-100" />
          ) : data?.por_prioridad?.length ? (
            <div className="space-y-2">
              {data.por_prioridad.map((row: any) => {
                const pct = t.total > 0 ? Math.round((row.cantidad / t.total) * 100) : 0;
                return (
                  <div key={row.prioridad}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold capitalize flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: PRIORIDAD_COLORS[row.prioridad] || "#9CA3AF" }} />
                        {row.prioridad}
                      </span>
                      <span className="text-neutral-500 tabular-nums">{row.cantidad} · {pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: pct + "%" }}
                        transition={{ type: "spring", stiffness: 120, damping: 22 }}
                        className="h-full rounded-full"
                        style={{ background: PRIORIDAD_COLORS[row.prioridad] || "#9CA3AF" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-neutral-400 text-xs py-8">Sin datos</div>
          )}
        </div>
      </div>

      {/* Tendencia 30 días */}
      <div className="bg-white rounded-2xl border border-neutral-100 p-5">
        <h3 className="font-display font-black text-base mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand-orange" /> Tendencia (últimos 30 días)
        </h3>
        {loading ? (
          <div className="h-[160px] skeleton rounded-lg bg-neutral-100" />
        ) : tendencia.length === 0 ? (
          <div className="text-center text-neutral-400 text-xs py-8">Sin tareas en el período</div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-2 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-brand-orange" /> Creadas</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-emerald-500" /> Completadas</span>
            </div>
            <div className="flex items-end gap-1 h-[140px]">
              {tendencia.map((d) => {
                const hCre = (d.creadas / maxTend) * 100;
                const hCom = (d.completadas / maxTend) * 100;
                return (
                  <div key={d.fecha} className="flex-1 flex flex-col justify-end gap-0.5 group relative">
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-10">
                      {d.fecha}: {d.creadas} creadas, {d.completadas} completadas
                    </div>
                    <div className="flex gap-0.5 items-end h-full">
                      <div className="flex-1 bg-brand-orange/80 rounded-t" style={{ height: hCre + "%", minHeight: d.creadas > 0 ? 2 : 0 }} />
                      <div className="flex-1 bg-emerald-500/80 rounded-t" style={{ height: hCom + "%", minHeight: d.completadas > 0 ? 2 : 0 }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
              <span>{tendencia[0]?.fecha}</span>
              <span>{tendencia[tendencia.length - 1]?.fecha}</span>
            </div>
          </>
        )}
      </div>

      {/* Top responsables */}
      <div className="bg-white rounded-2xl border border-neutral-100 p-5">
        <h3 className="font-display font-black text-base mb-4 flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-brand-orange" /> Tareas por responsable
        </h3>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 skeleton rounded-lg bg-neutral-100" />)}</div>
        ) : data?.por_responsable?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500 font-ui">
                  <th className="pb-2">Usuario</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2 text-right">Pendientes</th>
                  <th className="pb-2 text-right">En progreso</th>
                  <th className="pb-2 text-right">Completadas</th>
                  <th className="pb-2 text-right">Vencidas</th>
                </tr>
              </thead>
              <tbody>
                {data.por_responsable.map((u: any) => (
                  <tr key={u.user_id} className="border-b border-neutral-50 hover:bg-neutral-50">
                    <td className="py-2.5 flex items-center gap-2">
                      {u.foto_perfil_url
                        ? <img src={u.foto_perfil_url} className="h-7 w-7 rounded-full object-cover" alt="" />
                        : <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[10px] font-bold flex items-center justify-center">{initialsOf(u.nombre)}</div>}
                      <span className="font-semibold">{u.nombre}</span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-bold">{u.total}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-500">{u.pendientes}</td>
                    <td className="py-2.5 text-right tabular-nums text-blue-600">{u.en_progreso}</td>
                    <td className="py-2.5 text-right tabular-nums text-emerald-600">{u.completadas}</td>
                    <td className={cn("py-2.5 text-right tabular-nums font-bold", u.vencidas > 0 ? "text-red-600" : "text-neutral-400")}>{u.vencidas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-neutral-400 text-xs py-8">Sin datos</div>
        )}
      </div>

      {/* Vencidas */}
      {data?.vencidas?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="font-display font-black text-base mb-4 flex items-center gap-2 text-red-700">
            <X className="h-4 w-4" /> Tareas vencidas ({data.vencidas.length})
          </h3>
          <div className="space-y-1.5">
            {data.vencidas.map((v: any) => (
              <a key={v.id} href={`/tareas/${v.id}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-white hover:bg-red-100/50 transition border border-red-100">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{v.titulo}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">
                    {v.responsable_nombre || "Sin responsable"} · vence {new Date(v.fecha_limite).toLocaleDateString("es")}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold tabular-nums">
                  {Math.round(v.dias_vencida)}d vencida
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


