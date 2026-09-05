"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, Users, Mail, Phone, X, Filter, UserPlus, MoreVertical, Tag, LayoutGrid, List, Trash2, Edit3, GitMerge, UserCheck, UserX, CalendarOff } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { DateField } from "@/components/ui/DateField";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmarArchivadoModal, type SeleccionContactos } from "@/components/contactos/ConfirmarArchivadoModal";
import { FusionarModal } from "@/components/contactos/FusionarModal";
import { PapeleraContactosModal } from "@/components/contactos/PapeleraContactosModal";
import { AsignarResponsableModal, AgregarTareaMasivaModal } from "@/components/contactos/AccionesMasivasModales";
import { useCurrentUser } from "@/lib/auth-user";
import { cn } from "@/lib/utils";
import { COUNTRIES, formatPhone, dialOf, toE164 } from "@/lib/contact-format";
import { EMAIL_NO_VALIDO, queFaltaParaElAlta, sePuedeDarDeAlta } from "@/lib/contacto-alta";
import { useContactosStore, type ContactosFiltros } from "@/features/contactos/store";

interface Contacto {
  id: string;
  nombre_completo: string;
  email: string | null;
  telefono: string | null;
  whatsapp: string | null;
  estatus_migratorio: string | null;
  estatus_migratorio_tipo: string | null;
  tipo_cliente: string | null;
  pipedrive_person_id: number | null;
  pipedrive_tramites: string[] | null;
  zoho_id: string | null;
  zoho_tramites: string[] | null;
  bitrix_contact_id: string | null;
  responsable_user_id: string | null;
  responsable_nombre: string | null;
  created_at: string;
}

/** Los que no tienen responsable. Debe coincidir con `SIN_RESPONSABLE` del servidor. */
const SIN_RESPONSABLE = "sin_responsable";

interface TramiteFacet { tramite: string; count: number; }

const TRAMITE_LABELS: Record<string, string> = {
  asilo_pendiente: "Asilo",
  permiso_trabajo: "Permiso de Trabajo",
  residente: "Residencia",
  ciudadano: "Ciudadanía",
  tps: "TPS",
  daca: "DACA",
  visa_u: "Visa U",
  visa_t: "Visa T",
  indocumentado: "Indocumentado",
  otros: "Otros",
};
const tramiteLabel = (t: string) => TRAMITE_LABELS[t] || t;

const TAMANOS_PAGINA = [50, 100];          // debe coincidir con la lista blanca del servidor
const CLAVE_VISTA = "contactos:vista";      // preferencia lista/mosaico, por navegador

// Acciones masivas del futuro. Se dejan visibles y deshabilitadas a propósito: el contenedor y
// las etiquetas son las definitivas, lo único que falta es el comportamiento.
// "Agregar tarea" y "Cambiar responsable" salieron de aquí en la Ola 3 · Etapa 2; la exportación
// llega en la parte 2 y hasta entonces sigue deshabilitada, no oculta.
const ACCIONES_PROXIMAMENTE = ["Incluir en la exportación"];

