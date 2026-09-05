"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DollarSign, X, ArrowRight, ArrowLeftRight, Check, Ban } from "@/lib/bootstrap-icons";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";
import { initialsOf } from "@/lib/auth-user";
import { ComparativaMontoModal } from "@/components/oportunidad/ComparativaMontoModal";
import { ComparativaPagoModal } from "@/components/oportunidad/ComparativaPagoModal";
import { SolicitudDetalleModal } from "@/components/solicitudes/SolicitudDetalleModal";

// Banner de aprobación en vivo para solicitudes sobre oportunidades: cambio de MONTO, de PAGO y
// —desde 2026-08-12— de ETAPA EN MASA.
//
// 🔴 UNO SOLO PARA TODOS LOS TIPOS. Si cada tipo trae su banner, en seis meses hay cinco que se
// pisan por el mismo hueco de la pantalla. Añadir un tipo es sumar una rama aquí, no un componente.
//
// El backend emite 'solicitud:oportunidad' SOLO a quien puede aprobar ese tipo —monto/pago a quien
// tenga `editar_monto`, etapa a quien pase `aprobar_oportunidad_etapa`—, así que aquí **no se filtra
// por rol**: si el evento llegó, es porque el servidor ya decidió que esta persona puede.
//
// Al pulsar Aprobar/Rechazar NO se resuelve automáticamente: se abre el modal que corresponde, con
// su propia confirmación. El banner es un atajo para LLEGAR, no para saltarse el aviso.
interface SolicitudEvent {
  solicitud_id: string;
  tipo: "monto" | "pago" | "etapa";
  endpoint_base: string;          // "monto-solicitudes" | "pago-solicitudes" | "solicitudes"
  /** 🔴 NULL en las solicitudes sobre una selección: afectan a N, no a una. Ver `goTo`. */
  oportunidad_id: string | null;
  /** Vacío cuando no hay un caso concreto; el banner enseña el resumen en su lugar. */
  oportunidad_titulo: string | null;
  from_user_id: string;
  from_nombre: string;
  from_foto: string | null;
  detalle: string;                // ej. "$120.00 → $150.00" · "2 de Nuevo pasan a Ganado"
  motivo: string;
  timestamp: string;
}

