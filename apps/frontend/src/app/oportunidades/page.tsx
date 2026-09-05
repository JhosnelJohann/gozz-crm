"use client";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor,
  useSensor, useSensors, useDraggable, useDroppable
} from "@dnd-kit/core";
import Tilt from "react-parallax-tilt";
import { Plus, CurrencyDollar, User, Sparkle, X, ArrowSquareOut, CheckSquare, ChatCircle, PhoneCall } from "@/lib/bootstrap-icons";
import { Search, FileText, UserCircle2, AlertTriangle, Sparkles as SparklesLI, Filter, Loader2, ChevronRight, ChevronLeft, LayoutGrid, List, CalendarDays } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { SLABadge } from "@/components/ui/SLABadge";
import { Spotlight } from "@/components/magic/Spotlight";
import { ShimmerButton } from "@/components/magic/ShimmerButton";
import { useStages, PipelineStage } from "@/lib/pipeline";
import { FancySelect } from "@/components/ui/FancySelect";
import { ContactoPicker } from "@/components/oportunidad/ContactoPicker";
import { HorizontalScrollArea } from "@/components/ui/HorizontalScrollArea";
import { Pagination } from "@/components/ui/Pagination";
import { DateRangePopover, PAST_PRESETS, type DateRange } from "@/components/ui/DateRangePopover";
import { CambioEtapaModal } from "@/components/oportunidades/CambioEtapaModal";
import { ExportarModal } from "@/components/oportunidades/ExportarModal";
import { initialsOf } from "@/lib/auth-user";
import { cn } from "@/lib/utils";
import { useOportunidadesStore, FILTROS_VACIOS, type OportunidadesFiltros } from "@/features/oportunidades/store";

interface Oportunidad {
  id: string;
  nombre_caso: string;
  etapa: string;
  valor_total: string;
  sla_estado: "on_track" | "warning" | "vencido" | "completado";
  sla_fecha_limite: string | null;
  contacto_nombre: string | null;
  contacto_id: string | null;
  tramite_nombre: string | null;
  tramite_codigo: string | null;
  formulario_uscis: string | null;
  tramite_color: string | null;
  preparador_nombre: string | null;
  preparador_avatar: string | null;
  preparador_id: string | null;
  vendedor_id: string | null;
  tipo_tramite_id: string | null;
  tareas_pendientes: number;
  created_at: string;
}

function DraggableCard({ op, onOpen }: { op: Oportunidad; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: op.id });
  const color = op.tramite_color || "#5C6670";
  const tramiteLabel = op.formulario_uscis || op.tramite_codigo || "";
  const tramiteNombre = op.tramite_nombre || "";
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onDoubleClick={onOpen} className={isDragging ? "opacity-30" : ""}>
      <Tilt
        tiltMaxAngleX={4}
        tiltMaxAngleY={4}
        glareEnable={true}
        glareMaxOpacity={0.12}
        glareColor={color}
        glarePosition="all"
        scale={1.015}
        perspective={1000}
        transitionSpeed={500}
      >
        <Spotlight className="relative glass rounded-2xl cursor-grab active:cursor-grabbing transition-all group hover:shadow-glow-lg overflow-hidden">
          {/* Franja de color por trámite */}
          <div
            className="h-1.5 w-full"
            style={{ background: `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)` }}
            title={tramiteNombre}
          />
          <div className="p-4">
            <button
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="absolute top-3 right-2 opacity-0 group-hover:opacity-100 h-7 w-7 rounded-lg bg-white/80 dark:bg-white/10 hover:bg-brand-orange hover:text-white flex items-center justify-center transition z-10"
              title="Abrir detalle"
            >
              <ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />
            </button>
            <div className="flex items-start justify-between gap-2 mb-2 pr-8">
              <div className="font-display font-black text-sm leading-tight line-clamp-2 flex-1">
                {op.nombre_caso}
              </div>
            </div>
            {(tramiteLabel || tramiteNombre) && (
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                  style={{ background: color }}
                >
                  {tramiteLabel}
                </span>
                {tramiteNombre && (
                  <span className="text-[10px] text-neutral-600 dark:text-neutral-400 truncate flex-1">
                    {tramiteNombre}
                  </span>
                )}
              </div>
            )}
            {op.contacto_nombre && (
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 mb-2">
                <User className="h-3 w-3 text-neutral-400" weight="duotone" />
                <span className="truncate">{op.contacto_nombre}</span>
              </div>
            )}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/5 dark:border-white/5 gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                {Number(op.valor_total) > 0 && (
                  <div className="flex items-center gap-0.5 text-[11px] font-ui font-bold text-brand-green tabular-nums">
                    <CurrencyDollar className="h-3 w-3" weight="bold" />
                    {Number(op.valor_total).toFixed(0)}
                  </div>
                )}
                {op.tareas_pendientes > 0 && (
                  <div className="flex items-center gap-0.5 text-[11px] font-ui font-bold text-brand-orange tabular-nums" title={`${op.tareas_pendientes} tareas pendientes`}>
                    <CheckSquare className="h-3 w-3" weight="duotone" />
                    {op.tareas_pendientes}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {op.preparador_nombre && (
                  <div
                    className="h-5 w-5 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta text-[9px] font-bold text-white flex items-center justify-center shrink-0"
                    title={`Preparador: ${op.preparador_nombre}`}
                  >
                    {op.preparador_avatar ? (
                      <img src={op.preparador_avatar} alt={op.preparador_nombre} className="h-full w-full object-cover" />
                    ) : (
                      op.preparador_nombre.split(" ").map((s) => s[0]).slice(0, 2).join("")
                    )}
                  </div>
                )}
                <SLABadge estado={op.sla_estado} fechaLimite={op.sla_fecha_limite} />
              </div>
            </div>
          </div>
        </Spotlight>
      </Tilt>
    </div>
  );
}

function DroppableColumn({ stage, children, count }: { stage: PipelineStage; children: React.ReactNode; count: number }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.key });
  return (
    <div
      className={`rounded-2xl p-3 transition-all relative flex flex-col ${isOver ? "ring-2 ring-brand-orange/40 bg-brand-orange/[0.04]" : "bg-black/[0.02] dark:bg-white/[0.02]"}`}
      style={{ height: "calc(100vh - 320px)", minHeight: 500 }}
    >
      {isOver && (
        <div className="absolute inset-0 rounded-2xl pointer-events-none z-0" style={{
          background: "radial-gradient(ellipse at center, rgba(87,80,232,0.15) 0%, transparent 70%)"
        }} />
      )}
      <div className="relative flex items-center justify-between mb-3 px-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: stage.color, color: stage.color }} />
          <div className="font-ui text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-700 dark:text-neutral-300">
            {stage.label}
          </div>
        </div>
        <div className="font-ui text-[10px] font-bold text-neutral-400 tabular-nums bg-white/40 dark:bg-white/5 rounded-full px-2 py-0.5">{count}</div>
      </div>
      <div
        ref={setNodeRef}
        className="relative space-y-3 overflow-y-auto overflow-x-hidden flex-1 px-1 -mx-1 column-scrollbar"
        style={{ overscrollBehavior: "contain" }}
        onWheel={(e) => {
          // Permitir scroll vertical dentro de la columna sin propagar al kanban horizontal
          const el = e.currentTarget as HTMLDivElement;
          const canScrollDown = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
          const canScrollUp = el.scrollTop > 0;
          if ((e.deltaY > 0 && canScrollDown) || (e.deltaY < 0 && canScrollUp)) {
            e.stopPropagation();
          }
        }}
      >
        {children}
        {/* Padding bottom para drop al final */}
        <div className="h-2" />
      </div>
      <style jsx>{`
        .column-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .column-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .column-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.15);
          border-radius: 4px;
        }
        .column-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.3);
        }
        .column-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(0,0,0,0.15) transparent;
        }
      `}</style>
    </div>
  );
}

