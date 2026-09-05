"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, X, Check } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

export interface DateRange { from: Date | null; to: Date | null; }
export type Preset = { key: string; label: string; compute: () => DateRange };

interface Props {
  value: DateRange;
  onChange: (r: DateRange) => void;
  placeholder?: string;
  className?: string;
  /** Presets del popover. Default = presets a-futuro (vencimientos de tareas). Pasá PAST_PRESETS para rangos hacia atrás. */
  presets?: Preset[];
}

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const WEEKDAYS_ES = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function sameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function inRange(d: Date, a: Date, b: Date) { return d >= a && d <= b; }

function fmtShort(d: Date) {
  return d.toLocaleDateString("es", { day: "2-digit", month: "short" });
}
function fmtRange(r: DateRange) {
  if (!r.from && !r.to) return null;
  if (r.from && r.to) {
    if (sameDay(r.from, r.to)) return fmtShort(r.from);
    return `${fmtShort(r.from)} – ${fmtShort(r.to)}`;
  }
  return fmtShort(r.from || r.to!);
}

const today = () => startOfDay(new Date());
// Presets a-futuro (default): pensados para vencimientos de tareas.
const PRESETS: Preset[] = [
  { key: "hoy", label: "Hoy", compute: () => ({ from: today(), to: endOfDay(today()) }) },
  { key: "mañana", label: "Mañana", compute: () => ({ from: addDays(today(), 1), to: endOfDay(addDays(today(),1)) }) },
  { key: "semana", label: "Esta semana", compute: () => {
      const t = today(); const dow = (t.getDay() + 6) % 7; // 0=lun
      return { from: addDays(t, -dow), to: endOfDay(addDays(t, 6-dow)) };
    }
  },
  { key: "siete", label: "Próximos 7 días", compute: () => ({ from: today(), to: endOfDay(addDays(today(), 6)) }) },
  { key: "mes", label: "Este mes", compute: () => {
      const t = today();
      const from = new Date(t.getFullYear(), t.getMonth(), 1);
      const to = endOfDay(new Date(t.getFullYear(), t.getMonth()+1, 0));
      return { from, to };
    }
  },
  { key: "treinta", label: "Próximos 30 días", compute: () => ({ from: today(), to: endOfDay(addDays(today(), 30)) }) },
];

// Presets hacia ATRÁS: para filtrar por recencia ("eliminados del … a hoy"). Se pasan por prop `presets`.
export const PAST_PRESETS: Preset[] = [
  { key: "hoy", label: "Hoy", compute: () => ({ from: today(), to: endOfDay(today()) }) },
  { key: "ayer", label: "Ayer", compute: () => ({ from: addDays(today(), -1), to: endOfDay(addDays(today(), -1)) }) },
  { key: "ult7", label: "Últimos 7 días", compute: () => ({ from: addDays(today(), -6), to: endOfDay(today()) }) },
  { key: "ult30", label: "Últimos 30 días", compute: () => ({ from: addDays(today(), -29), to: endOfDay(today()) }) },
  { key: "mes", label: "Este mes", compute: () => {
      const t = today();
      const from = new Date(t.getFullYear(), t.getMonth(), 1);
      return { from, to: endOfDay(today()) };
    }
  },
];

function matchPreset(r: DateRange, presets: Preset[]): string | null {
  if (!r.from || !r.to) return null;
  for (const p of presets) {
    const pr = p.compute();
    if (pr.from && pr.to && sameDay(pr.from, r.from) && sameDay(pr.to, r.to)) return p.key;
  }
  return null;
}

