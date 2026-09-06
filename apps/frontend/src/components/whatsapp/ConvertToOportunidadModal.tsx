"use client";
import { useState } from "react";
import { toast } from "sonner";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { Button } from "@/components/ui/Button";
import { X, Briefcase } from "@/lib/bootstrap-icons";

interface Props {
  nombreSugerido: string;
  onClose: () => void;
  onConvertido: (d: { nombreCaso: string; valorTotal?: number }) => Promise<void>;
}

export function ConvertToOportunidadModal({ nombreSugerido, onClose, onConvertido }: Props) {
  const [nombreCaso, setNombreCaso] = useState(nombreSugerido);
  const [valorTotal, setValorTotal] = useState("");
  const [guardando, setGuardando] = useState(false);

  const confirmar = async () => {
    if (nombreCaso.trim().length < 2) { toast.error("Ponle un nombre al caso"); return; }
    setGuardando(true);
    try {
      await onConvertido({ nombreCaso: nombreCaso.trim(), valorTotal: valorTotal ? Number(valorTotal) : undefined });
      toast.success("Conversación convertida en Oportunidad");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo convertir");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <AnimatedModal onClose={onClose} panelClassName="w-full max-w-sm glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center">
          <Briefcase className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1 font-display font-black text-sm">Convertir a Oportunidad</div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-5 space-y-3">
        <div>
          <label className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Nombre del caso</label>
          <input
            autoFocus
            value={nombreCaso}
            onChange={(e) => setNombreCaso(e.target.value)}
            className="mt-1 w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
          />
        </div>
        <div>
          <label className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Valor estimado (opcional)</label>
          <input
            type="number"
            value={valorTotal}
            onChange={(e) => setValorTotal(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
          />
        </div>
        <Button onClick={confirmar} disabled={guardando} className="w-full">
          {guardando ? "Convirtiendo…" : "Convertir"}
        </Button>
      </div>
    </AnimatedModal>
  );
}
