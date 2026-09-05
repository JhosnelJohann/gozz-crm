"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, CheckSquare, Square, Loader2, ArrowUpRight, Trash2, Check, X, Calendar } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DateField } from "@/components/ui/DateField";

interface UserLite { id: string; nombre: string; foto_perfil_url: string | null; }

interface Subtarea {
  id: string;
  numero_tarea: number;
  titulo: string;
  estado: string;
  prioridad: string;
  responsable_nombre: string | null;
  fecha_limite: string | null;
}

interface Props {
  tareaId: string;
  onOpenTask: (id: string) => void;
  padre?: { id: string; titulo: string; numero_tarea: number } | null;
  usuarios?: UserLite[];
  oportunidadId?: string | null;
  contactoId?: string | null;
  defaultResponsableId?: string | null;
  onChanged?: () => void;
}

const PRIOS = [
  { v: "baja", label: "Baja" },
  { v: "normal", label: "Normal" },
  { v: "alta", label: "Alta" },
  { v: "urgente", label: "Urgente" },
];

function fmtFecha(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es", { day: "2-digit", month: "short" }) + ", " + d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function TaskSubtasks({ tareaId, onOpenTask, padre, usuarios = [], oportunidadId, contactoId, defaultResponsableId, onChanged }: Props) {
  const [items, setItems] = useState<Subtarea[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // formulario de nueva subtarea
  const [newTitle, setNewTitle] = useState("");
  const [newResp, setNewResp] = useState<string>(defaultResponsableId || "");
  const [newPrio, setNewPrio] = useState("normal");
  const [newFecha, setNewFecha] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tareas/${tareaId}`);
      const d = await r.json();
      setItems(d.subtareas || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [tareaId]);

  const openAdd = () => {
    setNewTitle(""); setNewResp(defaultResponsableId || ""); setNewPrio("normal"); setNewFecha("");
    setAdding(true);
  };

  const create = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: newTitle.trim(),
          subtarea_de: tareaId,
          responsable_id: newResp || null,
          prioridad: newPrio,
          fecha_limite: newFecha ? new Date(newFecha).toISOString() : null,
          oportunidad_id: oportunidadId || null,
          // 🔴 El cliente SOLO se manda cuando no hay oportunidad. Con oportunidad lo deriva el
          // servidor de ella, que es la misma regla que aplica el modal. Antes se heredaban los
          // dos del padre, y si el padre traía un par incoherente —los hubo, porque nada lo
          // impedía— la subtarea se quedaría sin poder crearse. Un dato viejo no puede convertir
          // un formulario en uno que no se deja guardar.
          contacto_id: oportunidadId ? null : (contactoId || null),
        })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(typeof d?.error === "string" ? d.error : "Error creando subtarea");
      }
      toast.success("Subtarea creada");
      setAdding(false);
      setNewTitle("");
      await load();
      onChanged?.();
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  };

  const toggleDone = async (s: Subtarea) => {
    const newState = s.estado === "completada" ? "pendiente" : "completada";
    setItems((prev) => prev.map((x) => x.id === s.id ? { ...x, estado: newState } : x)); // optimista
    setBusyId(s.id);
    try {
      const r = await fetch(`/api/tareas/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: newState })
      });
      if (!r.ok) throw new Error();
      onChanged?.();
    } catch {
      await load(); // revertir si falla
    } finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/tareas/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("No se pudo eliminar");
      setItems((prev) => prev.filter((x) => x.id !== id));
      setConfirmId(null);
      toast.success("Subtarea eliminada");
      onChanged?.();
    } catch (e: any) { toast.error(e.message); } finally { setBusyId(null); }
  };

  const total = items.length;
  const completadas = items.filter((s) => s.estado === "completada").length;
  const pct = total > 0 ? Math.round((completadas / total) * 100) : 0;

  return (
    <div>
      {padre && (
        <button
          onClick={() => onOpenTask(padre.id)}
          className="mb-2 text-[11px] text-neutral-500 hover:text-brand-orange inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          Tarea principal: <span className="font-semibold">#{padre.numero_tarea} {padre.titulo}</span>
        </button>
      )}

      {/* Progreso */}
      {total > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full rounded-full bg-brand-green transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] font-ui font-bold text-neutral-500 tabular-nums shrink-0">{completadas}/{total}</span>
        </div>
      )}

      {loading ? (
        <div className="py-3 text-center text-neutral-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {items.map((s) => {
              const isDone = s.estado === "completada";
              const vencida = s.fecha_limite && !isDone && new Date(s.fecha_limite) < new Date();
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                  className="bg-white rounded-xl border border-neutral-100 px-3 py-2 flex items-center gap-2.5 group"
                >
                  <button onClick={() => toggleDone(s)} disabled={busyId === s.id} className="shrink-0">
                    {isDone ? <CheckSquare className="h-4 w-4 text-brand-green" strokeWidth={2} /> : <Square className="h-4 w-4 text-neutral-300 group-hover:text-brand-orange" strokeWidth={1.8} />}
                  </button>
                  <button
                    onClick={() => onOpenTask(s.id)}
                    className={cn("flex-1 min-w-0 text-left text-sm font-medium truncate", isDone && "line-through text-neutral-400")}
                  >
                    <span className="text-[10px] text-neutral-400 font-ui mr-1.5">#{s.numero_tarea}</span>
                    {s.titulo}
                  </button>
                  {s.fecha_limite && (
                    <span className={cn("text-[10px] shrink-0 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5", vencida ? "bg-brand-red/10 text-brand-red" : "bg-neutral-100 text-neutral-500")}>
                      <Calendar className="h-2.5 w-2.5" strokeWidth={2} />{fmtFecha(s.fecha_limite)}
                    </span>
                  )}
                  {s.responsable_nombre && (
                    <span className="text-[10px] text-neutral-500 shrink-0 max-w-[90px] truncate">{s.responsable_nombre}</span>
                  )}
                  {confirmId === s.id ? (
                    <span className="flex items-center gap-1 shrink-0">
                      <button onClick={() => remove(s.id)} disabled={busyId === s.id} title="Confirmar eliminar" className="h-6 w-6 rounded-lg bg-brand-red text-white flex items-center justify-center">
                        {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" strokeWidth={2.5} />}
                      </button>
                      <button onClick={() => setConfirmId(null)} title="Cancelar" className="h-6 w-6 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center">
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmId(s.id)} title="Eliminar subtarea" className="shrink-0 h-6 w-6 rounded-lg text-neutral-300 hover:text-brand-red hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {adding ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className="mt-2 p-3 rounded-xl border border-brand-orange/40 bg-brand-orange/[0.03] space-y-2 overflow-hidden"
        >
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setAdding(false); }}
            placeholder="Título de la subtarea..."
            className="w-full h-10 px-3 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-2 focus:ring-brand-orange/25 focus:border-brand-orange"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={newResp} onChange={(e) => setNewResp(e.target.value)}
              className="h-10 px-2 rounded-xl bg-white border border-neutral-200 text-[13px] outline-none focus:border-brand-orange">
              <option value="">Asignar a… (yo)</option>
              {usuarios.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
            </select>
            <select value={newPrio} onChange={(e) => setNewPrio(e.target.value)}
              className="h-10 px-2 rounded-xl bg-white border border-neutral-200 text-[13px] outline-none focus:border-brand-orange">
              {PRIOS.map((p) => (<option key={p.v} value={p.v}>{p.label}</option>))}
            </select>
          </div>
          <DateField value={newFecha} onChange={setNewFecha} placeholder="Fecha límite (opcional)" withTime minDate={new Date()} />
          <div className="flex items-center gap-2 pt-1">
            <button onClick={create} disabled={creating || !newTitle.trim()}
              className="h-9 px-4 rounded-xl bg-brand-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider disabled:opacity-50 inline-flex items-center gap-1.5">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}
              Crear subtarea
            </button>
            <button onClick={() => setAdding(false)} className="h-9 px-4 rounded-xl bg-white border border-neutral-200 text-[11px] font-ui font-bold uppercase text-neutral-500 hover:bg-neutral-50">
              Cancelar
            </button>
          </div>
        </motion.div>
      ) : (
        <button
          onClick={openAdd}
          className="mt-2 h-9 px-3 rounded-xl bg-white border border-dashed border-neutral-300 hover:border-brand-orange hover:text-brand-orange text-neutral-500 text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 w-full justify-center transition-colors"
        >
          <Plus className="h-3 w-3" strokeWidth={2.5} /> Añadir subtarea
        </button>
      )}
    </div>
  );
}
