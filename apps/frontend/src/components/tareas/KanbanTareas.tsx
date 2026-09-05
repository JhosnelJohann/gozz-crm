"use client";
import { useMemo } from "react";
import { DndContext, type DragEndEvent, DragOverlay, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { motion } from "framer-motion";
import { CheckSquare, Calendar, AlertCircle, Clock, Pause, Play, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/auth-user";
import { HorizontalScrollArea } from "@/components/ui/HorizontalScrollArea";
import { DISTANCIA_ARRASTRE, agruparSinRepetir, buscarEnListas, guardarCambioDeTarea, opacidadDeTarjeta } from "@/lib/tareas-tablero";
import type { TareaRow } from "./TaskCard";

interface Props {
  tareas: TareaRow[];
  /**
   * 🔴 Completadas Y CANCELADAS se cargan aparte: el listado por defecto excluye las dos (son
   * 25.000+ filas y esta por rendimiento). Antes solo llegaban las completadas, asi que arrastrar
   * a «Cancelada» hacia DESAPARECER la tarjeta — el PATCH funcionaba, pero nadie volvia a pedir esa
   * tarea y la columna seguia marcando 0. El dato estaba intacto; recuperarlo, imposible desde aqui.
   */
  completadas?: TareaRow[];
  canceladas?: TareaRow[];
  onOpen: (t: TareaRow) => void;
  onReload: () => void;
}

const COLUMNS: { key: TareaRow["estado"]; label: string; color: string; icon: any }[] = [
  { key: "pendiente",   label: "Pendiente",   color: "#2196C9", icon: Clock },
  { key: "en_progreso", label: "En progreso", color: "#5750E8", icon: Play },
  { key: "completada",  label: "Completada",  color: "#43A847", icon: CheckSquare },
  { key: "cancelada",   label: "Cancelada",   color: "#5C6670", icon: X }
];

const ESTADOS = COLUMNS.map((c) => c.key);

export function KanbanTareas({ tareas, completadas = [], canceladas = [], onOpen, onReload }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DISTANCIA_ARRASTRE } }));

  const buckets = useMemo(() => {
    // El reparto sin repetidos lo pone `agruparSinRepetir`, compartido con el tablero por fecha.
    const { grupos: m, poner } = agruparSinRepetir(ESTADOS);
    for (const t of tareas) {
      if (m[t.estado]) poner(t, t.estado);
    }
    // Las que la lista activa excluye vienen aparte, a su columna.
    for (const t of completadas) poner(t, "completada");
    for (const t of canceladas) poner(t, "cancelada");
    // Dentro de cada columna: de la más reciente a la más vieja. La columna Completada
    // ordena por fecha de completado (la recién completada queda arriba); el resto por creación.
    for (const k of ESTADOS) {
      if (k === "completada") {
        m[k].sort((a, b) => new Date((b as any).fecha_completada || b.created_at).getTime() - new Date((a as any).fecha_completada || a.created_at).getTime());
      } else {
        m[k].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
    }
    return m;
  }, [tareas, completadas, canceladas]);

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over) return;
    const newEstado = String(e.over.id) as TareaRow["estado"];
    const id = String(e.active.id);
    // 🔴 Se busca en las TRES listas, no solo en la activa. Si solo se mirara `tareas`, arrastrar
    // una cancelada de vuelta a «Pendiente» no encontraria la tarea y no haria nada — que es
    // exactamente el «no se puede recuperar» que esta entrega viene a arreglar.
    const t = buscarEnListas(id, tareas, completadas, canceladas);
    if (!t || t.estado === newEstado) return;
    if (!(await guardarCambioDeTarea(id, { estado: newEstado }))) { toast.error("No se pudo mover"); return; }
    toast.success(`Movida a ${newEstado.replace("_", " ")}`);
    onReload();
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <HorizontalScrollArea className="pb-4">
        <div className="flex gap-3">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              id={col.key}
              label={col.label}
              color={col.color}
              Icon={col.icon}
              tareas={buckets[col.key] || []}
              onOpen={onOpen}
            />
          ))}
        </div>
      </HorizontalScrollArea>
      <SombraArrastrada tareas={tareas} completadas={completadas} canceladas={canceladas} />
    </DndContext>
  );
}