// ────────── Filtros ──────────
// El tipo y el valor vacío viven en `features/oportunidades/store.ts` (estado de UI del slice);
// aquí solo queda la migración de lo que ya hubiera en `localStorage` de una versión anterior.

/** Lo guardado puede ser de una versión anterior y no traer las claves nuevas: se completa. */
const normalizarFiltros = (v: any): OportunidadesFiltros => ({
  ...FILTROS_VACIOS,
  ...(v && typeof v === "object" ? v : {}),
  campoFecha: v?.campoFecha === "fecha_completada" ? "fecha_completada" : "created_at",
});

function FilterBar({ value, onChange, tramites, users, meId, total, filtered }: { value: OportunidadesFiltros; onChange: (v: OportunidadesFiltros) => void; tramites: any[]; users: any[]; meId: string | null; total?: number; filtered?: number; }) {
  // 🔴 "Sin trámite" es una opción propia, no un hueco.
  //
  // Medido en producción: 242 oportunidades no tienen `tipo_tramite_id`, y **223 de ellas están en
  // GANADO**. Como el desplegable solo ofrecía trámites concretos, no aparecían bajo ningún filtro:
  // nadie podía encontrarlas para corregirlas, y mientras no tengan trámite no se pueden segmentar
  // para ninguna campaña — son invisibles para el negocio.
  //
  // No se esconde aunque el conteo sea alto y no se mezcla con ningún trámite concreto. Es la misma
  // idea que el "sin usuario registrado" de la papelera de contactos: se enseña el hueco.
  // Con "Todos los trámites" esas filas SÍ salen; solo desaparecen al elegir un trámite concreto,
  // que es lo correcto.
  const tramiteOpts = useMemo(() => ([
    { value: "sin_tramite", label: "Sin trámite", sub: "no se pueden segmentar", icon: AlertTriangle },
    ...(tramites || []).map((t: any) => ({
      value: String(t.id),
      label: t.nombre || t.codigo,
      sub: t.formulario_uscis || t.codigo,
      icon: FileText
    })),
  ]), [tramites]);

  const userOpts = useMemo(() => (users || []).map((u: any) => ({
    value: String(u.id),
    label: u.nombre,
    sub: u.email,
    avatar: u.foto_perfil_url,
    initials: u.nombre ? initialsOf(u.nombre) : "??"
  })), [users]);

  const slaOpts = [
    { value: "on_track", label: "A tiempo", color: "#43A847" },
    { value: "warning", label: "Por vencer", color: "#FFB51C" },
    { value: "vencido", label: "Vencido", color: "#E53935" }
  ];

  // Qué fecha se filtra. El aviso de "no se pueden segmentar" no está aquí sino en el banner, que
  // es donde va con el número real; aquí solo se advierte de que la fecha de ganado escasea.
  const campoFechaOpts = [
    { value: "created_at", label: "Fecha de creación", sub: "cuándo se abrió el caso", icon: CalendarDays },
    { value: "fecha_completada", label: "Fecha de ganado", sub: "la tiene una minoría", icon: AlertTriangle },
  ];

  // El rango vive en el estado como ISO; el popover lo quiere como `Date`.
  const rango: DateRange = useMemo(() => ({
    from: value.desde ? new Date(value.desde) : null,
    to: value.hasta ? new Date(value.hasta) : null,
  }), [value.desde, value.hasta]);

  const setRango = (r: DateRange) => onChange({
    ...value,
    desde: r.from ? r.from.toISOString() : "",
    hasta: r.to ? r.to.toISOString() : "",
  });

  const hayRango = !!(value.desde || value.hasta);
  const activos = [value.q, value.tramite, value.asignado, value.sla, value.soloMios ? "mine" : "", hayRango ? "fecha" : ""].filter(Boolean).length;
  const allClear = activos === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
      className="relative mb-4"
    >
      {/* Glow border cuando hay filtros */}
      {!allClear && (
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-brand-orange/40 via-amber-400/40 to-brand-orange/40 blur-sm opacity-60 pointer-events-none" />
      )}

      <div className={cn(
        "relative rounded-2xl border bg-white shadow-sm transition-all",
        allClear ? "border-neutral-100" : "border-brand-orange/30 shadow-md"
      )}>
        {/* Row 1: search + filtros principales */}
        <div className="flex items-center gap-2 p-2.5 flex-wrap">
          {/* Search hero */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <div className={cn(
              "absolute left-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg flex items-center justify-center transition-all pointer-events-none",
              value.q ? "bg-brand-orange/15 text-brand-orange" : "text-neutral-400"
            )}>
              <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
            </div>
            <input
              value={value.q}
              onChange={(e) => onChange({ ...value, q: e.target.value })}
              placeholder="Buscar por nombre, ID o trámite…"
              className={cn(
                "h-11 pl-12 pr-10 w-full rounded-xl border-2 text-[13px] outline-none transition-all font-medium",
                value.q
                  ? "bg-gradient-to-r from-orange-50/50 to-amber-50/50 border-brand-orange/30 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                  : "bg-neutral-50/80 border-transparent hover:border-neutral-200 focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
              )}
            />
            {value.q && (
              <button
                onClick={() => onChange({ ...value, q: "" })}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg hover:bg-red-50 hover:text-brand-red flex items-center justify-center text-neutral-400 transition-colors"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="w-px h-8 bg-gradient-to-b from-transparent via-neutral-200 to-transparent" />

          {/* Filtros */}
          <FancySelect
            value={value.tramite}
            onChange={(v) => onChange({ ...value, tramite: v })}
            options={tramiteOpts}
            placeholder="Todos los trámites"
            label="Trámite"
            icon={FileText}
            width={300}
          />

          <FancySelect
            value={value.asignado}
            onChange={(v) => onChange({ ...value, asignado: v })}
            options={userOpts}
            placeholder="Cualquier asignado"
            label="Asignado"
            icon={UserCircle2}
            width={260}
          />

          <FancySelect
            value={value.sla}
            onChange={(v) => onChange({ ...value, sla: v })}
            options={slaOpts}
            placeholder="Todos los SLA"
            label="SLA"
            icon={AlertTriangle}
            searchable={false}
            width={180}
          />

          <div className="w-px h-8 bg-gradient-to-b from-transparent via-neutral-200 to-transparent" />

          {/* Rango de fechas + sobre QUÉ fecha corre. El popover es el mismo de la papelera del
              Drive, con `PAST_PRESETS`: el borde del rango (`endOfDay`, 23:59:59.999) ya está
              resuelto ahí y no se reimplementa — reimplementarlo es cómo se pierde el último día. */}
          <FancySelect
            value={value.campoFecha}
            onChange={(v) => onChange({ ...value, campoFecha: (v === "fecha_completada" ? "fecha_completada" : "created_at") })}
            options={campoFechaOpts}
            placeholder="Fecha de creación"
            label="Filtrar por"
            icon={CalendarDays}
            searchable={false}
            width={240}
          />

          <DateRangePopover
            value={rango}
            onChange={setRango}
            presets={PAST_PRESETS}
            placeholder={value.campoFecha === "fecha_completada" ? "Ganado entre…" : "Creado entre…"}
          />

          <div className="w-px h-8 bg-gradient-to-b from-transparent via-neutral-200 to-transparent" />

          {/* Mis casos toggle */}
          {meId && (
            <motion.button
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: value.soloMios ? 1.02 : 1.01 }}
              onClick={() => onChange({ ...value, soloMios: !value.soloMios })}
              className={cn(
                "h-11 px-4 rounded-xl text-[11px] font-ui font-black uppercase tracking-[0.12em] flex items-center gap-2 transition-all relative overflow-hidden",
                value.soloMios
                  ? "bg-gradient-to-br from-brand-orange to-amber-500 text-white shadow-lg shadow-brand-orange/30 ring-2 ring-brand-orange/40 ring-offset-2 ring-offset-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              )}
            >
              {value.soloMios && (
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent pointer-events-none" />
              )}
              <SparklesLI className="h-3.5 w-3.5 relative" strokeWidth={2.4} />
              <span className="relative">Mis casos</span>
              {value.soloMios && <span className="relative h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
            </motion.button>
          )}

          <div className="flex-1 min-w-[40px]" />

          {/* Counter + clear */}
          <div className="flex items-center gap-3 pr-1">
            {typeof filtered === "number" && typeof total === "number" && (
              <div className="text-[11px] font-ui font-bold text-neutral-500 tabular-nums">
                {filtered === total ? (
                  <span><span className="text-neutral-900">{total}</span> casos</span>
                ) : (
                  <span><span className="text-brand-orange">{filtered}</span> de {total}</span>
                )}
              </div>
            )}
            <AnimatePresence>
              {!allClear && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.85, x: 8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.85, x: 8 }}
                  className="flex items-center gap-1.5"
                >
                  <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-gradient-to-r from-brand-orange/10 to-amber-500/10 border border-brand-orange/20">
                    <Filter className="h-3 w-3 text-brand-orange" strokeWidth={2.5} />
                    <span className="text-[10px] font-ui font-black tabular-nums text-brand-orange">{activos}</span>
                  </div>
                  <button
                    onClick={() => onChange({ ...FILTROS_VACIOS })}
                    className="h-8 px-3 rounded-lg text-[10px] font-ui font-black uppercase tracking-wider text-brand-red hover:bg-red-50 hover:shadow-sm flex items-center gap-1 transition-all border border-transparent hover:border-red-200"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} /> Limpiar
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Row 2: Quick filters chips (SLA shortcuts) */}
        <div className="border-t border-neutral-100 px-3 py-2 flex items-center gap-2 flex-wrap bg-neutral-50/30 rounded-b-2xl">
          <span className="text-[9px] font-ui font-black uppercase tracking-[0.15em] text-neutral-400">Atajos:</span>
          <QuickChip
            active={value.sla === "vencido"}
            color="#E53935"
            label="Vencidos"
            onClick={() => onChange({ ...value, sla: value.sla === "vencido" ? "" : "vencido" })}
          />
          <QuickChip
            active={value.sla === "warning"}
            color="#FFB51C"
            label="Por vencer"
            onClick={() => onChange({ ...value, sla: value.sla === "warning" ? "" : "warning" })}
          />
          <QuickChip
            active={value.sla === "on_track"}
            color="#43A847"
            label="A tiempo"
            onClick={() => onChange({ ...value, sla: value.sla === "on_track" ? "" : "on_track" })}
          />
          {meId && (
            <QuickChip
              active={value.soloMios}
              color="#5750E8"
              label="Solo míos"
              onClick={() => onChange({ ...value, soloMios: !value.soloMios })}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-neutral-400">
            <span className="hidden sm:inline">Drag entre columnas para cambiar etapa</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">Doble click para detalle</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * La etapa como píldora de color, en la vista de lista.
 *
 * 🔴 EL COLOR SE LEE DE `pipeline_stages.color` — el mismo hexadecimal que ya pinta el punto de la
 * cabecera de cada columna del tablero (`DroppableColumn`). No hay paleta nueva ni mapa de etapa a
 * color en el frontend: si mañana se recolorea una etapa desde Configuración, las dos vistas
 * cambian a la vez. Un mapa aquí sería una segunda fuente de verdad que se desincroniza en cuanto
 * alguien añada una etapa.
 *
 * `#5C6670` es el mismo defecto que aplica el backend (`pipeline-routes.ts`) cuando una etapa no
 * tiene color: se repite aquí solo para el caso de que la etapa ni siquiera exista en el pipeline
 * —una fila con una etapa retirada—, que si no se quedaría sin píldora.
 */
function EtapaPill({ etapa, stages }: { etapa: string; stages: PipelineStage[] | null }) {
  const stage = (stages || []).find((s) => s.key === etapa);
  const color = stage?.color || "#5C6670";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-ui font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: `${color}1f`, color }}
      title={stage ? undefined : `Etapa "${etapa}" — ya no está en el pipeline`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {stage?.label || etapa}
    </span>
  );
}

function QuickChip({ active, color, label, onClick }: { active: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-full text-[10px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all border",
        active
          ? "text-white shadow-md scale-105"
          : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300"
      )}
      style={active ? { background: color, borderColor: color } : undefined}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", active && "bg-white")}
        style={!active ? { background: color } : undefined}
      />
      {label}
    </button>
  );
}


/** Cuántas tarjetas por columna. Del conjunto que admite el servidor: [20, 50, 100]. */
const POR_COLUMNA = 20;

interface EstadoColumna {
  items: Oportunidad[];
  total: number;
  totalPages: number;
  page: number;
  cargando: boolean;
}
const COLUMNA_VACIA: EstadoColumna = { items: [], total: 0, totalPages: 1, page: 1, cargando: true };

const CLAVE_VISTA = "crm_opp_vista";        // preferencia tablero/lista, por navegador
const TAMANOS_PAGINA = [20, 50, 100];       // debe coincidir con la lista blanca del servidor

export default function OportunidadesPage() {
  const router = useRouter();
  const { stages } = useStages();
  // ============================================================================================
  // 🔴 EL FILTRADO Y LOS CONTEOS SON DEL SERVIDOR, NO DEL NAVEGADOR.
  //
  // Antes el tablero pedía `terminal_limit=150`, filtraba ESA MUESTRA en el navegador, y el badge
  // de cada columna venía de un `count(*)` sin ningún WHERE. Con "Asilo", GANADO enseñaba 2 casos
  // y su badge decía 6.920: el sistema no mentía sobre el filtro, mentía sobre el conjunto.
  //
  // Ahora **cada columna es una consulta paginada** con los filtros aplicados en SQL, y los
  // contadores salen del mismo WHERE que las filas. Es kanban: la paginación es POR COLUMNA, no
  // global — cada una avanza por su cuenta.
  // ============================================================================================
  const [columnas, setColumnas] = useState<Record<string, EstadoColumna>>({});
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});

  // ---- Vista de LISTA ----
  // Es lo que hace usable filtrar y seleccionar en masa, que es el paso previo a exportar. El
  // mosaico sirve para trabajar el pipeline; la lista, para operar sobre conjuntos.
  const [vista, setVista] = useState<"tablero" | "lista">("tablero");
  const [lista, setLista] = useState<Oportunidad[] | null>(null);
  const [listaTotal, setListaTotal] = useState(0);
  const [listaPage, setListaPage] = useState(1);
  const [listaPageSize, setListaPageSize] = useState(50);
  const [etapaLista, setEtapaLista] = useState("");   // "" = todas
  // Casillas SOLO en la vista de lista. Decisión ya cerrada en Contactos (C1); no se rediscute.
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  // "Seleccionar el total": mismo patrón que Contactos. En este modo NO se guarda la lista de ids
  // —pueden ser miles— sino "todo lo que cumple el filtro MENOS los que se hayan desmarcado".
  const [modoTotal, setModoTotal] = useState(false);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [cambioEtapaAbierto, setCambioEtapaAbierto] = useState(false);
  const [exportarAbierto, setExportarAbierto] = useState(false);
  const [tramites, setTramites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nombre_caso: "", tipo_tramite_id: "", contacto_id: "", vendedor_id: "", preparador_id: "", manager_general_id: "", valor_total: "0", notas: "" });
  const [tramitesExtra, setTramitesExtra] = useState<string[]>([]); // trámites adicionales al principal
  const [saving, setSaving] = useState(false);
  // Estado de UI en el store del slice (features/oportunidades/store.ts). La lectura de
  // `localStorage` no puede ir en el `create()` del store (corre una sola vez, no por componente),
  // así que se migra en un efecto al montar — mismo resultado que el lazy-initializer de antes.
  const filtros = useOportunidadesStore((s) => s.filtros);
  const setFiltros = useOportunidadesStore((s) => s.setFiltros);
  useEffect(() => {
    try { setFiltros(normalizarFiltros(JSON.parse(localStorage.getItem("crm_opp_filters") || ""))); }
    catch { /* se queda con FILTROS_VACIOS, el valor inicial del store */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * Cuántas quedan fuera del rango por no tener la fecha, por etapa. Lo manda el servidor con la
   * misma forma que `counts`, y solo cuando hay un rango puesto.
   */
  const [sinFecha, setSinFecha] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    try { localStorage.setItem("crm_opp_filters", JSON.stringify(filtros)); } catch {}
  }, [filtros]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /** Los filtros, tal y como los entiende el servidor. Una sola definición para todas las cargas. */
  const paramsFiltro = useCallback(() => {
    const qs = new URLSearchParams();
    const term = filtros.q.trim();
    if (term) qs.set("q", term);
    if (filtros.tramite) qs.set("tramite", filtros.tramite);   // uuid o "sin_tramite"
    if (filtros.asignado) qs.set("asignado", filtros.asignado);
    if (filtros.sla) qs.set("sla", filtros.sla);
    if (filtros.soloMios) qs.set("solo_mios", "1");
    // El campo solo se manda con un rango puesto: sin rango no filtra nada y sería ruido en la URL.
    if (filtros.desde || filtros.hasta) {
      if (filtros.desde) qs.set("desde", filtros.desde);
      if (filtros.hasta) qs.set("hasta", filtros.hasta);
      qs.set("campo_fecha", filtros.campoFecha);
    }
    return qs;
  }, [filtros]);

  /** Una columna del tablero. Cada una pide SU página; el servidor devuelve además los contadores
   *  de todas las etapas con estos filtros, así que cualquier respuesta refresca los badges. */
  const cargarColumna = useCallback(async (etapa: string, page = 1) => {
    setColumnas((c) => ({ ...c, [etapa]: { ...(c[etapa] ?? COLUMNA_VACIA), cargando: true } }));
    try {
      const qs = paramsFiltro();
      qs.set("etapa", etapa);
      qs.set("page", String(page));
      qs.set("pageSize", String(POR_COLUMNA));
      const r = await fetch(`/api/oportunidades?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setColumnas((c) => ({
        ...c,
        [etapa]: { items: d.oportunidades || [], total: d.total ?? 0, totalPages: d.totalPages ?? 1, page, cargando: false },
      }));
      if (d.counts) setStageCounts(d.counts);
      setSinFecha(d.sin_fecha ?? null);
    } catch {
      setColumnas((c) => ({ ...c, [etapa]: { ...(c[etapa] ?? COLUMNA_VACIA), cargando: false } }));
      toast.error(`No se pudo cargar la columna ${etapa}`);
    }
  }, [paramsFiltro]);

  const etapasVisibles = useMemo(
    () => (stages || []).filter((s) => !s.es_terminal || s.es_ganado || s.key === "perdido").map((s) => s.key),
    [stages]
  );

  /** Recarga el tablero entero volviendo a la página 1 de cada columna: al cambiar un filtro, la
   *  página 7 de antes no significa nada sobre el conjunto nuevo. */
  const cargarTablero = useCallback(() => {
    for (const k of etapasVisibles) cargarColumna(k, 1);
  }, [etapasVisibles, cargarColumna]);

  /** La lista: una sola consulta paginada, con la etapa como un filtro más. */
  const cargarLista = useCallback(async () => {
    const qs = paramsFiltro();
    if (etapaLista) qs.set("etapa", etapaLista);
    qs.set("page", String(listaPage));
    qs.set("pageSize", String(listaPageSize));
    try {
      const r = await fetch(`/api/oportunidades?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setLista(d.oportunidades || []);
      setListaTotal(d.total ?? 0);
      if (d.counts) setStageCounts(d.counts);
      setSinFecha(d.sin_fecha ?? null);
    } catch {
      setLista([]); setListaTotal(0);
      toast.error("No se pudieron cargar las oportunidades");
    }
  }, [paramsFiltro, etapaLista, listaPage, listaPageSize]);

  // Preferencia de vista, recordada entre recargas — como en Contactos. Por defecto TABLERO: es lo
  // que la gente ve hoy y esta entrega no cambia lo que ya funciona.
  useEffect(() => {
    try { const v = localStorage.getItem(CLAVE_VISTA); if (v === "lista" || v === "tablero") setVista(v); } catch {}
  }, []);
  const cambiarVista = (v: "tablero" | "lista") => {
    setVista(v);
    try { localStorage.setItem(CLAVE_VISTA, v); } catch {}
  };

  // Al cambiar cualquier filtro se vuelve a la página 1 y se limpia la selección: si el conjunto
  // cambia, "los 40 seleccionados" ya no son esos 40 — y "el total" tampoco es el mismo total.
  useEffect(() => {
    setListaPage(1);
    setSeleccionados(new Set());
    setModoTotal(false);
    setExcluidos(new Set());
  }, [filtros, etapaLista, listaPageSize]);

  // ---- helpers de selección — el MISMO patrón que Contactos, no otro ----------------------------
  const estaSeleccionado = (id: string) => (modoTotal ? !excluidos.has(id) : seleccionados.has(id));
  const nSeleccionados = modoTotal ? Math.max(0, listaTotal - excluidos.size) : seleccionados.size;
  const idsPagina = (lista || []).map((o) => o.id);
  const todaLaPaginaSeleccionada = idsPagina.length > 0 && idsPagina.every(estaSeleccionado);
  const algunoDeLaPagina = idsPagina.some(estaSeleccionado);

  const alternarFila = (id: string) => {
    if (modoTotal) setExcluidos((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
    else setSeleccionados((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const alternarPagina = () => {
    const marcar = !todaLaPaginaSeleccionada;
    if (modoTotal) setExcluidos((p) => { const s = new Set(p); for (const id of idsPagina) marcar ? s.delete(id) : s.add(id); return s; });
    else setSeleccionados((p) => { const s = new Set(p); for (const id of idsPagina) marcar ? s.add(id) : s.delete(id); return s; });
  };
  const seleccionarElTotal = () => { setModoTotal(true); setExcluidos(new Set()); setSeleccionados(new Set()); };
  const limpiarSeleccion = () => { setModoTotal(false); setExcluidos(new Set()); setSeleccionados(new Set()); };

  /**
   * Los filtros tal y como los entiende el servidor, como OBJETO.
   *
   * 🔴 Salen de `paramsFiltro()`, el mismo sitio del que salen los de la lista: si aquí se armara
   * otro juego de filtros, la exportación podría llevarse un conjunto distinto del que se vio y
   * **no habría forma de notarlo hasta contar las filas**.
   */
  const filtrosParaSeleccion = useCallback(() => {
    const o = Object.fromEntries(paramsFiltro().entries()) as Record<string, string>;
    if (etapaLista) o.etapa = etapaLista;
    return o;
  }, [paramsFiltro, etapaLista]);

  /** El contrato de selección compartido con archivar, fusionar y el cambio masivo de etapa. */
  const seleccionApi = useCallback(() => (
    modoTotal
      ? { modo: "filtro" as const, filtros: filtrosParaSeleccion(), excluidos: [...excluidos] }
      : { modo: "ids" as const, ids: [...seleccionados] }
  ), [modoTotal, filtrosParaSeleccion, excluidos, seleccionados]);

  // Debounce: no se refresca en cada tecla del buscador.
  useEffect(() => {
    if (vista === "lista") { const t = setTimeout(() => { cargarLista(); }, 300); return () => clearTimeout(t); }
    if (etapasVisibles.length === 0) return;
    const t = setTimeout(() => { cargarTablero(); }, 300);
    return () => clearTimeout(t);
  }, [vista, cargarLista, cargarTablero, etapasVisibles.length]);

  useEffect(() => {
    fetch("/api/tramites").then((r) => r.json()).then((d) => setTramites(d.tramites || []));
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || []));
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {});
  }, []);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  // ============================================================================================
  // ARRASTRAR ENTRE COLUMNAS PAGINADAS
  //
  // Con paginación por columna hay una pregunta nueva: ¿dónde aparece la tarjeta al soltarla?
  //
  // La respuesta honesta es "donde le toque por fecha", y puede no ser la página que estás viendo:
  // el orden es `created_at DESC` y mover una tarjeta NO cambia su fecha de creación, así que una
  // oportunidad de hace ocho meses arrastrada a GANADO cae en la página 12 de esa columna.
  //
  // Qué se hace, entonces:
  //   1. Se quita YA de la columna de origen (respuesta inmediata, que es lo que el gesto pide).
  //   2. Se manda el PATCH. Si falla, la tarjeta vuelve a su sitio y se dice por qué.
  //   3. Se recargan SOLO las dos columnas afectadas — no el tablero entero—, y con ellas llegan
  //      los contadores de todas las etapas, así que los badges quedan al día sin recargar nada más.
  //   4. Si la tarjeta NO está en la página visible del destino, se dice: es preferible a que el
  //      usuario la busque y crea que se perdió.
  //
  // 🔴 Lo que NO se hace es insertarla a la fuerza al principio de la columna destino. Se vería una
  // tarjeta en un sitio donde no está, y al recargar desaparecería: exactamente la clase de mentira
  // visual que este trabajo viene a quitar.
  // ============================================================================================
  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over || !stages) return;
    const opId = String(e.active.id);
    const destino = String(e.over.id);
    const origen = Object.keys(columnas).find((k) => columnas[k].items.some((o) => o.id === opId));
    if (!origen || origen === destino) return;
    const op = columnas[origen].items.find((o) => o.id === opId)!;

    // (1) Fuera de la columna de origen, ya.
    setColumnas((c) => ({
      ...c,
      [origen]: { ...c[origen], items: c[origen].items.filter((o) => o.id !== opId), total: Math.max(0, c[origen].total - 1) },
    }));

    try {
      const r = await fetch(`/api/oportunidades/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: destino })
      });
      const body = await r.json();
      if (!r.ok) {
        if (body.missing && body.missing.length > 0) toast.error(`Campos obligatorios faltantes: ${body.missing.join(", ")}`);
        else toast.error(body.error || "Error al mover");
        // (2) Vuelta atrás: se restaura la columna de origen tal y como estaba.
        await cargarColumna(origen, columnas[origen].page);
        return;
      }
      const dest = stages.find((s) => s.key === destino);
      // (3) Solo las dos columnas afectadas. Los contadores de TODAS llegan en la respuesta.
      await Promise.all([cargarColumna(origen, columnas[origen].page), cargarColumna(destino, 1)]);
      // (4) ¿Se ve donde cayó?
      const enDestino = await fetch(
        `/api/oportunidades?${(() => { const q = paramsFiltro(); q.set("etapa", destino); q.set("page", "1"); q.set("pageSize", String(POR_COLUMNA)); return q; })()}`
      ).then((x) => x.json()).then((d) => (d.oportunidades || []).some((o: any) => o.id === opId)).catch(() => true);
      toast.success(
        enDestino
          ? `Movido a ${dest?.label || destino}`
          : `Movido a ${dest?.label || destino} · está en otra página de esa columna (se ordena por fecha de creación)`
      );
    } catch {
      toast.error("Error al mover");
      await cargarColumna(origen, columnas[origen].page);
    }
  };

  const save = async () => {
    if (!form.nombre_caso) { toast.error("Nombre del caso requerido"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/oportunidades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_caso: form.nombre_caso,
          tipo_tramite_id: form.tipo_tramite_id || null,
          contacto_id: form.contacto_id || null,
          vendedor_id: form.vendedor_id || null,
          preparador_id: form.preparador_id || null,
          manager_general_id: form.manager_general_id || null,
          valor_total: Number(form.valor_total) || 0,
          notas: form.notas || null,
          tramites_extra: tramitesExtra
        })
      });
      if (!r.ok) throw new Error("Error al crear");
      toast.success("Oportunidad creada");
      setModal(false);
      setForm({ nombre_caso: "", tipo_tramite_id: "", contacto_id: "", vendedor_id: "", preparador_id: "", manager_general_id: "", valor_total: "0", notas: "" });
      setTramitesExtra([]);
      cargarTablero();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // El filtrado en cliente DESAPARECE: lo hace SQL. Era la mitad del defecto — se filtraba una
  // muestra de 150 filas y el resultado se presentaba como si fuera el conjunto entero.

  // La tarjeta que se está arrastrando puede estar en cualquier columna.
  const activeOp = Object.values(columnas).flatMap((c) => c.items).find((o) => o.id === activeId);

  /** Cuántas oportunidades cumplen los filtros, en todas las etapas. Sale de los contadores del
   *  servidor, así que es el número REAL — no "cuántas se han cargado", que era el de antes. */
  const totalFiltrado = useMemo(
    () => etapasVisibles.reduce((n, k) => n + (stageCounts[k] ?? 0), 0),
    [etapasVisibles, stageCounts]
  );
  // Mostrar columnas no-terminales + los dos desenlaces terminales (Ganado y Perdido).
  const visibleStages = (stages || []).filter((s) => !s.es_terminal || s.es_ganado || s.key === "perdido");

  // ============================================================================================
  // 🔴 CUÁNTAS QUEDAN FUERA DEL RANGO POR NO TENER FECHA
  //
  // Medido en producción: solo **431 de las 6.920 ganadas** tienen `fecha_completada`. Filtrar por
  // "fecha de ganado" deja fuera al 94%, y sin decirlo el vendedor que ponga "últimos 30 días" verá
  // cuatro filas y concluirá que no se ha ganado nada este mes.
  //
  // No se cuelan en el resultado ni se les inventa fecha: se enseña el hueco, igual que la papelera
  // de contactos. El número sale del servidor (mismo WHERE menos el rango) y aquí solo se suma lo
  // que el usuario está mirando: la etapa elegida en la lista, o todas las visibles en el tablero.
  // ============================================================================================
  const hayRango = !!(filtros.desde || filtros.hasta);
  const fueraDelRango = useMemo(() => {
    if (!hayRango || !sinFecha) return 0;
    if (vista === "lista" && etapaLista) return sinFecha[etapaLista] ?? 0;
    return visibleStages.reduce((n, s) => n + (sinFecha[s.key] ?? 0), 0);
  }, [hayRango, sinFecha, vista, etapaLista, visibleStages]);
  const etiquetaFecha = filtros.campoFecha === "fecha_completada" ? "fecha de ganado" : "fecha de creación";

  return (
    <AppShell>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.15em] mb-3">
              <Sparkle className="h-3.5 w-3.5" weight="fill" />
              Pipeline
            </div>
            <h1 className="font-display text-h1 md:text-display-md font-black leading-[1.05]">
              <span className="text-gradient-neon">Oportunidades</span>
            </h1>
            <p className="mt-2 text-neutral-500">
              {/* El número REAL de casos que cumplen el filtro, no cuántos se han cargado. Antes
                  aquí salía la longitud del array recortado a 150 + abiertas. */}
              {Object.keys(columnas).length === 0
                ? "Cargando…"
                : `${totalFiltrado.toLocaleString("es")} casos · arrastra para cambiar etapa · doble click para detalle`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Alternador tablero ⇄ lista, que recuerda la elección — como en Contactos. */}
            <div className="inline-flex rounded-xl bg-neutral-100 p-1">
              {([["tablero", LayoutGrid, "Tablero"], ["lista", List, "Lista"]] as const).map(([v, Icono, etiqueta]) => (
                <button
                  key={v}
                  onClick={() => cambiarVista(v)}
                  title={etiqueta}
                  className={cn("h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-ui font-bold uppercase tracking-wider transition",
                    vista === v ? "bg-white text-brand-orange shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
                >
                  <Icono className="h-3.5 w-3.5" strokeWidth={2} />
                  {etiqueta}
                </button>
              ))}
            </div>
          <ShimmerButton onClick={() => setModal(true)}>
            <Plus className="h-4 w-4" weight="bold" />
            Nueva oportunidad
          </ShimmerButton>
          </div>
        </motion.div>

        <FilterBar value={filtros} onChange={setFiltros} tramites={tramites} users={users} meId={me?.id || null} total={totalFiltrado} filtered={totalFiltrado} />

        {/* El aviso que hace honesto el filtro de fechas. Ver el bloque de arriba. */}
        {fueraDelRango > 0 && (
          <div className="mb-4 rounded-2xl bg-blue-50 border border-blue-200 px-4 py-3 text-[12px] text-blue-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2.2} />
            <span>
              <strong className="tabular-nums">{fueraDelRango.toLocaleString("es")}</strong>{" "}
              oportunidad{fueraDelRango === 1 ? "" : "es"} de las que estás mirando no tiene
              {fueraDelRango === 1 ? "" : "n"} <strong>{etiquetaFecha}</strong> registrada y queda
              {fueraDelRango === 1 ? "" : "n"} fuera de este rango.{" "}
              <span className="opacity-80">
                No se han perdido: quita el filtro de fecha para verlas.
                {filtros.campoFecha === "fecha_completada" &&
                  " La mayoría son importaciones que nunca pasaron por el flujo que escribe esa fecha."}
              </span>
            </span>
          </div>
        )}

        {vista === "tablero" && (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <HorizontalScrollArea className="pb-4 scrollbar-thin">
            <div className="flex gap-4 min-w-max">
              {visibleStages.map((stage) => {
                const col = columnas[stage.key] ?? COLUMNA_VACIA;
                // El badge sale del contador del SERVIDOR, calculado con el mismo WHERE que las
                // filas. Antes era un `count(*)` global y por eso decía 6.920 con 2 tarjetas debajo.
                const total = stageCounts[stage.key] ?? col.total;
                return (
                  <div key={stage.key} className="w-72 shrink-0">
                    <DroppableColumn stage={stage} count={total}>
                      {col.items.map((op) => (
                        <DraggableCard key={op.id} op={op} onOpen={() => router.push(`/oportunidades/${op.id}`)} />
                      ))}
                      {col.cargando && col.items.length === 0 && (
                        <div className="text-[11px] text-center text-neutral-400 py-8 font-ui uppercase tracking-wider">Cargando…</div>
                      )}
                      {!col.cargando && col.items.length === 0 && (
                        <div className="text-[11px] text-center text-neutral-400 py-8 font-ui uppercase tracking-wider">Vacío</div>
                      )}

                      {/* Navegación real. Aquí estaba el "+ N más · usa la búsqueda", que era el
                          propio código admitiendo que enseñaba una muestra y no ofrecía forma de
                          ver el resto.
                          Y ahora es el MISMO componente que la lista, Contactos y Drive: el
                          paginador propio que había aquí solo tenía "‹ Ant." / "Sig. ›", así que
                          llegar a la última página de GANADO eran 150 clics. `compact` es una prop
                          nueva y opcional — sin ella el compartido se comporta igual que siempre. */}
                      {col.totalPages > 1 && (
                        <div className="mt-2 shrink-0">
                          <Pagination
                            page={col.page}
                            pageSize={POR_COLUMNA}
                            total={col.total}
                            onPageChange={(p) => cargarColumna(stage.key, p)}
                            disabled={col.cargando}
                            showFirstLast
                            compact
                          />
                        </div>
                      )}
                    </DroppableColumn>
                  </div>
                );
              })}
            </div>
          </HorizontalScrollArea>
          <DragOverlay>
            {activeOp ? <DraggableCard op={activeOp} onOpen={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
        )}

        {vista === "lista" && (
          <div className="glass rounded-2xl overflow-hidden">
            {/* Filtro de etapa: en el tablero la etapa ES la columna; en la lista hace falta como
                filtro más, y comparte el mismo WHERE que todo lo demás. */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-black/5">
              <span className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Etapa</span>
              <button
                onClick={() => setEtapaLista("")}
                className={cn("h-8 px-3 rounded-xl text-xs font-bold transition",
                  !etapaLista ? "bg-brand-orange text-white shadow-sm" : "bg-neutral-100 text-neutral-600 hover:bg-white")}
              >
                Todas
              </button>
              {visibleStages.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setEtapaLista(s.key)}
                  className={cn("h-8 px-3 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5",
                    etapaLista === s.key ? "bg-brand-orange text-white shadow-sm" : "bg-neutral-100 text-neutral-600 hover:bg-white")}
                >
                  {s.label}
                  <span className="tabular-nums opacity-70">{stageCounts[s.key] ?? 0}</span>
                </button>
              ))}
              <div className="flex-1" />
              {seleccionados.size > 0 && (
                <span className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">
                  Seleccionadas: <span className="text-brand-orange tabular-nums">{seleccionados.size}</span>
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-black/[0.02] text-[11px] font-ui uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar toda la página"
                        checked={todaLaPaginaSeleccionada}
                        ref={(el) => { if (el) el.indeterminate = !todaLaPaginaSeleccionada && algunoDeLaPagina; }}
                        onChange={alternarPagina}
                      />
                    </th>
                    <th className="text-left px-3 py-2.5">Caso</th>
                    <th className="text-left px-3 py-2.5">Trámite</th>
                    <th className="text-left px-3 py-2.5">Contacto</th>
                    <th className="text-right px-3 py-2.5">Valor</th>
                    <th className="text-left px-3 py-2.5">SLA</th>
                    <th className="text-left px-3 py-2.5">Responsable</th>
                    <th className="text-left px-3 py-2.5">Etapa</th>
                  </tr>
                </thead>
                <tbody>
                  {lista === null && (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-neutral-400 text-[12px]">Cargando…</td></tr>
                  )}
                  {lista?.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-neutral-400 text-[12px]">
                      No hay oportunidades que cumplan estos filtros.
                    </td></tr>
                  )}
                  {(lista || []).map((op) => (
                    <tr
                      key={op.id}
                      className="border-t border-black/5 hover:bg-brand-orange/[0.03] cursor-pointer"
                      onDoubleClick={() => router.push(`/oportunidades/${op.id}`)}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${op.nombre_caso}`}
                          checked={estaSeleccionado(op.id)}
                          onChange={() => alternarFila(op.id)}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-semibold max-w-[280px] truncate" title={op.nombre_caso}>{op.nombre_caso}</td>
                      <td className="px-3 py-2.5">
                        {op.tramite_nombre ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: op.tramite_color || "#5C6670" }} />
                            <span className="truncate max-w-[160px]">{op.tramite_nombre}</span>
                          </span>
                        ) : (
                          /* Se enseña el hueco: son las que no se pueden segmentar para nada. */
                          <span className="text-[11px] italic text-neutral-400">sin trámite</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 truncate max-w-[200px]">{op.contacto_nombre || <span className="text-neutral-400">—</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {Number(op.valor_total) > 0 ? `$${Number(op.valor_total).toFixed(0)}` : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5"><SLABadge estado={op.sla_estado} fechaLimite={op.sla_fecha_limite} /></td>
                      <td className="px-3 py-2.5 truncate max-w-[160px]">{op.preparador_nombre || <span className="text-neutral-400">sin asignar</span>}</td>
                      <td className="px-3 py-2.5"><EtapaPill etapa={op.etapa} stages={stages} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* El MISMO componente que ya usan Contactos y Drive. */}
            <Pagination
              page={listaPage}
              pageSize={listaPageSize}
              total={listaTotal}
              onPageChange={setListaPage}
              pageSizeOptions={TAMANOS_PAGINA}
              onPageSizeChange={setListaPageSize}
              showFirstLast
            />
          </div>
        )}

        {/* ---- BARRA DE ACCIONES ----
            Mismo patrón que Contactos: `sticky bottom-0` dentro de la columna de contenido, no
            `fixed`, para que quede alineada por maquetación y no por cálculo. Con 0 seleccionadas
            desaparece.

            🔴 El botón se le ofrece a TODO EL MUNDO, tenga o no `cambiar_etapa_masivo`. Esconderlo
            sería decidir en el navegador quién puede qué, y esa decisión es del backend: quien no
            tenga el permiso llegará a la confirmación y allí verá que lo suyo crea una solicitud.
            Es la misma regla que el botón de exportar de Contactos. */}
        <AnimatePresence>
          {vista === "lista" && nSeleccionados > 0 && (
            <motion.div
              initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="sticky bottom-0 z-40 -mx-4 sm:-mx-6 mt-4 border-t border-black/10 bg-white/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.08)]"
            >
              <div className="px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value === "etapa") setCambioEtapaAbierto(true);
                    if (e.target.value === "exportar") setExportarAbierto(true);
                  }}
                  className="h-9 pl-3 pr-8 rounded-lg bg-white border border-black/10 text-[12px] text-neutral-600 outline-none focus:ring-2 focus:ring-brand-orange/30 cursor-pointer"
                >
                  <option value="">Seleccione la acción</option>
                  {/* 🔴 "Cambiar etapa" no se ofrece en modo total: el modal arma fila a fila y con
                      "el total" pueden ser miles que el usuario no ha visto. Exportar sí, porque
                      exportar no cambia nada — solo se lleva una copia. */}
                  <option value="etapa" disabled={modoTotal}>
                    {modoTotal ? "Cambiar etapa — no con el total seleccionado" : "Cambiar etapa"}
                  </option>
                  <option value="exportar">Exportar</option>
                </select>

                {/* "Seleccionar el total": el patrón de Contactos, mismo texto y misma condición —
                    solo cuando toda la página está marcada y hay más de una página. Sin él, solo se
                    puede exportar lo que quepa marcado a mano. */}
                {todaLaPaginaSeleccionada && !modoTotal && listaTotal > listaPageSize && (
                  <button
                    onClick={seleccionarElTotal}
                    className="h-9 px-3 rounded-lg bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition"
                  >
                    Seleccionar el total ({listaTotal})
                  </button>
                )}
                <button
                  onClick={limpiarSeleccion}
                  className="h-9 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-800 transition"
                >
                  Limpiar selección
                </button>
                <div className="ml-auto font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                  {modoTotal && <span className="mr-2 text-brand-orange">Todo el filtro ·</span>}
                  Seleccionadas: <span className="text-brand-orange tabular-nums">{nSeleccionados}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {cambioEtapaAbierto && (
          <CambioEtapaModal
            oportunidades={(lista || []).filter((o) => seleccionados.has(o.id))}
            stages={stages}
            onClose={() => setCambioEtapaAbierto(false)}
            onAplicado={() => { limpiarSeleccion(); cargarLista(); }}
          />
        )}

        {exportarAbierto && (
          <ExportarModal seleccion={seleccionApi()} onClose={() => setExportarAbierto(false)} />
        )}

      </div>

      <AnimatePresence>
        {modal && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setModal(false)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="rounded-3xl max-w-2xl w-full relative overflow-hidden bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10"
          >
            {/* Header con gradient */}
            <div className="relative bg-gradient-to-br from-brand-orange via-amber-500 to-orange-600 px-7 py-6 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.25),transparent_60%)] pointer-events-none" />
              <div className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
              <div className="relative flex items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-white/80 font-ui font-bold mb-1.5">
                    <SparklesLI className="h-3 w-3" /> Pipeline · Nuevo caso
                  </div>
                  <h2 className="font-display text-3xl font-black text-white leading-tight">Nueva oportunidad</h2>
                  <p className="text-white/80 text-[12px] mt-1.5">Completa los datos del caso para arrancarlo en la etapa «Nuevo»</p>
                </div>
                <button
                  onClick={() => setModal(false)}
                  className="h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white shrink-0 backdrop-blur"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body con secciones */}
            <div className="px-7 py-6 max-h-[65vh] overflow-y-auto space-y-6">
              {/* Sección 1: Info del caso */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">1</div>
                  <h3 className="font-display font-black text-sm text-neutral-900 dark:text-white">Información del caso</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Nombre del caso <span className="text-brand-red">*</span>
                    </label>
                    <input
                      value={form.nombre_caso}
                      onChange={(e) => setForm({ ...form, nombre_caso: e.target.value })}
                      placeholder="Ej. N-400 María García · Naturalización"
                      className="w-full h-11 px-4 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-sm font-medium outline-none transition-all focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                        Trámite <span className="text-brand-red">*</span>
                      </label>
                      <select
                        value={form.tipo_tramite_id}
                        onChange={(e) => setForm({ ...form, tipo_tramite_id: e.target.value })}
                        className="w-full h-11 px-3 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-sm font-medium outline-none transition-all focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                      >
                        <option value="">— Seleccionar —</option>
                        {tramites.map((t) => (
                          <option key={t.id} value={t.id}>{t.formulario_uscis} · {t.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                        Contacto / Cliente
                      </label>
                      <ContactoPicker
                        value={form.contacto_id}
                        onChange={(id) => setForm({ ...form, contacto_id: id })}
                      />
                    </div>
                  </div>

                  {/* Trámites adicionales (opcional) — además del principal */}
                  <div className="mt-3">
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Trámites adicionales <span className="text-neutral-400 normal-case font-medium">(opcional · puedes agregar varios)</span>
                    </label>
                    {tramitesExtra.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {tramitesExtra.map((tid) => {
                          const t = tramites.find((x) => x.id === tid);
                          return (
                            <span key={tid} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-brand-orange/10 text-brand-orange">
                              {t ? t.nombre : tid}
                              <button type="button" onClick={() => setTramitesExtra((p) => p.filter((x) => x !== tid))} className="leading-none hover:opacity-60 text-sm" title="Quitar">×</button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <select
                      value=""
                      onChange={(e) => { const v = e.target.value; if (v) setTramitesExtra((p) => p.includes(v) ? p : [...p, v]); }}
                      className="w-full h-11 px-3 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-sm font-medium outline-none transition-all focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                    >
                      <option value="">+ Agregar otro trámite…</option>
                      {tramites.filter((t) => t.id !== form.tipo_tramite_id && !tramitesExtra.includes(t.id)).map((t) => (
                        <option key={t.id} value={t.id}>{t.formulario_uscis} · {t.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* Sección 2: Asignaciones */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">2</div>
                  <h3 className="font-display font-black text-sm text-neutral-900 dark:text-white">Asignaciones</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Vendedor / Closer
                    </label>
                    <FancySelect
                      value={form.vendedor_id}
                      onChange={(v) => setForm({ ...form, vendedor_id: v })}
                      options={(users || []).map((u: any) => ({
                        value: String(u.id),
                        label: u.nombre,
                        sub: u.email,
                        avatar: u.foto_perfil_url,
                        initials: u.nombre ? initialsOf(u.nombre) : "??"
                      }))}
                      placeholder="Sin vendedor"
                      label=""
                      icon={UserCircle2}
                      width={"100%" as any}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Preparador
                    </label>
                    <FancySelect
                      value={form.preparador_id}
                      onChange={(v) => setForm({ ...form, preparador_id: v })}
                      options={(users || []).map((u: any) => ({
                        value: String(u.id),
                        label: u.nombre,
                        sub: u.email,
                        avatar: u.foto_perfil_url,
                        initials: u.nombre ? initialsOf(u.nombre) : "??"
                      }))}
                      placeholder="Sin preparador"
                      label=""
                      icon={UserCircle2}
                      width={"100%" as any}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">Manager</label>
                    <FancySelect value={form.manager_general_id} onChange={(v) => setForm({ ...form, manager_general_id: v })} options={(users || []).map((u: any) => ({ value: String(u.id), label: u.nombre, sub: u.email, avatar: u.foto_perfil_url, initials: u.nombre ? initialsOf(u.nombre) : "??" }))} placeholder="Sin manager" label="" icon={UserCircle2} width={"100%" as any} />
                  </div>
                </div>
              </section>

              {/* Sección 3: Valor & detalles */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">3</div>
                  <h3 className="font-display font-black text-sm text-neutral-900 dark:text-white">Valor & detalles</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Valor total
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-600 font-display font-black text-lg">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={form.valor_total}
                        onChange={(e) => setForm({ ...form, valor_total: e.target.value })}
                        placeholder="0.00"
                        className="w-full h-12 pl-9 pr-20 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/10 border-2 border-emerald-100 dark:border-emerald-800/40 text-lg font-display font-black tabular-nums outline-none transition-all focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-ui font-bold uppercase tracking-wider text-emerald-700">USD</span>
                    </div>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1.5">
                      Se inicializa con balance pendiente igual al total. Los pagos se registran después en el detalle.
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Notas / Observaciones
                    </label>
                    <textarea
                      value={form.notas}
                      onChange={(e) => setForm({ ...form, notas: e.target.value })}
                      rows={3}
                      placeholder="Contexto del caso, urgencias, requisitos especiales..."
                      className="w-full px-4 py-3 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-sm font-medium outline-none transition-all focus:bg-white focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 resize-none"
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* Footer fixed */}
            <div className="border-t border-neutral-100 dark:border-white/5 bg-neutral-50/50 dark:bg-white/[0.02] px-7 py-4 flex items-center justify-between gap-3">
              <div className="text-[10px] font-ui text-neutral-500 dark:text-neutral-400 hidden sm:block">
                <span className="text-brand-red">*</span> Campos obligatorios
              </div>
              <div className="flex gap-3 ml-auto">
                <button
                  onClick={() => setModal(false)}
                  className="h-11 px-5 rounded-xl bg-white dark:bg-white/5 border-2 border-neutral-200 dark:border-white/10 font-ui text-xs font-black uppercase tracking-wider text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/10 transition-all"
                >
                  Cancelar
                </button>
                <ShimmerButton
                  onClick={save}
                  disabled={saving || !form.nombre_caso.trim()}
                  className="px-6"
                >
                  {saving ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Creando…</span>
                  ) : (
                    <span className="flex items-center gap-2">Crear oportunidad <ChevronRight className="h-4 w-4" /></span>
                  )}
                </ShimmerButton>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </AppShell>
  );
}
