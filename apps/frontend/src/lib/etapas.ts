export const ETAPAS = [
  { key: "nuevo",           label: "Nuevo",             color: "#5C6670", bg: "bg-neutral-100",  text: "text-neutral-700" },
  { key: "calificacion",    label: "Calificación",      color: "#2196C9", bg: "bg-blue-100",     text: "text-blue-700" },
  { key: "propuesta",       label: "Propuesta",         color: "#FFB51C", bg: "bg-yellow-100",   text: "text-yellow-700" },
  { key: "documentos",      label: "Documentos",        color: "#5750E8", bg: "bg-orange-100",   text: "text-orange-700" },
  { key: "preparacion",     label: "Preparación",       color: "#5750E8", bg: "bg-orange-100",   text: "text-orange-700" },
  { key: "revision",        label: "Revisión",          color: "#FFB51C", bg: "bg-yellow-100",   text: "text-yellow-700" },
  { key: "impresion_envio", label: "Impresión y envío", color: "#8B4EE6", bg: "bg-violet-100",   text: "text-violet-700" },
  { key: "radicado",        label: "Radicado",          color: "#2196C9", bg: "bg-blue-100",     text: "text-blue-700" },
  { key: "aprobado",        label: "Aprobado",          color: "#43A847", bg: "bg-green-100",    text: "text-green-700" },
  { key: "ganado",          label: "Ganado",            color: "#43A847", bg: "bg-green-100",    text: "text-green-700" },
  { key: "completado",      label: "Completado",        color: "#43A847", bg: "bg-green-100",    text: "text-green-700" },
  { key: "perdido",         label: "Perdido",           color: "#E53935", bg: "bg-red-100",      text: "text-red-700" },
  { key: "cancelado",       label: "Cancelado",         color: "#E53935", bg: "bg-red-100",      text: "text-red-700" }
] as const;

export type EtapaKey = typeof ETAPAS[number]["key"];
