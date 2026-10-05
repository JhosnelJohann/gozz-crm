"use client";
import { nombreVisible } from "@/lib/whatsapp-numero";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { WhatsappLogo, X } from "@/lib/bootstrap-icons";
import { getSocket } from "@/lib/socket";
import { getWhatsappActive } from "@/lib/whatsappActive";
import { playMessagePing } from "@/lib/ringtone";
import { initialsOf } from "@/lib/auth-user";

interface EventoMensaje {
  conexion_id: string;
  conversacion_id: string;
  mensaje: {
    direccion: "entrante" | "saliente";
    tipo: string;
    contenido: string | null;
  };
}

interface ToastItem {
  key: string;
  conversacionId: string;
  nombre: string;
  foto: string | null;
  preview: string;
  startedAt: number;
}

const AUTO_DISMISS_MS = 5000;

function previewDe(msg: EventoMensaje["mensaje"]): string {
  if (msg.contenido) return msg.contenido.length > 90 ? msg.contenido.slice(0, 89) + "…" : msg.contenido;
  if (msg.tipo === "imagen") return "📷 Imagen";
  if (msg.tipo === "video") return "🎥 Video";
  if (msg.tipo === "audio") return "🎤 Audio";
  if (msg.tipo === "archivo") return "📎 Archivo";
  return "Mensaje nuevo";
}

/**
 * Notificador global de WhatsApp (sonido + toast), mismo patrón que `MessageToast` (chat interno)
 * — pero de un solo mensaje a la vez, ya que el evento `whatsapp:mensaje` no trae el nombre del
 * contacto: se pide `/api/whatsapp/conversaciones/:id` bajo demanda para completarlo.
 */
export function WhatsappNotifier() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef<string>(pathname || "");
  const [toast, setToast] = useState<ToastItem | null>(null);

  useEffect(() => { pathRef.current = pathname || ""; }, [pathname]);

  useEffect(() => {
    const socket = getSocket();
    const onMensaje = async (ev: EventoMensaje) => {
      if (!ev?.mensaje || ev.mensaje.direccion !== "entrante") return;

      const onWhatsappPage = pathRef.current === "/whatsapp";
      const viendoEsta = getWhatsappActive() === ev.conversacion_id;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      if (onWhatsappPage && viendoEsta && visible) return;

      try { playMessagePing(); } catch {}

      let nombre = "Nuevo lead";
      let foto: string | null = null;
      try {
        const r = await fetch(`/api/whatsapp/conversaciones/${ev.conversacion_id}`);
        if (r.ok) {
          const d = await r.json();
          nombre = d.conversacion ? nombreVisible(d.conversacion) : nombre;
          foto = d.conversacion?.foto_perfil_url || null;
        }
      } catch {}

      setToast({
        key: `${ev.conversacion_id}-${Date.now()}`,
        conversacionId: ev.conversacion_id,
        nombre,
        foto,
        preview: previewDe(ev.mensaje),
        startedAt: Date.now(),
      });
    };
    socket.on("whatsapp:mensaje", onMensaje);
    return () => { socket.off("whatsapp:mensaje", onMensaje); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.key === toast.key ? null : cur)), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const abrir = useCallback(() => {
    if (!toast) return;
    router.push(`/whatsapp?conversacion=${toast.conversacionId}`);
    setToast(null);
  }, [toast, router]);

  return (
    <div className="fixed top-4 right-4 z-[90] pointer-events-none">
      <AnimatePresence>
        {toast && (
          <motion.button
            key={toast.key}
            type="button"
            onClick={abrir}
            initial={{ opacity: 0, x: 40, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.95, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.8 }}
            className="pointer-events-auto w-[340px] max-w-[calc(100vw-32px)] cursor-pointer group text-left glass-panel rounded-2xl overflow-hidden"
          >
            <div className="h-0.5 bg-gradient-to-r from-brand-green via-brand-primary to-brand-green" />
            <div className="p-3.5 flex items-center gap-3">
              <div className="relative shrink-0">
                <div className="h-11 w-11 rounded-full bg-gradient-to-br from-brand-green to-brand-primary p-[2px]">
                  <div className="h-full w-full rounded-full overflow-hidden bg-white dark:bg-neutral-800 flex items-center justify-center">
                    {toast.foto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={toast.foto} alt={toast.nombre} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-brand-primary font-bold text-sm">{initialsOf(toast.nombre)}</span>
                    )}
                  </div>
                </div>
                <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-brand-green border-2 border-white dark:border-neutral-900 flex items-center justify-center">
                  <WhatsappLogo className="h-2 w-2 text-white" weight="fill" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-neutral-900 dark:text-white leading-tight truncate">{toast.nombre}</div>
                <div className="text-[12px] text-neutral-600 dark:text-neutral-400 leading-snug line-clamp-1 mt-0.5">{toast.preview}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setToast(null); }}
                className="shrink-0 h-7 w-7 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
