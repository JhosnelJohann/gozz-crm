"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Paperclip, Send, Smile, Reply, Pencil, X, Check } from "@/lib/bootstrap-icons";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { ChatAudioRecorder } from "@/components/chat/AudioRecorder";
import type { WhatsAppMensaje } from "./types";
import { previewDe } from "@/lib/whatsapp-preview";

export type ModoComposer = { tipo: "respuesta" | "edicion"; m: WhatsAppMensaje } | null;
type Envio = { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string; archivoTamanio?: number; respuestaA?: string };

interface Props {
  onSend: (d: Envio) => Promise<void>;
  disabled?: boolean;
  /** Respondiendo a un mensaje (cita) o editando uno propio. */
  modo?: ModoComposer;
  onCancelarModo?: () => void;
  onEditar?: (m: WhatsAppMensaje, contenido: string) => Promise<void>;
  /** Se llama mientras se escribe (como mucho cada 4 s) para mostrarle al contacto "escribiendo…". */
  onEscribiendo?: () => void;
}

const vistaPrevia = (m: WhatsAppMensaje) => previewDe({ ...m, autor_nombre: null }) || "Mensaje";

export function ConversationComposer({ onSend, disabled, modo, onCancelarModo, onEditar, onEscribiendo }: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ultimoAvisoRef = useRef(0);
  const respuestaA = modo?.tipo === "respuesta" ? modo.m.wa_message_id ?? undefined : undefined;

  // Al entrar en modo edición se carga el texto original; al responder, se enfoca el campo.
  useEffect(() => {
    if (modo?.tipo === "edicion") setTexto(modo.m.contenido || "");
    if (modo) setTimeout(() => taRef.current?.focus(), 0);
  }, [modo?.tipo, modo?.m.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const avisarEscribiendo = () => {
    if (!onEscribiendo || Date.now() - ultimoAvisoRef.current < 4000) return;
    ultimoAvisoRef.current = Date.now();
    onEscribiendo();
  };

  const enviarTexto = async () => {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setTexto("");
    try {
      if (modo?.tipo === "edicion" && onEditar) await onEditar(modo.m, contenido);
      else await onSend({ tipo: "texto", contenido, respuestaA });
      onCancelarModo?.();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo enviar el mensaje");
      setTexto(contenido);
    } finally {
      setEnviando(false);
    }
  };

  const subirArchivo = async (file: File) => {
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/whatsapp/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo subir el archivo");
      const mime = (file.type || "").toLowerCase();
      const tipo = mime.startsWith("image/") ? "imagen" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "archivo";
      await onSend({ tipo, archivoUrl: d.url, archivoNombre: file.name, archivoTamanio: file.size, respuestaA });
      onCancelarModo?.();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo enviar el archivo");
    } finally {
      setEnviando(false);
    }
  };

  // Nota de voz: mismo pipeline que cualquier adjunto (sube a /api/whatsapp/upload, luego
  // enviarMensaje con tipo "audio") — la grabación en sí la resuelve por completo
  // `ChatAudioRecorder`, ya probado en el chat interno; aquí no se reescribe nada de eso.
  const subirAudio = async (file: File) => {
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/whatsapp/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo subir el audio");
      await onSend({ tipo: "audio", archivoUrl: d.url, archivoNombre: file.name, archivoTamanio: file.size, respuestaA });
      onCancelarModo?.();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo enviar el audio");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="shrink-0">
    {modo && (
      <div className="flex items-center gap-3 px-4 pt-2.5 pb-1 border-t border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] backdrop-blur-md wa-menu-in">
        <span className="h-8 w-8 rounded-full bg-brand-primary/12 text-brand-primary flex items-center justify-center shrink-0">
          {modo.tipo === "respuesta" ? <Reply className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </span>
        <div className="flex-1 min-w-0 border-l-[3px] border-brand-primary pl-2.5">
          <div className="text-[11px] font-bold text-brand-primary">{modo.tipo === "respuesta" ? (modo.m.direccion === "saliente" ? "Respondiendo a tu mensaje" : (modo.m.autor_nombre ? `Respondiendo a ${modo.m.autor_nombre}` : "Respondiendo al contacto")) : "Editando mensaje"}</div>
          <div className="text-xs text-neutral-500 truncate">{vistaPrevia(modo.m)}</div>
        </div>
        <button type="button" onClick={() => { onCancelarModo?.(); if (modo.tipo === "edicion") setTexto(""); }} className="h-8 w-8 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-neutral-500" aria-label="Cancelar">
          <X className="h-4 w-4" />
        </button>
      </div>
    )}
    <div className="border-t border-black/5 dark:border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-end gap-2 backdrop-blur-md bg-white/70 dark:bg-white/[0.03] relative">
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) subirArchivo(f); e.target.value = ""; }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={disabled || enviando}
        title="Adjuntar archivo"
        className="h-10 w-10 rounded-xl flex items-center justify-center text-neutral-500 hover:text-brand-primary hover:bg-black/5 dark:hover:bg-white/5 transition disabled:opacity-40 shrink-0"
      >
        <Paperclip className="h-4.5 w-4.5" />
      </button>
      <div className="relative">
        <button
          onClick={() => setEmojiOpen((v) => !v)}
          disabled={disabled}
          title="Emoji"
          className="h-10 w-10 rounded-xl flex items-center justify-center text-neutral-500 hover:text-brand-primary hover:bg-black/5 dark:hover:bg-white/5 transition disabled:opacity-40 shrink-0"
        >
          <Smile className="h-4.5 w-4.5" />
        </button>
        {emojiOpen && (
          <EmojiPicker onPick={(emoji: string) => { setTexto((t) => t + emoji); setEmojiOpen(false); }} onClose={() => setEmojiOpen(false)} />
        )}
      </div>
      <textarea
        ref={taRef}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); if (e.target.value) avisarEscribiendo(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarTexto(); }
          if (e.key === "Escape" && modo) { onCancelarModo?.(); if (modo.tipo === "edicion") setTexto(""); }
        }}
        disabled={disabled}
        placeholder={disabled ? "Conecta el número para poder responder" : "Escribe un mensaje…"}
        rows={1}
        className="flex-1 min-h-[42px] max-h-32 resize-none py-2.5 px-4 rounded-[22px] bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/15 transition-shadow disabled:opacity-50"
      />
      {/* Mic/enviar dinámico: la nota de voz reemplaza al botón de enviar mientras el campo de
          texto está vacío, igual que en WhatsApp real y que ya hace `ChatComposer.tsx`. */}
      <div className={texto.trim() ? "hidden" : ""}>
        <ChatAudioRecorder disabled={disabled || enviando} onSend={async (file) => { await subirAudio(file); }} />
      </div>
      <button
        onClick={enviarTexto}
        disabled={disabled || enviando || !texto.trim()}
        className={cn(
          "wa-act flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none",
          !texto.trim() && "hidden"
        )}
      >
        {modo?.tipo === "edicion" ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
    </div>
  );
}
