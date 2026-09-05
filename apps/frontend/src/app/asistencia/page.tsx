"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Play, Coffee, LogOut, AlertTriangle, Trophy, Flame, Calendar, ChevronDown, Settings, Users, Loader2, Search } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { getSocket } from "@/lib/socket";

interface Entry {
  id: string;
  entrada_at: string;
  salida_at: string | null;
  fue_tarde: boolean | null;
  minutos_tarde: number;
  minutos_totales: number | null;
  minutos_break: number | null;
  fecha_local: string;
  total_break_min: number;
}

function fmtDur(m: number) {
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function hhmm(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export default function AsistenciaPage() {
  const [tab, setTab] = useState<"mia" | "equipo">("mia");
  const [me, setMe] = useState<any>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {});
  }, []);

  const isAdmin = me?.nivel_acceso === "super_admin" || me?.nivel_acceso === "admin";

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-2">
            <Clock className="h-3.5 w-3.5" />
            Asistencia
          </div>
          <h1 className="font-display text-4xl font-black leading-tight">
            <span className="text-gradient-orange">Mi jornada</span>
          </h1>
        </motion.div>

        {isAdmin && (
          <div className="flex items-center gap-2 mb-6">
            <button onClick={() => setTab("mia")} className={`h-9 px-4 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider transition ${tab === "mia" ? "bg-brand-orange text-white shadow-glow" : "bg-white border border-black/10 hover:bg-black/5"}`}>
              Mi jornada
            </button>
            <button onClick={() => setTab("equipo")} className={`h-9 px-4 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider transition ${tab === "equipo" ? "bg-brand-orange text-white shadow-glow" : "bg-white border border-black/10 hover:bg-black/5"}`}>
              Equipo
            </button>
          </div>
        )}

        {tab === "mia" ? <MiJornada /> : <EquipoVista />}
      </div>
    </AppShell>
  );
}

