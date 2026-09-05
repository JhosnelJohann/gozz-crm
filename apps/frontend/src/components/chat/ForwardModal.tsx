"use client";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Forward, Loader2, Check } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { initialsOf } from "@/lib/auth-user";
import type { ChatMensaje } from "./ChatMessages";

interface Props {
  open: boolean;
  messages: ChatMensaje[] | null;
  grupos: any[];
  currentId: string | null;
  onClose: () => void;
}

export function ForwardModal({ open, messages, grupos, currentId, onClose }: Props) {
  const [q, setQ] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => { if (open) { setDone([]); setQ(""); } }, [open]);

  const lista = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (grupos || []).filter((g) => g.id !== currentId && (!term || (g.nombre || "").toLowerCase().includes(term)));
  }, [grupos, q, currentId]);

  const msgs = messages || [];

  const forward = async (g: any) => {
    if (msgs.length === 0 || sending) return;
    setSending(g.id);
    try {
      for (const m of msgs) {
        const r = await fetch(`/api/chat/grupos/${g.id}/mensajes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contenido: m.contenido || null,
            tipo: m.tipo || "texto",
            archivo_url: m.archivo_url || null,
            archivo_nombre: m.archivo_nombre || null,
            archivo_tipo: m.archivo_tipo || null,
            reenviado_de: (m as any).reenviado_de || m.user_nombre || "Alguien",
          }),
        });
        if (!r.ok) throw new Error("No se pudo reenviar");
      }
      setDone((d) => [...d, g.id]);
      toast.success(`Reenviado a ${g.nombre || "chat"}`);
    } catch (e: any) { toast.error(e.message || "Error"); }
    finally { setSending(null); }
  };

  const preview = msgs.length > 1 ? `${msgs.length} mensajes seleccionados` : (msgs[0]?.contenido || msgs[0]?.archivo_nombre || "Mensaje");

  return (
    <AnimatePresence>
      {open && msgs.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-neutral-200 dark:border-white/10 overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="px-5 py-4 border-b border-neutral-100 dark:border-white/10 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
                <Forward className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm">Reenviar {msgs.length > 1 ? "mensajes" : "mensaje"}</div>
                <div className="text-[12px] text-neutral-500 truncate">{preview}</div>
              </div>
              <button onClick={onClose} className="h-8 w-8 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 flex items-center justify-center">
                <X className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
              </button>
            </div>

            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar chat…"
                  className="w-full h-10 pl-9 pr-3 rounded-xl bg-neutral-50 dark:bg-white/5 border border-transparent text-sm outline-none focus:bg-white dark:focus:bg-white/10 focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5" style={{ overscrollBehavior: "contain" }}>
              {lista.length === 0 ? (
                <div className="text-center text-neutral-400 text-sm py-8">Sin chats</div>
              ) : lista.map((g) => {
                const ya = done.includes(g.id);
                const isDM = g.tipo === "directo";
                const fotoUrl = isDM ? g.otro_usuario?.foto_perfil_url : g.avatar_url;
                return (
                  <button key={g.id} type="button" disabled={!!sending || ya} onClick={() => forward(g)}
                    className="w-full px-3 py-2 rounded-xl flex items-center gap-3 text-left hover:bg-neutral-100 dark:hover:bg-white/5 transition disabled:opacity-60">
                    <div className="h-9 w-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {fotoUrl ? <img src={fotoUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(g.nombre || "?")}
                    </div>
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{g.nombre || "Chat"}</span>
                    {sending === g.id ? <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />
                      : ya ? <Check className="h-4 w-4 text-brand-green" strokeWidth={2.5} />
                      : <Forward className="h-4 w-4 text-neutral-300" strokeWidth={2} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