export function SolicitudOportunidadBanner() {
  const router = useRouter();
  const [queue, setQueue] = useState<SolicitudEvent[]>([]);
  const [processing, setProcessing] = useState(false);
  const [modal, setModal] = useState<{ tipo: "monto" | "pago"; solicitud: any } | null>(null);
  /** Id de la solicitud cuyo detalle está abierto (tipos sobre una selección). */
  const [detalle, setDetalle] = useState<string | null>(null);

  useEffect(() => {
    const s = getSocket();
    const handler = (ev: SolicitudEvent) => {
      setQueue((q) => [...q, ev]);
      try {
        const a = new Audio("/sounds/notify.mp3");
        a.volume = 0.4;
        a.play().catch(() => {});
      } catch {}
    };
    s.on("solicitud:oportunidad", handler);
    return () => { s.off("solicitud:oportunidad", handler); };
  }, []);

  const current = queue[0];
  const dismiss = () => setQueue((q) => q.slice(1));

  // Abre el modal que corresponde al tipo (no aprueba/rechaza directo).
  const openReview = async () => {
    if (!current || processing) return;
    // El cambio de etapa se revisa en el detalle de la solicitud: es una selección, y lo que hay
    // que juzgar son los casos concretos. Es el MISMO modal que abre la bandeja.
    if (current.tipo === "etapa") { setDetalle(current.solicitud_id); return; }
    setProcessing(true);
    try {
      const base = current.tipo === "monto" ? "monto-solicitudes" : "pago-solicitudes";
      const r = await fetch(`/api/oportunidades/${current.oportunidad_id}/${base}`);
      const d = await r.json();
      const sol = (d.solicitudes || []).find((s: any) => s.id === current.solicitud_id);
      if (!sol) { toast.error("La solicitud ya no está disponible"); dismiss(); return; }
      setModal({ tipo: current.tipo, solicitud: sol });
    } catch (e: any) { toast.error(e.message || "Error"); } finally { setProcessing(false); }
  };

  const goTo = () => {
    if (!current) return;
    // 🔴 Sin `oportunidad_id` no hay caso al que ir: una solicitud sobre una selección afecta a N.
    // "Ver" lleva a la bandeja, que es donde se resuelven, en vez de a un enlace roto.
    router.push(current.oportunidad_id ? `/oportunidades/${current.oportunidad_id}` : "/solicitudes");
    dismiss();
  };

  const onResolved = () => { setModal(null); setDetalle(null); dismiss(); };
  const tipoTxt = current?.tipo === "monto" ? "cambio de monto"
    : current?.tipo === "pago" ? "cambio de pago"
    : "cambio de etapa en masa";
  const Icono = current?.tipo === "etapa" ? ArrowLeftRight : DollarSign;

  return (
    <>
      <AnimatePresence>
        {current && !modal && !detalle && (
          <motion.div
            key={current.solicitud_id}
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="fixed top-0 left-0 right-0 z-[80] px-4 pt-3"
          >
            <motion.div
              animate={{ boxShadow: ["0 8px 32px -8px rgba(87,80,232,0.45)", "0 12px 48px -8px rgba(87,80,232,0.6)", "0 8px 32px -8px rgba(87,80,232,0.45)"] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="mx-auto max-w-5xl rounded-2xl bg-gradient-to-r from-brand-orange to-brand-gold text-white flex items-center gap-3 px-4 py-3"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"
              >
                <Icono className="h-5 w-5" strokeWidth={2.2} />
              </motion.div>

              {current.from_foto ? (
                <img src={current.from_foto} className="h-8 w-8 rounded-full border-2 border-white/80 object-cover shrink-0" alt="" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-white/20 text-[10px] font-bold flex items-center justify-center shrink-0">
                  {initialsOf(current.from_nombre || "?")}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-ui uppercase tracking-[0.12em] opacity-90">
                  {current.from_nombre} solicita {tipoTxt} · <strong>{current.detalle}</strong>
                </div>
                {/* Sin caso concreto —una selección afecta a N— no se deja el hueco ni se pinta un
                    "undefined:": se enseña solo el motivo, y si tampoco lo hay, se dice. */}
                <div className="font-display font-bold text-sm truncate">
                  {current.oportunidad_titulo && (
                    <span className="opacity-80 font-normal">{current.oportunidad_titulo}: </span>
                  )}
                  {current.motivo || <span className="opacity-80 font-normal">Sin motivo indicado</span>}
                </div>
              </div>

              <button
                onClick={openReview}
                disabled={processing}
                className="h-9 px-3 rounded-xl bg-brand-green text-white font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-green-600 flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Aprobar
              </button>
              <button
                onClick={openReview}
                disabled={processing}
                className="h-9 px-3 rounded-xl bg-brand-red text-white font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-red-600 flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-60"
              >
                <Ban className="h-3.5 w-3.5" strokeWidth={2.5} />
                Rechazar
              </button>
              <button
                onClick={goTo}
                className="h-9 px-4 rounded-xl bg-white text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-white/90 flex items-center gap-1.5 transition-colors shrink-0"
              >
                Ver
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>

              <button
                onClick={dismiss}
                className="h-9 w-9 rounded-xl hover:bg-white/15 flex items-center justify-center shrink-0"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>

              {queue.length > 1 && (
                <span className="h-6 px-2 rounded-full bg-white/25 text-[10px] font-bold flex items-center shrink-0">
                  +{queue.length - 1}
                </span>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal comparativo: Aprobar/Rechazar con confirmación (no acción automática). */}
      {modal?.tipo === "monto" && (
        <ComparativaMontoModal
          solicitud={modal.solicitud}
          valorActual={Number(modal.solicitud.monto_anterior ?? 0)}
          puedeAprobar
          onClose={() => setModal(null)}
          onResolved={onResolved}
        />
      )}
      {modal?.tipo === "pago" && (
        <ComparativaPagoModal
          solicitud={modal.solicitud}
          pagoActual={modal.solicitud.datos_antes}
          puedeAprobar
          onClose={() => setModal(null)}
          onResolved={onResolved}
        />
      )}

      {/* El MISMO detalle que abre la bandeja: el banner es un atajo para llegar, no para
          saltarse el aviso. Al cerrarlo sin resolver, el banner vuelve. */}
      {detalle && (
        <SolicitudDetalleModal
          solicitudId={detalle}
          onClose={() => setDetalle(null)}
          onResuelta={onResolved}
        />
      )}
    </>
  );
}
