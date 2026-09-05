"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, MessageSquareMore, Megaphone, Loader2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";
import { getSocket } from "@/lib/socket";
import { ChatMessages, type ChatMensaje } from "@/components/chat/ChatMessages";
import { ChatComposer } from "@/components/chat/ChatComposer";

interface Props {
  tareaId: string;
  tareaTitulo?: string;
  open: boolean;
  onClose: () => void;
}

export function TaskChat({ tareaId, tareaTitulo, open, onClose }: Props) {
  const { user } = useCurrentUser();
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<ChatMensaje[]>([]);
  const [loading, setLoading] = useState(false);
  const [superNotifyOpen, setSuperNotifyOpen] = useState(false);
  const [superMsg, setSuperMsg] = useState("");
  const [sendingSuper, setSendingSuper] = useState(false);

  const loadChat = useCallback(async () => {
    if (!tareaId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/tareas/${tareaId}/chat-grupo`);
      const d = await r.json();
      if (!r.ok || !d.grupo?.id) throw new Error(d.error || "No se pudo cargar el chat");
      setGrupoId(d.grupo.id);
      const rm = await fetch(`/api/chat/grupos/${d.grupo.id}/mensajes`);
      const dm = await rm.json();
      setMensajes(dm.mensajes || []);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }, [tareaId]);

  useEffect(() => {
    if (!open) return;
    loadChat();
  }, [open, loadChat]);

  // Suscripción socket
  useEffect(() => {
    if (!open || !grupoId) return;
    const s = getSocket();
    s.emit("chat:join", grupoId);
    const onMsg = (m: ChatMensaje) => {
      if (m.grupo_id !== grupoId) return;
      setMensajes((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
    };
    s.on("chat:message", onMsg);
    // marcar leídos al abrir
    fetch(`/api/chat/grupos/${grupoId}/leer`, { method: "POST" });
    return () => {
      s.emit("chat:leave", grupoId);
      s.off("chat:message", onMsg);
    };
  }, [open, grupoId]);

  const sendMessage = async (texto: string, menciones?: { id: string; nombre: string }[]) => {
    if (!grupoId || !texto.trim()) return;
    await fetch(`/api/chat/grupos/${grupoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenido: texto, tipo: "texto", menciones: menciones || [] })
    });
  };

  const onAttach = async (file: File) => {
    if (!grupoId) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/chat/upload", { method: "POST", body: fd });
    if (!r.ok) { toast.error("Error al subir"); return; }
    const d = await r.json();
    await fetch(`/api/chat/grupos/${grupoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contenido: null, tipo: "archivo",
        archivo_url: d.url, archivo_nombre: d.filename, archivo_tipo: d.mimetype
      })
    });
  };

  const sendSuper = async () => {
    setSendingSuper(true);
    try {
      const r = await fetch(`/api/tareas/${tareaId}/super-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: superMsg.trim() || "Necesito tu atención en esta tarea" })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      toast.success(`Super-notificación enviada a ${d.notified || 0} persona(s)`);
      setSuperNotifyOpen(false);
      setSuperMsg("");
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSendingSuper(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-white shadow-[-12px_0_40px_-12px_rgba(0,0,0,0.2)] z-[55] flex flex-col"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
              <MessageSquareMore className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-ui uppercase tracking-[0.1em] text-neutral-500">Chat de la tarea</div>
              <div className="font-display font-bold text-sm truncate">{tareaTitulo || "Tarea"}</div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setSuperNotifyOpen(true)}
              title="Enviar super-notificación a todos los involucrados"
              className="h-9 px-3 rounded-xl bg-gradient-to-r from-brand-red to-brand-orange text-white text-[10px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-red-500/20 hover:shadow-lg transition-shadow"
            >
              <Megaphone className="h-3.5 w-3.5" strokeWidth={2} />
              Llamar
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"
            >
              <X className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
            </motion.button>
          </div>

          {/* Messages */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : (
            <ChatMessages mensajes={mensajes} meId={user?.id || ""} />
          )}

          {/* Composer */}
          {grupoId && <ChatComposer grupoId={grupoId} onSend={sendMessage} onAttach={onAttach} disabled={!grupoId} />}

          {/* Super notify modal */}
          <AnimatePresence>
            {superNotifyOpen && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setSuperNotifyOpen(false)}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
                >
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-red to-brand-orange text-white flex items-center justify-center mb-4">
                    <Megaphone className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <h3 className="font-display text-xl font-black mb-1">Super-notificar</h3>
                  <p className="text-sm text-neutral-500 mb-4">
                    Todos los involucrados recibirán una notificación urgente en lo alto de su pantalla hasta que la cierren.
                  </p>
                  <textarea
                    autoFocus
                    value={superMsg}
                    onChange={(e) => setSuperMsg(e.target.value)}
                    placeholder="¿Qué necesitas decirles?"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/15 resize-none"
                  />
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setSuperNotifyOpen(false)}
                      className="flex-1 h-11 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-700 hover:bg-neutral-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={sendSuper}
                      disabled={sendingSuper}
                      className="flex-1 h-11 rounded-xl bg-gradient-to-r from-brand-red to-brand-orange text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {sendingSuper && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Enviar
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
