"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Search, Tag as TagIcon, CaretDown, Check, UserCircle } from "@/lib/bootstrap-icons";
import { WhatsappLogo } from "@/lib/bootstrap-icons";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import { nombreVisible } from "@/lib/whatsapp-numero";
import type { WhatsAppPipelineStage, WhatsAppTag } from "./types";

export interface ConversacionItem {
  id: string;
  wa_jid: string;
  nombre_whatsapp: string | null;
  foto_perfil_url: string | null;
  telefono_real?: string | null;
  es_grupo?: boolean;
  archivado?: boolean;
  contacto_id: string | null;
  etapa_id: string | null;
  asignado_a: string | null;
  asignado_nombre: string | null;
  asignado_foto_url: string | null;
  ultimo_mensaje_preview: string | null;
  ultimo_mensaje_at: string | null;
  ultimo_mensaje_direccion: "entrante" | "saliente" | null;
  no_leidos_count: number;
  tags: WhatsAppTag[];
}

interface Props {
  conversaciones: ConversacionItem[] | null;
  etapas: WhatsAppPipelineStage[];
  tags: WhatsAppTag[];
  selectedId: string | null;
  etapaFiltro: string | null;
  onEtapaFiltroChange: (id: string | null) => void;
  tagFiltro: string | null;
  onTagFiltroChange: (id: string | null) => void;
  soloAsignadasAMi: boolean;
  onToggleSoloAsignadasAMi: () => void;
  busqueda: string;
  onBusquedaChange: (q: string) => void;
  onSelect: (c: ConversacionItem) => void;
  loading: boolean;
}

/**
 * Dropdown compacto para filtrar por una sola etiqueta — mismo patrón visual que el `TagPicker`
 * del hilo (`ConversationThread.tsx`), pero de selección única (filtro, no asignación).
 *
 * El panel se renderiza en un portal (mismo patrón de `Tooltip.tsx`/`BuzonesRail.tsx`), no como
 * `absolute` dentro de este propio botón: este botón vive en la fila de chips con
 * `overflow-x-auto`, y un `overflow-x` distinto de `visible` recorta también el eje Y si no se
 * declara `overflow-y` aparte — un `absolute` normal quedaba invisible, recortado por esa fila,
 * aunque el clic sí abría el panel (confirmado en pruebas reales: el elemento existía pero no se
 * veía en pantalla).
 */
