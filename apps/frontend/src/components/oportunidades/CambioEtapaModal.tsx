"use client";
// ============================================================================================
// CAMBIO DE ETAPA EN MASA — modal de armado y confirmación
//
// 🔴 POR QUÉ ESTE MODAL ES TAN INSISTENTE. Cambiar la etapa NO es mover una tarjeta: dispara las
// automatizaciones de la etapa destino (una de `crear_tarea` sobre 100 casos crea 100 tareas en las
// bandejas de la gente), reparte puntos a los vendedores y escribe `fecha_completada`. **Nada de eso
// se ve en pantalla.** Quien pulsa cree que ordena el tablero.
//
// Por eso hay dos pasos: se arma fila a fila, y después se confirma viendo QUÉ va a pasar con los
// números reales — contados en vivo por el servidor, no supuestos aquí.
// ============================================================================================
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2, RotateCcw, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/lib/pipeline";

export interface OportunidadSeleccionada {
  id: string;
  nombre_caso: string;
  etapa: string;
  valor_total: string | number | null;
  contacto_nombre: string | null;
  tramite_nombre: string | null;
  tramite_color: string | null;
  preparador_nombre: string | null;
}

interface Previa {
  aplicables: number;
  transiciones: { desde: string | null; hasta: string; n: number }[];
  automatizaciones: number;
  automatizaciones_por_etapa: { etapa: string; activas: number; oportunidades: number }[];
  puntos: number;
  fechas_completada: number;
  omitidas: { id: string; nombre_caso: string | null; etapa_destino: string; motivo: string; faltan?: string[] }[];
  puede_aplicar: boolean;
  maximo: number;
}

/** La palabra tiene que escribirse EXACTA. Ni `trim()` ni mayúsculas automáticas: es el guardarraíl. */
const PALABRA = "CAMBIAR";

const CAMPO_LEGIBLE: Record<string, string> = {
  contacto_id: "contacto vinculado",
  tipo_tramite_id: "trámite",
  preparador_id: "preparador",
  vendedor_id: "vendedor",
  valor_total: "valor total",
  sla_fecha_limite: "fecha límite del SLA",
  cuestionario_firmado: "cuestionario firmado",
};

