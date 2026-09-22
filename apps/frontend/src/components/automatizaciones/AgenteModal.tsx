"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bot } from "@/lib/bootstrap-icons";
import { Button } from "@/components/ui/Button";
import { toast } from "sonner";
import type { AgenteIA } from "./types";

interface Props {
  agente: AgenteIA | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AgenteModal({ agente, onClose, onSaved }: Props) {
  const [nombre, setNombre] = useState(agente?.nombre || "");
  const [email, setEmail] = useState(agente?.email || "");
  const [webhookUrl, setWebhookUrl] = useState(agente?.n8n_webhook_url || "");
  const [activo, setActivo] = useState(agente?.activo ?? true);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (nombre.trim().length < 2) { toast.error("Ponle un nombre al agente"); return; }
    if (!agente && !/^\S+@\S+\.\S+$/.test(email)) { toast.error("Correo inválido"); return; }
    setGuardando(true);
    try {
      const url = agente ? `/api/automatizaciones/agentes/${agente.id}` : "/api/automatizaciones/agentes";
      const body = agente
        ? { nombre, n8nWebhookUrl: webhookUrl.trim() || null, activo }
        : { nombre, email, n8nWebhookUrl: webhookUrl.trim() || null };
      const r = await fetch(url, {
        method: agente ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      toast.success(agente ? "Agente actualizado" : "Agente creado");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setGuardando(false);
    }
  };

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
              <Bot className="h-5 w-5" weight="duotone" />
            </div>
            <h2 className="font-display text-xl font-black flex-1">{agente ? "Editar agente" : "Nuevo agente de IA"}</h2>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Nombre</label>
              <input
                value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Asistente de ventas"
                className="w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-primary/30"
              />
            </div>
            {!agente && (
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Correo (identificador, no inicia sesión)</label>
                <input
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agente-ventas@tuagencia.com" type="email"
                  className="w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-primary/30"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Webhook de n8n (opcional)</label>
              <input
                value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://tu-n8n.com/webhook/..."
                className="w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-primary/30"
              />
              <p className="text-[11px] text-neutral-400 mt-1.5">Sin webhook, el agente se puede asignar igual — solo no recibirá aviso automático de n8n.</p>
            </div>
            {agente && (
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4 accent-brand-primary" />
                <span className="text-sm">Agente activo</span>
              </label>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button onClick={guardar} disabled={guardando} className="flex-1">{guardando ? "Guardando…" : "Guardar"}</Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
