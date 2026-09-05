"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Reply, Forward, Link2, Mail, MailOpen, Archive, ExternalLink, Paperclip, User, Download, Eye, FileText, Image as ImageIcon } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { SenderAvatar } from "./SenderAvatar";
import { FilePreviewModal } from "@/components/drive/DriveBrowser";
import { cn } from "@/lib/utils";

interface Props {
  emailId: string | null;
  onClose: () => void;
  onReply: (email: any) => void;
  onForward: (email: any) => void;
  onChanged: () => void;
}

function friendlyFull(iso: string): string {
  try { return new Date(iso).toLocaleString("es", { dateStyle: "long", timeStyle: "short" }); } catch { return iso; }
}

export function EmailDetailDrawer({ emailId, onClose, onReply, onForward, onChanged }: Props) {
  const [email, setEmail] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  useEffect(() => {
    setPreviewIdx(null);
    if (!emailId) { setEmail(null); return; }
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/emails/${emailId}`);
        const d = await r.json();
        // El GET ya marca leido=true en el backend. Si estaba no-leido,
        // notificamos al parent para refrescar la lista (badge unread + negrita).
        const wasUnread = d.email && d.email.leido === false;
        setEmail(d.email ? { ...d.email, leido: true } : d.email);
        if (wasUnread) onChanged();
      } catch {}
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);

  const toggleRead = async () => {
    if (!email) return;
    const newLeido = !email.leido;
    const r = await fetch("/api/emails/bulk", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [email.id], leido: newLeido })
    });
    if (r.ok) { setEmail({ ...email, leido: newLeido }); onChanged(); toast.success(newLeido ? "Marcado leído" : "Marcado no leído"); }
  };

  const open = !!emailId;
  const adjuntos: any[] = Array.isArray(email?.adjuntos) ? email.adjuntos : [];
  const tos: any[] = Array.isArray(email?.to_addrs) ? email.to_addrs : [];
  const ccs: any[] = Array.isArray(email?.cc_addrs) ? email.cc_addrs : [];

  if (typeof window === "undefined") return null;
  return (
    <>
      {open && createPortal(
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-40"
        >
          {/* Overlay: clic afuera cierra (acción manual). El panel es estático, NO arrastrable. */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <div className="fixed top-0 right-0 bottom-0 w-full md:w-[62vw] lg:w-[52vw] max-w-[780px] z-50 outline-none">
            <div className="h-full bg-white dark:bg-neutral-900 border-l border-black/10 dark:border-white/10 flex flex-col overflow-hidden">
            {loading || !email ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="h-10 w-10 rounded-full border-2 border-brand-orange/30 border-t-brand-orange animate-spin" />
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-10 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border-b border-black/5 dark:border-white/10">
                  <div className="px-5 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <motion.h2
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="font-display text-2xl font-black leading-tight"
                        >
                          {email.subject || "(sin asunto)"}
                        </motion.h2>
                        <div className="text-[11px] text-neutral-500 mt-1">{friendlyFull(email.fecha_email)}</div>
                      </div>
                      <button onClick={onClose} className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex items-start gap-3 mb-3">
                      <SenderAvatar email={email.from_addr} name={email.from_name} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold">{email.from_name || email.from_addr}</div>
                        {email.from_name && <div className="text-[11px] text-neutral-500">&lt;{email.from_addr}&gt;</div>}
                        <div className="text-[11px] text-neutral-500 mt-1 flex items-start gap-1 flex-wrap">
                          <span>Para:</span>
                          {tos.slice(0, 3).map((a: any, i: number) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/5 text-[10px]">
                              {a.name || a.address}
                            </span>
                          ))}
                          {tos.length > 3 && <span className="text-[10px] text-neutral-400">+{tos.length - 3}</span>}
                          {ccs.length > 0 && <><span className="ml-2">Cc:</span>{ccs.slice(0, 2).map((a: any, i: number) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/5 text-[10px]">{a.address}</span>
                          ))}</>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <ActionBtn onClick={() => onReply(email)} primary>
                        <Reply className="h-3.5 w-3.5" /> Responder
                      </ActionBtn>
                      <ActionBtn onClick={() => onForward(email)}>
                        <Forward className="h-3.5 w-3.5" /> Reenviar
                      </ActionBtn>
                      <ActionBtn onClick={toggleRead}>
                        {email.leido ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
                        {email.leido ? "No leído" : "Leído"}
                      </ActionBtn>
                      <ActionBtn onClick={() => setLinkOpen(true)}>
                        <Link2 className="h-3.5 w-3.5" /> Vincular
                      </ActionBtn>
                      {email.oportunidad_id && (
                        <a
                          href={`/oportunidades/${email.oportunidad_id}`}
                          className="h-8 px-3 rounded-lg border border-black/10 dark:border-white/10 text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1.5"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Oportunidad
                        </a>
                      )}
                      {email.contacto_id && (
                        <a
                          href={`/contactos/${email.contacto_id}`}
                          className="h-8 px-3 rounded-lg border border-black/10 dark:border-white/10 text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1.5"
                        >
                          <User className="h-3.5 w-3.5" /> Contacto
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 selection-doc cursor-text" data-lenis-prevent>
                  {email.body_html_safe ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-a:text-brand-orange select-text" dangerouslySetInnerHTML={{ __html: email.body_html_safe }} />
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap font-sans text-neutral-700 dark:text-neutral-200 leading-relaxed select-text">{email.body_text || "(vacío)"}</pre>
                  )}

                  {adjuntos.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-black/5 dark:border-white/10">
                      <div className="flex items-center gap-2 mb-3 text-[10px] font-ui uppercase tracking-[0.15em] text-neutral-500">
                        <Paperclip className="h-3 w-3" /> {adjuntos.length} adjunto{adjuntos.length > 1 ? "s" : ""}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {adjuntos.map((a: any, i: number) => {
                          const ct = a.content_type || a.contentType || "";
                          const name = a.name || a.filename || "archivo";
                          return (
                            <div
                              key={i}
                              onClick={() => setPreviewIdx(i)}
                              className={cn(
                                "glass rounded-xl p-3 flex items-center gap-3 group",
                                "cursor-pointer hover:ring-1 hover:ring-brand-orange/40 transition"
                              )}
                              title="Previsualizar"
                            >
                              <div className="h-10 w-10 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
                                {ct.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : ct === "application/pdf" ? <FileText className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold truncate">{name}</div>
                                <div className="text-[10px] text-neutral-500">{formatBytes(a.size || 0)} · {ct || "binary"}</div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {/* El ojo sale SIEMPRE. Antes iba detras de `isPreviewable`, que
                                    solo aceptaba imagenes y PDF: un HTML, un CSV, un texto, un
                                    video o un audio adjunto no se podian ver, solo descargar. El
                                    visor compartido pinta los siete, y cuando de verdad no puede
                                    ofrece la descarga y dice por que — que es estrictamente mas
                                    de lo que decia un boton escondido. */}
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); setPreviewIdx(i); }}
                                  title="Previsualizar"
                                  className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:text-brand-orange hover:bg-brand-orange/10 transition"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                                <a
                                  href={attUrl(email.id, i, true)}
                                  download={name}
                                  onClick={(ev) => ev.stopPropagation()}
                                  title="Descargar"
                                  className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-500 hover:text-brand-orange hover:bg-brand-orange/10 transition"
                                >
                                  <Download className="h-4 w-4" />
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            </div>
          </div>
        </motion.div>,
        document.body
      )}

      {email && linkOpen && (
        <LinkModal email={email} onClose={() => setLinkOpen(false)} onSaved={() => { setLinkOpen(false); onChanged(); }} />
      )}

      {email && previewIdx != null && adjuntos[previewIdx] && (
        <FilePreviewModal
          file={{
            url: attUrl(email.id, previewIdx, false),
            urlDescarga: attUrl(email.id, previewIdx, true),
            nombre: adjuntos[previewIdx].name || adjuntos[previewIdx].filename || "archivo",
            mime: adjuntos[previewIdx].content_type || adjuntos[previewIdx].contentType || null,
            size_bytes: adjuntos[previewIdx].size ?? null,
          }}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </>
  );
}

function attUrl(emailId: string, index: number, download = false): string {
  return `/api/emails/${emailId}/adjuntos/${index}${download ? "?dl=1" : ""}`;
}


function ActionBtn({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition",
        primary
          ? "bg-brand-orange text-white hover:bg-brand-orange/90 shadow-glow-sm"
          : "border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-200"
      )}
    >
      {children}
    </button>
  );
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function LinkModal({ email, onClose, onSaved }: any) {
  const [contactos, setContactos] = useState<any[]>([]);
  const [ops, setOps] = useState<any[]>([]);
  const [contactoId, setContactoId] = useState(email.contacto_id || "");
  const [oppId, setOppId] = useState(email.oportunidad_id || "");
  // Antes esto pedía `/api/contactos?limit=200` y pintaba un trozo arbitrario de los ~3.800
  // contactos: el contacto que buscabas normalmente NO estaba en la lista. Ahora se busca en
  // servidor con debounce, igual que en ContactoPicker.
  const [qContacto, setQContacto] = useState("");
  const [buscando, setBuscando] = useState(false);
  useEffect(() => {
    fetch("/api/oportunidades").then((r) => r.json()).then((d) => setOps(d.oportunidades || []));
  }, []);
  useEffect(() => {
    const term = qContacto.trim();
    let cancelled = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (term.length >= 2) params.set("q", term);
        params.set("limit", "20");
        const r = await fetch(`/api/contactos/search?${params.toString()}`);
        const d = await r.json();
        if (!cancelled) setContactos(Array.isArray(d.contactos) ? d.contactos : []);
      } catch { if (!cancelled) setContactos([]); }
      finally { if (!cancelled) setBuscando(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [qContacto]);
  const save = async () => {
    const r = await fetch(`/api/emails/${email.id}/link`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacto_id: contactoId || null, oportunidad_id: oppId || null })
    });
    if (r.ok) { toast.success("Vinculado"); onSaved(); } else toast.error("Error");
  };
  if (typeof window === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()} className="rounded-3xl p-7 max-w-md w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 shadow-2xl">
        <h3 className="font-display text-xl font-black mb-5">Vincular correo</h3>
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Contacto</label>
            <input
              value={qContacto}
              onChange={(e) => setQContacto(e.target.value)}
              placeholder="Buscar contacto por nombre, email o teléfono…"
              className="w-full h-10 px-3 mb-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
            />
            <select value={contactoId} onChange={(e) => setContactoId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm">
              <option value="">— Ninguno —</option>
              {contactos.map((c: any) => (<option key={c.id} value={c.id}>{c.nombre_completo} {c.email ? `(${c.email})` : ""}</option>))}
            </select>
            <p className="text-[10px] text-neutral-400 mt-1">
              {buscando ? "Buscando…" : qContacto.trim().length >= 2 ? `${contactos.length} coincidencia${contactos.length === 1 ? "" : "s"}` : "Escribe para buscar entre todos los contactos"}
            </p>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Oportunidad</label>
            <select value={oppId} onChange={(e) => setOppId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm">
              <option value="">— Ninguna —</option>
              {ops.map((o: any) => (<option key={o.id} value={o.id}>{o.nombre_caso}</option>))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-black/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5">Cancelar</button>
          <button onClick={save} className="flex-1 h-11 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90">Guardar</button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
