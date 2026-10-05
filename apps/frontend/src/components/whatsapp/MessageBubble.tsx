"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Eye, AlertCircle, MapPin, User, BarChart3, Download, Ban, Pencil, Loader2 } from "@/lib/bootstrap-icons";
import { FileMessage } from "@/components/chat/FileMessage";
import { AudioMessage } from "@/components/chat/AudioMessage";
import type { WhatsAppMensaje } from "./types";

/** Igual que WhatsApp: reloj = saliendo, ✓ gris = lo recibió el servidor de WhatsApp, ✓✓ gris =
 * llegó al teléfono del contacto, ✓✓ azul = lo leyó. Los trazos se DIBUJAN al cambiar de estado
 * (stroke-dashoffset, ver .wa-tk en globals.css). */
const TK_ESTADO: Record<string, string> = { pendiente: "pending", enviado: "sent", entregado: "delivered", leido: "read" };
export function WaTicks({ estado }: { estado: WhatsAppMensaje["estado_entrega"] }) {
  const s = TK_ESTADO[estado] || "sent";
  const label = estado === "leido" ? "Leído" : estado === "entregado" ? "Entregado" : estado === "pendiente" ? "Enviando" : "Enviado";
  return (
    <span className="wa-tk" data-s={s} role="img" aria-label={label} title={label}>
      <svg className="chk" viewBox="0 0 18 12"><path className="c1" d="M1.5 6.6 4.7 9.6 11 2.6" /><path className="c2" d="M7.4 9.6 13.7 2.6" /></svg>
      <svg className="clk" viewBox="0 0 12 12" style={{ width: 11, height: 11 }}><circle cx="6" cy="6" r="4.8" strokeWidth="1.4" /><path d="M6 3.4V6l1.7 1.1" strokeWidth="1.4" /></svg>
    </span>
  );
}

