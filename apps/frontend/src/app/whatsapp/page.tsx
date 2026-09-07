"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";
import { WhatsappLogo } from "@/lib/bootstrap-icons";
import { ConnectionSwitcher } from "@/components/whatsapp/ConnectionSwitcher";
import { ConnectWhatsAppModal } from "@/components/whatsapp/ConnectWhatsAppModal";
import { ConversationList, type ConversacionItem } from "@/components/whatsapp/ConversationList";
import { ConversationThread } from "@/components/whatsapp/ConversationThread";
import { PerfilConversacionModal } from "@/components/whatsapp/PerfilConversacionModal";
import { VincularContactoModal } from "@/components/whatsapp/VincularContactoModal";
import { ConvertToOportunidadModal } from "@/components/whatsapp/ConvertToOportunidadModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { WhatsAppConexion, WhatsAppConversacionDetalle, WhatsAppMensaje, WhatsAppPipelineStage, WhatsAppTag } from "@/components/whatsapp/types";

export default function WhatsAppPage() {
  const [conexiones, setConexiones] = useState<WhatsAppConexion[]>([]);
  const [activeConexionId, setActiveConexionId] = useState<string | null>(null);
  const [etapas, setEtapas] = useState<WhatsAppPipelineStage[]>([]);
  const [tags, setTags] = useState<WhatsAppTag[]>([]);
  const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
  const [conversaciones, setConversaciones] = useState<ConversacionItem[] | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [activeConversacion, setActiveConversacion] = useState<WhatsAppConversacionDetalle | null>(null);
  const [mensajes, setMensajes] = useState<WhatsAppMensaje[] | null>(null);

  const [connectOpen, setConnectOpen] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [convertirOpen, setConvertirOpen] = useState(false);
  const [desconectarTarget, setDesconectarTarget] = useState<WhatsAppConexion | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const activeConexion = useMemo(() => conexiones.find((c) => c.id === activeConexionId) || null, [conexiones, activeConexionId]);

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

  const loadConversaciones = async (opts?: { silent?: boolean }) => {
    if (!activeConexionId) { setConversaciones([]); return; }
    if (!opts?.silent) setLoadingConv(true);
    try {
      const params = new URLSearchParams();
      if (etapaFiltro) params.set("etapa", etapaFiltro);
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
    const r = await fetch(`/api/whatsapp/conversaciones/${id}/mensajes`);
    if (!r.ok) return;
    const d = await r.json();
    setMensajes(d.mensajes || []);
    marcarVistos(id);
  };

  // "Visto por el equipo": el servidor ya lo marca en la base al llamar "leer" — esto solo
  // refleja el cambio de una vez en la pantalla de quien está mirando, sin esperar al próximo
  // refresco (otro miembro del equipo lo verá recién en el suyo, ver docs/ROADMAP.md).
  const marcarVistos = (conversacionId: string) => {
    fetch(`/api/whatsapp/conversaciones/${conversacionId}/leer`, { method: "POST" }).catch(() => {});
    const ahora = new Date().toISOString();
    setMensajes((cur) => cur ? cur.map((m) => (m.direccion === "entrante" && !m.visto_at) ? { ...m, visto_at: ahora } : m) : cur);
  };

  useEffect(() => { loadConexiones(); loadEtapasYTags(); }, []);

  // Al cambiar de conexión o de filtro se limpia la conversación abierta — SALVO cuando el
  // cambio de conexión lo disparó abrir un enlace directo (`?conversacion=`, ver más abajo), que
  // ya sabe exactamente qué conversación quiere dejar abierta y no quiere que este efecto se la
  // borre en el mismo tick.
  const saltarProximoResetRef = useRef(false);
  useEffect(() => {
    loadConversaciones();
    if (saltarProximoResetRef.current) saltarProximoResetRef.current = false;
    else { setActiveConversacion(null); setMensajes(null); }
  }, [activeConexionId, etapaFiltro]);

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
    const onMensaje = (ev: any) => {
      if (ev.conexion_id === activeConexionIdRef.current) loadConversaciones({ silent: true });
      if (ev.conversacion_id === activeConversacionIdRef.current) {
        setMensajes((cur) => cur ? [...cur, ev.mensaje] : [ev.mensaje]);
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
    socket.on("whatsapp:estado", onEstado);
    socket.on("whatsapp:mensaje", onMensaje);
    socket.on("whatsapp:mensaje-estado", onMensajeEstado);
    socket.on("whatsapp:foto-perfil", onFotoPerfil);
    socket.on("whatsapp:contacto-resuelto", onContactoResuelto);
    return () => {
      socket.off("whatsapp:estado", onEstado);
      socket.off("whatsapp:mensaje", onMensaje);
      socket.off("whatsapp:mensaje-estado", onMensajeEstado);
      socket.off("whatsapp:foto-perfil", onFotoPerfil);
      socket.off("whatsapp:contacto-resuelto", onContactoResuelto);
    };
  }, []);

  const seleccionarConversacion = (c: ConversacionItem) => {
    loadConversacionDetalle(c.id);
    loadMensajes(c.id);
    setConversaciones((cur) => cur ? cur.map((x) => x.id === c.id ? { ...x, no_leidos_count: 0 } : x) : cur);
  };

  const enviarMensaje = async (d: { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string }) => {
    if (!activeConversacion) return;
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/mensajes`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d),
    });
    const dd = await r.json();
    if (!r.ok) throw new Error(dd.error || "No se pudo enviar");
    setMensajes((cur) => cur ? [...cur, dd.mensaje] : [dd.mensaje]);
    loadConversaciones({ silent: true });
  };

  const cambiarEtapa = async (etapaId: string) => {
    if (!activeConversacion) return;
    const r = await fetch(`/api/whatsapp/conversaciones/${activeConversacion.id}/etapa`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa_id: etapaId }),
    });
    if (r.ok) { setActiveConversacion((c) => c ? { ...c, etapa_id: etapaId } : c); loadConversaciones({ silent: true }); }
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
      <div className="h-[calc(100vh-4rem)] flex overflow-hidden relative">
        <div className={cn("w-full lg:w-[380px] shrink-0 border-r border-black/5 dark:border-white/10 flex-col", activeConversacion ? "hidden lg:flex" : "flex")}>
          <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-black/5 dark:border-white/10">
            <ConnectionSwitcher
              conexiones={conexiones}
              activeId={activeConexionId}
              onSelect={setActiveConexionId}
              onConnectNew={() => setConnectOpen(true)}
              onDesconectar={(c) => setDesconectarTarget(c)}
            />
          </div>
          <ConversationList
            conversaciones={conversaciones}
            etapas={etapas}
            selectedId={activeConversacion?.id ?? null}
            etapaFiltro={etapaFiltro}
            onEtapaFiltroChange={setEtapaFiltro}
            onSelect={seleccionarConversacion}
            loading={loadingConv}
          />
        </div>

        <div className={cn("flex-1 min-w-0 flex-col", activeConversacion ? "flex" : "hidden lg:flex")}>
          {activeConversacion ? (
            <ConversationThread
              conversacion={activeConversacion}
              mensajes={mensajes}
              etapas={etapas}
              tags={tags}
              conectado={activeConexion?.estado === "conectado"}
              onBack={() => setActiveConversacion(null)}
              onSend={enviarMensaje}
              onCambiarEtapa={cambiarEtapa}
              onToggleTag={toggleTag}
              onCrearTag={crearTag}
              onAbrirPerfil={() => setPerfilOpen(true)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="h-16 w-16 rounded-2xl bg-brand-green/10 text-brand-green flex items-center justify-center">
                <WhatsappLogo className="h-7 w-7" weight="fill" />
              </div>
              <p className="text-sm font-bold">Selecciona una conversación</p>
              <p className="text-xs text-neutral-500 max-w-[260px]">
                {conexiones.length === 0 ? "Conecta un número de WhatsApp para empezar a recibir leads." : "Elige un chat de la lista para verlo aquí."}
              </p>
            </div>
          )}
        </div>
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
