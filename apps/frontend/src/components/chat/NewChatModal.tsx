"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { initialsOf } from "@/lib/auth-user";

interface Contacto {
  id: string;
  email: string;
  nombre: string;
  foto_perfil_url: string | null;
  online: boolean;
  departamento?: string | null;
  posiciones?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onStarted: (grupo: any) => void;
}

export function NewChatModal({ open, onClose, onStarted }: Props) {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/chat/contactos")
      .then((r) => r.json())
      .then((d) => setContactos(d.contactos || []))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = contactos.filter((c) => {
    if (!q.trim()) return true;
    const qq = q.toLowerCase();
    return c.nombre.toLowerCase().includes(qq) || c.email.toLowerCase().includes(qq);
  });

  const startDM = async (target: Contacto) => {
    setStarting(target.id);
    try {
      const r = await fetch("/api/chat/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: target.id })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      onStarted(d.grupo);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setStarting(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="rounded-3xl p-0 w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden modal-surface"
          >
            <div className="p-5 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
              <div>
                <h3 className="font-display font-black text-lg">Nuevo chat</h3>
                <p className="text-xs text-neutral-500">Busca un miembro del equipo</p>
              </div>
              <button onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-white/10 flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 border-b border-black/5 dark:border-white/5">
              <div className="flex items-center gap-2 h-11 px-3 rounded-xl bg-neutral-100 dark:bg-white/5 border border-transparent focus-within:border-brand-orange/40">
                <Search className="h-4 w-4 text-neutral-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nombre o email..."
                  autoFocus
                  className="flex-1 bg-transparent outline-none text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-brand-orange" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-xs text-neutral-400">Sin resultados</div>
              ) : filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => startDM(c)}
                  disabled={starting !== null}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-neutral-50 dark:hover:bg-white/[0.02] transition disabled:opacity-50"
                >
                  <div className="relative flex-shrink-0">
                    <div className="h-11 w-11 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-bold text-xs">
                      {c.foto_perfil_url ? (
                        <img src={c.foto_perfil_url} alt={c.nombre} className="h-full w-full object-cover" />
                      ) : (
                        initialsOf(c.nombre)
                      )}
                    </div>
                    {c.online && (
                      <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-400 border-2 border-bg-light dark:border-bg-dark" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{c.nombre}</div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {(c.posiciones || [])[0] || c.departamento || c.email}
                    </div>
                  </div>
                  {starting === c.id && <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
