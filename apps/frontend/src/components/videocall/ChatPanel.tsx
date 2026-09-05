"use client";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send } from "@/lib/bootstrap-icons";
import { getSocket } from "@/lib/socket";

interface ChatMsg {
  id: string;
  contenido: string;
  user_id: string;
  created_at: string;
}

interface Props {
  videollamadaId: string;
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ videollamadaId, open, onClose }: Props) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("videollamada:join", videollamadaId);
    const onMsg = (m: ChatMsg) => setMsgs((p) => [...p, m]);
    socket.on("videollamada:chat", onMsg);
    return () => { socket.off("videollamada:chat", onMsg); };
  }, [videollamadaId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs.length, open]);

  const send = () => {
    if (!input.trim()) return;
    getSocket().emit("videollamada:chat", { videollamadaId, contenido: input.trim() });
    setInput("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 bg-[rgba(10,10,20,0.92)] backdrop-blur-xl border-l border-white/10 z-30 flex flex-col"
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-ui uppercase text-[10px] tracking-wider text-brand-orange mb-0.5">Chat de reunión</div>
              <div className="font-display font-black text-sm">Conversación en vivo</div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {msgs.length === 0 ? (
              <div className="text-center text-xs text-white/30 py-12">Sin mensajes aún</div>
            ) : msgs.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl bg-white/5 px-3 py-2.5 text-sm border border-white/5"
              >
                <div className="text-[10px] text-white/40 mb-1">
                  {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="text-white/90">{m.contenido}</div>
              </motion.div>
            ))}
          </div>

          <div className="p-3 border-t border-white/10">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Escribe un mensaje..."
                className="flex-1 h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange focus:bg-white/10 transition"
              />
              <button
                onClick={send}
                disabled={!input.trim()}
                className="h-11 w-11 rounded-xl gradient-orange flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