export function CambioEtapaModal({
  oportunidades, stages, onClose, onAplicado,
}: {
  oportunidades: OportunidadSeleccionada[];
  stages: PipelineStage[] | null;
  onClose: () => void;
  onAplicado: () => void;
}) {
  const originales = useMemo(
    () => Object.fromEntries(oportunidades.map((o) => [o.id, o.etapa])) as Record<string, string>,
    [oportunidades]
  );
  const [destinos, setDestinos] = useState<Record<string, string>>(originales);
  const [paso, setPaso] = useState<"armado" | "confirmacion">("armado");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [palabra, setPalabra] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  const activas = useMemo(() => (stages || []).filter((s) => s.activa !== false), [stages]);
  const label = (key: string) => activas.find((s) => s.key === key)?.label || key;
  const color = (key: string) => activas.find((s) => s.key === key)?.color || "#5C6670";

  /** Solo se manda lo que de verdad cambia: una fila que sigue en su etapa no es un cambio. */
  const cambios = useMemo(
    () => Object.fromEntries(Object.entries(destinos).filter(([id, e]) => e !== originales[id])),
    [destinos, originales]
  );
  const nCambios = Object.keys(cambios).length;
  const hayTrabajo = nCambios > 0;

  // 🔴 Cerrar con trabajo hecho pide confirmación: se pueden haber ajustado cincuenta filas una a
  // una, y perderlo por un clic fuera del modal es inaceptable.
  const intentarCerrar = () => {
    if (hayTrabajo && paso === "armado") { setConfirmarCierre(true); return; }
    onClose();
  };

  const cambiarTodas = (etapa: string) => {
    if (!etapa) return;
    setDestinos(Object.fromEntries(oportunidades.map((o) => [o.id, etapa])));
  };
  const deshacer = () => setDestinos(originales);

  const irAConfirmacion = async () => {
    setOcupado(true);
    try {
      const r = await fetch("/api/oportunidades/etapa/previa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cambios }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo calcular el resumen");
      setPrevia(d);
      setPalabra("");
      setPaso("confirmacion");
    } catch (e: any) { toast.error(e.message); } finally { setOcupado(false); }
  };

  // ¿Este envío APLICA de verdad, o solo deja una solicitud? Lo decide el servidor; aquí solo se
  // pinta lo que dijo.
  const aplicaDeVerdad = !!previa?.puede_aplicar;
  const exigePalabra = aplicaDeVerdad && nCambios >= 2;
  const puedeEnviar = !ocupado && (!exigePalabra || palabra === PALABRA);
  const hayEfectos = !!previa && (previa.automatizaciones > 0 || previa.puntos > 0 || previa.fechas_completada > 0);

  const enviar = async () => {
    setOcupado(true);
    try {
      const r = await fetch("/api/oportunidades/etapa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seleccion: { modo: "ids", ids: Object.keys(cambios) },
          cambios,
          motivo: motivo.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo aplicar");
      if (d.aplicado) {
        const om = d.omitidas?.length ?? 0;
        toast.success(
          `${d.cambiadas} oportunidad${d.cambiadas === 1 ? "" : "es"} cambiada${d.cambiadas === 1 ? "" : "s"}` +
          (om ? ` · ${om} quedaron fuera` : "")
        );
      } else {
        toast.success("Solicitud enviada. No se ha cambiado nada hasta que la aprueben.");
      }
      onAplicado();
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setOcupado(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={intentarCerrar}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-black">
              {paso === "armado" ? "Cambiar etapa" : aplicaDeVerdad ? "Confirmar el cambio" : "Enviar solicitud"}
            </h3>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {paso === "armado"
                ? <>Se van a cambiar <strong className="text-neutral-800 tabular-nums">{nCambios}</strong> de {oportunidades.length} oportunidad{oportunidades.length === 1 ? "" : "es"} seleccionada{oportunidades.length === 1 ? "" : "s"}.</>
                : <>Revisa lo que va a pasar antes de {aplicaDeVerdad ? "aplicarlo" : "pedirlo"}.</>}
            </p>
          </div>
          <button onClick={intentarCerrar} className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {paso === "armado" && (
          <>
            <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2 flex-wrap bg-neutral-50/60">
              <label className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Cambiar todas las etapas</label>
              <select
                value=""
                onChange={(e) => cambiarTodas(e.target.value)}
                className="h-9 pl-3 pr-8 rounded-lg bg-white border border-black/10 text-[13px] outline-none focus:ring-2 focus:ring-brand-orange/30 cursor-pointer"
              >
                <option value="">Elige una etapa…</option>
                {activas.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button
                onClick={deshacer}
                disabled={!hayTrabajo}
                title="Devuelve cada fila a su etapa original"
                className="h-9 px-3 rounded-lg bg-white border border-black/10 text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Deshacer
              </button>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-black/[0.02] text-[11px] font-ui uppercase tracking-wider text-neutral-500 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5">Caso</th>
                    <th className="text-left px-3 py-2.5">Trámite</th>
                    <th className="text-left px-3 py-2.5">Contacto</th>
                    <th className="text-right px-3 py-2.5">Valor</th>
                    <th className="text-left px-3 py-2.5">Responsable</th>
                    <th className="text-left px-3 py-2.5">Etapa destino</th>
                  </tr>
                </thead>
                <tbody>
                  {oportunidades.map((o) => {
                    const cambiada = destinos[o.id] !== originales[o.id];
                    return (
                      <tr key={o.id} className={cn("border-t border-black/5", cambiada && "bg-brand-orange/[0.04]")}>
                        <td className="px-4 py-2 font-semibold max-w-[220px] truncate" title={o.nombre_caso}>{o.nombre_caso}</td>
                        <td className="px-3 py-2">
                          {o.tramite_nombre ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: o.tramite_color || "#5C6670" }} />
                              <span className="truncate max-w-[120px]">{o.tramite_nombre}</span>
                            </span>
                          ) : <span className="text-[11px] italic text-neutral-400">sin trámite</span>}
                        </td>
                        <td className="px-3 py-2 truncate max-w-[160px]">{o.contacto_nombre || <span className="text-neutral-400">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {Number(o.valor_total) > 0 ? `$${Number(o.valor_total).toFixed(0)}` : <span className="text-neutral-400">—</span>}
                        </td>
                        <td className="px-3 py-2 truncate max-w-[140px]">{o.preparador_nombre || <span className="text-neutral-400">sin asignar</span>}</td>
                        <td className="px-3 py-2">
                          <select
                            value={destinos[o.id] ?? o.etapa}
                            onChange={(e) => setDestinos((d) => ({ ...d, [o.id]: e.target.value }))}
                            className={cn(
                              "h-8 pl-2 pr-7 rounded-lg border text-[12px] outline-none focus:ring-2 focus:ring-brand-orange/30 cursor-pointer",
                              cambiada ? "border-brand-orange/50 bg-brand-orange/5 font-bold" : "border-black/10 bg-white"
                            )}
                            style={cambiada ? { color: color(destinos[o.id]) } : undefined}
                          >
                            {activas.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                            {/* Una etapa retirada del pipeline sigue siendo la actual de esta fila:
                                se ofrece para poder dejarla como está en vez de forzar un cambio. */}
                            {!activas.some((s) => s.key === o.etapa) && <option value={o.etapa}>{o.etapa} (retirada)</option>}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-2">
              <span className="text-[12px] text-neutral-500">
                {hayTrabajo
                  ? <><strong className="tabular-nums text-neutral-800">{nCambios}</strong> con etapa nueva</>
                  : "Ninguna fila ha cambiado de etapa todavía"}
              </span>
              <div className="flex-1" />
              <button onClick={intentarCerrar} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Cancelar</button>
              <button
                onClick={irAConfirmacion}
                disabled={!hayTrabajo || ocupado}
                className="px-4 py-2 rounded-xl bg-brand-orange text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {ocupado && <Loader2 className="h-4 w-4 animate-spin" />} Continuar
              </button>
            </div>
          </>
        )}

        {paso === "confirmacion" && previa && (
          <>
            <div className="overflow-auto flex-1 px-5 py-4 space-y-4">
              {/* 1 · El resumen AGREGADO. Una línea por transición, no cien filas: hay que poder
                     juzgarlo de un vistazo. */}
              <div>
                <div className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-2">Qué se va a mover</div>
                {previa.transiciones.length === 0 && (
                  <p className="text-[13px] text-neutral-500">Nada: todas las filas quedaron fuera. Mira el detalle de abajo.</p>
                )}
                <ul className="space-y-1">
                  {previa.transiciones.map((t) => (
                    <li key={`${t.desde}-${t.hasta}`} className="text-[13px] text-neutral-700">
                      <strong className="tabular-nums">{t.n}</strong> de{" "}
                      <span className="font-semibold" style={{ color: color(t.desde || "") }}>{label(t.desde || "—")}</span>{" "}
                      pasan a <span className="font-semibold" style={{ color: color(t.hasta) }}>{label(t.hasta)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 2 · 🔴 LO QUE SE DISPARA ADEMÁS. Con los números reales, en negrita. Es lo que
                     separa un aviso que se lee de uno que se acepta sin mirar.
                     Solo se enumera lo que VA A PASAR: una línea que dice "0" no informa, distrae de
                     las que sí traen número. Pero el bloque NO desaparece cuando no hay nada: que el
                     sistema diga "lo he comprobado y no hay efectos" vale más que el silencio, que
                     no distingue "no pasa nada" de "no lo miré". */}
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-ui font-bold uppercase tracking-wider text-amber-800 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5" /> Además de mover las tarjetas, esto va a pasar
                </div>
                {hayEfectos ? (
                  <ul className="text-[13px] text-amber-900 space-y-1 list-disc pl-5">
                    {previa.automatizaciones > 0 && (
                      <li>
                        Se ejecutarán <strong className="tabular-nums">{previa.automatizaciones}</strong> automatización
                        {previa.automatizaciones === 1 ? "" : "es"} de las etapas destino. Si alguna crea tareas,
                        aparecerán en las bandejas de la gente.
                      </li>
                    )}
                    {previa.puntos > 0 && (
                      <li>
                        Se repartirán puntos a los vendedores de <strong className="tabular-nums">{previa.puntos}</strong>{" "}
                        oportunidad{previa.puntos === 1 ? "" : "es"} — <strong>afecta a sus marcadores</strong>.
                      </li>
                    )}
                    {previa.fechas_completada > 0 && (
                      <li>
                        Se registrará <strong>la fecha de ganado</strong> en{" "}
                        <strong className="tabular-nums">{previa.fechas_completada}</strong>{" "}
                        oportunidad{previa.fechas_completada === 1 ? "" : "es"} —{" "}
                        <strong>volver a la etapa anterior no la borra</strong>.
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-[13px] text-amber-900">
                    Además de mover las tarjetas, <strong>no se disparará nada más</strong>: ninguna de las etapas
                    destino tiene automatizaciones activas, y no hay puntos ni fecha de ganado que registrar.
                  </p>
                )}
              </div>

              {/* Las que no se van a mover, con su motivo. No abortan al resto. */}
              {previa.omitidas.length > 0 && (
                <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3">
                  <div className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-600 mb-2">
                    {previa.omitidas.length} no se {previa.omitidas.length === 1 ? "moverá" : "moverán"} — el resto sí
                  </div>
                  <ul className="text-[12px] text-neutral-600 space-y-1">
                    {previa.omitidas.map((o) => (
                      <li key={o.id}>
                        {/* El uuid nunca: si no hay nombre se dice que no lo hay (§4.7). */}
                        <span className="font-semibold">{o.nombre_caso || "(caso sin nombre)"}</span>: {o.motivo}
                        {o.faltan?.length ? <> — falta{o.faltan.length === 1 ? "" : "n"} {o.faltan.map((f) => CAMPO_LEGIBLE[f] || f).join(", ")}</> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 3 · La palabra escrita — SOLO cuando el cambio se aplica de verdad. */}
              {exigePalabra ? (
                <div>
                  <label className="block text-[13px] text-neutral-700 mb-2">
                    Si está de acuerdo escriba la palabra <strong>{PALABRA}</strong> tal cual y presione Aceptar, de lo
                    contrario presione Cancelar.
                  </label>
                  <input
                    value={palabra}
                    onChange={(e) => setPalabra(e.target.value)}
                    placeholder={PALABRA}
                    autoComplete="off"
                    className="w-full h-11 px-3 rounded-xl border-2 border-neutral-200 outline-none focus:border-brand-orange font-mono tracking-widest"
                  />
                </div>
              ) : (
                <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-[13px] text-blue-900">
                  {aplicaDeVerdad ? (
                    <>Es <strong>una sola oportunidad</strong>: se aplica al confirmar, igual que arrastrarla en el tablero.</>
                  ) : (
                    <>
                      {/* 🔴 Sin nombrar el permiso. `cambiar_etapa_masivo` es el nombre de una fila de
                          `user_permisos`: a un vendedor no le dice nada y, metido en un <code>, parece
                          un dato que debería reconocer o un error del sistema. Se dice qué significa
                          (§4.7). */}
                      No puedes cambiar la etapa de varias oportunidades a la vez, así que esto <strong>no cambia
                      nada todavía</strong>: se enviará como solicitud y quedará parada hasta que un administrador
                      la apruebe.
                      {/* ⚠️ Aquí NO se pide escribir CAMBIAR, y es deliberado: pedirla para algo que no
                          cambia nada enseña a teclearla sin leer y erosiona el guardarraíl justo donde
                          hace falta. Se reserva para cuando el efecto es inmediato. */}
                      <textarea
                        rows={2}
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo (opcional, ayuda a quien la apruebe)"
                        className="mt-2 w-full border border-blue-200 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-brand-orange resize-none text-neutral-800"
                      />
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-2">
              <button onClick={() => setPaso("armado")} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Volver</button>
              <div className="flex-1" />
              <button onClick={intentarCerrar} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Cancelar</button>
              <button
                onClick={enviar}
                disabled={!puedeEnviar || previa.aplicables === 0}
                className={cn(
                  "px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2",
                  aplicaDeVerdad ? "bg-brand-orange" : "bg-brand-blue"
                )}
              >
                {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                {aplicaDeVerdad ? "Aceptar" : "Enviar solicitud"}
              </button>
            </div>
          </>
        )}
      </motion.div>

      {/* Cerrar con trabajo hecho. */}
      <AnimatePresence>
        {confirmarCierre && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl p-5 w-full max-w-sm">
              <h4 className="font-display text-base font-black mb-2">¿Descartar los cambios?</h4>
              <p className="text-[13px] text-neutral-600 mb-4">
                Has ajustado <strong className="tabular-nums">{nCambios}</strong> fila{nCambios === 1 ? "" : "s"}. Si
                cierras, se pierden y hay que volver a hacerlo.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmarCierre(false)} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Seguir editando</button>
                <button onClick={onClose} className="px-4 py-2 rounded-xl bg-brand-red text-white text-sm font-bold">Descartar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
