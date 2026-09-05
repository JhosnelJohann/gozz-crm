"use client";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useSpring, useMotionValue } from "framer-motion";
import { Sparkles, X, Download, ZoomIn, ZoomOut, Maximize2, RotateCcw, PhoneMissed, PhoneOff, Phone, Video, Clock as ClockIcon, ChevronDown, ChevronUp, FileText, CheckSquare, MessageSquare, Target, CheckCheck, Circle, CircleCheck, Forward, Trash2, Trophy, Heart, PartyPopper } from "@/lib/bootstrap-icons";
import { initialsOf } from "@/lib/auth-user";
import { cn } from "@/lib/utils";
import { MessageStatus, type Status } from "./MessageStatus";
import { AudioMessage } from "./AudioMessage";
import { FileMessage } from "./FileMessage";
import { FilePreviewModal } from "@/components/drive/DriveBrowser";
import { archivosDeLaConversacion, esMensajeDeArchivo, posicionDeArchivo, vecinoDeArchivo } from "@/lib/chat-archivos";
import { CoPilotMessage, CoPilotAvatar, CoPilotThinking, type CoPilotThinkingKind } from "./CoPilotMessage";
import { MessageActions, type MessageActionsHandle } from "./MessageActions";
import { TypingBubble } from "./TypingIndicator";
import { toast } from "sonner";

export interface ChatMensaje {
  id: string;
  grupo_id: string;
  user_id: string;
  user_nombre?: string;
  foto_perfil_url?: string | null;
  tipo: string;
  contenido: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  archivo_tipo?: string | null;
  created_at: string;
  entregado_por?: string[];
  leido_por?: string[];
  reacciones?: Record<string, string[]>;
  reply_to_id?: string | null;
  link_preview?: { url: string; title?: string | null; description?: string | null; image?: string | null; site?: string | null } | null;
  editado?: boolean;
  eliminado?: boolean;
  reenviado_de?: string | null;
  menciones?: { id: string; nombre: string }[];
}

interface Props {
  mensajes: ChatMensaje[];
  meId: string;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  copilotThinking?: { grupoId: string; kind: CoPilotThinkingKind; startedAt: number } | null;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onStartSelect?: (id: string) => void;
  onReply?: (m: ChatMensaje) => void;
  onForward?: (m: ChatMensaje) => void;
  onAskCopilot?: (m: ChatMensaje) => void;
  onCreateTask?: (m: ChatMensaje) => void;
  // Ids de los mensajes fijados del chat (para marcar el item del menu como "Desfijar").
  pinnedIds?: string[];
  // Usuarios que están escribiendo AHORA en este chat (mantenido por page.tsx
  // con auto-expiración a 3.5s). Render: burbuja con 3 dots animados al final.
  typing?: Array<{ userId: string; nombre: string }>;
  // Para chats grupales, incluir "Visto por mí" en el visto del último mensaje
  // recibido (si soy el primer/único lector). En DMs sigue oculto porque es
  // redundante (ya hay checks azules y solo hay 2 personas).
  isGroup?: boolean;
  // Salto robusto provisto por page.tsx: si el mensaje destino es viejo y no está
  // cargado, lo trae con ?around= y luego salta. Si no se pasa, cae al lookup local.
  onJumpToMessage?: (id: string) => void;
  // Id a resaltar controlado por page.tsx (para el salto del banner de fijados).
  externalHighlightId?: string | null;
}

function sameDay(a: string, b: string) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
function dateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const s = d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function DateSeparator({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center my-3 select-none">
      <span className="px-3 py-1 rounded-full bg-black/15 dark:bg-white/10 backdrop-blur-sm text-[11px] font-ui font-semibold text-white/90 dark:text-white/70 shadow-sm">
        {dateLabel(iso)}
      </span>
    </div>
  );
}

function deriveStatus(m: ChatMensaje): Status {
  const leido = (m.leido_por || []).filter((id) => id !== m.user_id);
  if (leido.length > 0) return "read";
  const entregado = (m.entregado_por || []).filter((id) => id !== m.user_id);
  if (entregado.length > 0) return "delivered";
  return "sent";
}

