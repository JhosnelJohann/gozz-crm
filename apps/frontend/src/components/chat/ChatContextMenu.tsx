"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Pin, PinOff, User, Clock, Bell, BellOff } from "@/lib/bootstrap-icons";
import { ArchiveDownIcon, ArchiveUpIcon } from "./ArchiveIcons";

export type CtxAction = "toggle-fijar" | "toggle-silenciar" | "toggle-ocultar" | "ver-perfil" | "recordar" | "quitar-recordar";

interface Props {
  open: boolean;
  x: number;
  y: number;
  fijado: boolean;
  silenciado: boolean;
  oculto: boolean;
  recordando: boolean;
  tipo: string;
  onPick: (a: CtxAction) => void;
  onClose: () => void;
}

export function ChatContextMenu({ open, x, y, fijado, silenciado, oculto, recordando, tipo, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // El sidebar usa backdrop-filter (glass) → crea un contexto de apilamiento que atraparía
  // este menú `fixed` detrás del contenido. Lo portamos a <body> para que escape ese contexto.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // No cerrar si el click es sobre el chevron que abre/cierra el menú: ese botón maneja
      // su propio toggle (si cerráramos aquí, el onClick del chevron lo reabriría al instante).
      if (t?.closest?.("[data-chat-menu-trigger]")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("contextmenu", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("contextmenu", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open, onClose]);

  // Ajustar al viewport
  const W = 240, H = 244;
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1920) - W - 8);
  const top  = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 1080) - H - 8);

  const items: { key: CtxAction; label: string; Icon: any; danger?: boolean }[] = [
    { key: "toggle-fijar",     label: fijado ? "Desfijar chat" : "Fijar chat",          Icon: fijado ? PinOff : Pin },
    { key: "toggle-silenciar", label: silenciado ? "Activar sonido" : "Silenciar",      Icon: silenciado ? Bell : BellOff },
    recordando
      ? { key: "quitar-recordar", label: "Quitar recordatorio", Icon: BellOff }
      : { key: "recordar",        label: "Marcar para leer más tarde", Icon: Clock },
    { key: "ver-perfil",     label: tipo === "directo" ? "Ver perfil" : "Ver detalles", Icon: User },
    { key: "toggle-ocultar", label: oculto ? "Desarchivar chat" : "Archivar chat", Icon: oculto ? ArchiveUpIcon : ArchiveDownIcon },
  ];

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.12 }}
          style={{ left, top, width: W }}
          className="fixed z-[80] modal-surface rounded-xl shadow-2xl border border-black/5 dark:border-white/10 overflow-hidden py-1"
        >
          {items.map((it) => {
            const Icon = it.Icon;
            return (
              <button
                key={it.key}
                onClick={(e) => { e.stopPropagation(); onPick(it.key); }}
                className={"w-full px-3 py-2 flex items-center gap-3 text-sm text-left transition " +
                  (it.danger ? "hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400"
                             : "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]")}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="truncate">{it.label}</span>
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
