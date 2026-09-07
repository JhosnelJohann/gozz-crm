"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { WhatsappLogo, CaretDown, Plus, Trash, WifiOff, CircleDot } from "@/lib/bootstrap-icons";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";
import type { WhatsAppConexion } from "./types";

function mostrarTelefono(telefono: string | null): string | null {
  if (!telefono) return null;
  const { texto, bandera } = formatearNumeroWhatsApp(telefono);
  return bandera ? `${bandera} ${texto}` : texto;
}

const ESTADO_UI: Record<WhatsAppConexion["estado"], { label: string; dot: string }> = {
  pendiente: { label: "Sin conectar", dot: "bg-neutral-400" },
  conectando: { label: "Conectando…", dot: "bg-amber-400 animate-pulse" },
  conectado: { label: "Conectado", dot: "bg-brand-green" },
  desconectado: { label: "Desconectado", dot: "bg-neutral-400" },
  error: { label: "Error", dot: "bg-brand-red" },
  cerrada: { label: "Cerrada", dot: "bg-neutral-400" },
};

interface Props {
  conexiones: WhatsAppConexion[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onConnectNew: () => void;
  onDesconectar: (c: WhatsAppConexion) => void;
}

/**
 * Reemplaza el riel lateral fijo (272px) que ocupaba un panel completo casi siempre para mostrar
 * una sola conexión — el caso normal de uso. Un botón compacto en el header de la lista de
 * conversaciones, que se abre en un desplegable solo cuando hace falta elegir o conectar otra.
 */
export function ConnectionSwitcher({ conexiones, activeId, onSelect, onConnectNew, onDesconectar }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activa = conexiones.find((c) => c.id === activeId) || null;
  const ui = activa ? ESTADO_UI[activa.estado] : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 min-w-0 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-black/[0.03] dark:hover:bg-white/5 transition"
      >
        <div className="relative shrink-0">
          <div className="h-8 w-8 rounded-full bg-brand-green/15 text-brand-green flex items-center justify-center">
            <WhatsappLogo className="h-4 w-4" weight="fill" />
          </div>
          {ui && <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-canvas dark:border-[#0B0F16]", ui.dot)} />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-bold truncate">{activa?.nombre || "Sin conexión"}</div>
          <div className="text-[10px] text-neutral-500 truncate">{mostrarTelefono(activa?.telefono ?? null) || ui?.label || "Conecta un número"}</div>
        </div>
        <CaretDown className={cn("h-3.5 w-3.5 text-neutral-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 sm:right-auto sm:w-72 mt-1 z-30 rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 overflow-hidden"
          >
            {conexiones.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-neutral-400">Ninguna conexión todavía.</div>
            )}
            {conexiones.map((c) => {
              const u = ESTADO_UI[c.estado];
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 hover:bg-black/[0.03] dark:hover:bg-white/5 transition cursor-pointer",
                    c.id === activeId && "bg-brand-primary/8"
                  )}
                  onClick={() => { onSelect(c.id); setOpen(false); }}
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", u.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate">{c.nombre}</div>
                    <div className="text-[10px] text-neutral-500 truncate flex items-center gap-1">
                      {c.estado === "error" ? <WifiOff className="h-2.5 w-2.5" /> : <CircleDot className="h-2.5 w-2.5" />}
                      {mostrarTelefono(c.telefono) || u.label}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onDesconectar(c); }}
                    title="Desconectar"
                    className="h-7 w-7 rounded-lg text-neutral-400 hover:text-brand-red hover:bg-brand-red/10 flex items-center justify-center shrink-0 transition"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            <div className="border-t border-black/5 dark:border-white/10 mt-1 pt-1">
              <button
                onClick={() => { setOpen(false); onConnectNew(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary/8 transition"
              >
                <Plus className="h-4 w-4" /> Conectar número
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
