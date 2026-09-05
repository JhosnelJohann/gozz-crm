"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Share2, Trash2, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

// ============================================================================================
// COMPARTIR UNA CARPETA O UN ARCHIVO — T5 (reunión del 2026-08-24)
//
// «Y ahí yo puedo darle clic a compartir con Briset o con Sara y darle los permisos: si quiero
// que edite, que solamente lo vea.»
//
// 🔴 LA PANTALLA ENSEÑA LAS OPCIONES, NO SOLO LA VIGENTE (CONVENCIONES §2.8.2). El nivel de cada
// persona es un desplegable con las dos opciones a la vista, no una etiqueta que hay que pulsar
// para descubrir que alterna. Un estado que esconde la mitad de lo que se puede hacer obliga a
// probar para averiguarlo.
//
// 🔴 Y BAJAR A ALGUIEN DE EDITOR A LECTOR ES UN `PATCH`, nunca quitarle la fila y volver a
// dársela (§2.8.1). Ese camino deja a la persona SIN ACCESO en el hueco entre las dos llamadas, y
// si la segunda no llega —se cierra el modal, se cae la red— la deja fuera del todo cuando lo que
// se quería era rebajarle el permiso.
// ============================================================================================

type Objetivo = { folder_id: string; file_id?: undefined } | { file_id: string; folder_id?: undefined };

interface Comparticion {
  id: string;
  permiso: "lector" | "editor";
  usuario_id: string;
  usuario_nombre: string | null;
  usuario_email: string;
}

interface UsuarioOfrecido { id: string; nombre: string | null; email: string }

