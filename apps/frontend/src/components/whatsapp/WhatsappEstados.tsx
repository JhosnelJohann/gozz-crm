"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { Plus, X, ChevronLeft, ChevronRight, Image as ImageIcon, Pencil, Send, Loader2, CircleDashed } from "@/lib/bootstrap-icons";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";

interface Estado {
  id: string;
  autor_jid: string | null;
  autor_nombre: string | null;
  propio: boolean;
  tipo: "texto" | "imagen" | "video";
  contenido: string | null;
  fondo: string | null;
  archivo_url: string | null;
  visto_at: string | null;
  created_at: string;
}

interface Grupo { clave: string; nombre: string; propio: boolean; estados: Estado[]; pendientes: number; ultimo: string }

const FONDOS = ["#5750E8", "#9A3DF5", "#FF4D7E", "#FF8A3D", "#43A847", "#2196C9", "#1F2433"];
const DURACION_MS = 5500;

const hace = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Ahora";
  if (min < 60) return `Hace ${min} min`;
  return `Hace ${Math.floor(min / 60)} h`;
};
const nombreAutor = (e: Estado) => e.propio ? "Mi estado" : e.autor_nombre || (e.autor_jid ? formatearNumeroWhatsApp(e.autor_jid).texto : "Contacto");

/** Anillo de historias: segmentado por cantidad de estados; color si hay sin ver, gris si ya se vio todo. */
function Anillo({ total, pendientes, children }: { total: number; pendientes: number; children: React.ReactNode }) {
  const seg = 360 / Math.max(1, total);
  const gap = total > 1 ? 4 : 0;
  const partes = Array.from({ length: total }, (_, i) => {
    const visto = i < total - pendientes;
    const color = visto ? "rgba(140,140,160,.45)" : "#9A3DF5";
    return `${color} ${i * seg + gap / 2}deg ${(i + 1) * seg - gap / 2}deg, transparent ${(i + 1) * seg - gap / 2}deg ${(i + 1) * seg + gap / 2}deg`;
  });
  return (
    <span className="relative block rounded-full p-[3px] shrink-0" style={{ background: `conic-gradient(${partes.join(",")})` }}>
      <span className="block rounded-full ring-2 ring-white dark:ring-[#0B0F16]">{children}</span>
    </span>
  );
}