function MiJornada() {
  const [status, setStatus] = useState<any | null>(null);
  const [semana, setSemana] = useState<{ entries: Entry[]; schedule: any; racha: number; logros: any[] } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    const [st, sem] = await Promise.all([
      fetch("/api/clock/status").then((r) => r.json()),
      fetch("/api/clock/mi-semana").then((r) => r.json()),
    ]);
    setStatus(st); setSemana(sem);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    try {
      const s = getSocket();
      s?.on("clock:break-excedido", (p: any) => toast.error(`Break excedido por ${p.minutos - p.max} min`, { duration: 8000 }));
    } catch {}
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  const clockIn = async () => {
    const r = await fetch("/api/clock/in", { method: "POST" });
    const d = await r.json();
    if (!r.ok) return toast.error(d.error);
    if (d.tarde) toast.warning(`Llegaste ${d.minutos_tarde} min tarde`);
    else toast.success("Clock in registrado");
    load();
  };
  const clockOut = async () => {
    if (!confirm("¿Terminar tu jornada?")) return;
    const r = await fetch("/api/clock/out", { method: "POST" });
    if (r.ok) { toast.success("Jornada cerrada"); load(); }
  };
  const breakToggle = async () => {
    const breaking = !!status?.break_activo;
    const r = await fetch(breaking ? "/api/clock/break/end" : "/api/clock/break/start", { method: "POST" });
    if (r.ok) { toast.info(breaking ? "Break terminado" : "Break iniciado"); load(); }
  };

  const entry = status?.entry;
  const brk = status?.break_activo;
  const maxBreak = status?.schedule?.break_minutos_max || 60;
  const workedMin = entry ? Math.max(0, Math.floor((now - new Date(entry.entrada_at).getTime()) / 60000)) : 0;
  const breakElapsedSec = brk ? Math.max(0, Math.floor((now - new Date(brk.inicio_at).getTime()) / 1000)) : 0;
  const breakMin = Math.floor(breakElapsedSec / 60);
  const breakRemainingSec = brk ? Math.max(0, maxBreak * 60 - breakElapsedSec) : 0;
  const breakExcedido = brk && breakElapsedSec > maxBreak * 60;
  // Tier de animación según segundos restantes
  const breakTier: "normal" | "warning" | "danger" | "expired" =
    !brk ? "normal"
      : breakRemainingSec <= 0 ? "expired"
      : breakRemainingSec <= 10 ? "danger"
      : breakRemainingSec <= 60 ? "warning"
      : "normal";
  const breakRemainMM = String(Math.floor(breakRemainingSec / 60)).padStart(2, "0");
  const breakRemainSS = String(breakRemainingSec % 60).padStart(2, "0");

  const tz = status?.schedule?.zona_horaria || "America/New_York";
  const nowLocal = new Date().toLocaleTimeString("es", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-3xl p-8 bg-gradient-to-br from-brand-orange via-[#FFA540] to-[#FFB51C] text-white shadow-glow-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.2),transparent_60%)] pointer-events-none" />
        <div className="relative">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="text-[11px] font-ui uppercase tracking-wider opacity-80 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" /> Hora local <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[10px] font-bold">{tz.split("/")[1]}</span>
              </div>
              <div className="font-display text-6xl font-black leading-none tabular-nums mt-1">{nowLocal}</div>
              <div className="text-sm opacity-90 mt-2">
                {entry ? (
                  <>Entrada {hhmm(entry.entrada_at)} · Trabajado <span className="font-bold tabular-nums">{fmtDur(workedMin)}</span></>
                ) : "Aún no has marcado entrada"}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {!entry && (
                <button onClick={clockIn} className="h-14 px-6 rounded-2xl bg-white text-brand-green font-display font-black shadow-xl hover:scale-105 transition flex items-center gap-2">
                  <Play className="h-5 w-5" fill="currentColor" /> Clock in
                </button>
              )}
              {entry && (
                <>
                  <button
                    onClick={breakToggle}
                    className={`h-14 px-6 rounded-2xl font-display font-black shadow-xl hover:scale-105 transition flex items-center gap-2 ${
                      brk
                        ? breakTier === "danger"
                          ? "bg-red-600 text-white animate-pulse"
                          : breakTier === "warning"
                          ? "bg-amber-500 text-white"
                          : breakTier === "expired"
                          ? "bg-red-700 text-white animate-pulse"
                          : "bg-white text-yellow-700"
                        : "bg-white text-yellow-700"
                    }`}
                  >
                    <Coffee className="h-5 w-5" />
                    {brk ? (
                      <span className="flex flex-col items-start leading-tight">
                        <span className="text-[10px] font-ui uppercase tracking-wider opacity-80">{breakTier === "expired" ? "Excedido" : "Termina en"}</span>
                        <span className="text-2xl tabular-nums">{breakRemainMM}:{breakRemainSS}</span>
                      </span>
                    ) : "Break"}
                  </button>
                  <button onClick={clockOut} className="h-14 px-6 rounded-2xl bg-red-600 text-white font-display font-black shadow-xl hover:scale-105 transition flex items-center gap-2">
                    <LogOut className="h-5 w-5" /> Clock out
                  </button>
                </>
              )}
            </div>
          </div>
          {entry?.fue_tarde && (
            <div className="mt-4 px-4 py-2 rounded-xl bg-amber-500/30 text-white text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Llegaste {entry.minutos_tarde} minutos tarde hoy
            </div>
          )}
          {brk && (breakTier === "danger" || breakTier === "expired") && (
            <motion.div
              key={breakRemainingSec}
              initial={{ scale: 0.9, opacity: 0.7 }}
              animate={{ scale: [1, 1.08, 1], opacity: 1 }}
              transition={{ duration: 0.5 }}
              className={`mt-4 px-6 py-4 rounded-2xl text-white text-center shadow-2xl ${
                breakTier === "expired" ? "bg-red-700" : "bg-red-600"
              }`}
            >
              <div className="text-[10px] font-ui uppercase tracking-[0.2em] opacity-80">
                {breakTier === "expired" ? "Break excedido — termina ya" : "Faltan"}
              </div>
              <div className="font-display text-6xl font-black tabular-nums leading-none mt-1">
                {breakTier === "expired" ? `+${Math.floor((breakElapsedSec - maxBreak * 60) / 60)}m ${(breakElapsedSec - maxBreak * 60) % 60}s` : `${breakRemainSS}s`}
              </div>
              <div className="text-[11px] opacity-80 mt-1">
                {breakTier === "expired" ? `Excediste ${maxBreak}min` : "Vuelve antes que el contador llegue a 0"}
              </div>
            </motion.div>
          )}
          {brk && breakTier === "warning" && (
            <div className="mt-4 px-4 py-2 rounded-xl bg-amber-500/40 text-white text-sm flex items-center gap-2 backdrop-blur">
              <Coffee className="h-4 w-4" /> Te quedan {breakRemainMM}:{breakRemainSS} de break (máx {maxBreak}min)
            </div>
          )}
          {breakExcedido && breakTier !== "expired" && (
            <div className="mt-4 px-4 py-2 rounded-xl bg-red-600 text-white text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Tu break superó el límite de {maxBreak}min
            </div>
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 text-brand-orange font-ui text-[11px] uppercase tracking-wider mb-2">
            <Flame className="h-3.5 w-3.5" /> Racha puntualidad
          </div>
          <div className="font-display text-4xl font-black tabular-nums">{semana?.racha || 0}</div>
          <div className="text-xs text-neutral-500">días llegando a tiempo</div>
          {semana && semana.racha >= 5 && <div className="mt-2 text-2xl">🔥🔥🔥</div>}
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 text-brand-blue font-ui text-[11px] uppercase tracking-wider mb-2">
            <Calendar className="h-3.5 w-3.5" /> Mi horario
          </div>
          <div className="font-display text-2xl font-black">{semana?.schedule?.hora_entrada || "—"}</div>
          <div className="text-xs text-neutral-500 mt-1">
            Tolerancia {semana?.schedule?.tolerancia_minutos || 0} min · Break max {semana?.schedule?.break_minutos_max || 60} min
            {semana?.schedule?.estricto === false && <span className="ml-1 text-brand-orange font-bold">(flex)</span>}
          </div>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 text-brand-green font-ui text-[11px] uppercase tracking-wider mb-2">
            <Trophy className="h-3.5 w-3.5" /> Mis logros
          </div>
          {semana && semana.logros.length === 0 ? (
            <div className="text-xs text-neutral-500 italic">Aún sin medallas esta temporada</div>
          ) : (
            <div className="space-y-1">
              {(semana?.logros || []).slice(0, 3).map((l: any, i: number) => (
                <div key={i} className="text-xs">
                  🏅 {l.tipo.replace(/_/g, " ")} · <span className="text-neutral-400">sem {l.semana_inicio}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <h3 className="font-display text-xl font-black mb-4">Historial reciente</h3>
        {(semana?.entries || []).length === 0 ? (
          <div className="text-sm text-neutral-500">Sin registros todavía</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5 text-[10px] font-ui uppercase tracking-wider text-neutral-400">
                <th className="text-left pb-2 font-bold">Fecha</th>
                <th className="text-left pb-2 font-bold">Entrada</th>
                <th className="text-left pb-2 font-bold">Salida</th>
                <th className="text-right pb-2 font-bold">Trabajado</th>
                <th className="text-right pb-2 font-bold">Break</th>
                <th className="text-right pb-2 font-bold">Puntualidad</th>
              </tr>
            </thead>
            <tbody>
              {(semana!.entries).map((e) => (
                <tr key={e.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                  <td className="py-2">{new Date(e.fecha_local).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" })}</td>
                  <td className="py-2">{hhmm(e.entrada_at)}</td>
                  <td className="py-2">{hhmm(e.salida_at)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtDur(e.minutos_totales || 0)}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-500">{fmtDur(e.total_break_min || 0)}</td>
                  <td className="py-2 text-right">
                    {e.fue_tarde ? (
                      <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-brand-red">{e.minutos_tarde}m tarde</span>
                    ) : e.fue_tarde === false ? (
                      <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-brand-green">A tiempo</span>
                    ) : (
                      <span className="text-[10px] text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EquipoVista() {
  const [equipo, setEquipo] = useState<any[] | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "break" | "fuera" | "tarde">("all");
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    const r = await fetch("/api/clock/equipo");
    const d = await r.json();
    setEquipo(d.equipo || []);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  const stats = useMemo(() => {
    if (!equipo) return { total: 0, active: 0, brk: 0, fuera: 0, tardes: 0 };
    return {
      total: equipo.length,
      active: equipo.filter((e) => e.entry_activa && !e.break_activo).length,
      brk: equipo.filter((e) => e.break_activo).length,
      fuera: equipo.filter((e) => !e.entry_activa).length,
      tardes: equipo.filter((e) => e.entry_activa?.fue_tarde).length,
    };
  }, [equipo]);

  const filtered = useMemo(() => {
    if (!equipo) return [];
    let list = equipo;
    if (filter === "active") list = list.filter((e) => e.entry_activa && !e.break_activo);
    else if (filter === "break") list = list.filter((e) => e.break_activo);
    else if (filter === "fuera") list = list.filter((e) => !e.entry_activa);
    else if (filter === "tarde") list = list.filter((e) => e.entry_activa?.fue_tarde);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => (e.nombre || "").toLowerCase().includes(q));
    }
    // Sort: active first, then break, then late, then fuera
    return [...list].sort((a, b) => {
      const score = (e: any) => e.break_activo ? 1 : e.entry_activa ? 0 : 3;
      return score(a) - score(b) || (a.nombre || "").localeCompare(b.nombre || "");
    });
  }, [equipo, filter, search]);

  if (equipo === null) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-brand-orange" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Stats top */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatPill label="Total" value={stats.total} icon={Users} color="#2196C9" active={filter === "all"} onClick={() => setFilter("all")} />
        <StatPill label="En jornada" value={stats.active} icon={Play} color="#43A847" active={filter === "active"} onClick={() => setFilter("active")} dotPulse />
        <StatPill label="En break" value={stats.brk} icon={Coffee} color="#F59E0B" active={filter === "break"} onClick={() => setFilter("break")} />
        <StatPill label="Fuera" value={stats.fuera} icon={LogOut} color="#9CA3AF" active={filter === "fuera"} onClick={() => setFilter("fuera")} />
        <StatPill label="Llegaron tarde" value={stats.tardes} icon={AlertTriangle} color="#E53935" active={filter === "tarde"} onClick={() => setFilter("tarde")} />
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-2xl border border-neutral-100 p-2 flex items-center gap-2 shadow-sm">
        <div className="relative flex-1">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuario..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-neutral-50 border border-transparent text-sm outline-none focus:bg-white focus:border-brand-orange"
          />
        </div>
        <span className="text-[11px] text-neutral-500 px-3">{filtered.length} de {stats.total}</span>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-100 p-12 text-center text-neutral-400 text-sm">Sin resultados</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((e) => {
            const isActive = !!e.entry_activa;
            const isBreak = !!e.break_activo;
            const isLate = !!e.entry_activa?.fue_tarde;
            const workedSec = isActive ? Math.max(0, Math.floor((now - new Date(e.entry_activa.entrada_at).getTime()) / 1000)) : 0;
            const breakSec = isBreak ? Math.max(0, Math.floor((now - new Date(e.break_activo.inicio_at).getTime()) / 1000)) : 0;
            const breakMax = (e.break_minutos_max || 60) * 60;
            const breakRemaining = isBreak ? Math.max(0, breakMax - breakSec) : 0;
            const breakOver = isBreak && breakSec > breakMax;
            const tardesPct = e.dias_semana > 0 ? (e.tardes_semana / e.dias_semana) * 100 : 0;
            return (
              <motion.div
                key={e.user_id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white rounded-2xl border-2 p-4 transition-all hover:shadow-md ${
                  isBreak && breakOver ? "border-red-300 bg-red-50/40 animate-pulse" :
                  isBreak ? "border-amber-300 bg-amber-50/40" :
                  isActive ? "border-emerald-200" :
                  isLate ? "border-red-200" :
                  "border-neutral-100"
                }`}
              >
                {/* Header user */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="relative shrink-0">
                    {e.foto_perfil_url
                      ? <img src={e.foto_perfil_url} className="h-11 w-11 rounded-full object-cover" alt="" />
                      : <div className="h-11 w-11 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[11px] font-bold flex items-center justify-center">{(e.nombre || "?").split(" ").map((s: string) => s[0]).slice(0, 2).join("")}</div>}
                    {/* Status dot */}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                      isBreak ? "bg-amber-500" : isActive ? "bg-emerald-500 animate-pulse" : "bg-neutral-400"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-display font-black truncate">{e.nombre}</div>
                    {/* Status badge */}
                    {isBreak ? (
                      <span className={`inline-flex items-center gap-1 mt-0.5 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                        breakOver ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        <Coffee className="h-2.5 w-2.5" /> {breakOver ? "Excedido" : "Break"}
                      </span>
                    ) : isActive ? (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" /> En jornada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">
                        <span className="h-1 w-1 rounded-full bg-neutral-400" /> Fuera
                      </span>
                    )}
                    {isLate && (
                      <span className="inline-flex items-center gap-1 mt-0.5 ml-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                        +{e.entry_activa.minutos_tarde}m tarde
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setEditUser(e)}
                    className="h-7 w-7 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-brand-orange flex items-center justify-center shrink-0"
                    title="Editar horario"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Tiempo trabajado live (si activo) */}
                {isActive && !isBreak && (
                  <div className="bg-emerald-50 rounded-lg px-3 py-2 mb-2 flex items-center justify-between">
                    <span className="text-[10px] text-emerald-700 font-ui font-bold uppercase tracking-wider">Trabajando</span>
                    <span className="font-display text-base font-black text-emerald-700 tabular-nums">{fmtSec(workedSec)}</span>
                  </div>
                )}

                {/* Break countdown live (si está en break) */}
                {isBreak && (
                  <div className={`rounded-lg px-3 py-2 mb-2 flex items-center justify-between ${
                    breakOver ? "bg-red-100" : breakRemaining <= 60 ? "bg-amber-100" : "bg-amber-50"
                  }`}>
                    <span className={`text-[10px] font-ui font-bold uppercase tracking-wider ${breakOver ? "text-red-800" : "text-amber-700"}`}>
                      {breakOver ? "Excedido" : "Termina en"}
                    </span>
                    <span className={`font-display text-base font-black tabular-nums ${breakOver ? "text-red-700" : "text-amber-700"}`}>
                      {breakOver ? `+${fmtSec(breakSec - breakMax)}` : fmtSec(breakRemaining)}
                    </span>
                  </div>
                )}

                {/* Métricas semana */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-neutral-50 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-neutral-500 uppercase tracking-wider">Esta semana</div>
                    <div className="font-bold tabular-nums">{fmtDur(e.minutos_semana || 0)}</div>
                  </div>
                  <div className="bg-neutral-50 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-neutral-500 uppercase tracking-wider">Puntualidad</div>
                    <div className={`font-bold tabular-nums ${tardesPct === 0 ? "text-emerald-700" : tardesPct < 30 ? "text-amber-700" : "text-red-700"}`}>
                      {e.dias_semana - e.tardes_semana}/{e.dias_semana} días
                    </div>
                  </div>
                </div>

                {/* Schedule footer */}
                <div className="mt-2 pt-2 border-t border-neutral-100 flex items-center justify-between text-[10px] text-neutral-500 font-ui">
                  <span>Entrada {e.hora_entrada ? String(e.hora_entrada).slice(0, 5) : "—"}</span>
                  <span>{e.estricto === false ? <span className="text-brand-orange font-bold">flex</span> : `±${e.tolerancia_minutos || 10}m tol`}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {editUser && <ScheduleEditor user={editUser} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); load(); }} />}
    </div>
  );
}

function StatPill({ label, value, icon: Icon, color, active, onClick, dotPulse }: any) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl border-2 p-3 transition-all ${active ? "shadow-md" : "border-transparent bg-white hover:border-neutral-200"}`}
      style={active ? { borderColor: color, background: color + "10" } : { background: "white", borderColor: "#f5f5f5" }}
    >
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg flex items-center justify-center relative" style={{ background: color + "20", color }}>
          <Icon className="h-3.5 w-3.5" />
          {dotPulse && value > 0 && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-ui font-bold uppercase tracking-wider text-neutral-500 truncate">{label}</div>
          <div className="font-display text-xl font-black tabular-nums leading-none mt-0.5" style={{ color }}>{value}</div>
        </div>
      </div>
    </button>
  );
}

function fmtSec(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function ScheduleEditor({ user, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    hora_entrada: String(user.hora_entrada || "09:00").slice(0, 5),
    tolerancia_minutos: user.tolerancia_minutos ?? 10,
    estricto: user.estricto ?? true,
    break_minutos_max: user.break_minutos_max ?? 60,
  });
  const save = async () => {
    const r = await fetch(`/api/schedule/${user.user_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { toast.success("Horario actualizado"); onSaved(); } else toast.error("Error");
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()} className="rounded-3xl p-7 max-w-md w-full modal-surface">
        <h3 className="font-display text-xl font-black mb-5">Horario de {user.nombre}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Hora de entrada</label>
            <input type="time" value={form.hora_entrada} onChange={(e) => setForm({ ...form, hora_entrada: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Tolerancia (min)</label>
            <input type="number" value={form.tolerancia_minutos} onChange={(e) => setForm({ ...form, tolerancia_minutos: Number(e.target.value) })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Break máximo (min)</label>
            <input type="number" value={form.break_minutos_max} onChange={(e) => setForm({ ...form, break_minutos_max: Number(e.target.value) })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.estricto} onChange={(e) => setForm({ ...form, estricto: e.target.checked })} />
            Horario estricto (marca tardes automáticamente)
          </label>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-black/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5">Cancelar</button>
          <button onClick={save} className="flex-1 h-11 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90">Guardar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
