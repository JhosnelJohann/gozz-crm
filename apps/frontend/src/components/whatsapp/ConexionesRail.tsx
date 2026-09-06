"use client";
import { motion } from "framer-motion";
import { WhatsappLogo, Plus, WifiOff, CircleDot, Trash, MoreVertical } from "@/lib/bootstrap-icons";
import { ShimmerButton } from "@/components/magic/ShimmerButton";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface WhatsAppConexion {
  id: string;
  nombre: string;
  telefono: string | null;
  estado: "pendiente" | "conectando" | "conectado" | "desconectado" | "error" | "cerrada";
  ultimo_error: string | null;
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

export function ConexionesRail({ conexiones, activeId, onSelect, onConnectNew, onDesconectar }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-wa-menu]") || t.closest("[data-wa-menu-trigger]")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuFor]);

  const openMenu = (id: string) => {
    const r = btnRefs.current[id]?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 6, left: Math.max(8, r.right - 200) });
    setMenuFor(id);
  };

  return (
    <aside className="shrink-0 relative h-full w-[272px] bg-bg-surface-2 dark:bg-white/[0.02] border-r border-black/5 dark:border-white/10 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-black/5 dark:border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-brand-green to-emerald-600 flex items-center justify-center text-white">
            <WhatsappLogo className="h-5 w-5" weight="fill" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-black text-sm">WhatsApp</div>
            <div className="text-[10px] text-neutral-500">{conexiones.length} conexión{conexiones.length === 1 ? "" : "es"}</div>
          </div>
        </div>
        <ShimmerButton onClick={onConnectNew} size="sm" className="w-full">
          <Plus className="h-3.5 w-3.5" /> Conectar número
        </ShimmerButton>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conexiones.length === 0 && (
          <div className="text-center text-[11px] text-neutral-400 px-4 py-8">
            Ninguna conexión todavía. Conecta un número de WhatsApp para empezar a recibir leads.
          </div>
        )}
        {conexiones.map((c) => {
          const ui = ESTADO_UI[c.estado];
          const active = c.id === activeId;
          return (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "group relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition cursor-pointer",
                active ? "bg-brand-primary/10 ring-1 ring-brand-primary/25" : "hover:bg-black/[0.03] dark:hover:bg-white/5"
              )}
              onClick={() => onSelect(c.id)}
            >
              <div className="relative shrink-0">
                <div className="h-10 w-10 rounded-full bg-brand-green/15 text-brand-green flex items-center justify-center font-bold text-sm">
                  {c.nombre.slice(0, 1).toUpperCase()}
                </div>
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-surface-2", ui.dot)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("text-[13px] font-bold truncate", active && "text-brand-primary")}>{c.nombre}</div>
                <div className="text-[10px] text-neutral-500 truncate flex items-center gap-1">
                  {c.estado === "error" ? <WifiOff className="h-2.5 w-2.5" /> : <CircleDot className="h-2.5 w-2.5" />}
                  {c.telefono || ui.label}
                </div>
              </div>
              <button
                ref={(el) => { btnRefs.current[c.id] = el; }}
                data-wa-menu-trigger
                onClick={(e) => { e.stopPropagation(); menuFor === c.id ? setMenuFor(null) : openMenu(c.id); }}
                className="h-7 w-7 rounded-lg text-neutral-400 hover:text-brand-primary hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shrink-0"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </div>

      {menuFor && menuPos && typeof document !== "undefined" && createPortal(
        <div
          data-wa-menu
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed z-[60] w-48 rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 text-sm overflow-hidden"
        >
          <button
            onClick={() => { const c = conexiones.find((x) => x.id === menuFor); setMenuFor(null); if (c) onDesconectar(c); }}
            className="w-full text-left px-3 py-2 hover:bg-brand-red/5 flex items-center gap-2.5 text-brand-red transition"
          >
            <Trash className="h-4 w-4" /> Desconectar
          </button>
        </div>,
        document.body
      )}
    </aside>
  );
}
