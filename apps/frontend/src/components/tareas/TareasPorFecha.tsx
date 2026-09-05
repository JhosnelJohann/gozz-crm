"use client";
import { useMemo, useState } from "react";
import { DndContext, type DragEndEvent, DragOverlay, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { motion } from "framer-motion";
import { AlertCircle, Ban, Calendar, CalendarClock, CalendarX2, CalendarDays, Sun, CheckCircle2, Circle, XCircle } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/auth-user";
import { HorizontalScrollArea } from "@/components/ui/HorizontalScrollArea";
import {
  type AccionSoltar,
  type ColumnaTablero,
  ETIQUETA_COLUMNA,
  accionAlSoltar,
  columnaDeTarea,
  textoDeFechaLimite,
} from "@/lib/tareas-fechas";
import { DISTANCIA_ARRASTRE, agruparSinRepetir, buscarEnListas, guardarCambioDeTarea, opacidadDeTarjeta } from "@/lib/tareas-tablero";
import type { TareaRow } from "./TaskCard";

const COLS: { key: ColumnaTablero; color: string; Icon: any }[] = [
  { key: "atrasado", color: "#E53935", Icon: AlertCircle },
  { key: "hoy", color: "#43A847", Icon: Sun },
  { key: "semana", color: "#2196C9", Icon: Calendar },
  { key: "proxima", color: "#8338EC", Icon: CalendarClock },
  { key: "adelante", color: "#5750E8", Icon: CalendarDays },
  { key: "sin", color: "#5C6670", Icon: CalendarX2 },
  { key: "completada", color: "#16A34A", Icon: CheckCircle2 },
  // Al final, despues de Completadas y con el mismo tratamiento apagado. Hasta ahora esta vista
  // no tenia donde poner una cancelada, asi que al cancelarla desaparecia de la pantalla.
  { key: "cancelada", color: "#5C6670", Icon: XCircle },
];

/** Las etiquetas salen de `ETIQUETA_COLUMNA`, no de aqui: la regla de soltar tiene que poder
 *  nombrar la columna en el aviso sin que las dos listas se separen. */
const TODAS = COLS.map((c) => c.key);

export function TareasPorFecha({ tareas, completadas, canceladas, onOpen, onToggleDone, onReload }: {
  tareas: TareaRow[];
  completadas?: TareaRow[];
  canceladas?: TareaRow[];
  onOpen: (t: TareaRow) => void;
  onToggleDone?: (t: TareaRow) => void;
  onReload?: () => void;
}) {
  const buckets = useMemo(() => {
    // 🔴 Completadas y canceladas van SIEMPRE a su propia columna, nunca a una de fecha: su plazo
    // ya no significa nada. La deduplicacion por id la pone `agruparSinRepetir`, compartida con el
    // otro tablero: una tarea recien movida llega por los dos caminos en la misma recarga.
    const { grupos, poner } = agruparSinRepetir(TODAS);
    for (const t of tareas) {
      if (t.estado === "completada") { poner(t, "completada"); continue; }
      if (t.estado === "cancelada") { poner(t, "cancelada"); continue; }
      // La franja la decide `lib/tareas-fechas.ts`, que es UNA sola definicion y tiene pruebas.
      // Antes esta aritmetica de semanas vivia aqui dentro y no se podia comprobar.
      poner(t, columnaDeTarea(t.fecha_limite));
    }
    for (const t of (completadas || [])) poner(t, "completada");
    for (const t of (canceladas || [])) poner(t, "cancelada");
    return grupos;
  }, [tareas, completadas, canceladas]);

  // 🔴 El «hoy» se congela al empezar el arrastre y se reutiliza al soltar. Si cada columna llamara
  // a `new Date()` por su cuenta, un arrastre que cruce la medianoche podria pintarse como valido
  // y rechazarse al soltar. Es raro, pero evitarlo es gratis.
  const [hoyDelArrastre, setHoyDelArrastre] = useState<Date | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DISTANCIA_ARRASTRE } }));

  const soltar = () => setHoyDelArrastre(null);
  const onDragStart = () => setHoyDelArrastre(new Date());

  const onDragEnd = async (e: DragEndEvent) => {
    const hoy = hoyDelArrastre ?? new Date();
    soltar();
    if (!e.over) return;

    const destino = String(e.over.id) as ColumnaTablero;
    // 🔴 En las TRES listas: el listado activo excluye completadas y canceladas.
    const t = buscarEnListas(String(e.active.id), tareas, completadas, canceladas);
    if (!t) return;

    const accion = accionAlSoltar(destino, t, hoy);
    if (accion.tipo === "nada") return;
    if (accion.tipo === "no_acepta") { toast.error(accion.motivo); return; }

    if (accion.tipo === "estado") {
      // Cambia el estado y NADA MAS: la fecha limite se conserva, para que al recuperarla vuelva
      // entera. Mismo criterio que el tablero por estado.
      if (!(await guardarCambioDeTarea(t.id, { estado: accion.estado }))) { toast.error("No se pudo mover"); return; }
      toast.success(`«${t.titulo}» pasa a ${ETIQUETA_COLUMNA[destino]}`);
      onReload?.();
      return;
    }

    if (accion.tipo === "reabrir") {
      // 🔴 LOS DOS CAMPOS EN UNA SOLA PETICION. Encadenar dos dejaria la tarea reabierta sin
      // plazo, o con plazo y todavia cancelada, si la segunda fallara — y nadie sabria cual paso.
      const ok = await guardarCambioDeTarea(t.id, {
        estado: accion.estado,
        fecha_limite: accion.fecha ? accion.fecha.toISOString() : null,
      });
      if (!ok) { toast.error("No se pudo retomar"); return; }
      // Lo primero que hay que decir es que se RETOMO. La fecha va detras: sin lo primero, un
      // «vence el 28 de agosto» no cuenta que la tarea ha vuelto a estar viva.
      toast.success(accion.fecha
        ? `«${t.titulo}» se retoma y vence ${textoDeFechaLimite(accion.fecha, hoy).toLowerCase()}`
        : `«${t.titulo}» se retoma, sin fecha límite`);
      onReload?.();
      return;
    }

    // Cambia la fecha y NADA MAS: el estado se conserva. Soltar en «Sin fecha limite» deja la
    // tarea VIVA sin plazo — que no es lo mismo que cancelarla, y la columna de al lado es justo
    // Canceladas.
    const fecha = accion.tipo === "fecha" ? accion.fecha : null;
    if (!(await guardarCambioDeTarea(t.id, { fecha_limite: fecha ? fecha.toISOString() : null }))) {
      toast.error("No se pudo mover");
      return;
    }
    // 🔴 El aviso dice LA FECHA EXACTA. A diferencia del estado, la fecha anterior no queda a la
    // vista en ninguna columna: un «movida» a secas dejaria a alguien sin saber que plazo se acaba
    // de escribir encima del que habia.
    toast.success(fecha
      ? `«${t.titulo}» vence ${textoDeFechaLimite(fecha, hoy).toLowerCase()}`
      : `«${t.titulo}» se queda sin fecha límite`);
    onReload?.();
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={soltar}>
      <CuerpoDelTablero
        buckets={buckets}
        tareas={tareas}
        completadas={completadas}
        canceladas={canceladas}
        hoyDelArrastre={hoyDelArrastre}
        onOpen={onOpen}
        onToggleDone={onToggleDone}
      />
    </DndContext>
  );
}

