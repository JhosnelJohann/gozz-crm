"use client";
import { useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Drawer } from "vaul";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, X, Paperclip, Sparkles, UserPlus, ChevronDown, Upload,
  FileText, FileImage, FileSpreadsheet, FileArchive, File as FileIcon, FileVideo, FileAudio
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { BorderBeam } from "@/components/magic/BorderBeam";
import { ShimmerButton } from "@/components/magic/ShimmerButton";
import { AuroraBackground } from "@/components/magic/AuroraBackground";

function adjuntoIcon(mime: string, name: string) {
  const m = (mime || "").toLowerCase();
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [, ""])[1];
  if (m.startsWith("image/")) return { Icon: FileImage, color: "text-pink-600 bg-pink-100" };
  if (m.startsWith("video/")) return { Icon: FileVideo, color: "text-indigo-600 bg-indigo-100" };
  if (m.startsWith("audio/")) return { Icon: FileAudio, color: "text-amber-600 bg-amber-100" };
  if (m === "application/pdf" || ext === "pdf") return { Icon: FileText, color: "text-red-600 bg-red-100" };
  if (["xls","xlsx","csv"].includes(ext)) return { Icon: FileSpreadsheet, color: "text-emerald-600 bg-emerald-100" };
  if (["zip","rar","7z"].includes(ext)) return { Icon: FileArchive, color: "text-violet-600 bg-violet-100" };
  if (["doc","docx","txt","md"].includes(ext)) return { Icon: FileText, color: "text-sky-600 bg-sky-100" };
  return { Icon: FileIcon, color: "text-slate-600 bg-slate-100" };
}
function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const TiptapEditor = dynamic(() => import("./TiptapEditor").then((m) => m.TiptapEditor), {
  ssr: false,
  loading: () => <div className="h-[280px] rounded-xl skeleton" />,
});

interface Props {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  buzonId: string;
  buzonEmail?: string;
  initial?: {
    to?: string;
    subject?: string;
    body_html?: string;
    body_text?: string;
    in_reply_to?: string | null;
    contacto_id?: string | null;
    oportunidad_id?: string | null;
  } | null;
}

