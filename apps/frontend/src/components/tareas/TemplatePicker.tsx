"use client";
import { useEffect, useState } from "react";
import { Sparkles, ChevronDown } from "@/lib/bootstrap-icons";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface Plantilla {
  id: string;
  nombre: string;
  titulo_tpl: string;
  descripcion_tpl: string | null;
  prioridad: "baja" | "normal" | "alta" | "urgente";
  responsable_default_id: string | null;
  observadores_default: string[];
  dias_vencimiento: number;
  horas_vencimiento: number;
  checklist_default: { texto: string; hecho?: boolean }[];
}

export function TemplatePicker({ onPick }: { onPick: (p: Plantilla) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/tareas/plantillas")
      .then((r) => r.json())
      .then((d) => setItems(d.plantillas || []))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="h-9 px-3 rounded-xl bg-brand-blue/10 text-brand-blue font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-blue/15 flex items-center gap-1.5 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
        Plantilla
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white rounded-2xl shadow-xl border border-neutral-100 overflow-hidden"
          >
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-[11px] text-neutral-400">Cargando…</div>
              ) : items.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-neutral-400">Sin plantillas creadas</div>
              ) : (
                items.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { onPick(p); setOpen(false); }}
                    className="w-full px-4 py-3 text-left hover:bg-neutral-50 border-b border-neutral-50 last:border-0"
                  >
                    <div className="font-semibold text-sm">{p.nombre}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{p.titulo_tpl}</div>
                    {(p.dias_vencimiento > 0 || p.horas_vencimiento > 0) && (
                      <div className="text-[10px] text-brand-orange font-ui uppercase tracking-wider mt-0.5">
                        Vence: +{p.dias_vencimiento}d {p.horas_vencimiento}h
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
