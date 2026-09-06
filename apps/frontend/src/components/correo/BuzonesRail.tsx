"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox, Send as SendIcon, AlertCircle, Trash, Plus, CircleDot, WifiOff, ChevronLeft, ChevronRight, MoreVertical, Pencil } from "@/lib/bootstrap-icons";
import { SenderAvatar } from "./SenderAvatar";
import { NumberTicker } from "@/components/magic/NumberTicker";
import { ShimmerButton } from "@/components/magic/ShimmerButton";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useCurrentUser } from "@/lib/auth-user";

export interface Buzon {
  id: string;
  email: string;
  display_name: string | null;
  imap_host: string;
  smtp_host: string;
  activo: boolean;
  ultimo_sync: string | null;
  errores_consecutivos: number;
  ultimo_error: string | null;
  es_mio: boolean;
  requiere_auth_update: boolean;
  auth_type?: string | null;
}

const FOLDERS = [
  { key: "INBOX", label: "Bandeja entrada", Icon: Inbox },
  { key: "SENT", label: "Enviados", Icon: SendIcon },
  { key: "SPAM", label: "Spam", Icon: AlertCircle },
  { key: "TRASH", label: "Papelera", Icon: Trash },
] as const;

interface Props {
  buzones: Buzon[];
  activeBuzonId: string | null;
  onSelectBuzon: (id: string) => void;
  folder: string;
  onChangeFolder: (f: string) => void;
  unreadByBuzon: Record<string, number>;
  onConnectNew: () => void;
  onDesvincular: (id: string, email: string) => void;
  onReconectar: (b: Buzon) => void;
  onEditarConexion: (b: Buzon) => void;
}

function isRecentSync(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000;
}