/**
 * 🔴 QUE SE ESTA ARRASTRANDO SE LE PREGUNTA A dnd-kit, NO SE LLEVA UNA COPIA.
 *
 * Este componente existe solo para poder llamar a `useDndContext()`, que hay que hacerlo DENTRO
 * del `DndContext`. Antes el tablero guardaba su propio `dragId` en un `useState`, y esa copia
 * podia quedarse desincronizada: dnd-kit limpia su estado SIEMPRE al terminar un arrastre, pero
 * solo llama a `onDragEnd`/`onDragCancel` si llego a construir el evento (`core.esm.js`, el
 * `if (event)` dentro del `unstable_batchedUpdates`). En los casos en que no, la copia se quedaba
 * encendida y el tablero se quedaba con la sombra del arrastre pegada y columnas apagadas.
 *
 * Con una sola fuente de verdad ese desajuste no puede existir. Es la misma regla que
 * `CONVENCIONES §4.8`, aplicada al estado en vez de a las fechas.
 */
function CuerpoDelTablero({ buckets, tareas, completadas, canceladas, hoyDelArrastre, onOpen, onToggleDone }: {
  buckets: Record<ColumnaTablero, TareaRow[]>;
  tareas: TareaRow[];
  completadas?: TareaRow[];
  canceladas?: TareaRow[];
  hoyDelArrastre: Date | null;
  onOpen: (t: TareaRow) => void;
  onToggleDone?: (t: TareaRow) => void;
}) {
  const { active } = useDndContext();
  const arrastrada = active ? buscarEnListas(String(active.id), tareas, completadas, canceladas) : null;

  /** Que haria cada columna con la tarjeta que se esta arrastrando. `null` si no hay arrastre. */
  const acciones = useMemo(() => {
    if (!arrastrada) return null;
    const hoy = hoyDelArrastre ?? new Date();
    return Object.fromEntries(TODAS.map((k) => [k, accionAlSoltar(k, arrastrada, hoy)])) as Record<ColumnaTablero, AccionSoltar>;
  }, [arrastrada, hoyDelArrastre]);

  return (
    <>
      <div className="-mx-1 px-1">
        <HorizontalScrollArea className="pb-4 scrollbar-thin overflow-y-hidden">
          <div className="flex gap-3" style={{ height: "calc(100vh - 330px)", minHeight: 420 }}>
            {COLS.map((col) => (
              <FechaColumn
                key={col.key}
                id={col.key}
                color={col.color}
                Icon={col.Icon}
                tareas={buckets[col.key]}
                accion={acciones?.[col.key] ?? null}
                onOpen={onOpen}
                onToggleDone={onToggleDone}
              />
            ))}
          </div>
        </HorizontalScrollArea>
      </div>
      <DragOverlay>{arrastrada && <TarjetaFecha tarea={arrastrada} arrastrando />}</DragOverlay>
    </>
  );
}