export function ComposerDrawer({ open, onClose, onSent, buzonId, buzonEmail, initial }: Props) {
  const [to, setTo] = useState(initial?.to || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [bodyHtml, setBodyHtml] = useState(initial?.body_html || (initial?.body_text ? `<p>${initial.body_text.replace(/\n/g, "<br/>")}</p>` : ""));
  const [bodyText, setBodyText] = useState(initial?.body_text || "");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTo(initial?.to || "");
      setSubject(initial?.subject || "");
      setBodyHtml(initial?.body_html || (initial?.body_text ? `<p>${initial.body_text.replace(/\n/g, "<br/>")}</p>` : ""));
      setBodyText(initial?.body_text || "");
      setCc(""); setBcc(""); setShowCcBcc(false);
      setAdjuntos([]);
    }
  }, [open, initial]);

  const addAdjuntos = (files: File[]) => {
    if (files.length === 0) return;
    const key = (f: File) => f.name + "__" + f.size + "__" + f.lastModified;
    const seen = new Set(adjuntos.map(key));
    const TOTAL_MAX_MB = 25;
    const next = [...adjuntos];
    let skipped = 0;
    for (const f of files) {
      if (seen.has(key(f))) continue;
      if (f.size > TOTAL_MAX_MB * 1024 * 1024) { skipped++; continue; }
      next.push(f);
      seen.add(key(f));
    }
    if (next.length > 10) {
      toast.error("Máximo 10 adjuntos");
      setAdjuntos(next.slice(0, 10));
    } else {
      setAdjuntos(next);
    }
    if (skipped > 0) toast.error(`${skipped} archivo(s) omitido(s) (máx ${TOTAL_MAX_MB}MB c/u)`);
  };

  const removeAdjunto = (idx: number) => setAdjuntos(adjuntos.filter((_, i) => i !== idx));

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    addAdjuntos(Array.from(e.target.files || []));
    e.target.value = "";
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
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
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    addAdjuntos(files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f && f.type.startsWith("image/")) {
          const ext = f.type.split("/")[1] || "png";
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          pasted.push(new File([f], `captura-${stamp}.${ext}`, { type: f.type }));
        }
      }
    }
    if (pasted.length > 0) addAdjuntos(pasted);
  };

  const send = async () => {
    if (!to || !subject) { toast.error("Para y asunto son requeridos"); return; }
    setSending(true);
    try {
      const fd = new FormData();
      const toList = to.split(",").map((s: string) => s.trim()).filter(Boolean);
      toList.forEach((v: string) => fd.append("to", v));
      if (cc) cc.split(",").map((s: string) => s.trim()).filter(Boolean).forEach((v: string) => fd.append("cc", v));
      if (bcc) bcc.split(",").map((s: string) => s.trim()).filter(Boolean).forEach((v: string) => fd.append("bcc", v));
      fd.append("subject", subject);
      if (bodyHtml) fd.append("body_html", bodyHtml);
      if (bodyText) fd.append("body_text", bodyText);
      if (initial?.in_reply_to) fd.append("in_reply_to", initial.in_reply_to);
      if (initial?.contacto_id) fd.append("contacto_id", initial.contacto_id);
      if (initial?.oportunidad_id) fd.append("oportunidad_id", initial.oportunidad_id);
      adjuntos.forEach((f) => fd.append("attachment", f));

      const r = await fetch(`/api/buzones/${buzonId}/send`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Error al enviar");
      toast.success(adjuntos.length > 0 ? `Correo enviado con ${adjuntos.length} adjunto${adjuntos.length === 1 ? "" : "s"} ✓` : "Correo enviado ✓");
      onSent();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSending(false); }
  };

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 h-[92vh] z-50 outline-none">
          <div
            className="relative h-full bg-white dark:bg-neutral-900 rounded-t-3xl overflow-hidden flex flex-col border-t border-black/10 dark:border-white/10"
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onPaste={onPaste}
          >
            <BorderBeam size={280} duration={10} />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onFilePicked}
            />
            <AnimatePresence>
              {dragOver && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 bg-gradient-to-br from-brand-orange/15 via-white/85 to-neon-magenta/15 backdrop-blur-sm border-2 border-dashed border-brand-orange m-4 rounded-3xl flex items-center justify-center pointer-events-none"
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
                    <div className="font-display text-2xl font-black text-slate-900">Suelta para adjuntar</div>
                    <div className="text-sm text-slate-600">Imágenes, PDFs, documentos · máx 25MB cada uno</div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <Drawer.Handle className="mx-auto mt-2 h-1 w-12 rounded-full bg-neutral-300 dark:bg-white/15" />

            <div className="relative px-6 py-4 border-b border-black/5 dark:border-white/10">
              <div className="absolute inset-0 opacity-30">
                <AuroraBackground intensity={0.3} />
              </div>
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-brand-orange font-ui uppercase text-[10px] tracking-[0.2em] font-bold">
                    <Sparkles className="h-3 w-3" />
                    {initial?.in_reply_to ? "Responder" : "Nuevo correo"}
                  </div>
                  <div className="font-display text-xl font-black mt-0.5">{subject || "(sin asunto)"}</div>
                  {buzonEmail && <div className="text-[11px] text-neutral-500 mt-0.5">Desde {buzonEmail}</div>}
                </div>
                <button onClick={onClose} className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3" data-lenis-prevent>
              <FieldRow label="Para">
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destinatario@ejemplo.com (separa con comas)" className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30" />
                {!showCcBcc && (
                  <button onClick={() => setShowCcBcc(true)} className="text-[11px] text-brand-orange hover:underline font-ui uppercase tracking-wider mt-1 flex items-center gap-1">
                    <UserPlus className="h-3 w-3" /> Agregar Cc/Bcc
                  </button>
                )}
              </FieldRow>

              <AnimatePresence>
                {showCcBcc && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                    <FieldRow label="Cc">
                      <input value={cc} onChange={(e) => setCc(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm" />
                    </FieldRow>
                    <FieldRow label="Bcc">
                      <input value={bcc} onChange={(e) => setBcc(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm" />
                    </FieldRow>
                  </motion.div>
                )}
              </AnimatePresence>

              <FieldRow label="Asunto">
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30" />
              </FieldRow>

              <div>
                <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-neutral-500 block mb-1.5">Mensaje</label>
                <TiptapEditor
                  html={bodyHtml}
                  onChange={(html, text) => { setBodyHtml(html); setBodyText(text); }}
                  minHeight={260}
                />
              </div>
            </div>

            {/* Chips de adjuntos */}
            {adjuntos.length > 0 && (
              <div className="px-6 py-2 border-t border-black/5 dark:border-white/10 flex items-center gap-2 flex-wrap bg-slate-50/60 dark:bg-white/[0.02]">
                <div className="text-[10px] font-ui uppercase tracking-[0.15em] text-neutral-500 flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3 text-brand-orange" />
                  {adjuntos.length} {adjuntos.length === 1 ? "adjunto" : "adjuntos"}
                </div>
                {adjuntos.map((f, i) => {
                  const info = adjuntoIcon(f.type, f.name);
                  const Icon = info.Icon;
                  return (
                    <motion.div
                      key={i}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      className={"flex items-center gap-2 h-8 pl-1.5 pr-1 rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-white/5 text-[11px] text-slate-800 dark:text-white/85"}
                    >
                      <div className={`h-6 w-6 rounded-md flex items-center justify-center ${info.color}`}>
                        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                      </div>
                      <span className="font-semibold truncate max-w-[180px]">{f.name}</span>
                      <span className="text-[10px] text-neutral-400 tabular-nums">{fmtSize(f.size)}</span>
                      <button
                        onClick={() => removeAdjunto(i)}
                        className="h-6 w-6 rounded-md hover:bg-red-50 hover:text-red-600 text-neutral-400 flex items-center justify-center transition"
                        aria-label="Quitar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}

            <div className="border-t border-black/5 dark:border-white/10 px-6 py-3 flex items-center justify-between gap-3 bg-white/80 dark:bg-white/[0.02] backdrop-blur">
              <button
                onClick={() => fileInputRef.current?.click()}
                type="button"
                className="h-10 px-3 rounded-xl border border-black/10 dark:border-white/10 text-xs font-ui font-bold uppercase tracking-wider text-slate-700 dark:text-white/85 hover:border-brand-orange/50 hover:text-brand-orange hover:bg-brand-orange/5 flex items-center gap-1.5 transition"
                title="Adjuntar archivos (o arrastra aquí)"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {adjuntos.length > 0 ? `Adjuntar (${adjuntos.length})` : "Adjuntar"}
              </button>
              <div className="flex-1" />
              <button onClick={onClose} className="h-10 px-4 rounded-xl border border-black/10 dark:border-white/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5">
                Cancelar
              </button>
              <ShimmerButton onClick={send} disabled={sending}>
                <Send className="h-3.5 w-3.5" /> {sending ? "Enviando…" : "Enviar"}
              </ShimmerButton>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-neutral-500 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