export function DateRangePopover({ value, onChange, placeholder = "Fecha", className, presets = PRESETS }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => { const t = today(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [draft, setDraft] = useState<DateRange>(value);
  const [hover, setHover] = useState<Date | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setDraft(value); }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (anchor.current && !anchor.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const label = fmtRange(value) || placeholder;
  const hasValue = !!(value.from || value.to);
  const presetMatch = matchPreset(value, presets);

  const onPickDay = (d: Date) => {
    const dStart = startOfDay(d);
    if (!draft.from || (draft.from && draft.to)) {
      setDraft({ from: dStart, to: null });
      return;
    }
    // from set, to not
    if (dStart < draft.from) setDraft({ from: dStart, to: endOfDay(draft.from) });
    else setDraft({ from: draft.from, to: endOfDay(dStart) });
  };

  const apply = () => {
    onChange(draft);
    setOpen(false);
  };
  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange({ from: null, to: null });
    setDraft({ from: null, to: null });
  };
  const pickPreset = (p: Preset) => {
    const r = p.compute();
    setDraft(r);
    onChange(r);
    setOpen(false);
  };

  // Render month grid
  const days: Date[] = useMemo(() => {
    const first = new Date(month);
    const startW = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -startW);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [month]);

  const monthLabel = `${MONTHS_ES[month.getMonth()]} ${month.getFullYear()}`;

  const rangeFrom = draft.from;
  const rangeTo = draft.to || (hover && draft.from && !draft.to ? (hover < draft.from ? draft.from : hover) : null);
  const rangeStart = draft.from && rangeTo ? (draft.from < rangeTo ? draft.from : rangeTo) : draft.from;
  const rangeEnd = draft.from && rangeTo ? (draft.from < rangeTo ? rangeTo : draft.from) : null;

  return (
    <div ref={anchor} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-9 px-3 rounded-xl text-sm outline-none transition-all flex items-center gap-2 border font-inter",
          hasValue
            ? "bg-brand-orange/10 border-brand-orange/30 text-brand-orange font-semibold"
            : "bg-neutral-50 border-transparent hover:bg-white hover:border-slate-200 text-slate-700",
          open && "ring-4 ring-brand-orange/15 border-brand-orange"
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.2} />
        <span className="truncate max-w-[180px]">{label}</span>
        {hasValue && (
          <span
            role="button"
            aria-label="Limpiar"
            onClick={clear}
            className="h-5 w-5 rounded-md hover:bg-brand-orange/20 flex items-center justify-center -mr-1 cursor-pointer"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="absolute top-[calc(100%+8px)] left-0 z-50 w-[360px] sm:w-[420px] rounded-2xl bg-white border border-slate-200 shadow-[0_30px_80px_rgba(15,23,42,0.18)] overflow-hidden"
          >
            {/* Header gradient decorativo */}
            <div className="relative px-4 pt-3 pb-2 border-b border-slate-100">
              <div className="absolute inset-0 opacity-50 pointer-events-none"
                style={{ backgroundImage: "radial-gradient(ellipse at top left, rgba(87,80,232,0.10), transparent 60%)" }} />
              <div className="relative flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white shadow">
                  <CalendarDays className="h-4 w-4" strokeWidth={2.2} />
                </div>
                <div className="flex-1">
                  <div className="text-[9px] font-inter font-bold uppercase tracking-[0.2em] text-brand-orange">Rango de fechas</div>
                  <div className="text-[13px] font-inter font-bold text-slate-900 leading-tight truncate">
                    {draft.from && draft.to ? fmtRange(draft) : draft.from ? `${fmtShort(draft.from)} → …` : "Selecciona"}
                  </div>
                </div>
              </div>
            </div>

            {/* Presets */}
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => pickPreset(p)}
                  className={cn(
                    "h-7 px-2.5 rounded-lg text-[11px] font-inter font-semibold whitespace-nowrap transition",
                    presetMatch === p.key
                      ? "bg-brand-orange text-white shadow-sm"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Month navigation */}
            <div className="px-4 pt-3 flex items-center">
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1))}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-600 flex items-center justify-center">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex-1 text-center font-inter font-bold text-sm text-slate-900 capitalize">{monthLabel}</div>
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-600 flex items-center justify-center">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Weekday header */}
            <div className="px-3 mt-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-inter font-bold uppercase tracking-wider text-slate-400">
              {WEEKDAYS_ES.map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>

            {/* Days grid */}
            <div className="px-3 pb-3 grid grid-cols-7 gap-0.5" onMouseLeave={() => setHover(null)}>
              {days.map((d, i) => {
                const inMonth = d.getMonth() === month.getMonth();
                const isToday = sameDay(d, new Date());
                const startSel = rangeStart && sameDay(d, rangeStart);
                const endSel = rangeEnd && sameDay(d, rangeEnd);
                const inSel = rangeStart && rangeEnd && d >= rangeStart && d <= rangeEnd;
                return (
                  <button
                    key={i}
                    type="button"
                    onMouseEnter={() => setHover(d)}
                    onClick={() => onPickDay(d)}
                    className={cn(
                      "relative h-9 rounded-lg text-[12px] font-inter transition-all",
                      inMonth ? "text-slate-900" : "text-slate-300",
                      inSel && !startSel && !endSel && "bg-brand-orange/10",
                      (startSel || endSel) && "bg-gradient-to-br from-brand-orange to-neon-magenta text-white font-bold shadow-md",
                      !inSel && !startSel && !endSel && "hover:bg-slate-100",
                      isToday && !startSel && !endSel && "ring-1 ring-inset ring-brand-orange/40 font-bold"
                    )}
                  >
                    {d.getDate()}
                    {isToday && !startSel && !endSel && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-brand-orange" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-2">
              <button
                type="button"
                onClick={clear}
                className="h-9 px-3 rounded-lg text-[11px] font-inter font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-100 transition"
              >
                Limpiar
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 px-3 rounded-lg text-[11px] font-inter font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!draft.from}
                className={cn(
                  "h-9 px-4 rounded-lg text-[11px] font-inter font-bold uppercase tracking-wider text-white flex items-center gap-1.5 transition shadow-sm",
                  draft.from
                    ? "bg-gradient-to-r from-brand-orange to-neon-magenta hover:shadow-[0_8px_24px_rgba(87,80,232,0.4)]"
                    : "bg-slate-300 cursor-not-allowed"
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} /> Aplicar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
