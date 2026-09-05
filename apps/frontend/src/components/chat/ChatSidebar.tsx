"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Hash, UserPlus, Loader2, Megaphone, Pin, Clock, ChevronDown, ChevronRight, BellOff, ArrowLeft } from "@/lib/bootstrap-icons";
import { ArchiveDownIcon } from "./ArchiveIcons";
import { CoPilotAvatar } from "./CoPilotMessage";
import { TypingDots } from "./TypingIndicator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/auth-user";
import { setMutedLocal } from "@/lib/mutedChats";
import { usePresence } from "@/lib/presence";
import { NewChatMenu, type NewChatAction } from "./NewChatMenu";
import { ChatContextMenu, type CtxAction } from "./ChatContextMenu";

export interface ChatListItem {
  id: string;
  nombre: string;
  tipo: string;
  avatar_url: string | null;
  color?: string | null;
  ultimo_mensaje: string | null;
  ultimo_mensaje_at: string | null;
  unread_count: number;
  fijado?: boolean;
  silenciado?: boolean;
  oculto?: boolean;   // "oculto" en DB = ARCHIVADO en la UI (WhatsApp-style)
  recordar_at?: string | null;
  otro_usuario?: {
    id: string;
    nombre: string;
    foto_perfil_url: string | null;
    online: boolean;
    departamento?: string | null;
  };
}

const COLOR_GRADIENTS: Record<string, string> = {
  purple:  "from-violet-500 to-fuchsia-600",
  blue:    "from-sky-500 to-blue-600",
  emerald: "from-emerald-500 to-teal-600",
  pink:    "from-pink-500 to-rose-600",
  indigo:  "from-indigo-500 to-purple-600",
  amber:   "from-amber-500 to-orange-500",
  cyan:    "from-cyan-500 to-sky-600",
  rose:    "from-rose-500 to-red-600",
};
function groupAvatarGradient(g: { tipo: string; color?: string | null }) {
  if (g.color && COLOR_GRADIENTS[g.color]) return COLOR_GRADIENTS[g.color];
  if (g.tipo === "copilot") return "from-fuchsia-500 to-violet-600";
  if (g.tipo === "canal")   return "from-amber-500 to-orange-500";
  return "from-brand-orange to-neon-magenta";
}

interface SearchResult {
  grupos: any[];
  users: any[];
}

interface Props {
  grupos: ChatListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChatAction: (action: NewChatAction) => void;
  onStartDM: (userId: string) => void;
  onReload?: () => void;
  // Mapa { grupoId: { userId: nombre } } de quién está escribiendo dónde.
  // Lo mantiene page.tsx (incluye auto-expiración a 3.5s); aquí solo se lee.
  typingByGroup?: Record<string, Record<string, string>>;
}

