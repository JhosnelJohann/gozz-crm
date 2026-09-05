"use client";
// ============================================================================================
// EXPORTAR OPORTUNIDADES — elegir columnas, ver cuántas salen, descargar
//
// 🔴 EL NÚMERO LO CUENTA EL SERVIDOR. No se deduce de lo que el usuario marcó: con "seleccionar el
// total" **no ha visto las filas**, y ese número es lo único que le dice qué se está llevando. Si
// mintiera, se llevaría otra cosa y no se enteraría. Por eso el modal pide una previa nada más
// abrirse, con la misma selección que va a mandar después.
//
// ⚠️ Y avisa de algo que no es un defecto pero se paga fuera: **una fila por oportunidad**, así que
// un cliente con tres casos ganados sale tres veces. Subido tal cual a un CRM externo son tres mensajes
// a la misma persona.
// ============================================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { nombreDesdeCabecera } from "@/lib/descargas";

interface ColumnaDisponible { clave: string; etiqueta: string; grupo: string; pordefecto: boolean }
interface Previa { total: number; columnas: ColumnaDisponible[]; puede_exportar: boolean }

type Formato = "csv" | "xlsx";

export function ExportarModal({
  seleccion, onClose,
}: {
  /** El contrato compartido: `{modo:'ids',ids}` o `{modo:'filtro',filtros,excluidos}`. */
  seleccion: any;
  onClose: () => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [formato, setFormato] = useState<Formato>("csv");
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/oportunidades/exportar/previa", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seleccion }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "No se pudo calcular la exportación");
        if (!vivo) return;
        setPrevia(d);
        setElegidas(new Set(d.columnas.filter((c: ColumnaDisponible) => c.pordefecto).map((c: ColumnaDisponible) => c.clave)));
      } catch (e: any) { if (vivo) setError(e.message); }
    })();
    return () => { vivo = false; };
  }, [seleccion]);

  const grupos = useMemo(() => {
    const m = new Map<string, ColumnaDisponible[]>();
    for (const c of previa?.columnas ?? []) {
      if (!m.has(c.grupo)) m.set(c.grupo, []);
      m.get(c.grupo)!.push(c);
    }
    return [...m.entries()];
  }, [previa]);

  const alternar = (clave: string) =>
    setElegidas((s) => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n; });

  const puedeDescargar = !!previa?.puede_exportar && elegidas.size > 0 && (previa?.total ?? 0) > 0 && !descargando;

  const descargar = useCallback(async () => {
    if (!previa) return;
    setDescargando(true);
    try {
      const r = await fetch("/api/oportunidades/exportar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seleccion,
          // En el orden de la lista, no en el de marcado: la cabecera tiene que ser estable.
          columnas: previa.columnas.filter((c) => elegidas.has(c.clave)).map((c) => c.clave),
          formato,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "No se pudo exportar");
      }
      // 🔴 EL NOMBRE LO DECIDE EL SERVIDOR. Aquí se LEE de la cabecera, no se inventa.
      //
      // Al descargar desde un blob, `a.download` **gana a `Content-Disposition`**: el navegador ni
      // la mira. Este sitio se construía su propio nombre con `toISOString()`, así que el arreglo
      // del backend —hora incluida y en zona de Miami— no llegaba al usuario. Dos sitios
      // calculando el mismo nombre, y el segundo siempre se queda atrás.
      //
      // La petición es al mismo origen, así que la cabecera se lee sin `Access-Control-Expose-Headers`.
      const nombre = nombreDesdeCabecera(r.headers.get("content-disposition"), formato);

      // La respuesta es el fichero, no JSON: se vuelca a un blob y se dispara la descarga.
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Se exportaron ${previa.total} oportunidad${previa.total === 1 ? "" : "es"}`);
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setDescargando(false); }
  }, [previa, elegidas, formato, seleccion, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-black">Exportar oportunidades</h3>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {previa
                ? <>Se van a exportar <strong className="text-neutral-800 tabular-nums">{previa.total.toLocaleString("es")}</strong> oportunidad{previa.total === 1 ? "" : "es"}.</>
                : "Calculando cuántas…"}
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto flex-1 px-5 py-4 space-y-4">
          {error && <p className="text-[13px] text-brand-red">{error}</p>}
          {!previa && !error && <p className="text-center py-8 text-neutral-400 text-sm">Cargando…</p>}

          {previa && !previa.puede_exportar && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-[13px] text-blue-900">
              {/* Sin nombrar el permiso (§4.7). La acción NO se oculta: la barrera está en el backend. */}
              No puedes exportar oportunidades por tu cuenta. Esta descarga <strong>requiere la
              aprobación de un administrador</strong>: pídesela y la lanzará él.
            </div>
          )}

          {previa && (
            <>
              <div>
                <div className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-2">
                  Qué columnas salen
                </div>
                <div className="space-y-3">
                  {grupos.map(([grupo, columnas]) => (
                    <div key={grupo}>
                      <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 mb-1.5">{grupo}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {columnas.map((c) => {
                          const on = elegidas.has(c.clave);
                          return (
                            <button
                              key={c.clave}
                              onClick={() => alternar(c.clave)}
                              className={cn(
                                "h-8 px-3 rounded-lg text-[12px] font-semibold border transition",
                                on ? "bg-brand-orange/10 border-brand-orange/40 text-brand-orange"
                                   : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300"
                              )}
                            >
                              {c.etiqueta}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {elegidas.size === 0 && (
                  <p className="text-[12px] text-brand-red mt-2">Elige al menos una columna.</p>
                )}
              </div>

              <div>
                <div className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-2">Formato</div>
                <div className="flex gap-2">
                  {([["csv", FileText, "CSV", "para importar en un CRM externo"],
                     ["xlsx", FileSpreadsheet, "Excel", "para revisar a mano"]] as const).map(([v, Icono, etiqueta, sub]) => (
                    <button
                      key={v}
                      onClick={() => setFormato(v)}
                      className={cn(
                        "flex-1 h-auto px-3 py-2.5 rounded-xl border text-left transition flex items-center gap-2.5",
                        formato === v ? "bg-brand-orange/10 border-brand-orange/40" : "bg-white border-neutral-200 hover:border-neutral-300"
                      )}
                    >
                      <Icono className={cn("h-4 w-4 shrink-0", formato === v ? "text-brand-orange" : "text-neutral-400")} />
                      <span>
                        <span className={cn("block text-[13px] font-bold", formato === v ? "text-brand-orange" : "text-neutral-700")}>{etiqueta}</span>
                        <span className="block text-[11px] text-neutral-500">{sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ⚠️ Lo que hay que saber ANTES de subir el fichero a una campaña. */}
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Es <strong>una fila por oportunidad</strong>: un cliente con tres casos aparece tres
                  veces. Si el fichero se sube tal cual a una campaña, recibirá tres mensajes —
                  conviene <strong>deduplicar por teléfono al importar</strong>.
                </span>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-2">
          <span className="text-[12px] text-neutral-500">
            {previa && <>{elegidas.size} columna{elegidas.size === 1 ? "" : "s"}</>}
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Cancelar</button>
          <button
            onClick={descargar}
            disabled={!puedeDescargar}
            className="px-4 py-2 rounded-xl bg-brand-orange text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {descargando ? "Generando…" : "Descargar"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
