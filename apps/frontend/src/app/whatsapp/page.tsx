"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";
import { setWhatsappActive } from "@/lib/whatsappActive";
import { celebrar } from "@/lib/celebracion";
import { WhatsappLogo, List, LayoutGrid } from "@/lib/bootstrap-icons";
import { ConnectionSwitcher } from "@/components/whatsapp/ConnectionSwitcher";
import { ConnectWhatsAppModal } from "@/components/whatsapp/ConnectWhatsAppModal";
import { ConversationList, type ConversacionItem } from "@/components/whatsapp/ConversationList";
import type { UsuarioAsignable } from "@/components/whatsapp/AsignadoPicker";
import { ConversationThread } from "@/components/whatsapp/ConversationThread";
import { WhatsappKanban } from "@/components/whatsapp/WhatsappKanban";
import { PerfilConversacionModal } from "@/components/whatsapp/PerfilConversacionModal";
import { VincularContactoModal } from "@/components/whatsapp/VincularContactoModal";
import { ConvertToOportunidadModal } from "@/components/whatsapp/ConvertToOportunidadModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { WhatsAppConexion, WhatsAppConversacionDetalle, WhatsAppMensaje, WhatsAppPipelineStage, WhatsAppTag } from "@/components/whatsapp/types";

const WHATSAPP_PAGE_SIZE = 50;

// Mezcla el lote recién traído del servidor con lo que ya hay cargado, sin perder el historial
// viejo que el usuario haya subido a buscar por scroll-up. Deduplica por id (prefiere la versión
// del servidor, que trae el estado de entrega más fresco) y ordena por fecha — mismo patrón que
// `mergeMensajes` de `app/chat/page.tsx`.
function mergeMensajes(prev: WhatsAppMensaje[], incoming: WhatsAppMensaje[]): WhatsAppMensaje[] {
  if (!prev.length) return incoming;
  const byId = new Map<string, WhatsAppMensaje>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function previewDe(msg: { contenido?: string | null; tipo: string; archivo_nombre?: string | null; autor_nombre?: string | null; direccion?: string; eliminado_at?: string | null }): string {
  const json = <T,>(): T | null => { try { return msg.contenido ? JSON.parse(msg.contenido) : null; } catch { return null; } };
  let base: string;
  if (msg.eliminado_at) base = "🚫 Mensaje eliminado";
  else if (msg.tipo === "texto" || msg.tipo === "sistema") base = msg.contenido || "";
  else if (msg.tipo === "imagen") base = msg.contenido ? `📷 ${msg.contenido}` : "📷 Foto";
  else if (msg.tipo === "video") base = msg.contenido ? `🎥 ${msg.contenido}` : "🎥 Video";
  else if (msg.tipo === "audio") base = "🎤 Nota de voz";
  else if (msg.tipo === "sticker") base = "Sticker";
  else if (msg.tipo === "archivo") base = `📄 ${msg.archivo_nombre || msg.contenido || "Documento"}`;
  else if (msg.tipo === "ubicacion") base = `📍 ${json<{ nombre?: string }>()?.nombre || "Ubicación"}`;
  else if (msg.tipo === "contacto") base = `👤 ${json<{ nombre: string }[]>()?.[0]?.nombre || "Contacto"}`;
  else if (msg.tipo === "encuesta") base = `📊 ${json<{ pregunta: string }>()?.pregunta || "Encuesta"}`;
  else base = msg.contenido || "Mensaje";
  // En grupos, como en WhatsApp: "Jair: Sticker".
  return msg.autor_nombre && msg.direccion === "entrante" ? `${msg.autor_nombre}: ${base}` : base;
}

export default function WhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppPageInner />
    </Suspense>
  );
}

