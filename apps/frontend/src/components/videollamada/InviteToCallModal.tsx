"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Loader2, UserPlus, Check, PhoneCall } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { initialsOf } from "@/lib/auth-user";
import { cn } from "@/lib/utils";

interface Contacto { id: string; email: string; nombre: string; foto_perfil_url: string | null; online?: boolean; }

// Modal para agregar/invitar usuarios a una videollamada EN CURSO.
// Reusa POST /api/videollamadas/:id/invitar (timbra a los nuevos y los suma al room;
// si la llamada era DM, el backend crea un grupo automatico con todos).
export function InviteToCallModal({ videollamadaId, open, onClose }: { videollamadaId: string; open: boolean; onClose: () => void }) {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSelected(new Set()); setLoading(true);
    fetch("/api/chat/contactos")
      .then((r) => r.json())
      .then((d) => setContactos(Array.isArray(d.contactos) ? d.contactos : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return qq ? contactos.filter((c) => c.nombre.toLowerCase().includes(qq) || (c.email || "").toLowerCase().includes(qq)) : contactos;
  }, [contactos, q]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const invitar = async () => {
    if (selected.size === 0) { toast.error("Selecciona al menos un usuario"); return; }
    setSending(true);
    try {
      const r = await fetch(`/api/videollamadas/${videollamadaId}/invitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: Array.from(selected) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo invitar");
      toast.success(`Llamando a ${typeof d.invited === "number" ? d.invited : selected.size} usuario(s)…`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error al invitar");
    } finally {
      setSending(false);
    }
  };

  if (!mounted || !open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[82vh] flex flex-col rounded-3xl bg-[#11111c] text-white shadow-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-brand-orange/15 text-brand-orange flex items-center justify-center shrink-0">
            <UserPlus className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-sm">Agregar a la llamada</div>
            <div className="text-[12px] text-white/45">Se les enviará el timbre de videollamada</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60"><X className="h-4 w-4" /></button>
        </div>
        {/* Search */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-white/[0.06] border border-white/10">
            <Search className="h-4 w-4 text-white/40" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar usuario…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-white/35" />
          </div>
          {selected.size > 0 && <div className="text-[11px] text-white/50 mt-2 px-1">{selected.size} seleccionado{selected.size === 1 ? "" : "s"}</div>}
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 mt-1" style={{ overscrollBehavior: "contain" }}>
          {loading ? (
            <div className="h-32 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>
          ) : filtered.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-sm text-white/40">Sin usuarios</div>
          ) : filtered.map((cc) => {
            const on = selected.has(cc.id);
            return (
              <button key={cc.id} type="button" onClick={() => toggle(cc.id)}
                className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition", on ? "bg-brand-orange/15" : "hover:bg-white/[0.05]")}>
                <span className="relative shrink-0">
                  {cc.foto_perfil_url ? (
                    <img src={cc.foto_perfil_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-xs font-bold flex items-center justify-center">{initialsOf(cc.nombre)}</span>
                  )}
                  {cc.online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#11111c]" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{cc.nombre}</span>
                  <span className="block text-[11px] text-white/40 truncate">{cc.email}</span>
                </span>
                <span className={cn("h-5 w-5 rounded-full border flex items-center justify-center shrink-0", on ? "bg-brand-orange border-brand-orange" : "border-white/25")}>
                  {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={sending}
            className="h-10 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm font-ui font-bold uppercase tracking-wider text-white/80 disabled:opacity-50">Cancelar</button>
          <button onClick={invitar} disabled={sending || selected.size === 0}
            className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-sm font-ui font-bold uppercase tracking-wider shadow disabled:opacity-50 inline-flex items-center gap-2">
            {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Invitando</> : <><PhoneCall className="h-4 w-4" strokeWidth={2.5} /> Llamar</>}
          </button>
        </div>
      </div>
    </div>, document.body);
}
