"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Bot, Lightning, Clock, Plus, Edit3, Trash2, WhatsappLogo, Envelope,
  CaretRight, CheckCircle2, XCircle, Sparkle,
} from "@/lib/bootstrap-icons";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useCurrentUser } from "@/lib/auth-user";
import { cn } from "@/lib/utils";
import { AgenteModal } from "@/components/automatizaciones/AgenteModal";
import { ReglaModal } from "@/components/automatizaciones/ReglaModal";
import { RecordatorioModal } from "@/components/automatizaciones/RecordatorioModal";
import type { AgenteIA, AutomatizacionRegla, Recordatorio } from "@/components/automatizaciones/types";
import type { WhatsAppPipelineStage, WhatsAppTag } from "@/components/whatsapp/types";

type Tab = "agentes" | "reglas" | "recordatorios";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "agentes", label: "Agentes de IA", icon: Bot },
  { id: "reglas", label: "Reglas", icon: Lightning },
  { id: "recordatorios", label: "Recordatorios", icon: Clock },
];

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AutomatizacionesPage() {
  const { isAdmin } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("agentes");

  const [agentes, setAgentes] = useState<AgenteIA[] | null>(null);
  const [reglas, setReglas] = useState<AutomatizacionRegla[] | null>(null);
  const [recordatorios, setRecordatorios] = useState<Recordatorio[] | null>(null);
  const [etapas, setEtapas] = useState<WhatsAppPipelineStage[]>([]);
  const [tags, setTags] = useState<WhatsAppTag[]>([]);

  const [agenteModal, setAgenteModal] = useState<{ open: boolean; agente: AgenteIA | null }>({ open: false, agente: null });
  const [reglaModal, setReglaModal] = useState<{ open: boolean; regla: AutomatizacionRegla | null }>({ open: false, regla: null });
  const [recordatorioModalOpen, setRecordatorioModalOpen] = useState(false);
  const [borrarRegla, setBorrarRegla] = useState<AutomatizacionRegla | null>(null);
  const [cancelarRecordatorio, setCancelarRecordatorio] = useState<Recordatorio | null>(null);

  const loadAgentes = () => fetch("/api/automatizaciones/agentes").then((r) => r.json()).then((d) => setAgentes(d.agentes || [])).catch(() => {});
  const loadReglas = () => fetch("/api/automatizaciones/reglas").then((r) => r.json()).then((d) => setReglas(d.reglas || [])).catch(() => {});
  const loadRecordatorios = () => fetch("/api/automatizaciones/recordatorios").then((r) => r.json()).then((d) => setRecordatorios(d.recordatorios || [])).catch(() => {});

  useEffect(() => {
    loadAgentes();
    loadReglas();
    loadRecordatorios();
    fetch("/api/whatsapp/etapas").then((r) => r.json()).then((d) => setEtapas(d.etapas || [])).catch(() => {});
    fetch("/api/whatsapp/tags").then((r) => r.json()).then((d) => setTags(d.tags || [])).catch(() => {});
  }, []);

  const eliminarRegla = async () => {
    if (!borrarRegla) return;
    const r = await fetch(`/api/automatizaciones/reglas/${borrarRegla.id}`, { method: "DELETE" });
    if (r.ok) { toast.success("Regla eliminada"); loadReglas(); } else toast.error("No se pudo eliminar");
    setBorrarRegla(null);
  };

  const confirmarCancelarRecordatorio = async () => {
    if (!cancelarRecordatorio) return;
    const r = await fetch(`/api/automatizaciones/recordatorios/${cancelarRecordatorio.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast.success("Recordatorio cancelado"); loadRecordatorios(); } else toast.error(d.error || "No se pudo cancelar");
    setCancelarRecordatorio(null);
  };

  const agenteDe = (id: string) => agentes?.find((a) => a.id === id);
  const etapaDe = (id: string | null) => etapas.find((e) => e.id === id);
  const tagDe = (id: string | null) => tags.find((t) => t.id === id);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-primary font-ui uppercase text-[11px] tracking-wider mb-3">
              <Sparkle className="h-3.5 w-3.5" weight="duotone" />
              Fase 2 · WhatsApp
            </div>
            <h1 className="font-display text-4xl font-black leading-tight">
              <span className="text-gradient-orange">Automatizaciones</span>
            </h1>
            <p className="mt-2 text-neutral-500">Agentes de IA de n8n, reglas por etapa/etiqueta y recordatorios programados.</p>
          </div>
        </motion.div>

        <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/10 rounded-xl p-1 mb-6">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "h-9 px-3.5 rounded-lg flex items-center gap-2 text-xs font-ui font-bold uppercase tracking-wider transition",
                  tab === t.id ? "bg-white dark:bg-white/10 shadow-sm text-brand-primary" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" weight="duotone" /> {t.label}
              </button>
            );
          })}
        </div>

        {/* ---- Agentes de IA ---- */}
        {tab === "agentes" && (
          <div>
            {isAdmin && (
              <div className="flex justify-end mb-4">
                <Button onClick={() => setAgenteModal({ open: true, agente: null })}><Plus className="h-4 w-4" /> Nuevo agente</Button>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {agentes === null ? (
                Array.from({ length: 2 }).map((_, i) => <div key={i} className="rounded-xl2 h-28 skeleton" />)
              ) : agentes.length === 0 ? (
                <EstadoVacio icon={Bot} texto="Todavía no hay agentes de IA. Crea uno y conéctalo a un workflow de n8n." />
              ) : (
                agentes.map((a) => (
                  <Card key={a.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 rounded-xl gradient-orange text-white flex items-center justify-center shrink-0">
                        <Bot className="h-5 w-5" weight="duotone" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-sm truncate">{a.nombre}</div>
                          <Badge variant={a.activo ? "success" : "default"} size="sm">{a.activo ? "Activo" : "Inactivo"}</Badge>
                        </div>
                        <div className="text-[11px] text-neutral-500 truncate mt-0.5">{a.email}</div>
                        <div className="flex items-center gap-1.5 text-[11px] mt-1.5">
                          {a.n8n_webhook_url ? (
                            <span className="text-brand-green flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" weight="duotone" /> Conectado a n8n</span>
                          ) : (
                            <span className="text-neutral-400 flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> Sin webhook</span>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <button onClick={() => setAgenteModal({ open: true, agente: a })} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center shrink-0 text-neutral-400">
                          <Edit3 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}

        {/* ---- Reglas ---- */}
        {tab === "reglas" && (
          <div>
            {isAdmin && (
              <div className="flex justify-end mb-4">
                <Button onClick={() => setReglaModal({ open: true, regla: null })}><Plus className="h-4 w-4" /> Nueva regla</Button>
              </div>
            )}
            <div className="space-y-3">
              {reglas === null ? (
                Array.from({ length: 2 }).map((_, i) => <div key={i} className="rounded-xl2 h-20 skeleton" />)
              ) : reglas.length === 0 ? (
                <EstadoVacio icon={Lightning} texto="Sin reglas todavía — cuando llegue un mensaje que calce con una etapa o etiqueta, se avisa al agente de IA que elijas." />
              ) : (
                reglas.map((r) => {
                  const etapa = etapaDe(r.etapa_id);
                  const tag = tagDe(r.tag_id);
                  const agente = agenteDe(r.agente_id);
                  return (
                    <Card key={r.id} className="p-4 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{r.nombre}</span>
                          <Badge variant={r.activa ? "success" : "default"} size="sm">{r.activa ? "Activa" : "Pausada"}</Badge>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11px]">
                          {etapa && <span className="px-1.5 py-0.5 rounded font-ui font-bold uppercase tracking-wider" style={{ backgroundColor: `${etapa.color}22`, color: etapa.color }}>{etapa.label}</span>}
                          {tag && <span className="px-1.5 py-0.5 rounded font-ui font-bold uppercase tracking-wider" style={{ backgroundColor: `${tag.color}22`, color: tag.color }}>{tag.nombre}</span>}
                          <CaretRight className="h-3 w-3 text-neutral-400" />
                          <span className="text-neutral-600 dark:text-neutral-300 font-semibold">{agente?.nombre || "Agente eliminado"}</span>
                          {r.asignar_conversacion && <span className="text-neutral-400">· asigna la conversación</span>}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setReglaModal({ open: true, regla: r })} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-neutral-400">
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button onClick={() => setBorrarRegla(r)} className="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center justify-center text-neutral-400 hover:text-brand-red">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ---- Recordatorios ---- */}
        {tab === "recordatorios" && (
          <div>
            <div className="flex justify-end mb-4">
              <Button onClick={() => setRecordatorioModalOpen(true)}><Plus className="h-4 w-4" /> Nuevo recordatorio</Button>
            </div>
            <div className="space-y-2">
              {recordatorios === null ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="rounded-xl2 h-16 skeleton" />)
              ) : recordatorios.length === 0 ? (
                <EstadoVacio icon={Clock} texto="Sin recordatorios programados." />
              ) : (
                recordatorios.map((rec) => {
                  const pendiente = !rec.enviado_at;
                  const conError = !!rec.error;
                  return (
                    <Card key={rec.id} className="p-3.5 flex items-center gap-3">
                      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", rec.canal === "whatsapp" ? "bg-brand-green/10 text-brand-green" : "bg-brand-blue/10 text-brand-blue")}>
                        {rec.canal === "whatsapp" ? <WhatsappLogo className="h-4.5 w-4.5" weight="duotone" /> : <Envelope className="h-4.5 w-4.5" weight="duotone" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{rec.mensaje}</div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {fmtFecha(rec.programado_para)}
                          {conError && <span className="text-brand-red ml-2">· {rec.error}</span>}
                          {!conError && !pendiente && <span className="text-brand-green ml-2">· Enviado</span>}
                        </div>
                      </div>
                      {pendiente && (
                        <button onClick={() => setCancelarRecordatorio(rec)} className="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center justify-center shrink-0 text-neutral-400 hover:text-brand-red">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {agenteModal.open && (
        <AgenteModal
          agente={agenteModal.agente}
          onClose={() => setAgenteModal({ open: false, agente: null })}
          onSaved={() => { setAgenteModal({ open: false, agente: null }); loadAgentes(); }}
        />
      )}
      {reglaModal.open && (
        <ReglaModal
          regla={reglaModal.regla}
          etapas={etapas}
          tags={tags}
          agentes={agentes || []}
          onClose={() => setReglaModal({ open: false, regla: null })}
          onSaved={() => { setReglaModal({ open: false, regla: null }); loadReglas(); }}
        />
      )}
      {recordatorioModalOpen && (
        <RecordatorioModal
          onClose={() => setRecordatorioModalOpen(false)}
          onSaved={() => { setRecordatorioModalOpen(false); loadRecordatorios(); }}
        />
      )}
      {borrarRegla && (
        <ConfirmDialog
          danger
          title="Eliminar regla"
          message={<>¿Eliminar <strong className="text-neutral-800 dark:text-neutral-100">{borrarRegla.nombre}</strong>? Los mensajes futuros que calzaban con ella ya no avisarán a ningún agente.</>}
          confirmLabel="Eliminar"
          onConfirm={eliminarRegla}
          onCancel={() => setBorrarRegla(null)}
        />
      )}
      {cancelarRecordatorio && (
        <ConfirmDialog
          danger
          title="Cancelar recordatorio"
          message="¿Cancelar este recordatorio? No se enviará."
          confirmLabel="Cancelar recordatorio"
          onConfirm={confirmarCancelarRecordatorio}
          onCancel={() => setCancelarRecordatorio(null)}
        />
      )}
    </AppShell>
  );
}

function EstadoVacio({ icon: Icon, texto }: { icon: any; texto: string }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center text-center px-6 py-16 gap-3 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02]">
      <div className="h-14 w-14 rounded-2xl glass-panel text-brand-primary flex items-center justify-center">
        <Icon className="h-6 w-6" weight="duotone" />
      </div>
      <p className="text-sm text-neutral-500 max-w-[320px]">{texto}</p>
    </div>
  );
}
