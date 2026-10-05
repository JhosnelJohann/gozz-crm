"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowLeft, CaretDown, Tag as TagIcon, Check, Plus, Users2, Search, X } from "@/lib/bootstrap-icons";
import { MessageBubble, WaTicks } from "./MessageBubble";
import { ConversationComposer, type ModoComposer } from "./ConversationComposer";
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

/** Cinta del embudo: todas las etapas a la vista, con una píldora "líquida" que se desliza a la
 * etapa actual. Tocar una etapa mueve la conversación (como arrastrarla en el tablero). */
/** Varias fotos seguidas del mismo autor (en menos de 2 min y sin texto) se muestran juntas en
 * una cuadrícula, como los álbumes de WhatsApp. */
type ItemHilo = { k: "msg"; m: WhatsAppMensaje } | { k: "album"; ms: WhatsAppMensaje[] };
function agrupar(mensajes: WhatsAppMensaje[]): ItemHilo[] {
  const out: ItemHilo[] = [];
  const esFoto = (m: WhatsAppMensaje) => m.tipo === "imagen" && !!m.archivo_url && !m.contenido && !m.eliminado_at && !m.respuesta_a && !Object.keys(m.reacciones || {}).length;
  for (const m of mensajes) {
    const prev = out[out.length - 1];
    const ultimo = prev ? (prev.k === "album" ? prev.ms[prev.ms.length - 1] : prev.m) : null;
    const junta = ultimo && esFoto(m) && esFoto(ultimo) && ultimo.direccion === m.direccion && (ultimo.autor_jid || "") === (m.autor_jid || "")
      && new Date(m.created_at).getTime() - new Date(ultimo.created_at).getTime() < 120_000;
    if (junta && prev) {
      if (prev.k === "album") prev.ms.push(m);
      else out[out.length - 1] = { k: "album", ms: [prev.m, m] };
    } else out.push({ k: "msg", m });
  }
  return out;
}

