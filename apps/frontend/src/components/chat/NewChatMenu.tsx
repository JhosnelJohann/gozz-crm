"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Sparkles, Megaphone, Video, Loader2 } from "@/lib/bootstrap-icons";
import { initialsOf } from "@/lib/auth-user";
import { usePresence } from "@/lib/presence";

export type NewChatAction = "grupo" | "copilot" | "canal" | "videoconferencia";

interface Contact {
  id: string;
  nombre: string;
  foto_perfil_url?: string | null;
  departamento?: string | null;
  posiciones?: string[];
  email?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (a: NewChatAction) => void;
  onStartDM?: (userId: string) => void;
}

const ITEMS: {
  key: NewChatAction;
  label: string;
  desc: string;
  Icon: any;
  iconClass: string;
}[] = [
  { key: "grupo",            label: "Chat grupal",         desc: "Discusiones grupales",                  Icon: Users,     iconClass: "text-brand-orange bg-brand-orange/10" },
  { key: "copilot",          label: "Chatear con CoPilot", desc: "Consulta a tu asistente IA (Claude)",   Icon: Sparkles,  iconClass: "text-fuchsia-600 bg-fuchsia-100 dark:bg-fuchsia-500/15" },
  { key: "canal",            label: "Canal",               desc: "Noticias, anuncios, comunicados",       Icon: Megaphone, iconClass: "text-amber-600 bg-amber-100 dark:bg-amber-500/15" },
  { key: "videoconferencia", label: "Videoconferencia",    desc: "Videollamada grupal con invitados",     Icon: Video,     iconClass: "text-sky-600 bg-sky-100 dark:bg-sky-500/15" },
];

export function NewChatMenu({ open, onClose, onPick, onStartDM }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const presence = usePresence();

  useEffect(() => {
    if (!open) return;
    // Carga contactos del equipo solo si hay handler para iniciar DM
    if (onStartDM) {
      setLoading(true);
      fetch("/api/chat/contactos")
        .then((r) => r.json())
        .then((d) => setContacts(Array.isArray(d.contactos) ? d.contactos : []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // No cerrar si el click es sobre el botón (+) que abre/cierra el menú: ese botón maneja su
      // propio toggle (si cerráramos aquí, su onClick lo reabriría al instante).
      if (t?.closest?.("[data-chat-newmenu-trigger]")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open, onClose, onStartDM]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="absolute top-14 right-3 z-50 w-80 modal-surface rounded-2xl shadow-2xl border border-black/5 dark:border-white/10 overflow-hidden flex flex-col max-h-[78vh]"
        >
          <div className="py-2 shrink-0">
            {ITEMS.map((it) => {
              const Icon = it.Icon;
              return (
                <button
                  key={it.key}
                  onClick={() => { onPick(it.key); onClose(); }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition"
                >
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${it.iconClass}`}>
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{it.label}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-white/50 truncate">{it.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {onStartDM && (
            <>
              <div className="px-4 pt-2 pb-1.5 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                <div className="text-[10px] font-ui font-bold uppercase tracking-[0.15em] text-neutral-400">Contactos del equipo</div>
                {loading && <Loader2 className="h-3 w-3 animate-spin text-brand-orange" />}
              </div>
              <div className="flex-1 overflow-y-auto pb-2 scrollbar-thin" style={{ overscrollBehavior: "contain" }}>
                {!loading && contacts.length === 0 ? (
                  <div className="px-4 py-3 text-[11px] text-neutral-400">Sin contactos</div>
                ) : (
                  contacts.map((c) => {
                    const online = presence.isOnline(c.id);
                    const sub = (c.posiciones && c.posiciones[0]) || c.departamento || c.email || "";
                    return (
                      <button
                        key={c.id}
                        onClick={() => { onStartDM(c.id); onClose(); }}
                        className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition"
                      >
                        <div className="relative shrink-0">
                          <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-[11px] font-bold flex items-center justify-center">
                            {c.foto_perfil_url ? (
                              <img src={c.foto_perfil_url} alt="" className="h-full w-full object-cover" />
                            ) : initialsOf(c.nombre || "?")}
                          </div>
                          {online && (
                            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-400 border-2 border-white dark:border-bg-dark" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{c.nombre}</div>
                          {sub && <div className="text-[11px] text-neutral-500 dark:text-white/50 truncate">{sub}</div>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