const IMAGES_IN_MSGS = (msgs: ChatMensaje[]) => msgs.filter((m) => m.tipo === "imagen" && m.archivo_url);

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function Linkified({ text, menciones }: { text: string; menciones?: { id: string; nombre: string }[] }) {
  // Nombres a resaltar como mencion (incluye "todos" para @todos)
  const names = Array.from(new Set((menciones || []).map((m) => m.nombre).filter(Boolean))).sort((a, b) => b.length - a.length);
  const mentionSrc = names.length ? "@(?:" + names.map(escapeRe).join("|") + ")" : null;
  const re = new RegExp("(https?:\\/\\/[^\\s]+" + (mentionSrc ? "|" + mentionSrc : "") + ")", "g");
  const parts = text.split(re);
  return (
    <span className="whitespace-pre-wrap break-words cursor-text select-text">
      {parts.map((p, i) => {
        if (!p) return null;
        if (/^https?:\/\//.test(p)) {
          return <a key={i} href={p} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand-blue underline decoration-brand-blue/40 hover:decoration-brand-blue break-all">{p}</a>;
        }
        if (mentionSrc && p.startsWith("@") && names.includes(p.slice(1))) {
          return <span key={i} className="font-bold text-brand-blue bg-brand-blue/10 rounded px-1 py-0.5">{p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

function TinyAvatar({ p, size = 16 }: { p?: { nombre: string; foto: string | null }; size?: number }) {
  return (
    <span style={{ height: size, width: size }} className="rounded-full overflow-hidden border border-white dark:border-neutral-800 bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-[7px] font-bold flex items-center justify-center shrink-0">
      {p?.foto ? <img src={p.foto} alt="" className="h-full w-full object-cover" /> : <span>{initialsOf(p?.nombre || "?")}</span>}
    </span>
  );
}

export function ChatMessages({ mensajes, meId, hasMore = false, loadingOlder = false, onLoadOlder, copilotThinking, selectMode = false, selectedIds, onToggleSelect, onStartSelect, onReply, onForward, onAskCopilot, onCreateTask, pinnedIds = [], typing, isGroup = false, onJumpToMessage, externalHighlightId = null }: Props) {
  const isSelected = (id: string) => !!selectedIds && selectedIds.has(id);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Refs para distinguir prepend (scroll-up) de append (mensaje nuevo) y preservar la posicion.
  const prevFirstIdRef = useRef<string | undefined>(undefined);
  const prevLastIdRef = useRef<string | undefined>(undefined);
  const prevLenRef = useRef(0);
  const prevGrupoRef = useRef<string | undefined>(undefined);
  const anchorHeightRef = useRef(0);
  const anchorTopRef = useRef(0);
  const actionRefs = useRef<Record<string, MessageActionsHandle | null>>({});  // menú por mensaje (click derecho)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [usuariosById, setUsuariosById] = useState<Record<string, { nombre: string; foto: string | null }>>({});
  const zoomSpring = useSpring(1, { stiffness: 280, damping: 28 });
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const imageMsgs = useMemo(() => IMAGES_IN_MSGS(mensajes), [mensajes]);
  const lightbox = lightboxIdx !== null ? imageMsgs[lightboxIdx] : null;

  // ════════════════════════════════════════════════════════════════════════════════════════
  // EL VISOR DE ARCHIVOS VIVE AQUI, NO DENTRO DE CADA MENSAJE
  // ════════════════════════════════════════════════════════════════════════════════════════
  // `FileMessage` montaba un visor propio, y por eso no habia flechas: un mensaje no sabe que
  // otros archivos hay en la conversacion. Se adjuntaban seis documentos, se abria uno, y para
  // ver el siguiente habia que cerrar y buscarlo a mano. Es lo mismo que ya se hacia con las
  // imagenes justo aqui arriba; lo que no es imagen se habia quedado sin su equivalente.
  //
  // 🔴 Se guarda el ID, no el indice. Es chat en vivo: si llega o se borra un mensaje mientras el
  // visor esta abierto, un indice guardado apunta de pronto a otro archivo y te lo cambia bajo el
  // cursor. Si el archivo abierto desaparece, `archivoAbierto` se queda en null y el visor se
  // cierra solo, que es lo honesto.
  const [visorId, setVisorId] = useState<string | null>(null);
  const archivoMsgs = useMemo(() => archivosDeLaConversacion(mensajes), [mensajes]);
  const archivoAbierto = visorId ? archivoMsgs.find((m) => m.id === visorId) ?? null : null;
  const posVisor = posicionDeArchivo(archivoMsgs, visorId);
  const irAArchivo = (paso: number) => setVisorId((id) => vecinoDeArchivo(archivoMsgs, id, paso) ?? id);
  const react = (m: ChatMensaje, emoji: string) => {
    fetch(`/api/chat/grupos/${m.grupo_id}/mensajes/${m.id}/reaccion`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
    }).catch(() => {});
  };
  // Fijar (o desfijar si ya esta fijado este mensaje) en el chat. Maximo 5 (lo valida el server).
  const togglePin = async (m: ChatMensaje) => {
    const estaba = pinnedIds.includes(m.id);
    const r = await fetch(`/api/chat/grupos/${m.grupo_id}/fijar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mensaje_id: m.id }),
    }).catch(() => null);
    if (!r || !r.ok) {
      let msg = "No se pudo fijar el mensaje";
      try { const d = await r?.json(); if (d?.error) msg = d.error; } catch {}
      toast.error(msg);
      return;
    }
    toast.success(estaba ? "Mensaje desfijado" : "Mensaje fijado");
  };

  // Editar / eliminar / copiar
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Saltar al mensaje original al clickear la cita de una respuesta
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const goToMessage = (id: string) => {
    // Si page.tsx provee el salto robusto (trae el mensaje si es viejo), usarlo.
    if (onJumpToMessage) { onJumpToMessage(id); return; }
    const el = typeof document !== "undefined" ? document.getElementById(`msg-${id}`) : null;
    if (!el) { toast("Ese mensaje no esta cargado (es muy antiguo)"); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
  };
  const startEdit = (m: ChatMensaje) => { setEditingId(m.id); setEditText(m.contenido || ""); };
  const saveEdit = async (m: ChatMensaje) => {
    const txt = editText.trim();
    if (!txt) return;
    setEditingId(null);
    const r = await fetch(`/api/chat/grupos/${m.grupo_id}/mensajes/${m.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido: txt }),
    }).catch(() => null);
    if (!r || !r.ok) toast.error("No se pudo editar");
  };
  const deleteMsg = async (m: ChatMensaje) => {
    if (typeof window !== "undefined" && !window.confirm("¿Eliminar este mensaje?")) return;
    const r = await fetch(`/api/chat/grupos/${m.grupo_id}/mensajes/${m.id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) toast.error("No se pudo eliminar");
  };
  const copyMsg = (m: ChatMensaje) => {
    navigator.clipboard?.writeText(m.contenido || "").then(() => toast.success("Copiado")).catch(() => {});
  };
  const grupoId = mensajes.find((m) => m.grupo_id)?.grupo_id;
  useEffect(() => {
    if (!grupoId) return;
    fetch(`/api/chat/grupos/${grupoId}/miembros`).then((r) => r.json()).then((d) => {
      const map: Record<string, { nombre: string; foto: string | null }> = {};
      (d.miembros || []).forEach((u: any) => { if (u && u.id) map[u.id] = { nombre: u.nombre, foto: u.foto_perfil_url || null }; });
      setUsuariosById(map);
    }).catch(() => {});
  }, [grupoId]);

  const openLightbox = (id: string) => {
    const idx = imageMsgs.findIndex((m) => m.id === id);
    if (idx >= 0) setLightboxIdx(idx);
  };
  const close = () => setLightboxIdx(null);
  const prev = () => { if (lightboxIdx === null) return; setLightboxIdx((i) => (i! > 0 ? i! - 1 : imageMsgs.length - 1)); };
  const next = () => { if (lightboxIdx === null) return; setLightboxIdx((i) => (i! < imageMsgs.length - 1 ? i! + 1 : 0)); };
  const setZoom = (z: number) => zoomSpring.set(Math.min(5, Math.max(0.4, z)));
  const resetView = () => { zoomSpring.set(1); x.set(0); y.set(0); };

  // Scroll cerca del tope => traer mensajes anteriores (estilo WhatsApp).
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 120 && hasMore && !loadingOlder && onLoadOlder) {
      // Guardar alto/posicion actuales para restaurar el viewport tras prepender el historial.
      anchorHeightRef.current = el.scrollHeight;
      anchorTopRef.current = el.scrollTop;
      onLoadOlder();
    }
  };

  // Auto-scroll inteligente: al cambiar de chat baja al fondo; con mensaje nuevo baja solo si
  // ya estabas cerca del fondo (o lo enviaste tu); en scroll-up (prepend) preserva la posicion.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = mensajes[0]?.id;
    const lastId = mensajes[mensajes.length - 1]?.id;
    const grupoChanged = grupoId !== prevGrupoRef.current;
    const isPrepend =
      !grupoChanged &&
      !!prevFirstIdRef.current &&
      firstId !== prevFirstIdRef.current &&
      mensajes.length > prevLenRef.current &&
      mensajes.some((m) => m.id === prevFirstIdRef.current);

    if (grupoChanged) {
      endRef.current?.scrollIntoView({ behavior: "auto" });
    } else if (isPrepend) {
      el.scrollTop = el.scrollHeight - anchorHeightRef.current + anchorTopRef.current;
    } else if (lastId && lastId !== prevLastIdRef.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      const mineJustSent = mensajes[mensajes.length - 1]?.user_id === meId;
      if (nearBottom || mineJustSent) endRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevLenRef.current = mensajes.length;
    prevGrupoRef.current = grupoId;
  }, [mensajes, grupoId, meId]);

  // El indicador "CoPilot escribiendo" tambien empuja la vista al fondo.
  useEffect(() => {
    if (copilotThinking) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [copilotThinking?.startedAt]);

  // Cuando alguien empieza a escribir, asomar la burbuja "escribiendo" para que
  // no quede tapada por el composer. Solo si el usuario ya estaba cerca del fondo
  // (no le rompemos el scroll si está leyendo arriba).
  const typingCount = typing?.filter((u) => u.userId !== meId).length || 0;
  useEffect(() => {
    if (typingCount === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 220;
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [typingCount, meId]);

  useEffect(() => {
    if (lightboxIdx === null) return;
    resetView();
    setImageLoaded(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "+" || e.key === "=") setZoom(zoomSpring.get() + 0.25);
      else if (e.key === "-" || e.key === "_") setZoom(zoomSpring.get() - 0.25);
      else if (e.key === "0") resetView();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIdx]);

  return (
    <div ref={scrollRef} onScroll={handleScroll} data-lenis-prevent className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin chat-bg px-5 py-4 space-y-1.5">
      {loadingOlder && (
        <div className="flex justify-center py-2">
          <div className="h-5 w-5 rounded-full border-2 border-neutral-300 border-t-brand-orange animate-spin" />
        </div>
      )}
      {mensajes.map((m, i) => {
        const isMe = m.user_id === meId;
        const prev = mensajes[i - 1];
        const showMeta = !prev || prev.user_id !== m.user_id;
        const status = isMe ? deriveStatus(m) : null;
        const replied = m.reply_to_id ? mensajes.find((x) => x.id === m.reply_to_id) : null;
        const dayChanged = !prev || !sameDay(prev.created_at, m.created_at);
        const isLast = i === mensajes.length - 1;

        // Mensaje sistema: llamada perdida / resumen
        if (m.tipo === "sistema" && m.contenido && m.contenido.startsWith("{")) {
          try {
            const parsed = JSON.parse(m.contenido);
            if (parsed._t === "call_missed") {
              return <CallMissedPill key={m.id} payload={parsed} meId={meId} createdAt={m.created_at} />;
            }
            if (parsed._t === "call_summary") {
              return <CallSummaryCard key={m.id} payload={parsed} createdAt={m.created_at} />;
            }
            if (parsed._t === "recognition") {
              return <RecognitionCard key={m.id} payload={parsed} createdAt={m.created_at} />;
            }
          } catch {}
        }

        // Mensaje de sistema de texto (ej: "X fijo un mensaje", cambios de estado): pildora centrada.
        if (m.tipo === "sistema" && m.contenido && !m.contenido.startsWith("{")) {
          return (
            <div key={m.id} className="flex justify-center my-2 px-4 select-none">
              <span className="max-w-[90%] px-3 py-1 rounded-full bg-black/10 dark:bg-white/10 backdrop-blur-sm text-[11.5px] font-ui font-medium text-neutral-700 dark:text-white/75 shadow-sm text-center break-words">
                {m.contenido}
              </span>
            </div>
          );
        }

        const isCopilot = !m.user_id && m.tipo !== "sistema";

        // Render especial para mensaje de CoPilot con markdown completo
        if (isCopilot) {
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2.5 max-w-[88%] justify-start"
            >
              <div className={cn("self-start pt-1", !showMeta && "opacity-0")}>
                <CoPilotAvatar size={32} />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                {showMeta && (
                  <div className="text-[10px] font-ui mb-1 px-1 flex items-center gap-1.5">
                    <span className="bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600 bg-clip-text text-transparent font-bold uppercase tracking-wider">CoPilot</span>
                    <span className="text-[9px] font-ui font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/15 px-1.5 rounded-full border border-violet-200/50 dark:border-violet-500/20">
                      IA · Claude
                    </span>
                  </div>
                )}
                <CoPilotMessage contenido={m.contenido || ""} createdAt={m.created_at} />
              </div>
            </motion.div>
          );
        }

        return (
          <Fragment key={m.id}>
            {dayChanged && <DateSeparator iso={m.created_at} />}
          <div
            className={cn("flex items-center gap-2 transition-colors", selectMode && "cursor-pointer rounded-2xl -mx-2 px-2 py-0.5", selectMode && isSelected(m.id) && "bg-brand-orange/10")}
            onClick={selectMode ? () => onToggleSelect?.(m.id) : undefined}
          >
            {selectMode && (
              <span className="shrink-0">
                {isSelected(m.id)
                  ? <CircleCheck className="h-5 w-5 text-brand-orange" strokeWidth={2} />
                  : <Circle className="h-5 w-5 text-neutral-300 dark:text-white/30" strokeWidth={2} />}
              </span>
            )}
            <div className="flex-1 min-w-0">
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "flex gap-2 max-w-[78%]",
              isMe ? "ml-auto justify-end flex-row-reverse" : "justify-start"
            )}
          >
            {!isMe && (
              <div className={cn(
                "h-8 w-8 flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-[10px] self-end bg-gradient-to-br from-brand-orange to-neon-magenta",
                !showMeta && "opacity-0"
              )}>
                {m.foto_perfil_url ? <img src={m.foto_perfil_url} alt={m.user_nombre || ""} className="h-full w-full object-cover" />
                  : initialsOf(m.user_nombre || "")}
              </div>
            )}
            <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
              {showMeta && !isMe && (
                <div className="text-[10px] font-ui mb-0.5 px-2 text-neutral-600 dark:text-white/60">
                  {m.user_nombre}
                </div>
              )}
              <div
                id={`msg-${m.id}`}
                onContextMenu={(e) => {
                  if (selectMode || m.eliminado || editingId === m.id) return;
                  // Si hay texto seleccionado, dejar el menu nativo del navegador (Copiar seleccion)
                  const sel = typeof window !== "undefined" ? window.getSelection() : null;
                  if (sel && !sel.isCollapsed && sel.toString().trim()) return;
                  e.preventDefault();
                  actionRefs.current[m.id]?.openMenuAt(e.clientX, e.clientY);
                }}
                className={cn(
                  "group relative px-3.5 py-2 rounded-2xl text-[15px] leading-snug break-words transition-shadow select-text selection-doc",
                  selectMode && "pointer-events-none",
                  (highlightId === m.id || externalHighlightId === m.id) && "ring-2 ring-brand-orange ring-offset-2 ring-offset-transparent",
                  isMe
                    ? "glass-bubble-me rounded-br-[6px]"
                    : "glass-bubble-other rounded-bl-[6px]"
                )}
              >
                {m.eliminado ? (
                  <span className="inline-flex items-center gap-1.5 italic text-neutral-400 dark:text-white/40 text-[13px]"><Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />Este mensaje ha sido eliminado.</span>
                ) : editingId === m.id ? (
                  <div className="flex flex-col gap-1.5 min-w-[220px]">
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(m); } if (e.key === "Escape") setEditingId(null); }}
                      rows={2}
                      className="w-full bg-white/70 dark:bg-black/20 rounded-lg px-2 py-1.5 text-sm outline-none resize-none border border-brand-orange/50 focus:ring-2 focus:ring-brand-orange/25"
                    />
                    <div className="flex items-center gap-3 justify-end">
                      <button type="button" onClick={() => setEditingId(null)} className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-700 dark:hover:text-white">Cancelar</button>
                      <button type="button" onClick={() => saveEdit(m)} className="text-[11px] font-ui font-bold uppercase tracking-wider text-brand-orange hover:text-brand-gold">Guardar</button>
                    </div>
                  </div>
                ) : (<>
                {m.reenviado_de && (
                  <div className="flex items-center gap-1 mb-1 text-[11px] font-bold text-brand-blue">
                    <Forward className="h-3 w-3 shrink-0" strokeWidth={2.2} /> Reenviado desde {m.reenviado_de}
                  </div>
                )}
                {replied && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); goToMessage(replied.id); }}
                    className="mb-1 w-full text-left px-2 py-1 rounded-md border-l-[3px] border-brand-orange/70 bg-black/5 dark:bg-white/10 text-[11px] leading-tight max-w-full overflow-hidden hover:bg-black/10 dark:hover:bg-white/15 transition cursor-pointer">
                    <div className="font-bold text-brand-orange truncate">{replied.user_nombre || "Mensaje"}</div>
                    <div className="line-clamp-3 break-words opacity-70">{replied.contenido || (replied.archivo_nombre ? "[archivo] " + replied.archivo_nombre : "Mensaje")}</div>
                  </button>
                )}
                {m.tipo !== "audio" && m.contenido && <Linkified text={m.contenido} menciones={m.menciones} />}
                {m.link_preview && (
                  <a href={m.link_preview.url} target="_blank" rel="noopener noreferrer" className={cn(
                    "mt-1.5 block rounded-lg overflow-hidden border transition max-w-[300px] no-underline",
                    isMe
                      ? "border-white/35 bg-white/15 hover:bg-white/25"
                      : "border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  )}>
                    {m.link_preview.image && (
                      <img src={m.link_preview.image} alt="" loading="lazy" className="w-full max-h-40 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <div className={cn(
                      "px-2.5 py-1.5 border-l-[3px]",
                      isMe ? "border-white/65" : "border-brand-orange"
                    )}>
                      {m.link_preview.site && <div className={cn(
                        "text-[10px] uppercase tracking-wide truncate",
                        isMe ? "text-white/85" : "text-neutral-400"
                      )}>{m.link_preview.site}</div>}
                      <div className={cn(
                        "text-[12px] font-bold line-clamp-2 break-words",
                        isMe ? "text-white" : "text-brand-orange"
                      )}>{m.link_preview.title}</div>
                      {m.link_preview.description && <div className={cn(
                        "text-[11px] line-clamp-2 break-words mt-0.5",
                        isMe ? "text-white/85" : "text-neutral-500 dark:text-white/60"
                      )}>{m.link_preview.description}</div>}
                    </div>
                  </a>
                )}
                {m.archivo_url && m.tipo === "imagen" && (
                  <button
                    type="button"
                    onClick={() => openLightbox(m.id)}
                    className="mt-2 block rounded-xl overflow-hidden max-w-xs group relative focus:outline-none focus:ring-2 focus:ring-brand-orange shadow-md hover:shadow-xl transition-shadow"
                  >
                    <motion.img
                      src={m.archivo_url}
                      alt={m.archivo_nombre || ""}
                      className="w-full h-auto"
                      whileHover={{ scale: 1.03 }}
                      transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition duration-300 flex items-end justify-end p-2">
                      <div className="h-9 w-9 rounded-full bg-white/90 backdrop-blur-md text-slate-800 flex items-center justify-center shadow-lg">
                        <Maximize2 className="h-4 w-4" strokeWidth={2.5} />
                      </div>
                    </div>
                  </button>
                )}
                {m.archivo_url && m.tipo === "video" && (
                  <video src={m.archivo_url} controls preload="metadata" className="mt-2 rounded-lg max-w-xs bg-black/10" />
                )}
                {m.archivo_url && m.tipo === "audio" && (
                  <>
                    <AudioMessage url={m.archivo_url} filename={m.archivo_nombre} mime={m.archivo_tipo} isMe={isMe} />
                    {m.contenido && (
                      <div className={cn(
                        "mt-1.5 px-2 py-1 rounded-lg text-[11.5px] italic leading-snug font-ui border",
                        isMe
                          ? "bg-white/10 text-neutral-700/90 dark:text-white/75 border-white/15"
                          : "bg-neutral-50 text-neutral-700 dark:bg-white/5 dark:text-white/75 border-neutral-200/60 dark:border-white/10"
                      )}>
                        <span className="text-[9px] not-italic font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 mr-1.5">Transcripción</span>
                        {m.contenido}
                      </div>
                    )}
                  </>
                )}
                {/* El predicado sale de `lib/chat-archivos.ts`, el MISMO que arma la lista que
                    recorren las flechas. Si fueran dos, el «2 / 6» mentiria y la flecha llevaria a
                    un archivo distinto del que se ve al lado (CONVENCIONES §4.8). */}
                {esMensajeDeArchivo(m) && (
                  <FileMessage
                    url={m.archivo_url}
                    filename={m.archivo_nombre}
                    mime={m.archivo_tipo || null}
                    size={(m as any).archivo_tamanio || null}
                    isMe={isMe}
                    onVer={() => setVisorId(m.id)}
                  />
                )}
                </>)}
                {!m.eliminado && editingId !== m.id && !selectMode && (
                  <MessageActions
                    ref={(h) => { actionRefs.current[m.id] = h; }}
                    isMe={isMe}
                    canEdit={isMe && m.tipo === "texto" && (Date.now() - new Date(m.created_at).getTime() <= 3 * 60 * 1000)}
                    onReact={(emo) => react(m, emo)}
                    onReply={() => onReply?.(m)}
                    onCopy={() => copyMsg(m)}
                    onEdit={() => startEdit(m)}
                    onForward={() => onForward?.(m)}
                    onAskCopilot={() => onAskCopilot?.(m)}
                    onCreateTask={() => onCreateTask?.(m)}
                    onPin={() => togglePin(m)}
                    isPinned={pinnedIds.includes(m.id)}
                    onDelete={() => deleteMsg(m)}
                    onSelect={() => onStartSelect?.(m.id)}
                  />
                )}
                {m.reacciones && Object.keys(m.reacciones).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.entries(m.reacciones).map(([emo, uids]) => {
                      const arr = uids as string[];
                      const mine = arr.includes(meId);
                      const nombres = arr.map((id) => usuariosById[id]?.nombre || "Alguien");
                      return (
                        <button key={emo} type="button" onClick={(e) => { e.stopPropagation(); react(m, emo); }}
                          title={nombres.join(", ")}
                          className={cn("inline-flex items-center gap-1 pl-1.5 pr-1 h-6 rounded-full border transition", mine ? "bg-brand-orange/15 border-brand-orange/40" : "bg-black/5 dark:bg-white/10 border-transparent hover:bg-black/10 dark:hover:bg-white/15")}>
                          <span className="leading-none text-[13px]">{emo}</span>
                          <span className="flex -space-x-1.5">
                            {arr.slice(0, 3).map((id) => <TinyAvatar key={id} p={usuariosById[id]} />)}
                          </span>
                          {arr.length > 3 && <span className="text-[10px] font-bold text-neutral-500 dark:text-white/60 pr-0.5">+{arr.length - 3}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-1 justify-end mt-0.5 -mb-1">
                  {m.editado && !m.eliminado && <span className="text-[9px] italic text-neutral-500 dark:text-white/40">editado</span>}
                  <span className="text-[9px] text-neutral-500 dark:text-white/50">
                    {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {status && <MessageStatus status={status} />}
                  {(isMe || isLast) && (() => {
                    // Aparece en:
                    //  - TODOS mis mensajes propios (isMe): así veo quién leyó cada uno
                    //  - El último mensaje del chat (isLast), aunque sea ajeno
                    // En grupos: incluyo meId si soy lector (pedido del usuario:
                    // "Visto por m\u00ed" cuando soy el primero). En DMs: lo excluyo
                    // (es redundante con los checks azules y solo hay 2 personas).
                    const ids = (m.leido_por || []).filter((id) => {
                      if (id === m.user_id) return false;          // el emisor nunca cuenta como lector
                      if (!isGroup && id === meId) return false;   // DM: ocultar mi propio visto
                      return true;
                    });
                    if (ids.length === 0) return null;
                    // Si yo estoy en la lista, me pongo al inicio \u2192 "Visto por m\u00ed" / "Visto por m\u00ed y X".
                    const meFirst = ids.includes(meId)
                      ? [meId, ...ids.filter((id) => id !== meId)]
                      : ids;
                    const names = meFirst
                      .map((id) => (id === meId ? "m\u00ed" : usuariosById[id]?.nombre))
                      .filter(Boolean) as string[];
                    let txt = `Visto por ${meFirst.length}`;
                    if (names.length === 1) txt = `Visto por ${names[0]}`;
                    else if (names.length === 2) txt = `Visto por ${names[0]} y ${names[1]}`;
                    else if (names.length > 2) txt = `Visto por ${names[0]} y ${names.length - 1} m\u00e1s`;
                    return (
                      <span className="relative group/seen inline-flex items-center gap-0.5 text-[9px] text-neutral-500 dark:text-white/50 cursor-default">
                        {!isMe && <CheckCheck className="h-3 w-3 text-sky-500 shrink-0" strokeWidth={2.5} />}
                        {txt}
                        <span className="hidden group-hover/seen:block absolute bottom-full right-0 mb-1.5 z-30 bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-white/10 p-2 min-w-[170px] text-left">
                          <span className="block text-[9px] font-ui font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 mb-1.5 px-1">Visto por {meFirst.length}</span>
                          {meFirst.map((id) => (
                            <span key={id} className="flex items-center gap-2 px-1 py-0.5">
                              <TinyAvatar p={usuariosById[id]} size={20} />
                              <span className="text-[11px] text-neutral-700 dark:text-white/85 truncate">{id === meId ? "T\u00fa" : (usuariosById[id]?.nombre || "Usuario")}</span>
                            </span>
                          ))}
                        </span>
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          </motion.div>
            </div>
          </div>
          </Fragment>
        );
      })}

      {/* Burbuja "escribiendo" estilo WhatsApp/Messenger al final del chat:
          mini-avatar(es) + 3 dots animados dentro de una glass-bubble.
          Aparece solo si typingByGroup[activeId] tiene entradas (mantenido en
          page.tsx con auto-expiración 3.5s). Excluye el eco propio.
          mt-2/mb-3 le da aire arriba (separación del último mensaje) y abajo
          (no choca con el composer). Enriquece cada typer con su foto desde
          usuariosById (ya cacheado por /miembros del grupo). */}
      {typing && typing.filter((u) => u.userId !== meId).length > 0 && (
        <div className="mt-2 mb-3">
          <TypingBubble
            users={typing
              .filter((u) => u.userId !== meId)
              .map((u) => ({ ...u, foto: usuariosById[u.userId]?.foto ?? null }))}
          />
        </div>
      )}

      <AnimatePresence>
        {copilotThinking && (
          <CoPilotThinking kind={copilotThinking.kind} startedAt={copilotThinking.startedAt} />
        )}
      </AnimatePresence>

      <div ref={endRef} />

      {/* 🔴 EL VISOR, EN LA RAIZ. Aqui es donde se sabe la lista entera, asi que aqui es donde
          puede tener flechas. Las flechas se pasan SIEMPRE, tambien con un solo archivo: el visor
          las desactiva a partir de `posicion`, y esconderlas haria que aparecieran solas en cuanto
          llegara un adjunto nuevo a la conversacion — que es justo lo que su propio codigo
          prohibe, porque mueve los botones bajo el cursor. */}
      {archivoAbierto && (
        <FilePreviewModal
          file={{
            url: archivoAbierto.archivo_url,
            nombre: archivoAbierto.archivo_nombre || "archivo",
            mime: archivoAbierto.archivo_tipo || null,
            size_bytes: (archivoAbierto as any).archivo_tamanio ?? null,
          }}
          onClose={() => setVisorId(null)}
          onPrev={() => irAArchivo(-1)}
          onNext={() => irAArchivo(+1)}
          posicion={posVisor ?? undefined}
        />
      )}

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
            className="fixed inset-0 z-[90] flex flex-col"
          >
            {/* Ambient blurred backdrop usando la imagen */}
            <div
              className="absolute inset-0 bg-black"
              style={{
                backgroundImage: `url(${lightbox.archivo_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(60px) saturate(1.4) brightness(0.45)",
                transform: "scale(1.2)",
              }}
            />
            <div className="absolute inset-0 bg-black/70" />

            {/* Top toolbar */}
            <motion.div
              initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.05 }}
              className="relative z-10 px-5 py-4 flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-ui uppercase tracking-[0.2em] text-white/55">Imagen · {(lightboxIdx ?? 0) + 1} / {imageMsgs.length}</div>
                <div className="text-white font-display font-black truncate">{lightbox.archivo_nombre || "imagen"}</div>
              </div>
              <div className="flex items-center gap-1 rounded-2xl bg-white/8 backdrop-blur-xl border border-white/15 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <button type="button" onClick={() => setZoom(zoomSpring.get() - 0.25)}
                  className="h-9 w-9 rounded-xl hover:bg-white/15 text-white flex items-center justify-center transition" title="Alejar (-)">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <ZoomBadge zoomSpring={zoomSpring} />
                <button type="button" onClick={() => setZoom(zoomSpring.get() + 0.25)}
                  className="h-9 w-9 rounded-xl hover:bg-white/15 text-white flex items-center justify-center transition" title="Acercar (+)">
                  <ZoomIn className="h-4 w-4" />
                </button>
                <div className="w-px h-6 bg-white/15 mx-1" />
                <button type="button" onClick={resetView}
                  className="h-9 w-9 rounded-xl hover:bg-white/15 text-white flex items-center justify-center transition" title="Reset (0)">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
              <a
                href={lightbox.archivo_url || "#"}
                download={lightbox.archivo_nombre || true}
                target="_blank"
                rel="noopener"
                onClick={(e) => e.stopPropagation()}
                className="h-10 px-4 rounded-2xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white font-ui text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[0_8px_24px_rgba(87,80,232,0.45)] hover:scale-[1.03] active:scale-95 transition"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
                Descargar
              </a>
              <button type="button" onClick={close}
                className="h-10 w-10 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/15 text-white flex items-center justify-center transition" title="Cerrar (Esc)">
                <X className="h-5 w-5" />
              </button>
            </motion.div>

            {/* Nav arrows (si hay varias imágenes) */}
            {imageMsgs.length > 1 && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); prev(); }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/15 text-white flex items-center justify-center transition" title="Anterior">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); next(); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/15 text-white flex items-center justify-center transition" title="Siguiente">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                </button>
              </>
            )}

            {/* Imagen pan/zoom */}
            <motion.div
              key={lightbox.id}
              initial={{ scale: 0.9, opacity: 0, y: 24 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="relative z-[5] flex-1 flex items-center justify-center p-6 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={() => { zoomSpring.get() > 1.1 ? resetView() : setZoom(2); }}
              onWheel={(e) => {
                e.stopPropagation();
                setZoom(zoomSpring.get() + (e.deltaY < 0 ? 0.2 : -0.2));
              }}
            >
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/15 flex items-center justify-center">
                    <motion.div
                      className="h-6 w-6 rounded-full border-2 border-white/80 border-t-transparent"
                      animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
                    />
                  </div>
                </div>
              )}
              <motion.img
                src={lightbox.archivo_url || ""}
                alt={lightbox.archivo_nombre || ""}
                onLoad={() => setImageLoaded(true)}
                drag={zoomSpring.get() > 1}
                dragMomentum={false}
                style={{ scale: zoomSpring, x, y }}
                className="max-w-[90vw] max-h-[78vh] object-contain rounded-xl shadow-[0_30px_80px_rgba(0,0,0,0.6)] select-none cursor-zoom-in"
                draggable={false}
              />
            </motion.div>

            {/* Hint footer */}
            <motion.div
              initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }}
              transition={{ delay: 0.2 }}
              className="relative z-10 pb-4 text-center text-[11px] font-ui text-white/50 space-x-3"
            >
              <span>↑↓ zoom · ← → navegar · doble click · Esc cerrar</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ZoomBadge({ zoomSpring }: { zoomSpring: any }) {
  const [val, setVal] = useState(100);
  useEffect(() => {
    const unsub = zoomSpring.on("change", (v: number) => setVal(Math.round(v * 100)));
    return () => unsub();
  }, [zoomSpring]);
  return (
    <div className="px-2 text-[11px] font-ui font-bold tabular-nums text-white/90 min-w-[52px] text-center">
      {val}%
    </div>
  );
}

