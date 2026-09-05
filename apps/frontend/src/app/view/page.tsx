"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, ExternalLink, ArrowLeft, Maximize2, X, FileText, Loader2,
  FileSpreadsheet, Presentation, FileArchive, FileCode, FileImage, FileVideo, FileAudio,
  File as FileIcon, Copy, Check, Globe, Edit3, Rows, MousePointer2
} from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function ext(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function detectKind(name: string, mime: string) {
  const e = ext(name);
  const m = mime.toLowerCase();
  if (e === "pdf" || m === "application/pdf") return "pdf" as const;
  if (["doc", "docx", "rtf", "odt"].includes(e) || m.includes("wordprocessingml") || m.includes("msword")) return "word" as const;
  if (["xls", "xlsx", "ods"].includes(e) || m.includes("spreadsheetml") || m.includes("excel")) return "excel" as const;
  if (["ppt", "pptx", "odp"].includes(e) || m.includes("presentationml") || m.includes("powerpoint")) return "ppt" as const;
  if (["csv", "tsv"].includes(e)) return "csv" as const;
  if (["md", "txt", "log"].includes(e) || m === "text/plain" || m === "text/markdown") return "text" as const;
  if (["json", "xml", "yaml", "yml", "js", "ts", "tsx", "jsx", "css", "html", "sh", "py"].includes(e)) return "code" as const;
  if (m.startsWith("image/") || ["png","jpg","jpeg","gif","webp","svg","bmp"].includes(e)) return "image" as const;
  if (m.startsWith("video/") || ["mp4","webm","mov"].includes(e)) return "video" as const;
  if (m.startsWith("audio/") || ["mp3","wav","ogg","webm"].includes(e)) return "audio" as const;
  if (["zip","rar","7z","tar","gz"].includes(e)) return "archive" as const;
  return "other" as const;
}

const KIND_STYLE: Record<string, { Icon: any; color: string; label: string; gradient: string; fg: string }> = {
  pdf:     { Icon: FileText,       color: "from-red-500 to-rose-600",         label: "PDF",      gradient: "from-red-500 to-rose-600",        fg: "text-red-600" },
  word:    { Icon: FileText,       color: "from-sky-500 to-blue-600",         label: "Word",     gradient: "from-sky-500 to-blue-600",        fg: "text-sky-600" },
  excel:   { Icon: FileSpreadsheet,color: "from-emerald-500 to-green-600",    label: "Excel",    gradient: "from-emerald-500 to-green-600",   fg: "text-emerald-600" },
  ppt:     { Icon: Presentation,   color: "from-orange-500 to-red-500",       label: "PPT",      gradient: "from-orange-500 to-red-500",      fg: "text-orange-600" },
  csv:     { Icon: Rows,           color: "from-emerald-500 to-teal-600",     label: "CSV",      gradient: "from-emerald-500 to-teal-600",    fg: "text-emerald-600" },
  text:    { Icon: FileText,       color: "from-slate-500 to-slate-700",      label: "Texto",    gradient: "from-slate-500 to-slate-700",     fg: "text-slate-600" },
  code:    { Icon: FileCode,       color: "from-fuchsia-500 to-violet-600",   label: "Código",   gradient: "from-fuchsia-500 to-violet-600",  fg: "text-fuchsia-600" },
  image:   { Icon: FileImage,      color: "from-pink-500 to-rose-500",        label: "Imagen",   gradient: "from-pink-500 to-rose-500",       fg: "text-pink-600" },
  video:   { Icon: FileVideo,      color: "from-indigo-500 to-violet-600",    label: "Video",    gradient: "from-indigo-500 to-violet-600",   fg: "text-indigo-600" },
  audio:   { Icon: FileAudio,      color: "from-amber-500 to-orange-500",     label: "Audio",    gradient: "from-amber-500 to-orange-500",    fg: "text-amber-600" },
  archive: { Icon: FileArchive,    color: "from-violet-500 to-purple-700",    label: "Archivo",  gradient: "from-violet-500 to-purple-700",   fg: "text-violet-600" },
  other:   { Icon: FileIcon,       color: "from-slate-500 to-slate-700",      label: "Archivo",  gradient: "from-slate-500 to-slate-700",     fg: "text-slate-600" },
};

function ViewerPageInner() {
  const sp = useSearchParams();
  const rawUrl = sp.get("url") || "";
  const name = sp.get("name") || "documento";
  const mime = sp.get("mime") || "";

  const absoluteUrl = useMemo(() => {
    if (!rawUrl) return "";
    if (/^https?:\/\//.test(rawUrl)) return rawUrl;
    if (typeof window !== "undefined") return new URL(rawUrl, window.location.origin).href;
    return rawUrl;
  }, [rawUrl]);

  const kind = detectKind(name, mime);
  const style = KIND_STYLE[kind];
  const Icon = style.Icon;

  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);

  useEffect(() => {
    if (!absoluteUrl) return;
    if (["text", "code", "csv"].includes(kind)) {
      setLoadingText(true);
      fetch(absoluteUrl).then((r) => r.text()).then(setTextContent).finally(() => setLoadingText(false));
    }
  }, [absoluteUrl, kind]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      toast.success("URL copiada");
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("No se pudo copiar"); }
  };

  // 🔴 AQUI HABIA TRES URLS A VISORES DE MICROSOFT Y GOOGLE. Se quitaron en la tanda D2 y no se
  // copiaron a la modal, por dos motivos comprobados:
  //   1) NO FUNCIONABAN. `/uploads` y `/api/drive/files/:id/raw` exigen sesion, asi que esos
  //      servidores recibian un 401 y no veian ningun documento. La vista previa de PowerPoint de
  //      esta pagina era funcionalidad muerta.
  //   2) En cada apertura de un `.pptx` se les mandaba la URL interna del CRM. No el contenido
  //      —eso lo impedia el 401— pero si la ruta y el id, que revelan estructura.
  // No se pierde nada: `FilePreviewModal` extrae Word, Excel y PowerPoint EN EL SERVIDOR, que es
  // el visor bueno para esos formatos.

  const canOfficeView = ["word", "excel", "ppt"].includes(kind);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0A0A14] text-slate-900 dark:text-white flex flex-col">
      {/* Backdrop ambient para PDF/doc */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: "radial-gradient(ellipse at 20% 0%, rgba(87,80,232,0.10), transparent 45%), radial-gradient(ellipse at 80% 100%, rgba(131,56,236,0.10), transparent 55%)",
        }}
      />

      {/* Top bar */}
      <motion.header
        initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="relative z-20 sticky top-0 backdrop-blur-xl bg-white/80 dark:bg-[#0A0A14]/80 border-b border-slate-200 dark:border-white/10"
      >
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3 flex items-center gap-3">
          <button onClick={() => window.close()}
            className="h-10 px-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-white/80 flex items-center gap-1.5 font-ui text-[11px] font-bold uppercase tracking-wider transition">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            Cerrar
          </button>

          <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 text-white shadow-lg", style.gradient)}>
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-slate-500 dark:text-white/50">
              <span className={style.fg}>{style.label}</span>
              <span>·</span>
              <span>Visor de documentos</span>
            </div>
            <div className="font-display font-black text-[15px] truncate">{name}</div>
          </div>

          <button
            onClick={copyUrl}
            className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-white/80 flex items-center justify-center transition"
            title="Copiar URL"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setFullscreen((v) => !v)}
            className="hidden md:flex h-10 w-10 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-white/80 items-center justify-center transition"
            title="Pantalla completa"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <a
            href={absoluteUrl}
            target="_blank"
            rel="noopener"
            className="h-10 px-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-white/80 flex items-center gap-1.5 font-ui text-[11px] font-bold uppercase tracking-wider transition"
            title="Abrir original"
          >
            <Globe className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="hidden sm:inline">Original</span>
          </a>
          <a
            href={absoluteUrl}
            download={name}
            target="_blank"
            rel="noopener"
            className="h-10 px-4 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white shadow-lg hover:shadow-xl hover:scale-[1.03] active:scale-95 flex items-center gap-1.5 font-ui text-[11px] font-bold uppercase tracking-wider transition"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
            Descargar
          </a>
        </div>
      </motion.header>

      {/* Main viewer */}
      <motion.main
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.08 }}
        className={cn("relative flex-1 flex min-h-0", fullscreen && "fixed inset-0 z-[100] bg-white dark:bg-[#0A0A14]")}
      >
        {fullscreen && (
          <button onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 z-[110] h-10 w-10 rounded-xl bg-white/90 dark:bg-white/10 backdrop-blur-xl shadow-lg flex items-center justify-center transition">
            <X className="h-5 w-5" />
          </button>
        )}
        <div className="max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-6 flex-1 flex">
          <div className="flex-1 rounded-3xl bg-white dark:bg-[#0F0F1B] border border-slate-200 dark:border-white/10 shadow-[0_10px_50px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_50px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col">
            {!absoluteUrl ? (
              <div className="flex-1 flex items-center justify-center p-10 text-center">
                <div>
                  <FileIcon className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                  <div className="font-display font-black text-lg">Sin archivo</div>
                  <p className="text-sm text-slate-500 mt-1">Agrega el parámetro ?url=... al link.</p>
                </div>
              </div>
            ) : kind === "pdf" ? (
              <iframe src={absoluteUrl} className="w-full h-full border-0 flex-1" title={name} />
            ) : kind === "word" ? (
              <WordViewer url={absoluteUrl} name={name} />
            ) : kind === "excel" ? (
              <ExcelViewer url={absoluteUrl} name={name} />
            ) : kind === "ppt" ? (
              // Antes: un <iframe> a Office Online que nunca cargaba (401). Ahora, el mismo
              // respaldo que cualquier formato sin vista previa. Para ver un PowerPoint de verdad
              // esta `FilePreviewModal`, que lo extrae en el servidor.
              <FallbackViewer name={name} url={absoluteUrl} kind={kind} />
            ) : kind === "image" ? (
              <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-[#101019] dark:to-[#07070E] p-4 overflow-auto">
                <img src={absoluteUrl} alt={name} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" />
              </div>
            ) : kind === "video" ? (
              <div className="flex-1 flex items-center justify-center bg-black p-4">
                <video src={absoluteUrl} controls className="max-w-full max-h-full rounded-xl" />
              </div>
            ) : kind === "audio" ? (
              <div className="flex-1 flex items-center justify-center p-10">
                <audio src={absoluteUrl} controls className="w-full max-w-2xl" />
              </div>
            ) : ["text", "code", "csv"].includes(kind) ? (
              <TextViewer content={textContent} loading={loadingText} kind={kind} />
            ) : (
              <FallbackViewer name={name} url={absoluteUrl} kind={kind} />
            )}
          </div>
        </div>
      </motion.main>
    </div>
  );
}

