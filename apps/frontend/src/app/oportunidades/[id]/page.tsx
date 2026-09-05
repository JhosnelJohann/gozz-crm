"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, User, FileText, ClipboardList, DollarSign, Award, Activity,
  CheckSquare, Mail, Sparkles, Upload, Loader2, AlertCircle, Phone,
  MessageSquare, Plus, Check, Edit, Bell, X, Download, Eye, Trash2, FolderOpen, Send, Pencil, Inbox, Cake
} from "@/lib/bootstrap-icons";
import { DriveBrowser } from "@/components/drive/DriveBrowser";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { SLABadge } from "@/components/ui/SLABadge";
import { ETAPAS } from "@/lib/etapas";
import { cn, edadEnAnios, fmtFechaSolo } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth-user";
import { TaskModal } from "@/components/tareas/TaskModal";
import { PagosTabV2, NotasTab } from "@/components/oportunidad/PagosNotasTabs";
import { ResumenTab as ResumenTabV2 } from "@/components/oportunidad/ResumenTab";
import { SolicitudesTab } from "@/components/solicitudes/SolicitudesList";
import { ComparativaMontoModal } from "@/components/oportunidad/ComparativaMontoModal";
import EmailComposeModal from "@/components/correo/EmailComposeModal";

const TABS = [
  { key: "resumen", label: "Resumen", Icon: Sparkles },
  { key: "documentos", label: "Análisis de documentos", Icon: FileText },
  { key: "drive", label: "Documentos", Icon: FolderOpen },
  { key: "cuestionario", label: "Cuestionario USCIS", Icon: ClipboardList },
  { key: "pagos", label: "Pagos", Icon: DollarSign },
  { key: "notas", label: "Notas", Icon: MessageSquare },
  { key: "puntajes", label: "Puntajes", Icon: Award },
  { key: "tareas", label: "Tareas", Icon: CheckSquare },
  { key: "actividad", label: "Actividad", Icon: Activity },
  { key: "correos", label: "Correos", Icon: Mail },
  { key: "solicitudes", label: "Solicitudes", Icon: Inbox }
];

