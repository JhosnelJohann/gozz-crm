"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, DollarSign, Clock, Sparkles, Plus, Trash, Pencil, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";

interface Tramite {
  id: string;
  nombre: string;
  codigo: string;
  formulario_uscis: string | null;
  descripcion?: string | null;
  valor_base: string;
  sla_dias: number;
  puntaje_preparador: string;
  puntaje_vendedor: string;
  puntaje_manager_ventas: string;
  puntaje_manager_preparacion: string;
  puntaje_manager_general: string;
  color: string | null;
  es_tramite_administrativo?: boolean;
  activo?: boolean;
}

const DEFAULT_FORM = {
  id: "",
  nombre: "",
  codigo: "",
  formulario_uscis: "",
  descripcion: "",
  valor_base: "0",
  sla_dias: "30",
  color: "#5750E8",
  puntaje_vendedor: "0",
  puntaje_preparador: "0",
  puntaje_manager_ventas: "0",
  puntaje_manager_preparacion: "0",
  puntaje_manager_general: "0",
  es_tramite_administrativo: false,
};

export default function TramitesPage() {
  const [tramites, setTramites] = useState<Tramite[] | null>(null);
  const [modal, setModal] = useState<typeof DEFAULT_FORM | null>(null);
  const [paleta, setPaleta] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [colorWarn, setColorWarn] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);

  const load = async () => {
    const r = await fetch("/api/tramites");
    const d = await r.json();
    setTramites(d.tramites || []);
  };

  useEffect(() => {
    load();
    fetch("/api/tramites/color-disponible").then((r) => r.json()).then((d) => setPaleta(d.paleta || []));
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {});
  }, []);

  const openNew = async () => {
    const r = await fetch("/api/tramites/color-disponible");
    const d = await r.json();
    setModal({ ...DEFAULT_FORM, color: d.sugerido || "#5750E8" });
    setColorWarn(null);
  };

  const openEdit = (t: Tramite) => {
    setModal({
      id: t.id,
      nombre: t.nombre,
      codigo: t.codigo,
      formulario_uscis: t.formulario_uscis || "",
      descripcion: t.descripcion || "",
      valor_base: String(t.valor_base),
      sla_dias: String(t.sla_dias),
      color: t.color || "#5C6670",
      puntaje_vendedor: String(t.puntaje_vendedor ?? 0),
      puntaje_preparador: String(t.puntaje_preparador ?? 0),
      puntaje_manager_ventas: String((t as any).puntaje_manager_ventas ?? 0),
      puntaje_manager_preparacion: String((t as any).puntaje_manager_preparacion ?? 0),
      puntaje_manager_general: String((t as any).puntaje_manager_general ?? 0),
      es_tramite_administrativo: !!t.es_tramite_administrativo,
    });
    setColorWarn(null);
  };

  const checkColor = async (hex: string) => {
    if (!hex || !modal) return;
    const r = await fetch(`/api/tramites/color-disponible?color=${encodeURIComponent(hex)}`);
    const d = await r.json();
    if (d.disponible === false) {
      setColorWarn(`Color usado por "${d.tomado_por?.nombre}". Sugerido: ${d.sugerido}`);
    } else {
      setColorWarn(null);
    }
  };

  const save = async () => {
    if (!modal) return;
    if (!modal.nombre || !modal.codigo) { toast.error("Nombre y código requeridos"); return; }
    setSaving(true);
    try {
      const body = {
        nombre: modal.nombre,
        codigo: modal.codigo,
        formulario_uscis: modal.formulario_uscis || null,
        descripcion: modal.descripcion || null,
        valor_base: Number(modal.valor_base) || 0,
        sla_dias: Number(modal.sla_dias) || 30,
        color: modal.color,
        es_tramite_administrativo: modal.es_tramite_administrativo,
        puntaje_vendedor: Number(modal.puntaje_vendedor) || 0,
        puntaje_preparador: Number(modal.puntaje_preparador) || 0,
        puntaje_manager_ventas: Number(modal.puntaje_manager_general) || 0,
        puntaje_manager_preparacion: Number(modal.puntaje_manager_general) || 0,
        puntaje_manager_general: Number(modal.puntaje_manager_general) || 0,
      };
      const r = modal.id
        ? await fetch(`/api/tramites/${modal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/tramites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const e = await r.json();
        if (e.tomado_por) {
          toast.error(`Color en uso por "${e.tomado_por.nombre}". Usa el sugerido ${e.sugerido}.`);
          setModal({ ...modal, color: e.sugerido });
        } else {
          toast.error(typeof e.error === "string" ? e.error : "Error al guardar");
        }
        return;
      }
      toast.success(modal.id ? "Trámite actualizado" : "Trámite creado");
      setModal(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  const remove = async (t: Tramite) => {
    if (!confirm(`Desactivar el trámite "${t.nombre}"?`)) return;
    const r = await fetch(`/api/tramites/${t.id}`, { method: "DELETE" });
    if (r.ok) { toast.success("Desactivado"); load(); }
    else toast.error("Error");
  };

  const isAdmin = me?.nivel_acceso === "super_admin" || me?.nivel_acceso === "admin";

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              Catálogo
            </div>
            <h1 className="font-display text-4xl font-black leading-tight">
              Trámites <span className="text-gradient-orange">USCIS</span>
            </h1>
            <p className="mt-2 text-neutral-500">Catálogo maestro con colores únicos para el pipeline</p>
          </div>
          {isAdmin && (
            <button onClick={openNew} className="h-11 px-4 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nuevo trámite
            </button>
          )}
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tramites === null
            ? Array.from({ length: 6 }).map((_, i) => (<div key={i} className="glass rounded-2xl p-6 h-40 skeleton" />))
            : tramites.map((t, i) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i }}
                  className="glass rounded-2xl overflow-hidden hover:shadow-glow-lg hover:-translate-y-1 transition-all group"
                >
                  <div className="h-1.5" style={{ background: t.color || "#5C6670" }} />
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: (t.color || "#5C6670") + "18" }}>
                        <FileText className="h-5 w-5" strokeWidth={1.5} style={{ color: t.color || "#5C6670" }} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-ui font-bold uppercase tracking-wider px-2 py-1 rounded-md text-white" style={{ background: t.color || "#5C6670" }}>
                          {t.formulario_uscis || t.codigo}
                        </span>
                      </div>
                    </div>
                    <h3 className="font-display font-black text-lg leading-tight mb-1">{t.nombre}</h3>
                    <div className="font-ui text-[10px] uppercase tracking-wider text-neutral-400 mb-4">{t.codigo}</div>
                    <div className="flex items-center gap-4 pt-3 border-t border-black/5">
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 text-brand-green" strokeWidth={1.5} />
                        <span className="font-ui font-bold text-sm tabular-nums">{Number(t.valor_base).toFixed(0)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-brand-neutral" strokeWidth={1.5} />
                        <span className="font-ui text-xs text-neutral-500">{t.sla_dias}d SLA</span>
                      </div>
                      {isAdmin && (
                        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={() => openEdit(t)} className="h-7 w-7 rounded-lg hover:bg-black/5 flex items-center justify-center"><Pencil className="h-3.5 w-3.5 text-neutral-500" /></button>
                          <button onClick={() => remove(t)} className="h-7 w-7 rounded-lg hover:bg-red-50 text-brand-red flex items-center justify-center"><Trash className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
        </div>
      </div>

      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setModal(null)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} onClick={(e) => e.stopPropagation()} className="rounded-3xl p-8 max-w-lg w-full modal-surface">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-2xl font-black">{modal.id ? "Editar trámite" : "Nuevo trámite"}</h2>
                <button onClick={() => setModal(null)} className="h-9 w-9 rounded-xl hover:bg-black/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Código</label>
                    <input value={modal.codigo} onChange={(e) => setModal({ ...modal, codigo: e.target.value.toUpperCase() })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Formulario USCIS</label>
                    <input value={modal.formulario_uscis} onChange={(e) => setModal({ ...modal, formulario_uscis: e.target.value })} placeholder="I-130" className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Nombre</label>
                  <input value={modal.nombre} onChange={(e) => setModal({ ...modal, nombre: e.target.value })} placeholder="Petición Familiar" className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Descripción</label>
                  <input value={modal.descripcion} onChange={(e) => setModal({ ...modal, descripcion: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Valor base (USD)</label>
                    <input type="number" value={modal.valor_base} onChange={(e) => setModal({ ...modal, valor_base: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">SLA (días)</label>
                    <input type="number" value={modal.sla_dias} onChange={(e) => setModal({ ...modal, sla_dias: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-2">Color del trámite</label>
                  <div className="flex items-center gap-2 mb-2">
                    <input type="color" value={modal.color} onChange={(e) => { const c = e.target.value.toUpperCase(); setModal({ ...modal, color: c }); checkColor(c); }} className="h-10 w-14 rounded-xl border border-black/10 cursor-pointer" />
                    <input value={modal.color} onChange={(e) => { const c = e.target.value.toUpperCase(); setModal({ ...modal, color: c }); checkColor(c); }} className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm font-mono" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {paleta.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { setModal({ ...modal, color: c }); checkColor(c); }}
                        className={`h-7 w-7 rounded-lg border-2 transition ${modal.color.toUpperCase() === c.toUpperCase() ? "border-brand-orange scale-110 shadow-glow" : "border-white"}`}
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                  {colorWarn && <div className="mt-2 text-[11px] text-brand-red">{colorWarn}</div>}
                </div>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={modal.es_tramite_administrativo} onChange={(e) => setModal({ ...modal, es_tramite_administrativo: e.target.checked })} /> Trámite administrativo (no USCIS)</label>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-2">Puntaje por cargo (puntos al completar)</label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div><label className="text-[10px] font-ui uppercase tracking-wider text-neutral-400 block mb-1">Vendedor</label><input type="number" step="0.01" value={modal.puntaje_vendedor} onChange={(e) => setModal({ ...modal, puntaje_vendedor: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" /></div>
                    <div><label className="text-[10px] font-ui uppercase tracking-wider text-neutral-400 block mb-1">Preparador</label><input type="number" step="0.01" value={modal.puntaje_preparador} onChange={(e) => setModal({ ...modal, puntaje_preparador: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" /></div>
                    <div><label className="text-[10px] font-ui uppercase tracking-wider text-neutral-400 block mb-1">Manager</label><input type="number" step="0.01" value={modal.puntaje_manager_general} onChange={(e) => setModal({ ...modal, puntaje_manager_general: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm" /></div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setModal(null)} className="flex-1 h-11 rounded-xl border border-black/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5">Cancelar</button>
                <button onClick={save} disabled={saving} className="flex-1 h-11 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
