"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquareMore, Megaphone, Loader2, Users, Search } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth-user";
import { getSocket } from "@/lib/socket";
import { ChatMessages, type ChatMensaje } from "@/components/chat/ChatMessages";
import { ChatComposer } from "@/components/chat/ChatComposer";

interface Props {
  tareaId: string;
  tareaTitulo?: string;
  miembrosCount?: number;
}

/**
 * Panel de chat de tarea estilo Bitrix — inline, no overlay.
 * Ocupa el espacio que le asigne su contenedor padre.
 */
export function TaskChatInline({ tareaId, tareaTitulo, miembrosCount }: Props) {
  const { user } = useCurrentUser();
  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<ChatMensaje[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMensaje | null>(null);
  const [loading, setLoading] = useState(true);
  const [superOpen, setSuperOpen] = useState(false);
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
      toast.error(e.message || "Error cargando chat");
    } finally {
      setLoading(false);
    }
  }, [tareaId]);

  useEffect(() => { loadChat(); }, [loadChat]);

  useEffect(() => {
    if (!grupoId) return;
    const s = getSocket();
    s.emit("chat:join", grupoId);
    const onMsg = (m: ChatMensaje) => {
      if (m.grupo_id !== grupoId) return;
      setMensajes((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
    };
    // Ediciones y BORRADOS de mensajes en tiempo real. El backend emite chat:message:updated
    // con { id, eliminado: true, ... } al borrar → aquí lo mezclamos en el mensaje por id.
    const onUpdated = (u: any) => {
      setMensajes((prev) => prev.map((m) => (m.id === u.id ? { ...m, ...u } : m)));
    };
    s.on("chat:message", onMsg);
    s.on("chat:message:updated", onUpdated);
    fetch(`/api/chat/grupos/${grupoId}/leer`, { method: "POST" });
    s.emit("chat:read", grupoId);
    return () => {
      s.emit("chat:leave", grupoId);
      s.off("chat:message", onMsg);
      s.off("chat:message:updated", onUpdated);
    };
  }, [grupoId]);

  const sendMessage = async (texto: string, menciones?: { id: string; nombre: string }[]) => {
    if (!grupoId || !texto.trim()) return;
    await fetch(`/api/chat/grupos/${grupoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenido: texto, tipo: "texto", reply_to_id: replyTo?.id || null, menciones: menciones || [] })
    });
    setReplyTo(null);
  };

  const onAttach = async (file: File) => {
    if (!grupoId) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/chat/upload", { method: "POST", body: fd });
    if (!r.ok) { toast.error("Error subiendo archivo"); return; }
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
      setSuperOpen(false);
      setSuperMsg("");
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSendingSuper(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-[#DCE7F3] to-[#CFDBEA] relative">
      {/* Header */}
      <div className="px-5 py-4 bg-white/70 backdrop-blur-md border-b border-black/5 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
          <MessageSquareMore className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[15px] leading-tight truncate">Chat de la tarea</div>
          {miembrosCount !== undefined && (
            <div className="text-[11px] text-neutral-500 flex items-center gap-1 mt-0.5">
              <Users className="h-3 w-3" strokeWidth={2} />
              {miembrosCount} {miembrosCount === 1 ? "miembro" : "miembros"}
            </div>
          )}
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
          onClick={() => setSuperOpen(true)}
          title="Llamar a todos los involucrados"
          className="h-9 px-3 rounded-xl bg-gradient-to-r from-brand-red to-brand-orange text-white text-[10px] font-ui font-bold uppercase tracking-[0.1em] flex items-center gap-1.5 shadow-md shadow-red-500/25 hover:shadow-lg transition-shadow"
        >
          <Megaphone className="h-3.5 w-3.5" strokeWidth={2.2} />
          Llamar
        </motion.button>
      </div>

      {/* Mensajes */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : mensajes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <div className="h-14 w-14 mx-auto rounded-2xl bg-white/60 text-brand-orange flex items-center justify-center mb-3">
              <MessageSquareMore className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div className="font-display font-bold text-sm mb-1">Inicia la conversación</div>
            <div className="text-[12px] text-neutral-600 max-w-xs">
              Comenta avances, comparte archivos o llama a los involucrados.
            </div>
          </div>
        </div>
      ) : (
        <ChatMessages mensajes={mensajes} meId={user?.id || ""} onReply={setReplyTo} />
      )}

      {/* Composer */}
      {grupoId && <ChatComposer grupoId={grupoId} onSend={sendMessage} onAttach={onAttach} disabled={!grupoId} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />}

      {/* Super-notify inline modal */}
      <AnimatePresence>
        {superOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-10"
            onClick={() => setSuperOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
            >
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-red to-brand-orange text-white flex items-center justify-center mb-4">
                <Megaphone className="h-5 w-5" strokeWidth={2} />
              </div>
              <h3 className="font-display text-xl font-black mb-1">Llamar a todos</h3>
              <p className="text-sm text-neutral-500 mb-4">
                Todos los involucrados recibirán un banner urgente en la parte superior de su pantalla.
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
                  onClick={() => setSuperOpen(false)}
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
    </div>
  );
}
