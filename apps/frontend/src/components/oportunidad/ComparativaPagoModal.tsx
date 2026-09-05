"use client";
import { cn } from "@/lib/utils";
import { X, ArrowRight } from "@/lib/bootstrap-icons";
import { AccionesSolicitud } from "@/components/solicitudes/AccionesSolicitud";
import { AnimatedModal } from "@/components/ui/AnimatedModal";

const METODO_LABELS: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", tarjeta_tercero: "Tarjeta tercero",
  transferencia: "Transferencia", zelle: "Zelle", cashapp: "CashApp",
  descuento_referido: "Desc. referido", otro: "Otro",
};
const fmtMetodo = (m: any) => METODO_LABELS[m] || m || "—";

const FILAS = [
  { key: "monto", label: "Monto", fmt: (v: any) => `$${Number(v || 0).toFixed(2)}` },
  { key: "metodo", label: "Método", fmt: fmtMetodo },
  { key: "titular_tipo", label: "Titular", fmt: (v: any) => v || "cliente" },
  { key: "titular_nombre", label: "Nombre titular", fmt: (v: any) => v || "—" },
  { key: "fecha_pago", label: "Fecha", fmt: (v: any) => String(v || "").slice(0, 10) || "—" },
  { key: "notas", label: "Notas", fmt: (v: any) => v || "—" },
];

// Modal de SOLO LECTURA: Estado Actual vs Cambio Solicitado de un pago.
export function ComparativaPagoModal({ solicitud, pagoActual, puedeAprobar, onClose, onResolved }: {
  solicitud: any; pagoActual: any; puedeAprobar: boolean; onClose: () => void; onResolved: () => void;
}) {
  const antes = pagoActual || solicitud.datos_antes || {};
  const cambios = solicitud.cambios_propuestos || solicitud.detalle || {};
  const valorDespues = (campo: string) => (cambios[campo] !== undefined ? cambios[campo] : antes[campo]);
  const cambio = (campo: string) => String(antes[campo] ?? "") !== String(valorDespues(campo) ?? "");
  const comp = solicitud.comprobante_propuesto;

  return (
    <AnimatedModal onClose={onClose} panelClassName="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 flex items-center gap-3 border-b border-neutral-100">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-orange">Solicitud de cambio de pago</div>
            <h3 className="font-display text-lg font-black">Estado Actual vs Cambio Solicitado</h3>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center shrink-0"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
            <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 font-bold">Estado Actual</div>
            <ArrowRight className="h-3.5 w-3.5 text-neutral-300" />
            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-orange font-bold">Cambio Solicitado</div>
          </div>

          <div className="space-y-1.5">
            {FILAS.map((f) => {
              const changed = cambio(f.key);
              return (
                <div key={f.key} className={cn("grid grid-cols-[1fr_auto_1fr] gap-2 items-center rounded-lg px-2.5 py-1.5", changed ? "bg-amber-50" : "bg-neutral-50/60")}>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-neutral-400">{f.label}</div>
                    <div className="text-[13px] text-neutral-600 break-words">{f.fmt(antes[f.key])}</div>
                  </div>
                  <ArrowRight className={cn("h-3.5 w-3.5", changed ? "text-brand-orange" : "text-neutral-200")} />
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-neutral-400">{f.label}</div>
                    <div className={cn("text-[13px] break-words", changed ? "text-brand-orange font-bold" : "text-neutral-600")}>{f.fmt(valorDespues(f.key))}</div>
                  </div>
                </div>
              );
            })}

            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center rounded-lg px-2.5 py-1.5 bg-neutral-50/60">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-neutral-400">Comprobante</div>
                {antes.comprobante_url
                  ? <a href={antes.comprobante_url} target="_blank" rel="noopener" className="text-[12px] text-brand-blue hover:underline">Ver actual</a>
                  : <span className="text-[12px] text-neutral-400">—</span>}
              </div>
              <ArrowRight className={cn("h-3.5 w-3.5", comp?.url ? "text-brand-orange" : "text-neutral-200")} />
              <div>
                <div className="text-[9px] uppercase tracking-wider text-neutral-400">Comprobante</div>
                {comp?.url
                  ? <a href={comp.url} target="_blank" rel="noopener" className="text-[12px] text-brand-orange font-bold hover:underline">Ver propuesto ({solicitud.comprobante_modo === "reemplazar" ? "reemplaza" : "adicional"})</a>
                  : <span className="text-[12px] text-neutral-400">sin cambio</span>}
              </div>
            </div>
          </div>

          <div className="mt-4 text-[12px] text-neutral-500"><span className="font-semibold">Motivo:</span> {solicitud.motivo} · Solicitó: {solicitud.solicitante_nombre || "—"}</div>

          {solicitud.estado === "pendiente" && puedeAprobar && (
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <AccionesSolicitud endpointBase="pago-solicitudes" solId={solicitud.id} onResolved={onResolved} />
            </div>
          )}
        </div>
    </AnimatedModal>
  );
}