export default function ContactosPage() {
  const router = useRouter();

  // ---- datos + paginación (todo en servidor) ----
  const [items, setItems] = useState<Contacto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [cargando, setCargando] = useState(false);

  // ---- filtros (estado de UI en el store del slice; ver features/contactos/store.ts) ----
  const filtros = useContactosStore((s) => s.filtros);
  const setFiltroStore = useContactosStore((s) => s.setFiltro);
  const { q, tramite, source, soloDuplicados, sinFechaNac, responsable } = filtros;
  function setFiltroCampo<K extends keyof ContactosFiltros>(campo: K) {
    return (valor: ContactosFiltros[K] | ((prev: ContactosFiltros[K]) => ContactosFiltros[K])) => {
      const next = typeof valor === "function" ? (valor as (prev: ContactosFiltros[K]) => ContactosFiltros[K])(filtros[campo]) : valor;
      setFiltroStore(campo, next);
    };
  }
  const setQ = setFiltroCampo("q");
  const setTramite = setFiltroCampo("tramite");
  const setSource = setFiltroCampo("source");
  const setSoloDuplicados = setFiltroCampo("soloDuplicados");
  const setSinFechaNac = setFiltroCampo("sinFechaNac");
  const setResponsable = setFiltroCampo("responsable");
  const [debouncedQ, setDebouncedQ] = useState("");
  /**
   * Responsable: uuid, `sin_responsable`, o vacío = sin filtrar.
   *
   * Se inicializa desde la query string porque la notificación de "te han asignado N contactos"
   * enlaza a `/contactos?responsable=<uuid>`. Sin esto el aviso llevaría al listado entero, que es
   * justo lo que hacía antes: prometer algo que la pantalla no podía cumplir.
   */
  useEffect(() => {
    const inicial = new URLSearchParams(window.location.search).get("responsable");
    if (inicial) setFiltroStore("responsable", inicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [facets, setFacets] = useState<{ tramites: TramiteFacet[]; sources: { pipedrive: number; zoho: number; bitrix: number; native: number } } | null>(null);

  // ---- vista ----
  const [vista, setVista] = useState<"mosaico" | "lista">("mosaico");

  // ---- selección ----
  // Dos modos, y el contrato con el backend es el mismo que consumirán fusionar y exportar:
  //   'ids'    → el Set de abajo.
  //   'filtro' → "seleccionar el total": el conjunto lo resuelve el servidor con el MISMO filtro
  //              del listado, y `excluidos` son los que el usuario fue destildando.
  // Nunca se mandan decenas de miles de ids en un body.
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [modoTotal, setModoTotal] = useState(false);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [confirmarArchivado, setConfirmarArchivado] = useState(false);
  const [fusionAbierta, setFusionAbierta] = useState(false);
  const [papeleraAbierta, setPapeleraAbierta] = useState(false);
  const [responsableAbierto, setResponsableAbierto] = useState(false);
  const [tareaMasivaAbierta, setTareaMasivaAbierta] = useState(false);
  const { isAdmin, user } = useCurrentUser();   // D8: papelera solo admin · `user` para "Mis contactos"

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nombre_completo: "", email: "", telefono: "", whatsapp: "", estatus_migratorio: "", fecha_nacimiento: "", telPais: "US", waPais: "US" });
  const [saving, setSaving] = useState(false);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  /** Lo que mira la regla del alta. Se compone una vez para que el boton, su motivo y el guardado
      hablen del mismo estado y no de tres lecturas parecidas de `form`. */
  const datosDeAlta = { nombre: form.nombre_completo, email: form.email, telefono: form.telefono };
  const labelCls = "text-[11px] font-ui font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300 block mb-1.5";
  const inputCls = "w-full h-11 px-4 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-white/10 focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange/60 transition";
  const selCls = "h-11 px-2 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm text-neutral-900 dark:text-white outline-none focus:bg-white dark:focus:bg-white/10 focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange/60 transition w-[104px] shrink-0";

  // Preferencia de vista (se recuerda entre recargas). Por defecto MOSAICO: es lo que la gente
  // ve hoy y esta ola no cambia lo que ya funciona.
  useEffect(() => {
    try { const v = localStorage.getItem(CLAVE_VISTA); if (v === "lista" || v === "mosaico") setVista(v); } catch {}
  }, []);
  const cambiarVista = (v: "mosaico" | "lista") => {
    setVista(v);
    try { localStorage.setItem(CLAVE_VISTA, v); } catch {}
  };

  const limpiarSeleccion = useCallback(() => {
    setSeleccionados(new Set()); setModoTotal(false); setExcluidos(new Set());
  }, []);

  // Debounce de 300 ms: antes se lanzaba una consulta POR TECLA. Al cambiar la búsqueda o
  // cualquier filtro se vuelve a la página 1 y se limpia la selección — si el conjunto cambia,
  // "los 153 seleccionados" ya no serían esos 153.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); limpiarSeleccion(); }, 300);
    return () => clearTimeout(t);
  }, [q, limpiarSeleccion]);

  useEffect(() => { setPage(1); limpiarSeleccion(); }, [tramite, source, pageSize, soloDuplicados, sinFechaNac, responsable, limpiarSeleccion]);

  // Guard anti-carreras: si escribes rápido, la respuesta de una búsqueda vieja puede llegar
  // DESPUÉS de la nueva. El AbortController cancela la anterior y el flag descarta lo que llegue
  // tarde, para que nunca se pinte un resultado que ya no corresponde a lo que hay en el campo.
  const [recargar, setRecargar] = useState(0);
  const listaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelado = false;
    (async () => {
      setCargando(true);
      try {
        const p = new URLSearchParams();
        p.set("page", String(page));
        p.set("pageSize", String(pageSize));
        if (debouncedQ) p.set("q", debouncedQ);
        if (tramite) p.set("tramite", tramite);
        if (source) p.set("source", source);
        if (soloDuplicados) p.set("revision_dedup", "1");
        if (sinFechaNac) p.set("sin_fecha_nacimiento", "1");
        if (responsable) p.set("responsable", responsable);
        const r = await fetch(`/api/contactos?${p.toString()}`, { signal: ctrl.signal });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error || `HTTP ${r.status}`); }
        const d = await r.json();
        if (cancelado || ctrl.signal.aborted) return;
        setItems(d.items || []);
        setTotal(d.total || 0);
        setTotalPages(d.totalPages || 1);
        // Página fuera de rango tras filtrar (p.ej. estabas en la 20 y ahora hay 3): vuelve a la 1.
        if ((d.items?.length ?? 0) === 0 && page > 1 && (d.total ?? 0) > 0) setPage(1);
      } catch (e: any) {
        // Al abortar una petición cuyo cuerpo ya venía en camino, el fallo NO siempre llega como
        // AbortError: si el stream se corta a mitad, `r.json()` revienta con un
        // "Unterminated string in JSON". Mirar la señal es lo único fiable; si no, una respuesta
        // cancelada se pintaba como error real y dejaba el contador con el total anterior.
        if (cancelado || ctrl.signal.aborted || e?.name === "AbortError") return;
        toast.error(e?.message || "No se pudieron cargar los contactos");
        setItems([]); setTotal(0); setTotalPages(1);
      } finally {
        if (!cancelado && !ctrl.signal.aborted) setCargando(false);
      }
    })();
    return () => { cancelado = true; ctrl.abort(); };
  }, [page, pageSize, debouncedQ, tramite, source, soloDuplicados, sinFechaNac, responsable, recargar]);

  useEffect(() => {
    (async () => {
      try { const r = await fetch("/api/contactos/facets"); if (r.ok) setFacets(await r.json()); } catch {}
    })();
  }, []);

  // D1 — el scroll sube DESPUÉS de que se pinten los items, no en el clic.
  //
  // Antes se llamaba a `window.scrollTo` dentro de `irAPagina`, a la vez que `setPage`. Estaba bien
  // conectado y aun así no subía: al sustituirse la lista por el estado de carga la página se
  // ACORTA, y cuando llegan los datos el navegador restaura la posición anterior (*scroll
  // anchoring*) con el `behavior:"smooth"` todavía corriendo — el navegador ganaba la carrera.
  // Con el aviso en un ref y el scroll en un efecto sobre `items`, se scrollea cuando la lista
  // nueva ya está pintada y no hay nada que la mueva después.
  const pedirScrollArriba = useRef(false);
  const irAPagina = (p: number) => {
    pedirScrollArriba.current = true;
    setPage(p);
  };
  useEffect(() => {
    if (!pedirScrollArriba.current) return;   // solo al cambiar de página; no al filtrar ni al cargar
    pedirScrollArriba.current = false;
    // El Drive no lo necesita porque sus paneles tienen scroll propio; aquí scrollea el body.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [items]);

  // ---- helpers de selección ----
  const filtrosActuales = { q: debouncedQ || undefined, tramite: tramite || undefined, source: source || undefined, revision_dedup: soloDuplicados || undefined, sin_fecha_nacimiento: sinFechaNac || undefined, responsable: responsable || undefined };
  const estaSeleccionado = (id: string) => (modoTotal ? !excluidos.has(id) : seleccionados.has(id));
  const nSeleccionados = modoTotal ? Math.max(0, total - excluidos.size) : seleccionados.size;
  const idsPagina = (items || []).map((c) => c.id);
  const todaLaPaginaSeleccionada = idsPagina.length > 0 && idsPagina.every(estaSeleccionado);
  const algunoDeLaPagina = idsPagina.some(estaSeleccionado);

  const alternarFila = (id: string) => {
    if (modoTotal) {
      setExcluidos((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
    } else {
      setSeleccionados((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
    }
  };
  const alternarPagina = () => {
    const marcar = !todaLaPaginaSeleccionada;
    if (modoTotal) {
      setExcluidos((prev) => { const s = new Set(prev); for (const id of idsPagina) marcar ? s.delete(id) : s.add(id); return s; });
    } else {
      setSeleccionados((prev) => { const s = new Set(prev); for (const id of idsPagina) marcar ? s.add(id) : s.delete(id); return s; });
    }
  };
  const seleccionarElTotal = () => { setModoTotal(true); setExcluidos(new Set()); setSeleccionados(new Set()); };

  // Fusionar es de EXACTAMENTE 2 contactos. Con 1 o con 3+ la opción va deshabilitada. En modo
  // "seleccionar el total" tampoco: no se fusiona a ciegas sobre un conjunto.
  const idsSeleccionados = modoTotal ? [] : [...seleccionados];
  const puedeFusionar = !modoTotal && idsSeleccionados.length === 2;

  const seleccionApi = (): SeleccionContactos =>
    modoTotal
      ? { modo: "filtro", filtros: filtrosActuales, excluidos: [...excluidos] }
      : { modo: "ids", ids: [...seleccionados] };

  const archivarSeleccion = async () => {
    const r = await fetch("/api/contactos/archivar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seleccion: seleccionApi() }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 403 && d?.error === "requiere_aprobacion") {
      // La barrera vive en el backend (§4.2): el botón se le muestra a todo el mundo, pero solo
      // un admin ejecuta. El flujo de solicitudes llega en la Ola 3.
      setConfirmarArchivado(false);
      toast.error(d.mensaje || "Requiere aprobación del administrador (próximamente).");
      return;
    }
    if (!r.ok) { toast.error(d?.error || "No se pudo archivar"); return; }
    setConfirmarArchivado(false);
    limpiarSeleccion();
    toast.success(`${d.archivados} contacto${d.archivados === 1 ? "" : "s"} archivado${d.archivados === 1 ? "" : "s"}`);
    setRecargar((n) => n + 1);
  };

  const save = async () => {
    // Que falta lo decide `lib/contacto-alta`, el mismo modulo que usa el alta rapida desde una
    // oportunidad: una sola regla para las dos pantallas (§4.8). La barrera de verdad sigue
    // estando en el servidor (§4.2); esto solo evita el viaje y apaga el boton.
    //
    // 🔴 La fecha de nacimiento NO esta ahi: desde el 2026-08-31 no es obligatoria. El campo se
    // queda en el formulario, pero no impide guardar.
    const falta = queFaltaParaElAlta(datosDeAlta);
    if (falta) {
      // El email tiene ademas su marca roja bajo el campo: es el unico de los tres que puede
      // fallar por estar mal escrito y no por faltar, y ahi conviene senialar donde.
      if (falta === EMAIL_NO_VALIDO) setEmailErr(falta);
      toast.error(falta);
      return;
    }
    const email = form.email.trim();
    const telefono = toE164(form.telPais, form.telefono);
    const whatsapp = toE164(form.waPais, form.whatsapp);
    setSaving(true);
    try {
      const r = await fetch("/api/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_completo: form.nombre_completo.trim(),
          email: email || null,
          telefono: telefono || null,
          whatsapp: whatsapp || null,
          estatus_migratorio: form.estatus_migratorio.trim() || null,
          // Vacio se manda como `null`, no como `""`: la columna es `date` y una cadena vacia es
          // un `22007` de Postgres. El servidor tambien lo normaliza —la UI no es la unica
          // barrera (§4.2)—, pero mandar el dato bien es de esta pantalla.
          fecha_nacimiento: form.fecha_nacimiento || null
        })
      });
      // Se ensenia el mensaje QUE MANDA EL SERVIDOR, no uno generico. Si la fecha falta o no vale,
      // el 400 trae la razon en castellano: tragarsela y decir "Error al crear" obligaria a abrir
      // las herramientas del navegador para saber que ha pasado.
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Error al crear");
      }
      toast.success("Contacto creado");
      setModal(false);
      setForm({ nombre_completo: "", email: "", telefono: "", whatsapp: "", estatus_migratorio: "", fecha_nacimiento: "", telPais: "US", waPais: "US" });
      setEmailErr(null);
      setRecargar((n) => n + 1);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const barraVisible = nSeleccionados > 0;

  return (
    <AppShell>
      {/* min-h-screen: la barra es `sticky bottom-0` y necesita un contenedor más alto que el
          viewport para quedar pegada abajo también cuando hay pocas filas. */}
      <div className="min-h-screen flex flex-col">
        <div className={cn("max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-10 flex-1", barraVisible && "pb-28")} ref={listaRef}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex items-start justify-between gap-4 flex-wrap"
          >
            <div>
              <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
                <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                CRM
              </div>
              <h1 className="font-display text-4xl font-black leading-tight">
                <span className="text-gradient-orange">Contactos</span>
              </h1>
              {/* El TOTAL siempre visible, haya o no selección. */}
              <p className="mt-2 text-neutral-500">
                {items === null ? "Cargando…" : <><span className="font-bold text-neutral-700 dark:text-neutral-200 tabular-nums">{total}</span> contactos · click para ver detalle</>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-xl bg-white/80 border border-black/5 p-1">
                <button
                  onClick={() => cambiarVista("mosaico")}
                  title="Vista mosaico"
                  className={cn("h-9 w-9 rounded-lg flex items-center justify-center transition", vista === "mosaico" ? "bg-brand-orange text-white shadow-glow" : "text-neutral-500 hover:bg-black/5")}
                >
                  <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  onClick={() => cambiarVista("lista")}
                  title="Vista lista (permite seleccionar)"
                  className={cn("h-9 w-9 rounded-lg flex items-center justify-center transition", vista === "lista" ? "bg-brand-orange text-white shadow-glow" : "text-neutral-500 hover:bg-black/5")}
                >
                  <List className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
              <button
                onClick={() => setModal(true)}
                className="gradient-orange flex items-center gap-2 h-11 px-5 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow hover:scale-[1.02] transition"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                Nuevo contacto
              </button>
            </div>
          </motion.div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1.5} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre, email, teléfono, WhatsApp o A-Number…"
                className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/80 border border-black/5 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange/50 transition"
              />
            </div>

            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" strokeWidth={1.5} />
              <select
                value={tramite}
                onChange={(e) => setTramite(e.target.value)}
                className="h-11 pl-10 pr-8 rounded-xl bg-white/80 border border-black/5 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange/50 transition appearance-none cursor-pointer"
              >
                <option value="">Todos los trámites</option>
                {facets?.tramites.map((f) => (
                  <option key={f.tramite} value={f.tramite}>{tramiteLabel(f.tramite)} · {f.count}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              {(["", "pipedrive", "zoho", "bitrix", "native"] as const).map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => setSource(s)}
                  className={`h-9 px-3 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition ${source === s ? "bg-brand-orange text-white shadow-glow" : "bg-white/80 border border-black/5 text-neutral-600 hover:bg-black/5"}`}
                >
                  {s === "" ? "Todos" : s === "pipedrive" ? `Pipedrive${facets ? ` · ${facets.sources.pipedrive}` : ""}` : s === "zoho" ? `Zoho${facets ? ` · ${facets.sources.zoho}` : ""}` : s === "bitrix" ? `Bitrix${facets ? ` · ${facets.sources.bitrix}` : ""}` : `CRM${facets ? ` · ${facets.sources.native}` : ""}`}
                </button>
              ))}
            </div>

            {/* Bonus: los candidatos que el motor automático NO fusionó por tener nombres
                distintos y dejó marcados. Al activarlo la lista se ordena POR GRUPO, así los que
                hay que comparar salen juntos. */}
            <button
              onClick={() => setSoloDuplicados((v) => !v)}
              title="Contactos que el sistema detectó como posibles duplicados y dejó para revisión humana"
              className={cn("h-9 px-3 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1.5",
                soloDuplicados ? "bg-amber-500 text-white shadow-glow" : "bg-white/80 border border-black/5 text-neutral-600 hover:bg-black/5")}
            >
              <GitMerge className="h-3.5 w-3.5" strokeWidth={2} />
              Duplicados por revisar
            </button>

            {/* 🔴 "Mis contactos": el atajo que hacía falta para que "Cambiar responsable" sirva de
                algo. Sin él, asignar era una escritura sin lectura — había que abrir DBeaver para
                saber a quién le tocó qué. Mismo estilo que los otros atajos de esta barra. */}
            {user?.id && (
              <button
                onClick={() => setResponsable((v) => (v === user.id ? "" : user.id))}
                title="Solo los contactos de los que soy responsable"
                className={cn("h-9 px-3 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1.5",
                  responsable === user.id ? "bg-brand-orange text-white shadow-glow" : "bg-white/80 border border-black/5 text-neutral-600 hover:bg-black/5")}
              >
                <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />
                Mis contactos
              </button>
            )}

            {/* Los que no tiene nadie: son justo los que hay que repartir, y sin esta opción no
                habría forma de encontrarlos. Se enseña el hueco, no se esconde. */}
            <button
              onClick={() => setResponsable((v) => (v === SIN_RESPONSABLE ? "" : SIN_RESPONSABLE))}
              title="Contactos que todavía no tienen responsable asignado"
              className={cn("h-9 px-3 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1.5",
                responsable === SIN_RESPONSABLE ? "bg-brand-orange text-white shadow-glow" : "bg-white/80 border border-black/5 text-neutral-600 hover:bg-black/5")}
            >
              <UserX className="h-3.5 w-3.5" strokeWidth={2} />
              Sin responsable
            </button>

            {/* 🔴 ESTE FILTRO SUSTITUYE A UN AVISO, y hace mas que el aviso.
                3.704 de 3.811 contactos vivos no tienen fecha de nacimiento — el 97,2 %. Un aviso
                al guardar saltaria en 97 de cada 100 fichas y en una semana nadie lo leeria
                (§10.7); ademas no deja HACER nada. Con el filtro se listan, se reparten con la
                accion masiva de responsable que ya existe, y se ve bajar el numero. */}
            <button
              onClick={() => setSinFechaNac((v) => !v)}
              title="Contactos a los que todavia les falta la fecha de nacimiento"
              className={cn("h-9 px-3 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1.5",
                sinFechaNac ? "bg-brand-orange text-white shadow-glow" : "bg-white/80 border border-black/5 text-neutral-600 hover:bg-black/5")}
            >
              <CalendarOff className="h-3.5 w-3.5" strokeWidth={2} />
              Sin fecha de nacimiento
            </button>

            {/* Si el filtro llegó por el enlace de una notificación, es de OTRA persona: se dice de
                quién en vez de dejar un filtro puesto que nadie entiende de dónde salió. */}
            {responsable && responsable !== SIN_RESPONSABLE && responsable !== user?.id && (
              <span className="h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />
                Responsable: {items?.find((c) => c.responsable_user_id === responsable)?.responsable_nombre || "otra persona"}
              </span>
            )}

            {/* D8 · La papelera. Solo para admin: el backend ya devuelve 403 al resto
                (`contactos-routes.ts`), pero enseñar un botón que siempre falla es mala UX.
                Sin esta pantalla el archivado era reversible solo sobre el papel: la vuelta
                existía en la API y no para quien se equivoca. */}
            {isAdmin && (
              <button
                onClick={() => setPapeleraAbierta(true)}
                title="Ver los contactos archivados y devolverlos al listado"
                className="h-9 px-3 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1.5 bg-white/80 border border-black/5 text-neutral-600 hover:bg-black/5"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                Contactos archivados
              </button>
            )}

            {(tramite || source || soloDuplicados || responsable) && (
              <button onClick={() => { setTramite(""); setSource(""); setSoloDuplicados(false); setResponsable(""); }} className="h-9 px-3 rounded-lg text-xs font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-800 transition">
                <X className="inline h-3 w-3 mr-1" strokeWidth={2} />
                Limpiar
              </button>
            )}
          </div>

          {items === null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="glass rounded-2xl p-6 h-36 skeleton" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="glass rounded-3xl p-16 text-center">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-orange/10 mb-4">
                <Users className="h-8 w-8 text-brand-orange" strokeWidth={1.5} />
              </div>
              <h3 className="font-display text-xl font-black mb-2">{debouncedQ || tramite || source ? "Ningún contacto coincide" : "Aún no hay contactos"}</h3>
              <p className="text-neutral-500 text-sm mb-5">{debouncedQ || tramite || source ? "Prueba con otra búsqueda o quita los filtros" : "Crea el primero para empezar"}</p>
              {!(debouncedQ || tramite || source) && (
                <button onClick={() => setModal(true)} className="gradient-orange inline-flex items-center gap-2 h-10 px-5 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow">
                  <UserPlus className="h-4 w-4" strokeWidth={2} />
                  Crear primero
                </button>
              )}
            </div>
          ) : vista === "lista" ? (
            <div className="glass rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-ui uppercase tracking-wider text-neutral-400 border-b border-black/5">
                      <th className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos los de esta página"
                          checked={todaLaPaginaSeleccionada}
                          ref={(el) => { if (el) el.indeterminate = !todaLaPaginaSeleccionada && algunoDeLaPagina; }}
                          onChange={alternarPagina}
                          className="h-4 w-4 rounded accent-[#5750E8] cursor-pointer"
                        />
                      </th>
                      <th className="px-3 py-3">Nombre</th>
                      <th className="px-3 py-3">Email</th>
                      <th className="px-3 py-3">Teléfono</th>
                      <th className="px-3 py-3">Estatus</th>
                      <th className="px-3 py-3">Responsable</th>
                      <th className="px-3 py-3">Origen</th>
                      {soloDuplicados && <th className="px-3 py-3">Grupo detectado</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => {
                      const sel = estaSeleccionado(c.id);
                      return (
                        <tr
                          key={c.id}
                          onClick={() => router.push(`/contactos/${c.id}`)}
                          className={cn("border-b border-black/5 last:border-0 cursor-pointer transition", sel ? "bg-brand-orange/5" : "hover:bg-black/[0.02]")}
                        >
                          {/* El clic en la casilla NO navega: si no, seleccionar te sacaría de la lista. */}
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${c.nombre_completo}`}
                              checked={sel}
                              onChange={() => alternarFila(c.id)}
                              className="h-4 w-4 rounded accent-[#5750E8] cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-3 font-semibold text-neutral-800 dark:text-neutral-100">{c.nombre_completo || "Sin nombre"}</td>
                          <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{c.email || <span className="text-neutral-300">—</span>}</td>
                          <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300 tabular-nums">{c.telefono || c.whatsapp || <span className="text-neutral-300">—</span>}</td>
                          <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">
                            {c.estatus_migratorio_tipo ? tramiteLabel(c.estatus_migratorio_tipo) : c.estatus_migratorio || <span className="text-neutral-300">—</span>}
                          </td>
                          {/* El responsable, para verlo sin entrar en cada ficha. Se enseña el
                              hueco cuando no lo tiene: son los que hay que repartir. */}
                          <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">
                            {c.responsable_nombre
                              ? <span className={cn(c.responsable_user_id === user?.id && "font-semibold text-brand-orange")}>{c.responsable_nombre}</span>
                              : <span className="text-[11px] italic text-neutral-400">sin responsable</span>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {c.pipedrive_person_id && <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-ui font-bold uppercase">PD</span>}
                              {c.zoho_id && <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-ui font-bold uppercase">Zoho</span>}
                              {c.bitrix_contact_id && <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[10px] font-ui font-bold uppercase">Bitrix</span>}
                            </div>
                          </td>
                          {soloDuplicados && (
                            <td className="px-3 py-3">
                              {/* La clave del grupo dice POR QUÉ el sistema los emparejó: mismo
                                  email o mismo teléfono. Verla evita fusionar a ciegas. */}
                              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-mono">
                                {(c as any).revision_dedup_grupo || "—"}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page} pageSize={pageSize} total={total} onPageChange={irAPagina} disabled={cargando}
                pageSizeOptions={TAMANOS_PAGINA} onPageSizeChange={setPageSize} showFirstLast
                className="bg-white/60"
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {items.map((c, i) => {
                  const initials = (c.nombre_completo || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
                  const sel = estaSeleccionado(c.id);
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(0.04 * i, 0.4), duration: 0.4 }}
                      whileHover={{ y: -3 }}
                      onClick={() => router.push(`/contactos/${c.id}`)}
                      className={cn("group glass rounded-2xl p-5 hover:shadow-glow-lg transition-all cursor-pointer", sel && "ring-2 ring-brand-orange/60")}
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div className="h-11 w-11 rounded-xl gradient-orange flex items-center justify-center text-white font-ui font-bold text-sm shrink-0">
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-black text-base truncate">{c.nombre_completo}</div>
                          {(c.estatus_migratorio_tipo || c.estatus_migratorio) && (
                            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-blue">
                              {c.estatus_migratorio_tipo ? tramiteLabel(c.estatus_migratorio_tipo) : c.estatus_migratorio}
                            </div>
                          )}
                        </div>
                        <button className="opacity-0 group-hover:opacity-100 transition h-7 w-7 rounded-lg hover:bg-black/5 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4 text-neutral-400" strokeWidth={1.5} />
                        </button>
                      </div>

                      {(c.pipedrive_person_id || c.zoho_id || c.bitrix_contact_id || (c.pipedrive_tramites && c.pipedrive_tramites.length > 0) || (c.zoho_tramites && c.zoho_tramites.length > 0)) && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {c.pipedrive_person_id && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-ui font-bold uppercase tracking-wider">
                              Pipedrive
                            </span>
                          )}
                          {c.zoho_id && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-ui font-bold uppercase tracking-wider">
                              Zoho
                            </span>
                          )}
                          {c.bitrix_contact_id && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[10px] font-ui font-bold uppercase tracking-wider">
                              Bitrix
                            </span>
                          )}
                          {(c.pipedrive_tramites || []).map((t) => (
                            <span key={`pd-${t}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-orange/10 text-brand-orange text-[10px] font-ui font-bold uppercase tracking-wider">
                              <Tag className="h-2.5 w-2.5" strokeWidth={2} />
                              {tramiteLabel(t)}
                            </span>
                          ))}
                          {(c.zoho_tramites || []).map((t) => (
                            <span key={`zo-${t}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-orange/10 text-brand-orange text-[10px] font-ui font-bold uppercase tracking-wider">
                              <Tag className="h-2.5 w-2.5" strokeWidth={2} />
                              {tramiteLabel(t)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="space-y-1 text-xs text-neutral-600">
                        {c.email && (
                          <div className="flex items-center gap-2 truncate">
                            <Mail className="h-3 w-3 shrink-0 text-neutral-400" strokeWidth={1.5} />
                            <span className="truncate">{c.email}</span>
                          </div>
                        )}
                        {(c.telefono || c.whatsapp) && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-3 w-3 shrink-0 text-neutral-400" strokeWidth={1.5} />
                            <span>{c.telefono || c.whatsapp}</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <div className="glass rounded-2xl mt-4 overflow-hidden">
                <Pagination
                  page={page} pageSize={pageSize} total={total} onPageChange={irAPagina} disabled={cargando}
                  pageSizeOptions={TAMANOS_PAGINA} onPageSizeChange={setPageSize} showFirstLast
                />
              </div>
            </>
          )}
        </div>

        {/* ---- BARRA DE ACCIONES ----
            `sticky bottom-0` DENTRO de la columna de contenido, no `fixed`. Así queda alineada con
            el contenido POR MAQUETACIÓN y no por cálculo: da igual que el sidebar esté plegado,
            desplegado o a mitad de su animación. Y sigue pegada al borde inferior del viewport al
            scrollear, que es lo que se pidió. */}
        <AnimatePresence>
          {barraVisible && (
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="sticky bottom-0 z-40 border-t border-black/10 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.08)]"
            >
              <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setConfirmarArchivado(true)}
                  className="h-9 px-4 rounded-lg bg-red-50 text-red-600 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-red-100 transition flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Eliminar
                </button>
                <button
                  disabled={nSeleccionados !== 1}
                  onClick={() => {
                    const id = modoTotal ? idsPagina.find(estaSeleccionado) : [...seleccionados][0];
                    if (id) router.push(`/contactos/${id}`);
                  }}
                  title={nSeleccionados === 1 ? "Editar el contacto seleccionado" : "Selecciona exactamente 1 contacto para editar"}
                  className="h-9 px-4 rounded-lg bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Edit3 className="h-3.5 w-3.5" strokeWidth={1.8} /> Editar
                </button>

                {/* "Fusionar" es la única acción viva. Se habilita SOLO con exactamente 2
                    seleccionados: fusionar es de dos contactos, ni uno ni tres. */}
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "fusionar") setFusionAbierta(true);
                    // Las dos abren un diálogo que dice sobre CUÁNTOS contactos actúa antes de
                    // escribir nada: con "seleccionar el total" pueden ser miles.
                    if (v === "responsable") setResponsableAbierto(true);
                    if (v === "tarea") setTareaMasivaAbierta(true);
                  }}
                  title={puedeFusionar ? "Fusionar los 2 contactos seleccionados" : "Selecciona exactamente 2 contactos para fusionar"}
                  className="h-9 pl-3 pr-8 rounded-lg bg-white border border-black/10 text-[12px] text-neutral-600 outline-none focus:ring-2 focus:ring-brand-orange/30 cursor-pointer"
                >
                  <option value="">Seleccione la acción</option>
                  <option value="fusionar" disabled={!puedeFusionar}>
                    {puedeFusionar ? "Fusionar" : "Fusionar — selecciona exactamente 2"}
                  </option>
                  <option value="tarea">Agregar tarea</option>
                  <option value="responsable">Cambiar responsable</option>
                  {ACCIONES_PROXIMAMENTE.map((a) => (
                    <option key={a} value={a} disabled title="Próximamente">{a} — próximamente</option>
                  ))}
                </select>

                {todaLaPaginaSeleccionada && !modoTotal && totalPages > 1 && (
                  <button
                    onClick={seleccionarElTotal}
                    className="h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition"
                  >
                    Seleccionar el total ({total})
                  </button>
                )}
                <button
                  onClick={limpiarSeleccion}
                  className="h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-800 transition"
                >
                  Limpiar selección
                </button>

                <div className="ml-auto flex items-center gap-3">
                  {vista === "mosaico" && (
                    <span className="text-[11px] text-neutral-400 hidden sm:inline">La selección se edita en la vista de lista</span>
                  )}
                  <span className="font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                    Seleccionados: <span className="text-brand-orange tabular-nums">{nSeleccionados}</span>
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <FusionarModal
        abierto={fusionAbierta}
        idA={puedeFusionar ? idsSeleccionados[0] : null}
        idB={puedeFusionar ? idsSeleccionados[1] : null}
        onCancelar={() => setFusionAbierta(false)}
        onFusionado={() => {
          setFusionAbierta(false);
          limpiarSeleccion();
          toast.success("Contactos fusionados");
          setRecargar((n) => n + 1);
        }}
      />
      <PapeleraContactosModal
        abierto={papeleraAbierta}
        onCerrar={() => setPapeleraAbierta(false)}
        onCambio={() => setRecargar((n) => n + 1)}
      />
      {/* Las dos comparten el MISMO contrato de selección que archivar y fusionar, así que en modo
          "seleccionar el total" actúan sobre el conjunto que el usuario vio, no sobre otro. */}
      <AsignarResponsableModal
        abierto={responsableAbierto}
        seleccion={seleccionApi()}
        cuantos={nSeleccionados}
        onCerrar={() => setResponsableAbierto(false)}
        onHecho={() => { setResponsableAbierto(false); limpiarSeleccion(); setRecargar((n) => n + 1); }}
      />
      <AgregarTareaMasivaModal
        abierto={tareaMasivaAbierta}
        seleccion={seleccionApi()}
        cuantos={nSeleccionados}
        onCerrar={() => setTareaMasivaAbierta(false)}
        onHecho={() => { setTareaMasivaAbierta(false); limpiarSeleccion(); }}
      />
      <ConfirmarArchivadoModal
        abierto={confirmarArchivado}
        seleccion={confirmarArchivado ? seleccionApi() : null}
        onCancelar={() => setConfirmarArchivado(false)}
        onConfirmar={archivarSeleccion}
      />

      <AnimatePresence>
        {modal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-neutral-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-black/5 dark:border-white/10"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-2xl font-black">Nuevo contacto</h2>
                <button onClick={() => setModal(false)} className="h-9 w-9 rounded-xl hover:bg-black/5 flex items-center justify-center">
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Nombre completo *</label>
                  <input
                    value={form.nombre_completo}
                    onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })}
                    placeholder="María García"
                    className={inputCls}
                  />
                </div>
                {/* OPCIONAL desde el 2026-08-31, y por eso sin `*`: no impide guardar. Se queda
                    en el formulario —quien la sepa la escribe— y a quien le falte se le encuentra
                    con el filtro «Sin fecha de nacimiento» del listado.
                    `DateField` es el selector que ya usa la ficha del contacto —calendario con
                    navegacion por mes y anio— y no se toca: aqui solo se usa. `maxDate` en hoy
                    porque nadie nace maniana, y al teclear el anio es facil dejarse un digito. */}
                <div>
                  <label className={labelCls}>Fecha de nacimiento</label>
                  <DateField
                    value={form.fecha_nacimiento}
                    onChange={(v) => setForm({ ...form, fecha_nacimiento: v })}
                    maxDate={new Date()}
                    placeholder="Selecciona la fecha"
                    typeable
                  />
                </div>
                <div>
                  <label className={labelCls}>Email *</label>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => { setForm({ ...form, email: e.target.value }); if (emailErr) setEmailErr(null); }}
                    // Al salir del campo, si el email no tiene forma de email se dice AQUI y no solo
                    // en el `title` del boton: un boton apagado sin motivo visible es un callejon
                    // sin salida pequenio. El criterio es el mismo modulo, no otro (§4.8).
                    onBlur={() => setEmailErr(queFaltaParaElAlta(datosDeAlta) === EMAIL_NO_VALIDO ? EMAIL_NO_VALIDO : null)}
                    placeholder="maria@email.com"
                    className={cn(inputCls, emailErr && "border-red-400 focus:border-red-400 focus:ring-red-200")}
                  />
                  {emailErr && <p className="text-[11px] text-red-500 mt-1">{emailErr}</p>}
                </div>
                <div>
                  <label className={labelCls}>Teléfono *</label>
                  <div className="flex gap-2">
                    <select value={form.telPais} onChange={(e) => setForm({ ...form, telPais: e.target.value })} className={selCls} title="Código de país">
                      {COUNTRIES.map((p) => (<option key={p.code} value={p.code}>{p.code} {p.dial}</option>))}
                    </select>
                    <input
                      value={formatPhone(form.telefono, dialOf(form.telPais))}
                      onChange={(e) => setForm({ ...form, telefono: e.target.value.replace(/\D/g, "") })}
                      inputMode="tel"
                      placeholder="305 555 1234"
                      className="flex-1 min-w-0 h-11 px-4 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-white/10 focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange/60 transition"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-ui font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">WhatsApp</label>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, whatsapp: form.telefono, waPais: form.telPais })}
                      className="text-[10px] font-ui font-bold text-brand-orange hover:underline"
                    >
                      Igual al teléfono
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <select value={form.waPais} onChange={(e) => setForm({ ...form, waPais: e.target.value })} className={selCls} title="Código de país">
                      {COUNTRIES.map((p) => (<option key={p.code} value={p.code}>{p.code} {p.dial}</option>))}
                    </select>
                    <input
                      value={formatPhone(form.whatsapp, dialOf(form.waPais))}
                      onChange={(e) => setForm({ ...form, whatsapp: e.target.value.replace(/\D/g, "") })}
                      inputMode="tel"
                      placeholder="305 555 1234"
                      className="flex-1 min-w-0 h-11 px-4 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-white/10 focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange/60 transition"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Estatus migratorio</label>
                  <input
                    value={form.estatus_migratorio}
                    onChange={(e) => setForm({ ...form, estatus_migratorio: e.target.value })}
                    placeholder="Residente, Ciudadano, TPS..."
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button onClick={() => setModal(false)} className="flex-1 h-11 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-white font-ui text-xs font-bold uppercase tracking-wider hover:bg-neutral-200 dark:hover:bg-white/10 transition">
                  Cancelar
                </button>
                {/* Deshabilitado mientras falte alguno de los campos marcados con *. Se prefiere a
                    dejarlo pulsable y contestar con un error: el boton apagado dice que falta algo
                    ANTES de intentarlo. El motivo del `title` sale del MISMO calculo que el
                    `disabled` (§4.8), asi que no pueden discrepar. */}
                <button
                  onClick={save}
                  disabled={saving || !sePuedeDarDeAlta(datosDeAlta)}
                  title={queFaltaParaElAlta(datosDeAlta) || undefined}
                  className="flex-1 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? "Guardando…" : "Crear"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
