"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, Plus, FileText, X, Upload, Loader2, MessageSquare, CheckCircle2, Percent, Ban, Clock, Paperclip, Download, Image as ImageIcon, Pencil, Check, Trash2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn, fmtFechaSolo } from "@/lib/utils";
import { DateField } from "@/components/ui/DateField";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { useFileDrop } from "@/lib/useFileDrop";
import { NewFileChip, ExistingArchivoChip } from "@/components/ui/NotaAttachmentChips";
import { DescuentoRow, DescuentoModal } from "@/components/descuentos/DescuentoComponents";
import { useCurrentUser } from "@/lib/auth-user";

export function PagosTabV2({ op, onReload }: any) {
  const [pagos, setPagos] = useState<any[]>([]);
  const [totalPagado, setTotalPagado] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [descuentoOpen, setDescuentoOpen] = useState(false);
  const [descuentos, setDescuentos] = useState<any[]>([]);
  const [preview, setPreview] = useState<{ url: string; filename: string; mime?: string; pagoId?: string; kind?: string } | null>(null);
  const [attachPagoId, setAttachPagoId] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [editPago, setEditPago] = useState<any | null>(null);
  const [deletePago, setDeletePago] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, user } = useCurrentUser();
  const puedeEditarMonto = isAdmin || (user as any)?.puede_editar_monto === true;

  const eliminarPago = async () => {
    if (!deletePago) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/oportunidades/${op.id}/pagos/${deletePago.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "No se pudo eliminar"); }
      toast.success("Pago eliminado");
      setDeletePago(null);
      loadPagos(); onReload();
    } catch (e: any) { toast.error(e.message); } finally { setDeleting(false); }
  };

  // Eliminar UN archivo (comprobante/documento) del pago, sin borrar el pago.
  const eliminarArchivo = async () => {
    if (!preview?.pagoId) return;
    if (!confirm(`¿Eliminar este archivo (${preview.filename})? Solo borra este comprobante/documento, no el pago.`)) return;
    setFileBusy(true);
    try {
      const r = await fetch(`/api/oportunidades/${op.id}/pagos/${preview.pagoId}/archivo`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: preview.url }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo eliminar el archivo");
      toast.success("Archivo eliminado");
      setPreview(null);
      loadPagos();
    } catch (e: any) { toast.error(e.message); } finally { setFileBusy(false); }
  };

  // Reemplazar (editar) UN archivo puntual por otro.
  const triggerReplace = () => replaceInputRef.current?.click();
  const onReplaceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !preview?.pagoId) return;
    setFileBusy(true);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("url", preview.url);
      const r = await fetch(`/api/oportunidades/${op.id}/pagos/${preview.pagoId}/archivo/reemplazar`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo reemplazar el archivo");
      toast.success("Archivo reemplazado");
      setPreview(null);
      loadPagos();
    } catch (e: any) { toast.error(e.message); } finally { setFileBusy(false); }
  };


  const loadPagos = async () => {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        fetch(`/api/oportunidades/${op.id}/pagos`).then((r) => r.json()),
        fetch(`/api/oportunidades/${op.id}/descuentos`).then((r) => r.json())
      ]);
      setPagos(p.pagos || []);
      setTotalPagado(p.total_pagado || 0);
      setDescuentos(d.descuentos || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { loadPagos(); }, [op.id]);

  const descuentosPendientes = descuentos.filter((d) => d.estado === "pendiente");

  const fmt = (n: any) => `$${Number(n || 0).toFixed(2)}`;
  // Descuento aprobado = rebaja del valor a cobrar (no es pago). El detail endpoint envía el breakdown.
  const totalDescuentos = Number(op.total_descuentos || 0);
  const hayDescuento = totalDescuentos > 0;
  const totalACobrar = op.total_a_cobrar != null ? Number(op.total_a_cobrar) : Number(op.valor_total || 0);
  const aReintegrar = Number(op.a_reintegrar || 0);

  const triggerAttach = (pagoId: string) => { setAttachPagoId(pagoId); setTimeout(() => attachInputRef.current?.click(), 0); };
  const onAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const pagoId = attachPagoId;
    if (!files.length || !pagoId) { setAttachPagoId(null); return; }
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("documentos", f));
      const r = await fetch(`/api/oportunidades/${op.id}/pagos/${pagoId}/documentos`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail || "Error al anexar");
      toast.success(`${files.length} documento${files.length === 1 ? "" : "s"} anexado${files.length === 1 ? "" : "s"} al pago`);
      loadPagos();
    } catch (err: any) {
      toast.error(err.message);
    } finally { setUploadingDoc(false); setAttachPagoId(null); }
  };

  return (
    <div>
      <input ref={attachInputRef} type="file" multiple className="hidden" accept="image/*,application/pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.csv,.rtf" onChange={onAttachChange} />
      <input ref={replaceInputRef} type="file" className="hidden" accept="image/*,application/pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.csv,.rtf" onChange={onReplaceChange} />
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-6">
          {hayDescuento ? (
            <div>
              <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">Valor total</div>
              {/* Con descuento: valor a cobrar como número principal y el original tachado encima. */}
              <div className="text-[11px] font-black font-display tabular-nums text-neutral-400 line-through leading-none">{fmt(op.valor_total)}</div>
              <div className="text-2xl font-black font-display tabular-nums leading-tight" style={{ color: "#0F172A" }}>{fmt(totalACobrar)}</div>
            </div>
          ) : (
            <Stat label="Valor total" value={fmt(op.valor_total)} color="#0F172A" />
          )}
          <Stat label="Pagado" value={fmt(totalPagado)} color="#43A847" />
          {aReintegrar > 0 ? (
            <Stat label="A reintegrar" value={fmt(aReintegrar)} color="#2563EB" />
          ) : (
            <Stat label="Pendiente" value={fmt(op.balance_pendiente)} color={Number(op.balance_pendiente) > 0 ? "#E53935" : "#43A847"} />
          )}
        </div>
        {/*
          🔴 AQUÍ HABÍA UN BOTÓN «Completar», y se retiró el 2026-09-02 por redundante.
          Llamaba a `POST /api/oportunidades/:id/completar`, que deja la etapa en **ganado** — el
          mismo destino que «Finalizar oportunidad → Dar Ganado» de la cabecera, que además:
            · valida los campos obligatorios de la etapa (`pipeline_stages`), y
            · dispara las automatizaciones de etapa.
          Este atajo se saltaba las dos, así que quitarlo no perdió nada: cerró un camino más flojo.
          Los puntos los reparte igual el que queda (`asignarPuntosSiGanada`), y son idempotentes.
          ⚠️ El endpoint sigue existiendo a propósito: retirar una superficie HTTP es otra decisión.
        */}
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setDescuentoOpen(true)}
            className="h-10 px-4 rounded-xl bg-brand-blue/10 text-brand-blue font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-blue/15 flex items-center gap-1.5"
          >
            <Percent className="h-3.5 w-3.5" strokeWidth={2} />
            Solicitar descuento
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setModalOpen(true)}
            className="gradient-orange h-10 px-4 rounded-xl text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-glow flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Registrar pago
          </motion.button>
        </div>
      </div>

      {/* Descuentos pendientes / aprobados listado */}
      {descuentos.length > 0 && (
        <div className="mb-4 space-y-2">
          {descuentos.map((d: any) => <DescuentoRow key={d.id} d={d} onReload={loadPagos} />)}
        </div>
      )}

      {op.etapa === "completada" && (
        <div className="mb-4 bg-brand-green/10 text-brand-green rounded-xl px-4 py-2.5 text-[12px] font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          Oportunidad completada {op.fecha_completada && `el ${new Date(op.fecha_completada).toLocaleDateString("es")}`}. Puntos asignados al equipo.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl skeleton bg-neutral-100" />)}</div>
      ) : pagos.length === 0 ? (
        <div className="text-center py-12 text-neutral-400">
          <DollarSign className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm">Sin pagos registrados</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pagos.map((p: any) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-xl border border-neutral-100 px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow"
            >
              <div className="h-10 w-10 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center shrink-0">
                <DollarSign className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{fmt(p.monto)}</div>
                <div className="text-[11px] text-neutral-500 flex items-center gap-2 flex-wrap">
                  <span className="uppercase tracking-wider font-semibold">{p.metodo.replace(/_/g, " ")}</span>
                  <span>· {fmtFechaSolo(p.fecha_pago)}</span>
                  {p.titular_tipo === "tercero" && p.titular_nombre && <span>· titular: <strong>{p.titular_nombre}</strong></span>}
                  {p.registrado_por_nombre && <span>· {p.registrado_por_nombre}</span>}
                </div>
                {p.notas && <div className="text-[11px] text-neutral-400 italic truncate mt-0.5">{p.notas}</div>}
              </div>
              {(() => {
                const list = (Array.isArray(p.comprobantes_urls) && p.comprobantes_urls.length > 0)
                  ? p.comprobantes_urls
                  : (p.comprobante_url ? [{ url: p.comprobante_url, filename: "comprobante", mime: p.comprobante_url.endsWith(".pdf") ? "application/pdf" : "image/*" }] : []);
                return list.map((c: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => setPreview({ url: c.url, filename: c.filename || ("comprobante " + (i + 1)), mime: c.mime || (String(c.url).endsWith(".pdf") ? "application/pdf" : "image/*"), pagoId: p.id, kind: "comprobante" })}
                    className="h-9 px-3 rounded-lg bg-brand-blue/10 text-brand-blue text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-blue/15 flex items-center gap-1"
                    title={c.filename || ""}
                  >
                    <FileText className="h-3 w-3" strokeWidth={2} /> Ver{list.length > 1 ? " " + (i + 1) : ""}
                  </button>
                ));
              })()}
              {p.firma_autorizacion_url && (
                <button
                  onClick={() => setPreview({ url: p.firma_autorizacion_url, filename: "firma", mime: p.firma_autorizacion_url.endsWith(".pdf") ? "application/pdf" : "image/*", pagoId: p.id, kind: "firma" })}
                  className="h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/15"
                >
                  Firma
                </button>
              )}
              {Array.isArray(p.documentos_adicionales) && p.documentos_adicionales.map((c: any, i: number) => (
                <button
                  key={"doc" + i}
                  onClick={() => setPreview({ url: c.url, filename: c.filename || ("documento " + (i + 1)), mime: c.mime || (String(c.url).endsWith(".pdf") ? "application/pdf" : "image/*"), pagoId: p.id, kind: "doc" })}
                  className="h-9 px-3 rounded-lg bg-neutral-100 text-neutral-600 text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-neutral-200 flex items-center gap-1"
                  title={c.filename || ""}
                >
                  <Paperclip className="h-3 w-3" strokeWidth={2} /> Doc{(p.documentos_adicionales.length > 1) ? " " + (i + 1) : ""}
                </button>
              ))}
              <button
                onClick={() => triggerAttach(p.id)}
                disabled={uploadingDoc && attachPagoId === p.id}
                className="h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/15 flex items-center gap-1 disabled:opacity-50"
                title="Anexar documentos a este pago"
              >
                {uploadingDoc && attachPagoId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" strokeWidth={2} />}
                Anexar
              </button>
              {puedeEditarMonto && (
                <button
                  onClick={() => setEditPago(p)}
                  className="h-9 px-3 rounded-lg bg-neutral-100 text-neutral-600 text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/10 hover:text-brand-orange flex items-center gap-1"
                  title="Editar este pago"
                >
                  <Pencil className="h-3 w-3" strokeWidth={2} /> Editar
                </button>
              )}
              {puedeEditarMonto && (
                <button
                  onClick={() => setDeletePago(p)}
                  className="h-9 px-3 rounded-lg bg-brand-red/10 text-brand-red text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-red/20 flex items-center gap-1"
                  title="Eliminar este pago"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={2} /> Eliminar
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <PagoModal open={modalOpen} onClose={() => setModalOpen(false)} opId={op.id} onSaved={() => { loadPagos(); onReload(); }} />
      {editPago && (
        <EditarPagoModal
          key={editPago.id}
          pago={editPago}
          opId={op.id}
          onClose={() => setEditPago(null)}
          onSaved={() => { setEditPago(null); loadPagos(); onReload(); }}
        />
      )}
      {deletePago && (
        <AnimatedModal onClose={() => !deleting && setDeletePago(null)} panelClassName="bg-white rounded-2xl p-5 w-full max-w-md">
            <h3 className="font-display text-lg font-black mb-2">Eliminar pago</h3>
            <p className="text-[13px] text-neutral-600 mb-4">Al eliminar este pago de <strong>${Number(deletePago.monto || 0).toFixed(2)}</strong>, se descontará del total pagado de forma <strong>permanente</strong> y no se podrá deshacer. ¿Deseas eliminar este pago?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeletePago(null)} disabled={deleting} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold disabled:opacity-60">Cancelar</button>
              <button onClick={eliminarPago} disabled={deleting} className="px-4 py-2 rounded-xl bg-brand-red text-white text-sm font-bold disabled:opacity-60">{deleting ? "Eliminando…" : "Sí, eliminar"}</button>
            </div>
        </AnimatedModal>
      )}
      <DescuentoModal open={descuentoOpen} onClose={() => setDescuentoOpen(false)} opId={op.id} valorTotal={Number(op.valor_total || 0)} onSaved={() => { loadPagos(); onReload(); }} />

      {preview && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
              <div className="flex-1 font-semibold text-sm truncate">{preview.filename}</div>
              {preview.pagoId && (
                <>
                  <button onClick={triggerReplace} disabled={fileBusy} className="h-9 px-3 rounded-xl bg-brand-orange/10 text-brand-orange text-[11px] font-bold hover:bg-brand-orange/20 flex items-center gap-1.5 disabled:opacity-50" title="Reemplazar este archivo">
                    {fileBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Reemplazar
                  </button>
                  <button onClick={eliminarArchivo} disabled={fileBusy} className="h-9 px-3 rounded-xl bg-red-50 text-red-600 text-[11px] font-bold hover:bg-red-100 flex items-center gap-1.5 disabled:opacity-50" title="Eliminar este archivo">
                    <Ban className="h-3.5 w-3.5" /> Eliminar
                  </button>
                </>
              )}
              <a href={preview.url} download target="_blank" rel="noopener" className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500" title="Descargar"><Download className="h-4 w-4" /></a>
              <button onClick={() => setPreview(null)} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 bg-neutral-50 flex items-center justify-center overflow-auto">
              {preview.mime === "application/pdf"
                ? <iframe src={preview.url} className="w-full h-full border-0" />
                : <img src={preview.url} alt="" className="max-w-full max-h-full object-contain" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-2xl font-black font-display tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function PagoModal({ open, onClose, opId, onSaved }: { open: boolean; onClose: () => void; opId: string; onSaved: () => void }) {
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [titularTipo, setTitularTipo] = useState<"cliente" | "tercero">("cliente");
  const [titularNombre, setTitularNombre] = useState("");
  const [fechaPago, setFechaPago] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [comprobantes, setComprobantes] = useState<File[]>([]);
  const [firma, setFirma] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const METODOS = [
    { v: "efectivo", label: "Efectivo" },
    { v: "tarjeta", label: "Tarjeta" },
    { v: "tarjeta_tercero", label: "Tarjeta tercero" },
    { v: "transferencia", label: "Transferencia" },
    { v: "zelle", label: "Zelle" },
    { v: "cashapp", label: "CashApp" },
    { v: "descuento_referido", label: "Desc. referido" },
    { v: "otro", label: "Otro" }
  ];

  // Efectivo y descuento referido no necesitan comprobante (en efectivo basta la nota).
  // El comprobante es obligatorio para todos los métodos salvo descuento_referido (coincide con el backend).
  const requiereComprobante = metodo !== "descuento_referido";
  const requiereFirma = metodo === "tarjeta_tercero";

  const submit = async () => {
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) { toast.error("Monto inválido"); return; }
    if (requiereComprobante && comprobantes.length === 0) { toast.error("El comprobante es obligatorio"); return; }
    if (requiereFirma && !firma) { toast.error("Tarjeta de tercero requiere la firma de autorización"); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("monto", String(montoNum));
      fd.append("metodo", metodo);
      fd.append("titular_tipo", titularTipo);
      if (titularNombre) fd.append("titular_nombre", titularNombre);
      fd.append("fecha_pago", fechaPago);
      if (notas) fd.append("notas", notas);
      comprobantes.forEach((f) => fd.append("comprobante", f));
      if (firma) fd.append("firma", firma);

      const r = await fetch(`/api/oportunidades/${opId}/pagos`, { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Error al registrar pago");
      }
      toast.success("Pago registrado");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
      >
        <div className="px-6 pt-6 pb-4 flex items-center gap-3 border-b border-neutral-100">
          <div className="h-10 w-10 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center">
            <DollarSign className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-orange">Nuevo</div>
            <h3 className="font-display text-xl font-black">Registrar pago</h3>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Monto USD *</label>
              <input
                type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00" autoFocus
                className="w-full h-11 px-4 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange"
              />
            </div>
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Fecha *</label>
              <DateField
                value={fechaPago}
                onChange={setFechaPago}
                maxDate={new Date()}
                placeholder="Fecha del pago"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Método *</label>
            <div className="grid grid-cols-4 gap-1.5">
              {METODOS.map((m) => (
                <button
                  key={m.v} type="button"
                  onClick={() => setMetodo(m.v)}
                  className={cn(
                    "h-10 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider transition-all border",
                    metodo === m.v ? "bg-brand-orange text-white border-brand-orange shadow-md" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Titular de la cuenta</label>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setTitularTipo("cliente")} className={cn("flex-1 h-10 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", titularTipo === "cliente" ? "bg-brand-blue text-white" : "bg-white border border-neutral-200 text-neutral-500")}>Mismo cliente</button>
              <button type="button" onClick={() => setTitularTipo("tercero")} className={cn("flex-1 h-10 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", titularTipo === "tercero" ? "bg-brand-blue text-white" : "bg-white border border-neutral-200 text-neutral-500")}>Tercero</button>
            </div>
            {titularTipo === "tercero" && (
              <input
                value={titularNombre} onChange={(e) => setTitularNombre(e.target.value)}
                placeholder="Nombre del titular"
                className="w-full h-11 px-4 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange"
              />
            )}
          </div>

          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">
              Comprobante {requiereComprobante ? "*" : "(opcional)"}
            </label>
            <MultiFilePicker files={comprobantes} onChange={setComprobantes} accept="image/*,application/pdf" />
          </div>

          {requiereFirma && (
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Autorización firmada (tercero) *</label>
              <FilePicker file={firma} onPick={setFirma} accept="image/*,application/pdf" />
            </div>
          )}

          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Notas</label>
            <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} className="w-full px-4 py-2.5 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-neutral-100 flex items-center gap-2 bg-white">
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="h-11 px-5 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-neutral-50 text-neutral-700">Cancelar</button>
          <button type="button" onClick={submit} disabled={saving} className="h-11 px-6 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-brand-orange/25 disabled:opacity-60 flex items-center gap-2">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Registrar pago
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function FilePicker({ file, onPick, accept }: { file: File | null; onPick: (f: File | null) => void; accept: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const { isOver, dropProps } = useFileDrop((files) => { if (files[0]) onPick(files[0]); });
  return (
    <div {...dropProps}>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
      <button type="button" onClick={() => ref.current?.click()} className={cn(
        "w-full h-11 px-4 rounded-xl border-2 border-dashed text-sm flex items-center gap-2 transition-colors",
        isOver ? "bg-brand-orange/10 border-brand-orange text-brand-orange"
          : file ? "bg-brand-green/5 border-brand-green/40 text-brand-green" : "bg-neutral-50 border-neutral-200 text-neutral-500 hover:border-brand-orange hover:text-brand-orange"
      )}>
        <Upload className="h-4 w-4" strokeWidth={1.8} />
        <span className="truncate flex-1 text-left">{isOver ? "Suelta el archivo aquí…" : file ? file.name : "Seleccionar o arrastrar archivo…"}</span>
        {file && !isOver && <span className="h-5 w-5 flex items-center justify-center" onClick={(e) => { e.stopPropagation(); onPick(null); }}><X className="h-3 w-3" /></span>}
      </button>
    </div>
  );
}

function MultiFilePicker({ files, onChange, accept }: { files: File[]; onChange: (f: File[]) => void; accept: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const key = (f: File) => f.name + "__" + f.size + "__" + f.lastModified;
    const seen = new Set(files.map(key));
    const merged = [...files];
    for (const f of incoming) if (!seen.has(key(f))) { merged.push(f); seen.add(key(f)); }
    onChange(merged);
  };
  const add = (list: FileList | null) => addFiles(list ? Array.from(list) : []);
  const remove = (idx: number) => onChange(files.filter((_, i) => i !== idx));
  const { isOver, dropProps } = useFileDrop(addFiles);
  return (
    <div className="space-y-1.5" {...dropProps}>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => { add(e.target.files); if (ref.current) ref.current.value = ""; }}
      />
      <button type="button" onClick={() => ref.current?.click()} className={cn(
        "w-full h-11 px-4 rounded-xl border-2 border-dashed text-sm flex items-center gap-2 transition-colors",
        isOver ? "bg-brand-orange/10 border-brand-orange text-brand-orange"
          : files.length > 0 ? "bg-brand-green/5 border-brand-green/40 text-brand-green" : "bg-neutral-50 border-neutral-200 text-neutral-500 hover:border-brand-orange hover:text-brand-orange"
      )}>
        <Upload className="h-4 w-4" strokeWidth={1.8} />
        <span className="truncate flex-1 text-left">
          {isOver ? "Suelta los archivos aquí…" : files.length === 0 ? "Seleccionar o arrastrar archivos…" : files.length === 1 ? "Añadir otro archivo…" : "Añadir más (" + files.length + " seleccionados)"}
        </span>
      </button>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-[12px] bg-brand-green/5 border border-brand-green/20 rounded-lg px-3 py-1.5">
              <FileText className="h-3.5 w-3.5 text-brand-green shrink-0" strokeWidth={2} />
              <span className="truncate flex-1 text-neutral-700">{f.name}</span>
              <span className="text-[10px] text-neutral-400 tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="h-6 w-6 rounded-md hover:bg-red-50 text-neutral-400 hover:text-brand-red flex items-center justify-center shrink-0"
                aria-label="Quitar"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type NotaArchivo = { url: string; filename: string; mime?: string; size?: number };

function isImageMime(mime?: string) {
  return !!mime && mime.startsWith("image/");
}

export function NotasTab({ opId, onChange }: { opId: string; onChange?: () => void }) {
  const { isAdmin } = useCurrentUser();
  const [notas, setNotas] = useState<any[]>([]);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<NotaArchivo | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");
  const [editArchivos, setEditArchivos] = useState<NotaArchivo[]>([]); // adjuntos existentes que se conservan
  const [editNuevos, setEditNuevos] = useState<File[]>([]);            // adjuntos nuevos a subir
  const [savingEdit, setSavingEdit] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/oportunidades/${opId}/notas`);
      const d = await r.json();
      setNotas(d.notas || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [opId]);

  const dedupePush = (base: File[], incoming: File[]) => {
    const key = (f: File) => f.name + "__" + f.size + "__" + f.lastModified;
    const seen = new Set(base.map(key));
    const merged = [...base];
    for (const f of incoming) if (!seen.has(key(f))) { merged.push(f); seen.add(key(f)); }
    return merged;
  };
  const addArchivos = (incoming: File[]) => { if (incoming.length) setArchivos((prev) => dedupePush(prev, incoming)); };
  const addEditNuevos = (incoming: File[]) => { if (incoming.length) setEditNuevos((prev) => dedupePush(prev, incoming)); };
  const pickFiles = (list: FileList | null) => addArchivos(list ? Array.from(list) : []);
  const { isOver: notaDragOver, dropProps: notaDropProps } = useFileDrop(addArchivos);

  const pastedImages = (e: React.ClipboardEvent<HTMLTextAreaElement>): File[] => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return [];
    const out: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f && f.type.startsWith("image/")) {
          const ext = f.type.split("/")[1] || "png";
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          out.push(new File([f], `captura-${stamp}.${ext}`, { type: f.type, lastModified: Date.now() }));
        }
      }
    }
    return out;
  };
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const p = pastedImages(e);
    if (p.length > 0) { e.preventDefault(); addArchivos(p); toast.success(p.length === 1 ? "Imagen pegada" : `${p.length} imágenes pegadas`); }
  };
  const handleEditPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const p = pastedImages(e);
    if (p.length > 0) { e.preventDefault(); addEditNuevos(p); toast.success(p.length === 1 ? "Imagen pegada" : `${p.length} imágenes pegadas`); }
  };

  const removeArchivo = (idx: number) => setArchivos((prev) => prev.filter((_, i) => i !== idx));

  const add = async () => {
    if (!texto.trim() && archivos.length === 0) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (texto.trim()) fd.append("contenido", texto.trim());
      archivos.forEach((f) => fd.append("archivo", f));
      const r = await fetch(`/api/oportunidades/${opId}/notas`, { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Error");
      }
      toast.success("Nota guardada");
      setTexto("");
      setArchivos([]);
      if (fileRef.current) fileRef.current.value = "";
      load();
      onChange?.(); // avisar al padre (Resumen: "Notas recientes") para refrescar
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar nota?")) return;
    const r = await fetch(`/api/oportunidades/${opId}/notas/${id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); toast.error(d.error || "No se pudo eliminar"); return; }
    load();
    onChange?.();
  };

  const startEdit = (n: any) => {
    setEditId(n.id);
    setEditTexto(n.contenido || "");
    setEditArchivos(Array.isArray(n.archivos) ? n.archivos : []);
    setEditNuevos([]);
  };
  const cancelEdit = () => {
    setEditId(null); setEditTexto(""); setEditArchivos([]); setEditNuevos([]);
    if (editFileRef.current) editFileRef.current.value = "";
  };
  const saveEdit = async (id: string) => {
    if (!editTexto.trim() && editArchivos.length === 0 && editNuevos.length === 0) { toast.error("La nota no puede quedar vacía"); return; }
    setSavingEdit(true);
    try {
      const fd = new FormData();
      fd.append("contenido", editTexto.trim());
      fd.append("archivos_keep", JSON.stringify(editArchivos));
      editNuevos.forEach((f) => fd.append("archivo", f));
      const r = await fetch(`/api/oportunidades/${opId}/notas/${id}`, { method: "PATCH", body: fd });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Error"); }
      toast.success("Nota actualizada");
      cancelEdit();
      load();
      onChange?.();
    } catch (e: any) { toast.error(e.message); } finally { setSavingEdit(false); }
  };

  return (
    <div>
      <div className="relative mb-5 bg-white rounded-xl border border-neutral-200 focus-within:ring-4 focus-within:ring-brand-orange/15 focus-within:border-brand-orange transition" {...notaDropProps}>
        {notaDragOver && (
          <div className="absolute inset-0 z-20 rounded-xl border-2 border-dashed border-brand-orange bg-brand-orange/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 text-brand-orange font-ui font-bold text-sm">
              <Paperclip className="h-4 w-4" strokeWidth={2.5} /> Suelta los archivos para adjuntar
            </div>
          </div>
        )}
        <div className="flex gap-2 p-2">
          <textarea
            value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe una nota… pega una captura con Ctrl+V. (Cmd/Ctrl+Enter para enviar)"
            rows={2}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }}
            onPaste={handlePaste}
            className="flex-1 px-3 py-2 text-sm outline-none resize-none bg-transparent"
          />
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
              className="hidden"
              onChange={(e) => { pickFiles(e.target.files); if (fileRef.current) fileRef.current.value = ""; }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-10 w-10 rounded-xl bg-neutral-100 hover:bg-brand-orange/10 hover:text-brand-orange text-neutral-500 flex items-center justify-center transition"
              title="Adjuntar archivos o imágenes"
            >
              <Paperclip className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              onClick={add}
              disabled={saving || (!texto.trim() && archivos.length === 0)}
              className="gradient-orange h-10 px-4 rounded-xl text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-glow disabled:opacity-60 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}
              Añadir
            </button>
          </div>
        </div>
        {archivos.length > 0 && (
          <div className="px-3 pb-3 pt-1 flex flex-wrap gap-2 items-center border-t border-neutral-100">
            {archivos.map((f, i) => (
              <NewFileChip key={f.name + "_" + f.size + "_" + f.lastModified + "_" + i} file={f} onRemove={() => removeArchivo(i)} />
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl skeleton bg-neutral-100" />)}</div>
      ) : notas.length === 0 ? (
        <div className="text-center py-10 text-neutral-400">
          <MessageSquare className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm">Sin notas. Añade la primera.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notas.map((n: any) => {
            const archs: NotaArchivo[] = Array.isArray(n.archivos) ? n.archivos : [];
            return (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl border border-neutral-100 px-4 py-3 group"
              >
                <div className="flex items-start gap-3">
                  {n.foto_perfil_url
                    ? <img src={n.foto_perfil_url} className="h-8 w-8 rounded-full object-cover shrink-0" alt="" />
                    : <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[10px] font-bold flex items-center justify-center shrink-0">{(n.usuario_nombre || "?").slice(0, 2).toUpperCase()}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[11px] text-neutral-500 mb-1">
                      <strong className="text-neutral-700">{n.usuario_nombre || "Sistema"}</strong>
                      <span>· {new Date(n.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {n.updated_at && n.created_at && new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 1500 && <span className="italic text-neutral-400">· editado</span>}
                    </div>
                    {editId === n.id ? (
                      <div className="mt-1">
                        <textarea
                          value={editTexto}
                          onChange={(e) => setEditTexto(e.target.value)}
                          rows={Math.max(3, editTexto.split("\n").length)}
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit(n.id); if (e.key === "Escape") cancelEdit(); }}
                          onPaste={handleEditPaste}
                          className="w-full px-3 py-2 text-sm border border-brand-orange/40 rounded-xl outline-none focus:ring-4 focus:ring-brand-orange/15 resize-y bg-white"
                        />
                        {(editArchivos.length > 0 || editNuevos.length > 0) && (
                          <div className="mt-2 flex flex-wrap gap-2 items-center">
                            {editArchivos.map((a, i) => (
                              <ExistingArchivoChip key={"ex" + i} archivo={a} onRemove={() => setEditArchivos((prev) => prev.filter((_, x) => x !== i))} onPreview={() => setPreview(a)} />
                            ))}
                            {editNuevos.map((f, i) => (
                              <NewFileChip key={"nv" + f.name + f.size + i} file={f} onRemove={() => setEditNuevos((prev) => prev.filter((_, x) => x !== i))} />
                            ))}
                          </div>
                        )}
                        <input
                          ref={editFileRef}
                          type="file"
                          multiple
                          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                          className="hidden"
                          onChange={(e) => { addEditNuevos(Array.from(e.target.files || [])); if (editFileRef.current) editFileRef.current.value = ""; }}
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <button onClick={() => saveEdit(n.id)} disabled={savingEdit || (!editTexto.trim() && editArchivos.length === 0 && editNuevos.length === 0)} className="gradient-orange h-8 px-3 rounded-lg text-white font-ui text-[11px] font-bold uppercase tracking-wider disabled:opacity-60 flex items-center gap-1.5">
                            {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" strokeWidth={2.5} />} Guardar
                          </button>
                          <button type="button" onClick={() => editFileRef.current?.click()} title="Adjuntar imágenes o archivos" className="h-8 w-8 rounded-lg bg-neutral-100 hover:bg-brand-orange/10 hover:text-brand-orange text-neutral-500 flex items-center justify-center">
                            <Paperclip className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                          <button onClick={cancelEdit} disabled={savingEdit} className="text-[11px] text-neutral-400 hover:underline">cancelar</button>
                          <span className="text-[10px] text-neutral-400 ml-auto">pega con Ctrl+V</span>
                        </div>
                      </div>
                    ) : (
                      n.contenido && <div className="text-sm whitespace-pre-wrap">{n.contenido}</div>
                    )}
                    {editId !== n.id && archs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {archs.map((a, i) => {
                          const isImg = isImageMime(a.mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.url);
                          if (isImg) {
                            return (
                              <button
                                key={i}
                                onClick={() => setPreview(a)}
                                className="group/img relative h-20 w-20 rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200 hover:ring-2 hover:ring-brand-orange transition"
                                title={a.filename}
                              >
                                <img src={a.url} alt={a.filename} className="h-full w-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition" />
                              </button>
                            );
                          }
                          return (
                            <button
                              key={i}
                              onClick={() => setPreview(a)}
                              className="flex items-center gap-2 text-[11px] bg-brand-blue/10 hover:bg-brand-blue/15 text-brand-blue rounded-lg px-2.5 py-1.5 border border-brand-blue/20"
                              title={a.filename}
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                              <span className="truncate max-w-[220px] font-semibold">{a.filename}</span>
                              {typeof a.size === "number" && <span className="text-[10px] text-brand-blue/70 tabular-nums">{(a.size / 1024).toFixed(0)} KB</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {editId !== n.id && (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(n)} className="h-8 w-8 rounded-lg hover:bg-brand-orange/10 text-neutral-300 hover:text-brand-orange flex items-center justify-center" title="Editar nota">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {isAdmin && (
                        <button onClick={() => del(n.id)} className="h-8 w-8 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-brand-red flex items-center justify-center" title="Eliminar nota">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
              <div className="flex-1 font-semibold text-sm truncate">{preview.filename}</div>
              <a
                href={preview.url}
                download={preview.filename}
                target="_blank"
                rel="noopener"
                className="h-9 px-3 rounded-xl bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-orange text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5"
                title="Descargar"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                Descargar
              </a>
              <button onClick={() => setPreview(null)} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 bg-neutral-50 flex items-center justify-center overflow-auto">
              {isImageMime(preview.mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(preview.url)
                ? <img src={preview.url} alt={preview.filename} className="max-w-full max-h-full object-contain" />
                : (preview.mime === "application/pdf" || /\.pdf$/i.test(preview.url))
                  ? <iframe src={preview.url} className="w-full h-full border-0" />
                  : (
                    <div className="text-center p-8">
                      <FileText className="h-14 w-14 text-neutral-400 mx-auto mb-3" strokeWidth={1.5} />
                      <p className="text-sm text-neutral-600 mb-4">No hay vista previa para este tipo de archivo.</p>
                      <a href={preview.url} download={preview.filename} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl gradient-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider">
                        <Download className="h-3.5 w-3.5" strokeWidth={2} />
                        Descargar archivo
                      </a>
                    </div>
                  )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function EditarPagoModal({ pago, opId, onClose, onSaved, modo = "editar" }: { pago: any; opId: string; onClose: () => void; onSaved: () => void; modo?: "editar" | "solicitar" }) {
  const solicitar = modo === "solicitar";
  const [monto, setMonto] = useState(String(pago.monto ?? ""));
  const [metodo, setMetodo] = useState<string>(pago.metodo || "transferencia");
  const [titularTipo, setTitularTipo] = useState<"cliente" | "tercero">(pago.titular_tipo === "tercero" ? "tercero" : "cliente");
  const [titularNombre, setTitularNombre] = useState(pago.titular_nombre || "");
  const [fechaPago, setFechaPago] = useState(String(pago.fecha_pago || "").slice(0, 10));
  const [notas, setNotas] = useState(pago.notas || "");
  const [saving, setSaving] = useState(false);
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [comprobanteModo, setComprobanteModo] = useState<"reemplazar" | "adicional">("adicional");
  const [motivo, setMotivo] = useState("");

  const METODOS = [
    { v: "efectivo", label: "Efectivo" }, { v: "tarjeta", label: "Tarjeta" },
    { v: "tarjeta_tercero", label: "Tarjeta tercero" }, { v: "transferencia", label: "Transferencia" },
    { v: "zelle", label: "Zelle" }, { v: "cashapp", label: "CashApp" },
    { v: "descuento_referido", label: "Desc. referido" }, { v: "otro", label: "Otro" },
  ];

  const submit = async () => {
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) { toast.error("Monto inválido"); return; }
    if (solicitar && !motivo.trim()) { toast.error("El motivo es obligatorio"); return; }
    setSaving(true);
    try {
      if (solicitar) {
        // Crear una SOLICITUD de cambio (la aplica un aprobador)
        const fd = new FormData();
        fd.append("monto", String(montoNum));
        fd.append("metodo", metodo);
        fd.append("titular_tipo", titularTipo);
        fd.append("titular_nombre", titularTipo === "tercero" ? titularNombre : "");
        if (fechaPago) fd.append("fecha_pago", fechaPago);
        fd.append("notas", notas || "");
        fd.append("motivo", motivo.trim());
        if (comprobanteFile) { fd.append("comprobante", comprobanteFile); fd.append("comprobante_modo", comprobanteModo); }
        const r = await fetch(`/api/oportunidades/${opId}/pagos/${pago.id}/solicitudes`, { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "No se pudo enviar la solicitud");
        toast.success("Solicitud enviada. Un administrador la revisará.");
        onSaved();
        return;
      }
      // Edición directa (autorizados)
      const r = await fetch(`/api/oportunidades/${opId}/pagos/${pago.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monto: montoNum, metodo, titular_tipo: titularTipo,
          titular_nombre: titularTipo === "tercero" ? titularNombre : null,
          fecha_pago: fechaPago || null, notas: notas || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Error al editar el pago");
      // Comprobante opcional: reemplazar el principal o añadir como adicional
      if (comprobanteFile) {
        if (comprobanteModo === "reemplazar" && pago.comprobante_url) {
          const fd = new FormData(); fd.append("url", pago.comprobante_url); fd.append("archivo", comprobanteFile);
          await fetch(`/api/oportunidades/${opId}/pagos/${pago.id}/archivo/reemplazar`, { method: "POST", body: fd });
        } else {
          const fd = new FormData(); fd.append("documentos", comprobanteFile);
          await fetch(`/api/oportunidades/${opId}/pagos/${pago.id}/documentos`, { method: "POST", body: fd });
        }
      }
      toast.success("Pago actualizado");
      onSaved();
    } catch (e: any) { toast.error(e.message || "Error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
      >
        <div className="px-6 pt-6 pb-4 flex items-center gap-3 border-b border-neutral-100">
          <div className="h-10 w-10 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center">
            <DollarSign className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-orange">{solicitar ? "Solicitud" : "Editar"}</div>
            <h3 className="font-display text-xl font-black">{solicitar ? "Solicitar cambio de pago" : "Editar pago"}</h3>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Monto USD *</label>
              <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus
                className="w-full h-11 px-4 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange" />
            </div>
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Fecha *</label>
              <DateField value={fechaPago} onChange={setFechaPago} maxDate={new Date()} placeholder="Fecha del pago" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Método *</label>
            <div className="grid grid-cols-4 gap-1.5">
              {METODOS.map((m) => (
                <button key={m.v} type="button" onClick={() => setMetodo(m.v)}
                  className={cn("h-10 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider transition-all border",
                    metodo === m.v ? "bg-brand-orange text-white border-brand-orange" : "bg-white text-neutral-600 border-neutral-200 hover:border-brand-orange/50")}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Titular</label>
            <div className="flex gap-2">
              {(["cliente", "tercero"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTitularTipo(t)}
                  className={cn("h-10 px-4 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider border transition-all",
                    titularTipo === t ? "bg-brand-orange text-white border-brand-orange" : "bg-white text-neutral-600 border-neutral-200 hover:border-brand-orange/50")}>
                  {t}
                </button>
              ))}
              {titularTipo === "tercero" && (
                <input value={titularNombre} onChange={(e) => setTitularNombre(e.target.value)} placeholder="Nombre del titular"
                  className="flex-1 h-10 px-3 rounded-lg bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange" />
              )}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Notas</label>
            <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange resize-none" />
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Comprobante (opcional)</label>
            <input type="file" onChange={(e) => setComprobanteFile(e.target.files?.[0] || null)}
              className="block w-full text-[11px] text-neutral-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-brand-orange/10 file:text-brand-orange file:text-[10px] file:font-bold file:uppercase file:tracking-wider hover:file:bg-brand-orange/15" />
            {comprobanteFile && (
              <div className="flex gap-2 mt-2">
                {(["adicional", "reemplazar"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setComprobanteModo(m)}
                    className={cn("h-9 px-3 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider border transition-all",
                      comprobanteModo === m ? "bg-brand-orange text-white border-brand-orange" : "bg-white text-neutral-600 border-neutral-200 hover:border-brand-orange/50")}>
                    {m === "adicional" ? "Añadir como adicional" : "Reemplazar principal"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {solicitar && (
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Motivo (obligatorio)</label>
              <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder="Explica por qué debe cambiar este pago…"
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange resize-none" />
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-neutral-200 text-sm font-bold text-neutral-600 hover:bg-neutral-50">Cancelar</button>
          <button onClick={submit} disabled={saving} className="flex-1 h-11 rounded-xl gradient-orange text-white text-sm font-bold shadow-glow disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
            {solicitar ? "Enviar solicitud" : "Guardar"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
