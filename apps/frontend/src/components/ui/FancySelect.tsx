"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Check, X } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

export interface FancyOption {
  value: string;
  label: string;
  sub?: string;       // texto secundario
  avatar?: string | null;
  color?: string;     // dot color (para opciones con estado)
  initials?: string;  // fallback avatar
  icon?: any;         // ícono lucide
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: FancyOption[];
  placeholder: string;
  label?: string;             // "Trámite", "Asignado" → se muestra como prefijo en el botón
  icon?: any;                 // ícono lucide para el botón
  searchable?: boolean;
  className?: string;
  align?: "left" | "right";
  width?: number;             // ancho mínimo del popup (se expande al ancho del botón si es mayor)
}

export function FancySelect({
  value, onChange, options, placeholder, label, icon: Icon,
  searchable = true, className, align = "left", width = 280
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Posición del popover, portaleado al body para escapar de overflow-hidden / scroll
  const [coords, setCoords] = useState<{ left: number; top: number | null; bottom: number | null; width: number }>({ left: 0, top: 0, bottom: null, width });

  // Calcula la posición fija del menú a partir del botón disparador (flip + clamp al viewport).
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(width, r.width);
    let left = align === "right" ? r.right - w : r.left;
    if (left + w > vw - 8) left = vw - w - 8;
    if (left < 8) left = 8;
    const estH = 340; // alto aproximado del menú
    const spaceBelow = vh - r.bottom;
    const up = spaceBelow < estH && r.top > spaceBelow;
    setCoords({
      left,
      top: up ? null : r.bottom + 6,
      bottom: up ? vh - r.top + 6 : null,
      width: w,
    });
  }, [align, width]);

  useEffect(() => {
    if (!open) { setQ(""); return; }
    place();
    setTimeout(() => searchRef.current?.focus(), 100);
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

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const qq = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(qq) || (o.sub || "").toLowerCase().includes(qq));
  }, [options, q]);

  const selected = options.find((o) => o.value === value);
  const active = !!value;

  const toggle = () => {
    if (!open) place();
    setOpen((x) => !x);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(
          "group h-9 px-3 rounded-xl border text-[13px] outline-none transition-all flex items-center gap-2 min-w-[140px]",
          active
            ? "bg-brand-orange/10 border-brand-orange/30 text-brand-orange hover:bg-brand-orange/15"
            : "bg-neutral-50 border-transparent text-neutral-700 hover:bg-white hover:border-neutral-200",
          open && "bg-white border-brand-orange ring-4 ring-brand-orange/15"
        )}
      >
        {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-brand-orange" : "text-neutral-400")} strokeWidth={1.8} />}
        {label && !active && <span className="text-neutral-500 font-medium text-[12px] tracking-wide">{label}:</span>}
        <span className="truncate font-semibold flex items-center gap-1.5">
          {selected?.color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: selected.color }} />}
          {selected?.label || placeholder}
        </span>
        <ChevronDown className={cn("h-3 w-3 ml-auto text-neutral-400 transition-transform shrink-0", open && "rotate-180")} strokeWidth={2} />
      </button>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popRef}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="z-[80] bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden"
              style={{
                position: "fixed",
                left: coords.left,
                top: coords.top ?? undefined,
                bottom: coords.bottom ?? undefined,
                width: coords.width,
              }}
            >
              {searchable && options.length > 5 && (
                <div className="p-2 border-b border-neutral-100 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
                  <input
                    ref={searchRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar..."
                    className="w-full h-9 pl-8 pr-3 rounded-lg bg-neutral-50 border border-transparent text-sm outline-none focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
              )}
              <div className="max-h-[280px] overflow-y-auto py-1">
                {/* Opción "todos" / reset */}
                <button
                  type="button"
                  onClick={() => { onChange(""); setOpen(false); }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-[13px] flex items-center gap-2 hover:bg-neutral-50 transition-colors",
                    !value && "bg-brand-orange/5 text-brand-orange font-semibold"
                  )}
                >
                  <span className="h-4 w-4 rounded-full bg-neutral-100 text-neutral-400 text-[9px] flex items-center justify-center">∗</span>
                  <span className="flex-1">{placeholder}</span>
                  {!value && <Check className="h-3.5 w-3.5 text-brand-orange" strokeWidth={2.5} />}
                </button>

                {filtered.length === 0 && (
                  <div className="px-4 py-3 text-center text-[12px] text-neutral-400">Sin resultados</div>
                )}

                {filtered.map((o) => {
                  const isSelected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { onChange(o.value); setOpen(false); }}
                      className={cn(
                        "w-full px-3 py-2 text-left text-[13px] flex items-center gap-2.5 hover:bg-neutral-50 transition-colors",
                        isSelected && "bg-brand-orange/5"
                      )}
                    >
                      {o.avatar
                        ? <img src={o.avatar} className="h-6 w-6 rounded-full object-cover shrink-0" alt="" />
                        : o.initials
                          ? <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[9px] font-bold flex items-center justify-center shrink-0">{o.initials}</div>
                          : o.color
                            ? <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                            : o.icon
                              ? <o.icon className="h-4 w-4 text-neutral-400 shrink-0" strokeWidth={1.8} />
                              : null
                      }
                      <div className="flex-1 min-w-0">
                        <div className={cn("truncate", isSelected && "font-semibold text-brand-orange")}>{o.label}</div>
                        {o.sub && <div className="text-[10px] text-neutral-400 truncate">{o.sub}</div>}
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 text-brand-orange shrink-0" strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
