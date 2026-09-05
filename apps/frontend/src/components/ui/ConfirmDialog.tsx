"use client";
import { useState } from "react";
import { AnimatedModal } from "./AnimatedModal";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "@/lib/bootstrap-icons";

/**
 * Diálogo de confirmación reutilizable con el estilo del CRM (usa AnimatedModal). Reemplaza el
 * confirm() nativo del navegador. Montaje condicional desde el padre: `{target && <ConfirmDialog .../>}`.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  icon,
  requireText,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  icon?: React.ReactNode;
  /** Si se define, exige escribir EXACTAMENTE este texto para habilitar el botón de confirmar. */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const locked = !!requireText && typed !== requireText;
  return (
    <AnimatedModal
      onClose={() => { if (!busy) onCancel(); }}
      panelClassName="bg-white dark:bg-neutral-900 rounded-2xl p-5 w-full max-w-md shadow-2xl border border-black/5 dark:border-white/10"
    >
      <div className="flex items-start gap-3">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", danger ? "bg-brand-red/10 text-brand-red" : "bg-brand-orange/10 text-brand-orange")}>
          {icon || <AlertTriangle className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-black leading-tight">{title}</h3>
          <div className="text-[13px] text-neutral-600 dark:text-neutral-300 mt-1">{message}</div>
        </div>
      </div>
      {requireText && (
        <div className="mt-4">
          <label className="block text-[12px] text-neutral-500 dark:text-neutral-400 mb-1.5">
            Para confirmar, escribe <strong className="text-brand-red font-black tracking-wide">{requireText}</strong>
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireText}
            className="w-full h-10 px-3 rounded-xl bg-neutral-100 dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm font-bold tracking-wide outline-none focus:border-brand-red/50 focus:ring-2 focus:ring-brand-red/20 transition"
          />
        </div>
      )}
      <div className="flex gap-2 justify-end mt-5">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 text-sm font-bold hover:bg-neutral-200 dark:hover:bg-white/15 disabled:opacity-60 transition"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy || locked}
          className={cn(
            "px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed transition",
            danger ? "bg-brand-red hover:bg-brand-red/90" : "bg-brand-orange hover:bg-brand-orange/90"
          )}
        >
          {busy ? "…" : confirmLabel}
        </button>
      </div>
    </AnimatedModal>
  );
}
