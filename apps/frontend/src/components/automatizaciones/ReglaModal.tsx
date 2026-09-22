"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lightning } from "@/lib/bootstrap-icons";
import { Button } from "@/components/ui/Button";
import { toast } from "sonner";
import type { AgenteIA, AutomatizacionRegla } from "./types";
import type { WhatsAppPipelineStage, WhatsAppTag } from "@/components/whatsapp/types";

interface Props {
  regla: AutomatizacionRegla | null;
  etapas: WhatsAppPipelineStage[];
  tags: WhatsAppTag[];
  agentes: AgenteIA[];
  onClose: () => void;
  onSaved: () => void;
}

export function ReglaModal({ regla, etapas, tags, agentes, onClose, onSaved }: Props) {
  const [nombre, setNombre] = useState(regla?.nombre || "");
  const [etapaId, setEtapaId] = useState(regla?.etapa_id || "");
  const [tagId, setTagId] = useState(regla?.tag_id || "");
  const [agenteId, setAgenteId] = useState(regla?.agente_id || agentes[0]?.id || "");
  const [asignar, setAsignar] = useState(regla?.asignar_conversacion ?? true);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (nombre.trim().length < 2) { toast.error("Ponle un nombre a la regla"); return; }
    if (!etapaId && !tagId) { toast.error("Elige al menos una condición: etapa o etiqueta"); return; }
    if (!agenteId) { toast.error("Elige el agente de IA"); return; }
    setGuardando(true);
    try {
      const url = regla ? `/api/automatizaciones/reglas/${regla.id}` : "/api/automatizaciones/reglas";
      const r = await fetch(url, {
        method: regla ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, etapaId: etapaId || null, tagId: tagId || null, agenteId, asignarConversacion: asignar }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      toast.success(regla ? "Regla actualizada" : "Regla creada");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setGuardando(false);
    }
  };

  const selectCls = "w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-primary/30";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl glass-panel p-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-xl gradient-orange text-white flex items-center justify-center shrink-0">
              <Lightning className="h-5 w-5" weight="duotone" />
            </div>
            <h2 className="font-display text-xl font-black flex-1">{regla ? "Editar regla" : "Nueva regla"}</h2>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {agentes.length === 0 ? (
            <p className="text-sm text-neutral-500">Primero crea un agente de IA — una regla siempre necesita uno para avisarle.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Nombre</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Leads calientes con etiqueta VIP" className={selectCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Etapa (opcional)</label>
                  <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} className={selectCls}>
                    <option value="">Cualquier etapa</option>
                    {etapas.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Etiqueta (opcional)</label>
                  <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={selectCls}>
                    <option value="">Cualquier etiqueta</option>
                    {tags.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Agente de IA a avisar</label>
                <select value={agenteId} onChange={(e) => setAgenteId(e.target.value)} className={selectCls}>
                  {agentes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={asignar} onChange={(e) => setAsignar(e.target.checked)} className="h-4 w-4 accent-brand-primary" />
                <span className="text-sm">Asignar la conversación al agente automáticamente</span>
              </label>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || agentes.length === 0} className="flex-1">{guardando ? "Guardando…" : "Guardar"}</Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
