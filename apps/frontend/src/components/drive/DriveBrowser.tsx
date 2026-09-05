"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Folder, FolderOpen, File, FileText, FileImage, FileVideo, FileAudio, FileArchive,
  FileCode, FileSpreadsheet, Upload, FolderPlus, Search, Download, MoreHorizontal,
  Trash2, Edit, X, Loader2, ChevronLeft, ChevronRight, HardDrive, Building2, UserCircle, Briefcase,
  Clock, AlertCircle, CheckCircle2, Plus, Sparkles, ArrowUpRight, Command,
  LayoutGrid, List, Eye, Share2, Users2, TrendingUp, FolderKanban,
  ArrowUp, ArrowDown, ArrowLeft, RotateCcw, Star, Home
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { esNavegable, etiquetaDeCarpeta, ordenarSecciones, recortarMigas, type NodoDeArbol } from "@/lib/drive-arbol";
import { construirRecorrido } from "@/lib/drive-recorrido";
import { CompartirModal } from "./CompartirModal";
import { MarcaCompartido } from "./MarcaCompartido";
import { mensajeDeError } from "@/lib/drive-mensajes";
import {
  accionesDeArchivo, accionesDeCarpeta, clasesDelContenedorDeMenu,
  type AccionDrive, type ClaveAccion,
} from "@/lib/drive-acciones";
import { CompartidosConmigo } from "./CompartidosConmigo";
import { DestacadosPanel, RecientesPanel } from "./PanelesDestacadosRecientes";
import { fileVisual } from "./file-visual";
import { MiniaturaArchivo } from "./MiniaturaArchivo";
import { clasificarParaVisor, esOfimatica, filasDeCsv, necesitaTexto, type OrigenArchivo } from "@/lib/visor-archivo";
import { useCurrentUser } from "@/lib/auth-user";
import { Pagination } from "@/components/ui/Pagination";
import { DateRangePopover, PAST_PRESETS, type DateRange } from "@/components/ui/DateRangePopover";
import { SinIdentificarPanel } from "@/components/drive/SinIdentificarPanel";

/* ======================================================================== */
/* Types                                                                    */
/* ======================================================================== */
export interface DriveFolder {
  id: string;
  nombre: string;
  parent_id: string | null;
  // `virtual_contactos` NO es un tipo de la base: es el agrupador que fabrica el backend para el
  // super_admin (`drive-routes.ts` → `filaNodoContactos`). Entra en la unión porque llega por el
  // mismo canal que los demás, y dejarlo fuera obligaría a un cast en cada sitio que lo mira.
  tipo: "root" | "company" | "users_root" | "user" | "opportunities_root" | "opportunity" | "custom" | "contact" | "virtual_contactos";
  owner_user_id: string | null;
  oportunidad_id: string | null;
  has_children?: boolean; // árbol lazy: viene de /api/drive/tree/children|path (sobre hijos VISIBLES)
}

// Árbol lazy: nivel cargado on-demand (hijos de un parentId).
interface TreeEntry { children: DriveFolder[]; total: number; hasMore: boolean; page: number; loading: boolean }

export interface DriveFile {
  id: string;
  folder_id: string;
  nombre: string;
  mime: string | null;
  size_bytes: number | string | null;
  uploaded_by: string;
  uploader_nombre?: string | null;
  uploader_foto?: string | null;
  created_at: string;
  updated_at: string;
}

type Scope = "global" | "user" | "oportunidad";
type ViewMode = "list" | "grid";

const FILES_PAGE_SIZE = 50;    // archivos por página en el listado de una carpeta (Entrega 2)
const CHILDREN_PAGE_SIZE = 50; // subcarpetas por página en el detalle (Entrega 3A)
const TREE_PAGE_SIZE = 100;    // hijos por "página" en el árbol lateral lazy (Entrega 3B), con "cargar más"

type TrashLevel = "papelera" | "cuarentena" | "conservado";

interface Props {
  rootScope?: Scope;
  oportunidadId?: string;
  userId?: string;
  className?: string;
  openTrash?: boolean;        // abrir el modal de papelera al montar (deep-link ?papelera=)
  trashTab?: TrashLevel;      // pestaña de nivel inicial del modal de papelera
  /**
   * T3 · un escalón de vuelta a la pantalla de la que se viene, a la izquierda de las migas.
   *
   * Lo usa la pestaña Documentos de una negociación para volver a los documentos del contacto.
   * NO es un ancestro de la carpeta —en 6.935 de los casos la carpeta de la negociación cuelga de
   * `Trámites`, no del contacto—, así que no puede ser una miga: es un salto a otra pantalla, y
   * se pinta distinto para que se lea como lo que es.
   */
  volverA?: { href: string; etiqueta: string };
}