function TagFiltroDropdown({ tags, valor, onChange }: { tags: WhatsAppTag[]; valor: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const actual = tags.find((t) => t.id === valor);

  const abrir = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen((v) => !v);
  };

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        onClick={abrir}
        title="Filtrar por etiqueta"
        className={cn(
          "h-[26px] px-2.5 rounded-full text-[10.5px] font-ui font-bold uppercase tracking-wider flex items-center gap-1 transition",
          actual ? "text-white" : "bg-black/5 dark:bg-white/10 text-neutral-500 hover:bg-black/10"
        )}
        style={actual ? { backgroundColor: actual.color } : undefined}
      >
        <TagIcon className="h-3 w-3" />
        {actual ? actual.nombre : "Etiqueta"}
        <CaretDown className="h-2.5 w-2.5" />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 w-48 max-h-64 overflow-y-auto rounded-xl glass-panel py-1 wa-menu-in"
          >
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition"
            >
              <span className="flex-1">Todas las etiquetas</span>
              {!valor && <Check className="h-3.5 w-3.5 text-brand-primary" />}
            </button>
            {tags.length === 0 && <div className="px-3 py-2 text-[11px] text-neutral-400">Sin etiquetas creadas aún</div>}
            {tags.map((t) => (
              <button
                key={t.id}
                onClick={() => { onChange(t.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <span className="flex-1 truncate">{t.nombre}</span>
                {t.id === valor && <Check className="h-3.5 w-3.5 text-brand-primary" />}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function friendlyDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export function ConversationList({
  conversaciones, etapas, tags, selectedId, etapaFiltro, onEtapaFiltroChange, tagFiltro, onTagFiltroChange,
  soloAsignadasAMi, onToggleSoloAsignadasAMi, busqueda, onBusquedaChange, onSelect, loading,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 pt-2.5 pb-2 border-b border-black/5 dark:border-white/10">
        <div className="flex items-center gap-2 h-9 px-3 rounded-xl glass-input">
          <Search className="h-4 w-4 text-neutral-400 shrink-0" />
          <input
            value={busqueda}
            onChange={(e) => onBusquedaChange(e.target.value)}
            placeholder="Buscar por nombre o número…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm"
          />
        </div>
      </div>

      <div className="relative shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto border-b border-black/5 dark:border-white/10" data-lenis-prevent>
          <button
            onClick={() => onEtapaFiltroChange(null)}
            className={cn(
              "shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-ui font-bold uppercase tracking-wider transition",
              etapaFiltro === null ? "bg-brand-primary text-white" : "bg-black/5 dark:bg-white/10 text-neutral-500 hover:bg-black/10"
            )}
          >
            Todas
          </button>
          <button
            onClick={onToggleSoloAsignadasAMi}
            className={cn(
              "shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-ui font-bold uppercase tracking-wider flex items-center gap-1 transition",
              soloAsignadasAMi ? "bg-brand-primary text-white" : "bg-black/5 dark:bg-white/10 text-neutral-500 hover:bg-black/10"
            )}
          >
            <UserCircle className="h-3 w-3" />
            Asignadas a mí
          </button>
          {etapas.map((e) => (
            <button
              key={e.id}
              onClick={() => onEtapaFiltroChange(etapaFiltro === e.id ? null : e.id)}
              style={etapaFiltro === e.id ? { backgroundColor: e.color, color: "#fff" } : undefined}
              className={cn(
                "shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-ui font-bold uppercase tracking-wider transition",
                etapaFiltro !== e.id && "bg-black/5 dark:bg-white/10 text-neutral-500 hover:bg-black/10"
              )}
            >
              {e.label}
            </button>
          ))}
          <TagFiltroDropdown tags={tags} valor={tagFiltro} onChange={onTagFiltroChange} />
        </div>
        {/* El filtro desliza horizontal, pero el borde del panel cortaba el último chip a lo
            bruto sin ninguna pista de que hay más — esta máscara lo convierte en "desliza para
            ver más", no en un error visual. */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-[1px] w-8 bg-gradient-to-l from-bg-canvas dark:from-[#0B0F16] to-transparent" />
      </div>

      <div className="flex-1 overflow-y-auto" data-lenis-prevent>
        {loading || conversaciones === null ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-11 w-11 rounded-full skeleton shrink-0" />
                <div className="flex-1 space-y-1.5 pt-1">
                  <div className="h-3 w-1/2 rounded skeleton" />
                  <div className="h-2.5 w-3/4 rounded skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : conversaciones.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
            <div className="h-14 w-14 rounded-2xl glass-panel text-brand-green flex items-center justify-center">
              <WhatsappLogo className="h-6 w-6" weight="duotone" />
            </div>
            <p className="text-sm font-bold">Sin conversaciones todavía</p>
            <p className="text-xs text-neutral-500 max-w-[220px]">Cuando un lead escriba a este número, aparecerá aquí.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {conversaciones.map((c, i) => {
              const etapa = etapas.find((e) => e.id === c.etapa_id);
              const active = c.id === selectedId;
              return (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 12) * 0.02 }}
                  onClick={() => onSelect(c)}
                  className={cn(
                    "w-full flex items-start gap-3 px-3 py-3 text-left transition relative border-b border-black/[0.03] dark:border-white/[0.03]",
                    active ? "bg-brand-primary/8" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  )}
                >
                  {active && <span className="absolute left-0 top-0 bottom-0 w-1 bg-brand-primary rounded-r-full" />}
                  <div className="relative shrink-0">
                    <WhatsAppAvatar fotoUrl={c.foto_perfil_url} nombre={nombreVisible(c)} size={44} />
                    {c.asignado_a && (
                      <div title={`Asignada a ${c.asignado_nombre || "alguien"}`} className="absolute -bottom-1 -right-1 ring-2 ring-bg-canvas dark:ring-[#0B0F16] rounded-full">
                        <WhatsAppAvatar fotoUrl={c.asignado_foto_url} nombre={c.asignado_nombre || "?"} size={18} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className={cn("text-[13px] truncate flex-1", c.no_leidos_count > 0 ? "font-bold" : "font-medium text-neutral-700 dark:text-neutral-300")}>
                        {nombreVisible(c)}
                      </div>
                      <div className="text-[10px] text-neutral-400 shrink-0 tabular-nums">{friendlyDate(c.ultimo_mensaje_at)}</div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="text-[11.5px] text-neutral-500 truncate flex-1">
                        {c.ultimo_mensaje_direccion === "saliente" && <span className="text-neutral-400">Tú: </span>}
                        {c.ultimo_mensaje_preview || <span className="italic">Sin mensajes</span>}
                      </div>
                      {c.no_leidos_count > 0 && (
                        <span className="text-[10px] font-bold text-white bg-brand-green rounded-full h-4.5 min-w-[18px] px-1 flex items-center justify-center tabular-nums shrink-0">
                          {c.no_leidos_count > 99 ? "99+" : c.no_leidos_count}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {etapa && (
                        <span className="text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: `${etapa.color}22`, color: etapa.color }}>
                          {etapa.label}
                        </span>
                      )}
                      {c.tags.map((t) => (
                        <span key={t.id} className="text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
                          {t.nombre}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