const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
const fmtTam = (b: number | null | undefined) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
function json<T>(s: string | null): T | null {
  try { return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}

/** Color estable por autor en grupos (como WhatsApp, cada participante con su tono). */
function colorAutor(clave: string): string {
  let h = 11;
  for (const c of clave) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 55%)`;
}

const ETIQUETA_MEDIA: Record<string, string> = { imagen: "Foto", video: "Video", audio: "Nota de voz", archivo: "Documento", sticker: "Sticker" };

/** Media que todavía no está en el CRM (historial importado, o una descarga que falló): se baja
 * al tocarla, como en WhatsApp Web. */
function MediaPendiente({ m, isMe, onDescargar }: { m: WhatsAppMensaje; isMe: boolean; onDescargar?: (m: WhatsAppMensaje) => Promise<void> }) {
  const [bajando, setBajando] = useState(false);
  return (
    <button
      type="button"
      disabled={bajando}
      onClick={async () => { setBajando(true); try { await onDescargar?.(m); } finally { setTimeout(() => setBajando(false), 15000); } }}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 my-0.5 min-w-[200px] text-left transition",
        isMe ? "bg-white/15 hover:bg-white/25" : "bg-black/5 dark:bg-white/[0.06] hover:bg-black/10 dark:hover:bg-white/10"
      )}
    >
      <span className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", isMe ? "bg-white/20" : "bg-brand-primary/15 text-brand-primary")}>
        {bajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold truncate">{m.archivo_nombre || ETIQUETA_MEDIA[m.tipo] || "Archivo"}</span>
        <span className={cn("block text-[11px]", isMe ? "text-white/70" : "text-neutral-500")}>
          {bajando ? "Descargando…" : `Toca para descargar${m.archivo_tamanio ? ` · ${fmtTam(m.archivo_tamanio)}` : ""}`}
        </span>
      </span>
    </button>
  );
}

function Cuerpo({ m, isMe, onDescargar }: { m: WhatsAppMensaje; isMe: boolean; onDescargar?: (m: WhatsAppMensaje) => Promise<void> }) {
  const sub = isMe ? "text-white/75" : "text-neutral-500";
  if (m.media_pendiente && !m.archivo_url) {
    return (
      <>
        <MediaPendiente m={m} isMe={isMe} onDescargar={onDescargar} />
        {m.contenido && m.tipo !== "archivo" && <div className="text-sm whitespace-pre-wrap break-words mt-1">{m.contenido}</div>}
      </>
    );
  }
  switch (m.tipo) {
    case "texto":
    case "sistema":
      return <div className={cn("text-sm whitespace-pre-wrap break-words", m.tipo === "sistema" && "italic opacity-80")}>{m.contenido}</div>;
    case "imagen":
      return (
        <>
          {m.archivo_url && (
            <a href={m.archivo_url} target="_blank" rel="noreferrer">
              <img src={m.archivo_url} alt={m.contenido || "Foto"} loading="lazy" decoding="async" className="rounded-lg max-w-[260px] max-h-[320px] object-cover wa-img-in" />
            </a>
          )}
          {m.contenido && <div className="text-sm whitespace-pre-wrap break-words mt-1">{m.contenido}</div>}
        </>
      );
    case "sticker":
      return m.archivo_url ? <img src={m.archivo_url} alt="Sticker" loading="lazy" decoding="async" className="h-36 w-36 object-contain wa-img-in" /> : <div className={cn("text-sm", sub)}>Sticker</div>;
    case "video":
      return (
        <>
          {m.archivo_url && <video src={m.archivo_url} controls preload="metadata" className="rounded-lg max-w-[260px] max-h-[320px]" />}
          {m.contenido && <div className="text-sm whitespace-pre-wrap break-words mt-1">{m.contenido}</div>}
        </>
      );
    case "audio":
      return m.archivo_url ? <AudioMessage url={m.archivo_url} filename={m.archivo_nombre} mime={m.archivo_tipo} isMe={isMe} /> : null;
    case "archivo":
      return (
        <>
          {m.archivo_url && <FileMessage url={m.archivo_url} filename={m.archivo_nombre} mime={m.archivo_tipo} size={m.archivo_tamanio} isMe={isMe} onVer={() => window.open(m.archivo_url!, "_blank")} />}
          {m.contenido && <div className="text-sm whitespace-pre-wrap break-words mt-1">{m.contenido}</div>}
        </>
      );
    case "ubicacion": {
      const u = json<{ lat: number; lng: number; nombre?: string; direccion?: string; url?: string; vivo?: boolean }>(m.contenido);
      if (!u) return null;
      return (
        <a href={u.url || `https://maps.google.com/?q=${u.lat},${u.lng}`} target="_blank" rel="noreferrer" className="block min-w-[220px] group">
          <span className={cn("flex h-24 items-center justify-center rounded-lg mb-1.5 relative overflow-hidden", isMe ? "bg-white/15" : "bg-brand-primary/10")}>
            <span className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "18px 18px", color: isMe ? "rgba(255,255,255,.25)" : "rgba(87,80,232,.18)" }} />
            <MapPin className={cn("h-8 w-8 relative transition-transform group-hover:-translate-y-0.5", isMe ? "text-white" : "text-brand-primary")} />
          </span>
          <span className="block text-sm font-semibold">{u.vivo ? "Ubicación en tiempo real" : u.nombre || "Ubicación"}</span>
          {u.direccion && <span className={cn("block text-xs", sub)}>{u.direccion}</span>}
          <span className={cn("block text-[11px] underline-offset-2 group-hover:underline", sub)}>Abrir en el mapa</span>
        </a>
      );
    }
    case "contacto": {
      const lista = json<{ nombre: string; telefonos: string[] }[]>(m.contenido) || [];
      return (
        <div className="flex flex-col gap-1.5 min-w-[200px]">
          {lista.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", isMe ? "bg-white/20" : "bg-brand-primary/15 text-brand-primary")}><User className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{c.nombre}</span>
                <span className={cn("block text-xs font-mono select-all", sub)}>{c.telefonos.join(" · ") || "Sin teléfono"}</span>
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "encuesta": {
      const e = json<{ pregunta: string; opciones: string[] }>(m.contenido);
      if (!e) return null;
      return (
        <div className="min-w-[220px]">
          <div className="flex items-center gap-1.5 text-sm font-semibold mb-1.5"><BarChart3 className="h-4 w-4" />{e.pregunta}</div>
          <div className="flex flex-col gap-1">
            {e.opciones.map((o, i) => (
              <span key={i} className={cn("text-xs rounded-lg px-2.5 py-1.5 border", isMe ? "border-white/25" : "border-black/10 dark:border-white/10")}>{o}</span>
            ))}
          </div>
          <div className={cn("text-[11px] mt-1.5", sub)}>Encuesta · los votos se ven en el teléfono</div>
        </div>
      );
    }
    default:
      return m.contenido ? <div className="text-sm whitespace-pre-wrap break-words">{m.contenido}</div> : null;
  }
}

interface Props {
  m: WhatsAppMensaje;
  esGrupo?: boolean;
  animar?: boolean;
  onRetry?: (m: WhatsAppMensaje) => void;
  onDescargar?: (m: WhatsAppMensaje) => Promise<void>;
  onIrACita?: (waMessageId: string) => void;
}

export function MessageBubble({ m, esGrupo, animar, onRetry, onDescargar, onIrACita }: Props) {
  const isMe = m.direccion === "saliente";
  const fallido = m.estado_entrega === "fallido";
  const eliminado = !!m.eliminado_at;
  const sticker = m.tipo === "sticker" && !!m.archivo_url;
  const reacciones = Object.values(m.reacciones || {});
  const conteo = reacciones.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e]: (acc[e] || 0) + 1 }), {});
  const autorClave = m.autor_jid || m.autor_nombre || "";

  return (
    <div className={cn("flex", isMe ? "justify-end" : "justify-start", animar && (isMe ? "wa-fly" : "wa-bubble-in"), reacciones.length > 0 && "mb-3")} data-wa-id={m.wa_message_id || undefined}>
      <div
        className={cn(
          "relative max-w-[78%] sm:max-w-[65%] rounded-2xl px-3.5 py-2",
          sticker
            ? "bg-transparent px-0 py-0"
            : isMe
              ? fallido
                ? "bg-red-50 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 rounded-br-sm shadow-sm"
                : cn("wa-out rounded-br-sm", animar && "wa-glint")
              : "glass-light rounded-bl-sm shadow-sm",
          eliminado && "opacity-75"
        )}
      >
        {esGrupo && !isMe && m.autor_nombre && (
          <div className="text-[12px] font-semibold mb-0.5 truncate" style={{ color: colorAutor(autorClave) }}>{m.autor_nombre}</div>
        )}
        {m.respuesta_a && (
          <button
            type="button"
            onClick={() => onIrACita?.(m.respuesta_a!)}
            className={cn("block w-full text-left rounded-lg border-l-[3px] px-2.5 py-1.5 mb-1.5 text-xs", isMe ? "bg-white/15 border-white/70" : "bg-black/5 dark:bg-white/[0.06] border-brand-primary")}
          >
            <span className={cn("line-clamp-2", isMe ? "text-white/85" : "text-neutral-600 dark:text-neutral-300")}>{m.respuesta_preview || "Mensaje"}</span>
          </button>
        )}
        {eliminado && (
          <div className={cn("flex items-center gap-1.5 text-xs italic mb-1", isMe ? "text-white/80" : "text-neutral-500")}>
            <Ban className="h-3.5 w-3.5" /> {isMe ? "Eliminaste este mensaje" : "El contacto eliminó este mensaje"}
          </div>
        )}
        <div className={cn(eliminado && "line-through decoration-1")}>
          <Cuerpo m={m} isMe={isMe} onDescargar={onDescargar} />
        </div>
        <div className={cn("flex items-center gap-1 justify-end mt-1 text-[10px]", sticker ? "text-neutral-400" : isMe ? (fallido ? "text-red-600 dark:text-red-400" : "text-white/70") : "text-neutral-400")}>
          {m.editado_at && !eliminado && <span className="inline-flex items-center gap-0.5 italic"><Pencil className="h-2.5 w-2.5" />editado</span>}
          {!fallido && fmtHora(m.created_at)}
          {isMe && !fallido && <WaTicks estado={m.estado_entrega} />}
          {isMe && fallido && (
            <button type="button" onClick={() => onRetry?.(m)} title="No se pudo enviar — reintentar" className="inline-flex items-center gap-1 font-ui font-bold uppercase tracking-wider hover:underline">
              <AlertCircle className="h-3 w-3" /> No enviado · Reintentar
            </button>
          )}
          {/* "Visto por el equipo": distinto del check de envío; marca que alguien del equipo ya
              vio, dentro del CRM, lo que el contacto escribió. */}
          {!isMe && m.visto_at && (
            <span title="Visto por el equipo" className="inline-flex"><Eye className="h-3 w-3 text-neutral-400" /></span>
          )}
        </div>
        {reacciones.length > 0 && (
          <div
            className={cn("absolute -bottom-3.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs bg-white dark:bg-neutral-800 border border-black/5 dark:border-white/10 shadow-sm wa-bubble-in", isMe ? "right-2" : "left-2")}
            title={`${reacciones.length} reacción${reacciones.length === 1 ? "" : "es"}`}
          >
            {Object.entries(conteo).map(([e, n]) => <span key={e}>{e}{n > 1 && <span className="text-[10px] text-neutral-500 ml-0.5">{n}</span>}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