function PublicarModal({ conexionId, onClose }: { conexionId: string; onClose: () => void }) {
  const [modo, setModo] = useState<"texto" | "imagen">("texto");
  const [texto, setTexto] = useState("");
  const [fondo, setFondo] = useState(FONDOS[0]);
  const [archivo, setArchivo] = useState<{ url: string; local: string; tipo: "imagen" | "video" } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const subir = async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/whatsapp/upload", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(d.error || "No se pudo subir el archivo"); return; }
    setArchivo({ url: d.url, local: URL.createObjectURL(f), tipo: f.type.startsWith("video/") ? "video" : "imagen" });
  };

  const publicar = async () => {
    setEnviando(true);
    try {
      const body = modo === "texto" ? { tipo: "texto", contenido: texto.trim(), fondo } : { tipo: archivo?.tipo || "imagen", archivoUrl: archivo?.url, contenido: texto.trim() || null };
      const r = await fetch(`/api/whatsapp/conexiones/${conexionId}/estados`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "No se pudo publicar");
      toast.success("Publicando tu estado…", { description: "Aparecerá en unos segundos para tus contactos." });
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo publicar");
    } finally {
      setEnviando(false);
    }
  };

  const listo = modo === "texto" ? !!texto.trim() : !!archivo;
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 wa-menu-in" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl glass-panel overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-4 border-b border-black/5 dark:border-white/10">
          <h2 className="font-bold flex-1">Nuevo estado</h2>
          <div className="flex rounded-xl bg-black/5 dark:bg-white/10 p-0.5">
            {(["texto", "imagen"] as const).map((m) => (
              <button key={m} onClick={() => setModo(m)} className={cn("h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition", modo === m ? "bg-white dark:bg-white/15 shadow-sm" : "text-neutral-500")}>
                {m === "texto" ? <Pencil className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}{m === "texto" ? "Texto" : "Foto o video"}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        {modo === "texto" ? (
          <div className="p-4 space-y-3">
            <div className="aspect-[9/12] max-h-[46vh] w-full rounded-2xl flex items-center justify-center p-6 transition-colors" style={{ backgroundColor: fondo }}>
              <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 700))} placeholder="Escribe un estado" className="w-full bg-transparent text-white text-center text-xl font-semibold placeholder:text-white/60 outline-none resize-none" rows={5} />
            </div>
            <div className="flex items-center gap-2">
              {FONDOS.map((c) => (
                <button key={c} onClick={() => setFondo(c)} aria-label={`Fondo ${c}`} className={cn("h-7 w-7 rounded-full transition-transform", fondo === c && "ring-2 ring-offset-2 ring-brand-primary ring-offset-white dark:ring-offset-[#11131c] scale-110")} style={{ backgroundColor: c }} />
              ))}
              <span className="ml-auto text-[11px] text-neutral-400 tabular-nums">{texto.length}/700</span>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
            {archivo ? (
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/12] max-h-[46vh] flex items-center justify-center">
                {archivo.tipo === "video" ? <video src={archivo.local} controls className="max-h-full" /> : <img src={archivo.local} alt="" className="max-h-full object-contain" />}
                <button onClick={() => setArchivo(null)} className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Quitar"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="w-full aspect-[9/12] max-h-[46vh] rounded-2xl border-2 border-dashed border-black/10 dark:border-white/15 flex flex-col items-center justify-center gap-2 text-neutral-500 hover:border-brand-primary hover:text-brand-primary transition">
                <ImageIcon className="h-8 w-8" /><span className="text-sm font-semibold">Elige una foto o un video</span>
              </button>
            )}
            <input value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 700))} placeholder="Añade un texto (opcional)" className="w-full h-10 px-3 rounded-xl glass-input text-sm outline-none" />
          </div>
        )}
        <div className="px-4 pb-4 flex items-center gap-2">
          <p className="text-[11px] text-neutral-500 flex-1">Lo verán tus contactos de WhatsApp durante 24 horas.</p>
          <button disabled={!listo || enviando} onClick={publicar} className="wa-act flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none" aria-label="Publicar estado">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Visor tipo historias: barras de progreso, avance automático, tocar a la izquierda/derecha. */
