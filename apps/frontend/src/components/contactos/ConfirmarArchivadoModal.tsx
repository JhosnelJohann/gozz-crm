"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Archive, Briefcase, CheckSquare, FileText, Folder, Mail, MessageSquare, X } from "@/lib/bootstrap-icons";

// ============================================================================================
// CONFIRMACIÓN INFORMADA ANTES DE ARCHIVAR (regla R2).
//
// Por qué existe: hasta la Ola 0, "eliminar un contacto" era un DELETE físico que Postgres
// ABORTABA en cuanto el contacto tenía una oportunidad, una tarea o una carpeta (4 FKs en
// ON DELETE NO ACTION). Esa red de seguridad involuntaria desapareció al pasar a archivado
// lógico: hoy se puede archivar un contacto con 12 oportunidades sin que nada proteste.
// Este diálogo ES esa barrera. No es decorativo.
//
// Los conteos son REALES, de una consulta a la base (POST /api/contactos/impacto), nunca
// estimados ni "puede que tenga datos asociados". Y si no arrastra nada, también se dice.
// ============================================================================================

export type SeleccionContactos =
  | { modo: "ids"; ids: string[] }
  | { modo: "filtro"; filtros?: Record<string, any>; excluidos?: string[] };

interface Totales {
  contactos: number;
  oportunidades: number;
  tareas: number;
  documentos: number;
  carpetas_drive: number;
  notas: number;
  emails: number;
  coach_mensajes: number;
  total: number;
}

interface Props {
  abierto: boolean;
  seleccion: SeleccionContactos | null;
  /** Nombre del contacto cuando se archiva uno solo desde su ficha (para el título). */
  nombreUnico?: string | null;
  onCancelar: () => void;
  /** Ejecuta el archivado. El modal no decide CÓMO se archiva, solo informa y confirma. */
  onConfirmar: () => Promise<void>;
}

const FILAS: { clave: keyof Totales; etiqueta: string; icono: any }[] = [
  { clave: "oportunidades", etiqueta: "Oportunidades", icono: Briefcase },
  { clave: "tareas", etiqueta: "Tareas", icono: CheckSquare },
  { clave: "documentos", etiqueta: "Documentos", icono: FileText },
  { clave: "carpetas_drive", etiqueta: "Carpetas de Drive", icono: Folder },
  { clave: "notas", etiqueta: "Notas", icono: MessageSquare },
  { clave: "emails", etiqueta: "Correos", icono: Mail },
];

