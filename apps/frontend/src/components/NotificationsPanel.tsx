"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, CheckCheck, ArrowRight, Trash2, X, Loader2, Inbox } from "@/lib/bootstrap-icons";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { playMessagePing } from "@/lib/ringtone";

interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  prioridad: "baja" | "normal" | "alta" | "critica";
  accion_url: string | null;
  leida: boolean;
  created_at: string;
}

const PRIORIDAD_COLOR = { baja: "#9CA3AF", normal: "#2196C9", alta: "#5750E8", critica: "#E53935" };

export function NotificationsPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstLoadRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notificaciones");
      const d = await r.json();
      setNotifs(d.notificaciones || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Socket: llega nueva notificación → refresh + sonido + toast
  useEffect(() => {
    const s = getSocket();
    const onNueva = (ev: any) => {
      // Las menciones de chat YA suenan por el ping del chat → evitamos doble ping en la campana.
      // (En un chat silenciado el chat no suena, así que la campana tampoco: correcto.)
      if (ev?.tipo !== "mencion") { try { playMessagePing(); } catch {} }
      // Refrescar lista (en vivo)
      load();
    };
    s.on("notificacion:nueva", onNueva);
    return () => { s.off("notificacion:nueva", onNueva); };
  }, [load]);

  // Click fuera cierra
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", esc); };
  }, [open]);

  const unread = notifs.filter((n) => !n.leida).length;

  const marcarLeida = async (id: string) => {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, leida: true } : n));
    await fetch(`/api/notificaciones/${id}/leer`, { method: "POST" });
  };

  const marcarTodas = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, leida: true })));
    const r = await fetch("/api/notificaciones/leer-todas", { method: "POST" });
    if (r.ok) {
      const d = await r.json();
      toast.success(`${d.marcadas} notificaciones marcadas como leídas`);
    }
  };

  const eliminar = async (id: string) => {
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notificaciones/${id}`, { method: "DELETE" });
  };

  const borrarTodas = async () => {
    const prev = notifs;
    setNotifs([]);
    const r = await fetch("/api/notificaciones", { method: "DELETE" });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.success(`${d.eliminadas ?? prev.length} notificaciones eliminadas`);
    } else {
      setNotifs(prev);
      toast.error("No se pudieron eliminar");
    }
  };

  const ir = async (n: Notificacion) => {
    // Marcar como leída y navegar
    if (!n.leida) await marcarLeida(n.id);
    if (n.accion_url) {
      router.push(n.accion_url);
      setOpen(false);
    }
  };

  const fmtRel = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "ahora";
    if (diff < 3600_000) return `hace ${Math.floor(diff / 60_000)}m`;
    if (diff < 86400_000) return `hace ${Math.floor(diff / 3600_000)}h`;
    return `hace ${Math.floor(diff / 86400_000)}d`;
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative h-10 w-10 flex items-center justify-center rounded-xl bg-white/60 dark:bg-white/[0.03] border border-black/5 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.08] transition"
      >
        <Bell className="h-[18px] w-[18px] text-neutral-600 dark:text-neutral-300" strokeWidth={1.8} />
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={{ scale: 0.6 }} animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-brand-red text-white text-[10px] font-ui font-bold flex items-center justify-center shadow-lg shadow-red-500/40"
            style={{ animation: "pulse 2s infinite" }}
          >
            {unread > 99 ? "99+" : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="absolute right-0 mt-2 w-[420px] max-w-[calc(100vw-32px)] bg-white dark:bg-neutral-900 rounded-2xl overflow-hidden z-50 shadow-2xl border border-neutral-200 dark:border-neutral-800"
          >
            <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-2">
              <div className="flex-1">
                <div className="font-display font-black text-[14px]">Notificaciones</div>
                <div className="text-[10px] text-neutral-500">
                  {unread > 0 ? <><strong className="text-brand-orange">{unread}</strong> sin leer</> : "Todo al día"}
                </div>
              </div>
              {unread > 0 && (
                <button
                  onClick={marcarTodas}
                  className="h-8 px-2.5 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider text-brand-orange hover:bg-brand-orange/10 flex items-center gap-1 transition-colors"
                >
                  <CheckCheck className="h-3 w-3" strokeWidth={2.5} />
                  Marcar todas
                </button>
              )}
              {notifs.length > 1 && (
                <button
                  onClick={borrarTodas}
                  title="Borrar todas las notificaciones"
                  className="h-8 px-2.5 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider text-brand-red hover:bg-brand-red/10 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={2.5} />
                  Borrar todas
                </button>
              )}
            </div>

            <div className="max-h-[480px] overflow-y-auto">
              {loading ? (
                <div className="py-10 text-center text-neutral-400">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </div>
              ) : notifs.length === 0 ? (
                <div className="py-12 text-center text-neutral-400">
                  <Inbox className="h-8 w-8 mx-auto mb-2" strokeWidth={1.5} />
                  <div className="text-[12px]">Sin notificaciones</div>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {notifs.map((n) => {
                    const color = PRIORIDAD_COLOR[n.prioridad] || "#9CA3AF";
                    return (
                      <motion.div
                        key={n.id}
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0, x: -20 }}
                        layout
                        className={cn(
                          "relative border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors group",
                          !n.leida && "bg-brand-orange/5"
                        )}
                      >
                        {!n.leida && <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: color }} />}
                        <div className="px-4 py-3 pl-5">
                          <div className="flex items-start gap-2.5">
                            <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + "15", color }}>
                              <Bell className="h-4 w-4" strokeWidth={2} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={cn("text-[13px] leading-tight", !n.leida ? "font-bold text-neutral-900 dark:text-white" : "font-medium text-neutral-600 dark:text-neutral-400")}>
                                {n.titulo}
                              </div>
                              {n.mensaje && <div className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2">{n.mensaje}</div>}
                              <div className="flex items-center justify-between mt-1.5">
                                <span className="text-[10px] text-neutral-400 font-ui">{fmtRel(n.created_at)}</span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {!n.leida && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); marcarLeida(n.id); }}
                                      title="Marcar leída"
                                      className="h-6 w-6 rounded-md hover:bg-brand-green/15 text-neutral-400 hover:text-brand-green flex items-center justify-center transition-colors"
                                    >
                                      <Check className="h-3 w-3" strokeWidth={2.5} />
                                    </button>
                                  )}
                                  {n.accion_url && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); ir(n); }}
                                      title="Ir"
                                      className="h-6 px-2 rounded-md bg-brand-orange text-white text-[9px] font-ui font-bold uppercase tracking-wider flex items-center gap-1 hover:bg-brand-gold transition-colors"
                                    >
                                      Ir <ArrowRight className="h-2.5 w-2.5" strokeWidth={2.5} />
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); eliminar(n.id); }}
                                    title="Eliminar"
                                    className="h-6 w-6 rounded-md hover:bg-brand-red/15 text-neutral-400 hover:text-brand-red flex items-center justify-center transition-colors"
                                  >
                                    <Trash2 className="h-3 w-3" strokeWidth={1.8} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
