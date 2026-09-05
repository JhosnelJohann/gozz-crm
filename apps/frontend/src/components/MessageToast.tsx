"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, X, Paperclip, ArrowRight } from "@/lib/bootstrap-icons";
import { useRouter, usePathname } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { getActiveChat, setActiveChat } from "@/lib/chatActive";
import { playMessagePing } from "@/lib/ringtone";
import { initialsOf } from "@/lib/auth-user";
import { initMutedSync, isMuted } from "@/lib/mutedChats";
import { cn } from "@/lib/utils";

interface IncomingMsg {
  id: string;
  grupo_id: string;
  user_id: string;
  user_nombre?: string;
  foto_perfil_url?: string | null;
  tipo: string;
  contenido: string | null;
  archivo_nombre?: string | null;
  created_at: string;
}

interface ToastItem {
  key: string;
  msg: IncomingMsg;
  startedAt: number;
  progress: number;  // 0 a 1 (1 = lleno, va bajando)
  paused: boolean;
}

const AUTO_DISMISS_MS = 5000;

export function MessageToast() {
  const router = useRouter();
  const pathname = usePathname();
  const meIdRef = useRef<string | null>(null);
  const pathRef = useRef<string>(pathname || "");
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const queueRef = useRef<ToastItem[]>([]);
  queueRef.current = queue;

  useEffect(() => { pathRef.current = pathname || ""; }, [pathname]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => { meIdRef.current = d?.user?.id ?? null; }).catch(() => {});
    initMutedSync();
  }, []);

  // Socket listener
  useEffect(() => {
    const s = getSocket();
    const onMsg = (m: IncomingMsg) => {
      if (!m?.id) return;
      if (meIdRef.current && m.user_id === meIdRef.current) return;       // ignorar propios
      if (!m.user_id) return;                                              // ignorar mensajes de sistema
      // Si está en la pantalla de chat viendo ese grupo, no mostrar toast
      const onChatPage = pathRef.current === "/chat";
      const viewingThis = getActiveChat() === m.grupo_id;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      if (onChatPage && viewingThis && visible) return;

      // Chat silenciado: no suena ni muestra toast (pero el mensaje sí se entrega y cuenta).
      if (isMuted(m.grupo_id)) return;

      try { playMessagePing(); } catch {}

      const key = `${m.id}-${Date.now()}`;
      setQueue((q) => {
        // Max 4 toasts apilados
        const next = [...q, { key, msg: m, startedAt: Date.now(), progress: 1, paused: false }];
        return next.slice(-4);
      });
    };
    s.on("chat:message", onMsg);
    return () => { s.off("chat:message", onMsg); };
  }, []);

  // Tick de progress y auto-dismiss
  useEffect(() => {
    if (queue.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setQueue((q) => q.map((it) => {
        if (it.paused) return it;
        const elapsed = now - it.startedAt;
        const progress = Math.max(0, 1 - elapsed / AUTO_DISMISS_MS);
        return { ...it, progress };
      }).filter((it) => it.paused || (now - it.startedAt < AUTO_DISMISS_MS)));
    }, 50);
    return () => clearInterval(id);
  }, [queue.length]);

  const dismiss = useCallback((key: string) => {
    setQueue((q) => q.filter((it) => it.key !== key));
  }, []);

  const openChat = useCallback((it: ToastItem) => {
    setActiveChat(it.msg.grupo_id);
    router.push("/chat");
    dismiss(it.key);
  }, [router, dismiss]);

  const pause = useCallback((key: string) => {
    setQueue((q) => q.map((it) => it.key === key ? { ...it, paused: true } : it));
  }, []);

  const resume = useCallback((key: string) => {
    setQueue((q) => q.map((it) => it.key === key ? { ...it, paused: false, startedAt: Date.now() - (1 - it.progress) * AUTO_DISMISS_MS } : it));
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[90] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {queue.map((it) => (
          <ToastCard
            key={it.key}
            item={it}
            onDismiss={() => dismiss(it.key)}
            onClick={() => openChat(it)}
            onPause={() => pause(it.key)}
            onResume={() => resume(it.key)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ item, onDismiss, onClick, onPause, onResume }: {
  item: ToastItem;
  onDismiss: () => void;
  onClick: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const m = item.msg;
  const nombre = m.user_nombre || "Alguien";
  const preview = (() => {
    if (m.tipo === "archivo" && m.archivo_nombre) return `📎 ${m.archivo_nombre}`;
    if (!m.contenido) return "(sin contenido)";
    return m.contenido.length > 90 ? m.contenido.slice(0, 89) + "…" : m.contenido;
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.8 }}
      onHoverStart={onPause}
      onHoverEnd={onResume}
      onClick={onClick}
      className="pointer-events-auto w-[380px] max-w-[calc(100vw-32px)] cursor-pointer group"
    >
      {/* Glow detrás */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-orange/20 via-brand-gold/10 to-transparent blur-xl opacity-60 group-hover:opacity-100 transition-opacity -z-10" />

      <div className="relative bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl rounded-2xl overflow-hidden shadow-[0_20px_50px_-12px_rgba(87,80,232,0.35)] ring-1 ring-black/5 dark:ring-white/10">
        {/* Gradient top-bar tendencia 2026 */}
        <div className="h-0.5 bg-gradient-to-r from-brand-orange via-brand-gold to-brand-orange" />

        <div className="p-3.5 flex items-center gap-3">
          {/* Avatar con ring animado + breathe */}
          <div className="relative shrink-0">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand-orange via-brand-gold to-brand-orange opacity-60 blur-sm"
            />
            <div className="relative h-12 w-12 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold p-[2px]">
              <div className="h-full w-full rounded-full overflow-hidden bg-white dark:bg-neutral-800 flex items-center justify-center">
                {m.foto_perfil_url ? (
                  <img src={m.foto_perfil_url} alt={nombre} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-brand-orange font-bold text-sm">{initialsOf(nombre)}</span>
                )}
              </div>
            </div>
            {/* Dot indicator */}
            <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-brand-green border-2 border-white dark:border-neutral-900 flex items-center justify-center">
              <MessageSquare className="h-2 w-2 text-white" strokeWidth={3} />
            </div>
          </div>

          {/* Contenido */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1 mb-0.5">
              <span className="text-[10px] font-ui uppercase tracking-[0.12em] text-brand-orange font-bold">Nuevo mensaje</span>
              <span className="text-[10px] text-neutral-400 ml-auto">ahora</span>
            </div>
            <div className="text-[13px] font-bold text-neutral-900 dark:text-white leading-tight truncate">
              Recibiste un mensaje de {nombre}
            </div>
            <div className="text-[12px] text-neutral-600 dark:text-neutral-400 leading-snug line-clamp-1 mt-0.5">
              {preview}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="shrink-0 h-7 w-7 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors opacity-0 group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        {/* CTA hover */}
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          whileHover={{ opacity: 1, height: "auto" }}
          className="px-3.5 pb-2.5 flex items-center justify-end"
        >
          <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-brand-orange flex items-center gap-1">
            Ver chat <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
          </span>
        </motion.div>

        {/* Progress bar abajo (tiempo restante antes de auto-dismiss) */}
        <div className="h-[3px] bg-black/5 dark:bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-brand-orange to-brand-gold"
            animate={{ width: `${item.progress * 100}%` }}
            transition={{ duration: 0.05, ease: "linear" }}
          />
        </div>
      </div>
    </motion.div>
  );
}
