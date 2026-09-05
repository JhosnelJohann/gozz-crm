"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Trash2, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Download, Eye, Loader2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FilePreviewModal } from "@/components/drive/DriveBrowser";
import { vecinoDeArchivo } from "@/lib/chat-archivos";

interface Archivo {
  id: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  url: string;
  uploader_nombre: string | null;
  created_at: string;
}

export function TaskFiles({ tareaId }: { tareaId: string }) {
  const [items, setItems] = useState<Archivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // ════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 ESTA PANTALLA TENIA SU PROPIO VISOR, HECHO A MANO
  // ════════════════════════════════════════════════════════════════════════════════════════
  // Eran 50 lineas que solo sabian pintar imagen y PDF, y que la tanda D2 —«un solo visor de
  // archivos»— no llego a absorber. La consecuencia era peor que la falta de flechas: el boton
  // del ojo se pintaba con `isPreviewable(mime)`, que devolvia false para un JSON, un .txt, un
  // .csv, un Word, un Excel, un video o un audio. Para todos esos NO HABIA forma de verlos, solo
  // de descargarlos — y el visor bueno sabe pintar los siete.
  //
  // Se guarda el ID y no el objeto: al borrar un archivo la lista se recarga, y un objeto viejo
  // se quedaria abierto enseniando algo que ya no existe.
  const [verId, setVerId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tareas/${tareaId}/archivos`);
      const d = await r.json();
      setItems(d.archivos || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [tareaId]);

  // Sube uno o varios archivos. Secuencial: el backend acepta upload.single por request.
  const upload = async (files: FileList | File[]) => {
    const MAX = 50 * 1024 * 1024;
    const list = Array.from(files);
    const valid = list.filter((f) => f.size <= MAX);
    const tooBig = list.length - valid.length;
    if (tooBig > 0) toast.error(`${tooBig} archivo(s) superan 50 MB y se omitieron`);
    if (!valid.length) return;
    setUploading(true);
    let ok = 0;
    try {
      for (let i = 0; i < valid.length; i++) {
        setProgress({ done: i, total: valid.length });
        const fd = new FormData();
        fd.append("file", valid[i]);
        const r = await fetch(`/api/tareas/${tareaId}/archivos`, { method: "POST", body: fd });
        if (r.ok) ok++;
      }
      if (ok > 0) toast.success(ok === 1 ? "Archivo subido" : `${ok} archivos subidos`);
      if (ok < valid.length) toast.error(`${valid.length - ok} archivo(s) no se subieron`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) upload(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar archivo?")) return;
    await fetch(`/api/tareas/${tareaId}/archivos/${id}`, { method: "DELETE" });
    toast.success("Archivo eliminado");
    load();
  };

  // Lo que recorren las flechas es la lista tal como se ve. `vecinoDeArchivo` pide `tipo` y
  // `archivo_url` porque nacio para el chat; aqui se le da la forma que espera y no se duplica la
  // aritmetica de los extremos, que es donde vive el off-by-one.
  const paraRecorrer = items.map((a) => ({ id: a.id, tipo: "archivo", archivo_url: a.url }));
  const verIndice = items.findIndex((a) => a.id === verId);
  const verActual = verIndice < 0 ? null : items[verIndice];

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-2xl border-2 border-dashed transition-colors px-4 py-4 text-center",
          dragOver ? "border-brand-orange bg-brand-orange/5" : "border-neutral-200 bg-neutral-50/60"
        )}
      >
        <input ref={fileRef} type="file" multiple className="hidden" onChange={onFileSelected} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider border border-brand-orange/30 hover:bg-brand-orange hover:text-white transition-colors disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" strokeWidth={2} />}
          {uploading && progress ? `Subiendo ${progress.done + 1}/${progress.total}…` : "Adjuntar documentos, archivos o imágenes"}
        </button>
        <div className="text-[11px] text-neutral-400 mt-1.5">o arrastra y suelta aquí · varios a la vez · hasta 50 MB c/u</div>
      </div>

      {loading ? (
        <div className="mt-3 text-center py-4 text-neutral-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
      ) : items.length === 0 ? null : (
        <div className="mt-3 space-y-1.5">
          <AnimatePresence initial={false}>
            {items.map((a) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -10 }}
                className="bg-white rounded-xl border border-neutral-100 px-3 py-2.5 flex items-center gap-3 group"
              >
                <FileTypeIcon mime={a.mime} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{a.filename}</div>
                  <div className="text-[10px] text-neutral-400 flex gap-2">
                    {a.size_bytes && <span>{formatSize(a.size_bytes)}</span>}
                    {a.uploader_nombre && <span>· {a.uploader_nombre}</span>}
                    <span>· {new Date(a.created_at).toLocaleDateString("es", { day: "2-digit", month: "short" })}</span>
                  </div>
                </div>
                {/* El ojo va SIEMPRE. Que se sepa pintar o no lo decide el visor, que ademas
                    ofrece descargar diciendo por que cuando no sabe. Esconderlo dejaba sin ver un
                    JSON o un CSV que si se pintan perfectamente. */}
                <button
                  onClick={() => setVerId(a.id)}
                  className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-500"
                  title="Ver"
                >
                  <Eye className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <a
                  href={a.url}
                  download={a.filename}
                  target="_blank"
                  rel="noopener"
                  className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-500"
                  title="Descargar"
                >
                  <Download className="h-4 w-4" strokeWidth={1.8} />
                </a>
                <button
                  onClick={() => remove(a.id)}
                  className="h-8 w-8 rounded-lg hover:bg-red-50 text-neutral-400 hover:text-brand-red flex items-center justify-center transition-colors"
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* El visor compartido, con flechas para recorrer los adjuntos de la tarea en el orden en
          que se ven en la lista. Un adjunto de tarea no es del Drive: se le pasa la `url` a secas,
          asi que para un Word o un Excel ofrecera descargar en vez de extraer su texto. */}
      {verActual && (
        <FilePreviewModal
          file={{ url: verActual.url, nombre: verActual.filename, mime: verActual.mime, size_bytes: verActual.size_bytes }}
          onClose={() => setVerId(null)}
          onPrev={() => setVerId((id) => vecinoDeArchivo(paraRecorrer, id, -1) ?? id)}
          onNext={() => setVerId((id) => vecinoDeArchivo(paraRecorrer, id, +1) ?? id)}
          posicion={verIndice < 0 ? undefined : { indice: verIndice, total: items.length }}
        />
      )}
    </>
  );
}

function FileTypeIcon({ mime }: { mime: string | null }) {
  if (!mime) return <FileIcon className="h-4 w-4 text-neutral-400 shrink-0" strokeWidth={1.8} />;
  if (mime.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-brand-blue shrink-0" strokeWidth={1.8} />;
  if (mime === "application/pdf") return <FileText className="h-4 w-4 text-brand-red shrink-0" strokeWidth={1.8} />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet className="h-4 w-4 text-brand-green shrink-0" strokeWidth={1.8} />;
  if (mime.includes("word") || mime.includes("document")) return <FileText className="h-4 w-4 text-brand-blue shrink-0" strokeWidth={1.8} />;
  return <FileIcon className="h-4 w-4 text-neutral-400 shrink-0" strokeWidth={1.8} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
