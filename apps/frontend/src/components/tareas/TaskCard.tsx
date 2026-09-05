"use client";
import { motion } from "framer-motion";
import { CheckSquare, Square, Calendar, AlertCircle, ExternalLink, Star, VolumeX, ListTree, MessageSquare, Paperclip, User } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/auth-user";
import { useRouter } from "next/navigation";

export interface TareaRow {
  id: string;
  numero_tarea: number;
  titulo: string;
  descripcion: string | null;
  estado: "pendiente" | "en_progreso" | "completada" | "cancelada";
  prioridad: "baja" | "normal" | "alta" | "urgente";
  color_prioridad?: string;
  fecha_limite: string | null;
  responsable_id: string | null;
  responsable_nombre: string | null;
  responsable_foto: string | null;
  propietario_id: string | null;
  propietario_nombre: string | null;
  propietario_foto: string | null;
  oportunidad_id: string | null;
  oportunidad_nombre: string | null;
  contacto_id: string | null;
  contacto_nombre: string | null;
  subtareas_count: number;
  archivos_count?: number;
  unread_count?: number;
  es_favorito: boolean;
  mute_audio: boolean;
  chat_grupo_id: string | null;
  checklist: { texto: string; hecho?: boolean }[] | null;
  created_at: string;
}

const PRIORIDAD_LABEL: Record<string, string> = { baja: "Baja", normal: "Normal", alta: "Alta", urgente: "Urgente" };

function Avatar({ nombre, foto, ring }: { nombre: string | null; foto: string | null; ring?: string }) {
  if (foto) return <img src={foto} alt="" className={cn("h-7 w-7 rounded-full object-cover border-2 border-white shadow-sm", ring)} />;
  return (
    <div className={cn("h-7 w-7 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow-sm", ring)}>
      {nombre ? initialsOf(nombre) : "??"}
    </div>
  );
}

