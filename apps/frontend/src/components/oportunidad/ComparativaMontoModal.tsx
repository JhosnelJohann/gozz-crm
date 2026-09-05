"use client";
import { X, ArrowRight } from "@/lib/bootstrap-icons";
import { AccionesSolicitud } from "@/components/solicitudes/AccionesSolicitud";
import { AnimatedModal } from "@/components/ui/AnimatedModal";

// Modal de SOLO LECTURA: Estado Actual vs Cambio Solicitado del monto (valor_total) de la oportunidad.
export function ComparativaMontoModal({ solicitud, valorActual, puedeAprobar, onClose, onResolved }: {
  solicitud: any; valorActual: number; puedeAprobar: boolean; onClose: () => void; onResolved: () => void;
}) {
  const antes = Number(valorActual ?? solicitud.monto_anterior ?? 0);
  const despues = Number(solicitud.monto_propuesto ?? 0);

  return (
    <AnimatedModal onClose={onClose} panelClassName="bg-white rounded-2xl w-full max-w-md">
        <div className="px-5 pt-5 pb-3 flex items-center gap-3 border-b border-neutral-100">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-orange">Solicitud de cambio de monto</div>
            <h3 className="font-display text-lg font-black">Estado Actual vs Cambio Solicitado</h3>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center shrink-0"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center rounded-lg px-3 py-2.5 bg-amber-50">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">Valor total actual</div>
              <div className="text-[16px] font-black text-neutral-600 tabular-nums">${antes.toFixed(2)}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-brand-orange" />
            <div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-400">Valor total solicitado</div>
              <div className="text-[16px] font-black text-brand-orange tabular-nums">${despues.toFixed(2)}</div>
            </div>
          </div>

          <div className="mt-4 text-[12px] text-neutral-500"><span className="font-semibold">Motivo:</span> {solicitud.motivo} · Solicitó: {solicitud.solicitante_nombre || "—"}</div>

          {solicitud.estado === "pendiente" && puedeAprobar && (
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <AccionesSolicitud endpointBase="monto-solicitudes" solId={solicitud.id} onResolved={onResolved} />
            </div>
          )}
        </div>
    </AnimatedModal>
  );
}