export function ConfirmarArchivadoModal({ abierto, seleccion, nombreUnico, onCancelar, onConfirmar }: Props) {
  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ejecutando, setEjecutando] = useState(false);

  useEffect(() => {
    if (!abierto || !seleccion) { setTotales(null); setError(null); return; }
    let cancelado = false;
    setCargando(true); setError(null); setTotales(null);
    (async () => {
      try {
        const r = await fetch("/api/contactos/impacto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seleccion }),
        });
        const d = await r.json().catch(() => ({}));
        if (cancelado) return;
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setTotales(d.totales);
      } catch (e: any) {
        if (!cancelado) setError(e?.message || "No se pudieron calcular los datos asociados");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [abierto, seleccion]);

  const n = totales?.contactos ?? 0;
  const titulo = nombreUnico
    ? `¿Archivar a ${nombreUnico}?`
    : `¿Archivar ${n || ""} ${n === 1 ? "contacto" : "contactos"}?`.replace("  ", " ");
  const conDatos = FILAS.filter((f) => (totales?.[f.clave] ?? 0) > 0);
  // El botón NO se habilita hasta tener los conteos: confirmar a ciegas es exactamente lo que
  // este diálogo viene a impedir.
  const puedeConfirmar = !!totales && !cargando && !ejecutando;

  const confirmar = async () => {
    setEjecutando(true);
    try { await onConfirmar(); } finally { setEjecutando(false); }
  };

  return (
    <AnimatePresence>
      {abierto && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onCancelar}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-neutral-900 rounded-3xl p-7 max-w-lg w-full shadow-2xl border border-black/5 dark:border-white/10"
          >
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-11 w-11 rounded-2xl bg-brand-orange/10 flex items-center justify-center shrink-0">
                  <Archive className="h-5 w-5 text-brand-orange" strokeWidth={1.8} />
                </div>
                <h2 className="font-display text-xl font-black leading-tight truncate">{titulo}</h2>
              </div>
              <button onClick={onCancelar} className="h-9 w-9 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            {cargando && (
              <div className="space-y-2 mb-5">
                <div className="h-4 w-56 rounded skeleton" />
                <div className="h-4 w-40 rounded skeleton" />
                <div className="h-4 w-48 rounded skeleton" />
                <p className="text-[12px] text-neutral-500 pt-1">Calculando qué arrastra…</p>
              </div>
            )}

            {error && (
              <div className="mb-5 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
                <p className="text-sm text-red-700 dark:text-red-300 font-semibold mb-1">No se pudo calcular el impacto</p>
                <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
                <p className="text-[12px] text-red-600 dark:text-red-400 mt-2">Sin esos datos no se archiva: no vas a confirmar a ciegas.</p>
              </div>
            )}

            {totales && !error && (
              <>
                {conDatos.length > 0 ? (
                  <>
                    <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                      {n === 1 ? "Este contacto arrastra:" : `Estos ${n} contactos arrastran:`}
                    </p>
                    <div className="rounded-2xl border border-black/5 dark:border-white/10 divide-y divide-black/5 dark:divide-white/10 mb-4">
                      {conDatos.map(({ clave, etiqueta, icono: Icono }) => (
                        <div key={clave} className="flex items-center gap-3 px-4 py-2.5">
                          <Icono className="h-4 w-4 text-neutral-400 shrink-0" strokeWidth={1.6} />
                          <span className="text-sm text-neutral-700 dark:text-neutral-200 flex-1">{etiqueta}</span>
                          <span className="font-ui font-bold text-sm tabular-nums text-neutral-900 dark:text-white">{totales[clave]}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mb-4 rounded-2xl bg-neutral-50 dark:bg-white/5 border border-black/5 dark:border-white/10 p-4">
                    <p className="text-sm text-neutral-700 dark:text-neutral-200">
                      {n === 1
                        ? "Este contacto no tiene nada asociado."
                        : `Estos ${n} contactos no tienen nada asociado.`}
                    </p>
                    <p className="text-[12px] text-neutral-500 mt-1">Ni oportunidades, ni tareas, ni documentos, ni notas, ni correos.</p>
                  </div>
                )}

                {totales.coach_mensajes > 0 && (
                  <p className="text-[12px] text-neutral-500 mb-4">
                    Además conserva {totales.coach_mensajes} mensaje{totales.coach_mensajes === 1 ? "" : "s"} del coach de IA.
                  </p>
                )}

                <div className="flex items-start gap-2.5 rounded-2xl bg-brand-orange/5 border border-brand-orange/20 p-4 mb-6">
                  <AlertTriangle className="h-4 w-4 text-brand-orange shrink-0 mt-0.5" strokeWidth={1.8} />
                  <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    <strong className="text-neutral-800 dark:text-white">No se borra nada.</strong> El contacto y todo lo que
                    cuelga de él se conservan; solo deja de aparecer en listados, búsquedas y selectores.
                    Un administrador puede recuperarlo.
                  </p>
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={onCancelar}
                disabled={ejecutando}
                className="flex-1 h-11 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-white font-ui text-xs font-bold uppercase tracking-wider hover:bg-neutral-200 dark:hover:bg-white/10 transition disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={confirmar}
                disabled={!puedeConfirmar}
                className="flex-1 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {ejecutando ? "Archivando…" : cargando ? "Calculando…" : n === 1 ? "Archivar contacto" : `Archivar ${n}`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