export default function OportunidadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState("resumen");
  // Edición inline del nombre de la oportunidad
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  // Edición inline del valor total
  const [editingValor, setEditingValor] = useState(false);
  const [valorDraft, setValorDraft] = useState("");
  const [savingValor, setSavingValor] = useState(false);
  // Finalizar oportunidad (Dar Ganado / Dar Perdido)
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState<null | "ganado" | "perdido">(null);
  // Permiso para editar el monto directo (admins/super_admin o user_permisos 'editar_monto')
  const { isAdmin, user } = useCurrentUser();
  const puedeEditarMonto = isAdmin || (user as any)?.puede_editar_monto === true;
  // Solicitud de cambio de monto (usuarios sin permiso directo)
  const [solicitarOpen, setSolicitarOpen] = useState(false);
  const [solMonto, setSolMonto] = useState("");
  const [solMotivo, setSolMotivo] = useState("");
  const [solEnviando, setSolEnviando] = useState(false);
  const [solicitudesPend, setSolicitudesPend] = useState<any[]>([]);
  const [montoComparativa, setMontoComparativa] = useState<any | null>(null);

  const load = async () => {
    const r = await fetch(`/api/oportunidades/${id}`);
    const d = await r.json();
    if (!r.ok) { toast.error("No encontrada"); router.push("/oportunidades"); return; }
    setData(d);
    fetch(`/api/oportunidades/${id}/monto-solicitudes`).then((r) => r.json())
      .then((d) => setSolicitudesPend((d.solicitudes || []).filter((s: any) => s.estado === "pendiente")))
      .catch(() => {});
  };

  useEffect(() => { load(); }, [id]);
  // Al entrar a "Resumen", recargar para reflejar cambios hechos en otras pestañas (p.ej. notas
  // agregadas/borradas/editadas en la pestaña Notas) sin obligar a refrescar la página.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "resumen") load(); }, [tab]);

  if (!data) {
    return (
      <AppShell>
        <div className="p-10">
          <div className="glass rounded-3xl p-10 h-64 skeleton" />
        </div>
      </AppShell>
    );
  }

  const op = data.oportunidad;
  const etapa = ETAPAS.find((e) => e.key === op.etapa);

  const saveName = async () => {
    const nuevo = nameDraft.trim();
    if (nuevo.length < 2) { toast.error("El nombre debe tener al menos 2 caracteres"); return; }
    if (nuevo === op.nombre_caso) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const r = await fetch(`/api/oportunidades/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre_caso: nuevo }),
      });
      if (!r.ok) throw new Error("No se pudo guardar el nombre");
      toast.success("Nombre actualizado");
      setEditingName(false);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSavingName(false); }
  };

  const saveValor = async () => {
    const num = Number(valorDraft);
    if (!Number.isFinite(num) || num < 0) { toast.error("Valor inválido"); return; }
    if (num === Number(op.valor_total || 0)) { setEditingValor(false); return; }
    setSavingValor(true);
    try {
      const r = await fetch(`/api/oportunidades/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor_total: num }),
      });
      if (!r.ok) throw new Error("No se pudo guardar el valor");
      toast.success("Valor total actualizado");
      setEditingValor(false);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSavingValor(false); }
  };

  const enviarSolicitud = async () => {
    const num = Number(solMonto);
    if (!Number.isFinite(num) || num < 0) { toast.error("Monto inválido"); return; }
    if (!solMotivo.trim()) { toast.error("El motivo es obligatorio"); return; }
    setSolEnviando(true);
    try {
      const r = await fetch(`/api/oportunidades/${id}/monto-solicitudes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto_propuesto: num, motivo: solMotivo.trim() }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "No se pudo enviar"); }
      toast.success("Solicitud enviada. Un administrador la revisará.");
      setSolicitarOpen(false); setSolMonto(""); setSolMotivo("");
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSolEnviando(false); }
  };

  const finalizar = async (resultado: "ganado" | "perdido") => {
    setFinalizing(resultado);
    try {
      const r = await fetch(`/api/oportunidades/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: resultado }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "No se pudo finalizar");
      toast.success(resultado === "ganado" ? "Oportunidad marcada como GANADA" : "Oportunidad marcada como PERDIDA");
      setFinalizeOpen(false);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setFinalizing(null); }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Back */}
        <button onClick={() => router.push("/oportunidades")} className="flex items-center gap-2 text-xs text-neutral-500 hover:text-brand-orange font-ui uppercase tracking-wider mb-4 transition">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Volver al pipeline
        </button>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl p-8 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-ui uppercase tracking-wider px-2 py-1 rounded-md bg-brand-blue/10 text-brand-blue">
                  {op.formulario_uscis || op.tramite_codigo}
                </span>
                <span className={cn("text-[10px] font-ui uppercase tracking-wider px-2 py-1 rounded-md", etapa?.bg, etapa?.text)}>
                  {etapa?.label}
                </span>
                <SLABadge estado={op.sla_estado} fechaLimite={op.sla_fecha_limite} />
              </div>
              {editingName ? (
                <div className="flex items-center gap-2 mb-1">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                    className="font-display text-3xl font-black leading-tight bg-white border-2 border-brand-orange rounded-xl px-3 py-1 outline-none w-full max-w-2xl text-neutral-900"
                  />
                  <button onClick={saveName} disabled={savingName} title="Guardar" className="h-10 w-10 rounded-xl bg-brand-green text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                    {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={2.5} />}
                  </button>
                  <button onClick={() => setEditingName(false)} disabled={savingName} title="Cancelar" className="h-10 w-10 rounded-xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200 flex items-center justify-center shrink-0 disabled:opacity-50">
                    <X className="h-5 w-5" strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-1 group">
                  <h1 className="font-display text-3xl font-black leading-tight">{op.nombre_caso}</h1>
                  <button
                    onClick={() => { setNameDraft(op.nombre_caso || ""); setEditingName(true); }}
                    title="Editar nombre"
                    className="h-8 w-8 rounded-lg text-neutral-400 hover:text-brand-orange hover:bg-brand-orange/10 flex items-center justify-center shrink-0 transition md:opacity-0 md:group-hover:opacity-100"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              )}
              {op.contacto_nombre && (
                <div className="flex items-center gap-2 text-neutral-500 mt-2">
                  <User className="h-4 w-4" strokeWidth={1.5} />
                  <span className="font-ui">{op.contacto_nombre}</span>
                  {op.contacto_telefono && (
                    <>
                      <span className="text-neutral-300">·</span>
                      <Phone className="h-3 w-3" strokeWidth={1.5} />
                      <span className="text-xs">{op.contacto_telefono}</span>
                    </>
                  )}
                  {/* 🔴 SOLO LECTURA, y leida del CONTACTO en cada carga: `oportunidades` no
                      guarda copia de la fecha. Si la guardara, corregir la del contacto dejaria
                      a las negociaciones con la vieja sin que nadie se enterara, y para cotizar
                      un seguro una fecha desactualizada es peor que ninguna.
                      La edad sale de `edadEnAnios`, la misma funcion que la ficha del contacto:
                      no hay una segunda cuenta de edad en el proyecto.
                      Sin fecha no se pinta NADA — ni un guion: el 97 % de los contactos todavia
                      no la tiene, y un hueco vacio en cada negociacion no informa de nada. */}
                  {op.contacto_fecha_nacimiento && (() => {
                    const anios = edadEnAnios(op.contacto_fecha_nacimiento);
                    return (
                      <>
                        <span className="text-neutral-300">·</span>
                        <Cake className="h-3 w-3" strokeWidth={1.5} />
                        <span className="text-xs" title="Fecha de nacimiento del contacto">
                          {fmtFechaSolo(op.contacto_fecha_nacimiento)}
                          {anios !== null && ` · ${anios} año${anios === 1 ? "" : "s"}`}
                        </span>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-500">Valor total</div>
              {editingValor ? (
                <div className="flex items-center gap-1.5 justify-end mt-0.5">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-2xl font-black text-brand-orange pointer-events-none">$</span>
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.01"
                      value={valorDraft}
                      onChange={(e) => setValorDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveValor(); if (e.key === "Escape") setEditingValor(false); }}
                      className="font-display text-3xl font-black tabular-nums text-brand-orange bg-white border-2 border-brand-orange rounded-xl pl-7 pr-2 py-1 outline-none w-44 text-right"
                    />
                  </div>
                  <button onClick={saveValor} disabled={savingValor} title="Guardar" className="h-9 w-9 rounded-xl bg-brand-green text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                    {savingValor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
                  </button>
                  <button onClick={() => setEditingValor(false)} disabled={savingValor} title="Cancelar" className="h-9 w-9 rounded-xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200 flex items-center justify-center shrink-0 disabled:opacity-50">
                    <X className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 justify-end group">
                  <div className="flex flex-col items-end leading-none">
                    {Number(op.total_descuentos || 0) > 0 && (
                      // Con descuento aprobado: valor original tachado encima del valor a cobrar.
                      <span className="font-display text-base font-black tabular-nums text-neutral-400 line-through">
                        ${Number(op.valor_total || 0).toFixed(0)}
                      </span>
                    )}
                    <div className="font-display text-4xl font-black tabular-nums text-brand-orange">
                      ${Number(op.total_a_cobrar != null ? op.total_a_cobrar : op.valor_total || 0).toFixed(0)}
                    </div>
                  </div>
                  {puedeEditarMonto ? (
                    <button
                      onClick={() => { setValorDraft(String(Number(op.valor_total || 0))); setEditingValor(true); }}
                      title="Editar valor total"
                      className="h-8 w-8 rounded-lg text-neutral-400 hover:text-brand-orange hover:bg-brand-orange/10 flex items-center justify-center shrink-0 transition md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Pencil className="h-4 w-4" strokeWidth={2} />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setSolMonto(String(Number(op.valor_total || 0))); setSolicitarOpen(true); }}
                      title="Solicitar cambio de monto"
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-neutral-100 text-neutral-600 hover:bg-brand-orange/10 hover:text-brand-orange transition shrink-0"
                    >
                      Solicitar cambio
                    </button>
                  )}
                </div>
              )}
              {Number(op.a_reintegrar || 0) > 0 ? (
                <div className="text-[11px] text-neutral-500 mt-1">A reintegrar: <span className="font-bold text-blue-600">${Number(op.a_reintegrar || 0).toFixed(0)}</span></div>
              ) : (
                <div className="text-[11px] text-neutral-500 mt-1">Balance: <span className="font-bold text-brand-red">${Number(op.balance_pendiente || 0).toFixed(0)}</span></div>
              )}
              {solicitudesPend.length > 0 && (
                <button
                  onClick={() => setMontoComparativa(solicitudesPend[0])}
                  title="Ver el cambio de monto solicitado"
                  className="solicitud-pendiente-btn mt-2 ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[11px] font-ui font-bold uppercase tracking-wider shadow-lg shadow-amber-500/40 hover:brightness-110 transition"
                >
                  ⏳ Cambio de monto pendiente
                </button>
              )}
            </div>
          </div>

          {/* Finalizar oportunidad → Dar Ganado / Dar Perdido.
              Oculto si la oportunidad YA está finalizada (ganado/perdido): solo indicador.

              🔴 Es el ÚNICO camino para cerrar un caso desde el 2026-09-02: la pestaña Pagos tenía
              un botón «Completar» que llevaba a la misma etapa (`ganado`) saltándose la validación
              de campos obligatorios y las automatizaciones. Se retiró.

              El disparador va en verde de marca (§4.3), no en negro: cerrar un caso es un desenlace
              y el negro no decía cuál. No choca con el «Dar Ganado» de abajo porque este botón SE
              SUSTITUYE por las dos opciones al pulsarlo — los dos verdes nunca coinciden en pantalla. */}
          {(op.etapa === "ganado" || op.etapa === "perdido") ? (
            <div className="mt-3">
              <span className={cn(
                "inline-flex items-center gap-2 h-10 px-4 rounded-xl text-xs font-ui font-bold uppercase tracking-wider",
                op.etapa === "ganado" ? "bg-brand-green/10 text-brand-green" : "bg-brand-red/10 text-brand-red"
              )}>
                {op.etapa === "ganado" ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <X className="h-4 w-4" strokeWidth={2.5} />}
                Oportunidad finalizada · {op.etapa === "ganado" ? "Ganado" : "Perdido"}
              </span>
            </div>
          ) : (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {!finalizeOpen ? (
              <button
                type="button"
                onClick={() => setFinalizeOpen(true)}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-green text-white text-xs font-ui font-bold uppercase tracking-wider hover:brightness-110 transition"
              >
                <Award className="h-4 w-4" strokeWidth={2} /> Finalizar oportunidad
              </button>
            ) : (
              <>
                <span className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">¿Cómo finalizó?</span>
                <button
                  type="button"
                  disabled={!!finalizing}
                  onClick={() => finalizar("ganado")}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-green text-white text-xs font-ui font-bold uppercase tracking-wider hover:brightness-110 transition disabled:opacity-60"
                >
                  {finalizing === "ganado" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />} Dar Ganado
                </button>
                <button
                  type="button"
                  disabled={!!finalizing}
                  onClick={() => finalizar("perdido")}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-red text-white text-xs font-ui font-bold uppercase tracking-wider hover:brightness-110 transition disabled:opacity-60"
                >
                  {finalizing === "perdido" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" strokeWidth={2.5} />} Dar Perdido
                </button>
                <button
                  type="button"
                  disabled={!!finalizing}
                  onClick={() => setFinalizeOpen(false)}
                  className="h-10 px-3 rounded-xl bg-white border border-neutral-200 text-neutral-500 text-xs font-ui font-bold uppercase tracking-wider hover:bg-neutral-50 disabled:opacity-60"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
          )}
        </motion.div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto scrollbar-thin pb-2">
          {TABS.map((t) => {
            const Icon = t.Icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-2 h-10 px-4 rounded-xl font-ui text-[11px] uppercase tracking-wider font-bold transition whitespace-nowrap",
                  active ? "gradient-orange text-white shadow-glow" : "bg-white/80 text-neutral-500 hover:bg-white hover:text-neutral-700"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="glass rounded-3xl p-8">
          {tab === "resumen" && <ResumenTabV2 op={op} tramites={data.tramites || []} onReload={load} pagos={data.pagos || []} totalPagado={data.total_pagado || 0} notasRecientes={data.notas_recientes || []} tareas={data.tareas || []} />}
          {tab === "documentos" && <DocumentosTab op={op} onReload={load} />}
          {tab === "drive" && (
            <div className="h-[calc(100vh-280px)] min-h-[500px]">
              <DriveBrowser
                rootScope="oportunidad"
                oportunidadId={op.id}
                className="h-full"
                volverA={op.contacto_id ? {
                  href: `/contactos/${op.contacto_id}?tab=documentos`,
                  etiqueta: op.contacto_nombre ? `Documentos de ${op.contacto_nombre}` : "Documentos del contacto",
                } : undefined}
              />
            </div>
          )}
          {tab === "cuestionario" && <CuestionarioTab op={op} onReload={load} />}
          {tab === "pagos" && <PagosTabV2 op={op} onReload={load} />}
          {tab === "notas" && <NotasTab opId={op.id} onChange={load} />}
          {tab === "puntajes" && <PuntajesTab op={op} onReload={load} />}
          {tab === "tareas" && <TareasTab tareas={data.tareas} oportunidadId={op.id} onReload={load} />}
          {tab === "actividad" && <ActividadTab actividad={data.actividad} />}
          {tab === "correos" && <CorreosTab op={op} />}
          {tab === "solicitudes" && <SolicitudesTab opId={op.id} onReload={load} />}
        </div>
      </div>

      {solicitarOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSolicitarOpen(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-black mb-3">Solicitar cambio de monto</h3>
            <label className="block text-xs font-bold text-neutral-500 mb-1">Monto propuesto</label>
            <input type="number" min="0" step="0.01" value={solMonto} onChange={(e) => setSolMonto(e.target.value)}
              className="w-full border-2 border-neutral-200 rounded-xl px-3 py-2 mb-3 outline-none focus:border-brand-orange" />
            <label className="block text-xs font-bold text-neutral-500 mb-1">Motivo (obligatorio)</label>
            <textarea rows={3} value={solMotivo} onChange={(e) => setSolMotivo(e.target.value)}
              placeholder="Explica por qué debe cambiar el monto…"
              className="w-full border-2 border-neutral-200 rounded-xl px-3 py-2 mb-4 outline-none focus:border-brand-orange resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSolicitarOpen(false)} className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 text-sm font-bold">Cancelar</button>
              <button onClick={enviarSolicitud} disabled={solEnviando || !solMotivo.trim()}
                className="px-4 py-2 rounded-xl gradient-orange text-white text-sm font-bold disabled:opacity-60">
                {solEnviando ? "Enviando…" : "Enviar solicitud"}
              </button>
            </div>
          </div>
        </div>
      )}

      {montoComparativa && (
        <ComparativaMontoModal
          solicitud={montoComparativa}
          valorActual={Number(op.valor_total || 0)}
          puedeAprobar={puedeEditarMonto}
          onClose={() => setMontoComparativa(null)}
          onResolved={() => { setMontoComparativa(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function ResumenTab({ op }: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-400 mb-3">Información del caso</div>
        <div className="space-y-3 text-sm">
          <Row label="Trámite">{op.tramite_nombre || "—"}</Row>
          <Row label="Formulario">{op.formulario_uscis || "—"}</Row>
          <Row label="Preparador">{op.preparador_nombre || <span className="text-neutral-400 italic">Sin asignar</span>}</Row>
          <Row label="Vendedor">{op.vendedor_nombre || "—"}</Row>
          <Row label="SLA">{op.sla_dias} días</Row>
          <Row label="Creado">{new Date(op.created_at).toLocaleDateString("es")}</Row>
        </div>
      </div>
      <div>
        <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-400 mb-3">Cliente</div>
        <div className="space-y-3 text-sm">
          <Row label="Nombre">{op.contacto_nombre || "—"}</Row>
          <Row label="Email">{op.contacto_email || "—"}</Row>
          <Row label="Teléfono">{op.contacto_telefono || "—"}</Row>
          <Row label="WhatsApp">{op.contacto_whatsapp || "—"}</Row>
        </div>
        {op.notas && (
          <div className="mt-6">
            <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Notas</div>
            <div className="text-sm text-neutral-600 rounded-xl bg-neutral-50 p-3 whitespace-pre-wrap">{op.notas}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/5 pb-2">
      <span className="font-ui text-[10px] uppercase tracking-wider text-neutral-400">{label}</span>
      <span className="text-sm font-medium text-right truncate">{children}</span>
    </div>
  );
}

type DocEntry = {
  id: string;
  analyzed_at: string;
  file?: { url: string; filename: string; mime?: string; size?: number } | null;
  analysis: any;
};

function DocumentosTab({ op, onReload }: any) {
  const { isAdmin } = useCurrentUser();
  const historialInicial: DocEntry[] = Array.isArray(op.documentos?.historial_analisis) ? op.documentos.historial_analisis : [];
  // Si no hay historial pero sí ultimo_analisis (registros antiguos), sintetizar una entrada visible
  const legado: DocEntry[] = (historialInicial.length === 0 && op.documentos?.ultimo_analisis)
    ? [{ id: "legacy", analyzed_at: op.documentos?.ultimo_analisis_at || new Date().toISOString(), file: null, analysis: op.documentos.ultimo_analisis }]
    : [];
  const [entries, setEntries] = useState<DocEntry[]>([...historialInicial, ...legado].sort((a, b) => (b.analyzed_at || "").localeCompare(a.analyzed_at || "")));
  const [pending, setPending] = useState<{ name: string; status: "queued" | "analyzing" | "error"; error?: string }[]>([]);
  const [preview, setPreview] = useState<DocEntry["file"] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const analyzeOne = async (file: File, idx: number) => {
    setPending((p) => p.map((x, i) => i === idx ? { ...x, status: "analyzing" } : x));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo_tramite", op.tramite_codigo || "");
      fd.append("oportunidad_id", op.id);
      const r = await fetch("/api/ai/analyze-document", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail || "Error al analizar");
      if (d.entry) {
        setEntries((list) => [d.entry, ...list]);
        setExpanded((s) => { const n = new Set(s); n.add(d.entry.id); return n; });
      }
      return { ok: true };
    } catch (e: any) {
      setPending((p) => p.map((x, i) => i === idx ? { ...x, status: "error", error: e.message } : x));
      return { ok: false, error: e.message };
    }
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const queued = files.map((f) => ({ name: f.name, status: "queued" as const }));
    setPending(queued);
    const results = await Promise.all(files.map((f, i) => analyzeOne(f, i)));
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    if (ok > 0) toast.success(`${ok} documento${ok === 1 ? "" : "s"} analizado${ok === 1 ? "" : "s"}`);
    if (fail > 0) toast.error(`${fail} fallido${fail === 1 ? "" : "s"}`);
    setTimeout(() => setPending((p) => p.filter((x) => x.status === "error")), 2000);
    onReload();
  };

  const uploadMany = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await processFiles(files);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragCounter.current++;
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    await processFiles(files);
  };

  const remove = async (entry: DocEntry) => {
    if (entry.id === "legacy") {
      setEntries((list) => list.filter((e) => e.id !== entry.id));
      return;
    }
    if (!confirm("¿Eliminar este análisis y su archivo?")) return;
    const r = await fetch(`/api/ai/analyze-document/${op.id}/${entry.id}`, { method: "DELETE" });
    if (r.ok) {
      setEntries((list) => list.filter((e) => e.id !== entry.id));
      toast.success("Eliminado");
      onReload();
    } else {
      toast.error("No se pudo eliminar");
    }
  };

  const isPdf = (f: DocEntry["file"]) => !!f && (f.mime === "application/pdf" || /\.pdf$/i.test(f.url));
  const isImg = (f: DocEntry["file"]) => !!f && ((f.mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.url));

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative"
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 rounded-3xl bg-gradient-to-br from-brand-orange/10 via-white/80 to-neon-magenta/10 backdrop-blur-sm border-2 border-dashed border-brand-orange flex items-center justify-center pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.9, y: 10 }} animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex flex-col items-center gap-3 text-center px-6"
            >
              <motion.div
                animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
                className="h-16 w-16 rounded-3xl bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow-[0_20px_60px_rgba(87,80,232,0.45)] flex items-center justify-center"
              >
                <Upload className="h-7 w-7" strokeWidth={2.2} />
              </motion.div>
              <div className="font-display text-2xl font-black text-slate-900">Suelta para analizar</div>
              <div className="text-sm text-slate-600">PDF, imágenes o texto · se genera un resumen y análisis completo con IA</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="font-display text-xl font-black">Análisis de documentos del caso</h3>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {entries.length} documento{entries.length === 1 ? "" : "s"} analizado{entries.length === 1 ? "" : "s"} con IA · <span className="text-brand-orange">arrastra aquí</span> para subir
          </div>
        </div>
        <label className="gradient-orange flex items-center gap-2 h-11 px-5 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow cursor-pointer hover:scale-[1.02] transition">
          <Upload className="h-4 w-4" strokeWidth={2} />
          {pending.length > 0 ? `Analizando ${pending.filter(p => p.status === "analyzing").length}/${pending.length}…` : "Subir + analizar con IA"}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.csv,.md,.html,.htm,.json,.xml,.rtf,.png,.jpg,.jpeg,.webp,.gif"
            multiple
            onChange={uploadMany}
            disabled={pending.some((p) => p.status !== "error")}
          />
        </label>
      </div>

      {/* Cola de procesamiento */}
      {pending.length > 0 && (
        <div className="mb-4 space-y-2">
          {pending.map((p, i) => (
            <div key={i} className={cn(
              "rounded-xl border px-4 py-2.5 flex items-center gap-3 text-sm",
              p.status === "error" ? "bg-red-50 border-red-200 text-red-700"
                : p.status === "analyzing" ? "bg-brand-orange/5 border-brand-orange/30"
                : "bg-neutral-50 border-neutral-200 text-neutral-500"
            )}>
              {p.status === "analyzing" ? <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />
                : p.status === "error" ? <AlertCircle className="h-4 w-4 text-red-500" />
                : <FileText className="h-4 w-4" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                {p.error && <div className="text-[11px] text-red-600 mt-0.5">{p.error}</div>}
              </div>
              <div className="text-[10px] font-ui uppercase tracking-wider">
                {p.status === "analyzing" ? "Analizando con IA…" : p.status === "error" ? "Error" : "En cola"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Historial */}
      {entries.length === 0 && pending.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center">
          <FileText className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
          <h4 className="font-display text-lg font-black mb-1">Sin documentos analizados todavía</h4>
          <p className="text-sm text-neutral-500">Sube documentos (PDF, Word, Excel, PowerPoint, CSV, imágenes...) hasta 100 MB y la IA generará un resumen y un análisis completo de cada uno</p>
        </div>
      )}

      <div className="space-y-3">
        {entries.map((entry) => {
          const a = entry.analysis || {};
          const open = expanded.has(entry.id);
          const sev = Array.isArray(a.alertas) && a.alertas.length > 0 ? "alert" : "ok";
          return (
            <div key={entry.id} className={cn(
              "rounded-2xl border overflow-hidden transition-shadow",
              sev === "alert" ? "bg-gradient-to-br from-brand-orange/5 to-red-50/50 border-brand-orange/25" : "bg-white border-black/5 hover:shadow-md"
            )}>
              <button type="button" onClick={() => toggle(entry.id)} className="w-full px-5 py-4 flex items-start gap-3 text-left">
                <div className={cn(
                  "h-10 w-10 rounded-xl shrink-0 flex items-center justify-center",
                  sev === "alert" ? "bg-brand-orange/15 text-brand-orange" : "bg-brand-blue/10 text-brand-blue"
                )}>
                  <Sparkles className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 text-[10px] font-ui uppercase tracking-wider">
                    <span className={sev === "alert" ? "text-brand-orange" : "text-brand-blue"}>Análisis de IA</span>
                    <span className="text-neutral-400">· {new Date(entry.analyzed_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {typeof a.confianza === "number" && <span className="ml-auto text-neutral-400">Confianza {a.confianza}%</span>}
                  </div>
                  <div className="font-display text-[15px] font-black leading-snug line-clamp-2">{a.resumen || "(sin resumen)"}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-neutral-500 flex-wrap">
                    {a.categoria && <span className="px-2 py-0.5 rounded-md bg-black/[0.04] font-ui uppercase tracking-wider">{a.categoria}</span>}
                    {entry.file?.filename && <span className="truncate">· {entry.file.filename}</span>}
                    {Array.isArray(a.alertas) && a.alertas.length > 0 && (
                      <span className="flex items-center gap-1 text-brand-red font-semibold">
                        <AlertCircle className="h-3 w-3" strokeWidth={2} /> {a.alertas.length} alerta{a.alertas.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {entry.file && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPreview(entry.file!); }}
                      className="h-9 w-9 rounded-lg hover:bg-black/5 text-neutral-500 flex items-center justify-center"
                      title="Ver archivo"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                  {entry.file && (
                    <a
                      href={entry.file.url}
                      download={entry.file.filename}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="h-9 w-9 rounded-lg hover:bg-black/5 text-neutral-500 flex items-center justify-center"
                      title="Descargar"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); remove(entry); }}
                      className="h-9 w-9 rounded-lg hover:bg-red-50 hover:text-brand-red text-neutral-400 flex items-center justify-center"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </button>

              {open && (
                <div className="px-5 pb-5 pt-1 space-y-4 border-t border-black/5">
                  {a.campos_detectados && typeof a.campos_detectados === "object" && Object.keys(a.campos_detectados).length > 0 && (
                    <div>
                      <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Campos detectados</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {Object.entries(a.campos_detectados).map(([k, v]: any) => (
                          <div key={k} className="rounded-lg bg-white border border-black/5 px-3 py-2">
                            <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-400">{k}</div>
                            <div className="text-sm font-medium break-words">{v === null || v === undefined || v === "" ? "—" : String(v)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(a.alertas) && a.alertas.length > 0 && (
                    <div>
                      <div className="font-ui text-[10px] uppercase tracking-wider text-brand-red mb-2 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" strokeWidth={2} />
                        Alertas ({a.alertas.length})
                      </div>
                      <div className="space-y-2">
                        {a.alertas.map((al: string, i: number) => (
                          <div key={i} className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-900 flex gap-2">
                            <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" strokeWidth={2} />
                            <span>{al}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(a.nombre_titular || a.fecha_documento || a.fecha_expiracion) && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {a.nombre_titular && (
                        <div className="rounded-lg bg-white border border-black/5 px-3 py-2">
                          <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-400">Titular</div>
                          <div className="text-sm font-medium">{a.nombre_titular}</div>
                        </div>
                      )}
                      {a.fecha_documento && (
                        <div className="rounded-lg bg-white border border-black/5 px-3 py-2">
                          <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-400">Fecha doc</div>
                          <div className="text-sm font-medium">{a.fecha_documento}</div>
                        </div>
                      )}
                      {a.fecha_expiracion && (
                        <div className="rounded-lg bg-white border border-black/5 px-3 py-2">
                          <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-400">Expira</div>
                          <div className="text-sm font-medium">{a.fecha_expiracion}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                Descargar
              </a>
              <button onClick={() => setPreview(null)} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 bg-neutral-50 flex items-center justify-center overflow-auto">
              {isImg(preview) ? <img src={preview.url} alt={preview.filename} className="max-w-full max-h-full object-contain" />
                : isPdf(preview) ? <iframe src={preview.url} className="w-full h-full border-0" />
                : (
                  <div className="text-center p-8">
                    <FileText className="h-14 w-14 text-neutral-400 mx-auto mb-3" strokeWidth={1.5} />
                    <p className="text-sm text-neutral-600 mb-4">No hay vista previa para este tipo de archivo.</p>
                    <a href={preview.url} download={preview.filename} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl gradient-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider">
                      <Download className="h-3.5 w-3.5" strokeWidth={2} /> Descargar archivo
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

function CuestionarioTab({ op, onReload }: any) {
  const secciones = op.cuestionario_json || [];
  const [datos, setDatos] = useState<Record<string, any>>(op.cuestionario_datos || {});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/oportunidades/${op.id}/cuestionario`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datos })
      });
      toast.success("Cuestionario guardado");
      onReload();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (secciones.length === 0) {
    return (
      <div className="text-center py-12">
        <ClipboardList className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
        <h4 className="font-display text-lg font-black mb-1">Sin cuestionario disponible</h4>
        <p className="text-sm text-neutral-500">El trámite {op.tramite_nombre} no tiene cuestionario configurado todavía</p>
      </div>
    );
  }

  const totalCampos = secciones.reduce((s: number, sec: any) => s + (sec.campos?.length || 0), 0);
  const llenados = Object.keys(datos).filter((k) => datos[k] !== undefined && datos[k] !== "").length;
  const progreso = totalCampos > 0 ? Math.round((llenados / totalCampos) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display text-xl font-black">Cuestionario {op.tramite_codigo}</h3>
          <div className="text-xs text-neutral-500 mt-1">{llenados} de {totalCampos} campos · {progreso}% completo</div>
        </div>
        <button onClick={save} disabled={saving} className="gradient-orange flex items-center gap-2 h-10 px-5 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2} />}
          Guardar
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden mb-6">
        <div className="h-full gradient-orange transition-all duration-500" style={{ width: `${progreso}%` }} />
      </div>

      <div className="space-y-8">
        {secciones.map((sec: any, i: number) => (
          <div key={i}>
            <h4 className="font-display font-black text-lg mb-3 text-gradient-orange">{sec.seccion}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sec.campos?.map((campo: any) => (
                <div key={campo.key} className={campo.tipo === "textarea" ? "md:col-span-2" : ""}>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">
                    {campo.label} {campo.required && <span className="text-brand-red">*</span>}
                  </label>
                  {campo.tipo === "select" ? (
                    <select
                      value={datos[campo.key] || ""}
                      onChange={(e) => setDatos({ ...datos, [campo.key]: e.target.value })}
                      className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    >
                      <option value="">—</option>
                      {campo.opciones?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : campo.tipo === "textarea" ? (
                    <textarea
                      value={datos[campo.key] || ""}
                      onChange={(e) => setDatos({ ...datos, [campo.key]: e.target.value })}
                      rows={3}
                      placeholder={campo.placeholder}
                      className="w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30 resize-none"
                    />
                  ) : (
                    <input
                      type={campo.tipo === "number" ? "number" : campo.tipo === "date" ? "date" : "text"}
                      value={datos[campo.key] || ""}
                      onChange={(e) => setDatos({ ...datos, [campo.key]: e.target.value })}
                      placeholder={campo.placeholder}
                      className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PagosTab({ op, onReload }: any) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ monto: "", metodo: "efectivo", referencia: "" });
  const [saving, setSaving] = useState(false);
  const pagos = op.pagos || [];
  const totalPagado = pagos.reduce((s: number, p: any) => s + Number(p.monto || 0), 0);

  const save = async () => {
    if (!form.monto) { toast.error("Monto requerido"); return; }
    setSaving(true);
    try {
      await fetch(`/api/oportunidades/${op.id}/pagos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: Number(form.monto), metodo: form.metodo, referencia: form.referencia })
      });
      toast.success("Pago registrado");
      setModal(false);
      setForm({ monto: "", metodo: "efectivo", referencia: "" });
      onReload();
    } catch {
      toast.error("Error");
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xl font-black">Pagos del caso</h3>
        <button onClick={() => setModal(true)} className="gradient-orange flex items-center gap-2 h-10 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow">
          <Plus className="h-4 w-4" strokeWidth={2} />
          Registrar pago
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl bg-neutral-50 p-4">
          <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">Valor total</div>
          <div className="font-display text-2xl font-black">${Number(op.valor_total || 0).toFixed(0)}</div>
        </div>
        <div className="rounded-2xl bg-green-50 p-4">
          <div className="text-[10px] font-ui uppercase tracking-wider text-green-600">Pagado</div>
          <div className="font-display text-2xl font-black text-brand-green">${totalPagado.toFixed(0)}</div>
        </div>
        <div className="rounded-2xl bg-red-50 p-4">
          <div className="text-[10px] font-ui uppercase tracking-wider text-red-600">Balance</div>
          <div className="font-display text-2xl font-black text-brand-red">${Number(op.balance_pendiente || 0).toFixed(0)}</div>
        </div>
      </div>
      {pagos.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <DollarSign className="h-10 w-10 text-brand-green mx-auto mb-3" strokeWidth={1.5} />
          <h4 className="font-display text-lg font-black mb-1">Sin pagos registrados</h4>
        </div>
      ) : (
        <div className="space-y-2">
          {pagos.map((p: any) => (
            <div key={p.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-display font-black text-lg text-brand-green">${Number(p.monto).toFixed(0)}</div>
                <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-400">{p.metodo} · {new Date(p.fecha).toLocaleDateString("es")}</div>
              </div>
              {p.referencia && <span className="text-xs text-neutral-500">Ref: {p.referencia}</span>}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="rounded-3xl p-8 max-w-md w-full modal-surface" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-2xl font-black mb-6">Registrar pago</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Monto *</label>
                <input type="number" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30" />
              </div>
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Método</label>
                <select value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })} className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm">
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="zelle">Zelle</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Referencia</label>
                <input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setModal(false)} className="flex-1 h-11 rounded-xl bg-white border border-black/10 font-ui text-xs font-bold uppercase tracking-wider">Cancelar</button>
              <button onClick={save} disabled={saving} className="flex-1 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60">
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PuntajesTab({ op, onReload }: any) {
  const roles = [
    { field: "vendedor_id", cargo: "vendedor", label: "Vendedor", color: "#5750E8" },
    { field: "preparador_id", cargo: "preparador", label: "Preparador", color: "#2196C9" },
    { field: "manager_general_id", cargo: "manager", label: "Manager", color: "#43A847" },
  ];
  const [users, setUsers] = useState<any[]>([]);
  const [pdata, setPdata] = useState<any>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const loadP = () => fetch(`/api/oportunidades/${op.id}/puntajes`).then((r) => r.json()).then(setPdata).catch(() => {});
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
    loadP();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.id]);
  const porCargo: any = pdata?.por_cargo || {};
  const tramites: any[] = pdata?.tramites || [];
  const total = roles.reduce((s, r) => s + Number(porCargo[r.cargo] || 0), 0);
  const maxPts = Math.max(1, ...roles.map((r) => Number(porCargo[r.cargo] || 0)));
  const assign = async (field: string, userId: string) => {
    setSaving(field);
    try {
      const r = await fetch(`/api/oportunidades/${op.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: userId || null }) });
      if (!r.ok) throw new Error("error");
      toast.success("Asignado");
      onReload?.();
    } catch { toast.error("Error al asignar"); } finally { setSaving(null); }
  };
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-display text-xl font-black">Puntajes acumulados del caso</h3>
          <div className="text-xs text-neutral-500 mt-1">Puntos por cargo sumando {tramites.length} tramite(s) de esta oportunidad.</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-400">Total acumulado</div>
          <div className="font-display text-4xl font-black text-brand-orange tabular-nums leading-none">{total.toFixed(2)}</div>
          <div className="text-[10px] text-neutral-400">puntos</div>
        </div>
      </div>

      <div className="space-y-2.5">
        {roles.map((r) => {
          const pts = Number(porCargo[r.cargo] || 0);
          const pct = (pts / maxPts) * 100;
          const u = users.find((x: any) => x.id === op[r.field]);
          return (
            <div key={r.field} className="bg-white rounded-2xl border border-neutral-100 p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <div className="w-44 shrink-0">
                  <div className="text-sm font-bold">{r.label}</div>
                  <div className="text-[10px] text-neutral-400">{u ? u.nombre : "sin asignar"}</div>
                </div>
                <select value={op[r.field] || ""} disabled={saving === r.field} onChange={(e) => assign(r.field, e.target.value)} className="flex-1 h-9 px-2 rounded-lg bg-neutral-50 border border-neutral-200 text-sm outline-none focus:border-brand-orange">
                  <option value="">- Sin asignar -</option>
                  {users.map((x: any) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}
                </select>
                <div className="w-16 text-right font-display font-black tabular-nums">{pts.toFixed(2)}</div>
              </div>
              <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: r.color }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-neutral-100 p-4">
        <div className="text-[11px] font-ui uppercase tracking-wider text-neutral-500 mb-3">Tramites en esta oportunidad ({tramites.length})</div>
        {tramites.length === 0 ? (
          <div className="text-sm text-neutral-400">Sin tramites asociados.</div>
        ) : (
          <div className="space-y-2">
            {tramites.map((t: any, i: number) => (
              <div key={(t.id || "") + "-" + i} className="flex items-center gap-2 text-sm py-1 border-b border-neutral-50 last:border-0">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: t.color || "#5C6670" }} />
                <span className="font-semibold">{t.nombre}</span>
                <span className="text-[10px] text-neutral-400">{t.codigo}</span>
                <span className="ml-auto font-display font-black tabular-nums">{Number(t.puntaje_vendedor || 0).toFixed(2)} <span className="text-[10px] text-neutral-400 font-normal">pts/cargo</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TareasTab({ tareas, oportunidadId, onReload }: { tareas: any[]; oportunidadId: string; onReload: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openNew = () => { setEditingId(null); setModalOpen(true); };
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true); };

  const toggleDone = async (t: any) => {
    const nuevo = t.estado === "completada" ? "pendiente" : "completada";
    try {
      const r = await fetch(`/api/tareas/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: nuevo }) });
      if (!r.ok) throw new Error();
      onReload();
    } catch { toast.error("No se pudo actualizar la tarea"); }
  };
  const del = async (t: any) => {
    if (!confirm(`¿Eliminar la tarea "${t.titulo}"? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await fetch(`/api/tareas/${t.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      toast.success("Tarea eliminada");
      onReload();
    } catch { toast.error("No se pudo eliminar la tarea"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] font-ui uppercase tracking-wider text-neutral-500">
          {tareas?.length || 0} tarea{(tareas?.length || 0) === 1 ? "" : "s"}
        </div>
        <button
          onClick={openNew}
          className="gradient-orange h-9 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow hover:scale-[1.02] transition flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Crear tarea
        </button>
      </div>

      {(!tareas || tareas.length === 0) ? (
        <div className="text-center py-12">
          <CheckSquare className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
          <h4 className="font-display text-lg font-black mb-1">Sin tareas asociadas</h4>
          <p className="text-sm text-neutral-500">Crea la primera tarea ligada a esta oportunidad</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tareas.map((t: any) => (
            <div
              key={t.id}
              onClick={() => openEdit(t.id)}
              className="group w-full glass rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:shadow-glow-lg transition cursor-pointer"
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleDone(t); }}
                title={t.estado === "completada" ? "Marcar como pendiente" : "Marcar como completada"}
                className="shrink-0"
              >
                <CheckSquare className={cn("h-5 w-5 transition-colors", t.estado === "completada" ? "text-brand-green" : "text-neutral-400 hover:text-brand-green")} strokeWidth={1.5} />
              </button>
              <div className="flex-1 min-w-0">
                <div className={cn("font-display font-bold text-sm", t.estado === "completada" && "line-through text-neutral-400")}>{t.titulo}</div>
                <div className="text-[11px] text-neutral-500">{t.responsable_nombre || "Sin asignar"}</div>
              </div>
              <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-ui uppercase tracking-wider font-bold shrink-0",
                t.estado === "completada" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
              )}>{t.estado}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); del(t); }}
                title="Eliminar tarea"
                className="shrink-0 h-8 w-8 rounded-lg text-neutral-300 hover:text-brand-red hover:bg-red-50 flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}

      <TaskModal
        open={modalOpen}
        tareaId={editingId}
        prefill={{ oportunidad_id: oportunidadId }}
        oportunidadIdLock={oportunidadId}
        onClose={() => { setModalOpen(false); setEditingId(null); }}
        onSaved={onReload}
      />
    </div>
  );
}

function ActividadTab({ actividad }: any) {
  if (!actividad || actividad.length === 0) {
    return (
      <div className="text-center py-12">
        <Activity className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
        <h4 className="font-display text-lg font-black mb-1">Sin actividad registrada</h4>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {actividad.map((a: any, i: number) => (
        <div key={i} className="flex items-start gap-3 py-2 border-b border-black/5 last:border-0">
          <div className="h-2 w-2 rounded-full bg-brand-orange mt-2 shrink-0" />
          <div className="flex-1">
            <div className="text-sm"><strong>{a.user_nombre || "Sistema"}</strong> · {a.accion}</div>
            <div className="text-[11px] text-neutral-400">{new Date(a.created_at).toLocaleString("es")}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CorreosTab({ op }: any) {
  const clienteEmail: string = op?.contacto_email || "";
  const [emails, setEmails] = useState<any[] | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "recibidos" | "enviados">("todos");
  const [composeOpen, setComposeOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!clienteEmail && !op?.contacto_id) { setEmails([]); return; }
    const qs = clienteEmail ? `email=${encodeURIComponent(clienteEmail)}` : `contacto_id=${op.contacto_id}`;
    fetch(`/api/emails?${qs}`).then((r) => r.json()).then((d) => setEmails(d.emails || [])).catch(() => setEmails([]));
  }, [clienteEmail, op?.contacto_id]);
  useEffect(() => { load(); }, [load]);

  const filtered = (emails || []).filter((e: any) => filtro === "todos" || (filtro === "recibidos" ? e.direccion === "entrante" : e.direccion === "saliente"));
  const ordered = [...filtered].reverse();
  const FILTROS: { k: "todos" | "recibidos" | "enviados"; lbl: string }[] = [
    { k: "todos", lbl: "Todos" }, { k: "recibidos", lbl: "Recibidos" }, { k: "enviados", lbl: "Enviados" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-sm">
          <span className="text-neutral-500">Conversacion por correo con</span>{" "}
          <strong>{op?.contacto_nombre || clienteEmail || "el cliente"}</strong>
          {clienteEmail && <span className="text-[11px] text-neutral-400 ml-1">({clienteEmail})</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-xl bg-neutral-100">
            {FILTROS.map((f) => (
              <button key={f.k} onClick={() => setFiltro(f.k)} className={cn("px-3 h-8 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider transition", filtro === f.k ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500")}>{f.lbl}</button>
            ))}
          </div>
          <button onClick={() => setComposeOpen(true)} disabled={!clienteEmail} title={clienteEmail ? "" : "El contacto no tiene correo"} className="h-9 px-4 rounded-xl gradient-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            <Send className="h-3.5 w-3.5" strokeWidth={2} /> Enviar correo
          </button>
        </div>
      </div>

      {emails === null ? (
        <div className="text-center py-10 text-sm text-neutral-400">Cargando...</div>
      ) : ordered.length === 0 ? (
        <div className="text-center py-12">
          <Mail className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
          <h4 className="font-display text-lg font-black mb-1">Sin correos {filtro !== "todos" ? "(" + filtro + ")" : ""}</h4>
          <p className="text-sm text-neutral-500">{clienteEmail ? "Usa Enviar correo para escribirle al cliente." : "Este contacto no tiene correo registrado."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((e: any) => {
            const saliente = e.direccion === "saliente";
            const expanded = openId === e.id;
            return (
              <div key={e.id} className={cn("flex", saliente ? "justify-end" : "justify-start")}>
                <button onClick={() => setOpenId(expanded ? null : e.id)} className={cn("max-w-[80%] text-left rounded-2xl px-4 py-3 border transition", saliente ? "bg-brand-green/10 border-brand-green/20" : "bg-white border-neutral-200")}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", saliente ? "bg-brand-green" : "bg-brand-blue")} />
                    <span className="text-[11px] font-bold truncate">{saliente ? "Tu" : (e.from_name || e.from_addr)}</span>
                    {e.carpeta && <span className="text-[9px] uppercase tracking-wider text-neutral-400">{e.carpeta}</span>}
                    <span className="text-[10px] text-neutral-400 ml-auto shrink-0">{new Date(e.fecha_email).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <div className="text-sm font-semibold">{e.subject || "(sin asunto)"}</div>
                  <div className={cn("text-[13px] text-neutral-600 mt-1 whitespace-pre-wrap break-words", !expanded && "max-h-16 overflow-hidden")}>{e.body_text || ""}</div>
                  {(e.body_text || "").length > 160 && <span className="text-[10px] text-brand-orange font-bold uppercase tracking-wider">{expanded ? "Ver menos" : "Ver mas"}</span>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <EmailComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        contactoId={op?.contacto_id || null}
        oportunidadId={op?.id || null}
        toEmail={clienteEmail}
        toName={op?.contacto_nombre}
        defaultSubject={op?.nombre_caso ? `Re: ${op.nombre_caso}` : ""}
        onSent={() => { setComposeOpen(false); setTimeout(load, 800); }}
      />
    </div>
  );
}

