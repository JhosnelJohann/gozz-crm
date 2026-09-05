"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Play, Pause, LogOut as LogOutIcon, Coffee, AlertTriangle } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";

interface Status {
  schedule: any;
  entry: any | null;
  break_activo: any | null;
}

function fmtDur(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ClockButton() {
  const [status, setStatus] = useState<Status | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    try {
      const r = await fetch("/api/clock/status");
      const d = await r.json();
      setStatus(d);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    try {
      const s = getSocket();
      s?.on("clock:break-excedido", (payload: any) => {
        toast.error(`Break excedido por ${payload.minutos - payload.max} min. Termínalo.`, { duration: 8000 });
      });
    } catch {}
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  const clockIn = async () => {
    const r = await fetch("/api/clock/in", { method: "POST" });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || "Error"); return; }
    if (d.tarde) toast.warning(`Llegaste ${d.minutos_tarde} min tarde`);
    else toast.success("Clock in registrado");
    setMenuOpen(false);
    load();
  };

  const clockOut = async () => {
    if (!confirm("¿Terminar tu jornada?")) return;
    const r = await fetch("/api/clock/out", { method: "POST" });
    if (r.ok) { toast.success("Jornada terminada"); setMenuOpen(false); load(); }
    else toast.error("Error");
  };

  const breakStart = async () => {
    const r = await fetch("/api/clock/break/start", { method: "POST" });
    if (r.ok) { toast.info("Break iniciado"); setMenuOpen(false); load(); }
    else { const d = await r.json(); toast.error(d.error); }
  };

  const breakEnd = async () => {
    const r = await fetch("/api/clock/break/end", { method: "POST" });
    if (r.ok) { toast.success("Break terminado"); setMenuOpen(false); load(); }
    else toast.error("Error");
  };

  if (!status) return null;

  const entry = status.entry;
  const brk = status.break_activo;
  const active = !!entry;
  const breaking = !!brk;

  const workedMin = entry ? Math.max(0, Math.floor((now - new Date(entry.entrada_at).getTime()) / 60000)) : 0;
  const breakMin = brk ? Math.max(0, Math.floor((now - new Date(brk.inicio_at).getTime()) / 60000)) : 0;
  const maxBreak = status.schedule?.break_minutos_max || 60;
  const breakExcedido = breaking && breakMin > maxBreak;

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className={`flex items-center gap-2 h-10 px-3 rounded-xl border transition ${
          breakExcedido ? "bg-red-500 border-red-500 text-white animate-pulse" :
          breaking ? "bg-yellow-400/15 border-yellow-400/40 text-yellow-700 dark:text-yellow-300" :
          active ? "bg-brand-green/15 border-brand-green/30 text-brand-green" :
          "bg-white/60 dark:bg-white/[0.03] border-black/5 dark:border-white/10 hover:bg-white"
        }`}
        title={active ? "Jornada activa" : "Clock in"}
      >
        {breakExcedido ? <AlertTriangle className="h-4 w-4" /> : breaking ? <Coffee className="h-4 w-4" /> : active ? <Clock className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        <span className="text-[11px] font-ui uppercase tracking-wider font-bold whitespace-nowrap tabular-nums">
          {breaking ? `Break ${fmtDur(breakMin)}${breakExcedido ? " ⚠" : ""}` :
           active ? fmtDur(workedMin) :
           "Clock in"}
        </span>
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute right-0 mt-2 w-64 glass-strong rounded-2xl overflow-hidden z-50 shadow-glass-dark"
          >
            <div className="px-4 py-3 border-b border-black/5 dark:border-white/5">
              <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-500">Mi jornada</div>
              {active ? (
                <>
                  <div className="font-display text-lg font-black tabular-nums">{fmtDur(workedMin)}</div>
                  <div className="text-[10px] text-neutral-500">Entrada: {new Date(entry.entrada_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</div>
                  {entry.fue_tarde && <div className="text-[10px] text-brand-red mt-1">Llegaste {entry.minutos_tarde} min tarde</div>}
                  {breaking && (
                    <div className={`mt-2 px-2 py-1 rounded-lg text-[11px] ${breakExcedido ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"}`}>
                      En break · {fmtDur(breakMin)} {breakExcedido && `(max ${maxBreak}m)`}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-neutral-500 mt-1">No has marcado entrada hoy</div>
              )}
            </div>
            <div className="p-1 space-y-1">
              {!active && (
                <button onClick={clockIn} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-brand-green/10 text-left text-sm text-brand-green">
                  <Play className="h-4 w-4" /> Clock in
                </button>
              )}
              {active && !breaking && (
                <>
                  <button onClick={breakStart} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-yellow-400/10 text-left text-sm text-yellow-700">
                    <Coffee className="h-4 w-4" /> Iniciar break
                  </button>
                  <button onClick={clockOut} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 text-left text-sm text-brand-red">
                    <LogOutIcon className="h-4 w-4" /> Clock out
                  </button>
                </>
              )}
              {breaking && (
                <>
                  <button onClick={breakEnd} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-brand-green/10 text-left text-sm text-brand-green">
                    <Pause className="h-4 w-4" /> Terminar break
                  </button>
                  <button onClick={clockOut} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 text-left text-sm text-brand-red">
                    <LogOutIcon className="h-4 w-4" /> Clock out
                  </button>
                </>
              )}
              <Link href="/asistencia" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-neutral-500">
                <Clock className="h-4 w-4" /> Ver mi asistencia
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
