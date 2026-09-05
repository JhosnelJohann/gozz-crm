"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Spotlight } from "@/components/magic/Spotlight";
import { SenderAvatar } from "./SenderAvatar";
import { EmailEmptyState } from "./EmailEmptyState";
import { Paperclip, Link2, Sparkle } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

export interface EmailItem {
  id: string;
  buzon_id: string;
  from_addr: string | null;
  from_name: string | null;
  to_addrs: any[];
  subject: string | null;
  body_text: string | null;
  leido: boolean;
  direccion: "entrante" | "saliente";
  contacto_id: string | null;
  oportunidad_id: string | null;
  fecha_email: string;
  carpeta: string;
  adjuntos?: any[];
}

interface Props {
  emails: EmailItem[] | null;
  selectedId: string | null;
  checked: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (e: EmailItem) => void;
  onConnectMailbox?: () => void;
  loading: boolean;
}

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const sameYest = d.toDateString() === yesterday.toDateString();
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (sameYest) return "Ayer";
  if (sameYear) return d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  return d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "2-digit" });
}

function EmailRow({ e, active, isChecked, onToggle, onSelect, i }: {
  e: EmailItem; active: boolean; isChecked: boolean;
  onToggle: () => void; onSelect: () => void; i: number;
}) {
  const attachmentsCount = Array.isArray(e.adjuntos) ? e.adjuntos.length : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className="px-2"
    >
      <Spotlight
        className={cn(
          "relative rounded-xl cursor-pointer transition-all",
          active ? "bg-brand-orange/10 ring-1 ring-brand-orange/30 shadow-glow" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
        )}
      >
        {active && (
          <motion.div
            layoutId="email-active-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-10 w-1 rounded-r-full gradient-orange"
          />
        )}
        <div className="flex gap-3 p-3">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={onToggle}
            onClick={(ev) => ev.stopPropagation()}
            className="h-3.5 w-3.5 mt-1.5 rounded accent-brand-orange cursor-pointer shrink-0"
          />
          <SenderAvatar email={e.from_addr} name={e.from_name} size={36} />
          <div className="flex-1 min-w-0" onClick={onSelect}>
            <div className="flex items-center gap-2 mb-0.5">
              {!e.leido && (
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-brand-orange animate-ping opacity-75" />
                  <span className="relative rounded-full bg-brand-orange h-1.5 w-1.5" />
                </span>
              )}
              <div className={cn("text-sm truncate flex-1", !e.leido ? "font-bold" : "font-medium text-neutral-600 dark:text-neutral-300")}>
                {e.from_name || (e.from_addr || "").split("@")[0] || "—"}
              </div>
              <div className="text-[10px] text-neutral-400 shrink-0 font-ui uppercase tracking-wider tabular-nums">{friendlyDate(e.fecha_email)}</div>
            </div>
            <div className={cn("text-sm truncate font-display leading-tight", !e.leido ? "font-black" : "font-bold text-neutral-500")}>
              {e.subject || "(sin asunto)"}
            </div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
              {(e.body_text || "").trim().slice(0, 140) || <span className="italic text-neutral-400">Sin contenido</span>}
            </div>
            {(attachmentsCount > 0 || e.contacto_id || e.oportunidad_id || e.direccion === "saliente") && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {e.direccion === "saliente" && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-brand-green/10 text-brand-green">
                    <Sparkle className="h-2.5 w-2.5" strokeWidth={2} /> Enviado
                  </span>
                )}
                {attachmentsCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-white/5 text-neutral-500">
                    <Paperclip className="h-2.5 w-2.5" /> {attachmentsCount}
                  </span>
                )}
                {e.contacto_id && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-brand-blue/10 text-brand-blue">
                    <Link2 className="h-2.5 w-2.5" /> Contacto
                  </span>
                )}
                {e.oportunidad_id && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-brand-orange/10 text-brand-orange">
                    <Link2 className="h-2.5 w-2.5" /> Oportunidad
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Spotlight>
    </motion.div>
  );
}

function SkeletonRow({ i }: { i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: i * 0.05 }}
      className="flex gap-3 p-3 mx-2"
    >
      <div className="h-3.5 w-3.5 mt-1.5 rounded skeleton shrink-0" />
      <div className="h-9 w-9 rounded-xl skeleton shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-1/3 rounded skeleton" />
        <div className="h-3.5 w-2/3 rounded skeleton" />
        <div className="h-2.5 w-full rounded skeleton" />
      </div>
    </motion.div>
  );
}

export function EmailList({ emails, selectedId, checked, onToggle, onSelect, onConnectMailbox, loading }: Props) {
  if (loading || emails === null) {
    return (
      <div className="flex-1 overflow-y-auto py-2">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} i={i} />)}
      </div>
    );
  }
  if (emails.length === 0) {
    return <EmailEmptyState onConnectMailbox={onConnectMailbox} />;
  }
  return (
    <div className="flex-1 overflow-y-auto py-2 space-y-0.5" data-lenis-prevent>
      <AnimatePresence initial={false}>
        {emails.map((e, i) => (
          <EmailRow
            key={e.id}
            e={e}
            active={selectedId === e.id}
            isChecked={checked.has(e.id)}
            onToggle={() => onToggle(e.id)}
            onSelect={() => onSelect(e)}
            i={i}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
