"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { Button } from "@/components/ui/Button";
import { X, MagnifyingGlass, Link2, Plus } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

const DOMINIOS_SUGERIDOS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com"];

interface Contacto {
  id: string;
  nombre_completo: string;
  email: string | null;
  telefono: string | null;
}

interface Props {
  onClose: () => void;
  onVinculado: (contactoId: string) => Promise<void>;
  /** Para precargar el formulario de "Crear nuevo" con lo que ya se sabe del WhatsApp. */
  nombreSugerido?: string;
  telefonoSugerido?: string;
}

export function VincularContactoModal({ onClose, onVinculado, nombreSugerido, telefonoSugerido }: Props) {
  const [tab, setTab] = useState<"buscar" | "crear">("buscar");
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Contacto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  const [nombreNuevo, setNombreNuevo] = useState(nombreSugerido || "");
  const [telefonoNuevo, setTelefonoNuevo] = useState(telefonoSugerido || "");
  const [emailNuevo, setEmailNuevo] = useState("");
  const [creando, setCreando] = useState(false);

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

  const crearYVincular = async () => {
    if (nombreNuevo.trim().length < 2) { toast.error("Ponle un nombre al contacto"); return; }
    if (!telefonoNuevo.trim()) { toast.error("El teléfono es obligatorio"); return; }
    setCreando(true);
    try {
      // Endpoint propio de WhatsApp: a propósito NO es /api/contactos — aquí el email es
      // opcional, una excepción que solo aplica a este flujo (el resto del CRM lo sigue exigiendo).
      const r = await fetch("/api/whatsapp/contactos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre_completo: nombreNuevo.trim(), telefono: telefonoNuevo.trim(), email: emailNuevo.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear el contacto");
      await onVinculado(d.contacto.id);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo crear el contacto");
    } finally {
      setCreando(false);
    }
  };

  // Sugerencias de dominio: en cuanto se escribe "algo@", ofrece completar con los proveedores
  // más comunes — no hace falta terminar de escribir el dominio a mano.
  const arrobaIdx = emailNuevo.indexOf("@");
  const localPart = arrobaIdx >= 0 ? emailNuevo.slice(0, arrobaIdx) : null;
  const dominioEscrito = arrobaIdx >= 0 ? emailNuevo.slice(arrobaIdx + 1) : "";
  const sugerenciasDominio = localPart
    ? DOMINIOS_SUGERIDOS.filter((d) => d.startsWith(dominioEscrito) && d !== dominioEscrito)
    : [];

  return (
    <AnimatedModal onClose={onClose} panelClassName="w-full max-w-md glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center gap-3">
        <div className="flex-1 font-display font-black text-sm">Vincular a un contacto</div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex px-4 pt-3 gap-1 border-b border-black/5 dark:border-white/10">
        {(["buscar", "crear"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-[11px] font-ui font-bold uppercase tracking-wider rounded-t-lg transition border-b-2 -mb-px",
              tab === t ? "text-brand-primary border-brand-primary" : "text-neutral-400 border-transparent hover:text-neutral-600"
            )}
          >
            {t === "buscar" ? "Buscar existente" : "Crear nuevo"}
          </button>
        ))}
      </div>

      {tab === "buscar" ? (
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
              <div className="text-center text-xs text-neutral-400 py-4">Sin resultados. Prueba con "Crear nuevo".</div>
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
      ) : (
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Nombre completo</label>
            <input
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              className="mt-1 w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
            />
          </div>
          <div>
            <label className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Teléfono</label>
            <input
              value={telefonoNuevo}
              onChange={(e) => setTelefonoNuevo(e.target.value)}
              className="mt-1 w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
            />
          </div>
          <div>
            <label className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Email <span className="normal-case font-normal text-neutral-400">(opcional)</span></label>
            <input
              value={emailNuevo}
              onChange={(e) => setEmailNuevo(e.target.value)}
              placeholder="nombre@ejemplo.com"
              className="mt-1 w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
            />
            {sugerenciasDominio.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {sugerenciasDominio.map((dom) => (
                  <button
                    key={dom}
                    onClick={() => setEmailNuevo(`${localPart}@${dom}`)}
                    className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-brand-primary/10 hover:text-brand-primary transition"
                  >
                    @{dom}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button onClick={crearYVincular} disabled={creando} className="w-full">
            <Plus className="h-4 w-4" /> {creando ? "Creando…" : "Crear y vincular"}
          </Button>
        </div>
      )}
    </AnimatedModal>
  );
}