function WordViewer({ url, name }: { url: string; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"native" | "office">("native");
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== "native") return;
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const mammoth: any = await import("mammoth/mammoth.browser");
        const res = await fetch(url);
        if (!res.ok) throw new Error("No se pudo descargar");
        const buf = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(result.value || "<p><em>Documento vacío</em></p>");
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Error al convertir");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url, mode]);

  const copyAll = async () => {
    try {
      if (!contentRef.current) return;
      const text = contentRef.current.innerText;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Contenido copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("No se pudo copiar"); }
  };

  return (
    <>
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02] text-[11px] text-slate-600 dark:text-white/70 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
          <span className="font-bold">{mode === "native" ? "Modo lectura nativo" : "Microsoft Office Online"}</span>
        </div>
        <span className="text-slate-400 dark:text-white/40 hidden md:inline">· selecciona texto con el cursor y <kbd className="px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-white/10 text-[10px] font-bold">⌘C</kbd> para copiar</span>
        <button onClick={copyAll}
          className="ml-auto h-8 px-3 rounded-lg bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 font-ui text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition">
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          Copiar todo
        </button>
        <div className="flex items-center gap-0 rounded-lg bg-slate-200 dark:bg-white/10 p-0.5">
          <button onClick={() => setMode("native")}
            className={cn("h-7 px-2.5 rounded-md font-ui text-[10px] font-bold uppercase tracking-wider transition",
              mode === "native" ? "bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-white/60 hover:text-slate-900")}>
            Texto
          </button>

        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-orange" /></div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-10 text-center">
          <div className="max-w-md">
            <div className="font-display font-black text-lg mb-2">No se pudo renderizar nativamente</div>
            <p className="text-sm text-slate-500 mb-4">{error}</p>
            <button onClick={() => setMode("office")}
              className="h-10 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-ui text-[11px] font-bold uppercase tracking-wider">
              Abrir con Office Online
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto selection-doc bg-slate-50 dark:bg-[#0A0A14]">
          <motion.article
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            ref={contentRef}
            className="doc-prose mx-auto my-8 max-w-[860px] bg-white dark:bg-[#141421] border border-slate-200 dark:border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(15,23,42,0.08)] p-12 md:p-16 text-slate-900 dark:text-white/90 leading-relaxed cursor-text"
            dangerouslySetInnerHTML={{ __html: html || "" }}
          />
        </div>
      )}
    </>
  );
}

