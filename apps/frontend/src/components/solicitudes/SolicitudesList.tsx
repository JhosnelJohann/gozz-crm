"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth-user";
import { SolicitudDetalleModal } from "@/components/solicitudes/SolicitudDetalleModal";

// Rutea cada tipo de solicitud al endpoint de aprobar/rechazar que le corresponde.
//
// ⚠️ Este mapa es el `switch` que sobrevive: las tres familias antiguas tienen una ruta por tipo.
// Los tipos NUEVOS usan la ruta genérica `/api/solicitudes/:id/(aprobar|rechazar)`, que deduce del
// `tipo` de la fila qué permiso exigir (§10.3) — por eso `oportunidad_etapa` apunta a "solicitudes".
// Migrar las tres antiguas cambia quién puede qué en cada una: entrega propia.
const ENDPOINT: Record<string, string> = {
  oportunidad_monto: "monto-solicitudes",
  oportunidad_pago: "pago-solicitudes",
  oportunidad_etapa: "solicitudes",
};
/**
 * Tipos que tienen detalle desplegable (`GET /api/solicitudes/:id/detalle`).
 *
 * 🔴 Para estos, aprobar y rechazar pasan POR el detalle: el diálogo corto de "¿seguro?" vale para
 * un cambio de monto —el número está en la propia fila— pero no para una selección, donde lo que
 * hay que decidir es sobre CASOS CONCRETOS que la fila no enseña. Aprobar sin verlos es firmar.
 *
 * Es una lista y no un `switch`: cuando las solicitudes de contactos entren en el registro del
 * servidor, se suma su tipo aquí y ya.
 */
const CON_DETALLE = new Set(["oportunidad_etapa"]);

const TIPO_LABEL: Record<string, string> = {
  oportunidad_monto: "Monto de oportunidad",
  oportunidad_pago: "Monto de pago",
  oportunidad_descuento: "Descuento",
  oportunidad_etapa: "Cambio masivo de etapa",
  contacto_archivar: "Archivar contactos",
  contacto_exportar: "Exportar contactos",
};

function resumenDetalle(s: any): string {
  const d = s.detalle || {};
  if (s.tipo === "oportunidad_monto") return `Monto: $${d.monto_anterior ?? "?"} → $${d.monto_propuesto ?? "?"}`;
  if (s.tipo === "oportunidad_etapa") {
    // 🔴 Una solicitud masiva NO tiene `oportunidad_id`: la columna de la vista es escalar y esto
    // afecta a N, así que llega en NULL y `nombre_caso` viene vacío. Aquí se pinta "N
    // oportunidades" en su lugar — es el caso que la vista avisa que hay que saber pintar.
    const n = d.oportunidades_afectadas ?? Object.keys(d.cambios || {}).length;
    // `cambios` convive en dos formas: `{id: "destino"}` (las anteriores a que se guardara el
    // origen) y `{id: {desde, hasta}}` (las nuevas). El destino se saca de las dos.
    const destinos = [...new Set(
      Object.values(d.cambios || {}).map((v: any) => (v && typeof v === "object" ? String(v.hasta) : String(v)))
    )];
    const aDonde = destinos.length === 1 ? ` → ${destinos[0]}` : ` → ${destinos.length} etapas distintas`;
    return `${n} oportunidad${n === 1 ? "" : "es"}${aDonde}`;
  }
  if (s.tipo === "oportunidad_descuento") {
    const parts: string[] = [];
    if (d.monto !== undefined && d.monto !== null) parts.push(`$${d.monto}`);
    if (d.porcentaje !== undefined && d.porcentaje !== null) parts.push(`${d.porcentaje}%`);
    return parts.length ? `Descuento: ${parts.join(" · ")}` : "Descuento solicitado";
  }
  const parts: string[] = [];
  if (d.monto !== undefined && d.monto !== null) parts.push(`monto $${d.monto}`);
  if (d.metodo) parts.push(`método ${String(d.metodo).replace(/_/g, " ")}`);
  if (d.fecha_pago) parts.push(`fecha ${String(d.fecha_pago).slice(0, 10)}`);
  return parts.length ? `Pago → ${parts.join(", ")}` : "Cambios en el pago";
}

// Los CUATRO estados del estándar (CONVENCIONES §10.4). `ejecutada` se distingue de `aprobada`
// a propósito: desde la 0067 las vistas no traducen, y "aprobada, pendiente de ejecutar" no es lo
// mismo que "ya ejecutada" — en una acción masiva sobre contactos, es justo lo que hay que saber.
const ESTADO_CLASE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  aprobada: "bg-brand-green/15 text-brand-green",
  ejecutada: "bg-brand-blue/10 text-brand-blue",
  rechazada: "bg-brand-red/10 text-brand-red",
};
const ESTADO_TITULO: Record<string, string> = {
  aprobada: "Aprobada — pendiente de ejecutarse",
  ejecutada: "Aprobada y ya ejecutada",
};