/**
 * 🔴 QUE SE ESTA ARRASTRANDO SE LE PREGUNTA A dnd-kit, NO SE LLEVA UNA COPIA.
 *
 * Este tablero guardaba su propio `dragId` en un `useState`, y **no tenia `onDragCancel`**: pulsar
 * Escape o soltar fuera de una columna dejaba esa copia encendida, con la sombra del arrastre
 * pegada a la pantalla. El otro tablero si lo tenia, asi que ademas los dos trataban el arrastre
 * de dos formas distintas.
 *
 * Ya no hay copia que sincronizar ni manejador que se pueda olvidar: se lee el estado de dnd-kit,
 * que se limpia SIEMPRE al terminar un arrastre, termine como termine.
 */
function SombraArrastrada({ tareas, completadas, canceladas }: {
  tareas: TareaRow[]; completadas: TareaRow[]; canceladas: TareaRow[];
}) {
  const { active } = useDndContext();
  const t = active ? buscarEnListas(String(active.id), tareas, completadas, canceladas) : null;
  return <DragOverlay>{t && <MiniCard tarea={t} dragging />}</DragOverlay>;
}

function KanbanColumn({ id, label, color, Icon, tareas, onOpen }: {
  id: string; label: string; color: string; Icon: any; tareas: TareaRow[]; onOpen: (t: TareaRow) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl bg-neutral-50/60 border-2 border-dashed border-transparent transition-all flex flex-col min-h-[320px] flex-1 min-w-[260px]",
        isOver && "border-brand-orange bg-brand-orange/5"
      )}
    >
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: color }}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="flex-1 font-ui font-bold text-[11px] uppercase tracking-[0.1em] text-neutral-700">{label}</div>
        <span className="text-[10px] font-bold text-neutral-500 tabular-nums">{tareas.length}</span>
      </div>
      <div className="p-2 space-y-2 flex-1 overflow-y-auto">
        {tareas.length === 0 ? (
          <div className="text-[11px] text-neutral-400 text-center py-6">Arrastra tareas aquí</div>
        ) : (
          tareas.map((t, i) => <DraggableCard key={t.id} tarea={t} index={i} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

function DraggableCard({ tarea, index, onOpen }: { tarea: TareaRow; index: number; onOpen: (t: TareaRow) => void }) {
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
      // 🔴 NUNCA 0. Ver `opacidadDeTarjeta`: una tarjeta que existe y no se ve es peor que una
      // que se ve mal, y atar la visibilidad al estado interno de dnd-kit es lo que lo permitia.
      animate={{ opacity: opacidadDeTarjeta(isDragging), y: 0 }}
      transition={{ delay: Math.min(0.02 * index, 0.2) }}
      onClick={() => !isDragging && onOpen(tarea)}
    >
      <MiniCard tarea={tarea} />
    </motion.div>
  );
}

function MiniCard({ tarea, dragging }: { tarea: TareaRow; dragging?: boolean }) {
  const vencida = tarea.fecha_limite && tarea.estado !== "completada" && new Date(tarea.fecha_limite) < new Date();
  const borderColor = tarea.color_prioridad || "#5C6670";
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-neutral-100 cursor-grab active:cursor-grabbing transition-shadow",
        dragging ? "shadow-2xl rotate-2" : "hover:shadow-md"
      )}
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] font-ui font-semibold uppercase tracking-wider text-neutral-400">#{tarea.numero_tarea}</span>
          <span
            className="text-[9px] font-ui font-bold uppercase tracking-wider text-white px-1.5 py-0.5 rounded-full ml-auto"
            style={{ backgroundColor: borderColor }}
          >
            {tarea.prioridad[0].toUpperCase()}
          </span>
        </div>
        <div className={cn("font-display font-bold text-[13px] leading-tight line-clamp-2", tarea.estado === "completada" && "line-through text-neutral-400")}>
          {tarea.titulo}
        </div>
        {tarea.oportunidad_nombre && (
          <div className="text-[10px] text-neutral-500 truncate mt-1">{tarea.oportunidad_nombre}</div>
        )}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-50">
          {tarea.fecha_limite ? (
            <span className={cn("flex items-center gap-1 text-[10px] font-ui", vencida ? "text-brand-red font-bold" : "text-neutral-400")}>
              {vencida ? <AlertCircle className="h-3 w-3" /> : <Calendar className="h-3 w-3" strokeWidth={1.8} />}
              {new Date(tarea.fecha_limite).toLocaleDateString("es", { day: "2-digit", month: "short" })}
            </span>
          ) : <span />}
          <div className="flex -space-x-1.5">
            {tarea.responsable_nombre && (
              tarea.responsable_foto ? (
                <img src={tarea.responsable_foto} className="h-5 w-5 rounded-full object-cover border border-white" alt="" />
              ) : (
                <div className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[8px] font-bold flex items-center justify-center border border-white">
                  {initialsOf(tarea.responsable_nombre)}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
