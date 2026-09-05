"use client";
import { useState } from "react";
import { toast } from "sonner";

// Footer reutilizable de acciones sobre una solicitud: Aprobar (con aviso de permanencia)
// y Rechazar (con nota + confirmación). `endpointBase` = "monto-solicitudes" | "pago-solicitudes".
export function AccionesSolicitud({ endpointBase, solId, onResolved }: {
  endpointBase: string; solId: string; onResolved: () => void;
}) {
  const [modo, setModo] = useState<"ver" | "aprobar" | "rechazar">("ver");
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [busy, setBusy] = useState(false);

  const resolver = async (accion: "aprobar" | "rechazar") => {
    setBusy(true);
    try {
      const body = accion === "rechazar" ? { motivo_rechazo: motivoRechazo.trim() || null } : {};
      const r = await fetch(`/api/${endpointBase}/${solId}/${accion}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Error"); }
      toast.success(accion === "aprobar" ? "Solicitud aprobada" : "Solicitud rechazada");
      onResolved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (modo === "ver") {
    return (
      <div className="flex gap-2 justify-end">
        <button onClick={() => setModo("rechazar")} className="px-4 py-2 rounded-xl bg-brand-red/10 text-brand-red text-sm font-bold hover:bg-brand-red/20">Rechazar</button>
        <button onClick={() => setModo("aprobar")} className="px-4 py-2 rounded-xl bg-brand-green text-white text-sm font-bold hover:brightness-110">Aprobar</button>
      </div>
    );
  }

  if (modo === "aprobar") {
    return (
      <div>
        <p className="text-[13px] text-neutral-600 mb-3">Al aprobar, los cambios solicitados se aplicarán de forma <strong>permanente</strong> y no se podrán deshacer. ¿Deseas aprobar esta solicitud?</p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setModo("ver")} disabled={busy} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold disabled:opacity-60">Cancelar</button>
          <button onClick={() => resolver("aprobar")} disabled={busy} className="px-4 py-2 rounded-xl bg-brand-green text-white text-sm font-bold disabled:opacity-60">{busy ? "Aprobando…" : "Sí, aprobar"}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-neutral-600 mb-2">¿Seguro que deseas rechazar esta solicitud? Se mantendrá el estado actual.</p>
      <label className="block text-xs font-bold text-neutral-500 mb-1">Motivo del rechazo (para que el solicitante lo entienda)</label>
      <textarea rows={2} value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)}
        placeholder="Ej: el monto no coincide con el comprobante…"
        className="w-full border-2 border-neutral-200 rounded-xl px-3 py-2 mb-3 outline-none focus:border-brand-orange resize-none" />
      <div className="flex gap-2 justify-end">
        <button onClick={() => setModo("ver")} disabled={busy} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold disabled:opacity-60">Cancelar</button>
        <button onClick={() => resolver("rechazar")} disabled={busy} className="px-4 py-2 rounded-xl bg-brand-red text-white text-sm font-bold disabled:opacity-60">{busy ? "Rechazando…" : "Rechazar solicitud"}</button>
      </div>
    </div>
  );
}
