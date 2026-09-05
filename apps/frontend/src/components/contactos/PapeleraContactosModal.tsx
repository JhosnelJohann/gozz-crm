"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, GitMerge, RotateCcw, Search, Trash2, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";
import { DateRangePopover, PAST_PRESETS, type DateRange } from "@/components/ui/DateRangePopover";
import { cn } from "@/lib/utils";

// ============================================================================================
// PAPELERA DE CONTACTOS (D8)
//
// POR QUÉ EXISTE: la Ola 0 sustituyó el borrado físico por archivado lógico y REVERSIBLE —
// construyó el motor, la trazabilidad, el opt-in `?archivados=1` y el endpoint de vuelta— pero
// nunca la pantalla. Sin ella la reversibilidad era teórica: existía en la API, no para quien se
// equivoca. Salió el 2026-08-10, la primera vez que alguien archivó de verdad y preguntó
// "¿dónde veo lo que borré?".
//
// Sigue el patrón de la papelera del Drive (`drive/DriveBrowser.tsx`): overlay, tarjeta con
// cabecera y contador, barra de filtros, lista, paginación y acciones. No se inventa otro.
//
// 🔴 NO hay ruta de API nueva. Es el listado de siempre con `archivados=1`, que ya es admin-only.
// ============================================================================================

interface ContactoArchivado {
  id: string;
  nombre_completo: string | null;
  email: string | null;
  telefono: string | null;
  created_at: string;
  archivado_motivo: string | null;
  fusionado_en_contacto_id: string | null;
  archivado_at?: string | null;
  archivado_por?: string | null;
  archivado_por_nombre?: string | null;
}

interface AutorPapelera {
  /** `null` = archivados sin autor registrado. Es una categoría, no un hueco. */
  id: string | null;
  nombre: string | null;
  n: number;
}

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  /** Se llama tras desarchivar, para que el listado de detrás se refresque. */
  onCambio: () => void;
}

const PAGE_SIZE = 50;

/** Mismo valor que el backend (`SIN_USUARIO` en `contactos-routes.ts`). */
const SIN_USUARIO = "sin_usuario";

/** Atajos para los motivos que de verdad hay en la base. El campo es libre igualmente. */
const MOTIVOS_RAPIDOS: { valor: string; etiqueta: string }[] = [
  { valor: "", etiqueta: "Todos" },
  { valor: "eliminado por usuario", etiqueta: "Eliminados a mano" },
  { valor: "fusionado", etiqueta: "Por fusión" },
  { valor: "lead_sin_oportunidad", etiqueta: "Leads sin oportunidad" },
  { valor: "basura", etiqueta: "Basura" },
];

