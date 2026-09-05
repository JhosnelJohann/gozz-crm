"use client";
// ============================================================================================
// DETALLE DE UNA SOLICITUD — qué se está aprobando exactamente
//
// 🔴 La bandeja enseñaba "2 oportunidades → nuevo" y el motivo. Quien aprueba no sabía CUÁLES eran
// esas dos, ni de qué clientes, ni de dónde venían — y su nombre queda firmando en `aprobador_id`.
// **Una aprobación sin visibilidad no es una aprobación: es un sello de goma.**
//
// El estado que se enseña es el de HOY, leído al abrir: entre pedir y aprobar pueden pasar horas.
// Lo que ya no cuadra con lo que se pidió sale **marcado**, no omitido.
//
// Es el MISMO componente para la bandeja y para el banner de aprobación: el banner es un atajo para
// llegar aquí, no para saltarse el aviso.
// ============================================================================================
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Ban, Check, Loader2, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Discrepancia { codigo: string; texto: string; detalle?: string[] }
interface Item {
  id: string;
  titulo: string | null;
  campos: { etiqueta: string; valor: string | null }[];
  actual: string | null;
  solicitado: string | null;
  discrepancias: Discrepancia[];
}
interface Detalle {
  solicitud: any;
  items: Item[];
  efectos?: {
    aplicables: number;
    automatizaciones: number;
    puntos: number;
    fechas_completada: number;
  };
  discrepancias: { total: number; resumen: { codigo: string; texto: string; n: number }[] };
}

const CAMPO_LEGIBLE: Record<string, string> = {
  contacto_id: "contacto vinculado",
  tipo_tramite_id: "trámite",
  preparador_id: "preparador",
  vendedor_id: "vendedor",
  valor_total: "valor total",
  sla_fecha_limite: "fecha límite del SLA",
  cuestionario_firmado: "cuestionario firmado",
};

