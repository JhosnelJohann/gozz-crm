"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Send, Smile } from "@/lib/bootstrap-icons";
import { EmojiPicker } from "@/components/chat/EmojiPicker";

interface Props {
  onSend: (d: { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string }) => Promise<void>;
  disabled?: boolean;
}

export function ConversationComposer({ onSend, disabled }: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const enviarTexto = async () => {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setTexto("");
    try {
      await onSend({ tipo: "texto", contenido });
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
      await onSend({ tipo, archivoUrl: d.url, archivoNombre: file.name });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo enviar el archivo");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-black/5 dark:border-white/10 p-3 flex items-end gap-2 bg-bg-canvas dark:bg-white/[0.01] relative">
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
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarTexto(); } }}
        disabled={disabled}
        placeholder={disabled ? "Conecta el número para poder responder" : "Escribe un mensaje…"}
        rows={1}
        className="flex-1 min-h-[40px] max-h-32 resize-none py-2.5 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 disabled:opacity-50"
      />
      <button
        onClick={enviarTexto}
        disabled={disabled || enviando || !texto.trim()}
        className="h-10 w-10 rounded-xl bg-brand-primary text-white flex items-center justify-center shrink-0 hover:brightness-110 disabled:opacity-40 transition"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
