"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, X, Clock } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

// ============================================================
// Calendar rendering primitives compartidas
// ============================================================
export const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const DIAS_ES = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

export function pad(n: number) { return String(n).padStart(2, "0"); }

export const DEFAULT_HOUR = 18; // 6:00 PM por defecto al elegir fecha sin hora previa
// La hora interna se guarda en 24h (para el ISO); el selector la muestra en 12h con AM/PM.
export function to12(hour: number): { h12: number; ampm: "AM" | "PM" } {
  return { h12: hour % 12 === 0 ? 12 : hour % 12, ampm: hour < 12 ? "AM" : "PM" };
}
export function to24(h12: number, ampm: "AM" | "PM"): number {
  if (ampm === "AM") return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

export function toYMD(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseYMD(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function isSameDay(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function betweenInclusive(d: Date, from: Date, to: Date) {
  const x = startOfDay(d).getTime();
  return x >= startOfDay(from).getTime() && x <= startOfDay(to).getTime();
}

interface DayCell { date: Date; inMonth: boolean; disabled: boolean; }

export function buildMonthGrid(viewMonth: Date, minDate?: Date | null, maxDate?: Date | null): DayCell[] {
  const year = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const first = new Date(year, m, 1);
  const lastDayNum = new Date(year, m + 1, 0).getDate();
  const startWeekday = first.getDay();
  const days: DayCell[] = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = new Date(year, m, -i);
    days.push({ date: d, inMonth: false, disabled: outOfRange(d, minDate, maxDate) });
  }
  for (let d = 1; d <= lastDayNum; d++) {
    const dt = new Date(year, m, d);
    days.push({ date: dt, inMonth: true, disabled: outOfRange(dt, minDate, maxDate) });
  }
  while (days.length < 42) {
    const last = days[days.length - 1].date;
    const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    days.push({ date: next, inMonth: next.getMonth() === m, disabled: outOfRange(next, minDate, maxDate) });
  }
  return days;
}

function outOfRange(d: Date, min?: Date | null, max?: Date | null): boolean {
  if (min && startOfDay(d) < startOfDay(min)) return true;
  if (max && startOfDay(d) > startOfDay(max)) return true;
  return false;
}

// ============================================================
// MonthView: grilla reutilizable
// ============================================================
interface MonthViewProps {
  viewMonth: Date;
  onPrev?: () => void;
  onNext?: () => void;
  showHeader?: boolean;
  selected?: Date | null;
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
  hoverDate?: Date | null;
  onHover?: (d: Date | null) => void;
  onPick: (d: Date) => void;
  minDate?: Date | null;
  maxDate?: Date | null;
  onSetMonth?: (d: Date) => void;   // si se pasa, muestra selectores de mes/año
}

export function MonthView({
  viewMonth, onPrev, onNext, showHeader = true,
  selected, rangeStart, rangeEnd, hoverDate, onHover, onPick,
  minDate, maxDate, onSetMonth
}: MonthViewProps) {
  const days = useMemo(() => buildMonthGrid(viewMonth, minDate, maxDate), [viewMonth, minDate, maxDate]);
  const today = new Date();

  // Rango de años para el selector (incluye siempre el año visible)
  const years = useMemo(() => {
    const cy = today.getFullYear();
    let start = minDate ? minDate.getFullYear() : cy - 110;
    let end = maxDate ? maxDate.getFullYear() : cy + 5;
    start = Math.min(start, viewMonth.getFullYear());
    end = Math.max(end, viewMonth.getFullYear());
    const arr: number[] = [];
    for (let y = end; y >= start; y--) arr.push(y);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDate, maxDate, viewMonth]);

  // previsualización de rango mientras el usuario mueve el mouse
  const previewEnd = rangeStart && !rangeEnd ? hoverDate : rangeEnd;

  return (
    <div>
      {showHeader && (
        <div className="px-3 pt-3 pb-2 flex items-center gap-1">
          {onPrev && (
            <button type="button" onClick={onPrev} className="h-8 w-8 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500">
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          {onSetMonth ? (
            <div className="flex-1 flex items-center justify-center gap-1.5">
              <select
                value={viewMonth.getMonth()}
                onChange={(e) => onSetMonth(new Date(viewMonth.getFullYear(), Number(e.target.value), 1))}
                className="h-8 px-2 rounded-lg bg-neutral-50 border border-neutral-200 text-sm font-display font-bold outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange cursor-pointer"
                aria-label="Mes"
              >
                {MESES_ES.map((m, i) => (<option key={i} value={i}>{m}</option>))}
              </select>
              <select
                value={viewMonth.getFullYear()}
                onChange={(e) => onSetMonth(new Date(Number(e.target.value), viewMonth.getMonth(), 1))}
                className="h-8 px-2 rounded-lg bg-neutral-50 border border-neutral-200 text-sm font-display font-bold tabular-nums outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange cursor-pointer"
                aria-label="Año"
              >
                {years.map((y) => (<option key={y} value={y}>{y}</option>))}
              </select>
            </div>
          ) : (
            <div className="flex-1 text-center font-display font-bold text-sm">
              {MESES_ES[viewMonth.getMonth()]} <span className="text-neutral-400 font-normal">{viewMonth.getFullYear()}</span>
            </div>
          )}
          {onNext && (
            <button type="button" onClick={onNext} className="h-8 w-8 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500">
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-7 px-3 pt-1 pb-1 text-[10px] font-ui uppercase tracking-wider text-neutral-400">
        {DIAS_ES.map((d) => (<div key={d} className="text-center h-6 flex items-center justify-center">{d}</div>))}
      </div>

      <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
        {days.map((d, i) => {
          const isSelected = isSameDay(d.date, selected);
          const isRangeStart = isSameDay(d.date, rangeStart);
          const isRangeEnd = isSameDay(d.date, previewEnd || null) || isSameDay(d.date, rangeEnd);
          const isInRange = rangeStart && previewEnd
            ? (betweenInclusive(d.date, rangeStart, previewEnd) || betweenInclusive(d.date, previewEnd, rangeStart))
            : false;
          const isToday = isSameDay(d.date, today);

          const isRangeEdge = isRangeStart || isRangeEnd;
          const inRangeMiddle = isInRange && !isRangeEdge;

          return (
            <div key={i} className={cn("relative h-9 flex items-center justify-center",
              inRangeMiddle && "bg-brand-orange/10",
              isRangeStart && rangeEnd && "bg-brand-orange/10 rounded-l-xl",
              isRangeEnd && rangeStart && !isRangeStart && "bg-brand-orange/10 rounded-r-xl",
            )}>
              <motion.button
                type="button"
                disabled={d.disabled}
                onClick={() => !d.disabled && onPick(d.date)}
                onMouseEnter={() => onHover?.(d.date)}
                onMouseLeave={() => onHover?.(null)}
                whileHover={!d.disabled ? { scale: 1.08 } : undefined}
                whileTap={!d.disabled ? { scale: 0.92 } : undefined}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className={cn(
                  "h-9 w-9 rounded-xl text-xs font-medium relative z-10 transition-colors",
                  d.disabled && "text-neutral-300 cursor-not-allowed",
                  !d.disabled && !isSelected && !isRangeEdge && d.inMonth && "text-neutral-700 hover:bg-neutral-100",
                  !d.disabled && !d.inMonth && !isRangeEdge && "text-neutral-300 hover:bg-neutral-50",
                  (isSelected || isRangeEdge) && "bg-brand-orange text-white font-bold shadow-lg shadow-brand-orange/30",
                  isToday && !isSelected && !isRangeEdge && "ring-1 ring-brand-orange/40 font-bold text-brand-orange"
                )}
              >
                {d.date.getDate()}
              </motion.button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// DateField — picker single-date (con opción de hora)
// ============================================================
interface DateFieldProps {
  value: string;          // "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm" si withTime
  onChange: (v: string) => void;
  minDate?: Date | null;  // null = sin mínimo
  maxDate?: Date | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  showClear?: boolean;
  withTime?: boolean;     // muestra selector de hora + minutos
  typeable?: boolean;     // permite escribir la fecha (dd/mm/aaaa) ademas del calendario
}

// Parsea texto escrito a mano: dd/mm/aaaa (acepta . - / y opcional hh:mm)
function parseTyped(text: string): { date: Date | null; hour?: number; minute?: number } {
  const m = text.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return { date: null };
  const day = Number(m[1]); const month = Number(m[2]); let year = Number(m[3]);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return { date: null };
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return { date: null }; // descarta fechas irreales (ej. 31/02)
  const hour = m[4] != null ? Math.min(23, Number(m[4])) : undefined;
  const minute = m[5] != null ? Math.min(59, Number(m[5])) : undefined;
  return { date: d, hour, minute };
}

function fmtTypable(d: Date | null, withTime: boolean, h: number, mi: number): string {
  if (!d) return "";
  const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${base} ${pad(h)}:${pad(mi)}` : base;
}

function parseDateTime(v: string): { date: Date | null; hour: number; minute: number } {
  if (!v) return { date: null, hour: DEFAULT_HOUR, minute: 0 };
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return { date: null, hour: DEFAULT_HOUR, minute: 0 };
  const [, y, mo, d, h, mi] = m;
  return {
    date: new Date(Number(y), Number(mo) - 1, Number(d)),
    hour: h ? Number(h) : DEFAULT_HOUR,
    minute: mi ? Number(mi) : 0
  };
}

function toDateTimeString(d: Date, h?: number, m?: number): string {
  const base = toYMD(d);
  if (h === undefined || m === undefined) return base;
  return `${base}T${pad(h)}:${pad(m)}`;
}

export function DateField({
  value, onChange, minDate = null, maxDate = null,
  placeholder = "Selecciona fecha", disabled, className, size = "md", showClear = true,
  withTime = false, typeable = false
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState("");
  // Posición del popover (portaleado al body para escapar de overflow-hidden / scroll)
  const [coords, setCoords] = useState<{ left: number; top: number | null; bottom: number | null }>({ left: 0, top: 0, bottom: null });
  const parsed = parseDateTime(value);
  const [viewMonth, setViewMonth] = useState<Date>(() => parsed.date || new Date());
  const [hour, setHour] = useState<number>(parsed.hour);
  const [minute, setMinute] = useState<number>(parsed.minute);

  useEffect(() => {
    const p = parseDateTime(value);
    if (p.date) setViewMonth(p.date);
    setHour(p.hour);
    setMinute(p.minute);
    if (!typing) setTypedText(fmtTypable(p.date, withTime, p.hour, p.minute));
  }, [value, withTime, typing]);

  const onTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value;
    setTypedText(t);
    if (!t.trim()) { onChange(""); return; }
    const p = parseTyped(t);
    if (p.date && !outOfRange(p.date, minDate, maxDate)) {
      setViewMonth(p.date);
      if (withTime) onChange(toDateTimeString(p.date, p.hour ?? hour, p.minute ?? minute));
      else onChange(toYMD(p.date));
    }
  };

  // Calcula la posición fija del calendario a partir del botón disparador.
  // Decide abrir hacia abajo o, si no cabe, hacia arriba; y lo clampa al viewport.
  const place = useCallback(() => {
    const el = rootRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = 320;
    const estH = withTime ? 440 : 380; // alto aproximado del popover
    let left = Math.min(r.left, vw - W - 8);
    if (left < 8) left = 8;
    const spaceBelow = vh - r.bottom;
    const up = spaceBelow < estH && r.top > spaceBelow;
    setCoords({
      left,
      top: up ? null : r.bottom + 6,
      bottom: up ? vh - r.top + 6 : null,
    });
  }, [withTime]);

  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const click = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current && rootRef.current.contains(t)) return;
      if (popRef.current && popRef.current.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", esc);
    };
  }, [open, place]);

  const toggle = () => {
    if (!open) place();
    setOpen((x) => !x);
  };

  const pick = (d: Date) => {
    if (withTime) {
      // Si es hoy y hora está en pasado, avanzar +30 min
      const now = new Date();
      let h = hour, m = minute;
      if (isSameDay(d, now)) {
        const target = new Date(d);
        target.setHours(h, m, 0, 0);
        if (target < now) {
          const next = new Date(now.getTime() + 30 * 60 * 1000);
          h = next.getHours(); m = next.getMinutes();
          setHour(h); setMinute(m);
        }
      }
      onChange(toDateTimeString(d, h, m));
    } else {
      onChange(toYMD(d));
      setOpen(false);
    }
  };

  const changeTime = (h: number, m: number) => {
    setHour(h); setMinute(m);
    if (parsed.date) onChange(toDateTimeString(parsed.date, h, m));
  };

  const clear = (e: React.MouseEvent) => { e.stopPropagation(); onChange(""); setTypedText(""); };

  const selected = parsed.date;
  const heightClass = size === "sm" ? "h-9 text-[13px]" : "h-12 text-[14px]";
  const { h12, ampm } = to12(hour);

  const display = (() => {
    if (!selected) return "";
    const f = selected.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
    return withTime ? `${f} · ${pad(h12)}:${pad(minute)} ${ampm}` : f;
  })();

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {typeable ? (
        <div
          className={cn(
            "w-full px-3.5 rounded-xl bg-white border transition-all flex items-center gap-2.5",
            heightClass,
            "hover:border-brand-orange/50 focus-within:ring-4 focus-within:ring-brand-orange/15 focus-within:border-brand-orange",
            open ? "border-brand-orange ring-4 ring-brand-orange/15" : "border-neutral-200",
            disabled && "opacity-60 cursor-not-allowed"
          )}
        >
          <button type="button" tabIndex={-1} disabled={disabled} onClick={toggle} title="Abrir calendario" className="shrink-0 flex items-center">
            <Calendar className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4", "transition-colors", selected ? "text-brand-orange" : "text-neutral-400")} strokeWidth={1.8} />
          </button>
          <input
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={typedText}
            placeholder={withTime ? "dd/mm/aaaa hh:mm" : "dd/mm/aaaa"}
            onChange={onTypeChange}
            onFocus={() => { setTyping(true); if (!open) place(); setOpen(true); }}
            onBlur={() => setTyping(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); setOpen(false); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { setOpen(false); }
            }}
            className="flex-1 min-w-0 bg-transparent outline-none placeholder-neutral-400"
          />
          {selected && showClear && (
            <span
              role="button" tabIndex={0} onMouseDown={(e) => e.preventDefault()} onClick={clear}
              className="h-5 w-5 rounded-md hover:bg-neutral-100 flex items-center justify-center text-neutral-400 hover:text-neutral-700 cursor-pointer shrink-0"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </div>
      ) : (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "w-full px-3.5 rounded-xl bg-white border outline-none transition-all flex items-center gap-2.5",
          heightClass,
          "hover:border-brand-orange/50 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange",
          open ? "border-brand-orange ring-4 ring-brand-orange/15" : "border-neutral-200",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        <Calendar className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4", "shrink-0 transition-colors", selected ? "text-brand-orange" : "text-neutral-400")} strokeWidth={1.8} />
        <span className={cn("flex-1 text-left truncate", !selected && "text-neutral-400")}>
          {display || placeholder}
        </span>
        {selected && showClear && (
          <span
            role="button" tabIndex={0} onClick={clear}
            onKeyDown={(e) => e.key === "Enter" && clear(e as any)}
            className="h-5 w-5 rounded-md hover:bg-neutral-100 flex items-center justify-center text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>
      )}

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popRef}
              /* 🔴 LA MARCA QUE PERMITE RECONOCER ESTA CAPA DESDE FUERA, y no es decorativa.
                 El calendario se portea a `document.body`, asi que **no es descendiente en el DOM**
                 de quien lo usa. Cualquier contenedor que cierre al pulsar fuera con un listener
                 NATIVO —que recorre el arbol del DOM, no el de React— vera un clic en un dia como
                 "han pulsado fuera" y se cerrara, llevandose por delante el formulario a medias.
                 Le paso al selector de contacto de las oportunidades (2026-08-31).
                 Con esta marca, quien tenga ese problema lo resuelve con
                 `target.closest("[data-datefield-popover]")` en vez de descubrirlo perdiendo datos.
                 La garantia va en el componente que se portea, no en quien lo llama (§4.9-bis). */
              data-datefield-popover=""
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              style={{
                position: "fixed",
                left: coords.left,
                top: coords.top ?? undefined,
                bottom: coords.bottom ?? undefined,
                width: 320,
              }}
              className="z-[80] bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden"
            >
              <MonthView
                viewMonth={viewMonth}
                onPrev={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                onNext={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                onSetMonth={setViewMonth}
                selected={selected}
                onPick={pick}
                minDate={minDate}
                maxDate={maxDate}
              />

              {/* Time picker (opcional) */}
              {withTime && (
                <div className="px-4 py-2.5 border-t border-neutral-100 flex items-center gap-2 bg-neutral-50/60">
                  <Clock className="h-3.5 w-3.5 text-neutral-400 shrink-0" strokeWidth={1.8} />
                  <select
                    value={h12}
                    onChange={(e) => changeTime(to24(Number(e.target.value), ampm), minute)}
                    className="h-9 px-2 rounded-lg bg-white border border-neutral-200 text-sm font-semibold outline-none focus:ring-2 focus:ring-brand-orange/30 tabular-nums"
                  >
                    {[12,1,2,3,4,5,6,7,8,9,10,11].map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                  <span className="text-neutral-400 font-bold">:</span>
                  <select
                    value={minute}
                    onChange={(e) => changeTime(hour, Number(e.target.value))}
                    className="h-9 px-2 rounded-lg bg-white border border-neutral-200 text-sm font-semibold outline-none focus:ring-2 focus:ring-brand-orange/30 tabular-nums"
                  >
                    {[0,5,10,15,20,25,30,35,40,45,50,55].map((m) => (<option key={m} value={m}>{pad(m)}</option>))}
                  </select>
                  <select
                    value={ampm}
                    onChange={(e) => changeTime(to24(h12, e.target.value as "AM" | "PM"), minute)}
                    className="h-9 px-2 rounded-lg bg-white border border-neutral-200 text-sm font-semibold outline-none focus:ring-2 focus:ring-brand-orange/30"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const target = new Date(now.getTime() + 60 * 60 * 1000);
                      setHour(target.getHours()); setMinute(0);
                      onChange(toDateTimeString(target, target.getHours(), 0));
                      setViewMonth(target);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-brand-orange/10 text-brand-orange text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/20 transition-colors"
                  >
                    Hoy +1h
                  </button>
                </div>
              )}

              <div className="px-3 pb-3 pt-1 flex gap-1.5 border-t border-neutral-100 bg-neutral-50/60">
                <button type="button" onClick={() => pick(new Date())} className="flex-1 h-8 rounded-lg bg-white hover:bg-brand-orange hover:text-white border border-neutral-200 text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-600 transition-colors">
                  Hoy
                </button>
                <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="h-8 px-3 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:bg-neutral-100 transition-colors">
                  Limpiar
                </button>
                {withTime && (
                  <button type="button" onClick={() => setOpen(false)} className="h-8 px-3 rounded-lg gradient-orange text-white text-[10px] font-ui font-bold uppercase tracking-wider shadow-glow">
                    Listo
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ============================================================
// DateRangeField — rango con dos meses lado-a-lado y presets
// ============================================================
interface DateRangeFieldProps {
  desde: string;
  hasta: string;
  onChange: (desde: string, hasta: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  align?: "left" | "right";
}

type PresetKey = "hoy" | "ayer" | "semana" | "mes" | "mes_pasado" | "dias30" | "dias90" | "año";

function preset(k: PresetKey): { desde: string; hasta: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const first = (yy: number, mm: number) => new Date(yy, mm, 1);
  const daysAgo = (n: number) => new Date(y, m, d - n);

  switch (k) {
    case "hoy":        return { desde: toYMD(now), hasta: toYMD(now) };
    case "ayer":       return { desde: toYMD(daysAgo(1)), hasta: toYMD(daysAgo(1)) };
    case "semana": {
      const wd = now.getDay(); const mon = new Date(y, m, d - ((wd + 6) % 7));
      return { desde: toYMD(mon), hasta: toYMD(now) };
    }
    case "mes":        return { desde: toYMD(first(y, m)), hasta: toYMD(now) };
    case "mes_pasado": {
      const f = first(y, m - 1); const lst = new Date(y, m, 0);
      return { desde: toYMD(f), hasta: toYMD(lst) };
    }
    case "dias30":     return { desde: toYMD(daysAgo(30)), hasta: toYMD(now) };
    case "dias90":     return { desde: toYMD(daysAgo(90)), hasta: toYMD(now) };
    case "año":        return { desde: toYMD(first(y, 0)), hasta: toYMD(now) };
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "ayer", label: "Ayer" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mes" },
  { key: "mes_pasado", label: "Mes pasado" },
  { key: "dias30", label: "Últimos 30" },
  { key: "dias90", label: "Últimos 90" },
  { key: "año", label: "Este año" }
];

export function DateRangeField({
  desde, hasta, onChange, placeholder = "Rango de fechas", disabled, className, align = "left"
}: DateRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = parseYMD(desde) || parseYMD(hasta) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [tempStart, setTempStart] = useState<Date | null>(parseYMD(desde));
  const [tempEnd, setTempEnd] = useState<Date | null>(parseYMD(hasta));
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!open) return;
    setTempStart(parseYMD(desde));
    setTempEnd(parseYMD(hasta));
  }, [open, desde, hasta]);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", esc); };
  }, [open]);

  const nextMonth = useMemo(() => new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1), [viewMonth]);

  const pick = (d: Date) => {
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(d); setTempEnd(null);
    } else {
      if (d < tempStart) { setTempStart(d); setTempEnd(tempStart); }
      else { setTempEnd(d); }
    }
  };

  const apply = () => {
    if (tempStart && tempEnd) {
      onChange(toYMD(tempStart), toYMD(tempEnd));
    } else if (tempStart && !tempEnd) {
      onChange(toYMD(tempStart), toYMD(tempStart));
    } else {
      onChange("", "");
    }
    setOpen(false);
  };

  const applyPreset = (k: PresetKey) => {
    const p = preset(k);
    setTempStart(parseYMD(p.desde));
    setTempEnd(parseYMD(p.hasta));
    const d = parseYMD(p.desde);
    if (d) setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    onChange(p.desde, p.hasta);
    setOpen(false);
  };

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTempStart(null); setTempEnd(null);
    onChange("", "");
    setOpen(false);
  };

  const display = (() => {
    const a = parseYMD(desde), b = parseYMD(hasta);
    if (!a && !b) return "";
    const fmt = (d: Date) => d.toLocaleDateString("es", { day: "2-digit", month: "short", year: a && b && a.getFullYear() !== b.getFullYear() ? "numeric" : undefined });
    if (a && b && isSameDay(a, b)) return fmt(a);
    if (a && b) return `${fmt(a)} → ${fmt(b)}`;
    return fmt((a || b)!);
  })();

  const activePresetKey = useMemo(() => {
    if (!desde || !hasta) return null;
    return PRESETS.find((p) => {
      const x = preset(p.key);
      return x.desde === desde && x.hasta === hasta;
    })?.key || null;
  }, [desde, hasta]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((x) => !x)}
        className={cn(
          "w-full h-9 px-3 rounded-xl bg-neutral-50 border text-[13px] outline-none transition-all flex items-center gap-2 min-w-[240px]",
          "hover:bg-white hover:border-brand-orange/40 focus:bg-white focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange",
          open ? "bg-white border-brand-orange ring-4 ring-brand-orange/15" : "border-transparent",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        <Calendar className={cn("h-3.5 w-3.5 shrink-0", display ? "text-brand-orange" : "text-neutral-400")} strokeWidth={1.8} />
        <span className={cn("flex-1 text-left truncate", !display && "text-neutral-400")}>
          {display || placeholder}
        </span>
        {display && (
          <span
            role="button" tabIndex={0} onClick={clear}
            className="h-5 w-5 rounded-md hover:bg-neutral-100 flex items-center justify-center text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="h-3 w-3" />
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
            className={cn(
              "absolute z-[60] mt-2 bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex",
              "w-[680px] max-w-[calc(100vw-32px)]",
              align === "right" ? "right-0" : "left-0"
            )}
          >
            {/* Presets sidebar */}
            <div className="shrink-0 border-r border-neutral-100 bg-neutral-50/60 p-2 space-y-0.5 w-[150px]">
              <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-400 px-2 pt-1.5 pb-1">Atajos</div>
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={cn(
                    "w-full text-left h-8 px-2.5 rounded-lg text-[11px] font-ui font-semibold transition-colors",
                    activePresetKey === p.key
                      ? "bg-brand-orange text-white"
                      : "text-neutral-600 hover:bg-white hover:text-brand-orange"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Calendarios */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex relative">
                <div className="px-2 pt-3 shrink-0">
                  <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} className="h-8 w-8 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500">
                    <ChevronLeft className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-2 min-w-0">
                  <div className="border-r border-neutral-100">
                    <div className="px-3 pt-3 pb-1 text-center font-display font-bold text-sm">
                      {MESES_ES[viewMonth.getMonth()]} <span className="text-neutral-400 font-normal">{viewMonth.getFullYear()}</span>
                    </div>
                    <MonthView
                      viewMonth={viewMonth}
                      showHeader={false}
                      rangeStart={tempStart}
                      rangeEnd={tempEnd}
                      hoverDate={hoverDate}
                      onHover={setHoverDate}
                      onPick={pick}
                    />
                  </div>
                  <div>
                    <div className="px-3 pt-3 pb-1 text-center font-display font-bold text-sm">
                      {MESES_ES[nextMonth.getMonth()]} <span className="text-neutral-400 font-normal">{nextMonth.getFullYear()}</span>
                    </div>
                    <MonthView
                      viewMonth={nextMonth}
                      showHeader={false}
                      rangeStart={tempStart}
                      rangeEnd={tempEnd}
                      hoverDate={hoverDate}
                      onHover={setHoverDate}
                      onPick={pick}
                    />
                  </div>
                </div>
                <div className="px-2 pt-3 shrink-0">
                  <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} className="h-8 w-8 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500">
                    <ChevronRight className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-neutral-100 bg-neutral-50/60 flex items-center gap-2">
                <div className="text-[11px] text-neutral-500 font-ui flex-1 min-w-0 truncate">
                  {tempStart && tempEnd
                    ? `${tempStart.toLocaleDateString("es", { day: "2-digit", month: "short" })} → ${tempEnd.toLocaleDateString("es", { day: "2-digit", month: "short" })}`
                    : tempStart
                      ? `Inicio: ${tempStart.toLocaleDateString("es", { day: "2-digit", month: "short" })} · elige fin`
                      : "Elige fecha de inicio"}
                </div>
                <button type="button" onClick={() => clear()} className="h-8 px-3 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:bg-neutral-100">Limpiar</button>
                <button type="button" onClick={apply} disabled={!tempStart} className="h-8 px-4 rounded-lg gradient-orange text-white text-[10px] font-ui font-bold uppercase tracking-wider shadow-glow disabled:opacity-50">Aplicar</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