function CallMissedPill({
  payload, meId, createdAt,
}: {
  payload: { _t: string; videollamadaId: string; reason: "no_answer" | "declined" | "busy"; caller: { id: string; nombre: string; foto_perfil_url?: string | null }; callee: { id: string; nombre: string; foto_perfil_url?: string | null } };
  meId: string;
  createdAt: string;
}) {
  const iAmCaller = payload.caller?.id === meId;
  const reason = payload.reason;
  // Texto por perspectiva del usuario
  const { title, subtitle, accent } = (() => {
    if (iAmCaller) {
      if (reason === "declined")  return { title: `${payload.callee.nombre} no pudo atender`, subtitle: "Rechazó la llamada", accent: "red" };
      if (reason === "no_answer") return { title: `${payload.callee.nombre} no contestó`, subtitle: "Intenta de nuevo más tarde", accent: "orange" };
      return { title: `${payload.callee.nombre} está ocupado`, subtitle: "En otra llamada", accent: "amber" };
    } else {
      // Soy el callee — vi la notificación pero no respondí
      if (reason === "declined")  return { title: `Rechazaste la llamada de ${payload.caller.nombre}`, subtitle: "", accent: "slate" };
      if (reason === "no_answer") return { title: `Llamada perdida de ${payload.caller.nombre}`, subtitle: "Toca para devolver", accent: "orange" };
      return { title: `Llamada perdida`, subtitle: "", accent: "slate" };
    }
  })();
  const colorMap: Record<string, { bg: string; ring: string; text: string; iconBg: string; iconText: string }> = {
    red:    { bg: "bg-red-50 dark:bg-red-500/10",       ring: "ring-red-200 dark:ring-red-500/20",       text: "text-red-700 dark:text-red-300",     iconBg: "bg-red-500",    iconText: "text-white" },
    orange: { bg: "bg-orange-50 dark:bg-orange-500/10", ring: "ring-orange-200 dark:ring-orange-500/20", text: "text-orange-700 dark:text-orange-200",iconBg: "bg-brand-orange",iconText: "text-white" },
    amber:  { bg: "bg-amber-50 dark:bg-amber-500/10",   ring: "ring-amber-200 dark:ring-amber-500/20",   text: "text-amber-700 dark:text-amber-200", iconBg: "bg-amber-500",  iconText: "text-white" },
    slate:  { bg: "bg-slate-100 dark:bg-white/[0.06]",  ring: "ring-slate-200 dark:ring-white/10",       text: "text-slate-700 dark:text-white/85",  iconBg: "bg-slate-500",  iconText: "text-white" },
  };
  const c = colorMap[accent] || colorMap.orange;
  const time = new Date(createdAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="my-3 flex justify-center"
    >
      <div className={cn(
        "relative inline-flex items-center gap-3 px-4 py-2.5 rounded-full ring-1 shadow-[0_4px_20px_rgba(15,23,42,0.06)] backdrop-blur-xl max-w-[90%]",
        c.bg, c.ring
      )}>
        <div className={cn("relative h-9 w-9 rounded-full flex items-center justify-center shrink-0 shadow-md", c.iconBg, c.iconText)}>
          <motion.span
            aria-hidden
            animate={{ scale: [1, 1.5], opacity: [0.55, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            className={cn("absolute inset-0 rounded-full", c.iconBg)}
          />
          <motion.div
            animate={{ rotate: [0, -8, 8, -4, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2.5, ease: "easeInOut" }}
            className="relative"
          >
            <PhoneMissed className="h-4 w-4" strokeWidth={2.4} />
          </motion.div>
        </div>
        <div className="min-w-0 pr-1">
          <div className={cn("font-inter text-[13px] font-bold leading-tight truncate", c.text)}>{title}</div>
          {subtitle && <div className={cn("font-inter text-[11px] font-medium opacity-80 leading-tight", c.text)}>{subtitle}</div>}
        </div>
        <div className="text-[10px] font-mono tabular-nums text-slate-400 dark:text-white/40 tracking-wider pl-1 border-l border-current/10">{time}</div>
      </div>
    </motion.div>
  );
}

type CallSummaryPayload = {
  _t: "call_summary";
  videollamadaId: string;
  roomName: string;
  duracion_segundos: number;
  participantes: { id: string; nombre: string; foto?: string | null }[];
  transcript?: string;
  summary: {
    titulo?: string;
    resumen?: string;
    puntos_clave?: string[];
    decisiones?: string[];
    acciones?: { responsable?: string; tarea?: string; fecha?: string }[];
    tono?: string;
    proxima_accion_sugerida?: string;
  } | null;
  ai: boolean;
  ended_at: string;
};

function CallSummaryCard({ payload, createdAt }: { payload: CallSummaryPayload; createdAt: string }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const s = payload.summary;
  const fmtDur = () => {
    const d = payload.duracion_segundos || 0;
    const m = Math.floor(d / 60);
    const ss = d % 60;
    if (m === 0) return `${ss}s`;
    return `${m}m ${ss}s`;
  };
  const toneColor: Record<string, string> = {
    positivo: "bg-emerald-500/15 text-emerald-600 border-emerald-500/25",
    productivo: "bg-emerald-500/15 text-emerald-600 border-emerald-500/25",
    neutral: "bg-slate-100 text-slate-600 border-slate-200",
    tenso: "bg-red-500/15 text-red-600 border-red-500/25",
  };
  const tone = (s?.tono || "neutral").toLowerCase();
  const toneCls = toneColor[tone] || toneColor.neutral;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="my-3 flex justify-center"
    >
      <div className="relative w-full max-w-[520px] rounded-3xl bg-white dark:bg-[#141421] border border-slate-200 dark:border-white/10 shadow-[0_10px_40px_rgba(15,23,42,0.08)] overflow-hidden">
        {/* Gradient decorative top */}
        <div className="relative px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-start gap-3">
          <div className="absolute inset-0 opacity-40 pointer-events-none"
            style={{ backgroundImage: "radial-gradient(ellipse at 20% 10%, rgba(87,80,232,0.15), transparent 55%), radial-gradient(ellipse at 80% 90%, rgba(131,56,236,0.15), transparent 55%)" }} />
          <div className="relative h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-orange via-neon-magenta to-neon-purple flex items-center justify-center shadow-lg shadow-brand-orange/25 shrink-0">
            <Sparkles className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div className="relative flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-inter font-bold uppercase tracking-[0.2em] text-brand-orange mb-0.5">
              <Video className="h-3 w-3" strokeWidth={2.5} />
              {payload.ai ? "Resumen IA · Videollamada" : "Resumen · Videollamada"}
            </div>
            <div className="font-inter text-[15px] font-extrabold text-slate-900 dark:text-white leading-tight truncate">
              {s?.titulo || payload.roomName || "Videollamada"}
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-white/55">
                <ClockIcon className="h-3 w-3" strokeWidth={2.2} />
                {fmtDur()}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500 dark:text-white/55">
                {new Date(createdAt).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              {s?.tono && (
                <span className={"inline-flex items-center gap-1 px-2 h-5 rounded-md border font-inter text-[10px] font-bold uppercase tracking-wider " + toneCls}>
                  {s.tono}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Participantes */}
        {payload.participantes?.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-100 dark:border-white/5 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-inter font-bold uppercase tracking-[0.15em] text-slate-400 mr-1">Participantes</span>
            {payload.participantes.map((p) => (
              <div key={p.id} className="inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full bg-slate-100 dark:bg-white/5 text-[11px] font-inter font-semibold text-slate-700 dark:text-white/85">
                <div className="h-5 w-5 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white text-[8px] font-bold">
                  {p.foto ? <img src={p.foto} alt={p.nombre} className="h-full w-full object-cover" /> : (p.nombre || "?").slice(0, 2).toUpperCase()}
                </div>
                <span className="truncate max-w-[120px]">{p.nombre}</span>
              </div>
            ))}
          </div>
        )}

        {/* Resumen + secciones */}
        <div className="px-5 py-4 space-y-4">
          {s?.resumen && (
            <div>
              <div className="text-[10px] font-inter font-bold uppercase tracking-[0.15em] text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-brand-orange" strokeWidth={2.5} />
                Resumen
              </div>
              <p className="text-[13.5px] font-inter text-slate-800 dark:text-white/90 leading-relaxed">{s.resumen}</p>
            </div>
          )}

          {Array.isArray(s?.puntos_clave) && s!.puntos_clave.length > 0 && (
            <div>
              <div className="text-[10px] font-inter font-bold uppercase tracking-[0.15em] text-slate-400 mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="h-3 w-3 text-sky-600" strokeWidth={2.5} />
                Puntos clave
              </div>
              <ul className="space-y-1">
                {s!.puntos_clave.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-white/85 font-inter">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(s?.decisiones) && s!.decisiones.length > 0 && (
            <div>
              <div className="text-[10px] font-inter font-bold uppercase tracking-[0.15em] text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Target className="h-3 w-3 text-emerald-600" strokeWidth={2.5} />
                Decisiones
              </div>
              <ul className="space-y-1">
                {s!.decisiones.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-white/85 font-inter">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(s?.acciones) && s!.acciones.length > 0 && (
            <div>
              <div className="text-[10px] font-inter font-bold uppercase tracking-[0.15em] text-slate-400 mb-2 flex items-center gap-1.5">
                <CheckSquare className="h-3 w-3 text-brand-orange" strokeWidth={2.5} />
                Acciones
              </div>
              <div className="space-y-1.5">
                {s!.acciones.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl bg-brand-orange/8 border border-brand-orange/20 px-3 py-2">
                    <CheckSquare className="h-4 w-4 text-brand-orange shrink-0 mt-0.5" strokeWidth={2.2} />
                    <div className="flex-1 min-w-0 text-[12.5px] font-inter">
                      <div className="font-semibold text-slate-900 dark:text-white">{a.tarea || "Tarea"}</div>
                      <div className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {a.responsable && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-brand-orange" /> {a.responsable}</span>}
                        {a.fecha && <span>· {a.fecha}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {s?.proxima_accion_sugerida && (
            <div className="rounded-xl bg-fuchsia-500/8 border border-fuchsia-500/20 px-3 py-2.5">
              <div className="text-[10px] font-inter font-bold uppercase tracking-[0.15em] text-fuchsia-600 mb-0.5">Sugerencia</div>
              <div className="text-[12.5px] text-slate-800 dark:text-white/85 font-inter">{s.proxima_accion_sugerida}</div>
            </div>
          )}
        </div>

        {/* Transcripción toggle */}
        {payload.transcript && payload.transcript.trim().length > 0 && (
          <div className="px-5 pb-4">
            <button
              type="button"
              onClick={() => setTranscriptOpen((v) => !v)}
              className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 flex items-center gap-2 text-[11px] font-inter font-bold uppercase tracking-wider text-slate-700 dark:text-white/85 transition"
            >
              <FileText className="h-3.5 w-3.5 text-slate-500" strokeWidth={2.2} />
              Transcripción
              <span className="flex-1 text-right text-slate-400 font-mono tabular-nums text-[10px]">
                {payload.transcript.split("\n").length} líneas
              </span>
              {transcriptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {transcriptOpen && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="mt-2 max-h-[260px] overflow-y-auto text-[12px] leading-relaxed text-slate-700 dark:text-white/80 font-mono whitespace-pre-wrap bg-slate-50 dark:bg-white/[0.02] rounded-xl p-3 border border-slate-200 dark:border-white/5 selection-doc"
              >
                {payload.transcript}
              </motion.pre>
            )}
          </div>
        )}

        {!payload.ai && (
          <div className="px-5 pb-4 text-[10px] font-inter text-slate-400 flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-slate-400" />
            Resumen generado localmente · Configura ANTHROPIC_API_KEY para IA avanzada
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Tarjeta de felicitación (Ganador de la semana) en el chat ──────────────
type RecognitionPayload = {
  _t: "recognition";
  tipo: string;
  ganador_id?: string;
  nombre: string;
  foto?: string | null;
  metadata?: any;
  titulo?: string;
  mensaje?: string;
};

const RECOG_META: Record<string, { icon: string; label: string; grad: string; congrats: string }> = {
  puntualidad: { icon: "🏅", label: "Medalla a la Puntualidad", grad: "from-[#1E9BD7] via-[#2DB39A] to-[#43A847]", congrats: "Por su puntualidad y compromiso con la empresa 🙌" },
  vendedor_semana: { icon: "🥇", label: "Vendedor de la Semana", grad: "from-[#FFC83D] via-[#FF9D26] to-[#FF6A00]", congrats: "Por su esfuerzo y excelencia cerrando casos 🔥" },
  preparador_semana: { icon: "👏", label: "Preparador de la Semana", grad: "from-[#9B5DE5] via-[#C04AC9] to-[#F06292]", congrats: "Por su dedicación preparando cada caso 💜" },
};

function recogStats(tipo: string, md: any): { value: string; label: string }[] {
  if (!md || typeof md !== "object") return [];
  if (tipo === "puntualidad") {
    const dias = Number(md.dias ?? 0);
    const tarde = Number(md.minutos_tarde ?? 0);
    return [
      { value: String(dias), label: dias === 1 ? "día a tiempo" : "días a tiempo" },
      tarde === 0 ? { value: "0", label: "atrasos en la semana" } : { value: String(tarde), label: tarde === 1 ? "minuto de atraso" : "minutos de atraso" },
    ];
  }
  if (tipo === "vendedor_semana") return [{ value: `$${Number(md.ventas ?? 0).toLocaleString("en-US")}`, label: "en ventas cerradas" }];
  if (tipo === "preparador_semana") { const c = Number(md.casos ?? 0); return [{ value: String(c), label: c === 1 ? "caso preparado" : "casos preparados" }]; }
  return Object.values(md).map((v) => ({ value: String(v), label: "" }));
}

function ConfettiBurst() {
  // posiciones fijas (deterministas) para evitar mismatch de hidratación
  const pieces = [
    { l: "10%", c: "#FFC83D", d: 0 }, { l: "22%", c: "#43A847", d: 0.15 }, { l: "34%", c: "#FF6A00", d: 0.05 },
    { l: "46%", c: "#2196C9", d: 0.22 }, { l: "58%", c: "#F06292", d: 0.1 }, { l: "70%", c: "#9B5DE5", d: 0.18 },
    { l: "82%", c: "#FFC83D", d: 0.08 }, { l: "90%", c: "#43A847", d: 0.25 }, { l: "16%", c: "#F06292", d: 0.3 }, { l: "64%", c: "#FF6A00", d: 0.28 },
  ];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute top-0 h-2 w-1.5 rounded-[1px]"
          style={{ left: p.l, background: p.c }}
          initial={{ y: -20, opacity: 0, rotate: 0 }}
          animate={{ y: [-20, 220], opacity: [0, 1, 1, 0], rotate: [0, 220, 380] }}
          transition={{ duration: 2.2, delay: p.d, repeat: Infinity, repeatDelay: 3.2, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

function RecognitionCard({ payload, createdAt }: { payload: RecognitionPayload; createdAt: string }) {
  const meta = RECOG_META[payload.tipo] || { icon: "🏆", label: payload.titulo || "Reconocimiento", grad: "from-slate-500 to-slate-700", congrats: payload.mensaje || "¡Gran trabajo esta semana!" };
  const stats = recogStats(payload.tipo, payload.metadata);
  const congrats = payload.mensaje || meta.congrats;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 20 }}
      className="my-3 flex justify-center"
    >
      <div className={`relative w-full max-w-[480px] rounded-3xl p-6 bg-gradient-to-br ${meta.grad} text-white shadow-[0_16px_50px_rgba(0,0,0,0.25)] overflow-hidden`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.35),transparent_55%)] pointer-events-none" />
        <ConfettiBurst />
        {/* Barrido de luz */}
        <motion.div
          className="absolute -inset-y-4 -left-1/2 w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none"
          animate={{ x: ["0%", "340%"] }}
          transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 2.6, ease: "easeInOut" }}
        />

        {/* Headline */}
        <div className="relative flex items-center justify-center gap-2 mb-4">
          <motion.span animate={{ rotate: [0, -18, 12, 0] }} transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1 }}>
            <PartyPopper className="h-5 w-5" strokeWidth={2.4} />
          </motion.span>
          <span className="font-display font-black text-base uppercase tracking-[0.22em]">¡Felicidades!</span>
          <motion.span animate={{ rotate: [0, 18, -12, 0] }} transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1 }}>
            <PartyPopper className="h-5 w-5 -scale-x-100" strokeWidth={2.4} />
          </motion.span>
        </div>

        {/* Foto con anillo + medalla */}
        <div className="relative flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 14 }}
            className="relative"
          >
            <div className="absolute inset-0 rounded-full bg-white/40 blur-xl" />
            {payload.foto ? (
              <img src={payload.foto} alt={payload.nombre} className="relative h-24 w-24 rounded-full object-cover border-4 border-white shadow-xl" />
            ) : (
              <div className="relative h-24 w-24 rounded-full bg-white/25 backdrop-blur flex items-center justify-center text-5xl border-4 border-white shadow-xl">{meta.icon}</div>
            )}
            <div className="absolute -bottom-1 -right-1 h-10 w-10 rounded-full bg-white flex items-center justify-center text-2xl shadow-lg">{meta.icon}</div>
          </motion.div>

          <div className="mt-4 text-[11px] font-ui uppercase tracking-[0.18em] font-bold opacity-95 flex items-center gap-1.5 justify-center">
            <Trophy className="h-3.5 w-3.5" fill="currentColor" /> {meta.label}
          </div>
          <div className="mt-1 font-display font-black text-2xl leading-tight">{payload.nombre}</div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-ui opacity-95 max-w-[340px]">
            <Heart className="h-3.5 w-3.5 shrink-0" fill="currentColor" /> {congrats}
          </div>
        </div>

        {/* Estadísticas pulcras */}
        {stats.length > 0 && (
          <div className="relative mt-5 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))` }}>
            {stats.map((s, k) => (
              <div key={k} className="rounded-2xl bg-white/18 backdrop-blur px-3 py-2.5 text-center">
                <div className="font-display font-black text-xl leading-none tabular-nums">{s.value}</div>
                {s.label && <div className="text-[10.5px] opacity-90 mt-1 leading-tight">{s.label}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="relative mt-4 text-center text-[10px] font-ui uppercase tracking-[0.15em] opacity-80">
          Ganador de la semana · {new Date(createdAt).toLocaleDateString("es", { day: "numeric", month: "short" })}
        </div>
      </div>
    </motion.div>
  );
}