function FechaColumn({ id, color, Icon, tareas, accion, onOpen, onToggleDone }: {
  id: ColumnaTablero; color: string; Icon: any; tareas: TareaRow[];
  accion: AccionSoltar | null; onOpen: (t: TareaRow) => void; onToggleDone?: (t: TareaRow) => void;
}) {
  // ⚠️ UNA COLUMNA QUE NO ACEPTA TIENE QUE VERSE. Sin esto la tarjeta se suelta, no pasa nada y
  // vuelve a su sitio de un salto: la aplicacion parece rota. Se apaga la columna entera y se dice
  // el motivo en el hueco de las tarjetas, ANTES de que nadie suelte.
  const motivo = accion?.tipo === "no_acepta" ? accion.motivo : null;
  const { isOver, setNodeRef } = useDroppable({ id, disabled: !!motivo });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 min-w-[180px] flex flex-col rounded-2xl bg-neutral-50/70 border-2 border-neutral-100 overflow-hidden transition-all",
        isOver && "border-brand-orange bg-brand-orange/5",
        motivo && "opacity-45 saturate-50",
      )}
    >
      {/* Encabezado con barra de color */}
      <div className="rounded-t-xl px-3 py-2.5 flex items-center gap-2" style={{ background: `linear-gradient(90deg, ${color}, ${color}cc)` }}>
        <Icon className="h-4 w-4 text-white shrink-0" strokeWidth={2} />
        <span className="flex-1 font-ui font-bold text-[11px] uppercase tracking-[0.08em] text-white truncate">{ETIQUETA_COLUMNA[id]}</span>
        <span className="text-[11px] font-bold text-white/90 tabular-nums bg-white/20 rounded-full px-1.5 min-w-[20px] text-center">{tareas.length}</span>
      </div>
      <div className="p-2 space-y-2 flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: "contain" }} onWheel={(e) => { const el = e.currentTarget as HTMLDivElement; const canScrollDown = el.scrollHeight - el.clientHeight - el.scrollTop > 1; const canScrollUp = el.scrollTop > 0; if ((e.deltaY > 0 && canScrollDown) || (e.deltaY < 0 && canScrollUp)) e.stopPropagation(); }}>
        {motivo && (
          <div className="flex items-start gap-1.5 rounded-lg bg-neutral-200/70 px-2 py-1.5 text-[10px] font-ui font-semibold leading-snug text-neutral-600">
            <Ban className="h-3.5 w-3.5 shrink-0 mt-px" strokeWidth={2} />
            <span>{motivo}</span>
          </div>
        )}
        {tareas.length === 0 && !motivo && (
          <div className="text-[11px] text-neutral-400 text-center py-8">Sin tareas</div>
        )}
        {tareas.map((t, i) => (
          <TarjetaArrastrable key={t.id} tarea={t} index={i} onOpen={onOpen} onToggleDone={onToggleDone} />
        ))}
      </div>
    </div>
  );
}

/** La tarjeta con el mecanismo de arrastre encima. Separada de la pintura porque la copia que
 *  sigue al puntero (`DragOverlay`) no puede volver a registrarse con el mismo id. */
