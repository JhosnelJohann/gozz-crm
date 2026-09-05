"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Briefcase, User, Mail, Phone, MessageSquare, MapPin, Shield, UserCircle2, Calendar, Clock, CheckCircle2, DollarSign, FileText, Eye, Heart, TrendingUp, Users as UsersIcon, X, Plus, Pencil, Loader2, UserPlus } from "@/lib/bootstrap-icons";
import Link from "next/link";
import { toast } from "sonner";
import { cn, fmtFechaSolo } from "@/lib/utils";
import { ContactoPicker } from "./ContactoPicker";
import { useCurrentUser } from "@/lib/auth-user";
import { EditarPagoModal } from "./PagosNotasTabs";
import { ComparativaPagoModal } from "./ComparativaPagoModal";

const ESTATUS_LABELS: Record<string, { label: string; color: string }> = {
  ciudadano: { label: "Ciudadano", color: "#2196C9" },
  residente: { label: "Residente", color: "#43A847" },
  asilo_pendiente: { label: "Asilo pendiente", color: "#5750E8" },
  permiso_trabajo: { label: "Permiso de trabajo", color: "#FFB51C" },
  tps: { label: "TPS", color: "#8338EC" },
  daca: { label: "DACA", color: "#06FFA5" },
  visa_u: { label: "Visa U", color: "#3A86FF" },
  visa_t: { label: "Visa T", color: "#FB5607" },
  indocumentado: { label: "Indocumentado", color: "#E53935" },
  otros: { label: "Otros", color: "#5C6670" }
};

const METODO_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  tarjeta_tercero: "Tarjeta tercero",
  transferencia: "Transferencia",
  zelle: "Zelle",
  cashapp: "CashApp",
  descuento_referido: "Desc. referido",
  otro: "Otro"
};

