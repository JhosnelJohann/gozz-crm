"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { Button } from "@/components/ui/Button";
import { X, MagnifyingGlass, Link2 } from "@/lib/bootstrap-icons";

interface Contacto {
  id: string;
  nombre_completo: string;
  email: string | null;
  telefono: string | null;
}

interface Props {
  onClose: () => void;
  onVinculado: (contactoId: string) => Promise<void>;
}

export function VincularContactoModal({ onClose, onVinculado }: Props) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Contacto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/contactos/search?q=${encodeURIComponent(q.trim())}`);
        const d = await r.json();
        setResultados(d.contactos || []);
      } catch { /* red momentánea: se reintenta con la próxima tecla */ } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const vincular = async (id: string) => {
    setVinculando(id);
    try {
      await onVinculado(id);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo vincular el contacto");
    } finally {
      setVinculando(null);
    }
  };

  return (
    <AnimatedModal onClose={onClose} panelClassName="w-full max-w-md glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center gap-3">
        <div className="flex-1 font-display font-black text-sm">Vincular a un contacto</div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4">
        <div className="relative">
          <MagnifyingGlass className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, email o teléfono…"
            className="w-full h-11 pl-9 pr-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
          />
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto space-y-1">
          {buscando && <div className="text-center text-xs text-neutral-400 py-4">Buscando…</div>}
          {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
            <div className="text-center text-xs text-neutral-400 py-4">Sin resultados. Puedes crear el contacto desde el módulo de Contactos.</div>
          )}
          {resultados.map((c) => (
            <button
              key={c.id}
              onClick={() => vincular(c.id)}
              disabled={!!vinculando}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-left transition disabled:opacity-50"
            >
              <div className="h-9 w-9 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold text-xs shrink-0">
                {c.nombre_completo.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{c.nombre_completo}</div>
                <div className="text-[11px] text-neutral-500 truncate">{c.email || c.telefono || ""}</div>
              </div>
              {vinculando === c.id ? (
                <div className="h-4 w-4 rounded-full border-2 border-brand-primary/30 border-t-brand-primary animate-spin shrink-0" />
              ) : (
                <Link2 className="h-4 w-4 text-neutral-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    </AnimatedModal>
  );
}
