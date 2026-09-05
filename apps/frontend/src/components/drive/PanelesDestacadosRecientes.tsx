"use client";
import { useCallback, useEffect, useState } from "react";
import { Building2, Clock, FolderOpen, Loader2, Star, UserCircle } from "@/lib/bootstrap-icons";
import { toast } from "sonner";

import { MiniaturaArchivo } from "./MiniaturaArchivo";

// ============================================================================================
// «DESTACADOS» Y «RECIENTES» — T6 (reunión del 2026-08-24)
//
// Los dos son PANELES y no nodos del árbol, por el mismo motivo que «Compartidos conmigo»:
// anidar carpetas virtuales obliga a inventar ids que no existen en la base en tres sitios más.
// Aquí cada elemento lleva su id REAL, así que abrirlo es la navegación de siempre.
//
// 🔴 DESTACADOS TIENE DOS ÁMBITOS Y NO SON LO MISMO, así que se pintan separados y con su
// etiqueta. «Destacados Compañía» lo ve todo el equipo; «Mis Destacados» no lo ve nadie más.
// Mezclarlos en una sola lista haría creer que marcar algo es siempre un gesto privado — y en la
// rama de la compañía no lo es.
// ============================================================================================

interface ItemDestacado {
  id: string;
  ambito: "compania" | "personal";
  tipo: "carpeta" | "archivo";
  folder_id: string | null;
  file_id: string | null;
  nombre: string;
  mime: string | null;
  size_bytes: number | string | null;
  puesta_por: string | null;
  mia: boolean;
}

export function DestacadosPanel({
  onAbrirCarpeta, onAbrirArchivo, esAdmin, recargarToken,
}: {
  onAbrirCarpeta: (folderId: string) => void;
  onAbrirArchivo: (item: ItemDestacado) => void;
  esAdmin: boolean;
  recargarToken?: number;
}) {
  const [datos, setDatos] = useState<{ compania: ItemDestacado[]; personales: ItemDestacado[] } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/drive/destacados");
      if (!r.ok) throw new Error();
      setDatos(await r.json());
    } catch { setDatos({ compania: [], personales: [] }); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recargarToken]);

  const quitar = async (it: ItemDestacado) => {
    const r = await fetch(`/api/drive/destacados/${it.id}`, { method: "DELETE" });
    if (!r.ok) {
      // «La quita quien la puso, y los admin.» Se dice lo que impide, no el nombre del error.
      toast.error("Solo puede quitarla quien la puso, o un administrador.");
      return;
    }
    cargar();
  };

  if (datos === null) {
    return <div className="flex items-center gap-2 text-sm text-neutral-400 p-8"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;
  }

  const vacio = datos.compania.length === 0 && datos.personales.length === 0;
  if (vacio) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-orange/10 mb-4">
          <Star className="h-8 w-8 text-brand-orange" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg font-black mb-1">Nada destacado todavía</h3>
        <p className="text-xs text-neutral-500">Pulsa la estrella de una carpeta o un archivo para tenerlo a mano aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Grupo
        titulo="Destacados de la compañía"
        subtitulo="Lo ve todo el equipo"
        Icono={Building2}
        items={datos.compania}
        onAbrirCarpeta={onAbrirCarpeta}
        onAbrirArchivo={onAbrirArchivo}
        puedeQuitar={(it) => it.mia || esAdmin}
        onQuitar={quitar}
      />
      <Grupo
        titulo="Mis destacados"
        subtitulo="Solo los ves tú"
        Icono={UserCircle}
        items={datos.personales}
        onAbrirCarpeta={onAbrirCarpeta}
        onAbrirArchivo={onAbrirArchivo}
        puedeQuitar={() => true}
        onQuitar={quitar}
      />
    </div>
  );
}