function ExcelViewer({ url, name }: { url: string; name: string }) {
  const [sheets, setSheets] = useState<{ name: string; rows: any[][] }[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"native" | "office">("native");

  useEffect(() => {
    if (mode !== "native") return;
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const XLSX: any = await import("xlsx");
        const res = await fetch(url);
        if (!res.ok) throw new Error("No se pudo descargar");
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const out = wb.SheetNames.map((sn: string) => ({
          name: sn,
          rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" }) as any[][]
        }));
        if (!cancelled) setSheets(out);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Error al leer hoja");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url, mode]);

  const sheet = sheets?.[activeSheet];

  return (
    <>
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02] text-[11px] text-slate-600 dark:text-white/70 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold">{mode === "native" ? "Modo lectura nativo" : "Microsoft Office Online"}</span>
        </div>
        <span className="text-slate-400 dark:text-white/40 hidden md:inline">· haz click en una celda para seleccionarla</span>
        <div className="ml-auto flex items-center gap-0 rounded-lg bg-slate-200 dark:bg-white/10 p-0.5">
          <button onClick={() => setMode("native")}
            className={cn("h-7 px-2.5 rounded-md font-ui text-[10px] font-bold uppercase tracking-wider transition",
              mode === "native" ? "bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-white/60")}>
            Tabla
          </button>

        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-orange" /></div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-10 text-center">
          <div className="max-w-md">
            <div className="font-display font-black text-lg mb-2">No se pudo leer la hoja</div>
            <p className="text-sm text-slate-500 mb-4">{error}</p>
            <button onClick={() => setMode("office")}
              className="h-10 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-ui text-[11px] font-bold uppercase tracking-wider">
              Abrir con Office Online
            </button>
          </div>
        </div>
      ) : !sheet ? null : (
        <div className="flex-1 flex flex-col min-h-0 selection-doc">
          {/* Tabs hojas */}
          {sheets && sheets.length > 1 && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-200 dark:border-white/10 overflow-x-auto scrollbar-thin">
              {sheets.map((s, i) => (
                <button key={i} onClick={() => setActiveSheet(i)}
                  className={cn("h-7 px-3 rounded-lg font-ui text-[10px] font-bold uppercase tracking-wider transition whitespace-nowrap",
                    i === activeSheet ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white")}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-auto">
            <table className="min-w-max text-[12.5px] border-separate border-spacing-0 w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-12 px-2 py-1.5 bg-slate-100 dark:bg-white/[0.06] text-[10px] font-ui text-slate-500 dark:text-white/50 border-b border-r border-slate-200 dark:border-white/10" />
                  {(sheet.rows[0] || []).map((_, j) => (
                    <th key={j} className="min-w-[100px] px-3 py-1.5 bg-slate-100 dark:bg-white/[0.06] text-[10px] font-ui uppercase tracking-wider text-slate-600 dark:text-white/70 border-b border-r border-slate-200 dark:border-white/10 text-left">
                      {String.fromCharCode(65 + (j % 26)) + (j >= 26 ? Math.floor(j / 26) : "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 2000).map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.02]"}>
                    <td className="w-12 px-2 py-1 text-[10px] font-ui text-slate-400 dark:text-white/40 border-b border-r border-slate-200 dark:border-white/10 text-center sticky left-0 bg-inherit">{ri + 1}</td>
                    {(row as any[]).map((cell, ci) => (
                      <td key={ci} className="px-3 py-1 border-b border-r border-slate-100 dark:border-white/5 text-slate-800 dark:text-white/90 truncate max-w-[300px] hover:bg-brand-orange/10 cursor-text">
                        {String(cell ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function TextViewer({ content, loading, kind }: { content: string | null; loading: boolean; kind: "text" | "code" | "csv" | string }) {
  if (loading) return (
    <div className="flex-1 flex items-center justify-center p-10">
      <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
    </div>
  );
  if (!content) return (
    <div className="flex-1 flex items-center justify-center p-10 text-slate-500">Sin contenido</div>
  );
  if (kind === "csv") {
    const rows = content.split(/\r?\n/).slice(0, 500).map((line) => line.split(","));
    if (rows.length === 0) return null;
    const [head, ...body] = rows;
    return (
      <div className="flex-1 overflow-auto p-6">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              {head.map((c, i) => (
                <th key={i} className="px-3 py-2 bg-slate-100 dark:bg-white/[0.06] text-left font-ui text-[10px] uppercase tracking-wider text-slate-600 dark:text-white/70 border-b border-slate-200 dark:border-white/10">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-white/[0.02]"}>
                {r.map((c, j) => <td key={j} className="px-3 py-1.5 border-b border-slate-100 dark:border-white/5 text-slate-800 dark:text-white/90">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="flex-1 overflow-auto p-6 text-[13px] leading-relaxed text-slate-800 dark:text-white/90 font-mono whitespace-pre-wrap break-words">
      {content}
    </pre>
  );
}

function FallbackViewer({ name, url, kind }: { name: string; url: string; kind: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-10 text-center">
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="max-w-md">
        <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-brand-orange/15 to-neon-magenta/10 flex items-center justify-center mx-auto mb-4">
          <FileIcon className="h-10 w-10 text-brand-orange" strokeWidth={1.8} />
        </div>
        <div className="font-display font-black text-2xl mb-1 text-slate-900 dark:text-white">Vista previa no disponible</div>
        <p className="text-slate-600 dark:text-white/65 mb-6">
          No hay un visor integrado para este tipo de archivo ({kind}).
          Descárgalo para abrirlo con tu aplicación preferida.
        </p>
        <a href={url} download={name} target="_blank" rel="noopener"
          className="inline-flex items-center gap-1.5 h-11 px-6 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white font-ui text-[12px] font-bold uppercase tracking-wider shadow-lg">
          <Download className="h-4 w-4" strokeWidth={2.5} />
          Descargar archivo
        </a>
      </motion.div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0A0A14]">
        <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
      </div>
    }>
      <ViewerPageInner />
    </Suspense>
  );
}
