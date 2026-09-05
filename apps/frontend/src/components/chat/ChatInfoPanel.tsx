"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Image as ImageIcon, Paperclip, Link as LinkIcon, Loader2, FileText, Download, ExternalLink } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

type Kind = "search" | "imagen" | "archivo" | "link";

interface Msg {
  id: string;
  contenido: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  archivo_tipo?: string | null;
  archivo_tamanio?: number | null;
  created_at: string;
  user_nombre?: string | null;
  tipo: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  grupoId: string;
  grupoNombre: string;
}

const TABS: { key: Kind; label: string; Icon: any }[] = [
  { key: "search",  label: "Buscar",     Icon: Search },
  { key: "imagen",  label: "Imágenes",   Icon: ImageIcon },
  { key: "archivo", label: "Archivos",   Icon: Paperclip },
  { key: "link",    label: "Links",      Icon: LinkIcon },
];

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSize(n?: number | null) {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extractLinks(text: string | null): string[] {
  if (!text) return [];
  const m = text.match(URL_RE);
  return m ? Array.from(new Set(m)) : [];
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-brand-orange/30 text-inherit rounded px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function ChatInfoPanel({ open, onClose, grupoId, grupoNombre }: Props) {
  const [tab, setTab] = useState<Kind>("search");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [preview, setPreview] = useState<Msg | null>(null);
  const qDebounced = useRef<any>(null);

  const reload = async (kind: Kind, query?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: kind });
      if (kind === "search" && query) params.set("q", query);
      if (kind === "search" && !query) { setMsgs([]); return; }
      const r = await fetch(`/api/chat/grupos/${grupoId}/media?${params.toString()}`);
      const d = await r.json();
      setMsgs(d.mensajes || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    if (tab === "search") {
      if (qDebounced.current) clearTimeout(qDebounced.current);
      qDebounced.current = setTimeout(() => reload("search", q.trim()), 250);
      return () => { if (qDebounced.current) clearTimeout(qDebounced.current); };
    }
    reload(tab);
  }, [open, tab, q, grupoId]);

  // reset search query cuando cambias de tab
  useEffect(() => { if (tab !== "search") setQ(""); }, [tab]);

  const linkEntries = useMemo(() => {
    if (tab !== "link") return [];
    const out: { url: string; msg: Msg }[] = [];
    for (const m of msgs) for (const u of extractLinks(m.contenido)) out.push({ url: u, msg: m });
    return out;
  }, [tab, msgs]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm flex"
        >
          <motion.aside
            initial={{ x: 500 }} animate={{ x: 0 }} exit={{ x: 500 }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="ml-auto h-full w-full max-w-md bg-white dark:bg-[#0a0a0a] border-l border-black/5 dark:border-white/5 flex flex-col shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-black/5 dark:border-white/5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-400">Conversación</div>
                <div className="font-display text-base font-black truncate">{grupoNombre}</div>
              </div>
              <button onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-2 pt-2 border-b border-black/5 dark:border-white/5 grid grid-cols-4 gap-1">
              {TABS.map((t) => {
                const Icon = t.Icon;
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider transition",
                      active ? "bg-brand-orange/10 text-brand-orange" : "text-neutral-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {tab === "search" && (
              <div className="p-3 border-b border-black/5 dark:border-white/5">
                <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-neutral-100 dark:bg-white/5 border border-transparent focus-within:border-brand-orange/40">
                  <Search className="h-4 w-4 text-neutral-400" />
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar mensajes en la conversación…"
                    className="flex-1 bg-transparent outline-none text-sm"
                  />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {loading && (
                <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>
              )}

              {!loading && tab === "search" && msgs.length === 0 && (
                <div className="p-8 text-center text-xs text-neutral-400">
                  {q.trim() ? `Sin coincidencias para "${q}"` : "Escribe algo para buscar"}
                </div>
              )}
              {!loading && tab === "imagen" && msgs.length === 0 && (
                <div className="p-8 text-center text-xs text-neutral-400">Sin imágenes en esta conversación</div>
              )}
              {!loading && tab === "archivo" && msgs.length === 0 && (
                <div className="p-8 text-center text-xs text-neutral-400">Sin archivos compartidos</div>
              )}
              {!loading && tab === "link" && linkEntries.length === 0 && (
                <div className="p-8 text-center text-xs text-neutral-400">Sin links compartidos</div>
              )}

              {/* Search results */}
              {!loading && tab === "search" && msgs.length > 0 && (
                <ul className="divide-y divide-black/5 dark:divide-white/5">
                  {msgs.map((m) => (
                    <li key={m.id} className="px-4 py-3">
                      <div className="text-[11px] text-neutral-500 flex items-center gap-1 mb-0.5">
                        <strong className="text-neutral-700 dark:text-white/80">{m.user_nombre || "CoPilot"}</strong>
                        <span>· {formatDate(m.created_at)}</span>
                      </div>
                      <div className="text-sm text-neutral-800 dark:text-white/85 whitespace-pre-wrap break-words">
                        {highlight(m.contenido || "(sin texto)", q.trim())}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Images grid */}
              {!loading && tab === "imagen" && msgs.length > 0 && (
                <div className="p-2 grid grid-cols-3 gap-1.5">
                  {msgs.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPreview(m)}
                      className="relative aspect-square rounded-lg overflow-hidden bg-neutral-100 dark:bg-white/5 hover:ring-2 hover:ring-brand-orange transition"
                    >
                      <img src={m.archivo_url || ""} alt={m.archivo_nombre || ""} className="absolute inset-0 w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Files list */}
              {!loading && tab === "archivo" && msgs.length > 0 && (
                <ul className="divide-y divide-black/5 dark:divide-white/5">
                  {msgs.map((m) => (
                    <li key={m.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5" strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{m.archivo_nombre || "archivo"}</div>
                        <div className="text-[11px] text-neutral-500 truncate">
                          {formatSize(m.archivo_tamanio)}{m.archivo_tamanio ? " · " : ""}{m.user_nombre || "—"} · {formatDate(m.created_at)}
                        </div>
                      </div>
                      {m.archivo_url && (
                        <a href={m.archivo_url} target="_blank" rel="noopener" download={m.archivo_nombre || true}
                          className="h-9 w-9 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-neutral-500 flex items-center justify-center">
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Links list */}
              {!loading && tab === "link" && linkEntries.length > 0 && (
                <ul className="divide-y divide-black/5 dark:divide-white/5">
                  {linkEntries.map((e, i) => {
                    let host = e.url;
                    try { host = new URL(e.url).host; } catch {}
                    return (
                      <li key={i} className="px-4 py-3">
                        <a href={e.url} target="_blank" rel="noopener" className="flex items-center gap-3 group">
                          <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0">
                            <LinkIcon className="h-5 w-5" strokeWidth={1.8} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate text-neutral-800 dark:text-white/90 group-hover:text-brand-orange">{host}</div>
                            <div className="text-[11px] text-neutral-500 truncate">{e.url}</div>
                            <div className="text-[10px] text-neutral-400 mt-0.5">{e.msg.user_nombre || "—"} · {formatDate(e.msg.created_at)}</div>
                          </div>
                          <ExternalLink className="h-4 w-4 text-neutral-400 group-hover:text-brand-orange shrink-0" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.aside>

          {preview && (
            <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
              <div className="bg-white dark:bg-[#0a0a0a] rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-3 border-b border-black/5 dark:border-white/5 flex items-center gap-2">
                  <div className="flex-1 font-semibold text-sm truncate">{preview.archivo_nombre || "Imagen"}</div>
                  {preview.archivo_url && (
                    <a href={preview.archivo_url} target="_blank" rel="noopener" download={preview.archivo_nombre || true}
                      className="h-9 px-3 rounded-xl bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-orange text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5" strokeWidth={2} /> Descargar
                    </a>
                  )}
                  <button onClick={() => setPreview(null)} className="h-9 w-9 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
                </div>
                <div className="flex-1 bg-neutral-50 dark:bg-[#151515] flex items-center justify-center overflow-auto">
                  <img src={preview.archivo_url || ""} alt={preview.archivo_nombre || ""} className="max-w-full max-h-full object-contain" />
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