export function TaskCard({
  tarea, index = 0, onToggleDone, onOpen
}: {
  tarea: TareaRow;
  index?: number;
  onToggleDone?: (t: TareaRow) => void;
  onOpen?: (t: TareaRow) => void;
}) {
  const router = useRouter();
  const done = tarea.estado === "completada";
  const enProgreso = tarea.estado === "en_progreso";
  const vencida = tarea.fecha_limite && !done && new Date(tarea.fecha_limite) < new Date();
  const borderColor = tarea.color_prioridad || "#5C6670";

  const checklistTotal = tarea.checklist?.length || 0;
  const checklistDone = tarea.checklist?.filter((c) => c.hecho).length || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(0.03 * index, 0.3), type: "spring", stiffness: 260, damping: 24 }}
      whileHover={{ y: -2 }}
      onClick={() => onOpen?.(tarea)}
      className={cn(
        "bg-white rounded-2xl pl-0 pr-4 py-4 flex items-stretch gap-0 cursor-pointer group transition-shadow border border-neutral-100 relative",
        "hover:shadow-lg hover:shadow-black/5",
        done && "opacity-55"
      )}
    >
      {/* Side accent priority */}
      <div
        className="w-1 rounded-l-2xl shrink-0"
        style={{ backgroundColor: borderColor, boxShadow: vencida && !done ? `0 0 16px ${borderColor}80` : undefined }}
      />

      <div className="pl-4 flex items-center gap-3 w-full">
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={(e) => { e.stopPropagation(); onToggleDone?.(tarea); }}
          className="shrink-0"
          aria-label={done ? "Marcar pendiente" : "Marcar completada"}
        >
          {done ? (
            <CheckSquare className="h-5 w-5 text-brand-green" strokeWidth={2} />
          ) : (
            <Square className="h-5 w-5 text-neutral-300 group-hover:text-brand-orange transition-colors" strokeWidth={1.8} />
          )}
        </motion.button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-ui font-semibold uppercase tracking-wider text-neutral-400">#{tarea.numero_tarea}</span>
            <div className={cn("font-display font-bold text-[14.5px] leading-tight truncate flex-1", done && "line-through text-neutral-400")}>
              {tarea.titulo}
            </div>
            {tarea.es_favorito && <Star className="h-3.5 w-3.5 text-brand-gold fill-brand-gold shrink-0" />}
            {tarea.mute_audio && <VolumeX className="h-3.5 w-3.5 text-neutral-300 shrink-0" />}
            {enProgreso && (
              <motion.span
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="shrink-0 text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-brand-blue/10 text-brand-blue"
              >
                En progreso
              </motion.span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px] text-neutral-500">
            {/*
              🔴 De quién es la tarea. `contacto_id` y `contacto_nombre` llevaban tiempo declarados
              en el tipo de arriba y no se pintaban en ningún sitio: la API los devolvía resueltos y
              nadie los enseñaba, así que desde el tablero no había forma de saber de qué cliente
              era una tarea sin entrar en su ficha.
            */}
            {tarea.contacto_nombre && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (tarea.contacto_id) router.push(`/contactos/${tarea.contacto_id}`); }}
                title="Ver el contacto"
                className="flex items-center gap-1 truncate max-w-[220px] text-brand-blue hover:text-brand-orange hover:underline"
              >
                <User className="h-3 w-3" strokeWidth={1.8} />
                <span className="truncate">{tarea.contacto_nombre}</span>
              </button>
            )}
            {tarea.oportunidad_nombre && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (tarea.oportunidad_id) router.push(`/oportunidades/${tarea.oportunidad_id}`); }}
                title="Ver en la oportunidad"
                className="flex items-center gap-1 truncate max-w-[220px] text-brand-orange hover:text-brand-gold hover:underline"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                <span className="truncate">{tarea.oportunidad_nombre}</span>
              </button>
            )}
            {tarea.subtareas_count > 0 && (
              <span className="flex items-center gap-1">
                <ListTree className="h-3 w-3" strokeWidth={1.8} />
                {tarea.subtareas_count}
              </span>
            )}
            {checklistTotal > 0 && (
              <span className="flex items-center gap-1">
                <CheckSquare className="h-3 w-3" strokeWidth={1.8} />
                {checklistDone}/{checklistTotal}
              </span>
            )}
            {(tarea.archivos_count || 0) > 0 && (
              <span className="flex items-center gap-1">
                <Paperclip className="h-3 w-3" strokeWidth={1.8} />
                {tarea.archivos_count}
              </span>
            )}
            {(tarea.unread_count || 0) > 0 && (
              <span className="flex items-center gap-1 text-brand-orange font-semibold">
                <MessageSquare className="h-3 w-3" strokeWidth={1.8} />
                {tarea.unread_count}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span
            className="px-2.5 py-1 rounded-full text-[9px] font-ui font-bold uppercase tracking-[0.1em] text-white"
            style={{ backgroundColor: borderColor, boxShadow: `0 4px 12px -4px ${borderColor}80` }}
          >
            {PRIORIDAD_LABEL[tarea.prioridad]}
          </span>

          {tarea.fecha_limite && (
            <span className={cn(
              "flex items-center gap-1 text-[11px] font-ui font-medium",
              vencida ? "text-brand-red font-bold" : "text-neutral-500"
            )}>
              {vencida ? <AlertCircle className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {new Date(tarea.fecha_limite).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}

          <div className="flex -space-x-2">
            {tarea.propietario_nombre && (
              <div title={`Creador: ${tarea.propietario_nombre}`}>
                <Avatar nombre={tarea.propietario_nombre} foto={tarea.propietario_foto} />
              </div>
            )}
            {tarea.responsable_nombre && tarea.responsable_id !== tarea.propietario_id && (
              <div title={`Responsable: ${tarea.responsable_nombre}`}>
                <Avatar nombre={tarea.responsable_nombre} foto={tarea.responsable_foto} ring="ring-2 ring-brand-orange/40" />
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
