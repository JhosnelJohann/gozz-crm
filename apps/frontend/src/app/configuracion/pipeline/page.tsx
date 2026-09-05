"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter
} from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ArrowLeft, Plus, Trash, GripVertical, Bolt, Settings, X, Check, ChevronDown } from "@/lib/bootstrap-icons";
import { PipelineStage, StageAutomation, CAMPOS_OBLIGATORIOS_DISPONIBLES, invalidateStagesCache } from "@/lib/pipeline";

const AUTOMATION_TIPOS = [
  { tipo: "crear_tarea", label: "Crear tarea", icon: "📋" },
  { tipo: "enviar_webhook", label: "Enviar webhook", icon: "🔗" },
  { tipo: "notificar", label: "Notificar usuario", icon: "🔔" },
  { tipo: "asignar_preparador", label: "Asignar preparador", icon: "👤" },
  { tipo: "enviar_email", label: "Enviar email", icon: "✉️" },
  { tipo: "mover_tras_dias", label: "Mover tras X días", icon: "⏱️" },
] as const;

function SortableRow({ stage, onEdit, onDelete, onAutomations }: { stage: PipelineStage; onEdit: () => void; onDelete: () => void; onAutomations: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      className="glass rounded-2xl p-4 flex items-center gap-3"
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-brand-orange">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="h-8 w-8 rounded-lg shrink-0" style={{ background: stage.color, boxShadow: `0 0 12px ${stage.color}40` }} />
      <div className="flex-1 min-w-0">
        <div className="font-display font-black text-sm">{stage.label}</div>
        <div className="text-[10px] text-neutral-500 font-ui uppercase tracking-wider flex items-center gap-2 mt-0.5">
          <span>{stage.key}</span>
          {stage.es_terminal && <span className="text-brand-red">terminal</span>}
          {stage.es_ganado && <span className="text-brand-green">ganada</span>}
          {Array.isArray(stage.campos_obligatorios) && stage.campos_obligatorios.length > 0 && (
            <span className="text-brand-orange">{stage.campos_obligatorios.length} campos obl.</span>
          )}
        </div>
      </div>
      <button onClick={onAutomations} className="h-8 px-3 rounded-lg bg-brand-orange/10 text-brand-orange text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/20 flex items-center gap-1.5">
        <Bolt className="h-3 w-3" /> Automations
      </button>
      <button onClick={onEdit} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center" title="Editar">
        <Settings className="h-4 w-4 text-neutral-500" />
      </button>
      <button onClick={onDelete} className="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-brand-red flex items-center justify-center" title="Eliminar">
        <Trash className="h-4 w-4" />
      </button>
    </div>
  );
}