function Grupo({
  titulo, subtitulo, Icono, items, onAbrirCarpeta, onAbrirArchivo, puedeQuitar, onQuitar,
}: {
  titulo: string;
  subtitulo: string;
  Icono: any;
  items: ItemDestacado[];
  onAbrirCarpeta: (id: string) => void;
  onAbrirArchivo: (it: ItemDestacado) => void;
  puedeQuitar: (it: ItemDestacado) => boolean;
  onQuitar: (it: ItemDestacado) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
          <Icono className="h-4 w-4" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[13px] font-bold">{titulo}</div>
          <div className="text-[10px] text-neutral-400">{subtitulo}</div>
        </div>
      </div>
      {items.length === 0 ? (
        /* Se dice que está vacío en vez de omitir el grupo: así se ve que los dos ámbitos existen
           y que este simplemente no tiene nada, que no es lo mismo que no existir. */
        <div className="ml-10 px-3 py-2 text-xs text-neutral-400 italic">Nada por aquí todavía</div>
      ) : (
        <div className="space-y-1 ml-10">
          {items.map((it) => (
            <div key={it.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.03] transition border border-transparent hover:border-black/5">
              <button
                onClick={() => (it.tipo === "carpeta" && it.folder_id ? onAbrirCarpeta(it.folder_id) : onAbrirArchivo(it))}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <div className="h-9 w-9 rounded-lg overflow-hidden shrink-0 flex items-center justify-center bg-neutral-100 dark:bg-white/5">
                  {it.tipo === "carpeta"
                    ? <FolderOpen className="h-4 w-4 text-brand-orange" strokeWidth={2} />
                    : <MiniaturaArchivo file={{ id: it.file_id!, nombre: it.nombre, mime: it.mime } as any} />}
                </div>
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{it.nombre}</span>
              </button>
              {it.ambito === "compania" && it.puesta_por && (
                <span className="text-[10px] text-neutral-400 shrink-0 hidden sm:block">por {it.puesta_por}</span>
              )}
              {puedeQuitar(it) && (
                <button
                  onClick={() => onQuitar(it)}
                  title="Quitar de destacados"
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-brand-orange hover:bg-brand-orange/10 shrink-0 transition"
                >
                  <Star className="h-4 w-4 fill-current" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════

interface ItemReciente {
  file_id: string;
  visto_at: string;
  nombre: string;
  mime: string | null;
  size_bytes: number | string | null;
  folder_id: string;
  carpeta: string | null;
}

export function RecientesPanel({
  onAbrirArchivo, recargarToken,
}: {
  onAbrirArchivo: (it: ItemReciente) => void;
  recargarToken?: number;
}) {
  const [items, setItems] = useState<ItemReciente[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/drive/recientes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelado) setItems(d?.recientes ?? []); })
      .catch(() => { if (!cancelado) setItems([]); });
    return () => { cancelado = true; };
  }, [recargarToken]);

  if (items === null) {
    return <div className="flex items-center gap-2 text-sm text-neutral-400 p-8"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-orange/10 mb-4">
          <Clock className="h-8 w-8 text-brand-orange" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg font-black mb-1">Todavía no has abierto nada</h3>
        <p className="text-xs text-neutral-500">Aquí aparecerán los archivos que abras, los últimos primero.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Es una lista de ARCHIVOS y no de carpetas: «reciente» es lo que se abrió, y una carpeta
          no se abre, se recorre. */}
      {items.map((it) => (
        <button
          key={it.file_id}
          onClick={() => onAbrirArchivo(it)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.03] transition border border-transparent hover:border-black/5 text-left"
        >
          <div className="h-9 w-9 rounded-lg overflow-hidden shrink-0 bg-neutral-100 dark:bg-white/5">
            <MiniaturaArchivo file={{ id: it.file_id, nombre: it.nombre, mime: it.mime } as any} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium">{it.nombre}</div>
            {it.carpeta && <div className="text-[10px] text-neutral-400 truncate">en {it.carpeta}</div>}
          </div>
          <span className="text-[10px] text-neutral-400 shrink-0">{cuandoFue(it.visto_at)}</span>
        </button>
      ))}
    </div>
  );
}

/** «hace 3 h» en vez de una fecha: en una lista de recientes lo que se busca es cuál fue el último. */
function cuandoFue(iso: string): string {
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "ahora mismo";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  if (seg < 86400 * 30) return `hace ${Math.floor(seg / 86400)} d`;
  return new Date(iso).toLocaleDateString();
}