export function SolicitudDetalleModal({
  solicitudId, onClose, onResuelta,
}: {
  solicitudId: string;
  onClose: () => void;
  onResuelta?: () => void;
}) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<null | "aprobar" | "rechazar">(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/solicitudes/${solicitudId}/detalle`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo cargar el detalle");
      setD(j);
    } catch (e: any) { setError(e.message); }
  }, [solicitudId]);

  useEffect(() => { cargar(); }, [cargar]);

  const puedeAprobar = !!d?.solicitud?.puede_aprobar;
  const pendiente = d?.solicitud?.estado === "pendiente";
  const efectos = d?.efectos;
  const hayEfectos = !!efectos && (efectos.automatizaciones > 0 || efectos.puntos > 0 || efectos.fechas_completada > 0);

  const resolver = async (confirmarCambios = false) => {
    if (!accion) return;
    if (accion === "rechazar" && !motivoRechazo.trim()) { toast.error("El motivo del rechazo es obligatorio"); return; }
    setOcupado(true);
    try {
      const r = await fetch(`/api/solicitudes/${solicitudId}/${accion}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accion === "rechazar"
          ? { motivo_rechazo: motivoRechazo.trim() }
          : { confirmar_cambios: confirmarCambios }),
      });
      const j = await r.json();
      if (!r.ok) {
        // El servidor recalcula por su cuenta al aprobar: si el conjunto cambió entre que se abrió
        // este modal y el clic, para y lo dice. Se pregunta antes de insistir.
        if (r.status === 409 && j.aplicables_ahora !== undefined) {
          const seguir = window.confirm(
            `El conjunto ha cambiado desde que se pidió: se pidieron ${j.afectadas_al_pedir} y hoy ` +
            `${j.aplicables_ahora} se pueden aplicar.\n\n¿Ejecutar igualmente sobre las que sí se pueden?`
          );
          if (seguir) { setOcupado(false); return resolver(true); }
          await cargar();
          throw new Error("Operación detenida: revisa el detalle actualizado.");
        }
        throw new Error(j.error || "No se pudo resolver");
      }
      toast.success(accion === "aprobar" ? "Solicitud aprobada y ejecutada" : "Solicitud rechazada");
      onResuelta?.();
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setOcupado(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-black">Qué se está aprobando</h3>
            {d && (
              <p className="text-[12px] text-neutral-500 mt-0.5">
                Pedido por <strong className="text-neutral-800">{d.solicitud.solicitante_nombre || "—"}</strong>
                {" · "}<strong className="tabular-nums text-neutral-800">{d.items.length}</strong>{" "}
                oportunidad{d.items.length === 1 ? "" : "es"}
                {d.solicitud.motivo && <> · <em>{d.solicitud.motivo}</em></>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {error && <p className="px-5 py-8 text-center text-[13px] text-brand-red">{error}</p>}
          {!d && !error && <p className="px-5 py-10 text-center text-neutral-400 text-sm">Cargando…</p>}

          {d && (
            <>
              {/* 🔴 Las discrepancias, arriba y con su número: es lo que decide si esto se aprueba. */}
              {d.discrepancias.total > 0 && (
                <div className="mx-5 mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-ui font-bold uppercase tracking-wider text-amber-800 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {d.discrepancias.total} de {d.items.length} ya no {d.discrepancias.total === 1 ? "está" : "están"} como cuando se pidió
                  </div>
                  <ul className="text-[13px] text-amber-900 space-y-1 list-disc pl-5">
                    {d.discrepancias.resumen.map((x) => (
                      <li key={x.codigo}><strong className="tabular-nums">{x.n}</strong> {x.texto}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="px-5 py-4 space-y-2">
                {d.items.map((it) => (
                  <div
                    key={it.id}
                    className={cn(
                      "rounded-xl border px-4 py-3",
                      it.discrepancias.length ? "border-amber-300 bg-amber-50/40" : "border-neutral-200"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-semibold text-[13px] truncate">{it.titulo || "(caso sin nombre)"}</div>
                        <div className="text-[11px] text-neutral-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          {it.campos.filter((c) => c.valor).map((c) => (
                            <span key={c.etiqueta}>{c.etiqueta}: <span className="text-neutral-700">{c.valor}</span></span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[12px] shrink-0">
                        <span className="px-2 py-1 rounded-lg bg-neutral-100 text-neutral-700">{it.actual ?? "—"}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
                        <span className="px-2 py-1 rounded-lg bg-brand-orange/10 text-brand-orange font-bold">{it.solicitado ?? "—"}</span>
                      </div>
                    </div>
                    {it.discrepancias.length > 0 && (
                      <ul className="mt-2 text-[12px] text-amber-900 space-y-0.5">
                        {it.discrepancias.map((x) => (
                          <li key={x.codigo}>
                            ⚠️ {x.texto}
                            {x.detalle?.length ? <> — falta{x.detalle.length === 1 ? "" : "n"} {x.detalle.map((f) => CAMPO_LEGIBLE[f] || f).join(", ")}</> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {/* Los efectos, RECALCULADOS ahora: quien aprueba es quien ejecuta. */}
              {efectos && (
                <div className="mx-5 mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-ui font-bold uppercase tracking-wider text-amber-800 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5" /> Si lo apruebas, además de mover las tarjetas
                  </div>
                  {hayEfectos ? (
                    <ul className="text-[13px] text-amber-900 space-y-1 list-disc pl-5">
                      {efectos.automatizaciones > 0 && (
                        <li>Se ejecutarán <strong className="tabular-nums">{efectos.automatizaciones}</strong> automatización
                          {efectos.automatizaciones === 1 ? "" : "es"}. Si alguna crea tareas, aparecerán en las bandejas de la gente.</li>
                      )}
                      {efectos.puntos > 0 && (
                        <li>Se repartirán puntos a los vendedores de <strong className="tabular-nums">{efectos.puntos}</strong>{" "}
                          oportunidad{efectos.puntos === 1 ? "" : "es"} — <strong>afecta a sus marcadores</strong>.</li>
                      )}
                      {efectos.fechas_completada > 0 && (
                        <li>Se registrará <strong>la fecha de ganado</strong> en{" "}
                          <strong className="tabular-nums">{efectos.fechas_completada}</strong> oportunidad
                          {efectos.fechas_completada === 1 ? "" : "es"} — <strong>volver a la etapa anterior no la borra</strong>.</li>
                      )}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-amber-900">
                      Además de mover las tarjetas, <strong>no se disparará nada más</strong>.
                    </p>
                  )}
                  <p className="text-[12px] text-amber-800/80 mt-2">
                    Se aplicaría a <strong className="tabular-nums">{efectos.aplicables}</strong> de {d.items.length}.
                  </p>
                </div>
              )}

              {accion === "rechazar" && (
                <div className="mx-5 mb-4">
                  <label className="block text-xs font-bold text-neutral-500 mb-1">
                    Motivo del rechazo <span className="text-brand-red">*</span> (para que el solicitante lo entienda)
                  </label>
                  <textarea
                    rows={3} value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)}
                    placeholder="Ej: estas dos todavía no están cobradas…"
                    className="w-full border-2 border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-brand-orange resize-none"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-2">
          {d && !pendiente && (
            <span className="text-[12px] text-neutral-500">
              Esta solicitud ya está <strong>{d.solicitud.estado}</strong>.
            </span>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Cerrar</button>
          {/* El botón no se le ofrece a quien no puede usarlo: lo dice el servidor, no el navegador. */}
          {d && pendiente && puedeAprobar && (
            accion === null ? (
              <>
                <button onClick={() => setAccion("rechazar")}
                  className="px-4 py-2 rounded-xl bg-brand-red/10 text-brand-red text-sm font-bold flex items-center gap-1.5">
                  <Ban className="h-3.5 w-3.5" /> Rechazar
                </button>
                <button onClick={() => setAccion("aprobar")}
                  className="px-4 py-2 rounded-xl bg-brand-green text-white text-sm font-bold flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" /> Aprobar
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setAccion(null)} disabled={ocupado}
                  className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold disabled:opacity-60">Volver</button>
                <button
                  onClick={() => resolver(false)}
                  disabled={ocupado || (accion === "rechazar" && !motivoRechazo.trim())}
                  className={cn("px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-40 flex items-center gap-2",
                    accion === "aprobar" ? "bg-brand-green" : "bg-brand-red")}
                >
                  {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                  {accion === "aprobar" ? "Sí, aprobar y ejecutar" : "Rechazar solicitud"}
                </button>
              </>
            )
          )}
        </div>
      </motion.div>
    </div>
  );
}
