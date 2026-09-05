"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";
import { getActiveChat } from "@/lib/chatActive";
import { playMessagePing } from "@/lib/ringtone";
import { initialsOf } from "@/lib/auth-user";
import { initMutedSync, isMuted } from "@/lib/mutedChats";
import type { ChatMensaje } from "./ChatMessages";

export function ChatNotifier() {
  const router = useRouter();
  const pathname = usePathname();
  const meIdRef = useRef<string | null>(null);
  const pathRef = useRef<string>(pathname || "");

  useEffect(() => { pathRef.current = pathname || ""; }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) meIdRef.current = d?.user?.id ?? null; })
      .catch(() => {});
    initMutedSync();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMsg = (m: ChatMensaje) => {
      if (!m || !m.id) return;
      if (meIdRef.current && m.user_id === meIdRef.current) return;

      const onChatPage = pathRef.current === "/chat";
      const viewingThis = getActiveChat() === m.grupo_id;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      if (onChatPage && viewingThis && visible) return;

      // Chat silenciado: no suena ni muestra toast (pero el mensaje sí se entrega y cuenta).
      if (isMuted(m.grupo_id)) return;

      try { playMessagePing(); } catch {}

      const preview = (() => {
        const raw = m.contenido || m.archivo_nombre || "archivo";
        return raw.length > 80 ? raw.slice(0, 79) + "…" : raw;
      })();
      const nombre = m.user_nombre || "Mensaje nuevo";
      const foto = m.foto_perfil_url || null;

      toast.custom(
        (id) => (
          <button
            onClick={() => { toast.dismiss(id); router.push("/chat"); }}
            className="glass w-[340px] max-w-[86vw] rounded-2xl p-3 flex items-center gap-3 text-left shadow-glass dark:shadow-glass-dark border border-white/20 hover:border-brand-orange/60 transition"
          >
            <div className="relative shrink-0">
              {foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={foto} alt={nombre} className="w-10 h-10 rounded-full object-cover ring-2 ring-brand-orange/60" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-semibold text-sm">
                  {initialsOf(nombre)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-fg-light dark:text-fg-dark truncate">{nombre}</div>
              <div className="text-xs text-black/70 dark:text-white/70 truncate">{preview}</div>
            </div>
          </button>
        ),
        { duration: 3000 }
      );
    };

    socket.on("chat:message", onMsg);
    return () => { socket.off("chat:message", onMsg); };
  }, [router]);

  return null;
}