export function BuzonesRail({
  buzones, activeBuzonId, onSelectBuzon, folder, onChangeFolder, unreadByBuzon, onConnectNew,
  onDesvincular, onReconectar, onEditarConexion,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { isAdmin } = useCurrentUser();
  const active = buzones.find((b) => b.id === activeBuzonId);
  const puedeGestionar = (b: Buzon | undefined) => !!b && (b.es_mio || isAdmin);

  // Menú de opciones (⋮) del buzón activo. Se portea a <body> porque el aside tiene overflow-hidden.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const r = menuBtnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 6, left: Math.max(8, r.right - 208) });
    setMenuOpen(true);
  };
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-buzon-menu]") || t.closest("[data-buzon-menu-trigger]")) return;
      setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [menuOpen]);

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 272 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="shrink-0 relative h-full bg-bg-surface-2 dark:bg-white/[0.02] border-r border-black/5 dark:border-white/10 flex flex-col overflow-hidden"
    >
      <div className="p-4 border-b border-black/5 dark:border-white/10">
        <div className="flex items-center gap-3 mb-3 group/hdr">
          {active ? (
            <SenderAvatar email={active.email} name={active.display_name || active.email} size={collapsed ? 40 : 44} />
          ) : (
            <div className="h-11 w-11 rounded-xl gradient-orange flex items-center justify-center text-white">
              <Inbox className="h-5 w-5" />
            </div>
          )}
          {!collapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 min-w-0">
              <div className="font-display font-black text-sm truncate">{active?.display_name || active?.email || "Sin buzón"}</div>
              <div className="text-[10px] text-neutral-500 flex items-center gap-1 truncate">
                {active ? (
                  isRecentSync(active.ultimo_sync) ? (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inset-0 rounded-full bg-brand-green animate-ping opacity-75" />
                        <span className="relative rounded-full bg-brand-green h-1.5 w-1.5" />
                      </span>
                      Sincronizado
                    </>
                  ) : active.errores_consecutivos > 0 ? (
                    <><WifiOff className="h-2.5 w-2.5 text-brand-red" /> Error</>
                  ) : (
                    <><CircleDot className="h-2.5 w-2.5 text-neutral-400" /> En espera</>
                  )
                ) : "Conecta un buzón"}
              </div>
            </motion.div>
          )}
          {active && !collapsed && (
            <button
              ref={menuBtnRef}
              data-buzon-menu-trigger
              onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
              title="Opciones del buzón"
              className={cn(
                "h-8 w-8 rounded-lg text-neutral-400 hover:text-brand-orange hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center transition shrink-0",
                menuOpen ? "opacity-100 text-brand-orange bg-black/5" : "md:opacity-0 md:group-hover/hdr:opacity-100"
              )}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          )}
        </div>

        {!collapsed ? (
          <ShimmerButton onClick={onConnectNew} size="sm" className="w-full">
            <Plus className="h-3.5 w-3.5" /> Conectar nuevo
          </ShimmerButton>
        ) : (
          <button onClick={onConnectNew} className="h-9 w-9 mx-auto rounded-xl bg-brand-orange text-white flex items-center justify-center hover:scale-105 transition shadow-glow">
            <Plus className="h-4 w-4" />
          </button>
        )}

        {/* Reconectar prominente solo cuando las credenciales fallaron (estado urgente). */}
        {active && !collapsed && active.requiere_auth_update && (
          <button
            onClick={() => onReconectar(active)}
            title="Las credenciales dejaron de funcionar. Reconectar con la clave nueva."
            className="w-full h-8 mt-2 px-2 rounded-lg bg-brand-red/10 text-brand-red text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-red/20 flex items-center justify-center gap-1.5 transition"
          >
            <WifiOff className="h-3 w-3" /> Reconectar
          </button>
        )}
      </div>

      {/* Menú de opciones del buzón activo (porteado a body por el overflow-hidden del aside). */}
      {menuOpen && menuPos && active && createPortal(
        <div
          data-buzon-menu
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed z-[60] w-52 rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 text-sm overflow-hidden"
        >
          <button
            onClick={() => { setMenuOpen(false); onEditarConexion(active); }}
            className="w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2.5 transition"
          >
            <Pencil className="h-4 w-4 text-neutral-500" /> Editar conexión
          </button>
          {active.requiere_auth_update && (
            <button
              onClick={() => { setMenuOpen(false); onReconectar(active); }}
              className="w-full text-left px-3 py-2 hover:bg-brand-red/5 flex items-center gap-2.5 text-brand-red transition"
            >
              <WifiOff className="h-4 w-4" /> Reconectar
            </button>
          )}
          {puedeGestionar(active) && (
            <button
              onClick={() => { setMenuOpen(false); onDesvincular(active.id, active.email); }}
              className="w-full text-left px-3 py-2 hover:bg-brand-red/5 flex items-center gap-2.5 text-brand-red transition"
            >
              <Trash className="h-4 w-4" /> Desvincular buzón
            </button>
          )}
        </div>,
        document.body
      )}

      {buzones.length > 1 && !collapsed && (
        <div className="px-3 pt-3 pb-1 text-[9px] font-ui uppercase tracking-[0.18em] text-neutral-400">Buzones</div>
      )}
      {buzones.length > 1 && (
        <div className="px-2 space-y-0.5">
          {buzones.map((b) => {
            const active = b.id === activeBuzonId;
            const unread = unreadByBuzon[b.id] || 0;
            return (
              <button
                key={b.id}
                onClick={() => onSelectBuzon(b.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 rounded-lg transition group relative",
                  active ? "bg-brand-orange/10" : "hover:bg-black/5 dark:hover:bg-white/5"
                )}
                title={b.email}
              >
                <SenderAvatar email={b.email} name={b.display_name} size={28} />
                {!collapsed && (
                  <>
                    <div className="flex-1 min-w-0 text-left">
                      <div className={cn("text-[11px] font-bold truncate", active ? "text-brand-orange" : "")}>
                        {b.display_name || b.email.split("@")[0]}
                      </div>
                      <div className="text-[9px] text-neutral-400 truncate">{b.email}</div>
                    </div>
                    {b.requiere_auth_update ? (
                      <WifiOff className="h-3.5 w-3.5 text-brand-red shrink-0" aria-label="Requiere reconexión" />
                    ) : unread > 0 && (
                      <span className="text-[10px] font-bold text-white bg-brand-red rounded-full px-1.5 min-w-[18px] text-center tabular-nums">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className={cn("flex-1 overflow-y-auto p-3 space-y-1", buzones.length > 1 ? "border-t border-black/5 dark:border-white/10 mt-2 pt-3" : "")}>
        {FOLDERS.map((f) => {
          const Icon = f.Icon;
          const isActive = folder === f.key;
          return (
            <button
              key={f.key}
              onClick={() => onChangeFolder(f.key)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition relative group",
                isActive ? "text-brand-primary bg-brand-primary/8" : "text-neutral-600 dark:text-neutral-300 hover:text-brand-primary hover:bg-black/[0.03] dark:hover:bg-white/5"
              )}
              title={f.label}
            >
              {isActive && (
                <motion.span
                  layoutId="folder-active-rail"
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full gradient-orange shadow-[0_0_12px_rgba(87,80,232,0.6)]"
                />
              )}
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              {!collapsed && <span className="text-xs font-medium">{f.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="border-t border-black/5 dark:border-white/10 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full h-9 rounded-lg flex items-center justify-center gap-2 text-neutral-400 hover:text-brand-orange hover:bg-black/5 dark:hover:bg-white/5 transition"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span className="text-[10px] font-ui uppercase tracking-[0.15em]">Colapsar</span></>}
        </button>
      </div>
    </motion.aside>
  );
}
