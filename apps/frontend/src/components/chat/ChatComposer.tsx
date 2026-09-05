"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send, Paperclip, Smile, X, Loader2, FileText, AtSign } from "@/lib/bootstrap-icons";
import { EmojiPicker } from "./EmojiPicker";
import { AttachMenu, type AttachKind } from "./AttachMenu";
import { ChatAudioRecorder } from "./AudioRecorder";
import { cn } from "@/lib/utils";
import { useFileDrop } from "@/lib/useFileDrop";
import type { ChatMensaje } from "./ChatMessages";

export type Mention = { id: string; nombre: string };
interface MentionUser { id: string; nombre: string; foto_perfil_url?: string | null; cargo?: string | null; }

interface Props {
  onSend: (text: string, menciones?: Mention[]) => void;
  onAttach?: (file: File) => void;
  onSendAudio?: (file: File, durationMs: number) => Promise<void> | void;
  disabled?: boolean;
  replyTo?: ChatMensaje | null;
  onCancelReply?: () => void;
  externalFiles?: File[];
  onExternalConsumed?: () => void;
  grupoId?: string;             // para cargar miembros del @ autocompletar
  onTyping?: () => void;        // se llama al tipear (el padre debouncea y emite por socket)
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export function ChatComposer({ onSend, onAttach, onSendAudio, disabled, replyTo, onCancelReply, externalFiles, onExternalConsumed, grupoId, onTyping }: Props) {
  const [value, setValue] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]); // archivos en espera de confirmacion
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  // Auto-alto: el textarea crece con el contenido hasta un tope y luego scrollea interno.
  const MAX_TA_H = 160; // px — 8 líneas (text-sm ≈ 20px/línea), como WhatsApp Web. Equivale a max-h-40 (10rem)
  const autoGrow = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, MAX_TA_H) + "px";
  };
  useEffect(() => { autoGrow(); }, [value]);

  // Foco automático al seleccionar un mensaje a responder (como Telegram/WhatsApp).
  useEffect(() => { if (replyTo) textareaRef.current?.focus(); }, [replyTo]);

  // ---- Menciones (@usuario / @todos estilo Bitrix) ----
  const [members, setMembers] = useState<MentionUser[]>([]);
  const [pickedMentions, setPickedMentions] = useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);

  useEffect(() => {
    if (!grupoId) { setMembers([]); return; }
    let alive = true;
    fetch(`/api/chat/grupos/${grupoId}/miembros`)
      .then((r) => r.json())
      .then((d) => { if (alive) setMembers(Array.isArray(d.miembros) ? d.miembros : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [grupoId]);

  // Opciones del dropdown segun el query actual (@todos primero)
  const mentionOptions = useMemo<MentionUser[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const opts: MentionUser[] = [];
    if (!q || "todos".includes(q)) opts.push({ id: "all", nombre: "todos", cargo: "Notificar a todo el grupo" });
    for (const m of members) if (!q || m.nombre.toLowerCase().includes(q)) opts.push(m);
    return opts.slice(0, 8);
  }, [mentionQuery, members]);

  // Detecta el token "@..." inmediatamente antes del caret
  const detectMention = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,40})$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionStart(caret - m[1].length - 1); // posicion del '@'
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  const onChangeText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    detectMention(text, e.target.selectionStart ?? text.length);
    if (text.length > 0) onTyping?.();
  };

  const selectMention = (opt: MentionUser) => {
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const insert = `@${opt.nombre} `;
    const next = value.slice(0, mentionStart) + insert + value.slice(caret);
    setValue(next);
    setPickedMentions((prev) => prev.some((p) => p.id === opt.id && p.nombre === opt.nombre) ? prev : [...prev, { id: opt.id, nombre: opt.nombre }]);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = mentionStart + insert.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  const initials = (nombre: string) => nombre.trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  // Archivos arrastrados desde el panel (drag&drop en page.tsx) -> tambien pasan por confirmacion
  useEffect(() => {
    if (externalFiles && externalFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...externalFiles]);
      onExternalConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFiles]);

  // Previews (object URLs para imagenes); se revocan al cambiar/desmontar
  const previews = useMemo(
    () => pendingFiles.map((f) => ({
      file: f,
      isImage: f.type.startsWith("image/"),
      isVideo: f.type.startsWith("video/"),
      url: (f.type.startsWith("image/") || f.type.startsWith("video/")) ? URL.createObjectURL(f) : null,
    })),
    [pendingFiles]
  );
  useEffect(() => () => { previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)); }, [previews]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    // Solo enviamos las menciones cuyo "@Nombre" sigue presente en el texto
    const menciones = pickedMentions.filter((m) => text.includes(`@${m.nombre}`));
    onSend(text, menciones.length ? menciones : undefined);
    setValue("");
    setPickedMentions([]);
    setMentionQuery(null);
  };

  const insertEmoji = (emo: string) => {
    const ta = textareaRef.current;
    if (!ta) { setValue((v) => v + emo); return; }
    const s = ta.selectionStart ?? value.length;
    const e = ta.selectionEnd ?? value.length;
    const next = value.slice(0, s) + emo + value.slice(e);
    setValue(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = s + emo.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const triggerAttach = (kind: AttachKind) => {
    if (kind === "image") imageRef.current?.click();
    else if (kind === "video") videoRef.current?.click();
    else fileRef.current?.click();
  };

  // Sube uno o varios archivos en orden (secuencial) para preservar el orden cronologico.
  const uploadFiles = async (files: File[]) => {
    if (!onAttach || files.length === 0) return;
    setUploading({ done: 0, total: files.length });
    try {
      for (let i = 0; i < files.length; i++) {
        await onAttach(files[i]);
        setUploading({ done: i + 1, total: files.length });
      }
    } finally {
      setUploading(null);
    }
  };

  // Elegir/pegar/arrastrar => abre confirmacion (NO envia directo)
  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttach) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          const ext = f.type.split("/")[1] || "png";
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          images.push(new File([f], `captura-${stamp}.${ext}`, { type: f.type, lastModified: Date.now() }));
        }
      }
    }
    if (images.length > 0) {
      e.preventDefault();
      setPendingFiles((prev) => [...prev, ...images]);
    }
  };

  // Arrastrar y soltar archivos sobre el composer => entran al modal de confirmacion
  const { isOver, dropProps } = useFileDrop(
    (files) => setPendingFiles((prev) => [...prev, ...files]),
    { disabled: !onAttach || disabled || !!uploading }
  );

  const removePending = (idx: number) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  const cancelPending = () => { if (!uploading) setPendingFiles([]); };
  const confirmSend = async () => {
    if (pendingFiles.length === 0 || uploading) return;
    const files = pendingFiles;
    await uploadFiles(files);
    setPendingFiles([]);
  };

  return (
    <div className="relative glass-composer px-4 py-3 flex items-end gap-2" {...dropProps}>
      {isOver && (
        <div className="absolute inset-0 z-[90] m-1.5 rounded-2xl border-2 border-dashed border-brand-orange bg-brand-orange/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-brand-orange font-ui font-bold text-sm">
            <Paperclip className="h-4 w-4" strokeWidth={2.5} /> Suelta los archivos para adjuntar
          </div>
        </div>
      )}

      {/* Dropdown de menciones @ (estilo Bitrix) */}
      {mentionQuery !== null && mentionOptions.length > 0 && (
        <div className="absolute left-3 bottom-full mb-2 z-[85] w-[340px] max-w-[calc(100%-24px)] max-h-72 overflow-y-auto rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200 dark:border-white/10 py-1">
          <div className="px-3 py-1.5 text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400">Mencionar</div>
          {mentionOptions.map((opt, i) => (
            <button
              key={`${opt.id}-${opt.nombre}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectMention(opt); }}
              onMouseEnter={() => setMentionIdx(i)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                i === mentionIdx ? "bg-brand-orange/10" : "hover:bg-neutral-50 dark:hover:bg-white/5"
              )}
            >
              {opt.id === "all" ? (
                <span className="h-8 w-8 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center shrink-0"><AtSign className="h-4 w-4" strokeWidth={2.5} /></span>
              ) : opt.foto_perfil_url ? (
                <img src={opt.foto_perfil_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
              ) : (
                <span className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-[11px] font-bold flex items-center justify-center shrink-0">{initials(opt.nombre)}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-neutral-800 dark:text-white truncate">{opt.id === "all" ? "@todos" : opt.nombre}</span>
                {opt.cargo && <span className="block text-[11px] text-neutral-400 truncate">{opt.cargo}</span>}
              </span>
            </button>
          ))}
          <div className="px-3 pt-1.5 pb-1 text-[10px] text-neutral-400 border-t border-neutral-100 dark:border-white/10 mt-1 flex gap-3">
            <span>↑↓ navegar</span><span>Enter elegir</span><span>Esc cerrar</span>
          </div>
        </div>
      )}
      {replyTo && (
        <div className="absolute bottom-full left-0 right-0 px-4 py-2 bg-neutral-50 dark:bg-neutral-900 border-t border-black/5 dark:border-white/10 flex items-center gap-2">
          <div className="w-1 self-stretch rounded bg-brand-orange shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-brand-orange">Respondiendo a {replyTo.user_nombre || "mensaje"}</div>
            <div className="text-xs text-neutral-500 truncate">{replyTo.contenido || replyTo.archivo_nombre || "Mensaje"}</div>
          </div>
          <button type="button" onClick={onCancelReply} className="h-7 w-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-neutral-400 shrink-0" title="Cancelar"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Modal de confirmacion / preview antes de enviar adjuntos (portal a body: se centra sobre el viewport real, no sobre ancestros con transform/backdrop-blur) */}
      {mounted && pendingFiles.length > 0 && createPortal((
        <div className="fixed inset-0 z-[95] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={cancelPending}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-neutral-200 dark:border-white/10 overflow-hidden flex flex-col max-h-[82vh]"
          >
            <div className="px-5 py-4 border-b border-neutral-100 dark:border-white/10 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
                <Paperclip className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm">Enviar {pendingFiles.length} {pendingFiles.length === 1 ? "archivo" : "archivos"}</div>
                <div className="text-[12px] text-neutral-500">Revisa antes de enviar</div>
              </div>
              <button onClick={cancelPending} disabled={!!uploading} className="h-8 w-8 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 flex items-center justify-center disabled:opacity-50">
                <X className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3" style={{ overscrollBehavior: "contain" }}>
              {previews.map((p, i) => (
                <div key={i} className="relative group rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden bg-neutral-50 dark:bg-white/5">
                  {!uploading && (
                    <button type="button" onClick={() => removePending(i)} title="Quitar"
                      className="absolute top-1 right-1 z-10 h-6 w-6 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                  {p.isImage && p.url ? (
                    <img src={p.url} alt={p.file.name} className="w-full h-28 object-cover" />
                  ) : p.isVideo && p.url ? (
                    <video src={p.url} className="w-full h-28 object-cover bg-black" muted />
                  ) : (
                    <div className="h-28 flex flex-col items-center justify-center text-neutral-400 px-2">
                      <FileText className="h-8 w-8 mb-1" strokeWidth={1.6} />
                    </div>
                  )}
                  <div className="px-2 py-1.5 border-t border-neutral-100 dark:border-white/10">
                    <div className="text-[11px] font-medium truncate">{p.file.name}</div>
                    <div className="text-[10px] text-neutral-400">{fmtSize(p.file.size)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-neutral-100 dark:border-white/10 flex items-center justify-end gap-2">
              <button onClick={cancelPending} disabled={!!uploading}
                className="h-10 px-4 rounded-xl bg-white dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm font-ui font-bold uppercase tracking-wider text-neutral-600 dark:text-white/80 disabled:opacity-50 hover:bg-neutral-50">
                Cancelar
              </button>
              <button onClick={confirmSend} disabled={!!uploading || pendingFiles.length === 0}
                className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-sm font-ui font-bold uppercase tracking-wider shadow disabled:opacity-60 inline-flex items-center gap-2 hover:scale-[1.02] transition">
                {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando {uploading.done}/{uploading.total}</> : <><Send className="h-4 w-4" strokeWidth={2.5} /> Enviar</>}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      <div className="relative">
        <button
          onClick={() => { setAttachOpen((v) => !v); setEmojiOpen(false); }}
          disabled={disabled || !!uploading}
          className="h-10 w-10 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center text-neutral-500 transition disabled:opacity-60"
          title="Adjuntar (puedes elegir varios)"
          type="button"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        {attachOpen && (
          <AttachMenu onPick={triggerAttach} onClose={() => setAttachOpen(false)} />
        )}
      </div>

      <input ref={fileRef}  type="file" multiple className="hidden" onChange={onFilePicked} />
      <input ref={imageRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilePicked} />
      <input ref={videoRef} type="file" accept="video/*" multiple className="hidden" onChange={onFilePicked} />

      <div className="flex-1 glass-input rounded-2xl px-4 py-2 flex items-end gap-2 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChangeText}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionOptions.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionOptions.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionOptions.length) % mentionOptions.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectMention(mentionOptions[mentionIdx]); return; }
              if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          onClick={(e) => detectMention(value, (e.target as HTMLTextAreaElement).selectionStart ?? value.length)}
          onPaste={onPaste}
          placeholder="Escribe un mensaje… (@ para mencionar · Ctrl+V para pegar captura)"
          rows={1}
          data-lenis-prevent
          className="flex-1 bg-transparent outline-none resize-none text-sm max-h-40 overflow-y-auto"
          style={{ minHeight: "24px" }}
        />
        <button
          onClick={() => { setEmojiOpen((v) => !v); setAttachOpen(false); }}
          className="text-neutral-400 hover:text-brand-orange transition"
          title="Emoji"
          type="button"
        >
          <Smile className="h-5 w-5" />
        </button>
        {emojiOpen && (
          <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
        )}
      </div>

      {/* Mic / Send dinámico */}
      {onSendAudio && (
        <div className={value.trim() ? "hidden" : ""}>
          <ChatAudioRecorder
            disabled={disabled}
            onSend={async (file, durationMs) => {
              await onSendAudio(file, durationMs);
            }}
          />
        </div>
      )}

      <button
        onClick={submit}
        disabled={!value.trim() || disabled}
        className={cn(
          "h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white flex items-center justify-center shadow-[0_8px_24px_rgba(255,90,140,0.45)] ring-1 ring-white/30 transition active:scale-95",
          value.trim() ? "hover:scale-110 opacity-100" : onSendAudio ? "hidden" : "opacity-40 cursor-not-allowed"
        )}
        type="button"
      >
        <Send className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