interface UploadJob {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

/* ======================================================================== */
/* Visual helpers                                                           */
/* ======================================================================== */

export function formatBytes(b: number | string | null | undefined): string {
  const n = typeof b === "string" ? parseInt(b, 10) : b;
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface FolderVisual {
  Icon: any;
  gradient: string;
  light: string; // lighter gradient bg
  textHint: string;
}

function folderVisual(tipo: DriveFolder["tipo"]): FolderVisual {
  switch (tipo) {
    case "root": return { Icon: HardDrive, gradient: "from-brand-orange to-neon-magenta", light: "from-orange-100 to-pink-100 dark:from-orange-900/30 dark:to-pink-900/30", textHint: "Raíz" };
    case "company": return { Icon: Building2, gradient: "from-indigo-500 to-blue-600", light: "from-indigo-100 to-blue-100 dark:from-indigo-900/30 dark:to-blue-900/30", textHint: "Compañía" };
    case "users_root": return { Icon: UserCircle, gradient: "from-emerald-500 to-teal-600", light: "from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30", textHint: "Mi Drive" };
    case "user": return { Icon: UserCircle, gradient: "from-emerald-500 to-teal-600", light: "from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30", textHint: "Usuario" };
    case "opportunities_root": return { Icon: FolderKanban, gradient: "from-amber-500 to-orange-600", light: "from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30", textHint: "Trámites" };
    case "opportunity": return { Icon: Briefcase, gradient: "from-amber-500 to-orange-600", light: "from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30", textHint: "Trámite" };
    // El agrupador de las ramas de clientes. Solo lo ve el super_admin y no existe en la base.
    case "virtual_contactos": return { Icon: Users2, gradient: "from-slate-500 to-slate-700", light: "from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700", textHint: "Clientes" };
    default: return { Icon: Folder, gradient: "from-neutral-500 to-neutral-700", light: "from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-700", textHint: "Carpeta" };
  }
}

// 🔴 Las dos etiquetas salen de `lib/drive-arbol`. Antes esta funcion y `crumbLabel` traducian
// `users_root` cada una por su cuenta: dos opiniones sobre el mismo dato divergen sin que nada
// falle, y la pantalla acaba llamando a la misma carpeta de dos maneras.
function displayName(f: DriveFolder): string {
  return etiquetaDeCarpeta(f as NodoDeArbol);
}

// La tabla de iconos vive en `file-visual.ts` (ver el porque alli). Se re-exporta para que
// todo lo que ya la importaba de este fichero siga funcionando sin tocarse.
export { fileVisual, isImage, type FileVisual } from "./file-visual";

function relDate(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.floor((now - t) / 1000);
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`;
  return new Date(iso).toLocaleDateString();
}

/* ======================================================================== */
/* Main                                                                     */
/* ======================================================================== */

export function DriveBrowser({ rootScope = "global", oportunidadId, userId, className, openTrash, trashTab, volverA }: Props) {
  const { user } = useCurrentUser();
  const isAdmin = user?.nivel === "super_admin" || user?.nivel === "admin";

  // canEditCurrent: true si admin o si la carpeta actual cae bajo el user folder propio.
  const canEditCurrent = (breadcrumbs?: any[]): boolean => {
    if (isAdmin) return true;
    if (!user?.id || !breadcrumbs) return false;
    const userFolder = breadcrumbs.find((f) => f.tipo === "user");
    return !!(userFolder && userFolder.owner_user_id === user.id);
  };
  // canWriteCurrent: true donde el usuario puede SUBIR (= y por tanto eliminar archivos):
  // su propio Drive, o cualquier carpeta de oportunidad (acceso abierto al equipo).
  const canWriteCurrent = (breadcrumbs?: any[]): boolean => {
    if (isAdmin) return true;
    if (!user?.id || !breadcrumbs) return false;
    const userFolder = breadcrumbs.find((f) => f.tipo === "user");
    if (userFolder) return userFolder.owner_user_id === user.id;
    return breadcrumbs.some((f) => f.tipo === "opportunity");
  };
  // Árbol lateral LAZY (Entrega 3B): store on-demand por parentId + nodo raíz. Ya no se trae la lista plana completa.
  const [treeStore, setTreeStore] = useState<Map<string | null, TreeEntry>>(new Map());
  const [root, setRoot] = useState<DriveFolder | null>(null);
  const loadedParents = useRef<Set<string | null>>(new Set()); // parents cuyos hijos ya se pidieron/precargaron
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ folder: DriveFolder; breadcrumbs: DriveFolder[]; children: DriveFolder[]; files: DriveFile[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [storageReady, setStorageReady] = useState(true);
  const [storageProvider, setStorageProvider] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  /**
   * 🔴 El visor guarda el INDICE dentro de `pageFiles`, no el archivo.
   *
   * Guardar el archivo obligaria a buscarlo en la lista cada vez que se pulsa una flecha, y ese
   * "buscar" es justo donde el orden puede discrepar. Con el indice, avanzar es sumar uno — y el
   * orden es, por construccion, el mismo que se esta viendo: las dos vistas (lista y galeria)
   * recorren ESTE MISMO array.
   */
  const [previewIndice, setPreviewIndice] = useState<number | null>(null);

  // --- T2: subcarpetas desplegadas en la vista de lista, y su contenido ---
  // Al plegar NO se tira lo traído: si alguien vuelve a abrirla, ya está. Lo que no se ve
  // simplemente no entra en el recorrido (`lib/drive-recorrido.ts`).
  const [desplegadas, setDesplegadas] = useState<Set<string>>(new Set());
  const [archivosDeSub, setArchivosDeSub] = useState<Record<string, DriveFile[]>>({});
  const [cargandoSub, setCargandoSub] = useState<Set<string>>(new Set());

  // --- T2: selección de archivos para moverlos ---
  // 🔴 Solo sobre los archivos de la carpeta ABIERTA. Los que asoman de una subcarpeta
  // desplegada se ven pero no se marcan: su origen es otra carpeta, con otros permisos, y
  // mezclarlos convertiría un movimiento en una operación cuyo alcance nadie ve entero.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [mostrarMover, setMostrarMover] = useState(false);
  /** Un archivo abierto desde «Compartidos conmigo»: no pertenece a la carpeta que se esté viendo. */
  const [archivoSuelto, setArchivoSuelto] = useState<DriveFile | null>(null);

  /**
   * T3 · la carpeta donde EMPIEZA este Drive cuando está acotado (la de la negociación).
   *
   * «Se acota siempre en el apartado de documento a exclusivamente esa oportunidad, de manera que
   * la persona no salga, no navegue al resto; porque si quiere navegar, para eso está el
   * apartado de Drive.» (2026-08-24)
   *
   * 🔴 Hasta hoy las migas de pan traían la cadena ENTERA —`Drive del CRM › Trámites › <caso>`—
   * también aquí dentro. Pulsar «Trámites» desde la pestaña de una negociación soltaba al usuario
   * en el árbol de todos los clientes, que es exactamente lo que se pidió evitar.
   */
  const [scopeRootId, setScopeRootId] = useState<string | null>(null);

  // --- T5: compartir ---
  // `compartiendo` es lo que tiene abierta la modal; `verCompartidos` cambia el panel de contenido
  // por «Compartidos conmigo»; `misCompartidas` es lo que YO he compartido, y es lo que decide
  // qué archivos y carpetas llevan la marca de compartido en la esquina (`MarcaCompartido`).
  const [compartiendo, setCompartiendo] = useState<{ objetivo: any; nombre: string } | null>(null);
  /**
   * Qué se está viendo en el panel de contenido.
   *
   * 🔴 UNA SOLA VARIABLE y no tres booleanos. Con `verCompartidos`, `verDestacados` y
   * `verRecientes` por separado, nada impide que dos estén en `true` a la vez: la pantalla
   * pintaría dos paneles o ninguno según el orden de los `if`, y el fallo aparecería solo al
   * pulsar en cierto orden. Un valor que solo puede ser una cosa no tiene ese problema.
   */
  const [panel, setPanel] = useState<"carpeta" | "compartidos" | "destacados" | "recientes">("carpeta");
  const verCompartidos = panel === "compartidos";
  const [misCompartidas, setMisCompartidas] = useState<{ carpetas: Set<string>; archivos: Set<string> }>(
    { carpetas: new Set(), archivos: new Set() }
  );
  const [tokenCompartidos, setTokenCompartidos] = useState(0);

  const recargarMisCompartidas = useCallback(async () => {
    try {
      const r = await fetch("/api/drive/comparticiones/mias");
      if (!r.ok) return;
      const d = await r.json();
      setMisCompartidas({ carpetas: new Set(d.carpetas ?? []), archivos: new Set(d.archivos ?? []) });
    } catch { /* la marca es un adorno: si falla, no se pinta y ya */ }
  }, []);
  useEffect(() => { recargarMisCompartidas(); }, [recargarMisCompartidas]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- Paginación + filtros server-side de archivos de la carpeta abierta (Entrega 2) ---
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesPage, setFilesPage] = useState(1);
  const [uploaders, setUploaders] = useState<{ id: string; nombre: string }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileTipo, setFileTipo] = useState("");
  const [fileUploader, setFileUploader] = useState("");
  const [fileRango, setFileRango] = useState<DateRange>({ from: null, to: null });
  const [fileOrden, setFileOrden] = useState<"desc" | "asc">("desc"); // sobre created_at
  const [debouncedQ, setDebouncedQ] = useState("");   // searchQ con debounce → búsqueda server-side (archivos + subcarpetas)
  const [filesNonce, setFilesNonce] = useState(0);    // fuerza recarga completa (tras subir/borrar/renombrar)
  const lastFetchedFolder = useRef<string | null>(null);

  // --- Paginación + búsqueda server-side de SUBCARPETAS del detalle (Entrega 3A) ---
  const [childrenTotal, setChildrenTotal] = useState(0);
  const [childrenPage, setChildrenPage] = useState(1);
  const [loadingChildren, setLoadingChildren] = useState(false);

  // --- Búsqueda SCOPEADA al subárbol (Entrega 3C). Toggle opt-in; default = "en esta carpeta" (3A). ---
  const [searchScope, setSearchScope] = useState(false);
  const [searchRes, setSearchRes] = useState<{ folders: { items: any[]; total: number }; files: { items: any[]; total: number } }>({ folders: { items: [], total: 0 }, files: { items: [], total: 0 } });
  const [folderPage, setFolderPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);

  // Navegar a una carpeta: resetea las páginas (archivos + subcarpetas) junto con el cambio de carpeta.
  const openFolder = useCallback((id: string) => { setPanel("carpeta"); setFilesPage(1); setChildrenPage(1); setCurrentId(id); }, []);

  // Filtros de archivos → vuelven a la página 1 (se batchean con el cambio de filtro).
  const setFiltroTipo = (v: string) => { setFileTipo(v); setFilesPage(1); };
  const setFiltroUploader = (v: string) => { setFileUploader(v); setFilesPage(1); };
  const setFiltroRango = (r: DateRange) => { setFileRango(r); setFilesPage(1); };
  const toggleFileOrden = () => { setFileOrden((v) => (v === "desc" ? "asc" : "desc")); setFilesPage(1); };
  const fileFiltrosActivos = !!(fileTipo || fileUploader || fileRango.from || fileRango.to || debouncedQ);
  const limpiarFileFiltros = () => {
    setFileTipo(""); setFileUploader(""); setFileRango({ from: null, to: null }); setFileOrden("desc");
    setSearchQ(""); setDebouncedQ(""); setFilesPage(1); setChildrenPage(1);
  };
  const [userFolderId, setUserFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showTrash, setShowTrash] = useState(false);
  // Deep-link (?papelera=): abrir el modal de papelera al montar en la pestaña indicada.
  useEffect(() => { if (openTrash) setShowTrash(true); }, [openTrash]);

  // Semilla del árbol desde /api/drive/tree/path: storage + raíz + cadena de ancestros + primera página de hijos
  // visibles de cada nodo del camino. Deja el árbol expandido hasta la carpeta abierta sin fetches extra.
  const seedFromPath = useCallback((d: any) => {
    // El nodo raíz viene sin has_children (no es hijo de nadie): se lo derivamos de su preload para que muestre chevron.
    const pr = d.root ? d.preload?.[d.root.id] : null;
    const rootNode: DriveFolder | null = d.root
      ? { ...d.root, has_children: !!(pr && ((pr.children || []).length > 0 || pr.hasMore)) }
      : null;
    if (rootNode) setRoot(rootNode);
    if (d.storage) { setStorageReady(d.storage.ready !== false); setStorageProvider(d.storage.provider || ""); }
    setTreeStore((prev) => {
      const n = new Map(prev);
      if (rootNode) n.set(null, { children: [rootNode], total: 1, hasMore: false, page: 1, loading: false }); // nivel tope = la raíz
      for (const [pid, entry] of Object.entries<any>(d.preload || {})) {
        n.set(pid, { children: entry.children || [], total: entry.total || 0, hasMore: !!entry.hasMore, page: 1, loading: false });
        loadedParents.current.add(pid);
      }
      return n;
    });
    // Expandir toda la cadena (incluida la carpeta abierta) para que se vea el camino y sus hijos.
    const anc: string[] = d.ancestors || [];
    if (anc.length) setExpandedFolders((prev) => { const s = new Set(prev); anc.forEach((a) => s.add(a)); return s; });
  }, []);

  const loadPath = useCallback(async (folderId: string | null) => {
    const url = folderId ? `/api/drive/tree/path?folder_id=${folderId}` : "/api/drive/tree/path";
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    seedFromPath(await r.json());
  }, [seedFromPath]);

  // Carga (o "cargar más") de los hijos visibles de un nodo. append=false reemplaza el nivel; true lo appendea.
  const loadChildren = useCallback(async (parentId: string, page = 1, append = false) => {
    setTreeStore((prev) => {
      const n = new Map(prev);
      const cur = n.get(parentId);
      n.set(parentId, { children: cur?.children || [], total: cur?.total || 0, hasMore: cur?.hasMore || false, page: cur?.page || 0, loading: true });
      return n;
    });
    try {
      const r = await fetch(`/api/drive/tree/children?parent_id=${parentId}&page=${page}&pageSize=${TREE_PAGE_SIZE}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      setTreeStore((prev) => {
        const n = new Map(prev);
        const cur = n.get(parentId);
        const base = append && cur ? cur.children : [];
        n.set(parentId, { children: [...base, ...(d.children || [])], total: d.total || 0, hasMore: !!d.hasMore, page: d.page || page, loading: false });
        return n;
      });
    } catch {
      setTreeStore((prev) => { const n = new Map(prev); const cur = n.get(parentId); if (cur) n.set(parentId, { ...cur, loading: false }); return n; });
      toast.error("No se pudieron cargar las subcarpetas");
    }
  }, []);

  // Expandir/colapsar un nodo; al expandir por primera vez, trae sus hijos (lazy).
  const handleToggle = useCallback((node: DriveFolder) => {
    const willExpand = !expandedFolders.has(node.id);
    setExpandedFolders((prev) => { const n = new Set(prev); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; });
    if (willExpand && node.has_children && !loadedParents.current.has(node.id)) {
      loadedParents.current.add(node.id);
      loadChildren(node.id, 1, false);
    }
  }, [expandedFolders, loadChildren]);

  const loadMore = useCallback((parentId: string) => {
    const cur = treeStore.get(parentId);
    loadChildren(parentId, (cur?.page || 1) + 1, true);
  }, [treeStore, loadChildren]);

  /**
   * T2 · desplegar una subcarpeta EN LA LISTA para ver sus archivos sin entrar en ella.
   *
   * «Que la carpeta tenga como la flechita al lado, que si tú la abres se abre lo que tiene
   * adentro o la cierras… y puedes ver ambas a la vez.» (2026-08-24)
   *
   * Reutiliza `?filesOnly=1` del endpoint de carpeta, que ya existía para paginar archivos sin
   * volver a traer estructura. No hace falta endpoint nuevo.
   *
   * ⚠️ Se pide UNA vez por subcarpeta y se guarda. Plegar no lo tira: volver a abrirla es
   * instantáneo, y lo plegado no entra en el recorrido de todos modos.
   */
  const alternarSubcarpeta = useCallback(async (sub: DriveFolder) => {
    const estaba = desplegadas.has(sub.id);
    setDesplegadas((prev) => { const n = new Set(prev); estaba ? n.delete(sub.id) : n.add(sub.id); return n; });
    if (estaba || archivosDeSub[sub.id]) return;              // se plegó, o ya estaba traído

    setCargandoSub((prev) => new Set(prev).add(sub.id));
    try {
      const r = await fetch(`/api/drive/folders/${sub.id}?filesOnly=1&filesPageSize=${FILES_PAGE_SIZE}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      setArchivosDeSub((prev) => ({ ...prev, [sub.id]: Array.isArray(d.files) ? d.files : [] }));
    } catch {
      // Se vuelve a plegar: una carpeta abierta y vacía por un fallo de red se lee como "no tiene
      // nada", que es una mentira. Mejor que se quede cerrada y se pueda reintentar.
      setDesplegadas((prev) => { const n = new Set(prev); n.delete(sub.id); return n; });
      toast.error("No se pudieron cargar los archivos de la carpeta");
    } finally {
      setCargandoSub((prev) => { const n = new Set(prev); n.delete(sub.id); return n; });
    }
  }, [desplegadas, archivosDeSub]);

  /** Al cambiar de carpeta se olvida todo lo desplegado y lo seleccionado: son de la anterior. */
  useEffect(() => {
    setDesplegadas(new Set());
    setArchivosDeSub({});
    setSeleccion(new Set());
  }, [currentId]);

  const alternarSeleccion = useCallback((id: string) => {
    setSeleccion((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  /**
   * Mover lo marcado. El servidor decide: comprueba escritura en el origen y en el destino, y si
   * algo no cuadra no mueve NADA (lo de todo-o-nada está en `drive-routes.ts`).
   *
   * 🔴 Los mensajes dicen qué pasó, no cómo se llama por dentro (§4.7). Viven en
   * `lib/drive-mensajes`, compartidos con el envío a la papelera y con pruebas propias.
   */
  const moverSeleccion = useCallback(async (destino: DriveFolder) => {
    const ids = [...seleccion];
    if (ids.length === 0) return;
    try {
      const r = await fetch("/api/drive/files/mover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, destino_folder_id: destino.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(mensajeDeError("mover", d?.error));
        return;
      }
      const partes = [`${d.movidos} archivo${d.movidos === 1 ? "" : "s"} movido${d.movidos === 1 ? "" : "s"}`];
      // Se dicen los renombrados: un archivo que cambia de nombre sin avisar es un archivo que
      // alguien va a buscar por el nombre viejo.
      if (d.renombrados > 0) partes.push(`${d.renombrados} se renombró por coincidir con otro`);
      if (d.ya_estaban > 0) partes.push(`${d.ya_estaban} ya estaba${d.ya_estaban === 1 ? "" : "n"} ahí`);
      toast.success(partes.join(" · "));

      setSeleccion(new Set());
      setMostrarMover(false);
      // Si el destino era una subcarpeta desplegada, lo que tenía traído ya no vale.
      setArchivosDeSub((prev) => { const n = { ...prev }; delete n[destino.id]; return n; });
      setFilesNonce((n) => n + 1);
    } catch {
      toast.error("No se pudieron mover los archivos.");
    }
  }, [seleccion]);

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // ENVIAR LA SELECCIÓN A LA PAPELERA — pedido el 2026-08-25
  // «A la hora de seleccionar no me aparece por ningún lado la opción de eliminar o mover a la
  // papelera.» La selección múltiple llegó sabiendo mover y no archivar.
  //
  // 🔴 NO BORRA (§0): es archivado lógico y reversible, y la papelera tiene su restauración. Por
  // eso el diálogo enseña CUÁNTOS van y no pide teclear una palabra — la palabra es para lo
  // inmediato E IRREVERSIBLE (§10.7), y pedirla aquí enseñaría a teclearla sin leer.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  const [confirmarPapelera, setConfirmarPapelera] = useState(false);
  const [enviandoPapelera, setEnviandoPapelera] = useState(false);
  const enviarAPapelera = useCallback(async () => {
    const ids = [...seleccion];
    if (ids.length === 0) return;
    setEnviandoPapelera(true);
    try {
      const r = await fetch("/api/drive/files/papelera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // El motivo en el idioma de quien lee, sin identificadores internos (§4.7).
        toast.error(mensajeDeError("papelera", d?.error));
        return;
      }
      toast.success(`${d.enviados} archivo${d.enviados === 1 ? "" : "s"} en la papelera. Se puede restaurar.`);
      setSeleccion(new Set());
      setConfirmarPapelera(false);
      setFilesNonce((n) => n + 1);
    } catch {
      toast.error("No se pudieron enviar a la papelera.");
    } finally {
      setEnviandoPapelera(false);
    }
  }, [seleccion]);

  /* Boot: resuelve la carpeta inicial según scope y siembra el árbol lazy desde /tree/path */
  useEffect(() => {
    let cancelled = false;
    const boot = async (retry = 0) => {
      if (retry === 0) setLoading(true);
      try {
        let startId: string | null = null;
        if (rootScope === "oportunidad" && oportunidadId) {
          const rr = await fetch(`/api/drive/resolve/oportunidad/${oportunidadId}`);
          if (rr.ok) startId = (await rr.json()).folder?.id;
        } else if (rootScope === "user") {
          const rr = await fetch(`/api/drive/resolve/user/${userId || "me"}`);
          if (rr.ok) startId = (await rr.json()).folder?.id;
        }
        // global: sin startId → /tree/path devuelve la raíz; abrimos en la raíz.
        const r = await fetch(startId ? `/api/drive/tree/path?folder_id=${startId}` : "/api/drive/tree/path");
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        seedFromPath(d);
        const openId = startId || d.root?.id || null;
        // T3 · la raíz del ALCANCE, para recortar las migas de pan. En `global` no hay recorte.
        setScopeRootId(rootScope === "global" ? null : startId);
        if (openId) { setLoadingDetail(true); setCurrentId(openId); }
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        // Bajón momentáneo del servidor (responde HTML/error): reintentar en silencio.
        if (retry < 3) { setTimeout(() => boot(retry + 1), 1500 * (retry + 1)); return; }
        toast.error("No se pudo cargar el Drive. Reintentá en unos segundos.");
        setLoading(false);
      }
    };
    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootScope, oportunidadId, userId]);

  /* Precarga ID de "Mi Drive" para el botón quick-access */
  useEffect(() => {
    fetch("/api/drive/resolve/user/me")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.folder?.id) setUserFolderId(d.folder.id); })
      .catch(() => {});
  }, []);

  // Debounce de la búsqueda → busca en el servidor archivos (q) Y subcarpetas (qFolder) de la carpeta; vuelve a pág. 1.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(searchQ.trim()); setFilesPage(1); setChildrenPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  // Carga de la carpeta: completa al cambiar de carpeta (folder+breadcrumbs+children+uploaders+página 1),
  // o SOLO archivos (filesOnly) al cambiar filtro/página/búsqueda — sin re-traer la estructura. Guard anti-carreras.
  useEffect(() => {
    if (!currentId) { setDetail(null); lastFetchedFolder.current = null; return; }
    const full = lastFetchedFolder.current !== currentId;
    let cancelled = false;
    (async () => {
      if (full) setLoadingDetail(true); else setLoadingFiles(true);
      try {
        const p = new URLSearchParams();
        p.set("filesPage", String(filesPage));
        p.set("filesPageSize", String(FILES_PAGE_SIZE));
        p.set("orden", fileOrden);
        if (fileTipo) p.set("tipo", fileTipo);
        if (fileUploader) p.set("uploader", fileUploader);
        if (fileRango.from) p.set("desde", fileRango.from.toISOString());
        if (fileRango.to) p.set("hasta", fileRango.to.toISOString());
        if (debouncedQ) p.set("q", debouncedQ);
        if (full) {
          // el full trae también la página 1 de subcarpetas (con búsqueda si está activa)
          p.set("childrenPage", String(childrenPage));
          p.set("childrenPageSize", String(CHILDREN_PAGE_SIZE));
          if (debouncedQ) p.set("qFolder", debouncedQ);
        } else {
          p.set("filesOnly", "1");
        }
        const r = await fetch(`/api/drive/folders/${currentId}?${p.toString()}`);
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
        const d = await r.json();
        if (cancelled) return;
        // Página fuera de rango tras filtrar (total menor) → volver a la 1.
        if ((d.files?.length ?? 0) === 0 && filesPage > 1 && (d.filesTotal ?? 0) > 0) { setFilesPage(1); return; }
        if (full) {
          setDetail({ folder: d.folder, breadcrumbs: d.breadcrumbs, children: d.children, files: d.files });
          setUploaders(d.uploaders || []);
          setChildrenTotal(d.childrenTotal || 0);
          lastFetchedFolder.current = currentId;
        } else {
          setDetail((prev) => (prev ? { ...prev, files: d.files } : prev));
        }
        setFilesTotal(d.filesTotal || 0);
      } catch (e: any) {
        if (cancelled) return;
        if (full) { toast.error(e?.message || "No se pudo cargar la carpeta"); setDetail(null); }
        else toast.error("No se pudieron cargar los archivos");
      } finally {
        if (!cancelled) { if (full) setLoadingDetail(false); else setLoadingFiles(false); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, filesPage, fileTipo, fileUploader, fileRango.from, fileRango.to, fileOrden, debouncedQ, filesNonce]);

  // Cambio de página / búsqueda de SUBCARPETAS → recarga SOLO children (childrenOnly). El cambio de carpeta lo
  // maneja el efecto de arriba (rama full trae children pág. 1); acá se saltea hasta que ese full terminó.
  useEffect(() => {
    if (!currentId || lastFetchedFolder.current !== currentId) return;
    let cancelled = false;
    (async () => {
      setLoadingChildren(true);
      try {
        const p = new URLSearchParams();
        p.set("childrenOnly", "1");
        p.set("childrenPage", String(childrenPage));
        p.set("childrenPageSize", String(CHILDREN_PAGE_SIZE));
        if (debouncedQ) p.set("qFolder", debouncedQ);
        const r = await fetch(`/api/drive/folders/${currentId}?${p.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (cancelled) return;
        if ((d.children?.length ?? 0) === 0 && childrenPage > 1 && (d.childrenTotal ?? 0) > 0) { setChildrenPage(1); return; }
        setDetail((prev) => (prev ? { ...prev, children: d.children } : prev));
        setChildrenTotal(d.childrenTotal || 0);
      } catch { if (!cancelled) toast.error("No se pudieron cargar las subcarpetas"); }
      finally { if (!cancelled) setLoadingChildren(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, childrenPage, debouncedQ]);

  // --- Búsqueda scopeada (3C): activa solo con el toggle + query ≥ 2. ---
  const searchActive = searchScope && debouncedQ.length >= 2 && !!currentId;
  // Cambio de carpeta / query / toggle → volver a la página 1 de ambos grupos.
  useEffect(() => { setFolderPage(1); setFilePage(1); }, [currentId, debouncedQ, searchScope]);
  // Fetch de resultados (carpetas + archivos en paralelo, cada uno con su página). Guard anti-carreras.
  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    (async () => {
      setSearchLoading(true);
      try {
        const base = `/api/drive/search?scope=${currentId}&q=${encodeURIComponent(debouncedQ)}&pageSize=25`;
        const [rf, rff] = await Promise.all([
          fetch(`${base}&kind=folder&page=${folderPage}`),
          fetch(`${base}&kind=file&page=${filePage}`),
        ]);
        const df = rf.ok ? await rf.json() : null;
        const dff = rff.ok ? await rff.json() : null;
        if (cancelled) return;
        setSearchRes({
          folders: df?.folders || { items: [], total: 0 },
          files: dff?.files || { items: [], total: 0 },
        });
      } catch { if (!cancelled) toast.error("No se pudo buscar"); }
      finally { if (!cancelled) setSearchLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, currentId, debouncedQ, folderPage, filePage]);

  // Recarga tras mutaciones (subir/borrar/renombrar): refresca el árbol y fuerza recarga COMPLETA de la carpeta.
  const refresh = useCallback(async () => {
    // Re-siembra el árbol lazy (refleja carpetas creadas/borradas) desde el camino de la carpeta actual.
    loadedParents.current = new Set();
    setTreeStore(new Map());
    setExpandedFolders(new Set());      // se re-expande solo el camino actual (evita ramas expandidas sin datos)
    try { await loadPath(currentId); } catch { /* el árbol simplemente no se re-siembra */ }
    lastFetchedFolder.current = null;   // fuerza rama "full" del detalle (3A)
    setFilesNonce((n) => n + 1);
  }, [currentId, loadPath]);

  /* Keyboard: Ctrl/Cmd+K foco en búsqueda */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Upload con progreso via XHR */
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!currentId) return;
    const arr = Array.from(files);
    for (const file of arr) {
      const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setUploads((u) => [...u, { id, name: file.name, progress: 0, status: "uploading" }]);
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/drive/upload");
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              const pct = Math.round((ev.loaded / ev.total) * 100);
              setUploads((u) => u.map((j) => (j.id === id ? { ...j, progress: pct } : j)));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploads((u) => u.map((j) => (j.id === id ? { ...j, progress: 100, status: "done" } : j)));
              resolve();
            } else {
              let msg = `HTTP ${xhr.status}`;
              try { msg = JSON.parse(xhr.responseText)?.error || msg; } catch {}
              setUploads((u) => u.map((j) => (j.id === id ? { ...j, status: "error", error: msg } : j)));
              reject(new Error(msg));
            }
          };
          xhr.onerror = () => {
            setUploads((u) => u.map((j) => (j.id === id ? { ...j, status: "error", error: "Network error" } : j)));
            reject(new Error("Network error"));
          };
          const fd = new FormData();
          fd.append("file", file);
          fd.append("folder_id", currentId);
          xhr.send(fd);
        });
        toast.success(`Subido: ${file.name}`);
      } catch (e: any) {
        toast.error(`Falló ${file.name}: ${e?.message || e}`);
      }
    }
    refresh();
    setTimeout(() => setUploads((u) => u.filter((j) => j.status !== "done")), 3000);
  }, [currentId, refresh]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (!e.dataTransfer?.files?.length) return;
    uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  const createFolder = useCallback(async () => {
    if (!currentId || !newFolderName.trim()) return;
    const r = await fetch("/api/drive/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: currentId, nombre: newFolderName.trim() }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || "Error creando carpeta");
      return;
    }
    setNewFolderName("");
    setShowNewFolder(false);
    refresh();
    toast.success("Carpeta creada");
  }, [currentId, newFolderName, refresh]);

  const renameFile = useCallback(async (file: DriveFile) => {
    const nombre = prompt("Nuevo nombre:", file.nombre);
    if (!nombre || nombre === file.nombre) return;
    const r = await fetch(`/api/drive/files/${file.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });
    if (r.ok) { toast.success("Renombrado"); refresh(); } else toast.error("Error renombrando");
  }, [refresh]);

  const deleteFile = useCallback(async (file: DriveFile) => {
    // No dice «eliminar»: no elimina (§0). Va a la papelera y se puede restaurar, y eso es lo
    // que decide si alguien pulsa con miedo o con tranquilidad.
    if (!confirm(`¿Enviar "${file.nombre}" a la papelera? Se puede restaurar desde ahí.`)) return;
    const r = await fetch(`/api/drive/files/${file.id}`, { method: "DELETE" });
    if (r.ok) { toast.success("En la papelera. Se puede restaurar."); refresh(); }
    else toast.error("No se pudo enviar a la papelera.");
  }, [refresh]);

  const renameFolder = useCallback(async (folder: DriveFolder) => {
    const nombre = prompt("Nuevo nombre:", folder.nombre);
    if (!nombre || nombre === folder.nombre) return;
    const r = await fetch(`/api/drive/folders/${folder.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });
    if (r.ok) { toast.success("Renombrada"); refresh(); } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error === "no_renombrable" ? "Carpeta del sistema, no se puede renombrar" : "Error renombrando");
    }
  }, [refresh]);

  const deleteFolder = useCallback(async (folder: DriveFolder) => {
    // Tampoco elimina: archiva la carpeta y todo lo que cuelga de ella, y se restaura (§0).
    if (!confirm(`¿Enviar "${folder.nombre}" y todo su contenido a la papelera? Se puede restaurar.`)) return;
    const r = await fetch(`/api/drive/folders/${folder.id}`, { method: "DELETE" });
    if (r.ok) { toast.success("Carpeta en la papelera. Se puede restaurar."); refresh(); } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error === "no_eliminable" ? "Carpeta del sistema, no se puede enviar a la papelera" : "No se pudo enviar a la papelera.");
    }
  }, [refresh]);

  /* Índice de nodos ya cargados en el árbol (por id), derivado del store — para el auto-expand al navegar. */
  const nodeById = useMemo(() => {
    const m = new Map<string, DriveFolder>();
    for (const entry of treeStore.values()) for (const c of entry.children) m.set(c.id, c);
    if (root) m.set(root.id, root);
    return m;
  }, [treeStore, root]);

  /* Auto-expandir hasta el current folder al navegar. Si ya está en el árbol, expando su cadena (que está
     cargada, porque es visible); si no (navegación por breadcrumb/detalle), pido el camino con /tree/path. */
  useEffect(() => {
    if (!currentId) return;
    const node = nodeById.get(currentId);
    if (node) {
      const anc: string[] = [];
      let cur: DriveFolder | undefined = node;
      const seen = new Set<string>();
      while (cur && cur.parent_id && !seen.has(cur.id)) { seen.add(cur.id); anc.push(cur.parent_id); cur = nodeById.get(cur.parent_id); }
      if (anc.length) setExpandedFolders((prev) => { const s = new Set(prev); anc.forEach((a) => s.add(a)); return s; });
    } else if (root) {
      loadPath(currentId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, nodeById, root]);

  /* Raíz + accesos rápidos (derivados del store, ya no de la lista plana). */
  const rootFolder = root || undefined;
  const rootChildren = root ? (treeStore.get(root.id)?.children || []) : [];
  const companyFolder = rootChildren.find((f) => f.tipo === "company");
  const atRoot = detail?.folder.id === root?.id;

  // Los archivos ya vienen paginados y filtrados por el servidor (incluida la búsqueda `q`): la página es tal cual.
  // ⚠️ Memorizado, y no es adorno: `?? []` fabrica un array nuevo en cada render, así que el
  // `useMemo` del recorrido se recalcularía siempre y no memorizaría nada.
  const pageFiles = useMemo(() => detail?.files ?? [], [detail?.files]);

  // Las subcarpetas ya vienen paginadas y filtradas por el servidor (búsqueda `qFolder`): la página es tal cual.
  const pageChildren = useMemo(() => detail?.children ?? [], [detail?.children]);

  /**
   * 🔴 EL RECORRIDO — lo que se ve y lo que caminan las flechas, calculado UNA vez.
   *
   * Desde la T2 el panel puede enseñar archivos de subcarpetas desplegadas, así que «los archivos
   * de la carpeta» y «los archivos en pantalla» dejaron de ser lo mismo. El visor guarda un
   * ÍNDICE, y si ese índice apuntara a una lista distinta de la pintada, el «3 / 12» seguiría
   * contando bien y enseñando otro archivo. Ver `lib/drive-recorrido.ts`.
   *
   * En mosaico no hay desplegables: se le pasa el conjunto vacío y el recorrido vuelve a ser el
   * de siempre. La decisión de qué se ve la toma esta línea, y las flechas la heredan.
   */
  const recorrido = useMemo(
    () => construirRecorrido({
      subcarpetas: pageChildren,
      desplegadas: viewMode === "list" ? desplegadas : new Set<string>(),
      archivosPorSubcarpeta: archivosDeSub,
      archivosPropios: pageFiles,
    }),
    [pageChildren, desplegadas, archivosDeSub, pageFiles, viewMode]
  );

  /**
   * El archivo abierto en el visor. Si el indice se sale de rango —porque se recargo la carpeta o
   * cambio un filtro, o porque se plego una subcarpeta con el visor abierto— sale `null` y el
   * visor se cierra solo, en vez de reventar apuntando a un hueco.
   */
  const entradaEnVisor = previewIndice === null ? null : (recorrido.planos[previewIndice] ?? null);
  const archivoEnVisor = entradaEnVisor?.file ?? null;

  /**
   * Dónde se ofrece marcar y mover: el mismo sitio donde ya se puede subir y borrar. Sacar un
   * archivo de una carpeta la modifica igual que dejarlo en ella.
   *
   * ⚠️ Esto es UX (§4.2): la barrera de verdad la pone el backend, que comprueba escritura en el
   * ORIGEN y en el DESTINO. Se esconde la casilla porque ofrecer algo que va a devolver 403 no
   * ayuda a nadie — aquí no hay flujo de solicitud que ofrecer a cambio.
   */
  const puedeMover = canWriteCurrent(detail?.breadcrumbs);

  /**
   * ¿Lo que estoy viendo está dentro de MI unidad?
   *
   * 🔴 Sin atajo de admin, a diferencia de `canEditCurrent`. Compartir reparte accesos sobre un
   * espacio personal, y eso lo decide su dueño. Es la misma frontera que `esMiRama` en el
   * servidor — que es quien manda: esto solo evita ofrecer un botón que iba a dar 403.
   */
  const esMiUnidad = !!(
    user?.id && (detail?.breadcrumbs ?? []).some((b: any) => b.tipo === "user" && b.owner_user_id === user.id)
  );
  const abrirCompartir = (objetivo: any, nombre: string) => setCompartiendo({ objetivo, nombre });

  /**
   * Destacar. 🔴 El cliente manda QUÉ, nunca el ámbito: eso lo decide el servidor según dónde
   * viva la cosa. Si se mandara desde aquí, un campo mal puesto publicaría el nombre de una
   * carpeta privada a toda la empresa. Ver `ambitoDeDestacado` en el backend.
   */
  const destacar = useCallback(async (objetivo: any, nombre: string) => {
    try {
      const r = await fetch("/api/drive/destacados", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(objetivo),
      });
      if (!r.ok) { toast.error("No se pudo destacar."); return; }
      const d = await r.json();
      toast.success(d?.ya_estaba ? `«${nombre}» ya estaba destacado` : `«${nombre}» destacado`);
      setTokenCompartidos((n) => n + 1);
    } catch { toast.error("No se pudo destacar."); }
  }, []);
  const seleccionados = recorrido.propios.filter((a) => seleccion.has(a.file.id));

  const isScoped = rootScope !== "global";

  /**
   * Las migas de pan, recortadas al alcance. Con `scopeRootId` puesto, la cadena empieza AHÍ y no
   * en la raíz del Drive: dentro de una negociación se puede subir hasta su carpeta y no más.
   *
   * ⚠️ Si la raíz del alcance no aparece en la cadena —no debería, pero un dato raro basta— se
   * devuelve la cadena entera en vez de una vacía: quedarse sin migas deja al usuario sin saber
   * dónde está, que es peor que enseñarle un tramo de más.
   */
  /** ¿Ya se está en el panel principal del Drive? Entonces el botón de inicio se pinta apagado. */
  const estaEnInicio = panel === "carpeta" && !!root && detail?.folder.id === root.id;

  const migas = useMemo(
    () => recortarMigas(detail?.breadcrumbs ?? [], scopeRootId),
    [detail?.breadcrumbs, scopeRootId]
  );

  return (
    <div
      className={cn(
        "relative flex h-full min-h-[600px] overflow-hidden rounded-3xl",
        "bg-gradient-to-br from-white via-white to-neutral-50 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900",
        "border border-black/5 dark:border-white/5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
        className
      )}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragActive(false); }}
      onDrop={onDrop}
    >
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] dark:opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(ellipse at top left, rgba(87,80,232,0.4), transparent 50%), radial-gradient(ellipse at bottom right, rgba(255,0,110,0.3), transparent 55%)"
        }} />

      {/* ===== Sidebar árbol (sólo scope=global) ===== */}
      {!isScoped && (
        <aside className="relative w-64 shrink-0 border-r border-black/5 dark:border-white/5 flex flex-col">
          <div className="px-5 py-5 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, 5, 0, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-lg shadow-orange-500/30"
              >
                <HardDrive className="h-4 w-4 text-white" strokeWidth={2.4} />
              </motion.div>
              <div>
                <div className="text-[9px] font-ui font-bold uppercase tracking-[0.18em] text-brand-orange">Drive</div>
                <div className="text-sm font-display font-black leading-none">Mi unidad</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5 scrollbar-thin">
            {/* Arranca en los HIJOS de la raíz, no en la raíz. «Drive del CRM» era un nodo que
                había que abrir para llegar a todo, y lo que se pidió es que lo de primer nivel
                sean las secciones: Mi unidad, Drive de la compañía y —solo para el super_admin—
                Drive Contactos. */}
            <FolderTree
              store={treeStore}
              parentId={root ? root.id : null}
              currentId={currentId}
              onSelect={openFolder}
              depth={0}
              expanded={expandedFolders}
              onToggle={handleToggle}
              onLoadMore={loadMore}
            />
            {/* 🔴 «Compartidos conmigo» va ANCLADO, como se pidió: «ese compartidos conmigo
                siempre debería quedar como anclado arriba, para poderlo ver más fácil». Aquí
                queda fijo bajo el árbol y encima de la papelera, fuera del scroll de carpetas. */}
            <button
              onClick={() => { setPanel("compartidos"); setTokenCompartidos((n) => n + 1); }}
              className={cn(
                "mt-4 w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-ui transition border-t border-black/5 dark:border-white/5 pt-4",
                verCompartidos ? "text-brand-orange font-bold" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-white/5"
              )}
            >
              <div className="h-6 w-6 rounded-lg bg-brand-orange/10 flex items-center justify-center shrink-0">
                <Share2 className="h-3 w-3 text-brand-orange" strokeWidth={2.2} />
              </div>
              <span className="flex-1 truncate font-bold">Compartidos conmigo</span>
            </button>

            <button
              onClick={() => { setPanel("destacados"); setTokenCompartidos((n) => n + 1); }}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-ui transition",
                panel === "destacados" ? "text-brand-orange font-bold" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-white/5"
              )}
            >
              <div className="h-6 w-6 rounded-lg bg-brand-orange/10 flex items-center justify-center shrink-0">
                <Star className="h-3 w-3 text-brand-orange" strokeWidth={2.2} />
              </div>
              <span className="flex-1 truncate font-bold">Destacados</span>
            </button>

            <button
              onClick={() => { setPanel("recientes"); setTokenCompartidos((n) => n + 1); }}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-ui transition",
                panel === "recientes" ? "text-brand-orange font-bold" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-white/5"
              )}
            >
              <div className="h-6 w-6 rounded-lg bg-brand-orange/10 flex items-center justify-center shrink-0">
                <Clock className="h-3 w-3 text-brand-orange" strokeWidth={2.2} />
              </div>
              <span className="flex-1 truncate font-bold">Recientes</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => setShowTrash(true)}
                className="mt-4 w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-ui text-neutral-600 dark:text-neutral-400 hover:bg-rose-50 dark:hover:bg-rose-900/10 hover:text-rose-600 transition border-t border-black/5 dark:border-white/5 pt-4"
              >
                <div className="h-6 w-6 rounded-lg bg-rose-100 dark:bg-rose-900/20 flex items-center justify-center shrink-0">
                  <Trash2 className="h-3 w-3 text-rose-600" strokeWidth={2.2} />
                </div>
                <span className="flex-1 truncate font-bold">Papelera</span>
              </button>
            )}
          </nav>

          {/* Mini stats */}
          <div className="border-t border-black/5 dark:border-white/5 p-4 bg-gradient-to-br from-neutral-50 to-white dark:from-neutral-900 dark:to-neutral-950">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3 w-3 text-brand-orange" strokeWidth={2.4} />
              <div className="text-[9px] font-ui font-bold uppercase tracking-[0.18em] text-neutral-500">Backend</div>
            </div>
            <div className="text-[11px] font-ui text-neutral-600 dark:text-neutral-400 leading-snug">
              {storageReady ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {storageProvider || "Almacenamiento"} conectado
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Almacenamiento no configurado
                </span>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* ===== Panel principal ===== */}
      <div className="relative flex-1 flex flex-col min-w-0">
        {/* Warning almacenamiento */}
        {!storageReady && (
          <div className="px-5 py-2.5 bg-amber-50/80 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-900/40 flex items-center gap-2 text-xs backdrop-blur">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-amber-800 dark:text-amber-300 font-ui">Almacenamiento no configurado — configurá el object store en .env y reiniciá crm-api.</span>
          </div>
        )}

        {/* Top bar: breadcrumbs + acciones */}
        <div className="h-16 shrink-0 px-6 border-b border-black/5 dark:border-white/5 flex items-center gap-3 bg-white/70 dark:bg-neutral-950/70 backdrop-blur-xl">
          {/* 🔴 EL BOTÓN DE INICIO — pedido el 2026-08-25: «si entro por ejemplo a mi unidad no
              tengo forma de ir nuevamente al panel principal de drive».
              Va SIEMPRE, y no solo cuando hay migas: desde «Compartidos conmigo», «Destacados» o
              «Recientes» no hay cadena que pulsar, así que era la única pantalla sin salida.
              Solo en el Drive general — dentro de una negociación la raíz es su carpeta y subir
              más es justo lo que la T3 vino a impedir. */}
          {!isScoped && (
            <button
              onClick={() => { setPanel("carpeta"); if (root) openFolder(root.id); }}
              title="Ir al inicio del Drive"
              aria-label="Ir al inicio del Drive"
              className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition",
                estaEnInicio
                  ? "text-brand-orange bg-brand-orange/10"
                  : "text-neutral-500 hover:text-brand-orange hover:bg-brand-orange/10"
              )}
            >
              <Home className="h-4 w-4" strokeWidth={2.2} />
            </button>
          )}

          <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-thin">
            {panel !== "carpeta" ? (
              <span className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 font-ui font-bold gradient-orange text-white text-xs">
                {panel === "compartidos" && <><Share2 className="h-3.5 w-3.5" /> Compartidos conmigo</>}
                {panel === "destacados" && <><Star className="h-3.5 w-3.5" /> Destacados</>}
                {panel === "recientes" && <><Clock className="h-3.5 w-3.5" /> Recientes</>}
              </span>
            ) : loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
            ) : detail ? (
              <>
                {/* T3 · el escalón de vuelta. Va ANTES de las migas y fuera de ellas a propósito:
                    no es un ancestro de esta carpeta —la de la negociación cuelga de `Trámites`
                    en 6.935 de los casos, no del contacto—, es un salto a otra pantalla. Pintarlo
                    como una miga más diría que se puede subir hasta ahí navegando, y no se puede. */}
                {volverA && (
                  <>
                    <a
                      href={volverA.href}
                      className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 shrink-0 font-ui font-bold text-neutral-500 hover:text-brand-orange hover:bg-brand-orange/5 transition"
                      title={volverA.etiqueta}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
                      <span className="truncate max-w-[160px] text-xs">{volverA.etiqueta}</span>
                    </a>
                    <span className="text-neutral-300 shrink-0">|</span>
                  </>
                )}
                <Breadcrumbs breadcrumbs={migas} onJump={openFolder} />
              </>
            ) : (
              <div className="text-neutral-400 text-xs font-ui">Selecciona una carpeta</div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Search con shortcut kbd */}
            <div className="relative hidden md:block">
              <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Buscar en carpeta"
                className="h-9 w-56 pl-9 pr-14 rounded-xl bg-neutral-100 dark:bg-white/5 text-xs font-ui outline-none focus:ring-2 focus:ring-brand-orange/40 focus:bg-white dark:focus:bg-white/10 transition placeholder:text-neutral-400"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-ui font-bold bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded px-1.5 py-0.5 text-neutral-500 pointer-events-none flex items-center gap-0.5">
                <Command className="h-2.5 w-2.5" strokeWidth={2.4} />K
              </kbd>
            </div>

            {/* Alcance de búsqueda: en esta carpeta (3A) vs en todo el subárbol (3C) */}
            <div className="hidden md:flex items-center bg-neutral-100 dark:bg-white/5 rounded-xl p-0.5 text-[10px] font-ui font-bold">
              <button
                onClick={() => setSearchScope(false)}
                className={cn("h-8 px-2.5 rounded-lg transition whitespace-nowrap", !searchScope ? "bg-white dark:bg-white/10 shadow text-neutral-900 dark:text-white" : "text-neutral-500")}
                title="Buscar solo en esta carpeta"
              >
                Esta carpeta
              </button>
              <button
                onClick={() => setSearchScope(true)}
                className={cn("h-8 px-2.5 rounded-lg transition whitespace-nowrap", searchScope ? "bg-white dark:bg-white/10 shadow text-brand-orange" : "text-neutral-500")}
                title="Buscar en todo el subárbol de esta carpeta"
              >
                Todo el subárbol
              </button>
            </div>

            {/* View mode toggle */}
            <div className="hidden sm:flex items-center bg-neutral-100 dark:bg-white/5 rounded-xl p-0.5">
              <button
                onClick={() => setViewMode("list")}
                className={cn("h-8 w-8 rounded-lg flex items-center justify-center transition", viewMode === "list" ? "bg-white dark:bg-white/10 shadow text-neutral-900 dark:text-white" : "text-neutral-500")}
                title="Lista"
              >
                <List className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={cn("h-8 w-8 rounded-lg flex items-center justify-center transition", viewMode === "grid" ? "bg-white dark:bg-white/10 shadow text-neutral-900 dark:text-white" : "text-neutral-500")}
                title="Grilla"
              >
                <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            </div>

            <button
              onClick={() => setShowNewFolder(true)}
              disabled={!currentId}
              className="h-9 px-3.5 rounded-xl border border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/5 text-[11px] font-ui font-bold flex items-center gap-1.5 disabled:opacity-40 transition"
            >
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={2.2} /> Carpeta
            </button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={!currentId || !storageReady}
              className="relative h-9 px-4 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden group"
            >
              <motion.span
                className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
              />
              <Upload className="relative h-3.5 w-3.5" strokeWidth={2.4} /> <span className="relative">Subir</span>
            </motion.button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
          {(loading || loadingDetail) ? (
            <div className="py-2">
              <div className="flex items-center gap-2 text-neutral-400 text-sm mb-5">
                <Loader2 className="h-4 w-4 animate-spin text-brand-orange" />
                <span className="font-ui">Cargando documentos…</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-neutral-100 dark:bg-white/5 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            </div>
          ) : searchActive ? (
            <SearchResults
              q={debouncedQ}
              scopeName={detail?.folder.nombre || ""}
              res={searchRes}
              loading={searchLoading}
              folderPage={folderPage}
              filePage={filePage}
              onFolderPage={setFolderPage}
              onFilePage={setFilePage}
              onGoFolder={(id) => { setSearchScope(false); setSearchQ(""); openFolder(id); }}
              onGoFile={(folderId) => { setSearchScope(false); setSearchQ(""); openFolder(folderId); }}
            />
          ) : !detail ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-400 text-sm">
              <HardDrive className="h-12 w-12" strokeWidth={1.2} />
              Ninguna carpeta seleccionada
            </div>
          ) : panel === "destacados" ? (
            <DestacadosPanel
              recargarToken={tokenCompartidos}
              esAdmin={isAdmin}
              onAbrirCarpeta={(id) => { setPanel("carpeta"); openFolder(id); }}
              onAbrirArchivo={(it) => setArchivoSuelto({
                id: it.file_id!, folder_id: it.folder_id ?? "", nombre: it.nombre, mime: it.mime,
                size_bytes: it.size_bytes as any, uploaded_by: "", created_at: "", updated_at: "",
              })}
            />
          ) : panel === "recientes" ? (
            <RecientesPanel
              recargarToken={tokenCompartidos}
              onAbrirArchivo={(it) => setArchivoSuelto({
                id: it.file_id, folder_id: it.folder_id, nombre: it.nombre, mime: it.mime,
                size_bytes: it.size_bytes as any, uploaded_by: "", created_at: "", updated_at: "",
              })}
            />
          ) : verCompartidos ? (
            <CompartidosConmigo
              recargarToken={tokenCompartidos}
              onAbrirCarpeta={(id) => { setPanel("carpeta"); openFolder(id); }}
              onAbrirArchivo={(it) => setArchivoSuelto({
                id: it.file_id!, folder_id: "", nombre: it.nombre, mime: it.mime,
                size_bytes: it.size_bytes as any, uploaded_by: "", created_at: "", updated_at: "",
              })}
            />
          ) : (
            <>
              {/* Hero Root: stats + quick-access */}
              {!isScoped && atRoot && (
                <HeroRoot
                  rootFolder={rootFolder}
                  companyFolder={companyFolder}
                  userFolderId={userFolderId}
                  onNavigate={openFolder}
                />
              )}

              {/* Subcarpetas (paginadas + búsqueda server-side) */}
              {(childrenTotal > 0 || (!!debouncedQ && pageChildren.length > 0)) && (
                <section className="mb-8">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <SectionHeader icon={Folder} label={atRoot && !isScoped ? "Todas las carpetas" : "Carpetas"} count={childrenTotal} />
                    {loadingChildren && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-orange" />}
                  </div>
                  {viewMode === "list" ? (
                    <div className="space-y-1">
                      {pageChildren.map((f, i) => (
                        <SubcarpetaFila
                          key={f.id}
                          folder={f}
                          index={i}
                          compartida={misCompartidas.carpetas.has(f.id)}
                          archivosCompartidos={misCompartidas.archivos}
                          onCompartir={esMiUnidad ? () => abrirCompartir({ folder_id: f.id }, f.nombre) : undefined}
                          onDestacar={() => destacar({ folder_id: f.id }, f.nombre)}
                          onRenombrar={canEditCurrent(detail?.breadcrumbs) ? () => renameFolder(f) : undefined}
                          onEliminar={canEditCurrent(detail?.breadcrumbs) ? () => deleteFolder(f) : undefined}
                          abierta={desplegadas.has(f.id)}
                          cargando={cargandoSub.has(f.id)}
                          archivos={recorrido.porSubcarpeta[f.id] ?? []}
                          onAlternar={() => alternarSubcarpeta(f)}
                          onAbrir={() => openFolder(f.id)}
                          onPreview={(indice) => setPreviewIndice(indice)}
                          onDownload={(af) => window.open(`/api/drive/files/${af.id}/download`, "_blank")}
                        />
                      ))}
                    </div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                    >
                      {pageChildren.map((f, i) => (
                        <FolderCard
                          key={f.id}
                          folder={f}
                          index={i}
                          compartida={misCompartidas.carpetas.has(f.id)}
                          onCompartir={esMiUnidad ? () => abrirCompartir({ folder_id: f.id }, f.nombre) : undefined}
                          onDestacar={() => destacar({ folder_id: f.id }, f.nombre)}
                          onOpen={() => openFolder(f.id)}
                          onRename={canEditCurrent(detail?.breadcrumbs) ? () => renameFolder(f) : undefined}
                          onDelete={canEditCurrent(detail?.breadcrumbs) ? () => deleteFolder(f) : undefined}
                        />
                      ))}
                    </motion.div>
                  )}
                  <Pagination page={childrenPage} pageSize={CHILDREN_PAGE_SIZE} total={childrenTotal} onPageChange={setChildrenPage} disabled={loadingChildren} />
                </section>
              )}

              {/* Archivos (paginados + filtrados server-side) */}
              {(filesTotal > 0 || fileFiltrosActivos) ? (
                <section>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <SectionHeader icon={File} label="Archivos" count={filesTotal} />
                    {loadingFiles && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-orange" />}
                  </div>

                  {/* Barra de filtros de archivos */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <TrashFilterSelect value={fileTipo} onChange={setFiltroTipo} options={TIPO_OPTS} title="Tipo de archivo" />
                    {uploaders.length > 0 && (
                      <TrashFilterSelect
                        value={fileUploader}
                        onChange={setFiltroUploader}
                        options={[{ value: "", label: "Subido por: todos" }, ...uploaders.map((x) => ({ value: x.id, label: x.nombre }))]}
                        title="Subido por"
                      />
                    )}
                    <DateRangePopover value={fileRango} onChange={setFiltroRango} presets={PAST_PRESETS} placeholder="Fecha de subida" />
                    <button
                      onClick={toggleFileOrden}
                      title="Ordenar por fecha de subida"
                      className="h-9 px-3 rounded-xl text-sm border bg-neutral-50 dark:bg-white/5 border-transparent hover:bg-white hover:border-slate-200 text-slate-700 dark:text-neutral-200 flex items-center gap-1.5 transition"
                    >
                      Fecha {fileOrden === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                    </button>
                    {fileFiltrosActivos && (
                      <button
                        onClick={limpiarFileFiltros}
                        className="h-9 px-3 rounded-xl bg-neutral-50 dark:bg-white/5 hover:bg-white text-neutral-500 hover:text-brand-red text-xs font-bold flex items-center gap-1.5 transition"
                      >
                        <X className="h-3.5 w-3.5" /> Limpiar filtros
                      </button>
                    )}
                  </div>

                  {/* La barra de la selección. Sale sola cuando hay algo marcado y dice CUÁNTO
                      hay marcado antes de ofrecer nada: una acción en lote se confirma enseñando
                      su alcance, no preguntando "¿seguro?" (§10.7). */}
                  {seleccionados.length > 0 && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-brand-orange/5 border border-brand-orange/30">
                      <span className="text-xs font-ui font-bold text-brand-orange">
                        {seleccionados.length} archivo{seleccionados.length === 1 ? "" : "s"} seleccionado{seleccionados.length === 1 ? "" : "s"}
                      </span>
                      <button
                        onClick={() => setMostrarMover(true)}
                        className="h-8 px-3 rounded-lg gradient-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider hover:brightness-110 transition flex items-center gap-1.5"
                      >
                        <FolderOpen className="h-3.5 w-3.5" /> Mover a…
                      </button>
                      {/* Faltaba: la barra sabía mover y no archivar. */}
                      <button
                        onClick={() => setConfirmarPapelera(true)}
                        className="h-8 px-3 rounded-lg text-[11px] font-ui font-bold text-brand-red hover:bg-red-50 dark:hover:bg-red-900/10 transition flex items-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Enviar a la papelera
                      </button>
                      <button
                        onClick={() => setSeleccion(new Set())}
                        className="h-8 px-3 rounded-lg text-[11px] font-ui font-bold text-neutral-500 hover:text-neutral-800 hover:bg-black/5 transition"
                      >
                        Quitar la selección
                      </button>
                    </div>
                  )}

                  {pageFiles.length > 0 ? (
                    viewMode === "list" ? (
                      <div className="space-y-1">
                        {recorrido.propios.map((a, i) => (
                          <FileRow
                            key={a.file.id}
                            file={a.file}
                            index={i}
                            onDownload={() => window.open(`/api/drive/files/${a.file.id}/download`, "_blank")}
                            onPreview={() => setPreviewIndice(a.indice)}
                            onRename={canEditCurrent(detail?.breadcrumbs) ? () => renameFile(a.file) : undefined}
                            onDelete={canWriteCurrent(detail?.breadcrumbs) ? () => deleteFile(a.file) : undefined}
                            compartido={misCompartidas.archivos.has(a.file.id)}
                            seleccionado={seleccion.has(a.file.id)}
                            onSeleccionar={puedeMover ? () => alternarSeleccion(a.file.id) : undefined}
                            onCompartir={esMiUnidad ? () => abrirCompartir({ file_id: a.file.id }, a.file.nombre) : undefined}
                            onDestacar={() => destacar({ file_id: a.file.id }, a.file.nombre)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {recorrido.propios.map((a, i) => (
                          <FileCard
                            key={a.file.id}
                            file={a.file}
                            index={i}
                            compartido={misCompartidas.archivos.has(a.file.id)}
                            onDownload={() => window.open(`/api/drive/files/${a.file.id}/download`, "_blank")}
                            onPreview={() => setPreviewIndice(a.indice)}
                            onRename={canEditCurrent(detail?.breadcrumbs) ? () => renameFile(a.file) : undefined}
                            onDelete={canWriteCurrent(detail?.breadcrumbs) ? () => deleteFile(a.file) : undefined}
                            onCompartir={esMiUnidad ? () => abrirCompartir({ file_id: a.file.id }, a.file.nombre) : undefined}
                            onDestacar={() => destacar({ file_id: a.file.id }, a.file.nombre)}
                          />
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="text-center py-12 text-sm text-neutral-500">
                      {fileFiltrosActivos ? "No hay archivos con estos filtros" : "No hay archivos en esta carpeta"}
                    </div>
                  )}

                  <Pagination page={filesPage} pageSize={FILES_PAGE_SIZE} total={filesTotal} onPageChange={setFilesPage} disabled={loadingFiles} />
                </section>
              ) : (childrenTotal === 0 && !(atRoot && !isScoped)) ? (
                <EmptyState onUpload={() => fileInputRef.current?.click()} ready={storageReady} />
              ) : null}
            </>
          )}
        </div>

        {/* Drag-and-drop overlay fullscreen */}
        <AnimatePresence>
          {dragActive && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center"
            >
              <div className="absolute inset-4 rounded-[28px] border-[3px] border-dashed border-brand-orange/70 bg-gradient-to-br from-brand-orange/10 via-pink-500/10 to-purple-500/10 backdrop-blur-sm" />
              <motion.div
                initial={{ scale: 0.8, y: 20 }} animate={{ scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                className="relative z-10 bg-white dark:bg-neutral-900 rounded-2xl px-8 py-6 shadow-2xl border border-black/5 flex items-center gap-4"
              >
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  className="h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-xl shadow-orange-500/40"
                >
                  <Upload className="h-5 w-5 text-white" strokeWidth={2.4} />
                </motion.div>
                <div>
                  <div className="text-base font-display font-black">Soltá para subir</div>
                  <div className="text-xs text-neutral-500 font-ui mt-0.5">Los archivos se guardan en {storageProvider || "el object store"}</div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal Nueva Carpeta */}
        <AnimatePresence>
          {showNewFolder && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setShowNewFolder(false)}
            >
              <motion.div
                initial={{ scale: 0.92, y: 12, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 6, opacity: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 24 }}
                className="bg-white dark:bg-neutral-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-black/5 dark:border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-lg shadow-orange-500/30">
                    <FolderPlus className="h-5 w-5 text-white" strokeWidth={2.4} />
                  </div>
                  <div>
                    <div className="font-display font-black text-lg">Nueva carpeta</div>
                    <div className="text-xs text-neutral-500 font-ui">en {detail?.folder.nombre}</div>
                  </div>
                </div>
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                  placeholder="Nombre de la carpeta"
                  className="w-full h-12 px-4 rounded-2xl bg-neutral-100 dark:bg-white/5 text-sm font-ui outline-none focus:ring-2 focus:ring-brand-orange/40 focus:bg-white dark:focus:bg-white/10 transition"
                />
                <div className="mt-5 flex gap-2 justify-end">
                  <button onClick={() => setShowNewFolder(false)} className="h-10 px-4 rounded-xl text-xs font-ui font-bold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/5 transition">Cancelar</button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={createFolder}
                    disabled={!newFolderName.trim()}
                    className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-xs font-ui font-bold uppercase tracking-wider shadow-lg shadow-orange-500/30 disabled:opacity-40 transition"
                  >
                    Crear
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Uploads widget flotante */}
        <AnimatePresence>
          {uploads.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="absolute bottom-5 right-5 z-30 w-80 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-black/5 dark:border-white/10 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-black/5 dark:border-white/5 flex items-center gap-2 bg-gradient-to-br from-neutral-50 to-white dark:from-neutral-950 dark:to-neutral-900">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-md shadow-orange-500/20">
                  <Upload className="h-3.5 w-3.5 text-white" strokeWidth={2.4} />
                </div>
                <div className="flex-1 text-[11px] font-ui font-bold uppercase tracking-wider">
                  Subiendo · {uploads.filter((u) => u.status === "uploading").length} / {uploads.length}
                </div>
                <button onClick={() => setUploads([])} className="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/10 flex items-center justify-center">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin">
                {uploads.map((j) => (
                  <div key={j.id} className="px-4 py-3 border-b border-black/5 dark:border-white/5 last:border-b-0">
                    <div className="flex items-center gap-2 text-xs">
                      {j.status === "done" ? (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 0.45 }}>
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        </motion.div>
                      ) : j.status === "error" ? (
                        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-brand-orange shrink-0" />
                      )}
                      <div className="flex-1 truncate font-ui font-semibold">{j.name}</div>
                      <div className="text-[10px] tabular-nums font-ui font-bold text-neutral-500">{j.progress}%</div>
                    </div>
                    {j.status === "uploading" && (
                      <div className="mt-2 h-1 bg-neutral-100 dark:bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-brand-orange to-neon-magenta"
                          animate={{ width: `${j.progress}%` }}
                          transition={{ type: "spring", stiffness: 200, damping: 22 }}
                        />
                      </div>
                    )}
                    {j.status === "error" && <div className="text-[10px] text-red-500 mt-1 font-ui">{j.error}</div>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal preview */}
      <AnimatePresence>
        {archivoSuelto && (
          <FilePreviewModal file={archivoSuelto} onClose={() => setArchivoSuelto(null)} />
        )}

        {compartiendo && (
          <CompartirModal
            objetivo={compartiendo.objetivo}
            nombre={compartiendo.nombre}
            onCerrar={() => setCompartiendo(null)}
            onCambio={() => { recargarMisCompartidas(); setTokenCompartidos((n) => n + 1); }}
          />
        )}

        {/* La confirmación va al `<body>` por portal, como el resto de capas a pantalla completa
            (§4.9): dentro del árbol la comería el `overflow` del panel. */}
        {confirmarPapelera && createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !enviandoPapelera && setConfirmarPapelera(false)}
          >
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-xl bg-red-50 dark:bg-red-900/20 text-brand-red flex items-center justify-center shrink-0">
                  <Trash2 className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="text-sm font-display font-black">
                  Enviar {seleccion.size} archivo{seleccion.size === 1 ? "" : "s"} a la papelera
                </div>
              </div>
              {/* Una acción en lote se confirma enseñando su alcance, no preguntando «¿seguro?»
                  (§10.7). Y se dice que se deshace, que es lo que quita el miedo a pulsar. */}
              <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed mb-5">
                No se borran: quedan en la <b>papelera</b> y se pueden <b>restaurar</b> desde ahí.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmarPapelera(false)}
                  disabled={enviandoPapelera}
                  className="h-9 px-3 rounded-xl text-xs font-ui font-bold text-neutral-500 hover:bg-black/5 transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={enviarAPapelera}
                  disabled={enviandoPapelera}
                  className="h-9 px-4 rounded-xl bg-brand-red text-white text-[11px] font-ui font-bold uppercase tracking-wider hover:brightness-110 transition disabled:opacity-60 flex items-center gap-1.5"
                >
                  {enviandoPapelera && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Enviar a la papelera
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {mostrarMover && (
          <MoverArchivosModal
            cantidad={seleccion.size}
            onCerrar={() => setMostrarMover(false)}
            onMover={moverSeleccion}
          />
        )}

        {archivoEnVisor && previewIndice !== null && (
          // 🔴 EL MECANISMO YA EXISTIA: `FilePreviewModal` admite `onPrev`/`onNext`/`posicion`
          // desde la primera entrega de documentos, donde se dejaron OPCIONALES para no tocar el
          // Drive sin haberlo probado. La ficha del contacto los pasa desde entonces; el Drive
          // no. Aqui no se construye nada: se conecta.
          //
          // Las flechas van SIEMPRE, tambien en los extremos: la modal las desactiva a partir de
          // `posicion`, y asi no se le mueven los botones bajo el cursor.
          //
          // ⚠️ RECORREN LO QUE ESTA CARGADO, NO LO QUE EXISTE. El Drive pagina de 50 en 50, asi
          // que en el ultimo archivo de la pagina el boton se desactiva aunque queden mas paginas
          // por delante. Cargar la siguiente pagina desde la modal es otra decision y otra
          // entrega: implica que el «12 / 50» cambie de total mientras se mira, y eso hay que
          // pensarlo antes de hacerlo. Por eso el total que se ensena es el de la pagina.
          <FilePreviewModal
            file={archivoEnVisor}
            onClose={() => setPreviewIndice(null)}
            onPrev={() => setPreviewIndice((i) => (i === null ? null : Math.max(0, i - 1)))}
            onNext={() => setPreviewIndice((i) => (i === null ? null : Math.min(recorrido.planos.length - 1, i + 1)))}
            posicion={{ indice: previewIndice, total: recorrido.planos.length }}
            /* 🔴 `subcarpetaId === null` significa «este archivo es de la carpeta abierta». Los que
               asoman de una subcarpeta desplegada salen de OTRA carpeta, y los permisos que se
               miran aquí —`detail.breadcrumbs`— son los de esta. Ofrecerles compartir o papelera
               sería decidir con la cadena equivocada; se quedan con ver y descargar. Es la misma
               razón por la que esas filas tampoco traen casilla de selección.
               Destacar sí va siempre: el ámbito lo resuelve el servidor. */
            acciones={accionesDeArchivo({
              onCompartir: esMiUnidad && entradaEnVisor?.subcarpetaId === null && archivoEnVisor
                ? () => abrirCompartir({ file_id: archivoEnVisor.id }, archivoEnVisor.nombre)
                : undefined,
              onDestacar: archivoEnVisor
                ? () => destacar({ file_id: archivoEnVisor.id }, archivoEnVisor.nombre)
                : undefined,
              onDelete: canWriteCurrent(detail?.breadcrumbs) && entradaEnVisor?.subcarpetaId === null && archivoEnVisor
                ? async () => { await deleteFile(archivoEnVisor); setPreviewIndice(null); }
                : undefined,
            })}
          />
        )}
        {showTrash && isAdmin && (
          <TrashModal initialLevel={trashTab} onClose={() => { setShowTrash(false); refresh(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

// Select genérico para la barra de filtros de la papelera (resalta cuando hay valor activo).
function TrashFilterSelect({ value, onChange, options, title, disabled }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; title?: string; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      disabled={disabled}
      className={cn(
        "h-9 px-3 rounded-xl text-sm border outline-none transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        value
          ? "bg-brand-orange/10 border-brand-orange/30 text-brand-orange font-semibold"
          : "bg-neutral-50 dark:bg-white/5 border-transparent hover:bg-white hover:border-slate-200 text-slate-700 dark:text-neutral-200"
      )}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

interface TrashItem {
  kind: "folder" | "file";
  id: string;
  nombre: string;
  mime: string | null;
  size_bytes: number | string | null;
  deleted_at: string;
  deleted_by: string | null;
  folder_id: string | null;
  folder_nombre: string | null;
  file_count: number | null;
  folder_tipo: string | null;
  deleted_by_nombre: string | null;
}

const TRASH_PAGE_SIZE = 100;
const KIND_OPTS = [
  { value: "", label: "Carpetas y archivos" },
  { value: "folder", label: "Solo carpetas" },
  { value: "file", label: "Solo archivos" },
];
const TIPO_OPTS = [
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

function TrashModal({ onClose, initialLevel }: { onClose: () => void; initialLevel?: TrashLevel }) {
  const { isAdmin } = useCurrentUser();
  // Pestañas de NIVEL del modal unificado (Fase B3): Papelera (N1) · Sin identificar · Conservados (N2).
  const [level, setLevel] = useState<TrashLevel>(
    initialLevel === "cuarentena" || initialLevel === "conservado" || initialLevel === "papelera" ? initialLevel : "papelera"
  );
  const [items, setItems] = useState<TrashItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPapelera, setTotalPapelera] = useState(0); // total del contexto sin filtros (badge + gate "Vaciar")
  const [page, setPage] = useState(1);
  const [orden, setOrden] = useState<"desc" | "asc">("desc"); // sobre deleted_at
  const [usuarios, setUsuarios] = useState<{ id: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [kind, setKind] = useState("");
  const [tipo, setTipo] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rango, setRango] = useState<DateRange>({ from: null, to: null });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const filtrosActivos = !!(kind || tipo || usuario || rango.from || rango.to);
  const refrescar = () => setNonce((n) => n + 1);
  const setKindF = (v: string) => { setKind(v); if (v === "folder") setTipo(""); setPage(1); };
  const setTipoF = (v: string) => { setTipo(v); setPage(1); };
  const setUsuarioF = (v: string) => { setUsuario(v); setPage(1); };
  const setRangoF = (r: DateRange) => { setRango(r); setPage(1); };
  const toggleOrden = () => { setOrden((v) => (v === "desc" ? "asc" : "desc")); setPage(1); };
  const limpiarFiltros = () => { setKind(""); setTipo(""); setUsuario(""); setRango({ from: null, to: null }); setPage(1); };

  // Carga de la página activa (guard anti-carreras + limpia selección en cada carga).
  useEffect(() => {
    let cancelado = false;
    const run = async () => {
      setLoading(true);
      const p = new URLSearchParams();
      p.set("page", String(page));
      p.set("pageSize", String(TRASH_PAGE_SIZE));
      p.set("orden", orden);
      if (kind) p.set("kind", kind);
      if (tipo) p.set("tipo", tipo);
      if (usuario) p.set("usuario", usuario);
      if (rango.from) p.set("desde", rango.from.toISOString());
      if (rango.to) p.set("hasta", rango.to.toISOString());
      try {
        const r = await fetch(`/api/drive/trash?${p.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (cancelado) return;
        if ((d.items?.length ?? 0) === 0 && page > 1 && (d.total ?? 0) > 0) { setPage(1); return; }
        setItems(d.items || []);
        setTotal(d.total || 0);
        setUsuarios(d.usuarios || []);
        setSelected(new Set());
      } catch { if (!cancelado) toast.error("No se pudo cargar la papelera"); }
      finally { if (!cancelado) setLoading(false); }
    };
    run();
    return () => { cancelado = true; };
  }, [page, orden, kind, tipo, usuario, rango.from, rango.to, nonce]);

  // Total sin filtros (para el badge del header y el gate de "Vaciar todo").
  useEffect(() => {
    let cancelado = false;
    fetch("/api/drive/trash?solo_total=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelado && d) setTotalPapelera(d.total || 0); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [nonce]);

  // Solo visualización, sin descarga: se abre el visor compartido, que resuelve la URL a partir
  // del `id`. `/raw` y `/thumb` sirven tambien archivos en papelera, con la misma ACL de lectura.
  // Antes abria la pagina `/view` en una pestania nueva; ahora abre LA MISMA modal que el resto
  // del CRM, en esta pantalla. Los items de la papelera SI traen `id`, asi que aqui no se pierde
  // nada: la extraccion en servidor de Word, Excel y PowerPoint sigue disponible.
  const [verIndice, setVerIndice] = useState<number | null>(null);
  const archivosVisibles = items.filter((x) => x.kind === "file");
  const archivoEnVisor = verIndice === null ? null : (archivosVisibles[verIndice] ?? null);
  const ver = (it: TrashItem) => {
    const i = archivosVisibles.findIndex((x) => x.id === it.id);
    if (i >= 0) setVerIndice(i);
  };

  const restoreOne = async (it: TrashItem) => {
    const r = await fetch(`/api/drive/trash/restore/${it.kind}/${it.id}`, { method: "POST" });
    if (r.ok) { toast.success(it.kind === "folder" ? "Carpeta restaurada" : "Archivo restaurado"); refrescar(); } else toast.error("No se pudo restaurar");
  };
  const purgeOne = async (it: TrashItem) => {
    const msg = it.kind === "folder"
      ? "¿Enviar esta carpeta y sus archivos a cuarentena (Nivel 2)? Podrás restaurarlos o conservarlos durante 30 días."
      : "¿Enviar este archivo a cuarentena (Nivel 2)? Podrás restaurarlo o conservarlo durante 30 días.";
    if (!confirm(msg)) return;
    const r = await fetch(`/api/drive/trash/${it.kind}/${it.id}`, { method: "DELETE" });
    if (r.ok) { toast.success("Enviado a cuarentena"); refrescar(); } else toast.error("No se pudo purgar");
  };

  // Acciones en lote (scoped a la página): ruteo por kind de cada ítem sobre los endpoints existentes.
  const bulkAccion = async (accion: "restaurar" | "purgar") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (accion === "purgar" && !confirm(`¿Enviar ${ids.length} elemento(s) a cuarentena (Nivel 2)? Reversible durante 30 días.`)) return;
    const byId = new Map(items.map((it) => [it.id, it]));
    const tid = toast.loading(`${accion === "restaurar" ? "Restaurando" : "Enviando a cuarentena"} ${ids.length}…`);
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) {
      const it = byId.get(id);
      if (!it) { fail++; continue; }
      const url = accion === "restaurar"
        ? `/api/drive/trash/restore/${it.kind}/${id}`
        : `/api/drive/trash/${it.kind}/${id}`;
      try { const r = await fetch(url, { method: accion === "restaurar" ? "POST" : "DELETE" }); if (r.ok) ok++; else fail++; } catch { fail++; }
    }
    if (fail === 0) toast.success(`${ok} listo(s)`, { id: tid });
    else toast.warning(`${ok} ok, ${fail} fallaron`, { id: tid });
    setSelected(new Set()); setBulkBusy(false); refrescar();
  };

  const emptyAll = async () => {
    if (!confirm("¿Vaciar TODA la papelera? Se enviarán a cuarentena (Nivel 2) TODOS los archivos en papelera, sin importar los filtros ni la página actual. Reversible durante 30 días.")) return;
    const r = await fetch(`/api/drive/trash/empty`, { method: "DELETE" });
    if (r.ok) { toast.success("Papelera enviada a cuarentena"); setSelected(new Set()); refrescar(); } else toast.error("Error");
  };

  const allSelected = items.length > 0 && items.every((it) => selected.has(it.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const usuarioOptions = [{ value: "", label: "Todos los usuarios" }, ...usuarios.map((x) => ({ value: x.id, label: x.nombre }))];
  const vacio = !loading && items.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-4xl h-[88vh] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
            <Trash2 className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-black">Papelera</h2>
            <p className="text-[11px] text-neutral-500">
              {level === "papelera" ? `${totalPapelera} elemento${totalPapelera !== 1 ? "s" : ""} en papelera` : "Nivel 2 · cuarentena y conservados"}
            </p>
          </div>
          {level === "papelera" && isAdmin && totalPapelera > 0 && (
            <button onClick={emptyAll} className="h-9 px-3 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 text-[11px] font-ui font-bold uppercase tracking-wider transition">
              Vaciar todo
            </button>
          )}
          <button onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center">
            <X className="h-4 w-4 text-neutral-500" />
          </button>
        </div>

        {/* Pestañas de NIVEL */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-black/5 dark:border-white/5">
          {([
            { key: "papelera", label: "Papelera" },
            { key: "cuarentena", label: "Sin identificar" },
            { key: "conservado", label: "Conservados" },
          ] as { key: TrashLevel; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setLevel(t.key)}
              className={cn(
                "h-8 px-3.5 rounded-xl text-xs font-bold transition",
                level === t.key ? "bg-brand-orange text-white shadow-sm" : "bg-neutral-100 dark:bg-white/5 text-neutral-600 hover:bg-white"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {level !== "papelera" ? (
          // Nivel 2 (Sin identificar / Conservados): panel reutilizado con pestaña controlada por el modal.
          <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-black/30">
            <SinIdentificarPanel tab={level === "conservado" ? "conservado" : "cuarentena"} hideTabBar />
          </div>
        ) : (
        <>
        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-black/5 dark:border-white/5">
          <TrashFilterSelect value={kind} onChange={setKindF} options={KIND_OPTS} title="Carpeta o archivo" />
          <TrashFilterSelect value={tipo} onChange={setTipoF} options={TIPO_OPTS} title="Tipo de archivo" disabled={kind === "folder"} />
          {usuarios.length > 0 && (
            <TrashFilterSelect value={usuario} onChange={setUsuarioF} options={usuarioOptions} title="Eliminado por" />
          )}
          <DateRangePopover value={rango} onChange={setRangoF} presets={PAST_PRESETS} placeholder="Fecha de eliminación" />
          {filtrosActivos && (
            <button onClick={limpiarFiltros} className="h-9 px-3 rounded-xl bg-neutral-50 dark:bg-white/5 hover:bg-white text-neutral-500 hover:text-brand-red text-xs font-bold flex items-center gap-1.5 transition">
              <X className="h-3.5 w-3.5" /> Limpiar filtros
            </button>
          )}
          <div className="flex-1" />
          {!loading && (
            <span className="text-[12px] text-neutral-500 px-1"><span className="font-bold text-neutral-700 dark:text-neutral-300">{total}</span> resultado{total === 1 ? "" : "s"}</span>
          )}
        </div>

        {/* Barra de acciones masivas (página actual) */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-2 border-b border-black/5 dark:border-white/5 bg-brand-orange/5">
            <span className="text-sm font-black text-brand-orange px-1">
              {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
              <span className="font-medium text-brand-orange/70"> · de esta página</span>
            </span>
            <div className="flex-1" />
            <button onClick={() => bulkAccion("restaurar")} disabled={bulkBusy}
              className="h-9 px-3 rounded-xl bg-brand-green/10 hover:bg-brand-green/15 text-brand-green text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Restaurar
            </button>
            <button onClick={() => bulkAccion("purgar")} disabled={bulkBusy}
              className="h-9 px-3 rounded-xl bg-brand-red/10 hover:bg-brand-red/15 text-brand-red text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Purgar
            </button>
            <button onClick={() => setSelected(new Set())} title="Deseleccionar"
              className="h-9 w-9 rounded-xl bg-neutral-50 dark:bg-white/5 hover:bg-white text-neutral-500 flex items-center justify-center transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-black/30">
          {loading ? (
            <div className="text-center text-sm text-neutral-400 py-16">Cargando…</div>
          ) : vacio ? (
            <div className="text-center py-16">
              <Trash2 className="h-12 w-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-sm text-neutral-500">{filtrosActivos ? "No hay resultados con estos filtros" : "La papelera está vacía"}</p>
              {filtrosActivos && (
                <button onClick={limpiarFiltros} className="inline-flex items-center gap-1.5 mt-4 h-9 px-4 rounded-xl bg-white text-neutral-600 text-sm font-bold transition">
                  <X className="h-4 w-4" /> Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-ui uppercase tracking-wider text-neutral-400 border-b border-black/5 dark:border-white/5 sticky top-0 bg-neutral-50 dark:bg-neutral-900 z-10">
                  <th className="px-4 py-2.5 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Seleccionar los de esta página"
                      className="h-4 w-4 accent-brand-orange rounded cursor-pointer align-middle" />
                  </th>
                  <th className="px-3 py-2.5 font-bold">Elemento</th>
                  <th className="px-3 py-2.5 font-bold">Ubicación / contenido</th>
                  <th className="px-3 py-2.5 font-bold">Eliminado por</th>
                  <th className="px-3 py-2.5 font-bold">
                    <button onClick={toggleOrden} className="inline-flex items-center gap-1 hover:text-brand-orange transition">
                      Eliminado {orden === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-bold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const checked = selected.has(it.id);
                  return (
                    <tr key={`${it.kind}-${it.id}`} className={cn("border-b border-black/5 dark:border-white/5 last:border-0 transition", checked ? "bg-brand-orange/[0.05]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]")}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={checked} onChange={() => toggleOne(it.id)}
                          className="h-4 w-4 accent-brand-orange rounded cursor-pointer align-middle" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Antes: un <img src=.../raw>, o sea EL ARCHIVO ENTERO para un cuadro
                              de 32 px, y solo para imagenes. Ahora la misma miniatura compartida
                              que el resto del CRM: pide `/thumb`, con carga perezosa, y los PDF
                              borrados tambien la tienen — antes salian siempre con su icono.
                              `/thumb` no filtra por `deleted_at`, asi que sirve la papelera igual
                              que `/raw`, y con la misma ACL. */}
                          {it.kind === "file" ? (
                            <div className="relative h-8 w-8 rounded-lg overflow-hidden bg-neutral-100 shrink-0">
                              <MiniaturaArchivo file={{ id: it.id, nombre: it.nombre, mime: it.mime }} />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-rose-100 text-rose-600">
                              <Folder className="h-4 w-4" strokeWidth={1.8} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[260px]" title={it.nombre}>{it.nombre}</div>
                            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">{it.kind === "folder" ? "Carpeta" : "Archivo"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap">
                        {it.kind === "folder"
                          ? `${it.file_count ?? 0} archivo${it.file_count === 1 ? "" : "s"}`
                          : `${formatBytes(it.size_bytes)} · de ${it.folder_nombre || "?"}`}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap">{it.deleted_by_nombre || "—"}</td>
                      <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap">{new Date(it.deleted_at).toLocaleDateString("es-ES")}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {it.kind === "file" && (
                            <button onClick={() => ver(it)} title="Ver"
                              className="h-8 w-8 rounded-lg bg-white/70 dark:bg-white/5 hover:bg-white text-neutral-500 hover:text-brand-orange flex items-center justify-center transition">
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={() => restoreOne(it)} className="h-8 px-2.5 rounded-lg bg-brand-green/10 hover:bg-brand-green/15 text-brand-green text-[11px] font-bold flex items-center gap-1.5 transition">
                            <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                          </button>
                          <button onClick={() => purgeOne(it)} title="Enviar a cuarentena (Nivel 2)"
                            className="h-8 w-8 rounded-lg hover:bg-brand-red/10 text-neutral-400 hover:text-brand-red flex items-center justify-center transition">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <Pagination page={page} pageSize={TRASH_PAGE_SIZE} total={total} onPageChange={setPage} disabled={loading} className="bg-white dark:bg-neutral-900" />
        </>
        )}
      </motion.div>

      {/* El visor, dentro de la propia papelera. Se le pasan las flechas para que recorran los
          archivos borrados que se estan viendo, en el mismo orden de la tabla. */}
      {archivoEnVisor && verIndice !== null && (
        <FilePreviewModal
          file={{ id: archivoEnVisor.id, nombre: archivoEnVisor.nombre, mime: archivoEnVisor.mime }}
          onClose={() => setVerIndice(null)}
          onPrev={() => setVerIndice((k) => (k === null ? null : Math.max(0, k - 1)))}
          onNext={() => setVerIndice((k) => (k === null ? null : Math.min(archivosVisibles.length - 1, k + 1)))}
          posicion={{ indice: verIndice, total: archivosVisibles.length }}
        />
      )}
    </div>
  );
}

/* ======================================================================== */
/* Subcomponentes visuales                                                  */
/* ======================================================================== */

function SectionHeader({ icon: Icon, label, count }: { icon: any; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-neutral-400" strokeWidth={2.2} />
      <div className="text-[10px] font-ui font-bold uppercase tracking-[0.18em] text-neutral-500">{label}</div>
      <div className="text-[10px] font-ui font-bold text-neutral-400 bg-neutral-100 dark:bg-white/5 px-1.5 rounded-full">{count}</div>
    </div>
  );
}

type Crumb = { id: string; nombre: string; tipo: string };
function crumbLabel(b: Crumb) { return etiquetaDeCarpeta(b as NodoDeArbol); }
function BreadcrumbPath({ crumbs }: { crumbs: Crumb[] }) {
  if (!crumbs?.length) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-neutral-400 truncate">
      {crumbs.map((b, i) => (
        <span key={b.id} className="flex items-center gap-1 shrink-0 truncate">
          {i > 0 && <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
          <span className="truncate max-w-[120px]">{crumbLabel(b)}</span>
        </span>
      ))}
    </div>
  );
}

// Panel de resultados de la búsqueda scopeada (3C): dos grupos (Carpetas / Archivos), cada uno paginado,
// cada resultado con su breadcrumb + botón "ir" (carpeta → abre; archivo → abre su carpeta).
function SearchResults({
  q, scopeName, res, loading, folderPage, filePage, onFolderPage, onFilePage, onGoFolder, onGoFile,
}: {
  q: string;
  scopeName: string;
  res: { folders: { items: any[]; total: number }; files: { items: any[]; total: number } };
  loading: boolean;
  folderPage: number;
  filePage: number;
  onFolderPage: (p: number) => void;
  onFilePage: (p: number) => void;
  onGoFolder: (id: string) => void;
  onGoFile: (folderId: string) => void;
}) {
  const nada = !loading && res.folders.total === 0 && res.files.total === 0;
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm">
        <Search className="h-4 w-4 text-brand-orange" />
        <span className="text-neutral-500">Resultados de <span className="font-bold text-neutral-800 dark:text-neutral-200">“{q}”</span> en <span className="font-bold">{scopeName}</span> y su subárbol</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-orange" />}
      </div>

      {nada ? (
        <div className="py-16 text-center text-sm text-neutral-500">
          <Search className="h-10 w-10 text-neutral-300 mx-auto mb-3" />
          No hay carpetas ni archivos que coincidan con “{q}” en este subárbol.
        </div>
      ) : (
        <>
          {/* Carpetas */}
          <section>
            <SectionHeader icon={Folder} label="Carpetas" count={res.folders.total} />
            {res.folders.items.length > 0 ? (
              <div className="space-y-1">
                {res.folders.items.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition group">
                    <div className="h-8 w-8 rounded-lg bg-neutral-100 dark:bg-white/5 flex items-center justify-center shrink-0">
                      <Folder className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{f.tipo === "users_root" ? "Mi Drive" : f.nombre}</div>
                      <BreadcrumbPath crumbs={(f.breadcrumb || []).slice(0, -1)} />
                    </div>
                    <button onClick={() => onGoFolder(f.id)} className="h-8 px-3 rounded-lg bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-orange text-[11px] font-bold flex items-center gap-1.5 transition">
                      <ArrowUpRight className="h-3.5 w-3.5" /> Ir
                    </button>
                  </div>
                ))}
                <Pagination page={folderPage} pageSize={25} total={res.folders.total} onPageChange={onFolderPage} disabled={loading} />
              </div>
            ) : (
              <div className="text-sm text-neutral-400 py-4">Sin carpetas.</div>
            )}
          </section>

          {/* Archivos */}
          <section>
            <SectionHeader icon={File} label="Archivos" count={res.files.total} />
            {res.files.items.length > 0 ? (
              <div className="space-y-1">
                {res.files.items.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition group">
                    <div className="h-8 w-8 rounded-lg bg-neutral-100 dark:bg-white/5 flex items-center justify-center shrink-0">
                      <File className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{f.nombre}</div>
                      <BreadcrumbPath crumbs={f.breadcrumb || []} />
                    </div>
                    <button onClick={() => onGoFile(f.folder_id)} title="Ir a la carpeta del archivo"
                      className="h-8 px-3 rounded-lg bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-orange text-[11px] font-bold flex items-center gap-1.5 transition">
                      <ArrowUpRight className="h-3.5 w-3.5" /> Ir
                    </button>
                  </div>
                ))}
                <Pagination page={filePage} pageSize={25} total={res.files.total} onPageChange={onFilePage} disabled={loading} />
              </div>
            ) : (
              <div className="text-sm text-neutral-400 py-4">Sin archivos.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Breadcrumbs({ breadcrumbs, onJump }: { breadcrumbs: DriveFolder[]; onJump: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {breadcrumbs.map((b, i) => {
        const v = folderVisual(b.tipo);
        const isLast = i === breadcrumbs.length - 1;
        return (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className="flex items-center gap-1 shrink-0"
          >
            {/* 🔴 La miga activa va con `gradient-orange`, la clase de marca. Antes se componía
                una clase de Tailwind a mano (`"shadow-" + v.gradient.split(" ")[0]...`), y una
                clase construida en tiempo de ejecución **Tailwind no la ve al compilar**: se
                purgaba y no pintaba nada. El único motivo de que se viera algo era el `boxShadow`
                en línea de al lado. Una carpeta de contacto y una de trámite dejan además de
                teñir la barra de un color distinto cada una: la paleta es la del CRM. */}
            <button
              onClick={() => onJump(b.id)}
              className={cn(
                "h-8 px-2.5 rounded-lg flex items-center gap-1.5 font-ui font-bold transition",
                isLast
                  ? "gradient-orange text-white shadow-md shadow-brand-orange/20"
                  : "text-neutral-500 hover:text-brand-orange hover:bg-brand-orange/5 dark:hover:bg-white/5"
              )}
            >
              <v.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {/* La etiqueta de PANTALLA, no el nombre de la base: `users_root` se llama
                  «Usuarios» ahí dentro y aquí es «Mi unidad». Sale de `lib/drive-arbol`, la misma
                  que usa el árbol, para que la carpeta no tenga dos nombres según dónde se mire. */}
              <span className="text-[12px] max-w-[160px] truncate">{etiquetaDeCarpeta(b as NodoDeArbol)}</span>
            </button>
            {!isLast && <ChevronRight className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-700" strokeWidth={2.2} />}
          </motion.div>
        );
      })}
    </div>
  );
}

function FolderTree({
  store, parentId, currentId, onSelect, depth, expanded, onToggle, onLoadMore,
}: {
  store: Map<string | null, TreeEntry>;
  parentId: string | null;
  currentId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  expanded: Set<string>;
  onToggle: (f: DriveFolder) => void;
  onLoadMore: (parentId: string) => void;
}) {
  const entry = store.get(parentId);
  // El primer nivel lleva orden propio (Mi unidad · compañía · contactos); el resto, el del
  // servidor. La decisión vive en `lib/drive-arbol`, que es lo único comprobable sin navegador.
  const list = depth === 0 ? ordenarSecciones(entry?.children ?? []) : (entry?.children || []);
  if (list.length === 0 && !entry?.loading) return null;
  return (
    <div className="space-y-0.5">
      {list.map((f) => {
        const v = folderVisual(f.tipo);
        const active = f.id === currentId;
        const hasChildren = !!f.has_children; // el chevron sale de has_children del server (sobre hijos visibles)
        const isOpen = expanded.has(f.id);
        const childEntry = store.get(f.id);
        return (
          <div key={f.id}>
            <motion.div
              whileHover={{ x: 2 }}
              className={cn(
                "w-full flex items-center gap-1 pr-2 py-2 rounded-xl text-left text-xs font-ui transition group relative overflow-hidden",
                active
                  ? "bg-gradient-to-r " + v.light + " font-bold shadow-sm"
                  : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/80 dark:hover:bg-white/5"
              )}
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className={cn("absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-gradient-to-b", v.gradient)}
                />
              )}
              {hasChildren ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggle(f); }}
                  className="h-5 w-5 rounded-md flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-black/5 dark:hover:bg-white/10 shrink-0 transition"
                  aria-label={isOpen ? "Colapsar" : "Expandir"}
                >
                  {childEntry?.loading
                    ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
                    : <ChevronRight className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")} strokeWidth={2.4} />}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" />
              )}
              {/* El agrupador de clientes no es una carpeta: no tiene id en la base y pedir su
                  contenido daría 404. Pulsarlo solo lo pliega y lo despliega. */}
              <button
                onClick={() => (esNavegable(f as NodoDeArbol) ? onSelect(f.id) : onToggle(f))}
                onDoubleClick={() => hasChildren && onToggle(f)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <div className={cn(
                  "h-6 w-6 rounded-lg flex items-center justify-center shrink-0 transition",
                  active ? "bg-gradient-to-br " + v.gradient + " shadow-md" : "bg-neutral-100 dark:bg-white/5 group-hover:bg-white dark:group-hover:bg-white/10"
                )}>
                  <v.Icon className={cn("h-3 w-3", active ? "text-white" : "text-neutral-500 dark:text-neutral-400")} strokeWidth={2.2} />
                </div>
                <span className={cn("flex-1 truncate", active && "text-neutral-900 dark:text-white")}>{displayName(f)}</span>
              </button>
            </motion.div>
            {hasChildren && isOpen && (
              <FolderTree
                store={store}
                parentId={f.id}
                currentId={currentId}
                onSelect={onSelect}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onLoadMore={onLoadMore}
              />
            )}
          </div>
        );
      })}
      {entry?.hasMore && (
        <button
          onClick={() => parentId && onLoadMore(parentId)}
          disabled={entry.loading}
          className="w-full flex items-center gap-1.5 py-1.5 rounded-lg text-[11px] font-ui font-bold text-brand-orange hover:bg-brand-orange/5 transition disabled:opacity-50"
          style={{ paddingLeft: 6 + depth * 14 + 24 }}
        >
          {entry.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" strokeWidth={2.6} />}
          Cargar más
        </button>
      )}
    </div>
  );
}

// 🔴 AQUÍ VIVÍAN TRES TARJETAS QUE NO DECÍAN NADA, y se fueron en la tanda T1.
// Eran «Drive activo · Cloudflare R2» —lo que Juan Manuel leyó como "Clover R2" y no entendía—,
// «Mi espacio · Listo» (un ternario sobre si existía la carpeta) y «Trámites · Linkeados», un
// literal escrito a mano. Ninguna era accionable: ocupaban el primer golpe de vista de la
// pantalla para no informar de nada. «Eso hay que quitarlo de ahí porque eso no se entiende.»
//
// También se fue el acceso rápido a `Trámites`: es una rama de clientes, y al Drive se viene a
// otra cosa. A los documentos de un caso se entra por su negociación.
function HeroRoot({
  rootFolder, companyFolder, userFolderId, onNavigate,
}: {
  rootFolder?: DriveFolder;
  companyFolder?: DriveFolder;
  userFolderId: string | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <section className="mb-8">
      <SectionHeader icon={TrendingUp} label="Acceso rápido" count={[companyFolder, userFolderId].filter(Boolean).length} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {companyFolder && (
          <QuickTile folder={companyFolder} subtitle="Lo que la empresa comparte con todo el equipo" onClick={() => onNavigate(companyFolder.id)} delay={0} />
        )}
        {userFolderId && (
          <QuickTile
            folder={{ id: userFolderId, nombre: "Mi unidad", parent_id: null, tipo: "user", owner_user_id: null, oportunidad_id: null }}
            subtitle="Tu espacio personal privado"
            onClick={() => onNavigate(userFolderId)}
            delay={0.07}
          />
        )}
      </div>
    </section>
  );
}


function QuickTile({ folder, subtitle, onClick, delay }: { folder: DriveFolder; subtitle: string; onClick: () => void; delay: number }) {
  const v = folderVisual(folder.tipo);
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900 p-5 text-left transition-all shadow-sm hover:shadow-xl"
    >
      {/* Glow */}
      <div className={cn("absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-3xl transition-opacity group-hover:opacity-40", v.gradient)} />

      <div className="relative flex items-start gap-4">
        <motion.div
          whileHover={{ rotate: -5, scale: 1.05 }}
          className={cn("h-12 w-12 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-lg shrink-0", v.gradient)}
          style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.15)" }}
        >
          <v.Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-base font-display font-black truncate">{folder.nombre}</div>
            <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" strokeWidth={2.4} />
          </div>
          <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 mt-0.5">{v.textHint}</div>
          <div className="text-xs text-neutral-500 font-ui mt-2 line-clamp-2">{subtitle}</div>
        </div>
      </div>
    </motion.button>
  );
}

/**
 * Elegir a dónde se mueven los archivos marcados.
 *
 * 🔴 NO PIDE TECLEAR UNA PALABRA, y es a propósito. La palabra escrita de §10.7 está para lo
 * inmediato E IRREVERSIBLE; mover se deshace moviendo de vuelta, y la bitácora guarda de dónde
 * salió cada archivo. Pedirla aquí enseñaría a teclearla sin leer, que es exactamente cómo se
 * erosiona el guardarraíl en el sitio donde sí hace falta.
 *
 * Lo que sí hace es enseñar el alcance antes de aplicar: cuántos archivos y a qué carpeta.
 *
 * Reutiliza `FolderTree`, el mismo árbol del panel lateral, con su propio almacén. Escribir aquí
 * un segundo árbol sería tener dos opiniones sobre qué carpetas existen y cuáles se ven.
 */
function MoverArchivosModal({
  cantidad, onCerrar, onMover,
}: {
  cantidad: number;
  onCerrar: () => void;
  onMover: (destino: DriveFolder) => Promise<void>;
}) {
  const [store, setStore] = useState<Map<string | null, TreeEntry>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState<DriveFolder | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const porId = useRef<Map<string, DriveFolder>>(new Map());

  const recordar = useCallback((fs: DriveFolder[]) => {
    for (const f of fs) porId.current.set(f.id, f);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/drive/tree/path");
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        const n = new Map<string | null, TreeEntry>();
        if (d.root) {
          n.set(null, { children: [d.root], total: 1, hasMore: false, page: 1, loading: false });
          recordar([d.root]);
        }
        for (const [pid, e] of Object.entries<any>(d.preload || {})) {
          n.set(pid, { children: e.children || [], total: e.total || 0, hasMore: !!e.hasMore, page: 1, loading: false });
          recordar(e.children || []);
        }
        setStore(n);
        if (d.root) setExpanded(new Set([d.root.id]));
      } catch { toast.error("No se pudo cargar el árbol de carpetas"); }
    })();
  }, [recordar]);

  const alternar = useCallback(async (nodo: DriveFolder) => {
    const abrir = !expanded.has(nodo.id);
    setExpanded((prev) => { const n = new Set(prev); abrir ? n.add(nodo.id) : n.delete(nodo.id); return n; });
    if (!abrir || store.has(nodo.id)) return;
    try {
      const r = await fetch(`/api/drive/tree/children?parent_id=${encodeURIComponent(nodo.id)}&page=1&pageSize=${TREE_PAGE_SIZE}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      recordar(d.children || []);
      setStore((prev) => new Map(prev).set(nodo.id, {
        children: d.children || [], total: d.total || 0, hasMore: !!d.hasMore, page: 1, loading: false,
      }));
    } catch { toast.error("No se pudieron cargar las subcarpetas"); }
  }, [expanded, store, recordar]);

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCerrar}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="text-sm font-display font-black">Mover {cantidad} archivo{cantidad === 1 ? "" : "s"}</div>
          <div className="text-[11px] text-neutral-500 font-ui mt-0.5">Elige la carpeta de destino</div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
          <FolderTree
            store={store}
            parentId={null}
            currentId={destino?.id ?? null}
            onSelect={(id) => setDestino(porId.current.get(id) ?? null)}
            depth={0}
            expanded={expanded}
            onToggle={alternar}
            onLoadMore={() => { /* el selector no pagina: para eso está el buscador del Drive */ }}
          />
        </div>

        <div className="px-5 py-4 border-t border-black/5 dark:border-white/5 flex items-center gap-2">
          <div className="flex-1 text-xs text-neutral-600 dark:text-neutral-300 min-w-0">
            {destino
              ? <span><b>{cantidad}</b> a <b className="text-brand-orange">{etiquetaDeCarpeta(destino as NodoDeArbol)}</b></span>
              : <span className="text-neutral-400">Ninguna carpeta elegida todavía</span>}
          </div>
          <button onClick={onCerrar} className="h-9 px-3 rounded-xl text-xs font-ui font-bold text-neutral-500 hover:bg-black/5 transition">Cancelar</button>
          <button
            disabled={!destino || aplicando || !esNavegable(destino as NodoDeArbol)}
            onClick={async () => { if (!destino) return; setAplicando(true); try { await onMover(destino); } finally { setAplicando(false); } }}
            className="h-9 px-4 rounded-xl gradient-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition flex items-center gap-1.5"
          >
            {aplicando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Mover
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Una subcarpeta EN LA VISTA DE LISTA, con su flechita para desplegarla en el sitio.
 *
 * Es lo que se pidió el 2026-08-24: ver lo que hay dentro sin entrar, y poder tener varias
 * abiertas a la vez para comparar. En mosaico no aplica —ahí se entra— y por eso esta fila solo
 * la usa la vista de lista.
 *
 * ⚠️ La flechita y el nombre son DOS botones. Pulsar el nombre entra en la carpeta, como siempre;
 * pulsar la flechita despliega. Si fuera uno solo, quien quiere entrar acabaría desplegando y al
 * revés, y no hay forma de deshacer esa ambigüedad con un único objetivo.
 */
function SubcarpetaFila({
  folder, index, abierta, cargando, archivos, onAlternar, onAbrir, onPreview, onDownload, onCompartir, compartida,
  archivosCompartidos, onDestacar, onRenombrar, onEliminar,
}: {
  folder: DriveFolder;
  index: number;
  abierta: boolean;
  cargando: boolean;
  onCompartir?: () => void;
  compartida?: boolean;
  onDestacar?: () => void;
  onRenombrar?: () => void;
  onEliminar?: () => void;
  /** Los archivos que YO he compartido, para marcar también los que asoman al desplegar. Se pasa
   *  el conjunto entero y no un booleano porque estas filas se pintan aquí dentro. */
  archivosCompartidos?: Set<string>;
  archivos: { file: DriveFile; indice: number }[];
  onAlternar: () => void;
  onAbrir: () => void;
  onPreview: (indice: number) => void;
  onDownload: (f: DriveFile) => void;
}) {
  const v = folderVisual(folder.tipo);
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.02, duration: 0.25 }}
        className="group flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.03] transition border border-transparent hover:border-black/5 dark:hover:border-white/5"
      >
        <button
          onClick={onAlternar}
          aria-label={abierta ? `Plegar ${folder.nombre}` : `Desplegar ${folder.nombre}`}
          aria-expanded={abierta}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-brand-orange hover:bg-brand-orange/10 shrink-0 transition"
        >
          {cargando
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
            : <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", abierta && "rotate-90")} strokeWidth={2.4} />}
        </button>
        <button onClick={onAbrir} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div className={cn("relative h-9 w-9 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-sm shrink-0", v.gradient)}>
            <v.Icon className="h-4 w-4 text-white" strokeWidth={2.2} />
            {/* En lista, abajo a la izquierda. Sustituye al «muñequito» que iba junto al nombre. */}
            {compartida && <MarcaCompartido esquina="abajo" />}
          </div>
          <span className="truncate text-sm font-bold">{folder.nombre}</span>
        </button>
        {/* El mismo menú que la tarjeta del mosaico. Antes aquí solo había un botón de compartir
            al pasar el ratón: en lista, una carpeta no se podía ni destacar ni renombrar. */}
        <MenuDeAcciones
          variante="fila"
          etiqueta={folder.nombre}
          acciones={accionesDeCarpeta({
            onOpen: onAbrir,
            onCompartir,
            onDestacar,
            onRename: onRenombrar,
            onDelete: onEliminar,
          })}
        />
      </motion.div>

      {abierta && (
        <div className="ml-9 pl-3 border-l-2 border-brand-orange/20 space-y-1 mb-1">
          {archivos.length === 0 && !cargando ? (
            /* Se dice que está vacía. El silencio no distingue "no tiene nada" de "no cargó". */
            <div className="px-3 py-2 text-xs text-neutral-400 italic">Esta carpeta no tiene archivos</div>
          ) : (
            archivos.map((a, i) => (
              <FileRow
                key={a.file.id}
                file={a.file}
                index={i}
                compartido={archivosCompartidos?.has(a.file.id)}
                onDownload={() => onDownload(a.file)}
                onPreview={() => onPreview(a.indice)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FolderCard({ folder, index, onOpen, onRename, onDelete, onCompartir, onDestacar, compartida }: { folder: DriveFolder; index: number; onOpen: () => void; onRename?: () => void; onDelete?: () => void; onCompartir?: () => void; onDestacar?: () => void; compartida?: boolean }) {
  const v = folderVisual(folder.tipo);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.025, duration: 0.3, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-2xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900 cursor-pointer shadow-sm hover:shadow-xl transition-all"
      onDoubleClick={onOpen}
    >
      <div className={cn("absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-0 blur-2xl transition-opacity group-hover:opacity-25", v.gradient)} />
      <button onClick={onOpen} className="relative w-full p-4 text-left">
        <div className="flex items-start gap-3">
          {/* La marca se monta en el vértice del icono, no encima: un cuadro de 44 px tapado por
              un distintivo de 20 px deja de leerse como carpeta. */}
          <div className="relative shrink-0">
            <motion.div
              whileHover={{ rotate: -4 }}
              className={cn("h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", v.gradient)}
            >
              <v.Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
            </motion.div>
            {compartida && <MarcaCompartido esquina="arriba" className="-top-1.5 -left-1.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* El «muñequito de que se compartió» (2026-08-24) ya no va aquí: lo sustituye la
                  marca sobre el icono, pedida el 2026-08-25. Es la misma señal, y dos veces en la
                  misma fila es ruido. */}
              <span className="text-sm font-display font-bold truncate">{folder.nombre}</span>
            </div>
            <div className="text-[10px] text-neutral-400 font-ui font-bold uppercase tracking-wider mt-0.5">
              {compartida ? "Compartida" : v.textHint}
            </div>
          </div>
        </div>
      </button>

      <MenuDeAcciones
        variante="tarjeta"
        etiqueta={folder.nombre}
        acciones={accionesDeCarpeta({ onOpen, onCompartir, onDestacar, onRename, onDelete })}
      />
    </motion.div>
  );
}

function FileRow({ file, index, onDownload, onPreview, onRename, onDelete, seleccionado, onSeleccionar, onCompartir, onDestacar, compartido }: { file: DriveFile; index: number; onDownload: () => void; onPreview: () => void; onRename?: () => void; onDelete?: () => void; seleccionado?: boolean; onSeleccionar?: () => void; onCompartir?: () => void; onDestacar?: () => void; compartido?: boolean }) {
  const v = fileVisual(file.mime, file.nombre);
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02, duration: 0.25 }}
      className={cn(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition border",
        seleccionado
          ? "bg-brand-orange/5 border-brand-orange/30"
          : "border-transparent hover:bg-gradient-to-r hover:from-neutral-50 hover:to-white dark:hover:from-white/[0.03] dark:hover:to-transparent hover:border-black/5 dark:hover:border-white/5"
      )}
    >
      {/* La casilla solo aparece donde se puede mover: los archivos de la carpeta abierta. Los que
          asoman de una subcarpeta desplegada se ven, pero su origen es otro y no se marcan. */}
      {onSeleccionar && (
        <input
          type="checkbox"
          checked={!!seleccionado}
          onChange={onSeleccionar}
          aria-label={`Seleccionar ${file.nombre}`}
          className="h-4 w-4 shrink-0 accent-[color:var(--brand-orange)] cursor-pointer"
        />
      )}
      {/* Icon con gradient. La miniatura pasa por el componente compartido: antes pedia `/raw`,
          o sea EL ARCHIVO ENTERO para pintar 40 px. `superponerAlPasar` conserva el efecto que
          ya tenia esta fila —la imagen se tapa con el gradiente y el icono al pasar el raton—,
          y ahora los PDF tambien traen miniatura, que antes no tenian. */}
      <div className="relative h-10 w-10 rounded-xl overflow-hidden shrink-0 shadow-sm">
        <MiniaturaArchivo file={file} superponerAlPasar />
        {/* En lista, abajo a la izquierda: arriba se solaparía con el borde de la fila. */}
        {compartido && <MarcaCompartido esquina="abajo" />}
      </div>

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onPreview}>
        <div className="text-sm font-ui font-bold truncate group-hover:text-brand-orange transition">{file.nombre}</div>
        <div className="text-[10px] text-neutral-500 flex items-center gap-2 mt-0.5 font-ui">
          <span className="px-1.5 rounded-full bg-neutral-100 dark:bg-white/5 font-bold tracking-wide text-[9px]">{v.label}</span>
          <span>{formatBytes(file.size_bytes)}</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> {relDate(file.created_at)}</span>
          {file.uploader_nombre && (
            <>
              <span className="hidden md:inline">·</span>
              <span className="hidden md:inline truncate">{file.uploader_nombre}</span>
            </>
          )}
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={onPreview}
        className="h-8 px-3 rounded-lg text-xs font-ui font-bold text-brand-orange hover:bg-brand-orange/10 opacity-0 group-hover:opacity-100 transition flex items-center gap-1.5 shadow-sm border border-transparent hover:border-brand-orange/30"
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={2.2} /> Ver
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={onDownload}
        className="h-8 px-3 rounded-lg text-xs font-ui font-bold text-neutral-600 dark:text-neutral-300 hover:bg-white dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition flex items-center gap-1.5 shadow-sm border border-transparent hover:border-black/5"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.2} /> Descargar
      </motion.button>

      <MenuDeAcciones
        variante="fila"
        etiqueta={file.nombre}
        acciones={accionesDeArchivo({ onPreview, onDownload, onCompartir, onDestacar, onRename, onDelete })}
      />
    </motion.div>
  );
}

function FileCard({ file, index, onDownload, onPreview, onRename, onDelete, onCompartir, onDestacar, compartido }: { file: DriveFile; index: number; onDownload: () => void; onPreview: () => void; onRename?: () => void; onDelete?: () => void; onCompartir?: () => void; onDestacar?: () => void; compartido?: boolean }) {
  const v = fileVisual(file.mime, file.nombre);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.3 }}
      whileHover={{ y: -3 }}
      className="group relative overflow-hidden rounded-2xl border border-black/5 dark:border-white/5 bg-white dark:bg-neutral-900 shadow-sm hover:shadow-xl transition-all"
    >
      <div className="aspect-[4/3] relative overflow-hidden bg-neutral-50 dark:bg-white/[0.02] cursor-pointer" onClick={onPreview}>
        {/* Antes pedia `/raw` —el archivo entero— para una tarjeta. El respaldo se pasa TAL CUAL
            estaba, animacion incluida: lo que se comparte es la decision y la peticion, no el
            adorno, para que esta pantalla no cambie de aspecto. */}
        <MiniaturaArchivo
          file={file}
          fallback={
          <>
            <div className={cn("absolute inset-0 bg-gradient-to-br opacity-10", v.gradient)} />
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                whileHover={{ scale: 1.08, rotate: -3 }}
                className={cn("h-16 w-16 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-xl", v.gradient)}
                style={{ boxShadow: "0 12px 30px rgba(0,0,0,0.18)" }}
              >
                <v.Icon className="h-7 w-7 text-white" strokeWidth={2} />
              </motion.div>
            </div>
            {/* La etiqueta del formato baja a la esquina de abajo: arriba a la izquierda es
                ahora el sitio de la marca de compartido, y las dos ahí se pisan. */}
            <div className="absolute bottom-2 left-2 text-[9px] font-ui font-bold text-white/90 bg-black/30 backdrop-blur px-1.5 rounded-full tracking-wider">{v.label}</div>
          </>
          }
        />
        {compartido && <MarcaCompartido esquina="arriba" className="top-2 left-2" />}
      </div>
      <div className="p-3">
        <div className="text-xs font-ui font-bold truncate">{file.nombre}</div>
        <div className="text-[10px] text-neutral-500 font-ui mt-0.5">{formatBytes(file.size_bytes)} · {relDate(file.created_at)}</div>
      </div>

      <MenuDeAcciones
        variante="tarjeta"
        etiqueta={file.nombre}
        acciones={accionesDeArchivo({ onPreview, onDownload, onCompartir, onDestacar, onRename, onDelete })}
      />
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// EL DIBUJO DE LAS ACCIONES
//
// QUÉ se puede hacer y CÓMO se llama vive en `lib/drive-acciones`, con sus pruebas. Aquí solo está
// lo que no se puede probar sin navegador: qué icono le toca a cada una y cómo se pinta el menú.
//
// El mapa es un `Record<ClaveAccion, ...>` a propósito: si mañana se añade una acción a la lista y
// nadie le da icono, **no compila**. Un `?? algo` aquí sería un icono genérico en producción y
// nadie se enteraría.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const ICONO_DE_ACCION: Record<ClaveAccion, any> = {
  ver: Eye,
  abrir: Eye,
  descargar: Download,
  compartir: Share2,
  destacar: Star,
  renombrar: Edit,
  papelera: Trash2,
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// EL MENÚ «…» — botón, estado y desplegable, en un solo sitio
//
// 🔴 EL FALLO QUE ARREGLA (2026-08-25): «cuando el mouse pasa por el archivo se despliegan solas
// las opciones… y sigue titilando abriendo y cerrando en intervalos de medio segundo».
//
// La causa: el desplegable estaba DENTRO de un contenedor `opacity-0 group-hover:opacity-100`.
// Al salir el ratón, el contenedor se desvanecía pero el menú seguía ABIERTO —solo que
// invisible—, así que al volver a pasar por encima reaparecía «solo». Y peor: un elemento con
// `opacity: 0` **sigue recibiendo el ratón**, así que la capa `fixed inset-0` que cierra el menú
// seguía ahí, tapando la pantalla entera e invisible. Como esa capa es hija de la tarjeta, el
// navegador la contaba como «ratón encima» y el `group-hover` se realimentaba consigo mismo: ese
// era el parpadeo de medio segundo, que no era la animación sino el bucle.
//
// La regla, en una frase: **mientras el menú está abierto, su contenedor se ve pase lo que pase**;
// y mientras está cerrado no recibe el ratón (`pointer-events-none`), para que un botón invisible
// no se trague clics.
//
// Está aquí y no repetido en las cuatro tarjetas y filas por lo de siempre (§4.8): eran cuatro
// copias del mismo desplegable y el fallo vivía en dos de ellas. Ahora la interacción es una.
// ══════════════════════════════════════════════════════════════════════════════════════════════

function MenuDeAcciones({ acciones, variante, etiqueta }: {
  acciones: AccionDrive[];
  /** `tarjeta` se coloca solo en la esquina; `fila` va en el flujo, al final de la fila. */
  variante: "tarjeta" | "fila";
  /** El nombre de la cosa, para quien navega con lector de pantalla. */
  etiqueta: string;
}) {
  const [abierto, setAbierto] = useState(false);

  // Sin nada que ofrecer no se pinta el botón: un «…» que abre un menú vacío es peor que no estar.
  if (acciones.length === 0) return null;

  return (
    <div
      className={cn(
        "transition",
        variante === "tarjeta" ? "absolute top-2 right-2 z-20" : "relative shrink-0",
        // 🔴 la regla que arregla el parpadeo, con su prueba en `lib/drive-acciones`
        clasesDelContenedorDeMenu(abierto)
      )}
    >
      <div className={variante === "tarjeta" ? "relative" : ""}>
        <button
          onClick={(e) => { e.stopPropagation(); setAbierto((v) => !v); }}
          title="Más opciones"
          aria-label={`Opciones de ${etiqueta}`}
          aria-expanded={abierto}
          className={cn(
            "rounded-lg flex items-center justify-center transition",
            variante === "tarjeta"
              ? "h-7 w-7 bg-white/90 dark:bg-neutral-800/90 backdrop-blur shadow hover:bg-white dark:hover:bg-neutral-700 border border-black/5"
              : "h-8 w-8 hover:bg-neutral-100 dark:hover:bg-white/5"
          )}
        >
          <MoreHorizontal className={variante === "tarjeta" ? "h-3.5 w-3.5 text-neutral-600" : "h-4 w-4 text-neutral-500"} />
        </button>
        {abierto && (
          <>
            {/* La capa que cierra al pulsar fuera. Solo existe con el menú abierto: antes vivía
                dentro del contenedor que se desvanecía, y quedaba invisible pero activa. */}
            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setAbierto(false); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-black/5 dark:border-white/10 w-52 py-1"
            >
              <MenuDeArchivo acciones={acciones} alElegir={() => setAbierto(false)} />
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}

/** Las acciones, como lista de opciones. Lo usa el menú de arriba. */
function MenuDeArchivo({ acciones, alElegir }: { acciones: AccionDrive[]; alElegir: () => void }) {
  return (
    <>
      {acciones.map((a) => (
        <MenuItem
          key={a.clave}
          icon={ICONO_DE_ACCION[a.clave]}
          label={a.label}
          danger={a.danger}
          onClick={() => { alElegir(); a.onClick(); }}
        />
      ))}
    </>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2 text-xs font-ui font-semibold text-left flex items-center gap-2 transition",
        danger
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
          : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/5"
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} /> {label}
    </button>
  );
}

function EmptyState({ onUpload, ready }: { onUpload: () => void; ready: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="py-16 flex flex-col items-center justify-center gap-4 text-center"
    >
      <div className="relative">
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="relative h-24 w-24 rounded-3xl bg-gradient-to-br from-brand-orange/20 via-pink-500/15 to-purple-500/15 flex items-center justify-center"
        >
          <FolderOpen className="h-12 w-12 text-brand-orange" strokeWidth={1.5} />
        </motion.div>
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-3xl bg-gradient-to-br from-brand-orange/30 to-purple-500/30 blur-2xl -z-10"
        />
      </div>
      <div>
        <div className="text-base font-display font-black">Carpeta vacía</div>
        <div className="text-xs text-neutral-500 font-ui mt-1">Arrastrá archivos aquí o usá el botón Subir</div>
      </div>
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onUpload}
        disabled={!ready}
        className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-orange-500/30 disabled:opacity-40 transition"
      >
        <Upload className="h-3.5 w-3.5" strokeWidth={2.4} /> Subir archivo
      </motion.button>
    </motion.div>
  );
}

// =============================================================================
// FilePreviewModal — preview inline para PDF/imagen, extracción de texto para
// Word/Excel/CSV/JSON/HTML. Para PowerPoint y desconocidos, fallback a download.
// =============================================================================
/**
 * El visor de un archivo. 🔴 ES EL UNICO DEL PROYECTO, y esto es reciente.
 *
 * Hasta la tanda D2 habia DOS, y no eran el mismo peor hecho: esta modal extraia Word, Excel y
 * PowerPoint **en el servidor** (`/extract`), y la pagina `/view` —529 lineas, pestania nueva—
 * reproducia **video y audio** y pintaba **CSV**, que esta no sabia hacer. Fusionarlos fue fusionar
 * dos conjuntos de capacidades; la clasificacion vive en `lib/visor-archivo.ts`, con pruebas,
 * porque la forma de estropearlo no da error: una extension en la rama equivocada y el chat deja de
 * reproducir notas de voz sin que nada falle.
 *
 * 🔴 ACEPTA ARCHIVOS QUE NO SON DEL DRIVE. Lo que llega puede traer `url` (chat, `/uploads/`) o
 * solo `id` (Drive), y se normaliza aqui dentro a una sola forma. La diferencia que importa es que
 * **sin `id` no hay a quien pedirle la conversion de un Word**, asi que para ofimatica sin id se
 * ofrece descargar y se dice por que. No se finge una vista previa que no existe: eso es justo lo
 * que hacia `/view` con los visores de Microsoft y Google, que **no funcionaban** —esas rutas
 * exigen sesion y esos servidores recibian un 401— y de paso mandaban la URL interna del CRM a dos
 * terceros en cada apertura de un `.pptx`.
 *
 * `onPrev`, `onNext` y `posicion` son OPCIONALES: sin ellos no se pinta ningun control de
 * navegacion, y quien tenga una lista detras se apunta pasandolos.
 *
 * ⚠️ La navegacion es POR BOTONES VISIBLES, no por teclado. Cuando el archivo es un PDF, dentro del
 * `<iframe>` manda el visor nativo de Chrome y **se queda con las teclas**: alli las flechas pasan
 * de pagina del PDF, no de documento.
 */
export function FilePreviewModal({ file, onClose, onPrev, onNext, posicion, acciones }: {
  /**
   * El archivo. Dos formas validas y se distinguen por `url`:
   *   · un `DriveFile` (trae `id`, no trae `url`) → la URL se compone y hay extraccion en servidor;
   *   · un origen suelto (trae `url`) → chat, `/uploads/`, o cualquier cosa que no sea del Drive.
   * La papelera del Drive trae las dos: `id` y por tanto todo lo de arriba.
   */
  file: {
    id?: string; url?: string; nombre: string; mime: string | null; size_bytes?: number | string | null;
    /**
     * URL alternativa para el boton de Descargar, cuando la de la vista previa no fuerza la
     * descarga. La usan los adjuntos de correo, que sirven inline por defecto y necesitan `?dl=1`.
     */
    urlDescarga?: string;
  };
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  posicion?: { indice: number; total: number };
  /**
   * Qué se puede hacer con el archivo, desde el propio visor. **Opcional**: el chat, el correo,
   * las tareas y la papelera montan este mismo visor y no tienen —ni deben tener— compartir o
   * destacar. Si no llega, la cabecera queda como estaba.
   */
  acciones?: AccionDrive[];
}) {
  const [loading, setLoading] = useState(true);
  const [extracted, setExtracted] = useState<{
    kind: string;
    text?: string | null;
    html?: string | null;
    sheets?: { name: string; html: string; rows: number; cols: number }[];
    slides?: { number: number; title: string; content: string[] }[];
    total_slides?: number;
    truncated?: boolean;
    hint?: string;
  } | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Una sola forma, calculada una vez. `url` manda: si viene, el archivo no es del Drive.
  const origen: OrigenArchivo = {
    url: file.url || `/api/drive/files/${file.id}/raw`,
    nombre: file.nombre,
    mime: file.mime ?? null,
    // Las dos ramas de aqui eran identicas (`file.url ? file.id : file.id`): un ternario que no
    // decidia nada. Un archivo suelto no trae `id`, asi que pasarlo tal cual dice lo mismo sin
    // insinuar una condicion que no existe.
    id: file.id,
  };
  const modo = clasificarParaVisor(origen);

  // Un archivo del Drive se descarga por su ruta, que fuerza el `Content-Disposition`; uno suelto,
  // por su propia URL.
  const hrefDescarga = file.urlDescarga || (origen.id ? `/api/drive/files/${origen.id}/download` : origen.url);

  // `modo` sustituye a las tres banderas que habia aqui (`isPdf`, `isImg`, `useNativeView`): la
  // clasificacion entera vive en `lib/visor-archivo.ts` y tiene pruebas.

  // ════════════════════════════════════════════════════════════════════════════════════════
  // ESCAPE CIERRA EL VISOR
  // ════════════════════════════════════════════════════════════════════════════════════════
  // No lo hacia hasta ahora, y no era un olvido: se aplazo a conciencia porque esta modal la
  // comparten el Drive y la ficha del contacto, y porque el teclado aqui tiene una trampa.
  //
  // 🔴 LA TRAMPA, DICHA ANTES DE QUE ALGUIEN LA DESCUBRA: cuando el archivo es un PDF, dentro del
  // <iframe> manda el visor nativo de Chrome. Ese visor no es HTML normal — es un plugin — y las
  // teclas que recibe **no suben al documento de fuera**. Asi que si el foco esta DENTRO del PDF
  // (por ejemplo tras hacer clic en el para hacer scroll), este listener no se entera y Escape no
  // cierra. Fuera del PDF —que es donde esta el foco nada mas abrir— si funciona.
  //
  // No se intenta rodear: meter la mano en el iframe del visor de Chrome no se puede, y simular
  // que si con un `focus()` periodico romperia el scroll del PDF. La X y el clic fuera siguen
  // estando y funcionan siempre.
  //
  // ⚠️ Las FLECHAS del teclado NO se anaden. Ahi dentro pasan de pagina del PDF, que es la
  // mayoria de lo que se guarda: un atajo que funciona con una imagen y falla con un PDF es un
  // verde falso. Los botones visibles son el mecanismo.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onClose]);

  // Los controles existen si quien llama sabe navegar; el que esten habilitados lo dice
  // `posicion`. Sin `posicion` no se desactivan: quien pasa los callbacks y no la posicion
  // sabra lo que hace, y es mejor un boton de mas que uno bloqueado sin motivo visible.
  const navegable = !!(onPrev || onNext);
  const hayAnterior = !!onPrev && (!posicion || posicion.indice > 0);
  const haySiguiente = !!onNext && (!posicion || posicion.indice < posicion.total - 1);

  // 🔴 Al cambiar de archivo se limpia TODO el estado del anterior, `extracted` incluido.
  // Antes no hacia falta porque el modal se cerraba entre archivo y archivo; ahora se puede
  // saltar de uno a otro sin cerrarlo, y sin esto el texto extraido del anterior se quedaria
  // pintado debajo del nombre del nuevo. El caso que mas canta es un .docx seguido de un PDF:
  // la rama nativa sale antes del `fetch` y nunca llegaria a borrarlo.
  useEffect(() => {
    setExtracted(null);
    setTexto(null);
    setError(null);
    let cancelled = false;

    // 1 · Ofimatica con id: lo convierte el servidor.
    if (modo === "extraccion") {
      setLoading(true);
      fetch(`/api/drive/files/${origen.id}/extract`)
        .then((r) => r.json())
        .then((d) => { if (cancelled) return; if (d.error) setError(d.error); else setExtracted(d); })
        .catch((e) => { if (!cancelled) setError(e.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    // 2 · CSV y texto: se bajan tal cual. Es lo que hacia `/view`, y no hace falta servidor.
    if (necesitaTexto(modo)) {
      setLoading(true);
      fetch(origen.url)
        .then((r) => { if (!r.ok) throw new Error(`No se pudo leer el archivo (HTTP ${r.status})`); return r.text(); })
        .then((t) => { if (!cancelled) setTexto(t); })
        .catch((e) => { if (!cancelled) setError(e.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    // 3 · PDF, imagen, video, audio y descarga: los pinta el navegador, sin pedir nada aqui.
    setLoading(false);
    return () => { cancelled = true; };
  }, [origen.id, origen.url, modo]);

  // ════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 EL VISOR SE MONTA EN <body>, NO DONDE LO LLAMEN
  // ════════════════════════════════════════════════════════════════════════════════════════
  // `position: fixed` NO significa «contra la ventana» si algun ancestro tiene `transform`,
  // `filter`, `will-change` o **`backdrop-filter`**: en ese caso el ancestro pasa a ser el bloque
  // contenedor y el visor se mide contra EL.
  //
  // Visto en staging: abrir un PDF desde el chat de una tarea pintaba el visor dentro de la
  // burbuja del mensaje —240 px de ancho, recortado ademas por el scroll del chat—, en vez de a
  // pantalla completa. La culpa es de `.glass-bubble-me` / `.glass-bubble-other`
  // (`globals.css:751` y `:809`), que llevan `backdrop-filter: blur(...)` porque el chat es de
  // cristal. No es un caso raro: `MessageActions` y `ChatComposer` ya montan sus capas con
  // `createPortal` por exactamente esto.
  //
  // 🔴 EL ARREGLO VA AQUI Y NO EN QUIEN LLAMA. Un visor a pantalla completa tiene que garantizar
  // por si mismo que lo es; si la solucion vive en el que lo monta, el siguiente que lo ponga bajo
  // un cristal reabre el defecto sin enterarse.
  //
  // ⚠️ Los eventos de React SIGUEN subiendo por el arbol de React, no por el del DOM, asi que
  // quien envuelva este visor sigue recibiendo sus clics igual que antes del portal.
  //
  // `montado` existe porque en el render del servidor no hay `document`.
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado) return null;

  return createPortal(
    <div
      // ⚠️ LA CAPA NO ES LIBRE, tiene que caer entre dos cosas:
      //   · POR ENCIMA de cualquier modal que pueda abrirlo (`z-50`: ficha de tarea, de contacto)
      //     y del lightbox de imagenes del chat (`z-[90]`);
      //   · POR DEBAJO de la pila de llamadas (`z-[99]` saliente, `z-[100]` entrante, `z-[105]` y
      //     `z-[120]`). Una llamada entrante NO puede quedar tapada por un documento abierto.
      // Con `z-50` no ganaba al modal que lo abre mas que por orden del documento, que es un
      // empate que se rompe solo con mover una linea.
      className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-[min(960px,94vw)] h-[94vh] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-black/5 dark:border-white/5">
          {/* 🔴 Se DESACTIVAN en los extremos, no se esconden: un boton que aparece y desaparece
              hace bailar la cabecera y mueve el resto de controles bajo el cursor. */}
          {navegable && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onPrev}
                disabled={!hayAnterior}
                title={hayAnterior ? "Documento anterior" : "Ya estas en el primero"}
                className="h-8 w-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="h-4 w-4 text-neutral-500" />
              </button>
              {posicion && (
                <span className="text-[11px] font-ui font-bold text-neutral-500 tabular-nums whitespace-nowrap px-0.5">
                  {posicion.indice + 1} / {posicion.total}
                </span>
              )}
              <button
                onClick={onNext}
                disabled={!haySiguiente}
                title={haySiguiente ? "Documento siguiente" : "Ya estas en el ultimo"}
                className="h-8 w-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronRight className="h-4 w-4 text-neutral-500" />
              </button>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-base truncate">{origen.nombre}</h3>
            <p className="text-[11px] text-neutral-500 font-ui">
              {/* El tamanio solo lo trae el Drive; un archivo del chat no lo sabe. */}
              {(origen.mime || "—")}{file.size_bytes != null && ` · ${formatBytes(file.size_bytes)}`}
            </p>
          </div>
          {/* Las mismas acciones que el menú de la fila y el de la tarjeta, aquí como botones:
              dentro del visor un desplegable sobra, ya se está mirando el archivo. */}
          {(acciones ?? []).map((accion) => {
            const Icono = ICONO_DE_ACCION[accion.clave];
            return (
              <button
                key={accion.clave}
                onClick={accion.onClick}
                title={accion.label}
                aria-label={accion.label}
                className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition",
                  accion.danger
                    ? "text-brand-red hover:bg-red-50 dark:hover:bg-red-900/10"
                    : "text-neutral-500 hover:text-brand-orange hover:bg-neutral-100 dark:hover:bg-white/5"
                )}
              >
                <Icono className="h-4 w-4" strokeWidth={2.2} />
              </button>
            );
          })}
          <a
            href={hrefDescarga}
            target="_blank"
            rel="noopener noreferrer"
            className="h-8 px-3 rounded-lg text-xs font-ui font-bold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center gap-1.5 border border-black/10"
          >
            <Download className="h-3.5 w-3.5" /> Descargar
          </a>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center"
          >
            <X className="h-4 w-4 text-neutral-500" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-black/30">
          {loading && (
            <div className="h-96 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
            </div>
          )}
          {!loading && error && (
            <div className="h-96 flex flex-col items-center justify-center gap-2 text-center px-6">
              <AlertCircle className="h-10 w-10 text-red-500" />
              <p className="text-sm font-bold">Error cargando preview</p>
              <p className="text-xs text-neutral-500 max-w-md">{error}</p>
            </div>
          )}
          {!loading && !error && modo === "pdf" && (
            <PDFPreview url={origen.url} />
          )}
          {!loading && !error && modo === "imagen" && (
            <ImagePreview url={origen.url} fileName={origen.nombre} />
          )}

          {/* 🔴 VIDEO Y AUDIO — las capacidades que solo tenia `/view`. Sin estas dos ramas, migrar
              el chat a esta modal le habria quitado la reproduccion de notas de voz sin que nada
              fallara: una regresion disfrazada de refactor. */}
          {!loading && !error && modo === "video" && (
            <div className="h-full flex items-center justify-center bg-black p-4">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={origen.url} controls className="max-w-full max-h-full rounded-xl" />
            </div>
          )}
          {!loading && !error && modo === "audio" && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-xl">
                <FileAudio className="h-7 w-7 text-white" strokeWidth={2} />
              </div>
              <p className="text-sm font-bold text-neutral-700 dark:text-neutral-200 text-center break-all max-w-md">{origen.nombre}</p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio src={origen.url} controls className="w-full max-w-2xl" />
            </div>
          )}

          {/* CSV como tabla. El recorte a 500 filas se AVISA: uno silencioso haria creer que el
              archivo tiene menos datos de los que tiene. */}
          {!loading && !error && modo === "csv" && texto !== null && (
            <CsvPreview contenido={texto} />
          )}
          {!loading && !error && modo === "html" && texto !== null && (
            <HtmlPreview html={texto} />
          )}
          {!loading && !error && modo === "texto" && texto !== null && (
            <pre className="p-6 text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-200">
              {texto}
            </pre>
          )}

          {!loading && !error && extracted && extracted.kind === "xlsx" && extracted.sheets && (
            <ExcelPreview sheets={extracted.sheets} />
          )}
          {!loading && !error && extracted && extracted.kind === "docx" && extracted.html && (
            <WordPreview html={extracted.html} truncated={extracted.truncated} />
          )}
          {!loading && !error && extracted && extracted.text && extracted.kind !== "docx" && (
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-200">
              {extracted.text}
              {extracted.truncated && (
                <span className="block mt-3 text-[10px] text-amber-600">
                  ⚠️ Texto truncado. Descargá el archivo para ver todo.
                </span>
              )}
            </pre>
          )}
          {!loading && !error && extracted && extracted.kind === "pptx" && extracted.slides && extracted.slides.length > 0 && (
            <PowerPointPreview slides={extracted.slides} />
          )}

          {/* Sin vista previa: se ofrece descargar Y SE DICE POR QUE. Dos motivos distintos, y al
              usuario le importa la diferencia — uno se arregla abriendo el archivo desde el Drive y
              el otro no se arregla. */}
          {!loading && !error && (modo === "descarga" || (extracted && extracted.hint === "preview_unavailable")) && (
            <div className="h-96 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <File className="h-10 w-10 text-neutral-400" />
              <p className="text-sm font-bold">Sin vista previa para este archivo</p>
              <p className="text-xs text-neutral-500 max-w-md">
                {modo === "descarga" && !origen.id && esOfimatica(origen.nombre, origen.mime)
                  ? "Los documentos de Word, Excel y PowerPoint solo se pueden previsualizar cuando están guardados en el Drive. Este llegó por otra vía, así que hay que descargarlo para verlo."
                  : "Este formato no se puede mostrar aquí. Descárgalo para abrirlo en su aplicación."}
              </p>
              <a
                href={hrefDescarga}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 h-9 px-4 rounded-xl gradient-orange text-white text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-2 shadow"
              >
                <Download className="h-3.5 w-3.5" /> Descargar
              </a>
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

// =============================================================================
// ExcelPreview — renderiza HTML generado por sheet_to_html con estilos Excel-like
// =============================================================================
function ExcelPreview({ sheets }: { sheets: { name: string; html: string; rows: number; cols: number }[] }) {
  const [active, setActive] = useState(0);
  const sh = sheets[active];
  if (!sh) return null;
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200 bg-[#f0fdf4]">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-sm bg-[#107C41] flex items-center justify-center">
            <FileSpreadsheet className="h-3 w-3 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[11px] font-bold text-[#107C41] uppercase tracking-wider">Excel</span>
        </div>
        <div className="text-[10px] text-neutral-500 ml-2">
          {sh.rows} filas · {sh.cols} columnas
        </div>
      </div>
      {sheets.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 pt-1 border-b border-neutral-200 bg-neutral-50 overflow-x-auto">
          {sheets.map((s2, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={cn(
                "px-3 py-1.5 text-[11px] font-semibold rounded-t border-t border-l border-r whitespace-nowrap",
                i === active
                  ? "bg-white border-neutral-300 text-[#107C41] -mb-px"
                  : "bg-neutral-100 border-transparent text-neutral-600 hover:text-neutral-900"
              )}
            >
              {s2.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto bg-white">
        <div
          className="excel-preview text-[12px] text-neutral-900"
          dangerouslySetInnerHTML={{ __html: sh.html }}
          style={{ fontFamily: "Calibri, 'Segoe UI', sans-serif" }}
        />
      </div>
      <style jsx global>{`
        .excel-preview table {
          border-collapse: collapse;
          width: 100%;
        }
        .excel-preview td, .excel-preview th {
          border: 1px solid #d4d4d4;
          padding: 4px 8px;
          min-width: 80px;
          max-width: 400px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          background: white;
        }
        .excel-preview tr:first-child td,
        .excel-preview th {
          background: #f3f4f6;
          font-weight: 600;
          color: #107C41;
        }
        .excel-preview tr:hover td {
          background: #fef3e2;
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// WordPreview — renderiza HTML de mammoth con estilos tipo documento Word
// =============================================================================
function WordPreview({ html, truncated }: { html: string; truncated?: boolean }) {
  return (
    <div className="min-h-full flex justify-center bg-neutral-200 py-8 px-4">
      <div className="w-full max-w-[8.5in] bg-white shadow-lg" style={{ minHeight: "11in" }}>
        <div className="flex items-center gap-2 px-6 py-2 border-b border-neutral-200 bg-[#eff6ff]">
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-sm bg-[#2B579A] flex items-center justify-center">
              <FileText className="h-3 w-3 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[11px] font-bold text-[#2B579A] uppercase tracking-wider">Word</span>
          </div>
        </div>
        <div
          className="word-preview p-12 text-[14px] leading-[1.6] text-neutral-900"
          dangerouslySetInnerHTML={{ __html: html }}
          style={{ fontFamily: "'Calibri', 'Segoe UI', sans-serif" }}
        />
        {truncated && (
          <div className="px-12 pb-8 text-[11px] text-amber-700">
            ⚠️ Documento truncado. Descargá el archivo para ver todo.
          </div>
        )}
      </div>
      <style jsx global>{`
        .word-preview h1 { font-size: 24px; font-weight: 700; margin: 24px 0 12px; color: #1e293b; }
        .word-preview h2 { font-size: 20px; font-weight: 700; margin: 20px 0 10px; color: #1e293b; }
        .word-preview h3 { font-size: 16px; font-weight: 700; margin: 16px 0 8px; color: #334155; }
        .word-preview p { margin: 0 0 12px; }
        .word-preview ul, .word-preview ol { margin: 0 0 12px; padding-left: 24px; }
        .word-preview li { margin: 4px 0; }
        .word-preview strong, .word-preview b { font-weight: 700; }
        .word-preview em, .word-preview i { font-style: italic; }
        .word-preview table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        .word-preview td, .word-preview th {
          border: 1px solid #cbd5e1;
          padding: 6px 10px;
          text-align: left;
        }
        .word-preview th { background: #f1f5f9; font-weight: 600; }
        .word-preview a { color: #2563eb; text-decoration: underline; }
        .word-preview img { max-width: 100%; height: auto; }
      `}</style>
    </div>
  );
}

// =============================================================================
// PowerPointPreview — slides como cards estilo PowerPoint
// =============================================================================
function PowerPointPreview({ slides }: { slides: { number: number; title: string; content: string[] }[] }) {
  const [active, setActive] = useState(0);
  const slide = slides[active];
  if (!slide) return (
    <div className="h-96 flex items-center justify-center text-neutral-400 text-sm">Sin slides</div>
  );
  return (
    <div className="flex flex-col h-full bg-neutral-100">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200 bg-[#fef2e7]">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-sm bg-[#D24726] flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-3 w-3 text-white" fill="currentColor"><path d="M3 5h18v14H3z" stroke="white" strokeWidth="2" fill="none"/><path d="M7 9h10M7 12h10M7 15h6" stroke="white" strokeWidth="1.5"/></svg>
          </div>
          <span className="text-[11px] font-bold text-[#D24726] uppercase tracking-wider">PowerPoint</span>
        </div>
        <div className="text-[10px] text-neutral-500 ml-2">
          Slide {slide.number} de {slides.length}
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-6">
        <div className="bg-white shadow-2xl aspect-[16/9] w-full max-w-3xl rounded-lg overflow-hidden border border-neutral-300 flex flex-col">
          <div className="bg-gradient-to-r from-[#D24726] to-[#F47B47] h-12 flex items-center px-6">
            <h2 className="text-white font-bold text-lg truncate">{slide.title}</h2>
          </div>
          <div className="flex-1 p-8 overflow-auto">
            <ul className="space-y-3">
              {slide.content.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-neutral-800 text-sm leading-relaxed">
                  <span className="text-[#D24726] mt-1.5 flex-shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {slide.content.length === 0 && (
              <p className="text-neutral-400 text-sm italic">Sin contenido en este slide</p>
            )}
          </div>
          <div className="bg-neutral-50 h-8 px-4 flex items-center justify-end border-t border-neutral-200">
            <span className="text-[10px] text-neutral-400">{slide.number} / {slides.length}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-200 bg-white px-3 py-2 flex items-center gap-2 overflow-x-auto">
        {slides.map((s, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={cn(
              "flex-shrink-0 px-2.5 py-1 rounded text-[10px] font-bold transition",
              i === active
                ? "bg-[#D24726] text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            )}
          >
            {s.number}
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// PDFPreview — wrapper con header rojo Adobe + iframe nativo
// =============================================================================
/**
 * Un CSV como tabla. Viene de `app/view/page.tsx`, que era el unico sitio que sabia pintarlos.
 *
 * El recorte a 500 filas se AVISA en pantalla. Un CSV de exportacion puede traer decenas de miles
 * y pintarlas todas cuelga la pestania, pero recortar en silencio haria creer que el archivo tiene
 * menos datos de los que tiene — y de un CSV la gente saca conclusiones contando filas.
 */
/**
 * Un HTML pintado como pagina.
 *
 * 🔴 EL `sandbox=""` VACIO ES LO QUE SOSTIENE ESTO, y no es un adorno. Un HTML del Drive lo subio
 * alguien de fuera: un cliente, un despacho, un sistema de un tercero. Sin sandbox correria con
 * los mismos permisos que el CRM.
 *
 * Vacio significa TODO restringido: sin `allow-scripts` no se ejecuta un solo `<script>`, y sin
 * `allow-same-origin` el documento recibe un origen opaco, asi que aunque alguno llegara a correr
 * no podria leer el DOM del CRM, ni sus cookies, ni hacer peticiones como el usuario. Las dos
 * cosas juntas a proposito: cada una tapa lo que se le escapa a la otra.
 *
 * 🔴 SE USA `srcDoc` Y NO `src={url}` DELIBERADAMENTE. Apuntar el iframe a
 * `/api/drive/files/:id/raw` serviria el HTML desde NUESTRO propio origen, y ahi `sandbox` es la
 * unica barrera; con `srcDoc` el contenido ni siquiera llega a tener una URL nuestra. Por eso
 * `necesitaTexto` incluye `html`: hay que bajarselo, no enlazarlo.
 *
 * ⚠️ LO QUE ESTO **NO** IMPIDE, y conviene decirlo: los recursos remotos SI se piden. Un
 * `<img src="https://...">` dentro del documento se carga, y eso le dice a un tercero que el
 * archivo se abrio y desde que IP. Bloquearlos de serie —como hace un cliente de correo— es una
 * decision de producto que no se ha tomado; se deja escrito aqui y en el guion de pruebas en vez
 * de fingir que no existe.
 */
function HtmlPreview({ html }: { html: string }) {
  return (
    <iframe
      // eslint-disable-next-line react/iframe-missing-sandbox -- lo lleva, y vacio a proposito
      sandbox=""
      srcDoc={html}
      title="Vista previa del documento"
      className="w-full h-full min-h-[70vh] bg-white rounded-xl border border-black/5"
    />
  );
}

function CsvPreview({ contenido }: { contenido: string }) {
  const { filas, recortado } = filasDeCsv(contenido);
  if (filas.length === 0) {
    return <div className="h-96 flex items-center justify-center text-sm text-neutral-500">El archivo esta vacio</div>;
  }
  const [cabecera, ...cuerpo] = filas;
  return (
    <div className="h-full overflow-auto p-6">
      {recortado && (
        <p className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Se muestran las primeras {filas.length} filas. Descarga el archivo para verlo entero.
        </p>
      )}
      <table className="min-w-full text-sm border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr>
            {cabecera.map((c, i) => (
              <th key={i} className="px-3 py-2 bg-neutral-100 text-left font-ui text-[10px] uppercase tracking-wider text-neutral-600 border-b border-neutral-200">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cuerpo.map((f, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-neutral-50/60"}>
              {f.map((c, j) => <td key={j} className="px-3 py-1.5 border-b border-neutral-100 text-neutral-800">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PDFPreview({ url }: { url: string }) {
  return (
    <div className="flex flex-col h-full bg-neutral-100">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200 bg-[#fee2e2]">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-sm bg-[#DC2626] flex items-center justify-center">
            <span className="text-white text-[8px] font-black">PDF</span>
          </div>
          <span className="text-[11px] font-bold text-[#DC2626] uppercase tracking-wider">PDF</span>
        </div>
      </div>
      <iframe
        src={url}
        className="flex-1 w-full border-0 bg-white"
        title="PDF preview"
      />
    </div>
  );
}

// =============================================================================
// ImagePreview — wrapper con header magenta + zoom controls
// =============================================================================
function ImagePreview({ url, fileName }: { url: string; fileName: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="flex flex-col h-full bg-neutral-900">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/10 bg-gradient-to-r from-fuchsia-900/20 to-purple-900/20">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-sm bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center">
            <FileImage className="h-3 w-3 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[11px] font-bold text-fuchsia-300 uppercase tracking-wider">Imagen</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="h-7 w-7 rounded bg-white/10 hover:bg-white/20 text-white text-sm font-bold flex items-center justify-center"
            aria-label="Zoom out"
          >−</button>
          <span className="text-[11px] text-white/70 tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="h-7 w-7 rounded bg-white/10 hover:bg-white/20 text-white text-sm font-bold flex items-center justify-center"
            aria-label="Zoom in"
          >+</button>
          <button
            onClick={() => setZoom(1)}
            className="h-7 px-2 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider"
          >Reset</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-6">
        <img
          src={url}
          alt={fileName}
          className="max-w-none transition-transform shadow-2xl rounded"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
        />
      </div>
    </div>
  );
}

