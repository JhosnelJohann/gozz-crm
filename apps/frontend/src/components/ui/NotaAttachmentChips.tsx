"use client";
import { useEffect, useState } from "react";
import { X, FileText } from "@/lib/bootstrap-icons";

export type NotaArchivoT = { url: string; filename: string; mime?: string; size?: number };

function archivoEsImagen(a: NotaArchivoT) {
  return (a.mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.url || a.filename || "");
}

/** Miniatura/chip de un archivo NUEVO (File aún no subido). Muestra preview si es imagen. */
export function NewFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImg = file.type.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImg) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImg]);

  if (isImg) {
    return (
      <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-brand-orange/30 bg-neutral-100 shrink-0" title={file.name}>
        {url && <img src={url} alt={file.name} className="h-full w-full object-cover" />}
        <button type="button" onClick={onRemove} title="Quitar" className="absolute top-0.5 right-0.5 h-5 w-5 rounded-md bg-black/50 hover:bg-brand-red text-white flex items-center justify-center">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 text-[11px] bg-brand-orange/10 border border-brand-orange/25 text-brand-orange rounded-lg px-2.5 py-1.5">
      <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span className="truncate max-w-[180px]">{file.name}</span>
      <span className="text-[10px] text-brand-orange/70 tabular-nums">{(file.size / 1024).toFixed(0)} KB</span>
      <button type="button" onClick={onRemove} title="Quitar" className="h-5 w-5 rounded-md hover:bg-red-50 hover:text-brand-red text-brand-orange/70 flex items-center justify-center">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Miniatura/chip de un archivo YA guardado, con opción de quitar (modo edición). */
export function ExistingArchivoChip({ archivo, onRemove, onPreview }: { archivo: NotaArchivoT; onRemove: () => void; onPreview?: () => void }) {
  if (archivoEsImagen(archivo)) {
    return (
      <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100 shrink-0" title={archivo.filename}>
        <img src={archivo.url} alt={archivo.filename} className="h-full w-full object-cover cursor-pointer" onClick={onPreview} />
        <button type="button" onClick={onRemove} title="Quitar" className="absolute top-0.5 right-0.5 h-5 w-5 rounded-md bg-black/50 hover:bg-brand-red text-white flex items-center justify-center">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 text-[11px] bg-brand-blue/10 border border-brand-blue/20 text-brand-blue rounded-lg px-2.5 py-1.5">
      <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <button type="button" onClick={onPreview} className="truncate max-w-[180px] font-semibold hover:underline">{archivo.filename}</button>
      <button type="button" onClick={onRemove} title="Quitar" className="h-5 w-5 rounded-md hover:bg-red-50 hover:text-brand-red text-brand-blue/70 flex items-center justify-center">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
