"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowLeft, CaretDown, Tag as TagIcon, Check, Plus, Users2 } from "@/lib/bootstrap-icons";
import { MessageBubble } from "./MessageBubble";
import { ConversationComposer } from "./ConversationComposer";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import { AsignadoPicker, type UsuarioAsignable } from "./AsignadoPicker";
import { formatearNumeroWhatsApp, nombreVisible } from "@/lib/whatsapp-numero";
import type { WhatsAppConversacionDetalle, WhatsAppMensaje, WhatsAppPipelineStage, WhatsAppTag } from "./types";

/** Colores predefinidos para crear un tag sin salir del chat — los mismos tonos que ya usa el
 * pipeline en otras partes del CRM, para que un tag nuevo no desentone. */
const COLORES_TAG = ["#5750E8", "#43A847", "#E53935", "#2196C9", "#FFB51C", "#33359D", "#8338EC"];

function numeroConBandera(jid: string): string {
  const { texto, bandera } = formatearNumeroWhatsApp(jid);
  return bandera ? `${bandera} ${texto}` : texto;
}

/** Separador de día como en WhatsApp: "Hoy", "Ayer", el día de la semana esta semana, o la fecha. */
function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((inicio(hoy) - inicio(d)) / 86_400_000);
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 7) return d.toLocaleDateString("es", { weekday: "long" });
  return d.toLocaleDateString("es", { day: "numeric", month: "long", year: d.getFullYear() === hoy.getFullYear() ? undefined : "numeric" });
}