function Visor({ grupo, inicio, onCerrar, onSiguienteGrupo, onAnteriorGrupo, onVisto }: {
  grupo: Grupo; inicio: number; onCerrar: () => void; onSiguienteGrupo: () => void; onAnteriorGrupo: () => void; onVisto: (e: Estado) => void;
}) {
  const [i, setI] = useState(inicio);
  const [prog, setProg] = useState(0);
  const [pausa, setPausa] = useState(false);
  const e = grupo.estados[i];
  const durRef = useRef(DURACION_MS);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { setI(inicio); }, [grupo.clave, inicio]);
  useEffect(() => { setProg(0); durRef.current = DURACION_MS; if (e) onVisto(e); }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const siguiente = useCallback(() => {
    if (i < grupo.estados.length - 1) setI(i + 1); else onSiguienteGrupo();
  }, [i, grupo.estados.length, onSiguienteGrupo]);
  const anterior = () => { if (i > 0) setI(i - 1); else onAnteriorGrupo(); };

  useEffect(() => {
    if (pausa || !e) return;
    let raf = 0; let t0 = performance.now() - prog * durRef.current;
    const paso = (now: number) => {
      const p = Math.min(1, (now - t0) / durRef.current);
      setProg(p);
      if (p >= 1) siguiente(); else raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [pausa, e?.id, siguiente]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === "ArrowRight") siguiente(); if (ev.key === "ArrowLeft") anterior(); if (ev.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  if (!e) return null;
  return (
    <div className="relative h-full w-full flex items-center justify-center bg-black/90 select-none wa-thread-in"
      onPointerDown={() => setPausa(true)} onPointerUp={() => setPausa(false)} onPointerLeave={() => setPausa(false)}>
      <div className="relative h-full max-h-[760px] w-full max-w-[430px] flex flex-col">
        <div className="absolute inset-x-0 top-0 z-10 p-3 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex gap-1 mb-3">
            {grupo.estados.map((x, n) => (
              <span key={x.id} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
                <span className="block h-full bg-white" style={{ width: `${n < i ? 100 : n === i ? prog * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2.5 text-white">
            <WhatsAppAvatar nombre={grupo.nombre} size={34} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{grupo.nombre}</div>
              <div className="text-[11px] text-white/70">{hace(e.created_at)}</div>
            </div>
            <button onClick={onCerrar} aria-label="Cerrar" className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center overflow-hidden rounded-2xl" style={e.tipo === "texto" ? { backgroundColor: e.fondo || "#5750E8" } : undefined}>
          {e.tipo === "texto" && <p className="px-8 text-center text-white text-2xl font-semibold leading-snug whitespace-pre-wrap break-words">{e.contenido}</p>}
          {e.tipo === "imagen" && (e.archivo_url ? <img src={e.archivo_url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-white/70 text-sm">La foto ya no está disponible</span>)}
          {e.tipo === "video" && (e.archivo_url
            ? <video ref={videoRef} src={e.archivo_url} autoPlay playsInline className="max-h-full max-w-full" onLoadedMetadata={(v) => { durRef.current = Math.max(DURACION_MS, (v.currentTarget.duration || 0) * 1000); }} />
            : <span className="text-white/70 text-sm">El video ya no está disponible</span>)}
        </div>
        {e.tipo !== "texto" && e.contenido && (
          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-white text-center text-sm">{e.contenido}</div>
        )}
        <button aria-label="Anterior" onClick={anterior} className="absolute left-0 top-16 bottom-0 w-1/3" />
        <button aria-label="Siguiente" onClick={siguiente} className="absolute right-0 top-16 bottom-0 w-2/3" />
      </div>
      <button onClick={anterior} aria-label="Estado anterior" className="hidden md:flex absolute left-6 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center"><ChevronLeft className="h-5 w-5" /></button>
      <button onClick={siguiente} aria-label="Estado siguiente" className="hidden md:flex absolute right-6 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center"><ChevronRight className="h-5 w-5" /></button>
    </div>
  );
}

export function WhatsappEstados({ conexionId }: { conexionId: string | null }) {
  const [estados, setEstados] = useState<Estado[] | null>(null);
  const [abierto, setAbierto] = useState<{ clave: string; inicio: number } | null>(null);
  const [publicando, setPublicando] = useState(false);

  const cargar = useCallback(async () => {
    if (!conexionId) { setEstados([]); return; }
    const r = await fetch(`/api/whatsapp/conexiones/${conexionId}/estados`).catch(() => null);
    if (r?.ok) setEstados((await r.json()).estados || []);
  }, [conexionId]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const s = getSocket();
    const on = (ev: any) => { if (ev.conexion_id === conexionId) cargar(); };
    s.on("whatsapp:estado-nuevo", on);
    return () => { s.off("whatsapp:estado-nuevo", on); };
  }, [conexionId, cargar]);

  const grupos = useMemo<Grupo[]>(() => {
    const m = new Map<string, Grupo>();
    for (const e of estados || []) {
      const clave = e.propio ? "__yo" : e.autor_jid || e.id;
      const g = m.get(clave) || { clave, nombre: nombreAutor(e), propio: e.propio, estados: [], pendientes: 0, ultimo: e.created_at };
      g.estados.push(e);
      if (!e.visto_at && !e.propio) g.pendientes++;
      if (e.created_at > g.ultimo) g.ultimo = e.created_at;
      m.set(clave, g);
    }
    for (const g of m.values()) g.estados.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return [...m.values()].sort((a, b) => b.ultimo.localeCompare(a.ultimo));
  }, [estados]);

  const mio = grupos.find((g) => g.propio);
  const recientes = grupos.filter((g) => !g.propio && g.pendientes > 0);
  const vistos = grupos.filter((g) => !g.propio && g.pendientes === 0);
  const orden = [...(mio ? [mio] : []), ...recientes, ...vistos];
  const grupoAbierto = abierto ? orden.find((g) => g.clave === abierto.clave) : null;

  const abrir = (g: Grupo) => {
    const primeroSinVer = g.estados.findIndex((e) => !e.visto_at);
    setAbierto({ clave: g.clave, inicio: primeroSinVer >= 0 ? primeroSinVer : 0 });
  };
  const mover = (delta: number) => {
    if (!grupoAbierto) return;
    const idx = orden.findIndex((g) => g.clave === grupoAbierto.clave) + delta;
    if (idx < 0 || idx >= orden.length) { setAbierto(null); return; }
    abrir(orden[idx]);
  };
  const marcarVisto = (e: Estado) => {
    if (e.visto_at || e.propio) return;
    setEstados((cur) => cur ? cur.map((x) => (x.id === e.id ? { ...x, visto_at: new Date().toISOString() } : x)) : cur);
    fetch(`/api/whatsapp/estados/${e.id}/visto`, { method: "POST" }).catch(() => {});
  };

  const Fila = ({ g }: { g: Grupo }) => (
    <button onClick={() => abrir(g)} className="wa-row w-full flex items-center gap-3 px-4 py-2.5 text-left relative hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
      <Anillo total={g.estados.length} pendientes={g.pendientes}><WhatsAppAvatar nombre={g.nombre} size={44} /></Anillo>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold truncate">{g.nombre}</div>
        <div className="text-[11.5px] text-neutral-500">{hace(g.ultimo)} · {g.estados.length} {g.estados.length === 1 ? "estado" : "estados"}</div>
      </div>
    </button>
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className={cn("w-full lg:w-[380px] shrink-0 border-r border-black/5 dark:border-white/10 flex flex-col min-h-0", grupoAbierto ? "hidden lg:flex" : "flex")}>
        <div className="flex-1 overflow-y-auto py-2" data-lenis-prevent>
          <button onClick={() => (mio ? abrir(mio) : setPublicando(true))} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
            <span className="relative">
              {mio ? <Anillo total={mio.estados.length} pendientes={0}><WhatsAppAvatar nombre="Mi estado" size={44} /></Anillo> : <WhatsAppAvatar nombre="Mi estado" size={50} />}
              <span role="button" tabIndex={0} aria-label="Nuevo estado" onClick={(ev) => { ev.stopPropagation(); setPublicando(true); }}
                className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-brand-primary text-white flex items-center justify-center ring-2 ring-white dark:ring-[#0B0F16]">
                <Plus className="h-3 w-3" />
              </span>
            </span>
            <div>
              <div className="text-[13.5px] font-semibold">Mi estado</div>
              <div className="text-[11.5px] text-neutral-500">{mio ? `${hace(mio.ultimo)} · toca para verlo` : "Toca + para publicar"}</div>
            </div>
          </button>
          {estados === null && <div className="px-4 py-6 text-xs text-neutral-400">Cargando estados…</div>}
          {recientes.length > 0 && <div className="px-4 pt-3 pb-1 text-[10.5px] font-ui font-bold uppercase tracking-wider text-brand-primary">Recientes</div>}
          {recientes.map((g) => <Fila key={g.clave} g={g} />)}
          {vistos.length > 0 && <div className="px-4 pt-3 pb-1 text-[10.5px] font-ui font-bold uppercase tracking-wider text-neutral-400">Vistos</div>}
          {vistos.map((g) => <Fila key={g.clave} g={g} />)}
          {estados !== null && !recientes.length && !vistos.length && (
            <div className="px-6 py-10 text-center text-xs text-neutral-500">Cuando tus contactos publiquen estados, aparecerán aquí durante 24 horas.</div>
          )}
        </div>
      </div>
      <div className={cn("flex-1 min-w-0", grupoAbierto ? "flex" : "hidden lg:flex")}>
        {grupoAbierto ? (
          <Visor grupo={grupoAbierto} inicio={abierto!.inicio} onCerrar={() => setAbierto(null)} onSiguienteGrupo={() => mover(1)} onAnteriorGrupo={() => mover(-1)} onVisto={marcarVisto} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="h-16 w-16 rounded-2xl glass-panel text-brand-primary flex items-center justify-center"><CircleDashed className="h-7 w-7" /></div>
            <p className="text-sm font-bold">Estados de WhatsApp</p>
            <p className="text-xs text-neutral-500 max-w-[260px]">Mira lo que publican tus contactos y publica los tuyos: promociones, novedades o testimonios.</p>
            <button onClick={() => setPublicando(true)} className="mt-1 h-10 px-4 rounded-xl wa-out text-sm font-semibold flex items-center gap-2"><Plus className="h-4 w-4" /> Publicar un estado</button>
          </div>
        )}
      </div>
      {publicando && conexionId && <PublicarModal conexionId={conexionId} onClose={() => setPublicando(false)} />}
    </div>
  );
}
