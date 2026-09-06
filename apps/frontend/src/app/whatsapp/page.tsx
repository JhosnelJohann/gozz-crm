"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { List, WhatsappLogo } from "@/lib/bootstrap-icons";
import { ConexionesRail, type WhatsAppConexion } from "@/components/whatsapp/ConexionesRail";
import { ConnectWhatsAppModal } from "@/components/whatsapp/ConnectWhatsAppModal";
import { ConversationList, type ConversacionItem } from "@/components/whatsapp/ConversationList";
import { ConversationThread } from "@/components/whatsapp/ConversationThread";
import { VincularContactoModal } from "@/components/whatsapp/VincularContactoModal";
import { ConvertToOportunidadModal } from "@/components/whatsapp/ConvertToOportunidadModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { WhatsAppConversacionDetalle, WhatsAppMensaje, WhatsAppPipelineStage, WhatsAppTag } from "@/components/whatsapp/types";

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

  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [convertirOpen, setConvertirOpen] = useState(false);
  const [desconectarTarget, setDesconectarTarget] = useState<WhatsAppConexion | null>(null);

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
    fetch(`/api/whatsapp/conversaciones/${id}/leer`, { method: "POST" }).catch(() => {});
  };

  useEffect(() => { loadConexiones(); loadEtapasYTags(); }, []);
  useEffect(() => { loadConversaciones(); setActiveConversacion(null); setMensajes(null); }, [activeConexionId, etapaFiltro]);

  const activeConversacionIdRef = useRef<string | null>(null);
  activeConversacionIdRef.current = activeConversacion?.id ?? null;
  const activeConexionIdRef = useRef<string | null>(null);
  activeConexionIdRef.current = activeConexionId;

  useEffect(() => {
    const socket = getSocket();
    const onEstado = (ev: any) => {
      setConexiones((cur) => cur.map((c) => c.id === ev.conexion_id ? { ...c, estado: ev.estado, telefono: ev.telefono || c.telefono, ultimo_error: ev.error || null } : c));
    };
    const onMensaje = (ev: any) => {
      if (ev.conexion_id === activeConexionIdRef.current) loadConversaciones({ silent: true });
      if (ev.conversacion_id === activeConversacionIdRef.current) {
        setMensajes((cur) => cur ? [...cur, ev.mensaje] : [ev.mensaje]);
        fetch(`/api/whatsapp/conversaciones/${ev.conversacion_id}/leer`, { method: "POST" }).catch(() => {});
      }
    };
    const onMensajeEstado = (ev: any) => {
      if (ev.conversacion_id !== activeConversacionIdRef.current) return;
      setMensajes((cur) => cur ? cur.map((m) => m.id === ev.mensaje_id ? { ...m, estado_entrega: ev.estado } : m) : cur);
    };
    socket.on("whatsapp:estado", onEstado);
    socket.on("whatsapp:mensaje", onMensaje);
    socket.on("whatsapp:mensaje-estado", onMensajeEstado);
    return () => {
      socket.off("whatsapp:estado", onEstado);
      socket.off("whatsapp:mensaje", onMensaje);
      socket.off("whatsapp:mensaje-estado", onMensajeEstado);
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
        {mobileRailOpen && (
          <div onClick={() => setMobileRailOpen(false)} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden" />
        )}
        <div className={cn("z-50", mobileRailOpen ? "fixed inset-y-0 left-0 lg:static lg:inset-auto" : "hidden lg:block")}>
          <ConexionesRail
            conexiones={conexiones}
            activeId={activeConexionId}
            onSelect={(id) => { setActiveConexionId(id); setMobileRailOpen(false); }}
            onConnectNew={() => setConnectOpen(true)}
            onDesconectar={(c) => setDesconectarTarget(c)}
          />
        </div>

        <div className={cn("w-full lg:w-[340px] shrink-0 border-r border-black/5 dark:border-white/10 flex-col", activeConversacion ? "hidden lg:flex" : "flex")}>
          <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-black/5 dark:border-white/10">
            <button onClick={() => setMobileRailOpen(true)} className="lg:hidden h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
              <List className="h-4 w-4" weight="bold" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{activeConexion?.nombre || "Sin conexión"}</div>
              <div className="text-[10px] text-neutral-500 truncate">{activeConexion?.telefono || "—"}</div>
            </div>
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
              onVincularContacto={() => setVincularOpen(true)}
              onConvertir={() => setConvertirOpen(true)}
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
        <ConnectWhatsAppModal onClose={() => setConnectOpen(false)} onConnected={() => { setConnectOpen(false); loadConexiones(); }} />
      )}
      {vincularOpen && <VincularContactoModal onClose={() => setVincularOpen(false)} onVinculado={vincularContacto} />}
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