function EstadoBadge({ estado }: { estado: string }) {
  return (
    <span title={ESTADO_TITULO[estado]}
      className={cn("text-[10px] font-ui uppercase tracking-wider px-2 py-0.5 rounded-md", ESTADO_CLASE[estado] || "bg-neutral-100 text-neutral-600")}>
      {estado}
    </span>
  );
}

export function SolicitudesList({ solicitudes, onChange, showOportunidad = false, puedeAprobar = true, tiposAprobables }: {
  solicitudes: any[]; onChange: () => void; showOportunidad?: boolean; puedeAprobar?: boolean;
  /** Tipos que ESTE usuario puede resolver, derivados de `aprobar_<tipo>` en el servidor (§10.3). */
  tiposAprobables?: string[];
}) {
  const { isAdmin } = useCurrentUser();
  const [modal, setModal] = useState<{ s: any; accion: "aprobar" | "rechazar" } | null>(null);
  /** Id de la solicitud cuyo detalle está abierto. Ver `CON_DETALLE`. */
  const [detalle, setDetalle] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [busy, setBusy] = useState(false);

  // Quién ve el botón. Para los tipos que el servidor declara resolubles manda esa lista — es la
  // regla `aprobar_<tipo>` y no una suposición del navegador. Para los tres tipos antiguos, que
  // todavía no pasan por ahí, se conserva el criterio de siempre: `es_aprobador` (`editar_monto`) y,
  // en descuentos, admin, porque su endpoint `/revisar` lo exige.
  const puedeAccionar = (s: any) => {
    if (tiposAprobables?.includes(s.tipo)) return true;
    return puedeAprobar && (s.tipo !== "oportunidad_descuento" || isAdmin);
  };

  const abrir = (s: any, accion: "aprobar" | "rechazar") => { setMotivoRechazo(""); setModal({ s, accion }); };

  const confirmar = async () => {
    if (!modal) return;
    const { s, accion } = modal;
    // Desde la 0066 el motivo es obligatorio en la base (CHECK `rechazada ⇒ motivo_rechazo`). El
    // servidor devuelve 400; esto lo evita antes de salir.
    if (accion === "rechazar" && !motivoRechazo.trim()) { toast.error("El motivo del rechazo es obligatorio"); return; }
    setBusy(true);
    try {
      let r: Response;
      if (s.tipo === "oportunidad_descuento") {
        // Los descuentos usan su propio endpoint con body { accion, comentario }.
        r = await fetch(`/api/descuentos/${s.id}/revisar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion, comentario: accion === "rechazar" ? motivoRechazo.trim() : null }),
        });
      } else {
        const ruta = ENDPOINT[s.tipo];
        if (!ruta) { toast.error("Tipo de solicitud desconocido"); setBusy(false); return; }
        const body = accion === "rechazar" ? { motivo_rechazo: motivoRechazo.trim() } : {};
        r = await fetch(`/api/${ruta}/${s.id}/${accion}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      }
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Error"); }
      toast.success(accion === "aprobar" ? "Solicitud aprobada" : "Solicitud rechazada");
      setModal(null);
      onChange();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!solicitudes.length) return <div className="text-center py-10 text-neutral-400 text-sm">No hay solicitudes</div>;

  return (
    <>
      {detalle && (
        <SolicitudDetalleModal
          solicitudId={detalle}
          onClose={() => setDetalle(null)}
          onResuelta={onChange}
        />
      )}
      <div className="space-y-2">
      {solicitudes.map((s) => (
        <div key={s.id} className="bg-white rounded-xl border border-neutral-100 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-ui uppercase tracking-wider px-2 py-0.5 rounded-md bg-brand-blue/10 text-brand-blue">{TIPO_LABEL[s.tipo] || s.tipo}</span>
              <EstadoBadge estado={s.estado} />
              {showOportunidad && s.nombre_caso && (
                <Link href={`/oportunidades/${s.oportunidad_id}`} className="text-[12px] font-bold text-brand-orange hover:underline truncate">{s.nombre_caso}</Link>
              )}
            </div>
            <div className="text-[12px] text-neutral-700 font-semibold mt-1">{resumenDetalle(s)}</div>
            <div className="text-[11px] text-neutral-500 mt-1"><span className="font-semibold">Motivo:</span> {s.motivo}</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              Solicitó: <span className="font-semibold text-neutral-600">{s.solicitante_nombre || "—"}</span>
              {(s.estado === "aprobada" || s.estado === "ejecutada") && s.aprobador_nombre && <> · Aprobó: <span className="font-semibold text-brand-green">{s.aprobador_nombre}</span></>}
              {s.estado === "ejecutada" && s.ejecutada_at && <> · Ejecutada el <span className="font-semibold text-brand-blue">{new Date(s.ejecutada_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></>}
              {s.estado === "rechazada" && s.aprobador_nombre && <> · Rechazó: <span className="font-semibold text-brand-red">{s.aprobador_nombre}</span></>}
            </div>
            {s.estado === "rechazada" && s.motivo_rechazo && (
              <div className="text-[11px] text-brand-red/80 mt-0.5"><span className="font-semibold">Motivo rechazo:</span> {s.motivo_rechazo}</div>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            {/* Ver el detalle no exige poder aprobar: quien la pidió también tiene derecho a mirar
                lo que pidió. El servidor decide (aprobador del tipo o solicitante). */}
            {CON_DETALLE.has(s.tipo) && (
              <button onClick={() => setDetalle(s.id)}
                className="h-9 px-3 rounded-lg bg-neutral-100 text-neutral-600 text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-neutral-200">Ver detalle</button>
            )}
            {s.estado === "pendiente" && puedeAccionar(s) && (
              CON_DETALLE.has(s.tipo) ? (
                // 🔴 Para una selección, aprobar pasa por el detalle. No hay atajo: lo que hay que
                // juzgar son casos concretos, y la fila no los enseña.
                <button onClick={() => setDetalle(s.id)}
                  className="h-9 px-3 rounded-lg bg-brand-green/10 text-brand-green text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-green/20">Revisar y resolver</button>
              ) : (
                <>
                  <button onClick={() => abrir(s, "aprobar")}
                    className="h-9 px-3 rounded-lg bg-brand-green/10 text-brand-green text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-green/20">Aprobar</button>
                  <button onClick={() => abrir(s, "rechazar")}
                    className="h-9 px-3 rounded-lg bg-brand-red/10 text-brand-red text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-red/20">Rechazar</button>
                </>
              )
            )}
          </div>
        </div>
      ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            {modal.accion === "aprobar" ? (
              <>
                <h3 className="font-display text-lg font-black mb-2">Aprobar solicitud</h3>
                <p className="text-[13px] text-neutral-600 mb-4">Al aprobar, los cambios solicitados se aplicarán de forma <strong>permanente</strong> y no se podrán deshacer. ¿Deseas aprobar esta solicitud?</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setModal(null)} disabled={busy} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold disabled:opacity-60">Cancelar</button>
                  <button onClick={confirmar} disabled={busy} className="px-4 py-2 rounded-xl bg-brand-green text-white text-sm font-bold disabled:opacity-60">{busy ? "Aprobando…" : "Sí, aprobar"}</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-black mb-2">Rechazar solicitud</h3>
                <p className="text-[13px] text-neutral-600 mb-3">¿Seguro que deseas rechazar esta solicitud? El pago se mantendrá como está actualmente.</p>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Motivo del rechazo <span className="text-brand-red">*</span> (para que el solicitante lo entienda)</label>
                <textarea rows={3} value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)}
                  placeholder="Ej: el monto no coincide con el comprobante…"
                  className="w-full border-2 border-neutral-200 rounded-xl px-3 py-2 mb-4 outline-none focus:border-brand-orange resize-none" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setModal(null)} disabled={busy} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold disabled:opacity-60">Cancelar</button>
                  <button onClick={confirmar} disabled={busy || !motivoRechazo.trim()} className="px-4 py-2 rounded-xl bg-brand-red text-white text-sm font-bold disabled:opacity-60">{busy ? "Rechazando…" : "Rechazar solicitud"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Pestaña dentro de una oportunidad: lista las solicitudes de ESA oportunidad.
export function SolicitudesTab({ opId, onReload }: { opId: string; onReload?: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [esAprobador, setEsAprobador] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    fetch(`/api/oportunidades/${opId}/solicitudes`).then((r) => r.json())
      .then((d) => { setItems(d.solicitudes || []); setEsAprobador(!!d.es_aprobador); })
      .catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [opId]);
  if (loading) return <div className="text-center py-10 text-neutral-400 text-sm">Cargando…</div>;
  return <SolicitudesList solicitudes={items} onChange={() => { load(); onReload?.(); }} puedeAprobar={esAprobador} />;
}