function WhatsAppPageInner() {
  const [conexiones, setConexiones] = useState<WhatsAppConexion[]>([]);
  const [activeConexionId, setActiveConexionId] = useState<string | null>(null);
  const [etapas, setEtapas] = useState<WhatsAppPipelineStage[]>([]);
  const [tags, setTags] = useState<WhatsAppTag[]>([]);
  const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
  const [tagFiltro, setTagFiltro] = useState<string | null>(null);
  const [soloAsignadasAMi, setSoloAsignadasAMi] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  const [usuarios, setUsuarios] = useState<UsuarioAsignable[]>([]);
  const [vista, setVista] = useState<"lista" | "tablero">("lista");
  // Estado del canal en vivo (socket.io). Mientras está caído se muestra "Reconectando…" y, al
  // volver, se resincroniza todo lo que pudo pasar en el hueco (ver onConnect más abajo).
  const [enVivo, setEnVivo] = useState(true);
  const [conversaciones, setConversaciones] = useState<ConversacionItem[] | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [activeConversacion, setActiveConversacion] = useState<WhatsAppConversacionDetalle | null>(null);
  const [mensajes, setMensajes] = useState<WhatsAppMensaje[] | null>(null);
  const [hasMoreMensajes, setHasMoreMensajes] = useState(false);
  const [loadingOlderMensajes, setLoadingOlderMensajes] = useState(false);
  const loadingOlderMensajesRef = useRef(false);
  const conversacionesRef = useRef<ConversacionItem[] | null>(null);
  conversacionesRef.current = conversaciones;

  const [connectOpen, setConnectOpen] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [convertirOpen, setConvertirOpen] = useState(false);
  const [desconectarTarget, setDesconectarTarget] = useState<WhatsAppConexion | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const activeConexion = useMemo(() => conexiones.find((c) => c.id === activeConexionId) || null, [conexiones, activeConexionId]);

  // Le dice a `WhatsappNotifier` qué conversación se está viendo, para no mostrar un toast de algo
  // que ya está en pantalla (mismo patrón que `chatActive.ts`/`setActiveChat` del chat interno).
  useEffect(() => {
    setWhatsappActive(activeConversacion?.id ?? null);
    return () => setWhatsappActive(null);
  }, [activeConversacion?.id]);

  const loadConexiones = async () => {
    try {
      const r = await fetch("/api/whatsapp/conexiones");
      const d = await r.json();
      const list: WhatsAppConexion[] = Array.isArray(d) ? d : [];
      setConexiones(list);
      if (list.length && !activeConexionId) setActiveConexionId(list[0].id);
    } catch { /* red momentánea: la siguiente carga reintenta */ }
  };

  const loadEtapasYTags = async () => {
    try {
      const [re, rt] = await Promise.all([fetch("/api/whatsapp/etapas"), fetch("/api/whatsapp/tags")]);
      const de = await re.json(); const dt = await rt.json();
      setEtapas(de.etapas || []);
      setTags(dt.tags || []);
    } catch { /* no crítico para el primer render */ }
  };

  const loadUsuarios = async () => {
    try {
      const r = await fetch("/api/users");
      if (!r.ok) return;
      const d = await r.json();
      setUsuarios((d.users || []).filter((u: any) => u.activo !== false));
    } catch { /* no crítico para el primer render */ }
  };

  const loadConversaciones = async (opts?: { silent?: boolean }) => {
    if (!activeConexionId) { setConversaciones([]); return; }
    if (!opts?.silent) setLoadingConv(true);
    try {
      const params = new URLSearchParams();
      if (etapaFiltro) params.set("etapa", etapaFiltro);
      if (tagFiltro) params.set("tag", tagFiltro);
      if (soloAsignadasAMi) params.set("asignado", "me");
      if (busquedaDebounced.trim()) params.set("q", busquedaDebounced.trim());
      const r = await fetch(`/api/whatsapp/conexiones/${activeConexionId}/conversaciones?${params.toString()}`);
      if (!r.ok) return;
      const d = await r.json();
      setConversaciones(d.conversaciones || []);
    } catch { /* fallo transitorio: el próximo evento en tiempo real reintenta */ } finally { if (!opts?.silent) setLoadingConv(false); }
  };

  const loadConversacionDetalle = async (id: string) => {
    const r = await fetch(`/api/whatsapp/conversaciones/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    setActiveConversacion(d.conversacion);
  };

  const loadMensajes = async (id: string) => {
    setMensajes(null);
    setHasMoreMensajes(false);
    loadingOlderMensajesRef.current = false;
    setLoadingOlderMensajes(false);
    const r = await fetch(`/api/whatsapp/conversaciones/${id}/mensajes`);
    if (!r.ok) return;
    const d = await r.json();
    const msgs: WhatsAppMensaje[] = d.mensajes || [];
    setMensajes(msgs);
    setHasMoreMensajes(msgs.length >= WHATSAPP_PAGE_SIZE);
    marcarVistos(id);
  };

  // Scroll-up: trae los mensajes anteriores al más antiguo cargado (cursor `before`, ya soportado
  // por el backend pero nunca usado desde aquí — el historial estaba limitado a los últimos 50).
  const loadMensajesAnteriores = useCallback(async () => {
    if (!activeConversacion || loadingOlderMensajesRef.current) return;
    // Cursor = id del mensaje más viejo REAL (no uno optimista `temp-`, que el servidor no conoce).
    const masViejo = mensajes?.find((m) => !m.id.startsWith("temp-"));
    if (!masViejo) return;
    loadingOlderMensajesRef.current = true;
    setLoadingOlderMensajes(true);
    try {
      const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/mensajes?before=${encodeURIComponent(masViejo.id)}`);
      if (!r.ok) return;
      const d = await r.json();
      const anteriores: WhatsAppMensaje[] = Array.isArray(d.mensajes) ? d.mensajes : [];
      if (anteriores.length) setMensajes((cur) => mergeMensajes(cur || [], anteriores));
      setHasMoreMensajes(anteriores.length >= WHATSAPP_PAGE_SIZE);
    } catch {
      // silencioso: el usuario puede reintentar scrolleando de nuevo
    } finally {
      loadingOlderMensajesRef.current = false;
      setLoadingOlderMensajes(false);
    }
  }, [activeConversacion, mensajes]);

  // Actualiza en memoria la vista previa de UNA conversación de la lista (último mensaje, hora, no
  // leídos) sin volver a pedirle nada al servidor — la reordena al tope, igual que hace el propio
  // ORDER BY del backend con el mensaje más reciente. Devuelve false si esa conversación no está
  // en la página actual (filtrada, o recién creada): ese es el único caso que sí amerita recargar.
  const patchConversacionPreview = (
    conversacionId: string,
    msg: { contenido?: string | null; tipo: string; direccion: "entrante" | "saliente"; created_at: string },
    opts?: { incrementarNoLeidos?: boolean }
  ): boolean => {
    if (!conversacionesRef.current?.some((c) => c.id === conversacionId)) return false;
    setConversaciones((cur) => {
      if (!cur) return cur;
      const i = cur.findIndex((c) => c.id === conversacionId);
      if (i === -1) return cur;
      const actualizada: ConversacionItem = {
        ...cur[i],
        ultimo_mensaje_preview: previewDe(msg),
        ultimo_mensaje_at: msg.created_at,
        ultimo_mensaje_direccion: msg.direccion,
        no_leidos_count: opts?.incrementarNoLeidos ? cur[i].no_leidos_count + 1 : cur[i].no_leidos_count,
      };
      return [actualizada, ...cur.slice(0, i), ...cur.slice(i + 1)];
    });
    return true;
  };

  // "Visto por el equipo": el servidor ya lo marca en la base al llamar "leer" — esto solo
  // refleja el cambio de una vez en la pantalla de quien está mirando, sin esperar al próximo
  // refresco (otro miembro del equipo lo verá recién en el suyo, ver docs/ROADMAP.md).
  const marcarVistos = (conversacionId: string) => {
    fetch(`/api/whatsapp/conversaciones/${conversacionId}/leer`, { method: "POST" }).catch(() => {});
    const ahora = new Date().toISOString();
    setMensajes((cur) => cur ? cur.map((m) => (m.direccion === "entrante" && !m.visto_at) ? { ...m, visto_at: ahora } : m) : cur);
  };

  useEffect(() => { loadConexiones(); loadEtapasYTags(); loadUsuarios(); }, []);

  // Debounce del buscador (350ms) — evita una petición por cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Al cambiar de conexión o de filtro se limpia la conversación abierta — SALVO cuando el
  // cambio de conexión lo disparó abrir un enlace directo (`?conversacion=`, ver más abajo), que
  // ya sabe exactamente qué conversación quiere dejar abierta y no quiere que este efecto se la
  // borre en el mismo tick.
  const saltarProximoResetRef = useRef(false);
  useEffect(() => {
    loadConversaciones();
    if (saltarProximoResetRef.current) saltarProximoResetRef.current = false;
    else { setActiveConversacion(null); setMensajes(null); }
  }, [activeConexionId, etapaFiltro, tagFiltro, soloAsignadasAMi, busquedaDebounced]);

  // "Contactar por WhatsApp" desde /contactos/[id] llega aquí como `?conversacion=<id>` — abrirla
  // directo, sin depender del filtro de etapa actual, y limpiar la URL para que un refresco no la
  // vuelva a abrir sola.
  useEffect(() => {
    const conversacionId = searchParams.get("conversacion");
    if (!conversacionId) return;
    (async () => {
      const r = await fetch(`/api/whatsapp/conversaciones/${conversacionId}`);
      if (!r.ok) return;
      const d = await r.json();
      saltarProximoResetRef.current = true;
      setEtapaFiltro(null);
      setActiveConexionId(d.conversacion.conexion_id);
      setActiveConversacion(d.conversacion);
      loadMensajes(conversacionId);
    })();
    router.replace("/whatsapp");
    // Solo al montar: es un parámetro de entrada, no algo a re-evaluar en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeConversacionIdRef = useRef<string | null>(null);
  activeConversacionIdRef.current = activeConversacion?.id ?? null;
  const activeConexionIdRef = useRef<string | null>(null);
  activeConexionIdRef.current = activeConexionId;

  // Refrescos automáticos (poll), igual patrón que Correo (`app/correo/page.tsx`): el tiempo real
  // por socket es la vía principal, pero justo al conectar un número Baileys tarda unos segundos
  // en procesar sus primeros mensajes de sincronización — un refresco de respaldo evita que la
  // lista se quede parada si ese primer vistazo cae antes de que exista nada que mostrar, o si
  // por lo que sea se pierde algún evento en tiempo real.
  const loadConexionesRef = useRef(loadConexiones);
  const loadConversacionesRef = useRef(loadConversaciones);
  loadConexionesRef.current = loadConexiones;
  loadConversacionesRef.current = loadConversaciones;
  useEffect(() => {
    const refresh = () => { loadConexionesRef.current(); loadConversacionesRef.current({ silent: true }); };
    const tick = () => { if (typeof document === "undefined" || document.visibilityState === "visible") refresh(); };
    const id = setInterval(tick, 15000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onEstado = (ev: any) => {
      setConexiones((cur) => cur.map((c) => c.id === ev.conexion_id ? { ...c, estado: ev.estado, telefono: ev.telefono || c.telefono, ultimo_error: ev.error || null } : c));
    };
    // El canal en vivo no admite eventos grandes: un mensaje muy largo llega solo con su id
    // (`recargar`) y se pide completo antes de mostrarlo.
    const completar = async (ev: any): Promise<any | null> => {
      if (!ev.recargar) return ev.mensaje;
      try {
        const r = await fetch(`/api/whatsapp/mensajes/${ev.mensaje.id}`);
        return r.ok ? (await r.json()).mensaje : null;
      } catch { return null; }
    };
    const onMensaje = async (ev: any) => {
      const mensaje = await completar(ev);
      if (!mensaje) { loadConversacionesRef.current({ silent: true }); return; }
      ev = { ...ev, mensaje };
      if (ev.conexion_id === activeConexionIdRef.current) {
        const esActiva = ev.conversacion_id === activeConversacionIdRef.current;
        // Antes: recargaba TODA la lista de conversaciones por cada mensaje que llegaba — con la
        // bandeja abierta y varios mensajes seguidos, eso se sentía como el "delay" reportado.
        // Ahora se parcha en memoria solo la fila que cambió; solo si no está en la página actual
        // (conversación nueva, o filtrada) se recurre al servidor.
        const parchada = patchConversacionPreview(ev.conversacion_id, ev.mensaje, {
          incrementarNoLeidos: ev.mensaje.direccion === "entrante" && !esActiva,
        });
        if (!parchada) loadConversacionesRef.current({ silent: true });
      }
      if (ev.conversacion_id === activeConversacionIdRef.current) {
        setMensajes((cur) => mergeMensajes(cur || [], [ev.mensaje]));
        marcarVistos(ev.conversacion_id);
      }
    };
    const onMensajeEstado = (ev: any) => {
      if (ev.conversacion_id !== activeConversacionIdRef.current) return;
      setMensajes((cur) => cur ? cur.map((m) => m.id === ev.mensaje_id ? { ...m, estado_entrega: ev.estado } : m) : cur);
    };
    // Resuelta bajo demanda (una conversación vieja sin actividad no la tenía) — se actualiza en
    // vivo sin esperar al próximo refresco automático.
    const onFotoPerfil = (ev: any) => {
      if (ev.conversacion_id === activeConversacionIdRef.current) {
        setActiveConversacion((c) => c ? { ...c, foto_perfil_url: ev.foto_perfil_url } : c);
      }
      setConversaciones((cur) => cur ? cur.map((c) => c.id === ev.conversacion_id ? { ...c, foto_perfil_url: ev.foto_perfil_url } : c) : cur);
    };
    // El directorio de contactos de WhatsApp llega solo, no bajo pedido — puede corregir el
    // nombre o el número real de una conversación que ya está abierta o en la lista, mucho después
    // de haberse creado. El aviso solo trae el id, así que se refresca lo que haga falta.
    const onContactoResuelto = (ev: any) => {
      if (ev.conversacion_id === activeConversacionIdRef.current) loadConversacionDetalle(ev.conversacion_id);
      loadConversacionesRef.current({ silent: true });
    };
    // Reacción, borrado, edición o media recién descargada: se reemplaza el mensaje en pantalla.
    const onMensajeActualizado = async (ev: any) => {
      if (ev.conversacion_id !== activeConversacionIdRef.current) {
        if (ev.conexion_id === activeConexionIdRef.current) loadConversacionesRef.current({ silent: true });
        return;
      }
      const mensaje = await completar(ev);
      if (mensaje) setMensajes((cur) => cur ? cur.map((m) => (m.id === mensaje.id ? mensaje : m)) : cur);
    };
    // Importación del historial al vincular el número: llegan cientos de chats; la bandeja se
    // recarga (como mucho cada 3 s, lo limita el servidor) en vez de procesar uno por uno.
    const onHistorial = (ev: any) => {
      if (ev.conexion_id !== activeConexionIdRef.current) return;
      loadConversacionesRef.current({ silent: true });
      const abierta = activeConversacionIdRef.current;
      if (abierta) {
        fetch(`/api/whatsapp/conversaciones/${abierta}/mensajes`).then((r) => (r.ok ? r.json() : null)).then((d) => {
          if (d && activeConversacionIdRef.current === abierta) setMensajes((cur) => mergeMensajes(cur || [], d.mensajes || []));
        }).catch(() => {});
      }
    };
    const onMediaError = (ev: any) => {
      if (ev.conversacion_id !== activeConversacionIdRef.current) return;
      toast.error("No se pudo descargar el archivo", { description: "Puede que ya no esté en el teléfono. Pídele al contacto que lo reenvíe." });
    };
    // Al RE-conectar (wifi que vuelve, laptop que despierta) los eventos emitidos durante el corte
    // se perdieron: se vuelve a pedir la lista y la última página del hilo abierto, y se fusiona
    // por id — los mensajes nuevos aparecen y los checks que avanzaron se actualizan, sin esperar
    // al sondeo de respaldo de 15 s ni duplicar nada.
    let yaConecto = socket.connected;
    const onConnect = () => {
      setEnVivo(true);
      if (!yaConecto) { yaConecto = true; return; }
      loadConexionesRef.current();
      loadConversacionesRef.current({ silent: true });
      const abierta = activeConversacionIdRef.current;
      if (abierta) {
        fetch(`/api/whatsapp/conversaciones/${abierta}/mensajes`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d || activeConversacionIdRef.current !== abierta) return;
            setMensajes((cur) => mergeMensajes(cur || [], d.mensajes || []));
          })
          .catch(() => {});
      }
    };
    const onDisconnect = () => setEnVivo(false);
    if (!socket.connected) setEnVivo(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("whatsapp:estado", onEstado);
    socket.on("whatsapp:mensaje", onMensaje);
    socket.on("whatsapp:mensaje-estado", onMensajeEstado);
    socket.on("whatsapp:foto-perfil", onFotoPerfil);
    socket.on("whatsapp:contacto-resuelto", onContactoResuelto);
    socket.on("whatsapp:mensaje-actualizado", onMensajeActualizado);
    socket.on("whatsapp:historial", onHistorial);
    socket.on("whatsapp:media-error", onMediaError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("whatsapp:estado", onEstado);
      socket.off("whatsapp:mensaje", onMensaje);
      socket.off("whatsapp:mensaje-estado", onMensajeEstado);
      socket.off("whatsapp:foto-perfil", onFotoPerfil);
      socket.off("whatsapp:contacto-resuelto", onContactoResuelto);
      socket.off("whatsapp:mensaje-actualizado", onMensajeActualizado);
      socket.off("whatsapp:historial", onHistorial);
      socket.off("whatsapp:media-error", onMediaError);
    };
  }, []);

  const seleccionarConversacion = (c: ConversacionItem) => {
    loadConversacionDetalle(c.id);
    loadMensajes(c.id);
    setConversaciones((cur) => cur ? cur.map((x) => x.id === c.id ? { ...x, no_leidos_count: 0 } : x) : cur);
  };

  // Abrir una conversación desde el tablero: puede no estar en la lista filtrada actual (el
  // tablero no aplica el filtro de etapa), así que se carga directo por id, igual que el enlace
  // profundo `?conversacion=`.
  const abrirDesdeKanban = (conversacionId: string) => {
    setVista("lista");
    loadConversacionDetalle(conversacionId);
    loadMensajes(conversacionId);
  };

  // Media del historial (o que no se pudo bajar en vivo): el worker la descarga y la reemplaza en
  // pantalla vía `whatsapp:mensaje-actualizado`.
  const descargarMedia = async (m: WhatsAppMensaje) => {
    const r = await fetch(`/api/whatsapp/mensajes/${m.id}/descargar`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(d.error || "No se pudo pedir la descarga"); return; }
    if (d.mensaje) setMensajes((cur) => cur ? cur.map((x) => (x.id === d.mensaje.id ? d.mensaje : x)) : cur);
  };

  const enviarMensaje = async (d: { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string; archivoTamanio?: number }) => {
    if (!activeConversacion) return;
    // Envío optimista: la burbuja aparece de inmediato con estado "pendiente" (como WhatsApp Web)
    // en vez de esperar la respuesta del servidor, y se reconcilia (o se marca "fallido") después.
    const conversacionId = activeConversacion.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimista: WhatsAppMensaje = {
      id: tempId,
      conversacion_id: conversacionId,
      wa_message_id: null,
      direccion: "saliente",
      tipo: d.tipo as WhatsAppMensaje["tipo"],
      contenido: d.contenido ?? null,
      archivo_url: d.archivoUrl ?? null,
      archivo_nombre: d.archivoNombre ?? null,
      archivo_tipo: null,
      archivo_tamanio: d.archivoTamanio ?? null,
      estado_entrega: "pendiente",
      created_at: new Date().toISOString(),
      visto_at: null,
      visto_por: null,
    };
    setMensajes((cur) => cur ? [...cur, optimista] : [optimista]);
    try {
      const r = await fetch(`/api/whatsapp/conversaciones/${conversacionId}/mensajes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d),
      });
      const dd = await r.json();
      if (!r.ok) throw new Error(dd.error || "No se pudo enviar");
      setMensajes((cur) => cur ? cur.map((m) => (m.id === tempId ? dd.mensaje : m)) : [dd.mensaje]);
      // `enviarMensaje` (backend) no emite whatsapp:mensaje por socket (ese evento es solo para lo
      // entrante) — la propia vista previa de la lista se parcha aquí mismo, sin ida al servidor.
      if (!patchConversacionPreview(conversacionId, dd.mensaje, {})) loadConversaciones({ silent: true });
    } catch (e) {
      setMensajes((cur) => cur ? cur.map((m) => (m.id === tempId ? { ...m, estado_entrega: "fallido" as const } : m)) : cur);
      throw e;
    }
  };

  // Reintentar un mensaje fallido reutiliza el mismo endpoint de envío (no existe uno de
  // "reintentar" aparte) y reemplaza la burbuja fallida por el intento nuevo.
  const reintentarMensaje = async (m: WhatsAppMensaje) => {
    try {
      await enviarMensaje({
        tipo: m.tipo,
        contenido: m.contenido ?? undefined,
        archivoUrl: m.archivo_url ?? undefined,
        archivoNombre: m.archivo_nombre ?? undefined,
        archivoTamanio: m.archivo_tamanio ?? undefined,
      });
      setMensajes((cur) => cur ? cur.filter((x) => x.id !== m.id) : cur);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo reintentar el envío");
    }
  };

  const cambiarEtapa = async (etapaId: string) => {
    if (!activeConversacion) return;
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/etapa`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa_id: etapaId }),
    });
    if (r.ok) {
      setActiveConversacion((c) => c ? { ...c, etapa_id: etapaId } : c);
      loadConversaciones({ silent: true });
      const etapa = etapas.find((e) => e.id === etapaId);
      if (etapa?.es_ganado) { celebrar(undefined, undefined, etapa.color); toast.success("¡Cliente ganado! 🎉"); }
    } else toast.error("No se pudo cambiar la etapa");
  };

  const asignar = async (userId: string | null) => {
    if (!activeConversacion) return;
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/asignar`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asignado_a: userId }),
    });
    if (r.ok) { setActiveConversacion((c) => c ? { ...c, asignado_a: userId } : c); loadConversaciones({ silent: true }); }
    else toast.error("No se pudo asignar la conversación");
  };

  const toggleTag = async (t: WhatsAppTag) => {
    if (!activeConversacion) return;
    const yaTiene = activeConversacion.tags.some((x) => x.id === t.id);
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/tags${yaTiene ? `/${t.id}` : ""}`, {
      method: yaTiene ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: yaTiene ? undefined : JSON.stringify({ tag_id: t.id }),
    });
    if (r.ok) {
      const dd = await r.json();
      setActiveConversacion((c) => c ? { ...c, tags: dd.tags } : c);
      loadConversaciones({ silent: true });
    }
  };

  const vincularContacto = async (contactoId: string) => {
    if (!activeConversacion) return;
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/vincular-contacto`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacto_id: contactoId }),
    });
    const dd = await r.json();
    if (!r.ok) throw new Error(dd.error || "No se pudo vincular");
    setActiveConversacion((c) => c ? { ...c, contacto_id: contactoId, contacto_vinculo_estado: "vinculado_manual" } : c);
    setVincularOpen(false);
    toast.success("Contacto vinculado");
    loadConversaciones({ silent: true });
  };

  const crearTag = async (nombre: string, color: string) => {
    const r = await fetch("/api/whatsapp/tags", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, color }),
    });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || "No se pudo crear la etiqueta"); return; }
    setTags((cur) => [...cur, d.tag]);
    await toggleTag(d.tag);
  };

  const convertir = async (d: { nombreCaso: string; valorTotal?: number }) => {
    if (!activeConversacion) return;
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/convertir`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre_caso: d.nombreCaso, valor_total: d.valorTotal }),
    });
    const dd = await r.json();
    if (!r.ok) throw new Error(dd.error || "No se pudo convertir");
    setActiveConversacion((c) => c ? { ...c, oportunidad_id: dd.oportunidad.id } : c);
  };

  const desconectar = async () => {
    if (!desconectarTarget) return;
    await fetch(`/api/whatsapp/conexiones/${desconectarTarget.id}`, { method: "DELETE" });
    toast.success("Conexión desconectada");
    if (activeConexionId === desconectarTarget.id) setActiveConexionId(null);
    setDesconectarTarget(null);
    loadConexiones();
  };

  return (
    <AppShell>
      {/* dvh y no vh: en móvil 100vh incluye la barra del navegador y el compositor quedaba tapado. */}
      <div
        className="h-[calc(100dvh-4rem)] flex flex-col overflow-hidden relative isolate"
        style={{ ["--wa-c" as any]: etapas.find((e) => e.id === activeConversacion?.etapa_id)?.color || "#5750E8" }}
      >
        {/* Aurora de fondo: toma el color de la etapa del embudo del chat abierto. */}
        <div className="wa-aurora -z-10" aria-hidden="true"><i /><i /><i /></div>
        {!enVivo && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 wa-menu-in pointer-events-none">
            <div className="flex items-center gap-2 rounded-full glass-panel px-3 py-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 shadow-md">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              Reconectando… los mensajes se sincronizan al volver
            </div>
          </div>
        )}
        {vista === "tablero" ? (
          <>
            <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 glass-topbar">
              <ConnectionSwitcher
                conexiones={conexiones}
                activeId={activeConexionId}
                onSelect={setActiveConexionId}
                onConnectNew={() => setConnectOpen(true)}
                onDesconectar={(c) => setDesconectarTarget(c)}
              />
              <div className="flex-1" />
              <button
                onClick={() => setVista("lista")}
                title="Volver a la lista"
                className="h-8 px-3 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1.5 text-[11px] font-ui font-bold uppercase tracking-wider text-brand-primary transition shrink-0"
              >
                <List className="h-3.5 w-3.5" /> Lista
              </button>
            </div>
            <WhatsappKanban conexionId={activeConexionId} etapas={etapas} onAbrirConversacion={abrirDesdeKanban} />
          </>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className={cn("w-full lg:w-[380px] shrink-0 border-r border-black/5 dark:border-white/10 flex-col", activeConversacion ? "hidden lg:flex" : "flex")}>
              <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 glass-topbar">
                <ConnectionSwitcher
                  conexiones={conexiones}
                  activeId={activeConexionId}
                  onSelect={setActiveConexionId}
                  onConnectNew={() => setConnectOpen(true)}
                  onDesconectar={(c) => setDesconectarTarget(c)}
                />
                <button
                  onClick={() => setVista("tablero")}
                  title="Vista de tablero"
                  className="hidden lg:flex h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 items-center justify-center text-neutral-500 shrink-0 transition"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
              <ConversationList
                conversaciones={conversaciones}
                etapas={etapas}
                tags={tags}
                selectedId={activeConversacion?.id ?? null}
                etapaFiltro={etapaFiltro}
                onEtapaFiltroChange={setEtapaFiltro}
                tagFiltro={tagFiltro}
                onTagFiltroChange={setTagFiltro}
                soloAsignadasAMi={soloAsignadasAMi}
                onToggleSoloAsignadasAMi={() => setSoloAsignadasAMi((v) => !v)}
                busqueda={busqueda}
                onBusquedaChange={setBusqueda}
                onSelect={seleccionarConversacion}
                loading={loadingConv}
              />
            </div>

            <div className={cn("flex-1 min-w-0 flex-col", activeConversacion ? "flex" : "hidden lg:flex")}>
              {activeConversacion ? (
                <ConversationThread
                  // Montaje nuevo por conversación: entra animada, vuelve al fondo del hilo y el
                  // borrador del compositor no se "pasa" de un chat a otro.
                  key={activeConversacion.id}
                  conversacion={activeConversacion}
                  mensajes={mensajes}
                  etapas={etapas}
                  tags={tags}
                  usuarios={usuarios}
                  conectado={activeConexion?.estado === "conectado"}
                  hasMore={hasMoreMensajes}
                  loadingOlder={loadingOlderMensajes}
                  onLoadOlder={loadMensajesAnteriores}
                  onBack={() => setActiveConversacion(null)}
                  onSend={enviarMensaje}
                  onRetry={reintentarMensaje}
                  onCambiarEtapa={cambiarEtapa}
                  onAsignar={asignar}
                  onToggleTag={toggleTag}
                  onCrearTag={crearTag}
                  onAbrirPerfil={() => setPerfilOpen(true)}
                  onDescargar={descargarMedia}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 chat-bg">
                  <div className="h-16 w-16 rounded-2xl glass-panel text-brand-green flex items-center justify-center">
                    <WhatsappLogo className="h-7 w-7" weight="duotone" />
                  </div>
                  <p className="text-sm font-bold font-display">Selecciona una conversación</p>
                  <p className="text-xs text-neutral-500 max-w-[260px]">
                    {conexiones.length === 0 ? "Conecta un número de WhatsApp para empezar a recibir leads." : "Elige un chat de la lista para verlo aquí."}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {connectOpen && (
        <ConnectWhatsAppModal
          onClose={() => setConnectOpen(false)}
          onConnected={(conexionId) => {
            setConnectOpen(false);
            // Fijar explícitamente la conexión recién emparejada (no depender de que antes no
            // hubiera ninguna activa) y refrescarla — Baileys puede tardar unos segundos en
            // procesar sus primeros mensajes, así que el refresco automático de arriba se encarga
            // de traerlos si esta primera foto llega antes de que existan.
            setActiveConexionId(conexionId);
            loadConexiones();
          }}
        />
      )}
      {perfilOpen && activeConversacion && (
        <PerfilConversacionModal
          conversacion={activeConversacion}
          onClose={() => setPerfilOpen(false)}
          onVincular={() => { setPerfilOpen(false); setVincularOpen(true); }}
          onConvertir={() => { setPerfilOpen(false); setConvertirOpen(true); }}
        />
      )}
      {vincularOpen && activeConversacion && (
        <VincularContactoModal
          onClose={() => setVincularOpen(false)}
          onVinculado={vincularContacto}
          nombreSugerido={activeConversacion.nombre_whatsapp || undefined}
          telefonoSugerido={(() => {
            const { texto, bandera } = formatearNumeroWhatsApp(activeConversacion.telefono_real || activeConversacion.wa_jid);
            return bandera ? texto : ""; // sin bandera = no hay número real que precargar
          })()}
        />
      )}
      {convertirOpen && activeConversacion && (
        <ConvertToOportunidadModal
          nombreSugerido={activeConversacion.nombre_whatsapp || "Caso desde WhatsApp"}
          onClose={() => setConvertirOpen(false)}
          onConvertido={convertir}
        />
      )}
      {desconectarTarget && (
        <ConfirmDialog
          danger
          title="Desconectar WhatsApp"
          message={<>¿Desconectar <strong className="text-neutral-800 dark:text-neutral-100">{desconectarTarget.nombre}</strong>? El historial de conversaciones se conserva; tendrás que volver a escanear un QR para reconectar.</>}
          confirmLabel="Desconectar"
          onConfirm={desconectar}
          onCancel={() => setDesconectarTarget(null)}
        />
      )}
    </AppShell>
  );
}
