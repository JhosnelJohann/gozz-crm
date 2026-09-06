"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowLeft, Link2, Briefcase, CaretDown, Tag as TagIcon, Check } from "@/lib/bootstrap-icons";
import { MessageStatus, type Status } from "@/components/chat/MessageStatus";
import { FileMessage } from "@/components/chat/FileMessage";
import { AudioMessage } from "@/components/chat/AudioMessage";
import { ConversationComposer } from "./ConversationComposer";
import type { WhatsAppConversacionDetalle, WhatsAppMensaje, WhatsAppPipelineStage, WhatsAppTag } from "./types";

function estadoToStatus(e: WhatsAppMensaje["estado_entrega"]): Status {
  if (e === "leido") return "read";
  if (e === "entregado" || e === "enviado") return "delivered";
  return "sent";
}

function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
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
        </div>
      </div>
    </div>
  );
}

function StagePicker({ etapas, valor, onChange }: { etapas: WhatsAppPipelineStage[]; valor: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const actual = etapas.find((e) => e.id === valor);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-2.5 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
        style={{ backgroundColor: actual ? `${actual.color}1a` : undefined, color: actual?.color }}
      >
        {actual?.label || "Etapa"} <CaretDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-48 rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 overflow-hidden">
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

function TagPicker({ todas, activas, onToggle }: { todas: WhatsAppTag[]; activas: WhatsAppTag[]; onToggle: (t: WhatsAppTag) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center transition text-neutral-500">
        <TagIcon className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-52 rounded-xl bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 py-1 overflow-hidden max-h-64 overflow-y-auto">
            {todas.length === 0 && <div className="px-3 py-2 text-[11px] text-neutral-400">Sin tags creados aún</div>}
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
  onVincularContacto: () => void;
  onConvertir: () => void;
}

export function ConversationThread({
  conversacion, mensajes, etapas, tags, conectado, onBack, onSend, onCambiarEtapa, onToggleTag, onVincularContacto, onConvertir,
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
        <div className="h-9 w-9 rounded-full bg-brand-green/15 text-brand-green flex items-center justify-center font-bold text-sm shrink-0">
          {(conversacion.nombre_whatsapp || conversacion.wa_jid).slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">{conversacion.nombre_whatsapp || conversacion.wa_jid.split("@")[0]}</div>
          <div className="text-[10px] text-neutral-500 truncate">{conversacion.wa_jid.split("@")[0]}</div>
        </div>
        <TagPicker todas={tags} activas={conversacion.tags} onToggle={onToggleTag} />
        <StagePicker etapas={etapas} valor={conversacion.etapa_id} onChange={onCambiarEtapa} />
        {conversacion.contacto_id ? (
          <button onClick={onConvertir} disabled={!!conversacion.oportunidad_id} title={conversacion.oportunidad_id ? "Ya convertida" : "Convertir a Oportunidad"} className="h-8 px-2.5 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 text-brand-primary hover:bg-brand-primary/10 transition disabled:opacity-40">
            <Briefcase className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{conversacion.oportunidad_id ? "Convertida" : "Convertir"}</span>
          </button>
        ) : (
          <button onClick={onVincularContacto} title="Vincular a un contacto" className="h-8 px-2.5 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 text-neutral-500 hover:text-brand-primary hover:bg-black/5 dark:hover:bg-white/5 transition">
            <Link2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Vincular</span>
          </button>
        )}
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
