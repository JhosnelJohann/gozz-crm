"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, X, Loader2, Paperclip, Mail, ChevronDown, AlertCircle, Plus } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFileDrop } from "@/lib/useFileDrop";

interface Buzon {
  id: string;
  email: string;
  display_name?: string | null;
  smtp_host?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contactoId?: string | null;
  oportunidadId?: string | null;
  toEmail: string;
  toName?: string;
  defaultSubject?: string;
  defaultBody?: string;
  onSent?: () => void;
}

export default function EmailComposeModal({
  open,
  onClose,
  contactoId,
  oportunidadId,
  toEmail,
  toName,
  defaultSubject = "",
  defaultBody = "",
  onSent,
}: Props) {
  const [buzones, setBuzones] = useState<Buzon[]>([]);
  const [buzonId, setBuzonId] = useState<string>("");
  const [loadingBuzones, setLoadingBuzones] = useState(false);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState(toEmail);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingBuzones(true);
    fetch("/api/buzones")
      .then((r) => r.json())
      .then((d) => {
        const raw = Array.isArray(d.buzones) ? d.buzones : (Array.isArray(d) ? d : []);
        const vistos = new Set<string>();
        const list = raw.filter((b: any) => { const k = (b.email || "").toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
        setBuzones(list);
        if (list.length > 0 && !buzonId) setBuzonId(list[0].id);
      })
      .catch(() => toast.error("No se pudieron cargar los buzones"))
      .finally(() => setLoadingBuzones(false));
  }, [open, buzonId]);

  useEffect(() => {
    if (open) {
      setTo(toEmail);
      setSubject(defaultSubject);
      setBody(defaultBody);
      setCc("");
      setBcc("");
      setAttachments([]);
      setShowCcBcc(false);
    }
  }, [open, toEmail, defaultSubject, defaultBody]);

  const canSend = useMemo(() => {
    return Boolean(buzonId && to.trim() && subject.trim() && !sending);
  }, [buzonId, to, subject, sending]);

  const totalAttachSize = attachments.reduce((acc, f) => acc + f.size, 0);
  const tooBig = totalAttachSize > 24 * 1024 * 1024; // 24MB suave

  const onAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments((prev) => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const removeAttachment = (idx: number) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  // Arrastrar y soltar archivos sobre el modal => se agregan como adjuntos
  const { isOver, dropProps } = useFileDrop(
    (files) => setAttachments((prev) => [...prev, ...files]),
    { disabled: sending }
  );

  const send = async () => {
    if (!canSend) return;
    if (tooBig) { toast.error("Adjuntos > 24MB. Subí los grandes al Drive y compartilos por link."); return; }
    setSending(true);
    try {
      const fd = new FormData();
      to.split(",").map((s) => s.trim()).filter(Boolean).forEach((addr) => fd.append("to[]", addr));
      if (cc.trim()) cc.split(",").map((s) => s.trim()).filter(Boolean).forEach((addr) => fd.append("cc[]", addr));
      if (bcc.trim()) bcc.split(",").map((s) => s.trim()).filter(Boolean).forEach((addr) => fd.append("bcc[]", addr));
      fd.append("subject", subject);
      // Construye HTML simple desde el body plain (preserva saltos de línea)
      const html = body
        .split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${p.replace(/\n/g, "<br>")}</p>`).join("");
      fd.append("body_html", html);
      fd.append("body_text", body);
      if (contactoId) fd.append("contacto_id", contactoId);
      if (oportunidadId) fd.append("oportunidad_id", oportunidadId);
      attachments.forEach((f) => fd.append("attachment", f, f.name));

      const r = await fetch(`/api/buzones/${buzonId}/send`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Error enviando");
      toast.success(`Correo enviado a ${to}`);
      onSent?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error enviando");
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
            {...dropProps}
          >
            {isOver && (
              <div className="absolute inset-0 z-[60] m-3 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-500/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 text-emerald-600 font-ui font-bold text-base">
                  <Paperclip className="h-5 w-5" strokeWidth={2.5} /> Suelta los archivos para adjuntar
                </div>
              </div>
            )}
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                  <Send className="h-5 w-5 text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-lg font-display font-black text-neutral-900">Enviar correo</h3>
                  <p className="text-[11px] font-ui text-neutral-500">{toName ? `Para ${toName}` : `Para ${toEmail}`}</p>
                </div>
              </div>
              <button onClick={onClose} disabled={sending} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-400 disabled:opacity-50">
                <X size={18} />
              </button>
            </div>

            {/* Buzón selector */}
            <div className="px-6 py-3 border-b border-neutral-100 bg-neutral-50/60 flex items-center gap-3">
              <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 shrink-0">DE</span>
              {loadingBuzones ? (
                <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
              ) : buzones.length === 0 ? (
                <span className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> No tenés buzón conectado. Andá a Configuración → Correo.</span>
              ) : (
                <div className="relative flex-1">
                  <select
                    value={buzonId}
                    onChange={(e) => setBuzonId(e.target.value)}
                    className="w-full appearance-none h-8 pl-3 pr-9 rounded-lg bg-white border border-neutral-200 text-sm font-medium text-neutral-700 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                  >
                    {buzones.map((b) => (
                      <option key={b.id} value={b.id}>{b.display_name ? `${b.display_name} · ` : ""}{b.email}</option>
                    ))}
                  </select>
                  <ChevronDown className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Form body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {/* To */}
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-2">
                <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 w-12 shrink-0">PARA</span>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="email@ejemplo.com (,separado para varios)"
                  className="flex-1 text-sm bg-transparent border-0 focus:outline-none placeholder-neutral-400"
                />
                {!showCcBcc && (
                  <button onClick={() => setShowCcBcc(true)} className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-400 hover:text-neutral-600">CC/BCC</button>
                )}
              </div>
              {/* CC + BCC (collapsible) */}
              {showCcBcc && (
                <>
                  <div className="flex items-center gap-3 border-b border-neutral-100 pb-2">
                    <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 w-12 shrink-0">CC</span>
                    <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@…" className="flex-1 text-sm bg-transparent border-0 focus:outline-none placeholder-neutral-400" />
                  </div>
                  <div className="flex items-center gap-3 border-b border-neutral-100 pb-2">
                    <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 w-12 shrink-0">BCC</span>
                    <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@…" className="flex-1 text-sm bg-transparent border-0 focus:outline-none placeholder-neutral-400" />
                  </div>
                </>
              )}
              {/* Subject */}
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-2">
                <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 w-12 shrink-0">ASUNTO</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Asunto del correo"
                  className="flex-1 text-sm font-medium bg-transparent border-0 focus:outline-none placeholder-neutral-400"
                />
              </div>
              {/* Body */}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escribí el mensaje…"
                rows={10}
                className="w-full text-sm leading-relaxed bg-transparent border-0 focus:outline-none placeholder-neutral-400 resize-none"
              />
              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-100">
                  {attachments.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-100 text-[11px]">
                      <Paperclip className="h-3 w-3 text-neutral-500" />
                      <span className="truncate max-w-[180px] font-medium">{f.name}</span>
                      <span className="text-neutral-400">{(f.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => removeAttachment(idx)} className="text-neutral-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                  {tooBig && <div className="w-full text-[11px] text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Total &gt; 24MB — subí al Drive y mandá link</div>}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-100 bg-neutral-50/60">
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" multiple onChange={onAttach} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="h-10 px-3 rounded-xl bg-white border border-neutral-200 text-neutral-700 text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-neutral-50 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Adjuntar
                </button>
                {attachments.length > 0 && <span className="text-[10px] font-ui text-neutral-400">{attachments.length} archivo{attachments.length === 1 ? "" : "s"}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={sending}
                  className="h-10 px-4 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >Cancelar</button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={send}
                  disabled={!canSend || tooBig}
                  className={cn(
                    "h-10 px-5 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-2 shadow-lg",
                    canSend && !tooBig
                      ? "bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-500/25"
                      : "bg-neutral-300 cursor-not-allowed"
                  )}
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sending ? "Enviando…" : "Enviar"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
