"use client";
// Panel de Nivel 2 de la papelera del Drive: "Sin identificar / Cuarentena" + "Conservados" (fuentes disco+drive).
// Extraído VERBATIM de configuracion/archivos-sin-identificar/page.tsx (Fase B3, sin cambios de lógica).
// Único cambio: la pestaña `tab` es CONTROLADA por el contenedor (prop `tab` + `onTabChange`), con `hideTabBar`
// para embeberlo en el modal de papelera del Drive (que aporta las pestañas de nivel). Gating admin lo hace el modal.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw, AlertCircle, Trash2, ShieldCheck, Eye, Download, ArrowUp, ArrowDown, RotateCcw, X,
  FileText, FileSpreadsheet, FileImage, FileVideo, FileAudio, FileArchive, File as FileIcon, Archive,
} from "@/lib/bootstrap-icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { DateRangePopover, PAST_PRESETS, type DateRange } from "@/components/ui/DateRangePopover";
import { useCurrentUser } from "@/lib/auth-user";
import { cn } from "@/lib/utils";
import { FilePreviewModal } from "./DriveBrowser";
import { MiniaturaArchivo } from "./MiniaturaArchivo";

interface Item {
  id: string;
  origen: "disco" | "drive";
  filename: string;
  url_original: string | null;
  path_actual: string | null;
  tamano_bytes: number | null;
  mime: string | null;
  subido_en: string | null;
  cuarentena_en: string | null;
  purgar_en: string | null;
  estado: string;
  conservado_en: string | null;
  conservado_por: string | null;
  usuario_id: string | null;
  usuario_nombre: string | null;
  nota: string | null;
  dias_restantes: number | null;
}

export type SinIdentificarTab = "cuarentena" | "conservado";
type Tab = SinIdentificarTab;
const PAGE_SIZE = 25;

// Filtros data-driven (para que Papelera/árbol reusen la barra con otro set).
const ORIGENES: { value: string; label: string }[] = [
  { value: "", label: "Disco y Drive" },
  { value: "disco", label: "Disco (legacy)" },
  { value: "drive", label: "Drive" },
];
const TIPOS: { value: string; label: string }[] = [
  { value: "", label: "Todos los tipos" },
  { value: "imagen", label: "Imágenes" },
  { value: "pdf", label: "PDF" },
  { value: "documento", label: "Documentos" },
  { value: "hoja", label: "Hojas de cálculo" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "comprimido", label: "Comprimidos" },
  { value: "otro", label: "Otros" },
];

const fmtSize = (bytes?: number | null) => {
  if (bytes == null) return "—";
  const b = Number(bytes);
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 1024 ? 2 : 1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtFecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : "—";


// URL de preview/descarga según origen: disco → /uploads (estático); drive → proxy del Drive (lee de R2).
const previewUrl = (it: Item): string | null =>
  it.origen === "drive" ? `/api/drive/files/${it.id}/raw` : (it.path_actual ? `/uploads/${it.path_actual}` : null);
const downloadUrl = (it: Item): string | null =>
  it.origen === "drive" ? `/api/drive/files/${it.id}/download` : (it.path_actual ? `/uploads/${it.path_actual}` : null);

const MAX_DESCARGA = 150 * 1024 * 1024; // 150 MB por descarga (por peso, no por cantidad)

// Nombre del .zip: AAAAMMDD_HHMM_Archivos_<Sin_Identificar|Conservados>_GOZZ.zip — hora de Nueva York.
function nombreZip(tab: Tab) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const stamp = `${g("year")}${g("month")}${g("day")}_${g("hour")}${g("minute")}`;
  const etiqueta = tab === "cuarentena" ? "Sin_Identificar" : "Conservados";
  return `${stamp}_Archivos_${etiqueta}_GOZZ.zip`;
}

