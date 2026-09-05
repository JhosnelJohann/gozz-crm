"use client";
import { useCallback, useEffect, useState } from "react";
import { Eye, FolderOpen, Loader2, UserCircle } from "@/lib/bootstrap-icons";

import { MiniaturaArchivo } from "./MiniaturaArchivo";

// ============================================================================================
// «COMPARTIDOS CONMIGO» — T5 (reunión del 2026-08-24)
//
// «Debería ser algo así como una carpeta por el contacto: si Sarahy me compartió algo, que se le
// creó una carpeta a Sarahy, y yo veo, ah mira, estos son todos los archivos que me ha compartido
// Sarahy. Pero únicamente si ella ha compartido algo conmigo… no tener la carpeta de todo el
// equipo entero, no.»
//
// De ahí las dos reglas de esta pantalla: se agrupa POR QUIEN COMPARTE, y **no aparece nadie que
// no te haya dado nada**. Una lista con las quince personas de la empresa, catorce de ellas
// vacías, sería exactamente lo que se pidió evitar.
//
// Es un PANEL y no unos nodos del árbol. Anidar personas y sus cosas como carpetas virtuales
// obligaría a inventar ids que no existen en la base en tres sitios más; aquí los items llevan su
// id REAL, así que abrir una carpeta compartida es la misma navegación de siempre — lo que ha
// cambiado es el permiso, no el camino.
// ============================================================================================

interface ItemCompartido {
  comparticion_id: string;
  permiso: "lector" | "editor";
  tipo: "carpeta" | "archivo";
  folder_id: string | null;
  file_id: string | null;
  nombre: string;
  mime: string | null;
  size_bytes: number | string | null;
}

interface PersonaCompartiendo {
  id: string;
  nombre: string | null;
  email: string;
  items: ItemCompartido[];
}

export function CompartidosConmigo({
  onAbrirCarpeta, onAbrirArchivo, recargarToken,
}: {
  onAbrirCarpeta: (folderId: string) => void;
  onAbrirArchivo: (item: ItemCompartido) => void;
  /** Cambiar este valor fuerza a recargar (p. ej. tras compartir algo). */
  recargarToken?: number;
}) {
  const [personas, setPersonas] = useState<PersonaCompartiendo[] | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/drive/compartidos-conmigo");
      if (!r.ok) throw new Error();
      setPersonas((await r.json()).personas ?? []);
    } catch { setPersonas([]); }
  }, []);

  useEffect(() => { cargar(); }, [cargar, recargarToken]);

  if (personas === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-400 p-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  if (personas.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-orange/10 mb-4">
          <UserCircle className="h-8 w-8 text-brand-orange" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg font-black mb-1">Nadie te ha compartido nada todavía</h3>
        <p className="text-xs text-neutral-500">Cuando alguien comparta una carpeta o un archivo contigo, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {personas.map((p) => (
        <section key={p.id}>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
              <UserCircle className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold truncate">{p.nombre || p.email}</div>
              <div className="text-[10px] text-neutral-400 truncate">
                {p.items.length} elemento{p.items.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div className="space-y-1 ml-10">
            {p.items.map((it) => (
              <button
                key={it.comparticion_id}
                onClick={() => (it.tipo === "carpeta" && it.folder_id ? onAbrirCarpeta(it.folder_id) : onAbrirArchivo(it))}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.03] transition border border-transparent hover:border-black/5 dark:hover:border-white/5 text-left"
              >
                <div className="h-9 w-9 rounded-lg overflow-hidden shrink-0 flex items-center justify-center bg-neutral-100 dark:bg-white/5">
                  {it.tipo === "carpeta"
                    ? <FolderOpen className="h-4 w-4 text-brand-orange" strokeWidth={2} />
                    : <MiniaturaArchivo file={{ id: it.file_id!, nombre: it.nombre, mime: it.mime } as any} />}
                </div>
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{it.nombre}</span>
                {/* El nivel se dice como lo que permite, no con el nombre de la fila (§4.7). */}
                <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 shrink-0">
                  {it.permiso === "editor" ? "Puedes editar" : "Solo ver"}
                </span>
                {it.tipo === "archivo" && <Eye className="h-3.5 w-3.5 text-neutral-400 shrink-0" />}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
