"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Sparkles, Plus, Edit3, Trash2, Save, X, Users as UsersIcon, Loader2, ArrowLeft, AlertTriangle } from "@/lib/bootstrap-icons";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth-user";

interface Depto {
  id: string;
  nombre: string;
  color: string;
  jefe_id: string | null;
  jefe_nombre: string | null;
  jefe_foto: string | null;
  empleados_count: number;
  created_at: string;
}

const PRESET_COLORS = ["#5750E8", "#FFB51C", "#43A847", "#06FFA5", "#2196C9", "#3A86FF", "#8338EC", "#FF006E", "#E53935", "#5C6670"];

export default function DepartamentosConfigPage() {
  const { isAdmin } = useCurrentUser();
  const [deptos, setDeptos] = useState<Depto[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ nombre: string; color: string; jefe_id: string }>({ nombre: "", color: "#5750E8", jefe_id: "" });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/departamentos").then((r) => r.json()),
        fetch("/api/chat/contactos").then((r) => r.json())
      ]);
      setDeptos(r1.departamentos || []);
      setUsuarios(r2.contactos || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (d: Depto) => {
    setEditing(d.id);
    setForm({ nombre: d.nombre, color: d.color || "#5750E8", jefe_id: d.jefe_id || "" });
  };

  const save = async (id: string | null) => {
    if (!form.nombre.trim()) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    try {
      const payload = { nombre: form.nombre.trim(), color: form.color, jefe_id: form.jefe_id || null };
      const url = id ? `/api/departamentos/${id}` : "/api/departamentos";
      const method = id ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      toast.success(id ? "Departamento actualizado" : "Departamento creado");
      setEditing(null); setCreating(false);
      setForm({ nombre: "", color: "#5750E8", jefe_id: "" });
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const del = async (d: Depto) => {
    if (!confirm(`¿Eliminar "${d.nombre}"?`)) return;
    const r = await fetch(`/api/departamentos/${d.id}`, { method: "DELETE" });
    if (!r.ok) { const e = await r.json(); toast.error(e.error || "Error"); return; }
    toast.success("Eliminado");
    load();
  };

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/configuracion" className="flex items-center gap-2 text-xs text-neutral-500 hover:text-brand-orange font-ui uppercase tracking-wider mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a configuración
        </Link>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.12em] mb-3">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              Estructura
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-black leading-tight tracking-tight">
              <span className="text-gradient-orange">Departamentos</span>
            </h1>
            <p className="mt-3 text-neutral-500 text-[15px]">{deptos.length} departamentos · {usuarios.length} colaboradores</p>
          </div>
          {isAdmin && !creating && !editing && (
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setCreating(true); setForm({ nombre: "", color: "#5750E8", jefe_id: "" }); }}
              className="h-11 px-5 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow flex items-center gap-2">
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Nuevo departamento
            </motion.button>
          )}
        </motion.div>

        {!isAdmin && (
          <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-5 text-[12px] text-neutral-500 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-brand-gold" strokeWidth={2} />
            Solo admin puede crear, editar o eliminar departamentos. Tú tienes acceso de sólo lectura.
          </div>
        )}

        {loading ? (
          <div className="text-center py-20"><Loader2 className="h-6 w-6 animate-spin inline text-neutral-400" /></div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {creating && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <DeptoForm form={form} setForm={setForm} usuarios={usuarios} onSave={() => save(null)} onCancel={() => setCreating(false)} saving={saving} />
                </motion.div>
              )}
            </AnimatePresence>

            {deptos.map((d, i) => editing === d.id ? (
              <DeptoForm key={d.id} form={form} setForm={setForm} usuarios={usuarios} onSave={() => save(d.id)} onCancel={() => setEditing(null)} saving={saving} />
            ) : (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(0.03 * i, 0.2) }}
                className="bg-white rounded-2xl border border-neutral-100 overflow-hidden"
              >
                <div className="h-1" style={{ backgroundColor: d.color }} />
                <div className="p-4 flex items-center gap-4">
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: d.color }}>
                    <Building2 className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-base">{d.nombre}</div>
                    <div className="text-[11px] text-neutral-500 flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1"><UsersIcon className="h-3 w-3" strokeWidth={2} /> {d.empleados_count} empleado{d.empleados_count !== 1 ? "s" : ""}</span>
                      {d.jefe_nombre && (
                        <span className="flex items-center gap-1.5">
                          {d.jefe_foto
                            ? <img src={d.jefe_foto} className="h-4 w-4 rounded-full object-cover" alt="" />
                            : <span className="h-4 w-4 rounded-full bg-neutral-200" />}
                          Jefe: <strong className="text-neutral-700">{d.jefe_nombre}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <>
                      <button onClick={() => startEdit(d)} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-400 hover:text-brand-orange">
                        <Edit3 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <button onClick={() => del(d)} className="h-9 w-9 rounded-xl hover:bg-red-50 flex items-center justify-center text-neutral-400 hover:text-brand-red">
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function DeptoForm({ form, setForm, usuarios, onSave, onCancel, saving }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-2xl border-2 border-brand-orange/30 ring-4 ring-brand-orange/10 overflow-hidden">
      <div className="h-1" style={{ backgroundColor: form.color }} />
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Nombre *</label>
            <input autoFocus value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="w-full h-11 px-4 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange" />
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Jefe</label>
            <select value={form.jefe_id} onChange={(e) => setForm({ ...form, jefe_id: e.target.value })}
              className="w-full h-11 px-4 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange">
              <option value="">(sin jefe)</option>
              {usuarios.map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Color</label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setForm({ ...form, color: c })}
                className={cn("h-8 w-8 rounded-lg transition-all", form.color === c ? "ring-2 ring-offset-2 ring-brand-orange scale-110" : "hover:scale-105")}
                style={{ backgroundColor: c }} />
            ))}
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="h-8 w-14 rounded-lg cursor-pointer border border-neutral-200" />
          </div>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onCancel} className="h-10 px-4 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-700 hover:bg-neutral-50">Cancelar</button>
          <button onClick={onSave} disabled={saving} className="h-10 px-5 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 flex items-center gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Guardar
          </button>
        </div>
      </div>
    </motion.div>
  );
}