function TarjetaArrastrable({ tarea, index, onOpen, onToggleDone }: {
  tarea: TareaRow; index: number; onOpen: (t: TareaRow) => void; onToggleDone?: (t: TareaRow) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tarea.id });
  return (
    <motion.div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // 🔴 La entrada desliza, NO se desvanece. Un `opacity: 0` de arranque es la otra forma de
      // que una tarjeta se quede invisible: si la animacion no llega a correr, se queda en 0 y
      // nadie vuelve a verla. Con esto, en este fichero no hay NINGUN camino que pinte una
      // tarjeta a opacidad 0 — ni entrando, ni arrastrando.
      initial={{ y: 6 }}
      // 🔴 NUNCA 0: `opacidadDeTarjeta` no puede devolverlo. `isDragging` es estado interno de
      // dnd-kit, y atar la visibilidad a el es lo que dejaba una tarjeta invisible en la columna.
      animate={{ opacity: opacidadDeTarjeta(isDragging), y: 0 }}
      transition={{ delay: Math.min(0.02 * index, 0.2) }}
      // Sin mirar `isDragging`, el clic con el que termina un arrastre abriria la ficha.
      onClick={() => !isDragging && onOpen(tarea)}
    >
      <TarjetaFecha tarea={tarea} onToggleDone={onToggleDone} />
    </motion.div>
  );
}

function TarjetaFecha({ tarea, onToggleDone, arrastrando }: {
  tarea: TareaRow; onToggleDone?: (t: TareaRow) => void; arrastrando?: boolean;
}) {
  const vencida = tarea.fecha_limite && tarea.estado !== "completada" && new Date(tarea.fecha_limite) < new Date();
  const borderColor = tarea.color_prioridad || "#5C6670";
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-neutral-100 cursor-grab active:cursor-grabbing transition-shadow",
        arrastrando ? "shadow-2xl rotate-2" : "hover:shadow-md",
      )}
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleDone?.(tarea); }}
            // Sin esto, pulsar el circulo empieza un arrastre en vez de completar la tarea.
            onPointerDown={(e) => e.stopPropagation()}
            title={tarea.estado === "completada" ? "Marcar pendiente" : "Completar"}
            className="shrink-0 -ml-0.5 flex items-center justify-center transition-colors"
          >
            {tarea.estado === "completada"
              ? <CheckCircle2 className="h-4 w-4 text-brand-green" />
              : <Circle className="h-4 w-4 text-neutral-300 hover:text-brand-green" strokeWidth={2} />}
          </button>
          <span className="text-[9px] font-ui font-semibold uppercase tracking-wider text-neutral-400">#{tarea.numero_tarea}</span>
          <span className="text-[9px] font-ui font-bold uppercase tracking-wider text-white px-1.5 py-0.5 rounded-full ml-auto" style={{ backgroundColor: borderColor }}>
            {tarea.prioridad[0].toUpperCase()}
          </span>
        </div>
        <div className={cn("font-display font-bold text-[13px] leading-tight line-clamp-3", tarea.estado === "completada" && "line-through text-neutral-400")}>
          {tarea.titulo}
        </div>
        {tarea.oportunidad_nombre && (
          <div className="mt-1.5 inline-flex items-center text-[10px] font-semibold text-brand-blue bg-brand-blue/10 rounded-md px-1.5 py-0.5 max-w-full truncate">
            {tarea.oportunidad_nombre}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-neutral-50">
          {tarea.fecha_limite ? (
            <span
              className={cn("inline-flex items-center gap-1 text-[10px] font-ui font-semibold rounded-md px-1.5 py-0.5", vencida ? "bg-brand-red/10 text-brand-red" : "bg-neutral-100 text-neutral-500")}
            >
              {vencida ? <AlertCircle className="h-3 w-3" /> : <Calendar className="h-3 w-3" strokeWidth={1.8} />}
              {textoDeFechaLimite(tarea.fecha_limite)}
            </span>
          ) : <span className="text-[10px] text-neutral-300 italic">Sin fecha límite</span>}
          <div className="flex -space-x-1.5 shrink-0">
            <MiniAvatar nombre={tarea.responsable_nombre} foto={tarea.responsable_foto} />
            {tarea.propietario_id && tarea.propietario_id !== tarea.responsable_id && (
              <MiniAvatar nombre={tarea.propietario_nombre} foto={tarea.propietario_foto} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniAvatar({ nombre, foto }: { nombre: string | null; foto: string | null }) {
  if (!nombre && !foto) return null;
  if (foto) return <img src={foto} className="h-5 w-5 rounded-full object-cover border border-white" alt="" />;
  return (
    <div className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[8px] font-bold flex items-center justify-center border border-white">
      {nombre ? initialsOf(nombre) : "??"}
    </div>
  );
}