function StageEditorModal({ stage, onClose, onSaved }: { stage: Partial<PipelineStage> | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    key: stage?.key || "",
    label: stage?.label || "",
    color: stage?.color || "#5C6670",
    es_terminal: stage?.es_terminal || false,
    es_ganado: stage?.es_ganado || false,
    campos_obligatorios: (stage?.campos_obligatorios as string[]) || [],
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.key || !form.label) { toast.error("Key y label requeridos"); return; }
    setSaving(true);
    try {
      const isNew = !stage?.id;
      const url = isNew ? "/api/pipeline/stages" : `/api/pipeline/stages/${stage!.id}`;
      const method = isNew ? "POST" : "PATCH";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!r.ok) { const b = await r.json(); throw new Error(JSON.stringify(b.error || b)); }
      toast.success(isNew ? "Etapa creada" : "Etapa actualizada");
      invalidateStagesCache();
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()} className="rounded-3xl p-8 max-w-md w-full modal-surface">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display text-xl font-black">{stage?.id ? "Editar etapa" : "Nueva etapa"}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Key (slug)</label>
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} disabled={!!stage?.id} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Label</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })} className="h-10 w-14 rounded-xl border border-black/10 cursor-pointer" />
              <input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })} className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm font-mono" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.es_terminal} onChange={(e) => setForm({ ...form, es_terminal: e.target.checked })} /> Es terminal</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.es_ganado} onChange={(e) => setForm({ ...form, es_ganado: e.target.checked })} /> Es ganada</label>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-2">Campos obligatorios para entrar a esta etapa</label>
            <div className="flex flex-wrap gap-1.5">
              {CAMPOS_OBLIGATORIOS_DISPONIBLES.map((c) => {
                const on = form.campos_obligatorios.includes(c.key);
                return (
                  <button key={c.key} type="button" onClick={() => setForm({ ...form, campos_obligatorios: on ? form.campos_obligatorios.filter((k) => k !== c.key) : [...form.campos_obligatorios, c.key] })} className={`text-[11px] px-2 py-1 rounded-lg border transition ${on ? "bg-brand-orange text-white border-brand-orange" : "bg-white dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-brand-orange/50"}`}>
                    {on && <Check className="inline h-3 w-3 mr-1" />}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-black/10 dark:border-white/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5">Cancelar</button>
          <button onClick={save} disabled={saving} className="flex-1 h-11 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AutomationsDrawer({ stage, onClose }: { stage: PipelineStage; onClose: () => void }) {
  const [autos, setAutos] = useState<StageAutomation[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = async () => {
    const r = await fetch(`/api/pipeline/stages/${stage.id}/automations`);
    const d = await r.json();
    setAutos(d.automations || []);
  };

  useEffect(() => { load(); }, [stage.id]);

  const addAction = async (tipo: string) => {
    const defaults: Record<string, any> = {
      crear_tarea: { titulo: "Tarea auto-generada", descripcion: "", due_dias: 3, prioridad: "normal" },
      enviar_webhook: { url: "", method: "POST", payload: { oportunidad_id: "{{op.id}}" } },
      notificar: { titulo: "Oportunidad actualizada", mensaje: "Caso {{op.nombre_caso}} en nueva etapa", prioridad: "normal" },
      asignar_preparador: { user_id: "" },
      enviar_email: { template: "", destinatario: "contacto" },
      mover_tras_dias: { dias: 7, etapa_destino: "" },
    };
    const r = await fetch(`/api/pipeline/stages/${stage.id}/automations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, config: defaults[tipo] || {}, activa: true, orden: (autos?.length || 0) + 1 })
    });
    if (r.ok) { toast.success("Acción agregada"); setAdding(null); load(); }
    else toast.error("Error al agregar");
  };

  const updateAuto = async (a: StageAutomation, patch: Partial<StageAutomation>) => {
    await fetch(`/api/pipeline/automations/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    load();
  };

  const removeAuto = async (a: StageAutomation) => {
    if (!confirm("¿Eliminar esta acción?")) return;
    await fetch(`/api/pipeline/automations/${a.id}`, { method: "DELETE" });
    load();
  };

  return (
    <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 260, damping: 30 }} className="fixed right-0 top-0 h-full w-[480px] max-w-[92vw] bg-white dark:bg-neutral-900 shadow-2xl z-50 flex flex-col border-l border-black/10 dark:border-white/10">
      <div className="p-5 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">Automations</div>
          <h3 className="font-display text-xl font-black">{stage.label}</h3>
        </div>
        <button onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {autos === null ? (
          <div className="text-center text-sm text-neutral-500 py-8">Cargando…</div>
        ) : autos.length === 0 ? (
          <div className="text-center text-sm text-neutral-500 py-8">Sin acciones configuradas. Agrega abajo.</div>
        ) : (
          autos.map((a) => {
            const meta = AUTOMATION_TIPOS.find((t) => t.tipo === a.tipo);
            return (
              <div key={a.id} className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{meta?.icon}</span>
                    <div className="font-display font-black text-sm">{meta?.label}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1 text-[10px] cursor-pointer"><input type="checkbox" checked={a.activa} onChange={(e) => updateAuto(a, { activa: e.target.checked })} /> activa</label>
                    <button onClick={() => removeAuto(a)} className="h-7 w-7 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-brand-red flex items-center justify-center"><Trash className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <ConfigEditor auto={a} onChange={(cfg) => updateAuto(a, { config: cfg })} />
              </div>
            );
          })
        )}
      </div>
      <div className="p-5 border-t border-black/5 dark:border-white/5">
        {adding ? (
          <div className="grid grid-cols-2 gap-2">
            {AUTOMATION_TIPOS.map((t) => (
              <button key={t.tipo} onClick={() => addAction(t.tipo)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 hover:border-brand-orange hover:bg-brand-orange/5 text-left text-xs">
                <span className="text-lg">{t.icon}</span>
                <span className="font-medium">{t.label}</span>
              </button>
            ))}
            <button onClick={() => setAdding(null)} className="col-span-2 text-xs text-neutral-500 hover:text-brand-orange mt-2">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setAdding("new")} className="w-full h-11 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 flex items-center justify-center gap-2">
            <Plus className="h-4 w-4" /> Agregar acción
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ConfigEditor({ auto, onChange }: { auto: StageAutomation; onChange: (cfg: any) => void }) {
  const [local, setLocal] = useState<any>(auto.config || {});
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => {
    if (auto.tipo === "asignar_preparador" || auto.tipo === "notificar") {
      fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || []));
    }
  }, [auto.tipo]);
  const commit = () => onChange(local);

  if (auto.tipo === "crear_tarea") {
    return (
      <div className="space-y-2 text-xs">
        <input className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" placeholder="Título (soporta {{op.nombre_caso}})" value={local.titulo || ""} onChange={(e) => setLocal({ ...local, titulo: e.target.value })} onBlur={commit} />
        <input className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" placeholder="Descripción" value={local.descripcion || ""} onChange={(e) => setLocal({ ...local, descripcion: e.target.value })} onBlur={commit} />
        <div className="flex gap-2">
          <input type="number" className="h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 w-24" placeholder="Días" value={local.due_dias || 0} onChange={(e) => setLocal({ ...local, due_dias: Number(e.target.value) })} onBlur={commit} />
          <select className="h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" value={local.prioridad || "normal"} onChange={(e) => { const v = { ...local, prioridad: e.target.value }; setLocal(v); onChange(v); }}>
            <option value="baja">baja</option><option value="normal">normal</option><option value="alta">alta</option><option value="urgente">urgente</option>
          </select>
        </div>
      </div>
    );
  }

  if (auto.tipo === "enviar_webhook") {
    return (
      <div className="space-y-2 text-xs">
        <input className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 font-mono" placeholder="https://..." value={local.url || ""} onChange={(e) => setLocal({ ...local, url: e.target.value })} onBlur={commit} />
        <select className="h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" value={local.method || "POST"} onChange={(e) => { const v = { ...local, method: e.target.value }; setLocal(v); onChange(v); }}>
          <option>POST</option><option>PUT</option><option>GET</option>
        </select>
        <textarea rows={3} className="w-full px-2 py-1 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 font-mono text-[10px]" placeholder='{"oportunidad_id":"{{op.id}}"}' value={JSON.stringify(local.payload || {}, null, 0)} onChange={(e) => { try { setLocal({ ...local, payload: JSON.parse(e.target.value) }); } catch { /* ignore */ } }} onBlur={commit} />
      </div>
    );
  }

  if (auto.tipo === "notificar") {
    return (
      <div className="space-y-2 text-xs">
        <select className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" value={local.user_id || ""} onChange={(e) => { const v = { ...local, user_id: e.target.value }; setLocal(v); onChange(v); }}>
          <option value="">Auto (preparador o vendedor)</option>
          {users.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
        </select>
        <input className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" placeholder="Título" value={local.titulo || ""} onChange={(e) => setLocal({ ...local, titulo: e.target.value })} onBlur={commit} />
        <input className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10" placeholder="Mensaje" value={local.mensaje || ""} onChange={(e) => setLocal({ ...local, mensaje: e.target.value })} onBlur={commit} />
      </div>
    );
  }

  if (auto.tipo === "asignar_preparador") {
    return (
      <select className="w-full h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs" value={local.user_id || ""} onChange={(e) => { const v = { ...local, user_id: e.target.value }; setLocal(v); onChange(v); }}>
        <option value="">— Seleccionar —</option>
        {users.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
      </select>
    );
  }

  return <div className="text-[11px] text-neutral-500">Configuración pendiente para este tipo (próxima fase).</div>;
}

export default function PipelineConfigPage() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [editing, setEditing] = useState<Partial<PipelineStage> | null>(null);
  const [autoStage, setAutoStage] = useState<PipelineStage | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = async () => {
    const r = await fetch("/api/pipeline/stages");
    const d = await r.json();
    setStages(d.stages || []);
  };
  useEffect(() => { load(); }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = stages.findIndex((s) => s.id === e.active.id);
    const newIdx = stages.findIndex((s) => s.id === e.over!.id);
    const reordered = arrayMove(stages, oldIdx, newIdx);
    setStages(reordered);
    const payload = reordered.map((s, i) => ({ id: s.id, orden: i + 1 }));
    await fetch("/api/pipeline/stages/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orden: payload }) });
    invalidateStagesCache();
    toast.success("Orden actualizado");
  };

  const handleDelete = async (s: PipelineStage) => {
    if (!confirm(`¿Eliminar la etapa "${s.label}"? Si tiene oportunidades se te pedirá destino.`)) return;
    let r = await fetch(`/api/pipeline/stages/${s.id}`, { method: "DELETE" });
    if (!r.ok) {
      const dest = prompt("Indica el KEY de la etapa destino para mover las oportunidades:");
      if (!dest) return;
      r = await fetch(`/api/pipeline/stages/${s.id}?destino_key=${encodeURIComponent(dest)}`, { method: "DELETE" });
    }
    if (r.ok) { toast.success("Etapa eliminada"); invalidateStagesCache(); load(); }
    else { const b = await r.json(); toast.error(b.error || "Error"); }
  };

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/configuracion" className="flex items-center gap-2 text-xs text-neutral-500 hover:text-brand-orange font-ui uppercase tracking-wider mb-4 transition">
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a configuración
        </Link>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="font-display text-4xl font-black leading-tight"><span className="text-gradient-orange">Pipeline</span> de oportunidades</h1>
            <p className="mt-2 text-neutral-500 text-sm">Arrastra para reordenar. Haz click en Automations para disparadores por etapa.</p>
          </div>
          <button onClick={() => setNewOpen(true)} className="h-11 px-4 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nueva etapa
          </button>
        </motion.div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {stages.map((s) => (
                <SortableRow key={s.id} stage={s} onEdit={() => setEditing(s)} onDelete={() => handleDelete(s)} onAutomations={() => setAutoStage(s)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <AnimatePresence>
        {editing && <StageEditorModal stage={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
        {newOpen && <StageEditorModal stage={{}} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); load(); }} />}
        {autoStage && <AutomationsDrawer stage={autoStage} onClose={() => setAutoStage(null)} />}
      </AnimatePresence>
    </AppShell>
  );
}