export function CompartirModal({
  objetivo, nombre, onCerrar, onCambio,
}: {
  objetivo: Objetivo;
  nombre: string;
  onCerrar: () => void;
  /** Se llama cuando cambia algo, para que la pantalla de detrás repinte el icono de compartida. */
  onCambio?: () => void;
}) {
  const [comparticiones, setComparticiones] = useState<Comparticion[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pagina, setPagina] = useState(1);
  const [candidatos, setCandidatos] = useState<{ usuarios: UsuarioOfrecido[]; hasMore: boolean; total: number }>({ usuarios: [], hasMore: false, total: 0 });
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const params = objetivo.folder_id ? `folder_id=${objetivo.folder_id}` : `file_id=${objetivo.file_id}`;

  const cargarComparticiones = useCallback(async () => {
    try {
      const r = await fetch(`/api/drive/comparticiones?${params}`);
      if (!r.ok) throw new Error();
      setComparticiones((await r.json()).comparticiones ?? []);
    } catch {
      setComparticiones([]);
      toast.error("No se pudo cargar con quién está compartido");
    }
  }, [params]);

  useEffect(() => { cargarComparticiones(); }, [cargarComparticiones]);

  // El buscador espera a que se deje de teclear: son 10 por página y una petición por letra no
  // aporta nada salvo carga.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(busqueda.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    fetch(`/api/drive/usuarios-para-compartir?page=${pagina}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelado && d) setCandidatos({ usuarios: d.usuarios ?? [], hasMore: !!d.hasMore, total: d.total ?? 0 }); })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [debounced, pagina]);

  const yaCompartido = new Set((comparticiones ?? []).map((c) => c.usuario_id));

  const compartirCon = async (usuarioId: string, permiso: "lector" | "editor") => {
    setOcupado(usuarioId);
    try {
      const r = await fetch("/api/drive/comparticiones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...objetivo, compartido_con: usuarioId, permiso }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(mensaje(d?.error)); return; }
      await cargarComparticiones();
      onCambio?.();
    } finally { setOcupado(null); }
  };

  const cambiarPermiso = async (c: Comparticion, permiso: "lector" | "editor") => {
    if (permiso === c.permiso) return;
    setOcupado(c.id);
    try {
      const r = await fetch(`/api/drive/comparticiones/${c.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permiso }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(mensaje(d?.error)); return; }
      // Se repinta desde lo que devolvió el servidor, no desde lo que se pidió (§2.8.4).
      await cargarComparticiones();
      onCambio?.();
    } finally { setOcupado(null); }
  };

  const dejarDeCompartir = async (c: Comparticion) => {
    setOcupado(c.id);
    try {
      const r = await fetch(`/api/drive/comparticiones/${c.id}`, { method: "DELETE" });
      if (!r.ok) { toast.error("No se pudo quitar el acceso"); return; }
      await cargarComparticiones();
      onCambio?.();
    } finally { setOcupado(null); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCerrar}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/5 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
            <Share2 className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-display font-black truncate">Compartir «{nombre}»</div>
            <div className="text-[11px] text-neutral-500 font-ui">Solo las personas que elijas podrán verlo</div>
          </div>
          <button onClick={onCerrar} className="h-8 w-8 rounded-lg hover:bg-black/5 flex items-center justify-center shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Quién tiene acceso ya */}
          <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
            <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 mb-2">Con acceso</div>
            {comparticiones === null ? (
              <div className="flex items-center gap-2 text-xs text-neutral-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</div>
            ) : comparticiones.length === 0 ? (
              <div className="text-xs text-neutral-400 italic">Todavía no lo has compartido con nadie</div>
            ) : (
              <ul className="space-y-1.5">
                {comparticiones.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{c.usuario_nombre || c.usuario_email}</div>
                      {c.usuario_nombre && <div className="text-[10px] text-neutral-400 truncate">{c.usuario_email}</div>}
                    </div>
                    {/* Las DOS opciones a la vista (§2.8.2). */}
                    <select
                      value={c.permiso}
                      disabled={ocupado === c.id}
                      onChange={(e) => cambiarPermiso(c, e.target.value as "lector" | "editor")}
                      className="h-8 px-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 text-xs font-ui"
                    >
                      <option value="lector">Puede ver</option>
                      <option value="editor">Puede editar</option>
                    </select>
                    <button
                      onClick={() => dejarDeCompartir(c)}
                      disabled={ocupado === c.id}
                      title="Quitar el acceso"
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-brand-red hover:bg-red-50 dark:hover:bg-red-900/10 transition shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* A quién más */}
          <div className="px-5 py-4">
            <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 mb-2">Añadir a alguien</div>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o correo…"
                className="w-full h-9 pl-9 pr-3 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 text-sm"
              />
            </div>

            {cargando ? (
              <div className="flex items-center gap-2 text-xs text-neutral-400 py-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</div>
            ) : candidatos.usuarios.length === 0 ? (
              <div className="text-xs text-neutral-400 italic py-3">Nadie coincide con esa búsqueda</div>
            ) : (
              <ul className="space-y-1">
                {candidatos.usuarios.map((usuario) => {
                  const ya = yaCompartido.has(usuario.id);
                  return (
                    <li key={usuario.id} className={cn("flex items-center gap-2 px-2 py-1.5 rounded-lg", !ya && "hover:bg-neutral-50 dark:hover:bg-white/5")}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{usuario.nombre || usuario.email}</div>
                        {usuario.nombre && <div className="text-[10px] text-neutral-400 truncate">{usuario.email}</div>}
                      </div>
                      {ya ? (
                        <span className="text-[10px] font-ui text-neutral-400 shrink-0">ya tiene acceso</span>
                      ) : (
                        <>
                          <button
                            disabled={ocupado === usuario.id}
                            onClick={() => compartirCon(usuario.id, "lector")}
                            className="h-7 px-2.5 rounded-lg text-[11px] font-ui font-bold border border-black/10 dark:border-white/10 hover:bg-black/5 transition shrink-0"
                          >
                            Ver
                          </button>
                          <button
                            disabled={ocupado === usuario.id}
                            onClick={() => compartirCon(usuario.id, "editor")}
                            className="h-7 px-2.5 rounded-lg text-[11px] font-ui font-bold gradient-orange text-white hover:brightness-110 transition shrink-0"
                          >
                            Editar
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Paginado de 10 en 10, como se pidió: «que no me traiga todos los usuarios». */}
            {(pagina > 1 || candidatos.hasMore) && (
              <div className="flex items-center justify-between mt-3 text-[11px] font-ui text-neutral-500">
                <button disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)} className="h-7 px-2.5 rounded-lg hover:bg-black/5 disabled:opacity-30">Anteriores</button>
                <span>{candidatos.total} persona{candidatos.total === 1 ? "" : "s"}</span>
                <button disabled={!candidatos.hasMore} onClick={() => setPagina((p) => p + 1)} className="h-7 px-2.5 rounded-lg hover:bg-black/5 disabled:opacity-30">Siguientes</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Los errores del servidor, dichos como lo que impiden y no como se llaman por dentro (§4.7). */
function mensaje(error: string | undefined): string {
  const porQue: Record<string, string> = {
    no_es_tuyo: "Solo puedes compartir lo que está en tu unidad.",
    permiso_invalido: "Ese nivel de acceso no existe.",
    usuario_no_disponible: "Esa persona ya no tiene cuenta activa.",
    no_a_uno_mismo: "No hace falta compartirte algo a ti mismo.",
    not_found: "Eso ya no existe.",
  };
  return porQue[error ?? ""] || "No se pudo compartir.";
}
