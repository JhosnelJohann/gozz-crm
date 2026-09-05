"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, Copy, Trash2, Forward, Pin, ChevronDown, MessagesSquare, Sparkles, Plus } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { getSocket } from "@/lib/socket";
import { ChatSidebar, type ChatListItem } from "@/components/chat/ChatSidebar";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessages, type ChatMensaje } from "@/components/chat/ChatMessages";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { CrearGrupoModal, type GrupoMode } from "@/components/chat/CrearGrupoModal";
import type { NewChatAction } from "@/components/chat/NewChatMenu";
import { startHeartbeat, usePresence } from "@/lib/presence";
import { setActiveChat } from "@/lib/chatActive";
import { TaskModal } from "@/components/tareas/TaskModal";
import { ForwardModal } from "@/components/chat/ForwardModal";

interface Me { id: string; nombre: string; }

const CHAT_PAGE_SIZE = 50;

// Mezcla el lote recien traido del servidor (los ultimos N) con lo que ya hay cargado,
// sin perder el historial antiguo que el usuario haya traido por scroll-up. Deduplica por id,
// prefiere la version del servidor (trae ediciones/reacciones/lecturas frescas) y ordena por fecha.
function mergeMensajes(prev: ChatMensaje[], incoming: ChatMensaje[]): ChatMensaje[] {
  if (!prev.length) return incoming;
  const byId = new Map<string, ChatMensaje>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

// Cuando abro o resincronizo un chat, emito chat:read inmediatamente. Pero el
// fetch del historial salió antes y puede ganar la carrera con el broadcast del
// server → la versión "fresca" del server llega sin mi id en leido_por y pisa
// el update del socket. Solución: agregar mi id PREEMPTIVAMENTE a leido_por de
// cada mensaje recibido (server confirmará y será no-op por dedup). Así "Visto
// por mí" aparece instantáneo al abrir el chat, sin flicker.
// Orden de la lista de chats: fijados primero, luego por último mensaje (desc). Debe
// COINCIDIR con el ORDER BY del backend (fijado DESC, ultimo_mensaje_at DESC) para que el
// reorden en vivo al llegar un mensaje quede igual que tras recargar la página.
function sortGrupos(list: ChatListItem[]): ChatListItem[] {
  return [...list].sort((a, b) => {
    if (!!a.fijado !== !!b.fijado) return a.fijado ? -1 : 1;
    const ta = a.ultimo_mensaje_at ? new Date(a.ultimo_mensaje_at).getTime() : 0;
    const tb = b.ultimo_mensaje_at ? new Date(b.ultimo_mensaje_at).getTime() : 0;
    return tb - ta;
  });
}

function preemptiveMarkMyRead(msgs: ChatMensaje[], myId: string | null | undefined): ChatMensaje[] {
  if (!myId) return msgs;
  return msgs.map((m) => {
    if (!m || m.user_id === myId) return m;
    if (Array.isArray(m.leido_por) && m.leido_por.includes(myId)) return m;
    return { ...m, leido_por: [...(m.leido_por || []), myId] };
  });
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [grupos, setGrupos] = useState<ChatListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<ChatMensaje[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  // Quién está escribiendo en cada chat (recibido por socket; auto-expira a 3.5s).
  const [typingByGroup, setTypingByGroup] = useState<Record<string, Record<string, string>>>({});
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingEmitRef = useRef(0);
  const [grupoModalMode, setGrupoModalMode] = useState<GrupoMode | null>(null);
  const [creatingCopilot, setCreatingCopilot] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copilotThinking, setCopilotThinking] = useState<{
    grupoId: string;
    kind: "texto" | "audio" | "archivo" | "imagen" | "video";
    startedAt: number;
  } | null>(null);
  const dragCounter = useRef(0);
  const [taskPrefill, setTaskPrefill] = useState<any | null>(null);
  const [forwardMsgs, setForwardMsgs] = useState<ChatMensaje[] | null>(null);
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [pinExpanded, setPinExpanded] = useState(false);
  // Mensaje a resaltar tras saltar a él (fijado / cita). Auto-limpia a 1.6s.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Id pendiente de scroll cuando estamos esperando que su bloque de contexto renderice.
  const pendingScrollRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveChat(activeId);
    return () => setActiveChat(null);
  }, [activeId]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user));
    loadGrupos();
    startHeartbeat();
  }, []);

  const loadGrupos = async () => {
    const r = await fetch("/api/chat/grupos");
    const d = await r.json();
    const list: ChatListItem[] = (d.grupos || []).map((g: any) => ({
      ...g,
      unread_count: g.unread_count || 0,
    }));
    setGrupos(sortGrupos(list));
  };

  useEffect(() => {
    const socket = getSocket();
    const onMsg = (m: ChatMensaje) => {
      if (m.grupo_id === activeId) {
        // mergeMensajes deduplica por id y ordena por created_at, preservando el
        // historial traído por scroll-up. NO usar `[...prev, m]` ni `setMensajes(d.mensajes)`.
        setMensajes((prev) => mergeMensajes(prev, [m]));
        // Lo estoy viendo: marcar leido al instante para que el emisor vea los checks azules EN VIVO
        if (m.user_id && m.user_id !== me?.id && (typeof document === "undefined" || !document.hidden)) {
          socket.emit("chat:read", activeId);
        }
      }
      // Si llegó un mensaje de CoPilot (user_id=null) al grupo que tiene el indicador, lo cerramos.
      if (!m.user_id) {
        setCopilotThinking((cur) => (cur && cur.grupoId === m.grupo_id ? null : cur));
      }
      setGrupos((prev) => sortGrupos(prev.map((g) => {
        if (g.id !== m.grupo_id) return g;
        const isMine = me?.id === m.user_id;
        return {
          ...g,
          ultimo_mensaje: m.contenido || m.archivo_nombre || "archivo",
          ultimo_mensaje_at: m.created_at,
          unread_count: m.grupo_id === activeId || isMine ? 0 : (g.unread_count + 1),
        };
      })));
    };
    const onDelivered = (data: { mensajeId: string; userIds: string[] }) => {
      setMensajes((prev) => prev.map((m) => m.id === data.mensajeId ? { ...m, entregado_por: [...(m.entregado_por || []), ...data.userIds] } : m));
    };
    const onRead = (data: { grupoId: string; userId: string }) => {
      setMensajes((prev) => {
        if (!prev.length) return prev;
        if (prev[0].grupo_id !== data.grupoId) return prev;
        return prev.map((m) => {
          if (m.user_id === data.userId) return m;
          if ((m.leido_por || []).includes(data.userId)) return m;
          return { ...m, leido_por: [...(m.leido_por || []), data.userId] };
        });
      });
    };
    const onUpdated = (u: { id: string; [k: string]: any }) => {
      setMensajes((prev) => prev.map((m) => m.id === u.id ? { ...m, ...u } : m));
    };
    // Mensaje fijado/desfijado en un chat: actualizar la barra fijada en vivo.
    const onPinUpdated = (data: { grupo_id: string; mensajes_fijados: any[] }) => {
      setGrupos((prev) => prev.map((g) => g.id === data.grupo_id
        ? ({ ...g, mensajes_fijados: data.mensajes_fijados || [] } as any)
        : g));
    };
    const onThinking = (data: { grupo_id: string; kind: string; started_at: number }) => {
      setCopilotThinking({
        grupoId: data.grupo_id,
        kind: (["texto","audio","archivo","imagen","video"].includes(data.kind) ? data.kind : "texto") as any,
        startedAt: data.started_at || Date.now(),
      });
    };
    // Un chat fue eliminado para todos → quitarlo de la lista en vivo y salir de él si estaba abierto.
    const onGrupoEliminado = (data: { grupoId: string }) => {
      setGrupos((prev) => prev.filter((g) => g.id !== data.grupoId));
      setActiveId((cur) => (cur === data.grupoId ? null : cur));
    };
    // Re-sincroniza al (re)conectar: re-unir a la room, re-marcar leido y recuperar mensajes perdidos en la caida
    const onConnect = () => {
      if (activeId) {
        socket.emit("chat:join", activeId);
        socket.emit("chat:read", activeId);
        fetch(`/api/chat/grupos/${activeId}/mensajes`).then((r) => r.json()).then((d) => setMensajes((prev) => mergeMensajes(prev, preemptiveMarkMyRead(d.mensajes || [], me?.id)))).catch(() => {});
      }
      loadGrupos();
    };
    // Otro usuario está escribiendo en algún grupo: mostrar "escribiendo..." con auto-expiración.
    const onTypingEvt = (data: { grupoId: string; userId: string; nombre?: string }) => {
      if (!data?.grupoId || !data?.userId) return;
      if (me?.id === data.userId) return; // ignorar eco propio
      const nombre = data.nombre || "Alguien";
      setTypingByGroup((prev) => ({
        ...prev,
        [data.grupoId]: { ...(prev[data.grupoId] || {}), [data.userId]: nombre },
      }));
      const key = `${data.grupoId}:${data.userId}`;
      if (typingTimeoutsRef.current[key]) clearTimeout(typingTimeoutsRef.current[key]);
      typingTimeoutsRef.current[key] = setTimeout(() => {
        setTypingByGroup((prev) => {
          const g = { ...(prev[data.grupoId] || {}) };
          delete g[data.userId];
          return { ...prev, [data.grupoId]: g };
        });
        delete typingTimeoutsRef.current[key];
      }, 3500);
    };
    socket.on("connect", onConnect);
    socket.on("chat:message", onMsg);
    socket.on("chat:message:updated", onUpdated);
    socket.on("chat:pin:updated", onPinUpdated);
    socket.on("chat:delivered", onDelivered);
    socket.on("chat:read", onRead);
    socket.on("copilot:thinking", onThinking);
    socket.on("chat:grupo-eliminado", onGrupoEliminado);
    socket.on("chat:typing", onTypingEvt);
    return () => {
      socket.off("connect", onConnect);
      socket.off("chat:message", onMsg);
      socket.off("chat:message:updated", onUpdated);
      socket.off("chat:pin:updated", onPinUpdated);
      socket.off("chat:delivered", onDelivered);
      socket.off("chat:read", onRead);
      socket.off("copilot:thinking", onThinking);
      socket.off("chat:grupo-eliminado", onGrupoEliminado);
      socket.off("chat:typing", onTypingEvt);
    };
  }, [activeId, me?.id]);

  useEffect(() => {
    // Al cambiar de chat, salir del modo seleccion
    setSelMode(false); setSelIds(new Set());
    if (!activeId) return;
    const socket = getSocket();
    // Unirse SIEMPRE a la room (idempotente). Si el socket aun no conecta, socket.io
    // bufferea el emit y lo envia al conectar; ademas onConnect re-une en cada reconexion.
    socket.emit("chat:join", activeId);
    // Carga inicial del chat: reemplaza (es un chat nuevo) y resetea paginacion.
    setHasMore(false);
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    fetch(`/api/chat/grupos/${activeId}/mensajes`)
      .then((r) => r.json())
      .then((d) => {
        // Cambio de chat: REEMPLAZO TOTAL (no merge). El array anterior pertenece
        // a otra conversación; mergeMensajes acá mezclaría mensajes de 2 chats.
        // Este es el único setMensajes plano legítimo — el resto va por mergeMensajes.
        // Preempt: marco mi propio visto antes de pintar, para que "Visto por mí"
        // se vea instantáneo al abrir (sin esperar el broadcast del chat:read).
        const msgs: ChatMensaje[] = preemptiveMarkMyRead(d.mensajes || [], me?.id);
        setMensajes(() => msgs);
        setHasMore(msgs.length >= CHAT_PAGE_SIZE);
      });
    // emit read event (DB + socket broadcast)
    socket.emit("chat:read", activeId);
    fetch(`/api/chat/grupos/${activeId}/leer`, { method: "POST" }).catch(() => {});
    setGrupos((prev) => prev.map((g) => g.id === activeId ? { ...g, unread_count: 0 } : g));
  }, [activeId]);

  // Red de seguridad anti "hay que refrescar": re-sincroniza el chat activo al volver el
  // foco/visibilidad y con un poll suave cada 12s (solo visible). No mueve el scroll si no
  // hay mensajes nuevos (el auto-scroll depende de mensajes.length). El socket sigue siendo
  // el canal principal (instantaneo); esto es solo garantia por si se cae un evento.
  useEffect(() => {
    if (!activeId) return;
    const resync = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetch(`/api/chat/grupos/${activeId}/mensajes`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d.mensajes)) setMensajes((prev) => mergeMensajes(prev, preemptiveMarkMyRead(d.mensajes, me?.id))); })
        .catch(() => {});
      // Marcar leido al estar viendo el chat (checks azules en vivo para el emisor)
      try { getSocket().emit("chat:read", activeId); } catch {}
    };
    const onVis = () => { if (!document.hidden) resync(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", resync);
    const iv = setInterval(resync, 12000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", resync);
      clearInterval(iv);
    };
  }, [activeId]);

  // Scroll-up: trae los 50 mensajes anteriores al mas antiguo cargado (cursor `before`).
  const loadOlder = useCallback(async () => {
    if (!activeId || loadingOlderRef.current) return;
    const oldest = mensajes[0];
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const r = await fetch(`/api/chat/grupos/${activeId}/mensajes?before=${encodeURIComponent(oldest.created_at)}`);
      const d = await r.json();
      const older: ChatMensaje[] = Array.isArray(d.mensajes) ? d.mensajes : [];
      if (older.length) setMensajes((prev) => mergeMensajes(prev, older));
      setHasMore(older.length >= CHAT_PAGE_SIZE);
    } catch {
      // silencioso: el usuario puede reintentar scrolleando de nuevo
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [activeId, mensajes]);

  // Emite "estoy escribiendo" al socket, máximo 1 vez cada 2s (throttle).
  const onTyping = useCallback(() => {
    if (!activeId) return;
    const now = Date.now();
    if (now - lastTypingEmitRef.current < 2000) return;
    lastTypingEmitRef.current = now;
    try { getSocket().emit("chat:typing", { grupoId: activeId, nombre: me?.nombre || "" }); } catch {}
  }, [activeId, me?.nombre]);

  // Nombres de quienes están escribiendo en el chat activo (filtra el propio).
  const activeTypingNames = useMemo(() => {
    if (!activeId) return [];
    const map = typingByGroup[activeId] || {};
    return Object.values(map);
  }, [activeId, typingByGroup]);

  // Misma data pero como [{ userId, nombre }] para la burbuja "escribiendo"
  // del final del chat (necesita el userId para evitar eco propio + para el avatar).
  const activeTypingUsers = useMemo(() => {
    if (!activeId) return [];
    const map = typingByGroup[activeId] || {};
    return Object.entries(map).map(([userId, nombre]) => ({ userId, nombre }));
  }, [activeId, typingByGroup]);

  const [replyTo, setReplyTo] = useState<ChatMensaje | null>(null);
  const sendMessage = async (text: string, menciones?: { id: string; nombre: string }[]) => {
    if (!activeId) return;
    try {
      const r = await fetch(`/api/chat/grupos/${activeId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: text, tipo: "texto", reply_to_id: replyTo?.id || null, menciones: menciones || [] })
      });
      if (!r.ok) throw new Error("Error enviando");
      setReplyTo(null);
    } catch (e: any) { toast.error(e.message); }
  };

  const attachFile = async (file: File) => {
    if (!activeId) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const up = await fetch("/api/chat/upload", { method: "POST", body: fd });
      const d = await up.json();
      if (!up.ok) throw new Error(d.error || "Error");
      await fetch(`/api/chat/grupos/${activeId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contenido: "",
          tipo: file.type.startsWith("image/") ? "imagen"
            : file.type.startsWith("video/") ? "video"
            : file.type.startsWith("audio/") ? "audio"
            : "archivo",
          archivo_url: d.url,
          archivo_nombre: d.filename,
          archivo_tipo: d.mimetype,
        })
      });
    } catch (e: any) { toast.error(e.message); }
  };

  const sendAudio = async (file: File, durationMs: number) => {
    if (!activeId) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const up = await fetch("/api/chat/upload", { method: "POST", body: fd });
      const d = await up.json();
      if (!up.ok) throw new Error(d.error || "Error al subir audio");
      await fetch(`/api/chat/grupos/${activeId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contenido: `[audio ${Math.round(durationMs / 1000)}s]`,
          tipo: "audio",
          archivo_url: d.url,
          archivo_nombre: d.filename,
          archivo_tipo: d.mimetype,
        })
      });
    } catch (e: any) { toast.error(e.message || "Error"); throw e; }
  };

  const onStartDM = async (targetUserId: string) => {
    try {
      const r = await fetch("/api/chat/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetUserId })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      await loadGrupos();
      setActiveId(d.grupo.id);
    } catch (e: any) { toast.error(e.message); }
  };

  const onNewChatAction = async (action: NewChatAction) => {
    if (action === "grupo" || action === "canal" || action === "videoconferencia") {
      setGrupoModalMode(action);
      return;
    }
    if (action === "copilot") {
      if (creatingCopilot) return;
      setCreatingCopilot(true);
      try {
        const r = await fetch("/api/chat/copilot", { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Error");
        await loadGrupos();
        setActiveId(d.grupo.id);
      } catch (e: any) { toast.error(e.message); }
      finally { setCreatingCopilot(false); }
    }
  };

  const onGrupoCreated = async ({ grupo, videollamadaId }: { grupo: any; videollamadaId?: string }) => {
    await loadGrupos();
    setActiveId(grupo.id);
    toast.success(grupo.tipo === "canal" ? "Canal creado" : "Grupo creado");
    if (videollamadaId) {
      router.push(`/videollamada/${videollamadaId}`);
    }
  };

  // Acciones del menú de mensaje que requieren contexto de página
  const onCreateTaskFromMsg = (m: ChatMensaje) => {
    const txt = (m.contenido || "").trim();
    setTaskPrefill({ titulo: txt.slice(0, 120) || "Tarea desde chat", descripcion: txt });
  };
  const onAskCopilotFromMsg = async (m: ChatMensaje) => {
    try {
      const r = await fetch("/api/chat/copilot", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      await loadGrupos();
      setActiveId(d.grupo.id);
      const txt = (m.contenido || m.archivo_nombre || "").slice(0, 800);
      await fetch(`/api/chat/grupos/${d.grupo.id}/mensajes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: `Sobre este mensaje:\n"${txt}"`, tipo: "texto" }),
      });
    } catch (e: any) { toast.error(e.message || "Error"); }
  };

  // Modo seleccion / multiseleccion
  const startSelect = (id: string) => { setSelMode(true); setSelIds(new Set([id])); };
  const toggleSelect = (id: string) => {
    setSelIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const exitSelect = () => { setSelMode(false); setSelIds(new Set()); };
  const selectedMsgs = () => mensajes.filter((m) => selIds.has(m.id));
  const copySelected = () => {
    const txt = selectedMsgs().map((m) => m.contenido || m.archivo_nombre || "").filter(Boolean).join("\n");
    navigator.clipboard?.writeText(txt).then(() => toast.success("Copiado")).catch(() => {});
    exitSelect();
  };
  const forwardSelected = () => {
    const ms = selectedMsgs();
    if (ms.length === 0) return;
    setForwardMsgs(ms);
    exitSelect();
  };
  const deleteSelected = async () => {
    const ms = selectedMsgs().filter((m) => m.user_id === me?.id && !m.eliminado);
    if (ms.length === 0) { toast.error("Solo puedes eliminar tus mensajes"); return; }
    if (typeof window !== "undefined" && !window.confirm(`¿Eliminar ${ms.length} mensaje(s)?`)) return;
    for (const m of ms) {
      await fetch(`/api/chat/grupos/${m.grupo_id}/mensajes/${m.id}`, { method: "DELETE" }).catch(() => {});
    }
    exitSelect();
  };

  const unpinMessage = async (id: string) => {
    if (!activeId) return;
    const r = await fetch(`/api/chat/grupos/${activeId}/fijar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mensaje_id: id }),
    }).catch(() => null);
    if (!r || !r.ok) toast.error("No se pudo desfijar");
  };
  // Hace scroll + highlight si el mensaje YA está en el DOM. Devuelve true si lo logró.
  const tryScrollTo = (id: string) => {
    const el = typeof document !== "undefined" ? document.getElementById(`msg-${id}`) : null;
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
    return true;
  };
  // Salta a un mensaje (fijado o citado). Si es viejo y no está cargado, trae su
  // bloque de contexto con ?around= en UNA petición y salta cuando React lo renderiza.
  const scrollToMessage = async (id: string) => {
    if (tryScrollTo(id)) return;
    if (!activeId) return;
    try {
      const r = await fetch(`/api/chat/grupos/${activeId}/mensajes?around=${encodeURIComponent(id)}`);
      const d = await r.json();
      const block: ChatMensaje[] = Array.isArray(d.mensajes) ? d.mensajes : [];
      if (!block.length) { toast("Ese mensaje ya no está disponible"); return; }
      pendingScrollRef.current = id;
      setMensajes((prev) => mergeMensajes(prev, preemptiveMarkMyRead(block, me?.id)));
      setHasMore((prev) => prev || block.length >= CHAT_PAGE_SIZE);
    } catch {
      toast("No se pudo cargar el mensaje");
    }
  };
  // Cuando llega el bloque de contexto pedido por scrollToMessage y ya renderizó,
  // salta al mensaje objetivo (una sola vez).
  useEffect(() => {
    const id = pendingScrollRef.current;
    if (!id) return;
    if (tryScrollTo(id)) pendingScrollRef.current = null;
  }, [mensajes]);

  const active = grupos.find((g) => g.id === activeId) || null;
  const pinnedList: any[] = (active as any)?.mensajes_fijados || [];

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!active) return;
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragCounter.current++;
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    if (!active) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    setDroppedFiles(files); // pasa por la confirmacion/preview del composer antes de enviar
  };

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-64px)]">
        <ChatSidebar
          grupos={grupos}
          activeId={activeId}
          onSelect={setActiveId}
          onNewChatAction={onNewChatAction}
          onStartDM={onStartDM}
          onReload={loadGrupos}
          typingByGroup={typingByGroup}
        />
        <div
          className="flex-1 flex flex-col min-w-0 relative"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {active ? (
            <>
              <ChatHeader grupo={active} typingNames={activeTypingNames} />
              {pinnedList.length > 0 && (
                <div className="border-b border-black/5 dark:border-white/5 bg-amber-50/80 dark:bg-amber-500/10">
                  <div className="flex items-center gap-2.5 px-4 py-2">
                    <Pin className="h-4 w-4 text-amber-500 shrink-0 rotate-45" strokeWidth={2.2} />
                    <button type="button" onClick={() => scrollToMessage(pinnedList[0].id)} className="flex-1 min-w-0 text-left">
                      <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        {pinnedList.length > 1 ? `${pinnedList.length} mensajes fijados` : "Mensaje fijado"}
                      </div>
                      <div className="text-[13px] text-neutral-700 dark:text-white/80 truncate">
                        {pinnedList[0].contenido || pinnedList[0].archivo_nombre || "Archivo adjunto"}
                      </div>
                    </button>
                    {pinnedList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPinExpanded((v) => !v)}
                        className="h-7 px-2.5 rounded-full hover:bg-amber-200/60 dark:hover:bg-white/10 flex items-center gap-1 text-[11px] font-ui font-bold text-amber-600 dark:text-amber-400 shrink-0 transition"
                      >
                        {pinExpanded ? "Ocultar" : "Ver todos"}
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pinExpanded ? "rotate-180" : ""}`} strokeWidth={2.4} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => unpinMessage(pinnedList[0].id)}
                      title="Desfijar"
                      className="h-7 w-7 rounded-full hover:bg-amber-200/60 dark:hover:bg-white/10 flex items-center justify-center shrink-0 transition"
                    >
                      <X className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2.2} />
                    </button>
                  </div>
                  {pinExpanded && pinnedList.length > 1 && (
                    <div className="px-4 pb-2 space-y-1">
                      {pinnedList.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-amber-100/70 dark:hover:bg-white/5 transition">
                          <Pin className="h-3 w-3 text-amber-400 shrink-0 rotate-45" strokeWidth={2.2} />
                          <button type="button" onClick={() => scrollToMessage(p.id)} className="flex-1 min-w-0 text-left text-[12.5px] text-neutral-700 dark:text-white/80 truncate">
                            {p.contenido || p.archivo_nombre || "Archivo adjunto"}
                          </button>
                          <button type="button" onClick={() => unpinMessage(p.id)} title="Desfijar" className="h-6 w-6 rounded-full hover:bg-amber-200/60 dark:hover:bg-white/10 flex items-center justify-center shrink-0 transition">
                            <X className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" strokeWidth={2.2} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <ChatMessages
                mensajes={mensajes}
                pinnedIds={pinnedList.map((p) => p.id)}
                meId={me?.id || ""}
                hasMore={hasMore}
                loadingOlder={loadingOlder}
                onLoadOlder={loadOlder}
                copilotThinking={copilotThinking && copilotThinking.grupoId === active.id ? copilotThinking : null}
                selectMode={selMode}
                selectedIds={selIds}
                onToggleSelect={toggleSelect}
                onStartSelect={startSelect}
                onReply={setReplyTo}
                onForward={(m) => setForwardMsgs([m])}
                onAskCopilot={onAskCopilotFromMsg}
                onCreateTask={onCreateTaskFromMsg}
                typing={activeTypingUsers}
                isGroup={active.tipo !== "directo" && active.tipo !== "copilot"}
                onJumpToMessage={scrollToMessage}
                externalHighlightId={highlightId}
              />
              {selMode ? (
                <div className="border-t border-black/5 dark:border-white/5 px-4 py-3 flex items-center gap-2 bg-white dark:bg-neutral-900">
                  <button onClick={exitSelect} title="Cancelar" className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 flex items-center justify-center shrink-0">
                    <X className="h-5 w-5 text-neutral-500" strokeWidth={2} />
                  </button>
                  <span className="font-ui font-bold text-sm flex-1">Mensajes <span className="text-brand-orange">({selIds.size})</span></span>
                  <button onClick={copySelected} disabled={selIds.size === 0} className="h-9 px-3 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 flex items-center gap-1.5 text-sm text-neutral-600 dark:text-white/80 disabled:opacity-40 transition">
                    <Copy className="h-4 w-4" strokeWidth={2} /> Copiar
                  </button>
                  <button onClick={deleteSelected} disabled={selIds.size === 0} className="h-9 px-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-1.5 text-sm font-semibold text-red-600 disabled:opacity-40 transition">
                    <Trash2 className="h-4 w-4" strokeWidth={2} /> Eliminar
                  </button>
                  <button onClick={forwardSelected} disabled={selIds.size === 0} className="h-9 px-4 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white flex items-center gap-1.5 text-sm font-bold shadow disabled:opacity-40 hover:scale-[1.02] transition">
                    <Forward className="h-4 w-4" strokeWidth={2} /> Reenviar
                  </button>
                </div>
              ) : (
                <ChatComposer grupoId={active.id} onSend={sendMessage} onAttach={attachFile} onSendAudio={sendAudio} disabled={!me} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} externalFiles={droppedFiles} onExternalConsumed={() => setDroppedFiles([])} onTyping={onTyping} />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center chat-bg relative overflow-hidden">
              {/* Blobs decorativos suaves */}
              <motion.div
                aria-hidden
                className="absolute -top-10 -left-10 h-72 w-72 rounded-full bg-brand-orange/10 blur-3xl"
                animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{ repeat: Infinity, duration: 7, ease: "easeInOut" }}
              />
              <motion.div
                aria-hidden
                className="absolute -bottom-12 -right-8 h-80 w-80 rounded-full bg-neon-magenta/10 blur-3xl"
                animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
              />

              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                className="relative z-10 flex flex-col items-center text-center px-6"
              >
                {/* Icono principal flotante con glow + anillos pulsantes */}
                <div className="relative mb-6 h-24 w-24 flex items-center justify-center">
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-[28px] bg-gradient-to-br from-brand-orange to-neon-magenta blur-2xl opacity-40"
                    animate={{ scale: [1, 1.18, 1], opacity: [0.35, 0.6, 0.35] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                  />
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-[28px] border border-brand-orange/30"
                    animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
                    transition={{ repeat: Infinity, duration: 2.6, ease: "easeOut" }}
                  />
                  <motion.div
                    animate={{ y: [0, -10, 0] }}
                    transition={{ repeat: Infinity, duration: 3.4, ease: "easeInOut" }}
                    className="relative h-20 w-20 rounded-[26px] bg-gradient-to-br from-brand-orange to-neon-magenta text-white flex items-center justify-center shadow-[0_22px_60px_rgba(87,80,232,0.45)]"
                  >
                    <MessagesSquare className="h-9 w-9" strokeWidth={1.8} />
                    <motion.span
                      className="absolute -top-1.5 -right-1.5 h-7 w-7 rounded-full bg-white shadow-lg flex items-center justify-center"
                      animate={{ scale: [1, 1.18, 1], rotate: [0, 12, 0] }}
                      transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                    >
                      <Sparkles className="h-4 w-4 text-neon-magenta" strokeWidth={2.2} />
                    </motion.span>
                  </motion.div>
                </div>

                <h3 className="font-display text-2xl font-black tracking-tight text-neutral-700 dark:text-white/90">
                  Tus conversaciones
                </h3>
                <p className="mt-1.5 text-[14px] text-neutral-500 dark:text-white/50">
                  Selecciona un chat o inicia uno nuevo
                </p>

                <motion.div
                  animate={{ x: [0, 5, 0] }}
                  transition={{ repeat: Infinity, duration: 1.7, ease: "easeInOut" }}
                  className="mt-6 inline-flex items-center gap-2 px-3.5 h-9 rounded-full bg-white/70 dark:bg-white/10 backdrop-blur border border-brand-orange/20 text-[12px] font-bold text-brand-orange shadow-sm"
                >
                  <span className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white flex items-center justify-center">
                    <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  Inicia una conversación
                </motion.div>
              </motion.div>
            </div>
          )}

          <AnimatePresence>
            {dragOver && active && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-40 bg-gradient-to-br from-brand-orange/15 via-white/80 to-neon-magenta/15 backdrop-blur-sm border-2 border-dashed border-brand-orange flex items-center justify-center pointer-events-none"
              >
                <motion.div
                  initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="flex flex-col items-center gap-3 text-center px-6"
                >
                  <motion.div
                    animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
                    className="h-16 w-16 rounded-3xl bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow-[0_20px_60px_rgba(87,80,232,0.45)] flex items-center justify-center"
                  >
                    <Upload className="h-7 w-7" strokeWidth={2.2} />
                  </motion.div>
                  <div className="font-display text-2xl font-black text-slate-900">Suelta para enviar a {active.nombre}</div>
                  <div className="text-sm text-slate-600">Se envían todos los archivos al chat</div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <CrearGrupoModal
        open={grupoModalMode !== null}
        mode={grupoModalMode || "grupo"}
        onClose={() => setGrupoModalMode(null)}
        onCreated={onGrupoCreated}
      />
      <ForwardModal
        open={!!forwardMsgs}
        messages={forwardMsgs}
        grupos={grupos}
        currentId={activeId}
        onClose={() => setForwardMsgs(null)}
      />
      <TaskModal
        open={!!taskPrefill}
        prefill={taskPrefill || undefined}
        onClose={() => setTaskPrefill(null)}
        onSaved={() => { setTaskPrefill(null); toast.success("Tarea creada"); }}
      />
    </AppShell>
  );
}
