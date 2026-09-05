"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Loader2, CornerDownLeft } from "@/lib/bootstrap-icons";

interface Hit {
  id: string;
  from_addr: string;
  from_name: string | null;
  subject: string | null;
  fecha_email: string;
  leido: boolean;
  direccion: string;
  snippet?: string | null;
}

interface Props {
  buzonId: string | null;
  folder: string;
  onOpenEmail: (id: string) => void;
}

// Búsqueda instantánea estilo paleta (Cmd+K): al escribir/abrir despliega un
// modal centrado con fondo oscurecido (portal a <body>) para que NO choque con
// la lista de fondo. Busca asunto + remitente, rápido y liviano.
export function EmailQuickSearch({ buzonId, folder, onOpenEmail }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const modalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Atajo "/" para abrir; Escape para cerrar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      if (e.key === "/" && !open && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Enfocar el input del modal al abrir.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => modalInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Búsqueda con debounce + cancelación de la petición anterior.
  useEffect(() => {
    const term = q.trim();
    if (!buzonId || term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ folder, q: term, limit: "20" });
        const r = await fetch(`/api/buzones/${buzonId}/search?${params.toString()}`, { signal: ctrl.signal });
        const d = await r.json();
        setHits(d.emails || []);
        setActive(0);
      } catch {
        /* abortada o error de red: ignorar */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, buzonId, folder]);

  const close = () => setOpen(false);
  const pick = (h: Hit) => { onOpenEmail(h.id); setOpen(false); setQ(""); };

  const onModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); pick(hits[active]); }
  };

  const fmtFecha = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" });
    } catch {
      return "";
    }
  };

  const term = q.trim();

  return (
    <>
      {/* Disparador en la barra (abre el modal al hacer click o al escribir) */}
      <div className="relative flex items-center">
        <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 pointer-events-none" />
        <input
          value={q}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          placeholder="Buscar o presiona /"
          className="h-8 pl-8 pr-3 w-56 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs outline-none focus:ring-2 focus:ring-brand-orange/30 focus:w-64 transition-all"
        />
      </div>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[200]">
          {/* Fondo oscurecido — tapa la interfaz de atrás */}
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onMouseDown={close} />

          {/* Modal centrado */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[10vh] w-[42rem] max-w-[94vw] max-h-[74vh] flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
            {/* Input del modal */}
            <div className="relative flex items-center border-b border-black/5 dark:border-white/10 shrink-0">
              <Search className="h-4 w-4 text-neutral-400 absolute left-4 pointer-events-none" />
              <input
                ref={modalInputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onModalKeyDown}
                placeholder="Buscar correos por asunto o remitente…"
                className="w-full h-14 pl-11 pr-11 bg-transparent text-sm outline-none"
              />
              <button
                onClick={close}
                className="absolute right-3 h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 transition"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Resultados */}
            <div className="overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-2 px-4 py-4 text-xs text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
                </div>
              )}

              {!loading && term.length < 2 && (
                <div className="px-4 py-10 text-center text-xs text-neutral-400">
                  Escribe al menos 2 letras para buscar…
                </div>
              )}

              {!loading && term.length >= 2 && hits.length === 0 && (
                <div className="px-4 py-10 text-center text-xs text-neutral-400">
                  Sin coincidencias para “{term}”
                </div>
              )}

              {!loading && hits.length > 0 && (
                <>
                  <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                    {hits.length} resultado{hits.length > 1 ? "s" : ""}
                  </div>
                  {hits.map((h, i) => (
                    <button
                      key={h.id}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(h)}
                      className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition ${
                        i === active ? "bg-brand-orange/10" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {!h.leido && <span className="h-1.5 w-1.5 rounded-full bg-brand-red shrink-0" />}
                        <span className={`text-xs truncate ${!h.leido ? "font-bold" : "font-medium"} text-neutral-800 dark:text-neutral-100`}>
                          {h.from_name || h.from_addr}
                        </span>
                        <span className="ml-auto text-[10px] text-neutral-400 shrink-0">{fmtFecha(h.fecha_email)}</span>
                      </div>
                      <span className="text-xs text-neutral-600 dark:text-neutral-300 truncate">
                        {h.subject || "(sin asunto)"}
                      </span>
                      {h.snippet && <span className="text-[11px] text-neutral-400 truncate">{h.snippet}</span>}
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* Pie con atajos */}
            <div className="px-4 py-2 border-t border-black/5 dark:border-white/10 text-[10px] text-neutral-400 flex items-center gap-1.5 shrink-0">
              <CornerDownLeft className="h-3 w-3" /> Enter para abrir · ↑↓ para navegar · Esc para cerrar
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
