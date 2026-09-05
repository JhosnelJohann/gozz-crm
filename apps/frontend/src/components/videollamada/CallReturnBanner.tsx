"use client";
import { Video, Maximize2 } from "@/lib/bootstrap-icons";

// Banner global que aparece cuando hay una llamada activa pero minimizada ("Ver CRM").
// Permite volver a la llamada a pantalla completa desde cualquier seccion del CRM.
export function CallReturnBanner({ title, onReturn }: { title: string; onReturn: () => void }) {
  return (
    <button
      onClick={onReturn}
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[105] inline-flex items-center gap-3 pl-4 pr-2 py-2 rounded-full bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-xl shadow-emerald-600/30 ring-1 ring-white/20 hover:scale-[1.02] active:scale-95 transition-transform"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
      </span>
      <Video className="h-4 w-4" strokeWidth={2.4} />
      <span className="text-[13px] font-bold tracking-tight">Llamada en curso · <span className="opacity-90 font-semibold">{title}</span></span>
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/20 text-[11px] font-bold uppercase tracking-wider">
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.6} /> Volver
      </span>
    </button>
  );
}
