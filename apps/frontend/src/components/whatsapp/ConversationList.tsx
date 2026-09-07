"use client";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { WhatsappLogo } from "@/lib/bootstrap-icons";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import type { WhatsAppPipelineStage, WhatsAppTag } from "./types";

export interface ConversacionItem {
  id: string;
  wa_jid: string;
  nombre_whatsapp: string | null;
  foto_perfil_url: string | null;
  contacto_id: string | null;
  etapa_id: string | null;
  ultimo_mensaje_preview: string | null;
  ultimo_mensaje_at: string | null;
  ultimo_mensaje_direccion: "entrante" | "saliente" | null;
  no_leidos_count: number;
  tags: WhatsAppTag[];
}

interface Props {
  conversaciones: ConversacionItem[] | null;
  etapas: WhatsAppPipelineStage[];
  selectedId: string | null;
  etapaFiltro: string | null;
  onEtapaFiltroChange: (id: string | null) => void;
  onSelect: (c: ConversacionItem) => void;
  loading: boolean;
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

export function ConversationList({ conversaciones, etapas, selectedId, etapaFiltro, onEtapaFiltroChange, onSelect, loading }: Props) {
  return (
    <div className="flex flex-col h-full min-h-0">
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
            <div className="h-14 w-14 rounded-2xl bg-brand-green/10 text-brand-green flex items-center justify-center">
              <WhatsappLogo className="h-6 w-6" weight="fill" />
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
                  <WhatsAppAvatar fotoUrl={c.foto_perfil_url} nombre={c.nombre_whatsapp || c.wa_jid} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className={cn("text-[13px] truncate flex-1", c.no_leidos_count > 0 ? "font-bold" : "font-medium text-neutral-700 dark:text-neutral-300")}>
                        {c.nombre_whatsapp || c.wa_jid.split("@")[0]}
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
