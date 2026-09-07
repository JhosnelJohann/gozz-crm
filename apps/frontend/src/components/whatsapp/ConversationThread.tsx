"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowLeft, CaretDown, Tag as TagIcon, Check, Plus, Eye } from "@/lib/bootstrap-icons";
import { MessageStatus, type Status } from "@/components/chat/MessageStatus";
import { FileMessage } from "@/components/chat/FileMessage";
import { AudioMessage } from "@/components/chat/AudioMessage";
import { ConversationComposer } from "./ConversationComposer";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";
import type { WhatsAppConversacionDetalle, WhatsAppMensaje, WhatsAppPipelineStage, WhatsAppTag } from "./types";

/** Colores predefinidos para crear un tag sin salir del chat — los mismos tonos que ya usa el
 * pipeline en otras partes del CRM, para que un tag nuevo no desentone. */
const COLORES_TAG = ["#5750E8", "#43A847", "#E53935", "#2196C9", "#FFB51C", "#33359D", "#8338EC"];

function estadoToStatus(e: WhatsAppMensaje["estado_entrega"]): Status {
  if (e === "leido") return "read";
  if (e === "entregado" || e === "enviado") return "delivered";
  return "sent";
}

function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function numeroConBandera(jid: string): string {
  const { texto, bandera } = formatearNumeroWhatsApp(jid);
  return bandera ? `${bandera} ${texto}` : texto;
}