// Ejecuta fn sobre cada item con concurrencia máxima `limit` (no todo en paralelo).
async function mapLimit<T, R>(items: T[], limit: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

function KindIcon({ mime, filename }: { mime: string | null; filename: string }) {
  const m = (mime || "").toLowerCase();
  const e = (filename.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  let Icon: any = FileIcon;
  let color = "text-neutral-400";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) { Icon = FileImage; color = "text-pink-500"; }
  else if (m === "application/pdf" || e === "pdf") { Icon = FileText; color = "text-red-500"; }
  else if (m.includes("word") || ["doc", "docx"].includes(e)) { Icon = FileText; color = "text-sky-500"; }
  else if (m.includes("sheet") || m.includes("excel") || ["xls", "xlsx", "csv"].includes(e)) { Icon = FileSpreadsheet; color = "text-emerald-500"; }
  else if (m.startsWith("video/") || ["mp4", "webm", "mov"].includes(e)) { Icon = FileVideo; color = "text-indigo-500"; }
  else if (m.startsWith("audio/") || ["mp3", "wav", "ogg"].includes(e)) { Icon = FileAudio; color = "text-amber-500"; }
  else if (["zip", "rar", "7z", "tar", "gz"].includes(e)) { Icon = FileArchive; color = "text-violet-500"; }
  return <Icon className={cn("h-5 w-5", color)} strokeWidth={1.8} />;
}

// Select genérico para la barra de filtros (resalta cuando hay valor activo).
function FilterSelect({ value, onChange, options, title }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; title?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className={cn(
        "h-9 px-3 rounded-xl text-sm border outline-none transition cursor-pointer font-inter",
        value
          ? "bg-brand-orange/10 border-brand-orange/30 text-brand-orange font-semibold"
          : "bg-neutral-50 border-transparent hover:bg-white hover:border-slate-200 text-slate-700"
      )}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function SinIdentificarPanel({ tab: controlledTab, onTabChange, hideTabBar }: {
  tab?: Tab;
  onTabChange?: (t: Tab) => void;
  hideTabBar?: boolean;
}) {
  const { isAdmin, loading: loadingUser } = useCurrentUser();
  const [tab, setTab] = useState<Tab>(controlledTab ?? "cuarentena");

  // Datos de la página activa (server-side).
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [orden, setOrden] = useState<"desc" | "asc">("desc"); // recencia; DESC = lo recién movido, arriba
  const [usuarios, setUsuarios] = useState<{ id: string; nombre: string }[]>([]);

  // Filtros.
  const [origen, setOrigen] = useState("");
  const [tipo, setTipo] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rango, setRango] = useState<DateRange>({ from: null, to: null });

  // Contadores de pestaña (sin filtros).
  const [countCuarentena, setCountCuarentena] = useState(0);
  const [countConservado, setCountConservado] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump → recarga (tras mutaciones)
  const [selected, setSelected] = useState<Set<string>>(new Set()); // scoped a la página actual
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState<{ id: string; filename: string } | null>(null); // Fase B2: borrado permanente de fila drive
  const [borrando, setBorrando] = useState(false);
  const [accionando, setAccionando] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtrosActivos = !!(origen || tipo || usuario || rango.from || rango.to);
  const refrescar = () => setNonce((n) => n + 1);

  // Al cambiar cualquier filtro/orden → volvemos a la página 1 (evita quedar en una página inexistente).
  const setFiltroOrigen = (v: string) => { setOrigen(v); setPage(1); };
  const setFiltroTipo = (v: string) => { setTipo(v); setPage(1); };
  const setFiltroUsuario = (v: string) => { setUsuario(v); setPage(1); };
  const setFiltroRango = (r: DateRange) => { setRango(r); setPage(1); };
  const toggleOrden = () => { setOrden((v) => (v === "desc" ? "asc" : "desc")); setPage(1); };
  const limpiarFiltros = () => { setOrigen(""); setTipo(""); setUsuario(""); setRango({ from: null, to: null }); setPage(1); };

  // --- Carga de la página activa (con filtros/orden/paginación). Guard anti-carreras por reqId. ---
  useEffect(() => {
    if (!isAdmin) { if (!loadingUser) setLoading(false); return; }
    let cancelado = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      const p = new URLSearchParams();
      p.set("estado", tab);
      p.set("page", String(page));
      p.set("pageSize", String(PAGE_SIZE));
      p.set("orden", orden);
      if (origen) p.set("origen", origen);
      if (tipo) p.set("tipo", tipo);
      if (usuario) p.set("usuario", usuario);
      if (rango.from) p.set("desde", rango.from.toISOString());
      if (rango.to) p.set("hasta", rango.to.toISOString());
      try {
        let r: Response;
        try { r = await fetch(`/api/uploads/sin-identificar?${p.toString()}`); }
        catch { throw new Error("No se pudo conectar con el servidor. Revisa tu conexión."); }
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.error || `La petición falló (HTTP ${r.status}).`);
        }
        const d = await r.json();
        if (cancelado) return;
        // Si la página quedó fuera de rango (p.ej. tras conservar el último ítem), retrocedemos a la 1.
        if ((d.archivos?.length ?? 0) === 0 && page > 1 && (d.total ?? 0) > 0) { setPage(1); return; }
        setItems(d.archivos || []);
        setTotal(d.total || 0);
        setUsuarios(d.usuarios || []);
        setSelected(new Set()); // la selección es por página: se limpia en cada carga
      } catch (e: any) {
        if (!cancelado) setError(e?.message || "No se pudo cargar la lista.");
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    run();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loadingUser, tab, page, orden, origen, tipo, usuario, rango.from, rango.to, nonce]);

  // --- Contadores de pestaña (sin filtros; se recalculan al refrescar). ---
  useEffect(() => {
    if (!isAdmin) return;
    let cancelado = false;
    const cargarCount = async (estado: Tab, set: (n: number) => void) => {
      try {
        const r = await fetch(`/api/uploads/sin-identificar?estado=${estado}&solo_total=1`);
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelado) set(d.total || 0);
      } catch { /* el badge simplemente no se actualiza */ }
    };
    cargarCount("cuarentena", setCountCuarentena);
    cargarCount("conservado", setCountConservado);
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, nonce]);

  const cambiarTab = (t: Tab) => { if (t === tab) return; setTab(t); setPage(1); setUsuario(""); setSelected(new Set()); onTabChange?.(t); };

  // Sincroniza la pestaña CONTROLADA por el contenedor (modal) con el estado interno (mismo efecto que cambiarTab).
  useEffect(() => { if (controlledTab && controlledTab !== tab) cambiarTab(controlledTab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [controlledTab]);

  const allSelected = items.length > 0 && items.every((it) => selected.has(it.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 🔴 LAS DOS PROCEDENCIAS, Y ES LA RAMA QUE SE ROMPE SIN QUE SE NOTE.
  // Antes esto abria la pagina `/view` en una pestania nueva y le daba igual de donde viniera el
  // archivo. Ahora abre la modal, que necesita saberlo:
  //   · origen "drive" → se le pasa el `id`, y con el la extraccion en servidor de Word, Excel y
  //     PowerPoint sigue funcionando;
  //   · origen "disco" (`/uploads/`) → NO hay id, asi que se le pasa la `url` a secas. La modal
  //     pinta lo que el navegador sabe pintar y para ofimatica ofrece descargar, diciendo por que.
  // Mandar siempre el id seria pedirle al servidor la conversion de un archivo que no conoce;
  // no mandarlo nunca le quitaria la vista previa de Word a la mitad de los archivos.
  const [verItem, setVerItem] = useState<Item | null>(null);
  const origenDelVisor = (it: Item) => {
    const url = previewUrl(it);
    if (!url) return null;
    return it.origen === "drive"
      ? { id: it.id, url, nombre: it.filename, mime: it.mime ?? null }
      : { url, nombre: it.filename, mime: it.mime ?? null };
  };
  const ver = (it: Item) => { if (previewUrl(it)) setVerItem(it); };

  const descargarUno = (it: Item) => {
    const src = downloadUrl(it);
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = it.filename;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Descarga de la selección (página actual): 1 archivo → directo; 2+ → un único .zip. Tope 150 MB por peso.
  const descargarSeleccion = async () => {
    const sel = items.filter((it) => selected.has(it.id) && downloadUrl(it));
    if (sel.length === 0) return;
    const totalBytes = sel.reduce((s, it) => s + (Number(it.tamano_bytes) || 0), 0);
    if (totalBytes > MAX_DESCARGA) {
      toast.error(`Máximo 150 MB por descarga — seleccionaste ${Math.round(totalBytes / (1024 * 1024))} MB. Desmarca algunos archivos.`);
      return;
    }
    if (sel.length === 1) { descargarUno(sel[0]); return; }
    const tid = toast.loading(`Comprimiendo ${sel.length} archivos…`);
    setBulkBusy(true);
    try {
      const JSZip = (await import("jszip")).default; // carga bajo demanda: no entra al bundle general
      // Descarga con concurrencia limitada (6 a la vez), no todo en paralelo.
      const fetched = await mapLimit(sel, 6, async (it) => {
        try { const r = await fetch(downloadUrl(it)!); if (!r.ok) return null; return { filename: it.filename, blob: await r.blob() }; }
        catch { return null; }
      });
      const zip = new JSZip();
      const usados = new Map<string, number>();
      let agregados = 0;
      for (const f of fetched) {
        if (!f) continue;
        let name = f.filename;
        if (usados.has(name)) {
          const n = (usados.get(name) || 1) + 1; usados.set(name, n);
          const dot = name.lastIndexOf(".");
          name = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
        } else usados.set(name, 1);
        zip.file(name, f.blob); agregados++;
      }
      if (agregados === 0) { toast.error("No se pudo descargar ningún archivo", { id: tid }); return; }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a"); a.href = url; a.download = nombreZip(tab);
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const fallidos = sel.length - agregados;
      toast.success(`${agregados} archivo(s) en .zip${fallidos ? ` · ${fallidos} no se pudo(ieron)` : ""}`, { id: tid });
    } catch { toast.error("No se pudo generar el .zip", { id: tid }); }
    finally { setBulkBusy(false); }
  };

  const conservar = async (it: Item) => {
    setAccionando((s) => new Set(s).add(it.id));
    try {
      const url = it.origen === "drive"
        ? `/api/drive/trash/conservar/file/${it.id}`
        : `/api/uploads/sin-identificar/${it.id}/conservar`;
      const r = await fetch(url, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo conservar");
      toast.success("Archivo conservado");
      refrescar();
    } catch (e: any) { toast.error(e.message); }
    finally { setAccionando((s) => { const n = new Set(s); n.delete(it.id); return n; }); }
  };

  // Restaurar al Drive (solo origen='drive'): vuelve a su carpeta de origen → General del contacto → "Sin ubicación".
  const restaurar = async (it: Item) => {
    setAccionando((s) => new Set(s).add(it.id));
    try {
      const r = await fetch(`/api/drive/trash/restore/file/${it.id}`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo restaurar");
      toast.success("Archivo restaurado al Drive");
      refrescar();
    } catch (e: any) { toast.error(e.message); }
    finally { setAccionando((s) => { const n = new Set(s); n.delete(it.id); return n; }); }
  };

  const devolver = async (it: Item) => {
    setAccionando((s) => new Set(s).add(it.id));
    try {
      const r = await fetch(`/api/uploads/sin-identificar/${it.id}/devolver`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo devolver");
      toast.success("Devuelto a sin identificar");
      refrescar();
    } catch (e: any) { toast.error(e.message); }
    finally { setAccionando((s) => { const n = new Set(s); n.delete(it.id); return n; }); }
  };

  // Acción masiva conservar / (restaurar|devolver) — ruteada por origen de cada fila (secuencial; cuenta éxitos).
  // 'conservar': disco→legacy, drive→drive conservar. 'devolver': disco→devolver legacy, drive→restore al Drive.
  const bulkMover = async (accion: "conservar" | "devolver") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const byId = new Map(items.map((it) => [it.id, it]));
    const tid = toast.loading(`${accion === "conservar" ? "Conservando" : "Restaurando/Devolviendo"} ${ids.length}…`);
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) {
      const it = byId.get(id);
      if (!it) { fail++; continue; }
      const url = accion === "conservar"
        ? (it.origen === "drive" ? `/api/drive/trash/conservar/file/${id}` : `/api/uploads/sin-identificar/${id}/conservar`)
        : (it.origen === "drive" ? `/api/drive/trash/restore/file/${id}` : `/api/uploads/sin-identificar/${id}/devolver`);
      try { const r = await fetch(url, { method: "POST" }); if (r.ok) ok++; else fail++; } catch { fail++; }
    }
    if (fail === 0) toast.success(`${ok} listo(s)`, { id: tid });
    else toast.warning(`${ok} ok, ${fail} fallaron`, { id: tid });
    setSelected(new Set()); setBulkBusy(false); refrescar();
  };

  // El borrado permanente solo aplica a disco (legacy). Las filas Drive se SALTEAN (su purga es Fase B2).
  const confirmBorrar = async () => {
    if (!deleteConfirm) return;
    setBorrando(true);
    const byId = new Map(items.map((it) => [it.id, it]));
    const discoIds = deleteConfirm.ids.filter((id) => byId.get(id)?.origen !== "drive");
    const skipDrive = deleteConfirm.ids.length - discoIds.length;
    let ok = 0, fail = 0;
    for (const id of discoIds) {
      try { const r = await fetch(`/api/uploads/sin-identificar/${id}`, { method: "DELETE" }); if (r.ok) ok++; else fail++; } catch { fail++; }
    }
    const nota = skipDrive ? ` · ${skipDrive} de Drive no se borran (B2)` : "";
    if (fail === 0) toast.success(`${ok} archivo(s) borrado(s)${nota}`);
    else toast.warning(`${ok} borrado(s), ${fail} fallaron${nota}`);
    setDeleteConfirm(null); setBorrando(false); setSelected(new Set()); refrescar();
  };

  // Fase B2 — borrado PERMANENTE de una fila del Drive (cuarentena/conservado). Irreversible: borra la fila y,
  // si el objeto R2 es huérfano, también el objeto. El guardrail (huérfano por sha) lo aplica el backend.
  const confirmPurgar = async () => {
    if (!purgeConfirm) return;
    setBorrando(true);
    try {
      const r = await fetch(`/api/drive/trash/purge/file/${purgeConfirm.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo eliminar");
      const d = await r.json().catch(() => ({}));
      toast.success(d.objetosR2Borrados ? "Eliminado permanentemente (objeto R2 borrado)" : "Eliminado permanentemente (objeto R2 preservado: en uso)");
    } catch (e: any) { toast.error(e.message); }
    finally { setPurgeConfirm(null); setBorrando(false); refrescar(); }
  };

  const vacio = !loading && !error && items.length === 0;
  const usuarioOptions = [
    { value: "", label: "Todos los usuarios" },
    ...usuarios.map((x) => ({ value: x.id, label: x.nombre })),
  ];

  return (
    <div className="flex flex-col p-4 sm:p-5">
      {/* Pestañas con contador (ocultas en el modal, que aporta las pestañas de nivel) */}
      {!hideTabBar && (
        <div className="flex items-center gap-2 mb-4">
          {([
            { key: "cuarentena", label: "Sin identificar", count: countCuarentena },
            { key: "conservado", label: "Conservados", count: countConservado },
          ] as { key: Tab; label: string; count: number }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => cambiarTab(t.key)}
              className={cn(
                "h-9 px-4 rounded-xl text-sm font-bold flex items-center gap-2 transition",
                tab === t.key ? "bg-brand-orange text-white shadow-sm" : "bg-white/70 text-neutral-600 hover:bg-white"
              )}
            >
              {t.label}
              <span className={cn("min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-black flex items-center justify-center",
                tab === t.key ? "bg-white/25 text-white" : "bg-neutral-100 text-neutral-500")}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterSelect value={origen} onChange={setFiltroOrigen} options={ORIGENES} title="Origen" />
        <FilterSelect value={tipo} onChange={setFiltroTipo} options={TIPOS} title="Tipo de archivo" />
        {usuarios.length > 0 && (
          <FilterSelect value={usuario} onChange={setFiltroUsuario} options={usuarioOptions}
            title={tab === "conservado" ? "Conservado por" : "Eliminado por"} />
        )}
        <DateRangePopover value={rango} onChange={setFiltroRango} presets={PAST_PRESETS}
          placeholder={tab === "conservado" ? "Fecha de conservado" : "Fecha de eliminación"} />
        {filtrosActivos && (
          <button onClick={limpiarFiltros}
            className="h-9 px-3 rounded-xl bg-white/70 hover:bg-white text-neutral-500 hover:text-brand-red text-xs font-bold flex items-center gap-1.5 transition">
            <X className="h-3.5 w-3.5" /> Limpiar filtros
          </button>
        )}
        <div className="flex-1" />
        {!loading && !error && (
          <span className="text-[12px] text-neutral-500 px-1">
            <span className="font-bold text-neutral-700">{total}</span> resultado{total === 1 ? "" : "s"}
          </span>
        )}
        <button onClick={refrescar} title="Recargar"
          className="h-9 w-9 rounded-xl bg-white/70 hover:bg-white text-neutral-600 flex items-center justify-center transition">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin text-brand-orange")} />
        </button>
      </div>

      {/* Barra de acciones masivas (sobre la página actual) */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-2xl bg-brand-orange/5 border border-brand-orange/20">
          <span className="text-sm font-black text-brand-orange px-2">
            {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
            <span className="font-medium text-brand-orange/70"> · de esta página</span>
          </span>
          <div className="flex-1" />
          <button onClick={descargarSeleccion} disabled={bulkBusy}
            className="h-9 px-3 rounded-xl bg-white/80 hover:bg-white text-neutral-700 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
            <Download className="h-4 w-4" /> Descargar{selected.size > 1 ? " (.zip)" : ""}
          </button>
          {tab === "cuarentena" ? (
            <button onClick={() => bulkMover("conservar")} disabled={bulkBusy}
              className="h-9 px-3 rounded-xl bg-brand-blue/10 hover:bg-brand-blue/15 text-brand-blue text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
              <ShieldCheck className="h-4 w-4" /> Conservar
            </button>
          ) : (
            <button onClick={() => bulkMover("devolver")} disabled={bulkBusy}
              className="h-9 px-3 rounded-xl bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-orange text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Enviar a sin identificar
            </button>
          )}
          <button onClick={() => setDeleteConfirm({ ids: [...selected], label: `${selected.size} archivo(s) seleccionado(s)` })}
            disabled={bulkBusy || items.filter((it) => selected.has(it.id) && it.origen !== "drive").length === 0}
            title="El borrado permanente solo aplica a archivos de disco (las filas del Drive se saltean; su purga es B2)"
            className="h-9 px-3 rounded-xl bg-brand-red/10 hover:bg-brand-red/15 text-brand-red text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> Borrar
          </button>
          <button onClick={() => setSelected(new Set())} title="Deseleccionar"
            className="h-9 w-9 rounded-xl bg-white/80 hover:bg-white text-neutral-500 flex items-center justify-center transition">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="glass rounded-3xl overflow-hidden">
        {error ? (
          <div className="px-6 py-16 text-center">
            <div className="h-12 w-12 rounded-2xl bg-brand-red/10 text-brand-red flex items-center justify-center mx-auto mb-4"><AlertCircle className="h-6 w-6" /></div>
            <p className="font-display font-black text-lg">No se pudo cargar</p>
            <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto break-words">{error}</p>
            <button onClick={refrescar} className="inline-flex items-center gap-1.5 mt-5 h-9 px-4 rounded-xl bg-brand-orange text-white text-sm font-bold hover:bg-brand-orange/90 transition">
              <RefreshCw className="h-4 w-4" /> Reintentar
            </button>
          </div>
        ) : vacio ? (
          <div className="px-6 py-16 text-center">
            <div className="h-12 w-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-4"><Archive className="h-6 w-6" /></div>
            <p className="font-display font-black text-lg">
              {filtrosActivos
                ? "No hay resultados con estos filtros"
                : tab === "cuarentena" ? "No hay archivos sin identificar" : "Aún no has conservado ningún archivo"}
            </p>
            <p className="text-sm text-neutral-500 mt-1">
              {filtrosActivos
                ? "Probá ampliar el rango de fechas o quitar algún filtro."
                : tab === "cuarentena"
                  ? "Cuando el recolector encuentre huérfanos, aparecerán aquí para revisarlos."
                  : "Los archivos que rescates con “Conservar” se guardarán aquí de forma indefinida."}
            </p>
            {filtrosActivos && (
              <button onClick={limpiarFiltros} className="inline-flex items-center gap-1.5 mt-5 h-9 px-4 rounded-xl bg-white/80 hover:bg-white text-neutral-600 text-sm font-bold transition">
                <X className="h-4 w-4" /> Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-ui uppercase tracking-wider text-neutral-400 border-b border-black/5">
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Seleccionar los de esta página"
                        className="h-4 w-4 accent-brand-orange rounded cursor-pointer align-middle" />
                    </th>
                    <th className="px-4 py-3 font-bold">Archivo</th>
                    <th className="px-4 py-3 font-bold">Tamaño</th>
                    <th className="px-4 py-3 font-bold">Subido</th>
                    <th className="px-4 py-3 font-bold">
                      <button onClick={toggleOrden} className="inline-flex items-center gap-1 hover:text-brand-orange transition">
                        {tab === "cuarentena" ? "Vence" : "Conservado"} {orden === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-bold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const busy = accionando.has(it.id);
                    const checked = selected.has(it.id);
                    return (
                      <tr key={it.id} className={cn("border-b border-black/5 last:border-0 transition", checked ? "bg-brand-orange/[0.04]" : "hover:bg-black/[0.02]")}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(it.id)}
                            className="h-4 w-4 accent-brand-orange rounded cursor-pointer align-middle" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {/* 🔴 LAS DOS PROCEDENCIAS, otra vez, y aqui solo una tiene miniatura:
                                · origen "drive" → hay `id`, se pide `/thumb` (~320 px);
                                · origen "disco" (`/uploads/`) → no esta en `drive_files`, no hay
                                  endpoint de miniatura, y se pide su URL — que baja el archivo
                                  entero. Se hace igualmente: quitarle la vista previa a esa rama
                                  para ahorrar bytes seria arreglar el peso a costa de una
                                  funcionalidad. Montar un `/thumb` para `/uploads` es otra entrega
                                  (no hay `sha256` con el que componer la clave de cache).
                                Las dos pasan por el mismo componente, asi que las dos heredan la
                                carga perezosa y la caida al icono. */}
                            <div className="relative h-10 w-10 rounded-lg overflow-hidden bg-neutral-100 shrink-0">
                              <MiniaturaArchivo
                                file={{ id: it.origen === "drive" ? it.id : undefined, nombre: it.filename, mime: it.mime }}
                                urlDirecta={it.origen === "drive" ? undefined : previewUrl(it)}
                                fallback={
                                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 dark:bg-white/5">
                                    <KindIcon mime={it.mime} filename={it.filename} />
                                  </div>
                                }
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold truncate max-w-[280px]" title={it.filename}>{it.filename}</div>
                              <div className="text-[11px] text-neutral-400 truncate max-w-[280px]">{it.mime || "tipo desconocido"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtSize(it.tamano_bytes)}</td>
                        <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtFecha(it.subido_en)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {tab === "cuarentena" ? (
                            (() => {
                              const d = it.dias_restantes;
                              const cls = d == null ? "text-neutral-500" : d <= 7 ? "text-brand-red" : d <= 14 ? "text-amber-600" : "text-neutral-500";
                              const txt = d == null ? "—" : d <= 0 ? "se borra hoy" : `se borra en ${d} día${d === 1 ? "" : "s"}`;
                              return <span className={cn("text-sm font-bold", cls)}>{txt}</span>;
                            })()
                          ) : (
                            <span className="text-sm text-neutral-500">conservado el {fmtFecha(it.conservado_en)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => ver(it)} disabled={!previewUrl(it)} title="Ver"
                              className="h-8 w-8 rounded-lg bg-white/70 hover:bg-white text-neutral-500 hover:text-brand-orange flex items-center justify-center transition disabled:opacity-40">
                              <Eye className="h-4 w-4" />
                            </button>
                            <a href={downloadUrl(it) || undefined} download={it.filename} title="Descargar"
                              className={cn("h-8 w-8 rounded-lg bg-white/70 hover:bg-white text-neutral-500 hover:text-brand-orange flex items-center justify-center transition", !downloadUrl(it) && "pointer-events-none opacity-40")}>
                              <Download className="h-4 w-4" />
                            </a>
                            {tab === "cuarentena" && (
                              <button onClick={() => conservar(it)} disabled={busy} title="Conservar"
                                className="h-8 px-2.5 rounded-lg bg-brand-blue/10 hover:bg-brand-blue/15 text-brand-blue text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
                                <ShieldCheck className="h-4 w-4" /> Conservar
                              </button>
                            )}
                            {it.origen === "drive" ? (
                              <button onClick={() => restaurar(it)} disabled={busy} title="Restaurar al Drive"
                                className="h-8 px-2.5 rounded-lg bg-brand-green/10 hover:bg-brand-green/15 text-brand-green text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
                                <RotateCcw className="h-4 w-4" /> Restaurar
                              </button>
                            ) : tab === "conservado" ? (
                              <button onClick={() => devolver(it)} disabled={busy} title="Enviar a sin identificar"
                                className="h-8 px-2.5 rounded-lg bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-orange text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
                                <RotateCcw className="h-4 w-4" /> A sin identificar
                              </button>
                            ) : null}
                            {it.origen === "drive" ? (
                              <button onClick={() => setPurgeConfirm({ id: it.id, filename: it.filename })} disabled={busy}
                                title="Eliminar permanentemente (borra la fila y el objeto R2 si es huérfano)"
                                className="h-8 px-2.5 rounded-lg bg-brand-red/10 hover:bg-brand-red/15 text-brand-red text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
                                <Trash2 className="h-4 w-4" /> {tab === "conservado" ? "Borrar def." : "Borrar"}
                              </button>
                            ) : (
                              <button onClick={() => setDeleteConfirm({ ids: [it.id], label: it.filename })} title={tab === "conservado" ? "Borrar definitivamente" : "Borrar"}
                                className="h-8 px-2.5 rounded-lg bg-brand-red/10 hover:bg-brand-red/15 text-brand-red text-xs font-bold flex items-center gap-1.5 transition">
                                <Trash2 className="h-4 w-4" /> {tab === "conservado" ? "Borrar def." : "Borrar"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} disabled={loading} />
          </>
        )}
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          danger
          title={deleteConfirm.ids.length > 1 ? "Borrar varios archivos" : (tab === "conservado" ? "Borrar definitivamente" : "Borrar archivo")}
          confirmLabel={deleteConfirm.ids.length > 1 ? `Borrar ${deleteConfirm.ids.length}` : (tab === "conservado" ? "Borrar definitivamente" : "Borrar")}
          busy={borrando}
          requireText={deleteConfirm.ids.length >= 2 ? "ELIMINAR" : undefined}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={confirmBorrar}
          message={
            <>
              Vas a borrar <strong>{deleteConfirm.label}</strong> del disco. Esta acción es
              <strong> irreversible</strong> y {deleteConfirm.ids.length > 1 ? "los archivos no se podrán recuperar." : "el archivo no se podrá recuperar."}
              {deleteConfirm.ids.some((id) => items.find((it) => it.id === id)?.origen === "drive") && (
                <> <br /><span className="text-neutral-500">Los archivos del <strong>Drive</strong> en la selección no se borran (su eliminación permanente llega en la Fase B2).</span></>
              )}
            </>
          }
        />
      )}

      {purgeConfirm && (
        <ConfirmDialog
          danger
          title="Eliminar permanentemente"
          confirmLabel="Eliminar permanentemente"
          busy={borrando}
          requireText="ELIMINAR"
          onCancel={() => setPurgeConfirm(null)}
          onConfirm={confirmPurgar}
          message={
            <>
              Vas a eliminar <strong>{purgeConfirm.filename}</strong> del Drive de forma <strong>permanente</strong> e
              <strong> irreversible</strong>. Se borra la fila; el objeto en R2 se borra <strong>solo si ninguna otra
              copia lo referencia</strong> (si está en uso, se preserva).
            </>
          }
        />
      )}

      {/* El visor, en esta misma pantalla. `origenDelVisor` decide si lleva `id` (Drive) o solo
          `url` (/uploads), que es la diferencia entre tener vista previa de Word o no. */}
      {verItem && (() => {
        const o = origenDelVisor(verItem);
        return o ? <FilePreviewModal file={o} onClose={() => setVerItem(null)} /> : null;
      })()}
    </div>
  );
}