function formatPreview(raw: string | null): string {
  if (!raw) return "Sin mensajes";
  // Mensajes sistema JSON → etiqueta amigable
  if (raw.startsWith("{") && raw.includes('"_t"')) {
    try {
      const p = JSON.parse(raw);
      if (p?._t === "call_missed") {
        if (p.reason === "declined") return "📞 Llamada rechazada";
        if (p.reason === "no_answer") return "📞 Llamada perdida";
        if (p.reason === "busy") return "📞 En otra llamada";
        return "📞 Llamada";
      }
      if (p?._t === "call_summary") return "📹 Resumen de videollamada";
    } catch {}
    return "Mensaje";
  }
  return raw;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (diffMs < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffMs < 7 * oneDay) {
    return d.toLocaleDateString("es", { weekday: "short" });
  }
  return d.toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export function ChatSidebar({ grupos, activeId, onSelect, onNewChatAction, onStartDM, onReload, typingByGroup }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);          // menú del botón (+)
  const [vista, setVista] = useState<"principal" | "archivados">("principal");
  const [ctx, setCtx] = useState<{ grupo: ChatListItem; x: number; y: number } | null>(null);
  const [tab, setTab] = useState<"equipo" | "tareas">("equipo");
  const presence = usePresence();

  // Archivados (DB: oculto) vs. no archivados, cada uno filtrado por el tab actual.
  const noArchivados = useMemo(() => grupos.filter((g) => !g.oculto), [grupos]);
  const archivados   = useMemo(() => grupos.filter((g) => g.oculto), [grupos]);

  const porTab = (list: ChatListItem[]) =>
    tab === "tareas" ? list.filter((g) => g.tipo === "tarea") : list.filter((g) => g.tipo !== "tarea");
  const noArchivadosTab = useMemo(() => porTab(noArchivados), [noArchivados, tab]);
  const archivadosTab   = useMemo(() => porTab(archivados), [archivados, tab]);
  const archivadosCount = archivadosTab.length;

  // Counts de los tabs = chats NO archivados con mensajes sin leer.
  const counts = useMemo(() => ({
    equipo: noArchivados.filter((g) => g.tipo !== "tarea" && (g.unread_count || 0) > 0).length,
    tareas: noArchivados.filter((g) => g.tipo === "tarea" && (g.unread_count || 0) > 0).length,
  }), [noArchivados]);

  const filteredChats = useMemo(() => {
    if (!q.trim()) return noArchivadosTab;
    const qq = q.toLowerCase();
    return noArchivadosTab.filter((g) => g.nombre.toLowerCase().includes(qq));
  }, [noArchivadosTab, q]);

  // Si te quedas sin archivados (p.ej. desarchivaste el último), regresa al panel principal.
  useEffect(() => {
    if (vista === "archivados" && archivadosCount === 0) setVista("principal");
  }, [vista, archivadosCount]);

  const aplicarEstado = async (grupoId: string, patch: Record<string, any>) => {
    try {
      const r = await fetch(`/api/chat/grupos/${grupoId}/estado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("Error");
      if (onReload) onReload();
    } catch (e: any) { toast.error(e.message || "Error"); }
  };

  const onCtxPick = async (action: CtxAction) => {
    if (!ctx) return;
    const g = ctx.grupo;
    setCtx(null);
    if (action === "toggle-fijar") {
      const nuevo = !g.fijado;
      aplicarEstado(g.id, { fijado: nuevo });
      toast.success(nuevo ? "Chat fijado" : "Chat desfijado");
    } else if (action === "toggle-silenciar") {
      const nuevo = !g.silenciado;
      setMutedLocal(g.id, nuevo); // optimista: los notificadores dejan de sonar al instante
      toast.success(nuevo ? "Chat silenciado" : "Notificaciones activadas");
      await aplicarEstado(g.id, { silenciado: nuevo });
      // Refrescar el set en los notificadores SOLO después de que el PATCH se guardó, para
      // que el GET /silenciados traiga datos frescos y no pise la actualización optimista.
      window.dispatchEvent(new Event("chat:muted:changed"));
    } else if (action === "toggle-ocultar") {
      const nuevo = !g.oculto;
      aplicarEstado(g.id, { oculto: nuevo });
      toast.success(nuevo ? "Chat archivado" : "Chat desarchivado");
    } else if (action === "ver-perfil") {
      if (g.tipo === "directo" && g.otro_usuario?.id) router.push(`/equipo/${g.otro_usuario.id}`);
      else { onSelect(g.id); toast("Abre el ⋯ del encabezado para ver archivos y detalles.", { duration: 3500 }); }
    } else if (action === "recordar") {
      const at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
      aplicarEstado(g.id, { recordar_at: at });
      toast.success("Te recordaremos este chat en 1 hora");
    } else if (action === "quitar-recordar") {
      aplicarEstado(g.id, { recordar_at: null });
      toast.success("Recordatorio quitado");
    }
  };

  useEffect(() => {
    if (!q.trim()) { setSearch(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        setSearch({ grupos: d.grupos || [], users: d.users || [] });
      } catch {} finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Fila de un chat (reutilizada en el panel principal y en el de archivados).
  const renderChatRow = (g: ChatListItem) => {
    const isActive = g.id === activeId;
    const rowMenuOpen = ctx?.grupo.id === g.id; // menú de opciones abierto en esta fila
    const isDM = g.tipo === "directo";
    const fotoUrl = isDM ? g.otro_usuario?.foto_perfil_url : g.avatar_url;
    const online = isDM && (presence.isOnline(g.otro_usuario?.id || "") || g.otro_usuario?.online);
    const typingMap = typingByGroup?.[g.id] || {};
    const typingNames = Object.values(typingMap);
    const isTyping = typingNames.length > 0;
    const typingText = isTyping
      ? (isDM
          ? "escribiendo"
          : (typingNames.length === 1
              ? `${typingNames[0]} está escribiendo`
              : `${typingNames[0]} +${typingNames.length - 1} están escribiendo`))
      : null;
    return (
      <div
        key={g.id}
        className="relative group"
        onContextMenu={(e) => { e.preventDefault(); setCtx({ grupo: g, x: e.clientX, y: e.clientY }); }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(g.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.id); } }}
          className={cn(
            "w-full px-3 py-3 flex items-center gap-3 text-left border-l-[3px] glass-sidebar-item cursor-pointer",
            isActive ? "glass-sidebar-item-active"
              : g.fijado ? "bg-amber-500/[0.06] border-transparent"
              : "border-transparent"
          )}
        >
          <div className="relative flex-shrink-0">
            {g.tipo === "copilot" ? (
              <CoPilotAvatar size={48} />
            ) : (
              <div className={cn(
                "h-12 w-12 rounded-full overflow-hidden flex items-center justify-center text-white font-display font-bold text-sm bg-gradient-to-br",
                groupAvatarGradient(g)
              )}>
                {fotoUrl ? (
                  <img src={fotoUrl} alt={g.nombre} className="h-full w-full object-cover" />
                ) : isDM ? initialsOf(g.nombre)
                  : g.tipo === "canal" ? <Megaphone className="h-5 w-5" />
                  : <Hash className="h-5 w-5" />}
              </div>
            )}
            {online && (
              <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-400 border-2 border-bg-light dark:border-bg-dark" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {g.recordar_at && <Clock className="h-3 w-3 text-sky-500 shrink-0" strokeWidth={2.5} />}
              <div className="font-semibold text-sm truncate flex-1">{g.nombre}</div>
            </div>
            <div className="flex items-center gap-2">
              {isTyping ? (
                <div className="text-xs italic text-brand-orange font-semibold truncate flex items-center gap-1.5 min-w-0 typing-text">
                  <span className="truncate">{typingText}</span>
                  <TypingDots size="sm" />
                </div>
              ) : (
                <div className="text-xs text-neutral-500 truncate flex-1">{formatPreview(g.ultimo_mensaje)}</div>
              )}
            </div>
          </div>

          {/* Meta derecha (hora + silenciado/fijado + contador). Se desliza a la izquierda
              al hacer hover para dejar espacio al chevron. */}
          <div className={cn(
            "flex flex-col items-end gap-1 shrink-0 transition-transform duration-200 group-hover:-translate-x-6",
            rowMenuOpen && "-translate-x-6"
          )}>
            <div className="text-[10px] text-neutral-400">{formatTime(g.ultimo_mensaje_at)}</div>
            <div className="flex items-center gap-1">
              {g.silenciado && <BellOff className="h-3.5 w-3.5 text-neutral-400 shrink-0" strokeWidth={2.2} />}
              {g.fijado && <Pin className="h-3.5 w-3.5 text-amber-500 shrink-0" strokeWidth={2.5} />}
              {g.unread_count > 0 && (
                <div className={cn(
                  "h-5 min-w-[20px] px-1.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-1 ring-white/30",
                  g.silenciado
                    ? "bg-neutral-400 dark:bg-neutral-500"
                    : "bg-gradient-to-br from-brand-orange to-neon-magenta shadow-[0_4px_12px_rgba(255,82,160,0.35)]"
                )}>
                  {g.unread_count > 99 ? "99+" : g.unread_count}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chevron que aparece al hover (estilo WhatsApp): abre el menú de opciones. */}
        <button
          type="button"
          data-chat-menu-trigger
          onClick={(e) => {
            e.stopPropagation();
            if (rowMenuOpen) { setCtx(null); return; } // toggle: ya abierto en esta fila → cerrar
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setCtx({ grupo: g, x: r.right - 4, y: r.bottom + 4 });
          }}
          title="Opciones"
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-white/85 dark:bg-white/10 backdrop-blur flex items-center justify-center shadow-sm transition-all duration-200 hover:bg-white dark:hover:bg-white/20 hover:text-brand-orange",
            rowMenuOpen
              ? "opacity-100 translate-x-0 text-brand-orange" // fijo y visible mientras el menú está abierto
              : "opacity-0 translate-x-1 text-neutral-500 dark:text-neutral-300 group-hover:opacity-100 group-hover:translate-x-0"
          )}
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    );
  };

  return (
    <aside className="relative w-80 flex-shrink-0 glass-sidebar flex flex-col h-full">
      <div className="p-3 border-b border-white/30 dark:border-white/5 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 h-10 px-3 rounded-xl glass-input">
          <Search className="h-4 w-4 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar contacto o chat..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </div>
        <button
          data-chat-newmenu-trigger
          onClick={() => setMenuOpen((v) => !v)}
          title="Nuevo"
          className={cn(
            "h-10 w-10 rounded-xl bg-gradient-to-br from-brand-orange to-neon-magenta text-white flex items-center justify-center shadow transition active:scale-95",
            menuOpen ? "scale-105 ring-4 ring-brand-orange/25" : "hover:scale-105"
          )}
        >
          <Plus className={cn("h-4 w-4 transition-transform", menuOpen && "rotate-45")} strokeWidth={2.5} />
        </button>
      </div>
      <NewChatMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPick={(a) => onNewChatAction(a)}
        onStartDM={onStartDM}
      />

      {/* Paneles: principal (tabs + chats) y archivados (con flecha de regreso), con transición. */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <AnimatePresence initial={false}>
          {vista === "principal" ? (
            <motion.div
              key="principal"
              className="absolute inset-0 flex flex-col"
              initial={{ x: "-22%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-22%", opacity: 0 }}
              transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
            >
              {/* Tabs Equipo / Tareas */}
              <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-black/5 dark:border-white/5 shrink-0">
                <button
                  onClick={() => setTab("equipo")}
                  className={cn(
                    "flex-1 h-8 px-2 rounded-lg text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5",
                    tab === "equipo"
                      ? "bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow"
                      : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/5"
                  )}
                >
                  Equipo
                  {counts.equipo > 0 && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                      tab === "equipo" ? "bg-white/25 text-white" : "bg-neutral-200 dark:bg-white/10 text-neutral-600 dark:text-neutral-300"
                    )}>{counts.equipo}</span>
                  )}
                </button>
                <button
                  onClick={() => setTab("tareas")}
                  className={cn(
                    "flex-1 h-8 px-2 rounded-lg text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5",
                    tab === "tareas"
                      ? "bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow"
                      : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/5"
                  )}
                >
                  <Hash className="h-3 w-3" strokeWidth={2.5} />
                  Tareas
                  {counts.tareas > 0 && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                      tab === "tareas" ? "bg-white/25 text-white" : "bg-neutral-200 dark:bg-white/10 text-neutral-600 dark:text-neutral-300"
                    )}>{counts.tareas}</span>
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {/* Fila "Archivados" (WhatsApp-style): abre el panel de archivados. */}
                {archivadosCount > 0 && !q.trim() && (
                  <button
                    onClick={() => setVista("archivados")}
                    className="w-full px-3 py-3 flex items-center gap-3 text-left glass-sidebar-item border-l-[3px] border-transparent cursor-pointer"
                  >
                    <div className="h-12 w-12 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-500 dark:text-neutral-300 flex items-center justify-center shrink-0">
                      <ArchiveDownIcon className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">Archivados</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-neutral-400">
                      <span className="text-[11px] font-semibold">{archivadosCount}</span>
                      <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
                    </div>
                  </button>
                )}

                {filteredChats.map(renderChatRow)}

                {/* Search users section */}
                {q.trim() && (
                  <>
                    {loading && (
                      <div className="px-3 py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-brand-orange" /></div>
                    )}
                    {search && search.users.length > 0 && (
                      <div>
                        <div className="px-4 py-2 text-[10px] font-ui uppercase tracking-[0.15em] text-neutral-400 border-t border-black/5 dark:border-white/5 mt-1">
                          Iniciar chat con...
                        </div>
                        {search.users.map((u: any) => (
                          <button
                            key={u.id}
                            onClick={() => onStartDM(u.id)}
                            className="w-full px-3 py-3 flex items-center gap-3 text-left glass-sidebar-item border-l-[3px] border-transparent"
                          >
                            <div className="relative flex-shrink-0">
                              <div className="h-11 w-11 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-bold text-xs">
                                {u.foto_perfil_url ? (
                                  <img src={u.foto_perfil_url} alt={u.nombre} className="h-full w-full object-cover" />
                                ) : initialsOf(u.nombre)}
                              </div>
                              {presence.isOnline(u.id) && (
                                <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-400 border-2 border-bg-light dark:border-bg-dark" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm truncate flex items-center gap-1">
                                <UserPlus className="h-3 w-3 text-brand-orange flex-shrink-0" />
                                {u.nombre}
                              </div>
                              <div className="text-xs text-neutral-500 truncate">
                                {(u.posiciones || [])[0] || u.departamento || u.email}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {search && search.users.length === 0 && filteredChats.length === 0 && !loading && (
                      <div className="p-6 text-center text-xs text-neutral-400">Sin resultados para «{q}»</div>
                    )}
                  </>
                )}

                {!q.trim() && filteredChats.length === 0 && (
                  <div className="p-6 text-center text-xs text-neutral-400">Sin conversaciones. Inicia una con el botón +</div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="archivados"
              className="absolute inset-0 flex flex-col"
              initial={{ x: "22%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "22%", opacity: 0 }}
              transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
            >
              {/* Header con flecha de regreso */}
              <div className="flex items-center gap-2 px-2 py-2 border-b border-black/5 dark:border-white/5 shrink-0">
                <button
                  onClick={() => setVista("principal")}
                  title="Volver"
                  className="h-9 w-9 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition"
                >
                  <ArrowLeft className="h-5 w-5" strokeWidth={2} />
                </button>
                <div className="flex items-center gap-2 font-display font-bold text-sm">
                  <ArchiveDownIcon className="h-4 w-4 text-neutral-500" strokeWidth={2} />
                  Archivados
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {archivadosTab.length === 0 ? (
                  <div className="p-6 text-center text-xs text-neutral-400">No hay chats archivados</div>
                ) : (
                  archivadosTab.map(renderChatRow)
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ChatContextMenu
        open={!!ctx}
        x={ctx?.x || 0}
        y={ctx?.y || 0}
        fijado={!!ctx?.grupo.fijado}
        silenciado={!!ctx?.grupo.silenciado}
        oculto={!!ctx?.grupo.oculto}
        recordando={!!ctx?.grupo.recordar_at}
        tipo={ctx?.grupo.tipo || ""}
        onPick={onCtxPick}
        onClose={() => setCtx(null)}
      />
    </aside>
  );
}
