"use client";
import { motion } from "framer-motion";
import {
  FileText, FileSpreadsheet, Presentation, FileArchive, FileCode,
  FileImage, FileVideo, FileAudio, File as FileIcon, Download, Eye
} from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  filename?: string | null;
  mime?: string | null;
  size?: number | null;
  isMe: boolean;
  /**
   * Abrir el visor NO se decide aqui. Lo hace `ChatMessages`, que es el unico que sabe que otros
   * archivos hay en la conversacion y por tanto el unico que puede darle al visor sus flechas.
   */
  onVer: () => void;
}

function ext(name?: string | null) {
  if (!name) return "";
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function kindOf(name?: string | null, mime?: string | null) {
  const e = ext(name);
  const m = (mime || "").toLowerCase();
  if (e === "pdf" || m === "application/pdf") return "pdf";
  if (["doc", "docx", "rtf", "odt"].includes(e) || m.includes("wordprocessingml") || m.includes("msword")) return "word";
  if (["xls", "xlsx", "ods", "csv"].includes(e) || m.includes("spreadsheetml") || m.includes("excel")) return "excel";
  if (["ppt", "pptx", "odp"].includes(e) || m.includes("presentationml") || m.includes("powerpoint")) return "ppt";
  if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return "archive";
  if (["md", "txt", "log"].includes(e) || m === "text/plain" || m === "text/markdown") return "text";
  if (["json", "xml", "yaml", "yml", "js", "ts", "tsx", "jsx", "css", "html", "sh", "py"].includes(e)) return "code";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "other";
}

const STYLE: Record<string, { Icon: any; color: string; tint: string; tintDark: string; label: string }> = {
  pdf:     { Icon: FileText,       color: "text-red-600",     tint: "bg-red-100",     tintDark: "dark:bg-red-500/15",     label: "PDF" },
  word:    { Icon: FileText,       color: "text-sky-600",     tint: "bg-sky-100",     tintDark: "dark:bg-sky-500/15",     label: "Word" },
  excel:   { Icon: FileSpreadsheet,color: "text-emerald-600", tint: "bg-emerald-100", tintDark: "dark:bg-emerald-500/15", label: "Excel" },
  ppt:     { Icon: Presentation,   color: "text-orange-600",  tint: "bg-orange-100",  tintDark: "dark:bg-orange-500/15",  label: "PPT" },
  archive: { Icon: FileArchive,    color: "text-violet-600",  tint: "bg-violet-100",  tintDark: "dark:bg-violet-500/15",  label: "ZIP" },
  text:    { Icon: FileText,       color: "text-slate-600",   tint: "bg-slate-100",   tintDark: "dark:bg-slate-500/15",   label: "TXT" },
  code:    { Icon: FileCode,       color: "text-fuchsia-600", tint: "bg-fuchsia-100", tintDark: "dark:bg-fuchsia-500/15", label: "CODE" },
  image:   { Icon: FileImage,      color: "text-pink-600",    tint: "bg-pink-100",    tintDark: "dark:bg-pink-500/15",    label: "IMG" },
  video:   { Icon: FileVideo,      color: "text-indigo-600",  tint: "bg-indigo-100",  tintDark: "dark:bg-indigo-500/15",  label: "VIDEO" },
  audio:   { Icon: FileAudio,      color: "text-amber-600",   tint: "bg-amber-100",   tintDark: "dark:bg-amber-500/15",   label: "AUDIO" },
  other:   { Icon: FileIcon,       color: "text-neutral-600", tint: "bg-neutral-100", tintDark: "dark:bg-neutral-500/15", label: "FILE" },
};

function fmtSize(n?: number | null) {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FileMessage({ url, filename, mime, size, isMe, onVer }: Props) {
  const kind = kindOf(filename, mime);
  const s = STYLE[kind] || STYLE.other;
  const Icon = s.Icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mt-2 rounded-2xl border min-w-[240px] max-w-[340px] bg-white dark:bg-white/5 shadow-sm",
        isMe ? "border-[#9dd7aa]/60 dark:border-white/10" : "border-slate-200 dark:border-white/10"
      )}
    >
      <div className="px-3 py-3 flex items-center gap-3">
        <motion.div
          whileHover={{ scale: 1.05, rotate: -3 }}
          transition={{ type: "spring", stiffness: 300, damping: 18 }}
          className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0 relative", s.tint, s.tintDark)}
        >
          <Icon className={cn("h-5 w-5", s.color)} strokeWidth={1.8} />
          <span className={cn(
            "absolute -bottom-1 -right-1 h-4 min-w-[26px] px-1 rounded-md bg-white dark:bg-[#202c33] border border-black/5 dark:border-white/10 text-[8px] font-ui font-bold tracking-wider flex items-center justify-center",
            s.color
          )}>
            {s.label}
          </span>
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-display font-bold text-slate-900 dark:text-white/95 truncate">{filename || "archivo"}</div>
          <div className="text-[11px] text-slate-500 dark:text-white/55 flex items-center gap-1.5">
            {fmtSize(size) && <span className="tabular-nums">{fmtSize(size)}</span>}
            {fmtSize(size) && <span>·</span>}
            <span className="uppercase tracking-wider font-bold">{ext(filename) || s.label.toLowerCase()}</span>
          </div>
        </div>
      </div>
      <div className="px-2 pb-2 flex items-center gap-1 border-t border-black/[0.04] dark:border-white/5 pt-2">
        <button
          type="button"
          onClick={onVer}
          className="flex-1 h-9 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white font-ui text-[10.5px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition"
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={2.5} />
          Ver
        </button>
        <a
          href={url}
          download={filename || true}
          target="_blank"
          rel="noopener"
          className="h-9 px-3 rounded-xl bg-slate-700 hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/15 text-white dark:text-white/85 font-ui text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          Descargar
        </a>
      </div>
    </motion.div>
  );
}
