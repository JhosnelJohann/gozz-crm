"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, KeyRound, X, Sparkles, Copy, Check, Trash2, AlertTriangle } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";

interface ApiKey {
  id: string;
  nombre: string;
  key_prefix: string;
  activo: boolean;
  ultimo_uso: string | null;
  total_requests: number;
  created_at: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [modal, setModal] = useState(false);
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const r = await fetch("/api/admin/api-keys");
    const d = await r.json();
    setKeys(d.keys || []);
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    if (!nombre) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      setRevealedKey(d.plaintext);
      setNombre("");
      setModal(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm("¿Eliminar esta API key? Esta acción no se puede deshacer.")) return;
    try {
      await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
      toast.success("API key eliminada");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const copy = () => {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    toast.success("Copiada al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              Integraciones
            </div>
            <h1 className="font-display text-4xl font-black leading-tight">
              <span className="text-gradient-orange">API Keys</span>
            </h1>
            <p className="mt-2 text-neutral-500">{keys ? `${keys.length} keys activas` : "Cargando…"}</p>
          </div>
          <button onClick={() => setModal(true)} className="gradient-orange flex items-center gap-2 h-11 px-5 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow hover:scale-[1.02] transition">
            <Plus className="h-4 w-4" strokeWidth={2} />
            Generar API Key
          </button>
        </motion.div>

        <div className="space-y-2">
          {keys === null ? (
            Array.from({ length: 2 }).map((_, i) => <div key={i} className="glass rounded-2xl h-20 skeleton" />)
          ) : keys.length === 0 ? (
            <div className="glass rounded-3xl p-12 text-center">
              <KeyRound className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} />
              <h3 className="font-display text-xl font-black mb-1">Sin API keys</h3>
              <p className="text-neutral-500 text-sm">Genera la primera para integrar servicios externos</p>
            </div>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="glass rounded-2xl px-5 py-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-brand-orange/10 flex items-center justify-center shrink-0">
                  <KeyRound className="h-5 w-5 text-brand-orange" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-black text-base">{k.nombre}</div>
                  <div className="font-mono text-xs text-neutral-500 mt-0.5">{k.key_prefix}••••••••••••••••••••••</div>
                </div>
                <div className="text-right text-[11px] text-neutral-500 shrink-0">
                  <div>{k.total_requests} req</div>
                  <div>{new Date(k.created_at).toLocaleDateString("es")}</div>
                </div>
                <button onClick={() => deleteKey(k.id)} className="h-9 w-9 rounded-xl text-neutral-400 hover:text-brand-red hover:bg-red-50 flex items-center justify-center transition">
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(false)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="glass rounded-3xl p-8 max-w-md w-full"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-2xl font-black">Generar API Key</h2>
                <button onClick={() => setModal(false)} className="h-9 w-9 rounded-xl hover:bg-black/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
              </div>
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Nombre descriptivo</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Integración n8n" className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30" />
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setModal(false)} className="flex-1 h-11 rounded-xl bg-white border border-black/10 font-ui text-xs font-bold uppercase tracking-wider hover:bg-black/5">Cancelar</button>
                <button onClick={generate} disabled={saving} className="flex-1 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60">
                  {saving ? "Generando…" : "Generar"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal modal */}
      <AnimatePresence>
        {revealedKey && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="glass rounded-3xl p-8 max-w-lg w-full"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="h-12 w-12 rounded-xl bg-brand-green/10 flex items-center justify-center">
                  <KeyRound className="h-6 w-6 text-brand-green" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-black">Tu nueva API Key</h2>
                  <p className="text-xs text-neutral-500">Guárdala ahora, no la verás de nuevo</p>
                </div>
              </div>
              <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-3 flex gap-2 mb-4">
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div className="text-xs text-yellow-800">
                  Esta key se muestra una sola vez por seguridad. Cópiala y guárdala en un lugar seguro.
                </div>
              </div>
              <div className="relative">
                <pre className="font-mono text-xs bg-neutral-900 text-green-300 rounded-xl p-4 overflow-x-auto break-all whitespace-pre-wrap">{revealedKey}</pre>
                <button onClick={copy} className="absolute top-2 right-2 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 text-[11px] font-ui uppercase tracking-wider">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copiada" : "Copiar"}
                </button>
              </div>
              <button onClick={() => setRevealedKey(null)} className="w-full mt-6 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow">
                He guardado la key
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