function StagePicker({ etapas, valor, onChange }: { etapas: WhatsAppPipelineStage[]; valor: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const actual = etapas.find((e) => e.id === valor);
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={actual?.label || "Elegir etapa"}
        className="h-8 px-2 sm:px-2.5 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition"
        style={{ backgroundColor: actual ? `${actual.color}1a` : undefined, color: actual?.color }}
      >
        {/* Móvil: solo el punto de color — la etiqueta completa ("Conversación activa",
            "Tomando decisión"...) apretaba el nombre del contacto contra el resto de acciones
            del header en pantallas angostas. Desde `sm` se ve la etiqueta completa. */}
        {actual ? (
          <span className="h-2 w-2 rounded-full shrink-0 sm:hidden" style={{ backgroundColor: actual.color }} />
        ) : null}
        <span className="hidden sm:inline">{actual?.label || "Etapa"}</span>
        <CaretDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-52 max-w-[calc(100vw-2rem)] rounded-xl glass-panel py-1 overflow-hidden wa-menu-in">
            {etapas.map((e) => (
              <button
                key={e.id}
                onClick={() => { onChange(e.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                <span className="flex-1">{e.label}</span>
                {e.id === valor && <Check className="h-3.5 w-3.5 text-brand-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TagPicker({ todas, activas, onToggle, onCrear }: {
  todas: WhatsAppTag[]; activas: WhatsAppTag[]; onToggle: (t: WhatsAppTag) => void;
  onCrear: (nombre: string, color: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [colorNuevo, setColorNuevo] = useState(COLORES_TAG[0]);
  const [guardando, setGuardando] = useState(false);

  const confirmarCrear = async () => {
    if (nombreNuevo.trim().length < 1 || guardando) return;
    setGuardando(true);
    try {
      await onCrear(nombreNuevo.trim(), colorNuevo);
      setNombreNuevo("");
      setCreando(false);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} title="Etiquetas" className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center transition text-neutral-500 relative">
        <TagIcon className="h-4 w-4" />
        {activas.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-brand-primary text-white text-[8px] font-bold flex items-center justify-center">
            {activas.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setCreando(false); }} />
          <div className="absolute right-0 mt-1 z-20 w-56 max-w-[calc(100vw-2rem)] rounded-xl glass-panel py-1 overflow-hidden wa-menu-in">
            <div className="max-h-56 overflow-y-auto">
              {todas.length === 0 && !creando && <div className="px-3 py-2 text-[11px] text-neutral-400">Sin tags creados aún</div>}
              {todas.map((t) => {
                const on = activas.some((a) => a.id === t.id);
                return (
                  <button key={t.id} onClick={() => onToggle(t)} className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 truncate">{t.nombre}</span>
                    {on && <Check className="h-3.5 w-3.5 text-brand-primary" />}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-black/5 dark:border-white/10 mt-1 pt-1 px-2 pb-2">
              {creando ? (
                <div className="space-y-2 pt-1">
                  <input
                    autoFocus
                    value={nombreNuevo}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmarCrear()}
                    placeholder="Nombre de la etiqueta"
                    className="w-full h-8 px-2.5 rounded-lg bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {COLORES_TAG.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColorNuevo(c)}
                        style={{ backgroundColor: c }}
                        className={cn("h-5 w-5 rounded-full transition", colorNuevo === c && "ring-2 ring-offset-2 ring-black/30 dark:ring-offset-neutral-900")}
                      />
                    ))}
                  </div>
                  <button
                    onClick={confirmarCrear}
                    disabled={guardando || nombreNuevo.trim().length < 1}
                    className="w-full h-8 rounded-lg bg-brand-primary text-white text-xs font-semibold disabled:opacity-40 transition"
                  >
                    {guardando ? "Creando…" : "Crear etiqueta"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreando(true)}
                  className="w-full flex items-center gap-2 px-1 py-1.5 text-xs font-semibold text-brand-primary hover:bg-brand-primary/8 rounded-lg transition"
                >
                  <Plus className="h-3.5 w-3.5" /> Nueva etiqueta
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  conversacion: WhatsAppConversacionDetalle;
  mensajes: WhatsAppMensaje[] | null;
  etapas: WhatsAppPipelineStage[];
  tags: WhatsAppTag[];
  usuarios: UsuarioAsignable[];
  conectado: boolean;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  onBack?: () => void;
  onSend: (d: { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string; archivoTamanio?: number }) => Promise<void>;
  onRetry?: (m: WhatsAppMensaje) => void;
  onCambiarEtapa: (etapaId: string) => void;
  onAsignar: (userId: string | null) => void;
  onToggleTag: (tag: WhatsAppTag) => void;
  onCrearTag: (nombre: string, color: string) => Promise<void>;
  onAbrirPerfil: () => void;
  onDescargar?: (m: WhatsAppMensaje) => Promise<void>;
}

export function ConversationThread({
  conversacion, mensajes, etapas, tags, usuarios, conectado, hasMore = false, loadingOlder = false, onLoadOlder,
  onBack, onSend, onRetry, onCambiarEtapa, onAsignar, onToggleTag, onCrearTag, onAbrirPerfil, onDescargar,
}: Props) {
  const esGrupo = !!conversacion.es_grupo || conversacion.wa_jid.endsWith("@g.us");

  /** Tocar una cita lleva al mensaje original (si está cargado) y lo resalta un momento. */
  const irACita = (waId: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-wa-id="${CSS.escape(waId)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ background: "rgba(87,80,232,.22)" }, { background: "transparent" }], { duration: 1400, easing: "ease-out" });
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ancla de scroll para el historial anterior (evita el "salto" al prepender mensajes viejos).
  const anchorHeightRef = useRef(0);
  const anchorTopRef = useRef(0);
  const prevConversacionIdRef = useRef<string | null>(null);
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const prevLenRef = useRef(0);
  // Ids que ya estaban al abrir el chat: esos NO se animan (abrir un chat con 50 mensajes no debe
  // "llover" burbujas). Solo entran animados los que llegan o se envían mientras se mira.
  const idsInicialesRef = useRef<Set<string> | null>(null);
  if (mensajes && idsInicialesRef.current === null) idsInicialesRef.current = new Set(mensajes.map((m) => m.id));

  // Scroll cerca del tope → trae el historial anterior (antes el módulo cargaba fijo los últimos
  // 50 mensajes y no había forma de ver nada más viejo, aunque el backend ya soportaba el cursor).
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 120 && hasMore && !loadingOlder && onLoadOlder) {
      anchorHeightRef.current = el.scrollHeight;
      anchorTopRef.current = el.scrollTop;
      onLoadOlder();
    }
  };

  // Al cambiar de chat baja al fondo; con un mensaje nuevo baja solo si ya se estaba cerca del
  // fondo (o es un mensaje propio); en scroll-up (prepend de historial) preserva la posición.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !mensajes) return;
    const firstId = mensajes[0]?.id ?? null;
    const lastId = mensajes[mensajes.length - 1]?.id ?? null;
    const conversacionCambio = conversacion.id !== prevConversacionIdRef.current;
    const esPrepend =
      !conversacionCambio &&
      !!prevFirstIdRef.current &&
      firstId !== prevFirstIdRef.current &&
      mensajes.length > prevLenRef.current &&
      mensajes.some((m) => m.id === prevFirstIdRef.current);

    if (conversacionCambio) {
      el.scrollTop = el.scrollHeight;
    } else if (esPrepend) {
      el.scrollTop = el.scrollHeight - anchorHeightRef.current + anchorTopRef.current;
    } else if (lastId && lastId !== prevLastIdRef.current) {
      const cercaDelFondo = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      const ultimoEsMio = mensajes[mensajes.length - 1]?.direccion === "saliente";
      if (cercaDelFondo || ultimoEsMio) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevLenRef.current = mensajes.length;
    prevConversacionIdRef.current = conversacion.id;
  }, [mensajes, conversacion.id]);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full wa-thread-in">
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-black/5 dark:border-white/10 glass-topbar">
        {onBack && (
          <button onClick={onBack} className="lg:hidden h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <button onClick={onAbrirPerfil} className="flex-1 min-w-0 flex items-center gap-2.5 text-left rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/5 transition" title="Ver perfil">
          <WhatsAppAvatar fotoUrl={conversacion.foto_perfil_url} nombre={nombreVisible(conversacion)} size={36} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate">{nombreVisible(conversacion)}</div>
            <div className="text-[10px] text-neutral-500 truncate flex items-center gap-1">
              {esGrupo ? <><Users2 className="h-3 w-3" /> Grupo de WhatsApp</> : numeroConBandera(conversacion.telefono_real || conversacion.wa_jid)}
            </div>
          </div>
        </button>
        <AsignadoPicker usuarios={usuarios} valor={conversacion.asignado_a} onChange={onAsignar} />
        <TagPicker todas={tags} activas={conversacion.tags} onToggle={onToggleTag} onCrear={onCrearTag} />
        <StagePicker etapas={etapas} valor={conversacion.etapa_id} onChange={onCambiarEtapa} />
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 chat-bg" data-lenis-prevent>
        {loadingOlder && (
          <div className="flex justify-center py-1">
            <div className="h-4 w-4 rounded-full border-2 border-neutral-300 border-t-brand-primary animate-spin" />
          </div>
        )}
        {mensajes === null ? (
          <div className="h-full flex items-center justify-center text-xs text-neutral-400">Cargando…</div>
        ) : mensajes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-neutral-400">Todavía no hay mensajes en esta conversación</div>
        ) : (
          mensajes.map((m, i) => {
            const dia = etiquetaDia(m.created_at);
            const nuevoDia = i === 0 || etiquetaDia(mensajes[i - 1].created_at) !== dia;
            return (
              <div key={m.id}>
                {nuevoDia && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] font-semibold capitalize px-3 py-1 rounded-full glass-light text-neutral-500 shadow-sm">{dia}</span>
                  </div>
                )}
                <MessageBubble
                  m={m}
                  esGrupo={esGrupo}
                  onRetry={onRetry}
                  onDescargar={onDescargar}
                  onIrACita={irACita}
                  // Un saliente real que reemplaza a su burbuja optimista (temp-) ya se animó al
                  // enviarse: no se vuelve a animar al reconciliarse con el id del servidor.
                  animar={!idsInicialesRef.current?.has(m.id) && (m.id.startsWith("temp-") || m.direccion === "entrante")}
                />
              </div>
            );
          })
        )}
      </div>

      <ConversationComposer onSend={onSend} disabled={!conectado} />
    </div>
  );
}