export function ResumenTab({ op, tramites = [], onReload, pagos = [], totalPagado = 0, notasRecientes = [], tareas = [] }: {
  op: any; tramites?: any[]; onReload?: () => void; pagos?: any[]; totalPagado?: number; notasRecientes?: any[]; tareas?: any[];
}) {
  const [preview, setPreview] = useState<{ url: string; filename: string; mime?: string } | null>(null);
  const [pagoModal, setPagoModal] = useState<{ pago: any; modo: "editar" | "solicitar" } | null>(null);
  const [pagoSolicitudes, setPagoSolicitudes] = useState<any[]>([]);
  const [comparativa, setComparativa] = useState<{ solicitud: any; pago: any } | null>(null);
  const { isAdmin, user } = useCurrentUser();
  const puedeEditarMonto = isAdmin || (user as any)?.puede_editar_monto === true;

  const cargarSolicitudes = () => {
    fetch(`/api/oportunidades/${op.id}/pago-solicitudes`).then((r) => r.json())
      .then((d) => setPagoSolicitudes(d.solicitudes || [])).catch(() => {});
  };
  useEffect(() => { cargarSolicitudes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [op.id]);

  const valorTotal = Number(op.valor_total || 0);
  const balance = Number(op.balance_pendiente || 0);
  const porcentajePagado = valorTotal > 0 ? Math.min(100, (totalPagado / valorTotal) * 100) : 0;

  const tareasPendientes = (tareas || []).filter((t: any) => t.estado !== "completada" && t.estado !== "cancelada");

  const primerPago = pagos.length ? pagos[pagos.length - 1] : null;
  const ultimoPago = pagos.length ? pagos[0] : null;

  return (
    <div className="space-y-4">
      {/* Info del caso + Cliente en 2 cols */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Información del caso */}
        <Card icon={Briefcase} title="Información del caso">
          <TramitesField opId={op.id} principalId={op.tipo_tramite_id} tramites={tramites.length ? tramites : (op.tramite_nombre ? [{ tipo_tramite_id: op.tipo_tramite_id, nombre: op.tramite_nombre, es_principal: true, color: op.tramite_color }] : [])} onReload={onReload} />
          <Info label="Formulario USCIS" value={op.formulario_uscis} />
          <PersonField opId={op.id} label="Preparador" field="preparador_id" userId={op.preparador_id} nombre={op.preparador_nombre} avatar={op.preparador_foto} onReload={onReload} />
          <PersonField opId={op.id} label="Vendedor" field="vendedor_id" userId={op.vendedor_id} nombre={op.vendedor_nombre} avatar={op.vendedor_foto} onReload={onReload} />
          <PersonField opId={op.id} label="Manager" field="manager_general_id" userId={op.manager_general_id} nombre={op.manager_general_nombre} avatar={op.manager_general_foto} onReload={onReload} />
          {op.manager_preparacion_nombre && <Info label="Manager preparación" value={op.manager_preparacion_nombre} />}
          {op.manager_ventas_nombre && <Info label="Manager ventas" value={op.manager_ventas_nombre} />}
          {op.supervisor_nombre && <Info label="Supervisor" value={op.supervisor_nombre} />}
          <Info label="SLA" value={`${op.sla_dias || 0} días`} />
          <Info label="Creado" value={op.created_at ? new Date(op.created_at).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "") : null} />
          {op.fecha_ganado && <Info label="Ganado" value={fmtFechaSolo(op.fecha_ganado)} valueClass="text-brand-green font-bold" />}
          {op.fecha_completada && <Info label="Completada" value={new Date(op.fecha_completada).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "")} valueClass="text-brand-green font-bold" />}
        </Card>

        {/* Cliente */}
        <ClienteCard op={op} onReload={onReload} />
      </div>

      {/* Resumen de pagos con progress bar + timeline */}
      <Card icon={DollarSign} title="Resumen de pagos" accent="#43A847">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <MiniStat label="Valor total" value={`$${valorTotal.toFixed(2)}`} color="#0F172A" />
          <MiniStat label="Pagado" value={`$${totalPagado.toFixed(2)}`} color="#43A847" />
          <MiniStat label="Pendiente" value={`$${balance.toFixed(2)}`} color={balance > 0 ? "#E53935" : "#43A847"} />
        </div>

        {/* Progress bar visual */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">Avance de pago</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: porcentajePagado === 100 ? "#43A847" : "#5750E8" }}>{porcentajePagado.toFixed(1)}%</span>
          </div>
          <div className="h-3 rounded-full bg-neutral-100 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${porcentajePagado}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
              className="h-full rounded-full"
              style={{
                background: porcentajePagado === 100
                  ? "linear-gradient(90deg, #43A847, #06FFA5)"
                  : "linear-gradient(90deg, #5750E8, #FFB51C)"
              }}
            />
          </div>
        </div>

        {/* Timeline de pagos */}
        {pagos.length === 0 ? (
          <div className="text-center py-8 text-[13px] text-neutral-400">
            <DollarSign className="h-8 w-8 mx-auto mb-2 text-brand-orange" strokeWidth={1.5} />
            Aún sin pagos registrados
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">Últimos pagos · {pagos.length} total</span>
              {primerPago && (
                <span className="text-[11px] text-neutral-500">
                  Inició: <strong className="text-neutral-700">{fmtFechaSolo(primerPago.fecha_pago)}</strong> con ${Number(primerPago.monto).toFixed(2)}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {pagos.slice(0, 5).map((p: any, i: number) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.03 * i }}
                  className="bg-neutral-50/60 rounded-xl px-3 py-2 flex items-center gap-3 border border-neutral-100"
                >
                  <div className="h-8 w-8 rounded-lg bg-brand-green/15 text-brand-green flex items-center justify-center shrink-0">
                    <DollarSign className="h-4 w-4" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold tabular-nums">${Number(p.monto).toFixed(2)}</span>
                      <span className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 px-1.5 py-0.5 rounded-md bg-white">{METODO_LABELS[p.metodo] || p.metodo}</span>
                      {p.titular_tipo === "tercero" && p.titular_nombre && <span className="text-[10px] text-neutral-500">titular: <strong>{p.titular_nombre}</strong></span>}
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">
                      {fmtFechaSolo(p.fecha_pago)}
                      {p.registrado_por_nombre && ` · ${p.registrado_por_nombre}`}
                    </div>
                  </div>
                  {p.comprobante_url && (
                    <button
                      onClick={() => setPreview({ url: p.comprobante_url, filename: `comprobante-${p.id.slice(0,8)}`, mime: p.comprobante_url.endsWith(".pdf") ? "application/pdf" : "image/*" })}
                      className="h-8 px-2.5 rounded-lg bg-brand-blue/10 text-brand-blue text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-blue/15 flex items-center gap-1 shrink-0"
                    >
                      <Eye className="h-3 w-3" strokeWidth={2.5} /> Ver
                    </button>
                  )}
                  {(() => {
                    const pend = pagoSolicitudes.find((s: any) => s.pago_id === p.id && s.estado === "pendiente");
                    if (pend) {
                      return (
                        <button
                          onClick={() => setComparativa({ solicitud: pend, pago: p })}
                          title="Ver el cambio solicitado"
                          className="solicitud-pendiente-btn inline-flex items-center gap-1.5 whitespace-nowrap px-3 h-8 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[11px] font-ui font-bold uppercase tracking-wide shadow-md shadow-amber-500/40 hover:brightness-110 transition shrink-0"
                        >
                          ⏳ Cambio pendiente
                        </button>
                      );
                    }
                    return (
                      <button
                        onClick={() => setPagoModal({ pago: p, modo: puedeEditarMonto ? "editar" : "solicitar" })}
                        title={puedeEditarMonto ? "Editar este pago" : "Solicitar cambio de este pago"}
                        className="h-8 px-2.5 rounded-lg bg-neutral-100 text-neutral-600 text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/10 hover:text-brand-orange flex items-center gap-1 shrink-0"
                      >
                        <Pencil className="h-3 w-3" strokeWidth={2.5} /> {puedeEditarMonto ? "Editar" : "Solicitar cambio"}
                      </button>
                    );
                  })()}
                </motion.div>
              ))}
            </div>
            {pagos.length > 5 && (
              <div className="text-[10px] text-center text-neutral-400 mt-2">
                +{pagos.length - 5} pago{pagos.length - 5 !== 1 ? "s" : ""} más · ver pestaña Pagos para detalle completo
              </div>
            )}
            {ultimoPago && primerPago && ultimoPago.id !== primerPago.id && (
              <div className="mt-3 text-[10px] text-neutral-400 text-center italic">
                Último pago: {fmtFechaSolo(ultimoPago.fecha_pago, { day: "2-digit", month: "short" })} · ${Number(ultimoPago.monto).toFixed(2)}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Notas + Tareas preview en 2 cols */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card icon={MessageSquare} title="Notas recientes">
          {notasRecientes.length === 0 ? (
            <div className="text-[12px] text-neutral-400 text-center py-4">Sin notas</div>
          ) : (
            <div className="space-y-2">
              {notasRecientes.slice(0, 3).map((n: any) => (
                <div key={n.id} className="bg-neutral-50/60 rounded-xl px-3 py-2 border border-neutral-100">
                  <div className="text-[10px] text-neutral-500 mb-0.5">
                    <strong className="text-neutral-700">{n.usuario_nombre || "Sistema"}</strong> · {new Date(n.created_at).toLocaleDateString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="text-[13px] line-clamp-2">{n.contenido}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card icon={CheckCircle2} title={`Tareas pendientes (${tareasPendientes.length})`}>
          {tareasPendientes.length === 0 ? (
            <div className="text-[12px] text-neutral-400 text-center py-4">Sin tareas pendientes</div>
          ) : (
            <div className="space-y-1.5">
              {tareasPendientes.slice(0, 4).map((t: any) => (
                <Link key={t.id} href={`/tareas?id=${t.id}`} className="block bg-neutral-50/60 hover:bg-neutral-50 rounded-xl px-3 py-2 border border-neutral-100 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0" style={{
                      backgroundColor: t.prioridad === "urgente" ? "#E5393520" : t.prioridad === "alta" ? "#5750E820" : "#43A84720",
                      color: t.prioridad === "urgente" ? "#E53935" : t.prioridad === "alta" ? "#5750E8" : "#43A847"
                    }}>
                      <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate">{t.titulo}</div>
                      <div className="text-[10px] text-neutral-500">
                        {t.responsable_nombre || "Sin asignar"}
                        {t.fecha_limite && ` · vence ${new Date(t.fecha_limite).toLocaleDateString("es", { day: "2-digit", month: "short" })}`}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <motion.div
            initial={{ scale: 0.95 }} animate={{ scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center justify-center">
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex-1 font-semibold text-sm truncate">{preview.filename}</div>
              <a href={preview.url} download={preview.filename} target="_blank" rel="noopener" className="h-9 px-3 rounded-xl hover:bg-neutral-100 text-neutral-500 text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Descargar
              </a>
              <button onClick={() => setPreview(null)} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 bg-neutral-50 flex items-center justify-center overflow-auto">
              {preview.mime === "application/pdf" || preview.url.toLowerCase().endsWith(".pdf")
                ? <iframe src={preview.url} className="w-full h-full border-0" title={preview.filename} />
                : <img src={preview.url} alt={preview.filename} className="max-w-full max-h-full object-contain" />}
            </div>
          </motion.div>
        </div>
      )}

      {pagoModal && (
        <EditarPagoModal
          key={pagoModal.pago.id + pagoModal.modo}
          pago={pagoModal.pago}
          opId={op.id}
          modo={pagoModal.modo}
          onClose={() => setPagoModal(null)}
          onSaved={() => { setPagoModal(null); cargarSolicitudes(); onReload?.(); }}
        />
      )}

      {comparativa && (
        <ComparativaPagoModal
          solicitud={comparativa.solicitud}
          pagoActual={comparativa.pago}
          puedeAprobar={puedeEditarMonto}
          onClose={() => setComparativa(null)}
          onResolved={() => { setComparativa(null); cargarSolicitudes(); onReload?.(); }}
        />
      )}
    </div>
  );
}

// ============================================================
function TramitesField({ opId, principalId, tramites, onReload }: { opId: string; principalId?: string | null; tramites: any[]; onReload?: () => void }) {
  const [cat, setCat] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<string | null>(null); // tipo_tramite_id del principal a cambiar
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/tramites").then((r) => r.json()).then((d) => setCat(d.tramites || d || [])).catch(() => {});
  }, []);
  const list = tramites || [];
  const has = new Set(list.map((t) => t.tipo_tramite_id));
  const add = async (tid: string) => {
    if (!tid) return; setBusy(true);
    try { await fetch(`/api/oportunidades/${opId}/tramites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo_tramite_id: tid }) }); setAdding(false); onReload?.(); }
    finally { setBusy(false); }
  };
  const remove = async (tid: string) => {
    setBusy(true);
    try { await fetch(`/api/oportunidades/${opId}/tramites/${tid}`, { method: "DELETE" }); onReload?.(); }
    finally { setBusy(false); }
  };
  // "Editar" el trámite principal = cambiar oportunidades.tipo_tramite_id por otro.
  const changePrincipal = async (tid: string) => {
    if (!tid) return; setBusy(true);
    try { await fetch(`/api/oportunidades/${opId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo_tramite_id: tid }) }); setChanging(null); onReload?.(); }
    finally { setBusy(false); }
  };
  const optsFor = (excludeAdded: boolean, excludeId?: string) =>
    cat.filter((tc) => tc.id !== excludeId && (!excludeAdded || !has.has(tc.id)));
  return (
    <div className="py-2 border-b border-neutral-100">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] uppercase tracking-wide text-neutral-400">Trámites ({list.length})</div>
        {!adding && (
          <button onClick={() => { setAdding(true); setChanging(null); }} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-orange hover:opacity-80">
            <Plus className="h-3 w-3" strokeWidth={2.5} /> Agregar trámite
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((t) => (
          <span key={t.tipo_tramite_id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold" style={{ background: (t.color || "#6366f1") + "1f", color: t.color || "#4f46e5" }}>
            {t.nombre}
            {(t.tipo_tramite_id === principalId) && <span className="text-[9px] font-bold uppercase opacity-70">· principal</span>}
            {(t.tipo_tramite_id === principalId) ? (
              <button onClick={() => { setChanging(changing === t.tipo_tramite_id ? null : t.tipo_tramite_id); setAdding(false); }} disabled={busy} className="ml-0.5 leading-none hover:opacity-60 inline-flex" title="Cambiar trámite principal">
                <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            ) : (
              <button onClick={() => remove(t.tipo_tramite_id)} disabled={busy} className="ml-0.5 leading-none hover:opacity-60 text-sm" title="Quitar trámite">×</button>
            )}
          </span>
        ))}
        {list.length === 0 && <span className="text-xs text-neutral-400">Sin trámite</span>}
      </div>
      {adding && (
        <div className="mt-2 flex items-center gap-2">
          <select disabled={busy} defaultValue="" onChange={(e) => add(e.target.value)} className="text-xs border border-neutral-300 rounded-lg px-2 py-1.5 flex-1 bg-white outline-none focus:border-brand-orange">
            <option value="" disabled>Seleccionar trámite a agregar…</option>
            {optsFor(true).map((tc) => (<option key={tc.id} value={tc.id}>{tc.nombre}{tc.codigo ? ` (${tc.codigo})` : ""}</option>))}
          </select>
          <button onClick={() => setAdding(false)} className="text-xs text-neutral-400 hover:underline">cancelar</button>
        </div>
      )}
      {changing && (
        <div className="mt-2 flex items-center gap-2">
          <select disabled={busy} defaultValue="" onChange={(e) => changePrincipal(e.target.value)} className="text-xs border border-neutral-300 rounded-lg px-2 py-1.5 flex-1 bg-white outline-none focus:border-brand-orange">
            <option value="" disabled>Cambiar trámite principal por…</option>
            {optsFor(false, changing).map((tc) => (<option key={tc.id} value={tc.id}>{tc.nombre}{tc.codigo ? ` (${tc.codigo})` : ""}</option>))}
          </select>
          <button onClick={() => setChanging(null)} className="text-xs text-neutral-400 hover:underline">cancelar</button>
        </div>
      )}
    </div>
  );
}

// Panel "Cliente": muestra los datos del contacto vinculado y, si NO hay contacto
// (o al pulsar el lápiz), permite buscar y vincular/cambiar/desvincular uno.
function ClienteCard({ op, onReload }: { op: any; onReload?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const estatus = ESTATUS_LABELS[op.contacto_estatus];
  const hasContacto = !!op.contacto_id;
  const showPicker = editing || !hasContacto;

  const save = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/oportunidades/${op.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacto_id: id || null }),
      });
      if (!r.ok) throw new Error();
      toast.success(id ? "Contacto vinculado" : "Contacto desvinculado");
      setEditing(false);
      onReload?.();
    } catch {
      toast.error("No se pudo actualizar el contacto");
    } finally {
      setBusy(false);
    }
  };

  const action = hasContacto && !editing ? (
    <div className="flex items-center gap-2">
      <Link href={`/contactos/${op.contacto_id}`} className="text-[10px] font-ui font-bold uppercase tracking-wider text-brand-orange hover:underline">Ver ficha →</Link>
      <button onClick={() => setEditing(true)} title="Cambiar contacto" className="text-neutral-300 hover:text-brand-orange transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
    </div>
  ) : editing ? (
    <button onClick={() => setEditing(false)} className="text-[11px] text-neutral-400 hover:underline">cancelar</button>
  ) : null;

  return (
    <Card icon={User} title="Cliente" action={action}>
      {showPicker ? (
        <div className="space-y-2.5">
          {!hasContacto && (
            <div className="flex items-start gap-2 rounded-xl bg-brand-orange/5 border border-brand-orange/15 px-3 py-2.5 text-[12px] text-neutral-600">
              <UserPlus className="h-4 w-4 text-brand-orange shrink-0 mt-0.5" strokeWidth={2} />
              <span>Esta oportunidad no tiene un contacto vinculado. Búscalo por nombre, email o teléfono para asociarlo.</span>
            </div>
          )}
          <ContactoPicker
            value={editing ? (op.contacto_id || "") : ""}
            selectedNombre={op.contacto_nombre}
            onChange={(id) => save(id)}
            autoFocus={editing}
          />
          {busy && (
            <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando…
            </div>
          )}
        </div>
      ) : (
        <>
          <Info label="Nombre" value={op.contacto_nombre} highlight />
          {estatus && (
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2">
              <span className="font-ui text-[10px] uppercase tracking-wider text-neutral-500">Estatus migratorio</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: estatus.color }} />
                {estatus.label}
              </span>
            </div>
          )}
          {op.contacto_tipo && (
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2">
              <span className="font-ui text-[10px] uppercase tracking-wider text-neutral-500">Tipo de cliente</span>
              <span className={cn("text-[10px] font-ui font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-white", op.contacto_tipo === "cliente" ? "bg-brand-green" : op.contacto_tipo === "referido" ? "bg-brand-orange" : "bg-brand-blue")}>
                {op.contacto_tipo}
              </span>
            </div>
          )}
          <Info label="Email" value={op.contacto_email} icon={Mail} />
          <Info label="Teléfono" value={op.contacto_telefono} icon={Phone} />
          <Info label="WhatsApp" value={op.contacto_whatsapp} icon={MessageSquare} />
          {(op.contacto_ciudad || op.contacto_estado) && <Info label="Ubicación" value={[op.contacto_ciudad, op.contacto_estado].filter(Boolean).join(", ")} icon={MapPin} />}
          {op.referido_por_nombre && (
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2">
              <span className="font-ui text-[10px] uppercase tracking-wider text-neutral-500">Referido por</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange">
                <UsersIcon className="h-3 w-3" strokeWidth={2} />
                {op.referido_por_nombre}
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Card({ icon: Icon, title, accent, action, children }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-neutral-100 overflow-hidden">
      {accent && <div className="h-0.5" style={{ backgroundColor: accent }} />}
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center justify-center">
              <Icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <h3 className="font-display font-black text-[15px]">{title}</h3>
          </div>
          {action}
        </div>
        <div className="space-y-2.5 text-sm">
          {children}
        </div>
      </div>
    </motion.div>
  );
}

// Campo editable de persona (Preparador/Vendedor): dropdown de usuarios → PATCH /api/oportunidades/:id
function PersonField({ opId, label, field, userId, nombre, avatar, onReload }: { opId: string; label: string; field: string; userId: string | null; nombre: string | null; avatar: string | null; onReload?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (editing && users.length === 0) {
      fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || d || [])).catch(() => {});
    }
  }, [editing, users.length]);
  const save = async (uid: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/oportunidades/${opId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: uid || null }) });
      if (!r.ok) throw new Error();
      toast.success(`${label} actualizado`); setEditing(false); onReload?.();
    } catch { toast.error("No se pudo actualizar"); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2">
      <span className="font-ui text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <select autoFocus disabled={busy} defaultValue={userId || ""} onChange={(e) => save(e.target.value)} className="h-8 px-2 rounded-lg bg-white border border-neutral-200 text-[13px] outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20 max-w-[190px]">
            <option value="">Sin asignar</option>
            {users.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
          </select>
          <button onClick={() => setEditing(false)} className="text-[11px] text-neutral-400 hover:underline">cancelar</button>
        </div>
      ) : (
        <span className="text-sm font-medium text-right truncate flex items-center gap-2 group">
          {avatar && <img src={avatar} className="h-5 w-5 rounded-full object-cover" alt="" />}
          {nombre ? nombre : <span className="text-neutral-300 italic font-normal">Sin asignar</span>}
          <button onClick={() => setEditing(true)} title={`Cambiar ${label.toLowerCase()}`} className="text-neutral-300 hover:text-brand-orange shrink-0 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
        </span>
      )}
    </div>
  );
}

function Info({ label, value, icon: Icon, avatar, empty, highlight, valueClass }: any) {
  const shown = value != null && String(value).length > 0;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2">
      <span className="font-ui text-[10px] uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
        {label}
      </span>
      <span className={cn("text-sm font-medium text-right truncate flex items-center gap-2", highlight && "font-bold", valueClass)}>
        {avatar && <img src={avatar} className="h-5 w-5 rounded-full object-cover" alt="" />}
        {shown ? value : <span className="text-neutral-300 italic font-normal">{empty || "—"}</span>}
      </span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-xl font-black font-display tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