function Bubble({ m }: { m: WhatsAppMensaje }) {
  const isMe = m.direccion === "saliente";
  return (
    <div className={cn("flex", isMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] sm:max-w-[65%] rounded-2xl px-3.5 py-2 shadow-sm",
          isMe ? "bg-brand-primary text-white rounded-br-sm" : "bg-white dark:bg-white/[0.06] rounded-bl-sm border border-black/5 dark:border-white/10"
        )}
      >
        {m.tipo === "texto" && <div className="text-sm whitespace-pre-wrap break-words">{m.contenido}</div>}
        {m.tipo === "imagen" && m.archivo_url && (
          <img src={m.archivo_url} alt="" className="rounded-lg max-w-[260px] max-h-[320px] object-cover" />
        )}
        {m.tipo === "video" && m.archivo_url && (
          <video src={m.archivo_url} controls className="rounded-lg max-w-[260px] max-h-[320px]" />
        )}
        {m.tipo === "audio" && m.archivo_url && (
          <AudioMessage url={m.archivo_url} filename={m.archivo_nombre} mime={m.archivo_tipo} isMe={isMe} />
        )}
        {m.tipo === "archivo" && m.archivo_url && (
          <FileMessage url={m.archivo_url} filename={m.archivo_nombre} mime={m.archivo_tipo} isMe={isMe} onVer={() => window.open(m.archivo_url!, "_blank")} />
        )}
        <div className={cn("flex items-center gap-1 justify-end mt-1 text-[10px]", isMe ? "text-white/70" : "text-neutral-400")}>
          {fmtHora(m.created_at)}
          {isMe && <MessageStatus status={m.estado_entrega === "fallido" ? "sent" : estadoToStatus(m.estado_entrega)} />}
          {/* "Visto por el equipo" — deliberadamente un ícono y color distintos del check de
              envío de arriba: uno es la confirmación de WhatsApp para lo que enviamos, este es
              que alguien del equipo ya vio, dentro del CRM, lo que el lead/cliente nos escribió. */}
          {!isMe && m.visto_at && (
            <span title="Visto por el equipo" className="inline-flex">
              <Eye className="h-3 w-3 text-neutral-400" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StagePicker({ etapas, valor, onChange }: { etapas: WhatsAppPipelineStage[]; valor: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const actual = etapas.find((e) => e.id === valor);
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={actual?.label || "Elegir etapa"}
        className="h-8 px-2 sm:px-2.5 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
        style={{ backgroundColor: actual ? `${actual.color}1a` : undefined, color: actual?.color }}
      >
        {/* Móvil: solo el punto de color — la etiqueta completa ("Conversación activa",
            "Tomando decisión"...) apretaba el nombre del contacto contra el resto de acciones
            del header en pantallas angostas. Desde `sm` se ve la etiqueta completa. */}
        {actual ? (
          <span className="h-2 w-2 rounded-full shrink-0 sm:hidden" style={{ backgroundColor: actual.color }} />
        ) : null}
        <span className="hidden sm:inline">{actual?.label || "Etapa"}</span>
        <CaretDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-52 max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 overflow-hidden">
            {etapas.map((e) => (
              <button
                key={e.id}
                onClick={() => { onChange(e.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                <span className="flex-1">{e.label}</span>
                {e.id === valor && <Check className="h-3.5 w-3.5 text-brand-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TagPicker({ todas, activas, onToggle, onCrear }: {
  todas: WhatsAppTag[]; activas: WhatsAppTag[]; onToggle: (t: WhatsAppTag) => void;
  onCrear: (nombre: string, color: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [colorNuevo, setColorNuevo] = useState(COLORES_TAG[0]);
  const [guardando, setGuardando] = useState(false);

  const confirmarCrear = async () => {
    if (nombreNuevo.trim().length < 1 || guardando) return;
    setGuardando(true);
    try {
      await onCrear(nombreNuevo.trim(), colorNuevo);
      setNombreNuevo("");
      setCreando(false);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} title="Etiquetas" className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center transition text-neutral-500 relative">
        <TagIcon className="h-4 w-4" />
        {activas.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-brand-primary text-white text-[8px] font-bold flex items-center justify-center">
            {activas.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setCreando(false); }} />
          <div className="absolute right-0 mt-1 z-20 w-56 max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 overflow-hidden">
            <div className="max-h-56 overflow-y-auto">
              {todas.length === 0 && !creando && <div className="px-3 py-2 text-[11px] text-neutral-400">Sin tags creados aún</div>}
              {todas.map((t) => {
                const on = activas.some((a) => a.id === t.id);
                return (
                  <button key={t.id} onClick={() => onToggle(t)} className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 truncate">{t.nombre}</span>
                    {on && <Check className="h-3.5 w-3.5 text-brand-primary" />}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-black/5 dark:border-white/10 mt-1 pt-1 px-2 pb-2">
              {creando ? (
                <div className="space-y-2 pt-1">
                  <input
                    autoFocus
                    value={nombreNuevo}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmarCrear()}
                    placeholder="Nombre de la etiqueta"
                    className="w-full h-8 px-2.5 rounded-lg bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {COLORES_TAG.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColorNuevo(c)}
                        style={{ backgroundColor: c }}
                        className={cn("h-5 w-5 rounded-full transition", colorNuevo === c && "ring-2 ring-offset-2 ring-black/30 dark:ring-offset-neutral-900")}
                      />
                    ))}
                  </div>
                  <button
                    onClick={confirmarCrear}
                    disabled={guardando || nombreNuevo.trim().length < 1}
                    className="w-full h-8 rounded-lg bg-brand-primary text-white text-xs font-semibold disabled:opacity-40 transition"
                  >
                    {guardando ? "Creando…" : "Crear etiqueta"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreando(true)}
                  className="w-full flex items-center gap-2 px-1 py-1.5 text-xs font-semibold text-brand-primary hover:bg-brand-primary/8 rounded-lg transition"
                >
                  <Plus className="h-3.5 w-3.5" /> Nueva etiqueta
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  conversacion: WhatsAppConversacionDetalle;
  mensajes: WhatsAppMensaje[] | null;
  etapas: WhatsAppPipelineStage[];
  tags: WhatsAppTag[];
  conectado: boolean;
  onBack?: () => void;
  onSend: (d: { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string }) => Promise<void>;
  onCambiarEtapa: (etapaId: string) => void;
  onToggleTag: (tag: WhatsAppTag) => void;
  onCrearTag: (nombre: string, color: string) => Promise<void>;
  onAbrirPerfil: () => void;
}

export function ConversationThread({
  conversacion, mensajes, etapas, tags, conectado, onBack, onSend, onCambiarEtapa, onToggleTag, onCrearTag, onAbrirPerfil,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [mensajes?.length, conversacion.id]);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-black/5 dark:border-white/10 glass-topbar">
        {onBack && (
          <button onClick={onBack} className="lg:hidden h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <button onClick={onAbrirPerfil} className="flex-1 min-w-0 flex items-center gap-2.5 text-left rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/5 transition" title="Ver perfil">
          <WhatsAppAvatar fotoUrl={conversacion.foto_perfil_url} nombre={conversacion.nombre_whatsapp || conversacion.wa_jid} size={36} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate">{conversacion.nombre_whatsapp || conversacion.wa_jid.split("@")[0]}</div>
            <div className="text-[10px] text-neutral-500 truncate">{numeroConBandera(conversacion.wa_jid)}</div>
          </div>
        </button>
        <TagPicker todas={tags} activas={conversacion.tags} onToggle={onToggleTag} onCrear={onCrearTag} />
        <StagePicker etapas={etapas} valor={conversacion.etapa_id} onChange={onCambiarEtapa} />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 chat-bg" data-lenis-prevent>
        {mensajes === null ? (
          <div className="h-full flex items-center justify-center text-xs text-neutral-400">Cargando…</div>
        ) : mensajes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-neutral-400">Todavía no hay mensajes en esta conversación</div>
        ) : (
          mensajes.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      <ConversationComposer onSend={onSend} disabled={!conectado} />
    </div>
  );
}
