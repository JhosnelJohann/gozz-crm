"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, CheckSquare, Sparkles, Search, Filter, X, AlertTriangle, Clock, LayoutList, LayoutGrid, UserCircle2, CalendarClock } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";
import { TaskCard, type TareaRow } from "@/components/tareas/TaskCard";
import { TaskModal } from "@/components/tareas/TaskModal";
import { KanbanTareas } from "@/components/tareas/KanbanTareas";
import { TareasPorFecha } from "@/components/tareas/TareasPorFecha";
import { FancySelect } from "@/components/ui/FancySelect";
import { DateRangePopover, type DateRange } from "@/components/ui/DateRangePopover";
import {
  consultaDeTareas, vinculoGuardado, ETIQUETAS_VINCULO, VINCULOS, VINCULO_POR_DEFECTO,
  CLAVE_VINCULO, type Vinculo, type FiltrosDeTareas,
} from "@/lib/tareas-consulta";

type Scope = "mine" | "all";
type PrioridadFilter = "todas" | "baja" | "normal" | "alta" | "urgente";
type EstadoFilter = "todas" | "activas" | "vencidas" | "completadas";
type Vista = "lista" | "kanban" | "fechas";

export default function TareasPage() {
  const { isAdmin, user } = useCurrentUser();
  const [list, setList] = useState<TareaRow[] | null>(null);
  const [counts, setCounts] = useState<{ pendientes?: number; en_progreso?: number; completadas?: number; vencidas?: number }>({});
  const [completadas, setCompletadas] = useState<TareaRow[]>([]);  // columna "Completadas" de los tableros
  /**
   * 🔴 Las CANCELADAS se piden aparte, igual que las completadas — y hasta ahora nadie las pedia.
   *
   * El listado por defecto excluye `completada` Y `cancelada` (`tareas-routes.ts`: son 25.000+
   * filas y esta por rendimiento). La pantalla compensaba SOLO LA MITAD: habia `loadCompletadas`
   * y no habia equivalente para las canceladas. Resultado en produccion: arrastrabas una tarea a
   * «Cancelada», el PATCH funcionaba, y la tarjeta **se esfumaba** — la columna seguia marcando 0
   * y no habia forma de devolverla. El dato estaba intacto en la base, pero para quien la arrastro
   * era indistinguible de haberla perdido.
   */
  const [canceladas, setCanceladas] = useState<TareaRow[]>([]);
  const [scope, setScope] = useState<Scope>("mine");
  const [asUserId, setAsUserId] = useState<string>("");  // admin: ver tareas de otro usuario
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [prioridadFilter, setPrioridadFilter] = useState<PrioridadFilter>("todas");
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>("activas");
  const [searchQ, setSearchQ] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });
  const [vista, setVista] = useState<Vista>("fechas");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * Filtro por CLIENTE. Entra por la URL (`/tareas?contacto=<id>`), que es el enlace que sale de
   * la ficha del contacto. El nombre no viaja en la URL: se lee de las tareas que vuelven, que ya
   * lo traen resuelto — así no se puede enseñar un nombre que no case con lo que se está listando.
   */
  const [contactoFiltro, setContactoFiltro] = useState<string>("");
  /**
   * Qué relación mía con la tarea se está mirando. Por defecto, las que creé Y las que tengo
   * asignadas — hasta el 2026-09-02 solo se veían las asignadas, así que al delegar una tarea
   * desaparecía de la pantalla de quien la encargó.
   */
  const [vinculo, setVinculo] = useState<Vinculo>(VINCULO_POR_DEFECTO);

  // 🔴 La preferencia se lee en un EFECTO, no en el estado inicial: leer `localStorage` al
  // construir el estado rompe la hidratación —el servidor pinta una cosa y el cliente otra en el
  // primer render—. Mismo patrón que la vista de documentos del contacto.
  useEffect(() => {
    setVinculo(vinculoGuardado(() => window.localStorage.getItem(CLAVE_VINCULO)));
  }, []);

  const cambiarVinculo = (v: Vinculo) => {
    setVinculo(v);
    // Preferencia de quien mira, no dato de negocio: no merece ni columna ni endpoint.
    try { window.localStorage.setItem(CLAVE_VINCULO, v); } catch { /* modo incógnito, da igual */ }
  };

  useEffect(() => {
    // Lo necesitan tanto admins (pestaña "Todas" + dropdown) como usuarios normales
    // (dropdown "Ver tareas de…" restringido a las tareas que los involucran).
    fetch("/api/chat/contactos").then((r) => r.json()).then((d) => setUsuarios(d.contactos || []));
  }, []);

  // 🔴 Los filtros de las TRES cargas se construyen en un solo sitio (`lib/tareas-consulta.ts`).
  // Estaban escritos tres veces y ya se pagó dos veces el mismo error: añadir un filtro, pasárselo
  // a la lista y dejar las columnas de completadas y canceladas trayendo lo de todo el mundo. No
  // falla ruidosamente — las columnas se pintan igual de bien, con tareas que no tocaban.
  const filtros: FiltrosDeTareas = useMemo(
    () => ({ scope, vinculo, asUserId, contactoId: contactoFiltro, q: searchQ, estadoFiltro: estadoFilter }),
    [scope, vinculo, asUserId, contactoFiltro, searchQ, estadoFilter]
  );

  const load = useCallback(async () => {
    const r = await fetch(`/api/tareas?${consultaDeTareas(filtros).toString()}`);
    if (r.status === 403) {
      toast.error("No tienes permiso para ver todas las tareas");
      setScope("mine");
      return;
    }
    if (r.status === 400) {
      // Solo puede venir de un `vinculo` que el servidor no reconoce. Se dice y se vuelve al de
      // siempre, en vez de dejar la pantalla en blanco sin explicación.
      const d = await r.json().catch(() => ({}));
      toast.error(typeof d?.error === "string" ? d.error : "No se pudo aplicar el filtro");
      setVinculo(VINCULO_POR_DEFECTO);
      return;
    }
    const d = await r.json();
    setList(d.tareas || []);
    if (d.counts) setCounts(d.counts);
  }, [filtros]);

  // Carga (con debounce para no refetch en cada tecla de la búsqueda).
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  // Completadas: solo se piden cuando la vista "por fechas" está activa (el backend las excluye por defecto).
  const loadCompletadas = useCallback(async () => {
    if (vista !== "fechas" && vista !== "kanban") return;
    const r = await fetch(`/api/tareas?${consultaDeTareas(filtros, "completada").toString()}`);
    if (!r.ok) return;
    const d = await r.json();
    setCompletadas(d.tareas || []);
  }, [vista, filtros]);

  useEffect(() => {
    const t = setTimeout(() => { loadCompletadas(); }, 300);
    return () => clearTimeout(t);
  }, [loadCompletadas]);

  // Canceladas: espejo exacto de `loadCompletadas`, incluida la condicion de vista.
  // ⚠️ EL `if` DE ARRIBA ES EL QUE PROTEGE EL RENDIMIENTO: en modo lista no se piden, igual que no
  // se piden las completadas. La exclusion del backend NO se toca — lo que faltaba era esta mitad.
  const loadCanceladas = useCallback(async () => {
    if (vista !== "fechas" && vista !== "kanban") return;
    const r = await fetch(`/api/tareas?${consultaDeTareas(filtros, "cancelada").toString()}`);
    if (!r.ok) return;
    const d = await r.json();
    setCanceladas(d.tareas || []);
  }, [vista, filtros]);

  useEffect(() => {
    const t = setTimeout(() => { loadCanceladas(); }, 300);
    return () => clearTimeout(t);
  }, [loadCanceladas]);

  // Recarga combinada tras crear/editar/completar/cancelar. Las tres, o al cancelar una tarea
  // volveria a desaparecer hasta la siguiente recarga completa.
  const reload = useCallback(() => { load(); loadCompletadas(); loadCanceladas(); }, [load, loadCompletadas, loadCanceladas]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id && id !== "nueva") {
      setEditingId(id);
      setModalOpen(true);
    }
    const contacto = params.get("contacto");
    if (contacto) setContactoFiltro(contacto);
  }, []);

  const filtered = useMemo(() => {
    if (!list) return null;
    const q = searchQ.trim().toLowerCase();
    const now = new Date();
    return list.filter((t) => {
      if (prioridadFilter !== "todas" && t.prioridad !== prioridadFilter) return false;
      if (estadoFilter === "activas" && t.estado === "completada") return false;
      if (estadoFilter === "completadas" && t.estado !== "completada") return false;
      if (estadoFilter === "vencidas") {
        if (t.estado === "completada") return false;
        if (!t.fecha_limite || new Date(t.fecha_limite) >= now) return false;
      }
      if (q) {
        const hay = (t.titulo + " " + (t.descripcion || "") + " " + (t.oportunidad_nombre || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateRange.from || dateRange.to) {
        if (!t.fecha_limite) return false;
        const d = new Date(t.fecha_limite);
        if (dateRange.from && d < dateRange.from) return false;
        if (dateRange.to && d > dateRange.to) return false;
      }
      return true;
    });
  }, [list, prioridadFilter, estadoFilter, searchQ, dateRange]);

  // Los mismos filtros (prioridad/fecha/búsqueda) que la lista activa, aplicados a las columnas
  // que se cargan aparte. Se escribe UNA vez: son dos columnas y serian dos copias de lo mismo.
  const filtrarComoLaLista = useCallback((filas: TareaRow[]) => {
    const q = searchQ.trim().toLowerCase();
    return filas.filter((t) => {
      if (prioridadFilter !== "todas" && t.prioridad !== prioridadFilter) return false;
      if (q) {
        const hay = (t.titulo + " " + (t.descripcion || "") + " " + (t.oportunidad_nombre || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateRange.from || dateRange.to) {
        if (!t.fecha_limite) return false;
        const d = new Date(t.fecha_limite);
        if (dateRange.from && d < dateRange.from) return false;
        if (dateRange.to && d > dateRange.to) return false;
      }
      return true;
    });
  }, [prioridadFilter, searchQ, dateRange]);

  const filteredCompletadas = useMemo(() => filtrarComoLaLista(completadas), [completadas, filtrarComoLaLista]);
  const filteredCanceladas = useMemo(() => filtrarComoLaLista(canceladas), [canceladas, filtrarComoLaLista]);

  const toggleDone = async (t: TareaRow) => {
    const newState = t.estado === "completada" ? "pendiente" : "completada";
    const r = await fetch(`/api/tareas/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: newState })
    });
    if (r.ok) reload();
  };

  const onOpen = (t: TareaRow) => { setEditingId(t.id); setModalOpen(true); };
  const onNew = () => { setEditingId(null); setModalOpen(true); };

  // Stats desde los conteos del backend (sobre TODO el universo del scope), no desde la lista cargada
  // (que ahora trae solo lo necesario para que el CRM cargue rápido).
  const stats = useMemo(() => ({
    pendientes: counts.pendientes || 0,
    enProgreso: counts.en_progreso || 0,
    vencidas: counts.vencidas || 0,
    completadas: counts.completadas || 0,
  }), [counts]);

  /**
   * El nombre del cliente filtrado sale de las tareas que han vuelto, que ya lo traen resuelto. No
   * viaja en la URL a propósito: un nombre puesto ahí a mano podría no ser el del id que filtra, y
   * la pantalla estaría diciendo que enseña las tareas de alguien que no es. Si no hay ninguna
   * tarea, no se enseña el uuid (§4.7): se dice que no hay.
   */
  const nombreContactoFiltrado = useMemo(() => {
    if (!contactoFiltro) return "";
    const todas = [...(list || []), ...completadas, ...canceladas];
    return todas.find((t) => t.contacto_id === contactoFiltro)?.contacto_nombre || "";
  }, [contactoFiltro, list, completadas, canceladas]);

  const hasFilters = prioridadFilter !== "todas" || estadoFilter !== "activas" || searchQ.trim().length > 0 || !!(dateRange.from || dateRange.to);
  const clearFilters = () => { setPrioridadFilter("todas"); setEstadoFilter("activas"); setSearchQ(""); setDateRange({ from: null, to: null }); };

  return (
    <AppShell>
      <div className={cn("mx-auto px-4 sm:px-6 py-6 sm:py-10", vista === "fechas" ? "max-w-[1800px]" : "max-w-6xl")}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="mb-8 flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.12em] mb-3">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              Productividad
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-black leading-tight tracking-tight">
              <span className="text-gradient-orange">Tareas</span>
            </h1>
            <p className="mt-3 text-neutral-500 text-[15px]">
              {list === null ? "Cargando…" : (
                <>
                  {asUserId && (() => {
                    const u = usuarios.find((x) => x.id === asUserId);
                    return u ? <span className="inline-flex items-center gap-1.5 mr-2 px-2 py-0.5 rounded-full bg-brand-orange/10 text-brand-orange text-[12px] font-semibold"><UserCircle2 className="h-3 w-3" strokeWidth={2} />{u.nombre}</span> : null;
                  })()}
                  <strong className="text-neutral-800">{stats.pendientes}</strong> pendientes
                  {stats.vencidas > 0 && <> · <strong className="text-brand-red">{stats.vencidas}</strong> vencidas</>}
                  {" · "}{stats.completadas} completadas
                </>
              )}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={onNew}
            className="gradient-orange flex items-center gap-2 h-12 px-6 rounded-2xl font-ui text-xs font-bold uppercase tracking-[0.1em] text-white shadow-lg shadow-brand-orange/30 hover:shadow-xl hover:shadow-brand-orange/40 transition-shadow"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Nueva tarea
          </motion.button>
        </motion.div>

        {/* Filtro por cliente: se ve que está puesto y cómo se quita. Un filtro invisible hace que
            la pantalla parezca vacía cuando en realidad está acotada. */}
        {contactoFiltro && (
          <div className="mb-5 flex items-center gap-2 flex-wrap rounded-2xl bg-brand-orange/10 border border-brand-orange/20 px-4 py-3">
            <UserCircle2 className="h-4 w-4 text-brand-orange shrink-0" strokeWidth={2} />
            <span className="text-[13px] text-neutral-700">
              Viendo solo las tareas de{" "}
              <strong className="text-brand-orange">
                {nombreContactoFiltrado || "un cliente sin tareas todavía"}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => setContactoFiltro("")}
              className="ml-auto h-8 px-3 rounded-xl bg-white/70 text-neutral-700 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-white transition-colors"
            >
              Quitar el filtro
            </button>
          </div>
        )}

        {/* Stats chips */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
        >
          <StatChip icon={Clock} label="Pendientes" value={stats.pendientes} color="#2196C9" />
          <StatChip icon={Sparkles} label="En progreso" value={stats.enProgreso} color="#5750E8" pulse />
          <StatChip icon={AlertTriangle} label="Vencidas" value={stats.vencidas} color="#E53935" />
          <StatChip icon={CheckSquare} label="Completadas" value={stats.completadas} color="#43A847" />
        </motion.div>

        {/* Toolbar: tabs scope + search + filters */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-white rounded-2xl border border-neutral-100 p-3 mb-5 flex items-center gap-2 flex-wrap shadow-sm"
        >
          {/* Scope tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100">
            <TabBtn active={scope === "mine" && !asUserId} onClick={() => { setScope("mine"); setAsUserId(""); }}>Mis tareas</TabBtn>
            {isAdmin && <TabBtn active={scope === "all"} onClick={() => { setScope("all"); setAsUserId(""); }}>Todas</TabBtn>}
          </div>

          {/* Ver tareas de otro usuario. Admin: todas las de esa persona.
              Usuario normal: solo las que lo involucran (backend lo restringe). */}
          <FancySelect
            value={asUserId}
            onChange={(v) => { setAsUserId(v); if (v) setScope("mine"); }}
            options={usuarios.filter((u) => u.id !== user?.id).map((u) => ({
              value: String(u.id),
              label: u.nombre,
              sub: u.email,
              avatar: u.foto_perfil_url,
              initials: u.nombre ? initialsOf(u.nombre) : "??"
            }))}
            placeholder="Ver tareas de..."
            label="De"
            icon={UserCircle2}
            width={280}
          />

          {/*
            Qué relación con la tarea. 🔴 NO se enseña en la pestaña «Todas»: ahí no hay una persona
            de referencia, así que el servidor lo ignora — y un desplegable que se puede tocar y no
            hace nada es peor que no tenerlo.
            «Creador» es la palabra que ya usa la ficha de la tarea; `propietario_id` no se enseña.
          */}
          {scope !== "all" && (
            <FancySelect
              value={vinculo}
              onChange={(v) => cambiarVinculo(v as Vinculo)}
              options={VINCULOS.map((v) => ({ value: v, label: ETIQUETAS_VINCULO[v] }))}
              placeholder="Por defecto"
              label="Ver"
              icon={Filter}
              searchable={false}
              width={200}
            />
          )}

          <div className="w-px h-7 bg-neutral-200 mx-1" />

          {/* Estado filter */}
          <div className="flex items-center gap-1">
            {(["activas", "vencidas", "completadas", "todas"] as EstadoFilter[]).map((e) => (
              <button
                key={e}
                onClick={() => setEstadoFilter(e)}
                className={cn(
                  "h-9 px-3 rounded-lg font-ui text-[10px] font-bold uppercase tracking-wider transition-all",
                  estadoFilter === e ? "bg-brand-orange/10 text-brand-orange" : "text-neutral-500 hover:bg-neutral-50"
                )}
              >
                {e}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Vista toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100">
            <button onClick={() => setVista("lista")} className={cn("h-7 w-9 rounded-lg flex items-center justify-center transition-all", vista === "lista" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-800")}>
              <LayoutList className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button onClick={() => setVista("kanban")} title="Tablero por estado" className={cn("h-7 w-9 rounded-lg flex items-center justify-center transition-all", vista === "kanban" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-800")}>
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button onClick={() => setVista("fechas")} title="Por fecha límite" className={cn("h-7 w-9 rounded-lg flex items-center justify-center transition-all", vista === "fechas" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-800")}>
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Buscar…"
              className="h-9 pl-9 pr-8 rounded-xl bg-neutral-50 border border-transparent text-sm outline-none transition-all focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20 w-48"
            />
            {searchQ && (
              <button onClick={() => setSearchQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-md hover:bg-neutral-200 flex items-center justify-center">
                <X className="h-3 w-3 text-neutral-500" />
              </button>
            )}
          </div>

          {/* Prioridad */}
          <select
            value={prioridadFilter}
            onChange={(e) => setPrioridadFilter(e.target.value as PrioridadFilter)}
            className="h-9 px-3 rounded-xl bg-neutral-50 border border-transparent text-sm outline-none transition-all focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
          >
            <option value="todas">Todas las prioridades</option>
            <option value="urgente">Urgente</option>
            <option value="alta">Alta</option>
            <option value="normal">Normal</option>
            <option value="baja">Baja</option>
          </select>

          {/* Fecha (rango) */}
          <DateRangePopover
            value={dateRange}
            onChange={setDateRange}
            placeholder="Fecha límite"
          />

          {hasFilters && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              onClick={clearFilters}
              className="h-9 px-3 rounded-xl text-[10px] font-ui font-bold uppercase tracking-wider text-brand-red hover:bg-red-50 flex items-center gap-1 transition-colors"
            >
              <X className="h-3 w-3" />
              Limpiar
            </motion.button>
          )}
        </motion.div>

        {/* Aviso si la lista viene truncada (para no aparentar que faltan tareas) */}
        {list && list.length >= 1000 && estadoFilter !== "completadas" && (
          <div className="mb-3 text-[11px] text-neutral-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Mostrando las <strong>1000</strong> tareas más relevantes (por vencimiento). Usa la <strong>búsqueda</strong> o los <strong>filtros</strong> para encontrar otras.
          </div>
        )}

        {/* Contenido: Lista o Kanban */}
        {filtered === null ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 h-20 skeleton border border-neutral-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-16 text-center border border-neutral-100"
          >
            <CheckSquare className="h-12 w-12 text-brand-orange mx-auto mb-4" strokeWidth={1.5} />
            <h3 className="font-display text-2xl font-black mb-1.5">
              {hasFilters ? "Sin resultados" : "Sin tareas"}
            </h3>
            <p className="text-neutral-500 text-sm mb-5">
              {hasFilters ? "Prueba ajustando los filtros" : "Crea la primera tarea para empezar"}
            </p>
            {!hasFilters && (
              <button onClick={onNew} className="gradient-orange h-10 px-5 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow inline-flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Nueva tarea
              </button>
            )}
          </motion.div>
        ) : vista === "kanban" ? (
          <KanbanTareas tareas={filtered} completadas={filteredCompletadas} canceladas={filteredCanceladas} onOpen={onOpen} onReload={reload} />
        ) : vista === "fechas" ? (
          <TareasPorFecha tareas={filtered} completadas={filteredCompletadas} canceladas={filteredCanceladas} onOpen={onOpen} onToggleDone={toggleDone} onReload={reload} />
        ) : (
          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {filtered.map((t, i) => (
                <TaskCard key={t.id} tarea={t} index={i} onToggleDone={toggleDone} onOpen={onOpen} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <TaskModal
        open={modalOpen}
        tareaId={editingId}
        onClose={() => { setModalOpen(false); setEditingId(null); }}
        onSaved={reload}
      />
    </AppShell>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-9 px-4 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition-all",
        active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
      )}
    >
      {children}
    </button>
  );
}

function StatChip({ icon: Icon, label, value, color, pulse }: { icon: any; label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="bg-white rounded-2xl border border-neutral-100 px-4 py-3 flex items-center gap-3 transition-shadow hover:shadow-md"
    >
      <motion.div
        className="h-10 w-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: `${color}15`, color }}
        animate={pulse ? { scale: [1, 1.05, 1] } : undefined}
        transition={pulse ? { duration: 2, repeat: Infinity } : undefined}
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </motion.div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">{label}</div>
        <div className="text-xl font-black font-display leading-none mt-0.5" style={{ color }}>{value}</div>
      </div>
    </motion.div>
  );
}