function Album({ ms, esGrupo }: { ms: WhatsAppMensaje[]; esGrupo: boolean }) {
  const isMe = ms[0].direccion === "saliente";
  const ultimo = ms[ms.length - 1];
  const visibles = ms.slice(0, 4);
  return (
    <div className={cn("flex", isMe ? "justify-end" : "justify-start")} data-msg-id={ultimo.id}>
      <div className={cn("rounded-2xl p-1 max-w-[78%] sm:max-w-[340px]", isMe ? "wa-out rounded-br-sm" : "glass-light rounded-bl-sm shadow-sm")}>
        {esGrupo && !isMe && ms[0].autor_nombre && <div className="text-[12px] font-semibold px-2 pt-1 pb-0.5">{ms[0].autor_nombre}</div>}
        <div className="grid grid-cols-2 gap-1">
          {visibles.map((m, i) => (
            <a key={m.id} href={m.archivo_url!} target="_blank" rel="noreferrer" data-msg-id={m.id} className="relative block aspect-square overflow-hidden rounded-xl">
              <img src={m.archivo_url!} alt="Foto" loading="lazy" decoding="async" className="h-full w-full object-cover wa-img-in" />
              {i === 3 && ms.length > 4 && (
                <span className="absolute inset-0 bg-black/55 text-white text-2xl font-bold flex items-center justify-center">+{ms.length - 4}</span>
              )}
            </a>
          ))}
        </div>
        <div className={cn("flex items-center justify-end gap-1 px-1.5 pt-1 text-[10px]", isMe ? "text-white/75" : "text-neutral-400")}>
          {ms.length} fotos · {new Date(ultimo.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
          {isMe && <WaTicks estado={ultimo.estado_entrega} />}
        </div>
      </div>
    </div>
  );
}

/** Buscar dentro del chat (en todo el historial guardado, no solo lo cargado en pantalla). */
function BuscarEnChat({ conversacionId, onIr, onCerrar }: { conversacionId: string; onIr: (m: WhatsAppMensaje) => void; onCerrar: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<WhatsAppMensaje[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/whatsapp/conversaciones/${conversacionId}/buscar?q=${encodeURIComponent(q.trim())}`).catch(() => null);
      if (r?.ok) setRes((await r.json()).mensajes || []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, conversacionId]);
  const resaltar = (t: string) => {
    const i = t.toLowerCase().indexOf(q.trim().toLowerCase());
    if (i < 0) return t.slice(0, 120);
    const ini = Math.max(0, i - 30);
    return <>{ini > 0 && "…"}{t.slice(ini, i)}<mark className="bg-brand-primary/25 text-inherit rounded px-0.5">{t.slice(i, i + q.trim().length)}</mark>{t.slice(i + q.trim().length, i + 90)}</>;
  };
  return (
    <div className="relative shrink-0 px-3 py-2 border-b border-black/5 dark:border-white/10 wa-menu-in">
      <div className="flex items-center gap-2 h-9 px-3 rounded-xl glass-input">
        <Search className="h-4 w-4 text-neutral-400 shrink-0" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCerrar()} placeholder="Buscar en esta conversación…" className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
        {res && <span className="text-[11px] text-neutral-400 tabular-nums">{res.length}</span>}
        <button type="button" onClick={onCerrar} aria-label="Cerrar búsqueda" className="h-6 w-6 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-neutral-500"><X className="h-3.5 w-3.5" /></button>
      </div>
      {res && (
        <div className="absolute left-3 right-3 top-full mt-1 z-30 max-h-72 overflow-y-auto rounded-xl glass-panel py-1" data-lenis-prevent>
          {res.length === 0 && <div className="px-3 py-3 text-xs text-neutral-500">Sin resultados para “{q}”.</div>}
          {res.map((m) => (
            <button key={m.id} type="button" onClick={() => onIr(m)} className="w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5">
              <div className="text-[10px] text-neutral-400">{new Date(m.created_at).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })} · {m.direccion === "saliente" ? "Tú" : m.autor_nombre || "Contacto"}</div>
              <div className="text-xs truncate">{resaltar(m.contenido || m.archivo_nombre || "")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StageRibbon({ etapas, valor, onChange }: { etapas: WhatsAppPipelineStage[]; valor: string | null; onChange: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number } | null>(null);
  const idx = etapas.findIndex((e) => e.id === valor);
  const actual = etapas[idx];

  useLayoutEffect(() => {
    const medir = () => {
      const seg = ref.current?.querySelectorAll<HTMLButtonElement>("[data-seg]")[idx];
      setPos(seg ? { left: seg.offsetLeft, width: seg.offsetWidth } : null);
      seg?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [idx, etapas.length]);

  return (
    <div ref={ref} role="radiogroup" aria-label="Etapa del embudo" className="wa-ribbon bg-black/[0.035] dark:bg-white/[0.05] border border-black/5 dark:border-white/10">
      {pos && actual && (
        <span
          className="wa-liquid"
          style={{ left: pos.left, width: pos.width, backgroundColor: actual.color, boxShadow: `0 6px 20px -6px ${actual.color}` }}
        />
      )}
      {etapas.map((e, i) => (
        <button
          key={e.id}
          data-seg
          role="radio"
          aria-checked={i === idx}
          title={e.label}
          onClick={() => e.id !== valor && onChange(e.id)}
          className={cn(
            "wa-seg",
            i === idx ? "text-white" : i < idx ? "text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white" : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          )}
        >
          {i < idx && <span className="inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: e.color }} />}
          {e.label}
        </button>
      ))}
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
  onSend: (d: { tipo: string; contenido?: string; archivoUrl?: string; archivoNombre?: string; archivoTamanio?: number; respuestaA?: string }) => Promise<void>;
  onRetry?: (m: WhatsAppMensaje) => void;
  onCambiarEtapa: (etapaId: string) => void;
  onAsignar: (userId: string | null) => void;
  onToggleTag: (tag: WhatsAppTag) => void;
  onCrearTag: (nombre: string, color: string) => Promise<void>;
  onAbrirPerfil: () => void;
  onDescargar?: (m: WhatsAppMensaje) => Promise<void>;
  onReaccionar?: (m: WhatsAppMensaje, emoji: string) => void;
  onEliminar?: (m: WhatsAppMensaje) => void;
  onEditar?: (m: WhatsAppMensaje, contenido: string) => Promise<void>;
  onEscribiendo?: () => void;
  /** Presencia del contacto en vivo: "composing", "recording", "available"… */
  presencia?: string | null;
  /** Asegura que un mensaje (de la búsqueda) esté cargado, trayendo historial anterior si hace falta. */
  onAsegurarMensaje?: (id: string) => Promise<boolean>;
}

export function ConversationThread({
  conversacion, mensajes, etapas, tags, usuarios, conectado, hasMore = false, loadingOlder = false, onLoadOlder,
  onBack, onSend, onRetry, onCambiarEtapa, onAsignar, onToggleTag, onCrearTag, onAbrirPerfil, onDescargar,
  onReaccionar, onEliminar, onEditar, onEscribiendo, presencia, onAsegurarMensaje,
}: Props) {
  const [modo, setModo] = useState<ModoComposer>(null);
  const [buscando, setBuscando] = useState(false);

  const resaltarEl = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ background: "rgba(87,80,232,.22)" }, { background: "transparent" }], { duration: 1600, easing: "ease-out" });
  };
  const irAMensaje = async (m: WhatsAppMensaje) => {
    const buscar = () => scrollRef.current?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(m.id)}"]`);
    if (!buscar() && onAsegurarMensaje) await onAsegurarMensaje(m.id);
    setTimeout(() => resaltarEl(buscar()), 60);
  };
  const esGrupo = !!conversacion.es_grupo || conversacion.wa_jid.endsWith("@g.us");

  /** Tocar una cita lleva al mensaje original (si está cargado) y lo resalta un momento. */
  const irACita = (waId: string) => {
    resaltarEl(scrollRef.current?.querySelector<HTMLElement>(`[data-wa-id="${CSS.escape(waId)}"]`));
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
              {presencia === "composing" || presencia === "recording" ? (
                <span className="text-emerald-500 font-semibold">{presencia === "recording" ? "grabando audio…" : "escribiendo…"}</span>
              ) : esGrupo ? <><Users2 className="h-3 w-3" /> Grupo de WhatsApp</> : (
                <>{presencia === "available" && <span className="text-emerald-500 font-semibold mr-1">en línea ·</span>}{numeroConBandera(conversacion.telefono_real || conversacion.wa_jid)}</>
              )}
            </div>
          </div>
        </button>
        <button type="button" onClick={() => setBuscando((v) => !v)} title="Buscar en la conversación" aria-label="Buscar en la conversación"
          className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition", buscando ? "bg-brand-primary/12 text-brand-primary" : "text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5")}>
          <Search className="h-4 w-4" />
        </button>
        <AsignadoPicker usuarios={usuarios} valor={conversacion.asignado_a} onChange={onAsignar} />
        <TagPicker todas={tags} activas={conversacion.tags} onToggle={onToggleTag} onCrear={onCrearTag} />
      </div>
      <div className="shrink-0 px-3 pt-2 pb-1.5 border-b border-black/5 dark:border-white/10">
        <StageRibbon etapas={etapas} valor={conversacion.etapa_id} onChange={onCambiarEtapa} />
      </div>
      {buscando && <BuscarEnChat conversacionId={conversacion.id} onIr={irAMensaje} onCerrar={() => setBuscando(false)} />}

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
          agrupar(mensajes).map((it, i, items) => {
            const primero = it.k === "album" ? it.ms[0] : it.m;
            const anterior = i > 0 ? items[i - 1] : null;
            const dia = etiquetaDia(primero.created_at);
            const nuevoDia = !anterior || etiquetaDia((anterior.k === "album" ? anterior.ms[anterior.ms.length - 1] : anterior.m).created_at) !== dia;
            if (it.k === "album") {
              return (
                <div key={it.ms[0].id}>
                  {nuevoDia && (
                    <div className="flex justify-center my-3">
                      <span className="text-[11px] font-semibold capitalize px-3 py-1 rounded-full glass-light text-neutral-500 shadow-sm">{dia}</span>
                    </div>
                  )}
                  <Album ms={it.ms} esGrupo={esGrupo} />
                </div>
              );
            }
            const m = it.m;
            return (
              <div key={m.id} data-msg-id={m.id}>
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
                  onResponder={(x) => setModo({ tipo: "respuesta", m: x })}
                  onReaccionar={onReaccionar}
                  onEditar={(x) => setModo({ tipo: "edicion", m: x })}
                  onEliminar={onEliminar}
                  // Un saliente real que reemplaza a su burbuja optimista (temp-) ya se animó al
                  // enviarse: no se vuelve a animar al reconciliarse con el id del servidor.
                  animar={!idsInicialesRef.current?.has(m.id) && (m.id.startsWith("temp-") || m.direccion === "entrante")}
                />
              </div>
            );
          })
        )}
      </div>

      <ConversationComposer onSend={onSend} disabled={!conectado} modo={modo} onCancelarModo={() => setModo(null)} onEditar={onEditar} onEscribiendo={onEscribiendo} />
    </div>
  );
}
