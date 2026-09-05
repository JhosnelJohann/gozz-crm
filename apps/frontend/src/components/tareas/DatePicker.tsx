"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, Clock, X } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

interface Props {
  value: string;           // ISO datetime-local: "YYYY-MM-DDTHH:mm"
  onChange: (v: string) => void;
  minDate?: Date;          // bloquea fechas anteriores (default hoy 00:00)
  placeholder?: string;
  disabled?: boolean;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

function pad(n: number) { return String(n).padStart(2, "0"); }

function parseLocal(v: string): { date: Date | null; hour: number; minute: number } {
  if (!v) return { date: null, hour: 9, minute: 0 };
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return { date: null, hour: 9, minute: 0 };
  const [, y, mo, d, h, mi] = m;
  return { date: new Date(Number(y), Number(mo) - 1, Number(d)), hour: Number(h), minute: Number(mi) };
}

function toLocalString(date: Date, hour: number, minute: number): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function DatePicker({ value, onChange, minDate, placeholder = "Selecciona fecha", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = parseLocal(value);
  const [viewMonth, setViewMonth] = useState<Date>(() => initial.date || new Date());
  const [hour, setHour] = useState<number>(initial.hour);
  const [minute, setMinute] = useState<number>(initial.minute);
  const [selected, setSelected] = useState<Date | null>(initial.date);

  const min = useMemo(() => startOfDay(minDate || new Date()), [minDate]);

  useEffect(() => {
    const parsed = parseLocal(value);
    setSelected(parsed.date);
    setHour(parsed.hour);
    setMinute(parsed.minute);
    if (parsed.date) setViewMonth(parsed.date);
  }, [value]);

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const monthDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startWeekday = firstDay.getDay(); // 0=Dom
    const days: { date: Date; inMonth: boolean; disabled: boolean }[] = [];

    // Relleno inicial (mes anterior)
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, m, -i);
      days.push({ date: d, inMonth: false, disabled: d < min });
    }
    // Días del mes
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dt = new Date(year, m, d);
      days.push({ date: dt, inMonth: true, disabled: dt < min });
    }
    // Relleno final para completar 6 semanas (42 celdas)
    while (days.length < 42) {
      const last = days[days.length - 1].date;
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      days.push({ date: next, inMonth: next.getMonth() === m, disabled: next < min });
    }
    return days;
  }, [viewMonth, min]);

  const pick = (date: Date) => {
    if (date < min) return;
    setSelected(date);
    // Si la fecha es hoy y la hora seleccionada está en el pasado, avanzar a próxima media hora
    const now = new Date();
    if (isSameDay(date, now)) {
      const target = new Date(date);
      target.setHours(hour, minute, 0, 0);
      if (target < now) {
        const next = new Date(now.getTime() + 30 * 60 * 1000);
        setHour(next.getHours());
        setMinute(next.getMinutes());
        onChange(toLocalString(date, next.getHours(), next.getMinutes()));
        return;
      }
    }
    onChange(toLocalString(date, hour, minute));
  };

  const changeTime = (h: number, m: number) => {
    setHour(h); setMinute(m);
    if (selected) onChange(toLocalString(selected, h, m));
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSelected(null);
  };

  const hoy = () => {
    const now = new Date();
    const target = new Date(now.getTime() + 60 * 60 * 1000); // +1h por defecto
    setSelected(target);
    setViewMonth(target);
    setHour(target.getHours());
    setMinute(0);
    onChange(toLocalString(target, target.getHours(), 0));
  };

  const displayValue = selected
    ? selected.toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" }).replace(",", "") +
      ` · ${pad(hour)}:${pad(minute)}`
    : "";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group w-full h-12 px-4 rounded-2xl bg-white border text-sm outline-none transition-all flex items-center gap-3",
          "hover:border-brand-orange/50 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange",
          open ? "border-brand-orange ring-4 ring-brand-orange/15" : "border-neutral-200",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        <Calendar className={cn("h-4 w-4 shrink-0 transition-colors", selected ? "text-brand-orange" : "text-neutral-400")} strokeWidth={1.8} />
        <span className={cn("flex-1 text-left", !selected && "text-neutral-400")}>
          {displayValue || placeholder}
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={0}
            onClick={clear}
            onKeyDown={(e) => e.key === 'Enter' && clear(e as any)}
            className="h-6 w-6 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="absolute right-0 z-[60] mt-2 w-[340px] bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-neutral-100">
              <button
                type="button"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                className="h-8 w-8 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <div className="flex-1 text-center font-display font-bold text-sm">
                {MESES[viewMonth.getMonth()]} <span className="text-neutral-400 font-normal">{viewMonth.getFullYear()}</span>
              </div>
              <button
                type="button"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                className="h-8 w-8 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            {/* Días de la semana */}
            <div className="grid grid-cols-7 px-3 pt-2 pb-1 text-[10px] font-ui uppercase tracking-wider text-neutral-400">
              {DIAS.map((d) => <div key={d} className="text-center h-6 flex items-center justify-center">{d}</div>)}
            </div>

            {/* Grilla */}
            <div className="grid grid-cols-7 px-3 pb-3 gap-0.5">
              {monthDays.map((d, i) => {
                const isSelected = selected && isSameDay(d.date, selected);
                const isToday = isSameDay(d.date, new Date());
                return (
                  <motion.button
                    key={i}
                    type="button"
                    disabled={d.disabled}
                    onClick={() => pick(d.date)}
                    whileHover={!d.disabled ? { scale: 1.08 } : undefined}
                    whileTap={!d.disabled ? { scale: 0.95 } : undefined}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className={cn(
                      "h-9 rounded-xl text-xs font-medium transition-colors relative",
                      d.disabled && "text-neutral-300 cursor-not-allowed",
                      !d.disabled && !isSelected && d.inMonth && "text-neutral-700 hover:bg-neutral-100",
                      !d.disabled && !d.inMonth && "text-neutral-300 hover:bg-neutral-50",
                      isSelected && "bg-brand-orange text-white shadow-lg shadow-brand-orange/30 font-bold",
                      isToday && !isSelected && "ring-1 ring-brand-orange/40 font-bold text-brand-orange"
                    )}
                  >
                    {d.date.getDate()}
                  </motion.button>
                );
              })}
            </div>

            {/* Time picker */}
            <div className="px-4 py-3 border-t border-neutral-100 flex items-center gap-3 bg-neutral-50/60">
              <Clock className="h-4 w-4 text-neutral-400" strokeWidth={1.8} />
              <select
                value={hour}
                onChange={(e) => changeTime(Number(e.target.value), minute)}
                className="h-9 px-2 rounded-lg bg-white border border-neutral-200 text-sm font-medium outline-none focus:ring-2 focus:ring-brand-orange/30"
              >
                {Array.from({ length: 24 }).map((_, i) => <option key={i} value={i}>{pad(i)}</option>)}
              </select>
              <span className="text-neutral-400 font-bold">:</span>
              <select
                value={minute}
                onChange={(e) => changeTime(hour, Number(e.target.value))}
                className="h-9 px-2 rounded-lg bg-white border border-neutral-200 text-sm font-medium outline-none focus:ring-2 focus:ring-brand-orange/30"
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                type="button"
                onClick={hoy}
                className="h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/20 transition"
              >
                Hoy +1h
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
