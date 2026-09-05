"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search, User as UserIcon, X } from "@/lib/bootstrap-icons";

import { cn } from "@/lib/utils";
import type { ContactoLite } from "@/lib/tareas-contacto";

// ==============================================================================================
// EL CLIENTE DE UNA TAREA — enseñarlo, y dejar elegirlo cuando procede
//
// 🔴 POR QUÉ UN BUSCADOR Y NO UN `<select>`. El desplegable de oportunidades de al lado carga la
// lista entera de una vez. Con contactos eso son ~3.810 activos (de 31.404 filas): un desplegable
// de casi cuatro mil líneas no se puede usar, y traerlos todos para elegir uno tampoco.
//
// Se pide a `GET /api/contactos?q=…`, que es **el mismo filtro que la persona ve en el listado de
// contactos** — no un buscador paralelo que acabe encontrando cosas distintas.
//
// Este componente NO decide si el campo se puede editar ni de quién es la tarea: eso lo resuelve
// `lib/tareas-contacto.ts`, que es lo único de esto que se puede probar sin navegador (§9.1).
// Aquí solo se dibuja lo que aquella decisión diga.
// ==============================================================================================

interface Props {
  /** Lo que ha decidido `resolverVinculo`. */
  contactoId: string | null;
  contactoNombre: string | null;
  editable: boolean;
  /** Por qué no se puede editar. Vacío cuando sí. */
  explicacion: string;
  onElegir: (c: ContactoLite | null) => void;
  /** En una tarea que no se puede tocar (no eres nadie en ella), nada de esto se edita. */
  readOnly?: boolean;
}

interface Resultado { id: string; nombre_completo: string | null; email: string | null; telefono: string | null; }

export function ContactoDeTarea({ contactoId, contactoNombre, editable, explicacion, onElegir, readOnly }: Props) {
  const [buscando, setBuscando] = useState(false);
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const cajaRef = useRef<HTMLDivElement>(null);

  // Cerrar al pulsar fuera. La capa NO existe mientras el buscador está cerrado (§4.9-ter): una
  // capa invisible que sigue recibiendo el ratón se traga los clics de media pantalla.
  useEffect(() => {
    if (!buscando) return;
    const fuera = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setBuscando(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [buscando]);

  // Se espera a que deje de teclear: sin esto son cinco consultas para escribir "Ana".
  useEffect(() => {
    if (!buscando) return;
    const q = termino.trim();
    if (q.length < 2) { setResultados([]); return; }
    let ignorar = false;
    setCargando(true);
    const t = setTimeout(() => {
      fetch(`/api/contactos?q=${encodeURIComponent(q)}&pageSize=50`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!ignorar) setResultados(d?.contactos || []); })
        .catch(() => { if (!ignorar) setResultados([]); })
        .finally(() => { if (!ignorar) setCargando(false); });
    }, 300);
    return () => { ignorar = true; clearTimeout(t); };
  }, [termino, buscando]);

  const elegir = (r: Resultado) => {
    onElegir({ id: r.id, nombre: r.nombre_completo || "(contacto sin nombre)" });
    setBuscando(false);
    setTermino("");
  };

  // ── Ya hay cliente, o no se puede tocar ──────────────────────────────────────────────────
  if (!buscando) {
    return (
      <div>
        <div
          className={cn(
            "w-full min-h-12 px-4 py-2.5 rounded-2xl border text-sm flex items-center gap-2",
            contactoId ? "bg-white border-neutral-200" : "bg-neutral-50 border-neutral-200 text-neutral-400"
          )}
        >
          <UserIcon className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.8} />
          <span className="flex-1 truncate">
            {/* 🔴 Nunca el uuid: si no hay nombre se dice que no lo hay (§4.7). */}
            {contactoId ? (contactoNombre || "(contacto sin nombre)") : "(sin cliente)"}
          </span>
          {editable && !readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              {contactoId && (
                <button
                  type="button"
                  onClick={() => onElegir(null)}
                  title="Quitar el cliente"
                  className="h-8 w-8 rounded-xl hover:bg-neutral-100 text-neutral-400 hover:text-brand-red flex items-center justify-center transition-colors"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setBuscando(true)}
                className="h-8 px-3 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition-colors"
              >
                {contactoId ? "Cambiar" : "Buscar"}
              </button>
            </div>
          )}
        </div>
        {/* Solo se habla cuando el campo está bloqueado. Explicar lo que no pasa es ruido. */}
        {!editable && explicacion && (
          <p className="mt-1.5 text-[11px] text-neutral-500">{explicacion}</p>
        )}
      </div>
    );
  }

  // ── Buscando ─────────────────────────────────────────────────────────────────────────────
  return (
    <div ref={cajaRef} className="relative">
      <div className="w-full h-12 px-4 rounded-2xl bg-white border border-brand-orange ring-4 ring-brand-orange/15 text-sm flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.8} />
        <input
          autoFocus
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setBuscando(false); setTermino(""); } }}
          placeholder="Nombre, email o teléfono del cliente…"
          className="flex-1 bg-transparent outline-none"
        />
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-neutral-400 shrink-0" />}
      </div>

      <div className="absolute z-20 mt-1.5 w-full max-h-64 overflow-y-auto rounded-2xl bg-white border border-neutral-200 shadow-xl">
        {termino.trim().length < 2 ? (
          <p className="px-4 py-3 text-[12px] text-neutral-400">Escribe al menos dos letras.</p>
        ) : cargando ? (
          <p className="px-4 py-3 text-[12px] text-neutral-400">Buscando…</p>
        ) : resultados.length === 0 ? (
          // Que el sistema diga «lo he mirado y no hay» vale más que el silencio, que no distingue
          // «no hay nada» de «no lo he mirado».
          <p className="px-4 py-3 text-[12px] text-neutral-500">Ningún cliente coincide con eso.</p>
        ) : (
          resultados.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => elegir(r)}
              className="w-full px-4 py-2.5 text-left hover:bg-neutral-50 border-b border-neutral-100 last:border-0"
            >
              <div className="text-sm font-semibold truncate">{r.nombre_completo || "(contacto sin nombre)"}</div>
              <div className="text-[11px] text-neutral-500 truncate">{r.email || r.telefono || "sin email ni teléfono"}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
