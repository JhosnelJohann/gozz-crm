"use client";
import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Trash2, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Loader2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Selector de adjuntos para tareas AÚN NO CREADAS: mantiene los archivos en memoria
// (no hay tarea_id todavía). El padre los sube tras crear la tarea (ver TaskModal.save()).
export function TaskFilesStaging({
  files,
  onChange,
  uploading = false
}: {
  files: File[];
  onChange: (f: File[]) => void;
  uploading?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const MAX = 50 * 1024 * 1024;

  const addFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    const arr = Array.from(list);
    const ok = arr.filter((f) => f.size <= MAX);
    const tooBig = arr.length - ok.length;
    if (tooBig > 0) toast.error(`${tooBig} archivo(s) superan 50 MB y se omitieron`);
    if (ok.length) onChange([...files, ...ok]);
  };

  const remove = (i: number) => {
    const next = [...files];
    next.splice(i, 1);
    onChange(next);
  };

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        className={cn(
          "rounded-2xl border-2 border-dashed transition-colors px-4 py-4 text-center",
          dragOver ? "border-brand-orange bg-brand-orange/5" : "border-neutral-200 bg-neutral-50/60"
        )}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider border border-brand-orange/30 hover:bg-brand-orange hover:text-white transition-colors disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2} />}
          {uploading ? "Subiendo…" : "Adjuntar documentos, archivos o imágenes"}
        </button>
        <div className="text-[11px] text-neutral-400 mt-1.5">o arrastra y suelta aquí · varios a la vez · hasta 50 MB c/u</div>
        <div className="text-[11px] text-neutral-400 mt-0.5">Se subirán al crear la tarea.</div>
      </div>

      {files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <AnimatePresence initial={false}>
            {files.map((f, i) => (
              <PendingRow key={`${f.name}-${f.size}-${i}`} file={f} onRemove={() => remove(i)} disabled={uploading} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

function PendingRow({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled?: boolean }) {
  const previewUrl = useMemo(
    () => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file]
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -10 }}
      className="bg-white rounded-xl border border-neutral-100 px-3 py-2.5 flex items-center gap-3 group"
    >
      {previewUrl ? (
        <img src={previewUrl} alt="" className="h-9 w-9 rounded-lg object-cover shrink-0" />
      ) : (
        <FileTypeIcon mime={file.type} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{file.name}</div>
        <div className="text-[10px] text-neutral-400 flex gap-2">
          <span>{formatSize(file.size)}</span>
          <span>· pendiente de subir</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="h-8 w-8 rounded-lg hover:bg-red-50 text-neutral-400 hover:text-brand-red flex items-center justify-center transition-colors disabled:opacity-50"
        title="Quitar"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </motion.div>
  );
}

function FileTypeIcon({ mime }: { mime: string | null }) {
  if (!mime) return <FileIcon className="h-9 w-9 p-2 text-neutral-400 shrink-0" strokeWidth={1.8} />;
  if (mime.startsWith("image/")) return <ImageIcon className="h-9 w-9 p-2 text-brand-blue shrink-0" strokeWidth={1.8} />;
  if (mime === "application/pdf") return <FileText className="h-9 w-9 p-2 text-brand-red shrink-0" strokeWidth={1.8} />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet className="h-9 w-9 p-2 text-brand-green shrink-0" strokeWidth={1.8} />;
  if (mime.includes("word") || mime.includes("document")) return <FileText className="h-9 w-9 p-2 text-brand-blue shrink-0" strokeWidth={1.8} />;
  return <FileIcon className="h-9 w-9 p-2 text-neutral-400 shrink-0" strokeWidth={1.8} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