const fecha = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("es", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

export function PapeleraContactosModal({ abierto, onCerrar, onCambio }: Props) {
  const [items, setItems] = useState<ContactoArchivado[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [motivo, setMotivo] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rango, setRango] = useState<DateRange>({ from: null, to: null });
  const [autores, setAutores] = useState<AutorPapelera[]>([]);
  const [sinFecha, setSinFecha] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trazabilidad, setTrazabilidad] = useState(true);
  const [recargar, setRecargar] = useState(0);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const hayRango = !!(rango.from || rango.to);
  const filtrosActivos = !!(q || motivo || usuario || hayRango);
  const limpiarFiltros = () => { setQ(""); setMotivo(""); setUsuario(""); setRango({ from: null, to: null }); setPage(1); };

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { if (abierto) { setPage(1); setRecargar((n) => n + 1); } }, [abierto]);

  // Guard anti-carreras, igual que en el listado: una respuesta vieja no puede pintarse encima.
  useEffect(() => {
    if (!abierto) return;
    const ctrl = new AbortController();
    let cancelado = false;
    (async () => {
      setCargando(true);
      try {
        const p = new URLSearchParams({ archivados: "1", page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedQ) p.set("q", debouncedQ);
        if (motivo) p.set("motivo", motivo);
        if (usuario) p.set("usuario", usuario);
        // Mismos nombres que la papelera del Drive. El `hasta` ya viene cerrado a las 23:59:59.999
        // por `DateRangePopover` (endOfDay), así que el `<=` del backend incluye el día completo.
        if (rango.from) p.set("desde", rango.from.toISOString());
        if (rango.to) p.set("hasta", rango.to.toISOString());
        const r = await fetch(`/api/contactos?${p.toString()}`, { signal: ctrl.signal });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error || `HTTP ${r.status}`); }
        const d = await r.json();
        if (cancelado || ctrl.signal.aborted) return;
        setItems(d.items || []);
        setTotal(d.total || 0);
        setAutores(d.autores || []);
        setSinFecha(typeof d.sin_fecha === "number" ? d.sin_fecha : null);
        if (d.trazabilidad === false) setTrazabilidad(false);
      } catch (e: any) {
        if (cancelado || ctrl.signal.aborted || e?.name === "AbortError") return;
        toast.error(e?.message || "No se pudo cargar la papelera");
        setItems([]); setTotal(0);
      } finally { if (!cancelado && !ctrl.signal.aborted) setCargando(false); }
    })();
    return () => { cancelado = true; ctrl.abort(); };
  }, [abierto, page, debouncedQ, motivo, usuario, rango.from, rango.to, recargar]);

  const desarchivar = async (c: ContactoArchivado) => {
    const nombre = c.nombre_completo || "(sin nombre)";
    if (!confirm(`¿Devolver "${nombre}" al listado de contactos?\n\nVuelve tal y como estaba, con todo lo que cuelga de él.`)) return;
    setOcupado(c.id);
    try {
      const r = await fetch(`/api/contactos/${c.id}/desarchivar`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      toast.success(`"${nombre}" vuelve al listado`);
      setRecargar((n) => n + 1);
      onCambio();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo desarchivar");
    } finally { setOcupado(null); }
  };

  if (!abierto) return null;
  const vacio = !cargando && items.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8" onClick={onCerrar}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-5xl h-[88vh] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
            <Trash2 className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-black">Contactos archivados</h2>
            <p className="text-[11px] text-neutral-500">
              {total} contacto{total !== 1 ? "s" : ""} · nada se ha borrado, todo se puede devolver
            </p>
          </div>
          <button onClick={onCerrar} className="h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center">
            <X className="h-4 w-4 text-neutral-500" />
          </button>
        </div>

        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-black/5 dark:border-white/5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, email o teléfono…"
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-neutral-100 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-brand-orange/40"
            />
          </div>
          {MOTIVOS_RAPIDOS.map((m) => (
            <button
              key={m.valor || "todos"}
              onClick={() => { setMotivo(m.valor); setPage(1); }}
              className={cn(
                "h-8 px-3 rounded-xl text-xs font-bold transition",
                motivo === m.valor ? "bg-brand-orange text-white shadow-sm" : "bg-neutral-100 dark:bg-white/5 text-neutral-600 hover:bg-white"
              )}
            >
              {m.etiqueta}
            </button>
          ))}
        </div>

        {/* Segunda fila: autor y fecha. Mismos filtros, mismos nombres de parámetro y mismo
            calendario que la papelera del Drive — dos pantallas de la misma clase se leen igual. */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-black/5 dark:border-white/5">
          {autores.length > 0 && (
            <select
              value={usuario}
              onChange={(e) => { setUsuario(e.target.value); setPage(1); }}
              title="Archivado por"
              className={cn(
                "h-9 px-3 rounded-xl text-sm border outline-none transition cursor-pointer",
                usuario
                  ? "bg-brand-orange/10 border-brand-orange/30 text-brand-orange font-semibold"
                  : "bg-neutral-50 dark:bg-white/5 border-transparent hover:bg-white hover:border-slate-200 text-slate-700 dark:text-neutral-200"
              )}
            >
              <option value="">Archivado por: todos</option>
              {autores.map((a) => (
                // Las opciones salen de los DATOS, con su conteo: un desplegable con los 16
                // usuarios del CRM tendría casi todos a cero. La fila sin id son las corridas
                // masivas, que no las hizo una persona; se ofrecen como lo que son.
                <option key={a.id ?? SIN_USUARIO} value={a.id ?? SIN_USUARIO}>
                  {(a.id ? a.nombre ?? "(usuario borrado)" : "Sin usuario registrado")} · {a.n}
                </option>
              ))}
            </select>
          )}

          <DateRangePopover
            value={rango}
            onChange={(r) => { setRango(r); setPage(1); }}
            presets={PAST_PRESETS}
            placeholder="Fecha de archivado"
          />

          {filtrosActivos && (
            <button
              onClick={limpiarFiltros}
              className="h-9 px-3 rounded-xl bg-neutral-50 dark:bg-white/5 hover:bg-white text-neutral-500 hover:text-brand-red text-xs font-bold flex items-center gap-1.5 transition"
            >
              <X className="h-3.5 w-3.5" /> Limpiar filtros
            </button>
          )}
          <div className="flex-1" />
          {!cargando && (
            <span className="text-[12px] text-neutral-500 px-1">
              <span className="font-bold text-neutral-700 dark:text-neutral-300">{total}</span> resultado{total === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* 🔴 EL AVISO QUE EVITA UN SUSTO. Con un rango puesto, los archivados sin fecha no pueden
            aparecer: si no sabemos cuándo se archivaron, no caen en ningún rango. Es correcto, pero
            callarlo hace que "últimos 30 días" enseñe cuatro filas de 27.805 y parezca que se han
            perdido los datos. No se cuelan en el resultado ni se les inventa fecha: se enseña el
            hueco, igual que cada fila enseña su "sin fecha registrada". */}
        {hayRango && sinFecha !== null && sinFecha > 0 && (
          <div className="px-5 py-2 bg-blue-50 dark:bg-blue-500/10 text-[12px] text-blue-900 dark:text-blue-200 border-b border-blue-200 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>{sinFecha.toLocaleString("es")}</strong> contacto{sinFecha === 1 ? "" : "s"} archivado
              {sinFecha === 1 ? "" : "s"} no tiene{sinFecha === 1 ? "" : "n"} fecha registrada y queda
              {sinFecha === 1 ? "" : "n"} fuera de este rango. No se han perdido: quita el filtro de fecha
              para verlos.
            </span>
          </div>
        )}

        {!trazabilidad && (
          <div className="px-5 py-2 bg-amber-50 dark:bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-300 border-b border-amber-200">
            Este entorno todavía no tiene aplicada la migración <code>0056</code>: no se puede mostrar
            cuándo ni quién archivó cada contacto. El resto funciona igual.
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-black/30">
          {cargando && <p className="p-6 text-sm text-neutral-500">Cargando…</p>}
          {vacio && <p className="p-6 text-sm text-neutral-500">No hay contactos archivados que coincidan.</p>}

          {items.map((c) => {
            const porFusion = !!c.fusionado_en_contacto_id;
            return (
              <div key={c.id} className="flex items-start gap-3 px-5 py-3 border-b border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{c.nombre_completo || "(sin nombre)"}</p>
                  <p className="text-[12px] text-neutral-500 truncate">
                    {[c.email, c.telefono].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    <span className="font-medium">Archivado:</span>{" "}
                    {fecha(c.archivado_at) ?? <span className="italic">sin fecha registrada</span>}
                    {c.archivado_por_nombre ? <> · por <span className="font-medium">{c.archivado_por_nombre}</span></> : null}
                    {c.archivado_motivo ? <> · {c.archivado_motivo}</> : null}
                  </p>
                </div>

                {porFusion ? (
                  // 🔴 Un perdedor de fusión NO se desarchiva desde aquí, y la ruta lo rechaza con un
                  // 409 a propósito: sus oportunidades, tareas y archivos YA se reasignaron al
                  // ganador, así que reaparecería visible y vacío. Ofrecer el botón sería peor que no
                  // tener papelera: prometería algo que el sistema no puede cumplir. Se explica y se
                  // dirige al camino que sí funciona.
                  <div className="shrink-0 max-w-[300px] rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900 dark:text-amber-200">
                      <GitMerge className="h-3.5 w-3.5" /> Se archivó al fusionarlo
                    </p>
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
                      No se devuelve desde aquí: sus oportunidades, tareas y documentos ya pasaron al
                      otro contacto, así que volvería vacío. Para recuperarlo hay que{" "}
                      <strong>revertir la fusión completa</strong> por su <code>corrida_id</code>.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={() => desarchivar(c)}
                    disabled={ocupado === c.id}
                    className="shrink-0 h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange hover:bg-brand-orange/20 text-[11px] font-ui font-bold uppercase tracking-wider transition disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {ocupado === c.id ? "…" : "Devolver"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} disabled={cargando} showFirstLast />

        <div className="px-5 py-2 border-t border-black/5 dark:border-white/5 flex items-center gap-2 text-[11px] text-neutral-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Archivar nunca borra: la ficha y todo lo que cuelga de ella siguen en la base.
        </div>
      </motion.div>
    </div>
  );
}
