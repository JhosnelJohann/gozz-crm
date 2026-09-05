"use client";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2, Users, Megaphone, Video, Check } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { initialsOf } from "@/lib/auth-user";
import { cn } from "@/lib/utils";

export type GrupoMode = "grupo" | "canal" | "videoconferencia";

interface Contacto {
  id: string;
  email: string;
  nombre: string;
  foto_perfil_url: string | null;
  online: boolean;
  departamento?: string | null;
  posiciones?: string[];
}

interface Props {
  open: boolean;
  mode: GrupoMode;
  onClose: () => void;
  onCreated: (payload: { grupo: any; videollamadaId?: string }) => void;
}

const MODE_CONFIG: Record<GrupoMode, { Icon: any; title: string; subtitle: string; submit: string; accent: string; iconBg: string }> = {
  grupo:            { Icon: Users,     title: "Chat grupal",    subtitle: "Selecciona los integrantes del grupo", submit: "Crear grupo", accent: "from-brand-orange to-neon-magenta", iconBg: "bg-brand-orange/15 text-brand-orange" },
  canal:            { Icon: Megaphone, title: "Nuevo canal",    subtitle: "Destinado a anuncios y comunicados",   submit: "Crear canal", accent: "from-amber-500 to-orange-500",     iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-500/15" },
  videoconferencia: { Icon: Video,     title: "Videoconferencia", subtitle: "Elige los participantes de la llamada", submit: "Iniciar videollamada", accent: "from-sky-500 to-brand-blue", iconBg: "bg-sky-100 text-sky-600 dark:bg-sky-500/15" },
};

export function CrearGrupoModal({ open, mode, onClose, onCreated }: Props) {
  const cfg = MODE_CONFIG[mode];
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [q, setQ] = useState("");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setNombre("");
    setDescripcion("");
    setSelected(new Set());
    setLoadingList(true);
    fetch("/api/chat/contactos")
      .then((r) => r.json())
      .then((d) => setContactos(d.contactos || []))
      .finally(() => setLoadingList(false));
  }, [open, mode]);

  const filtered = useMemo(() => {
    if (!q.trim()) return contactos;
    const qq = q.toLowerCase();
    return contactos.filter((c) => c.nombre.toLowerCase().includes(qq) || c.email.toLowerCase().includes(qq));
  }, [contactos, q]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  const submit = async () => {
    if (selected.size === 0) { toast.error("Selecciona al menos un participante"); return; }
    if (mode !== "videoconferencia" && !nombre.trim()) { toast.error("El nombre es obligatorio"); return; }
    setSaving(true);
    try {
      const fallbackNombre = mode === "videoconferencia"
        ? `Videollamada · ${new Date().toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : nombre.trim();
      // 1. Crear grupo / canal
      const grupoTipo = mode === "canal" ? "canal" : "grupo";
      const r1 = await fetch("/api/chat/grupos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim() || fallbackNombre,
          tipo: grupoTipo,
          descripcion: descripcion.trim() || null,
          miembros: Array.from(selected)
        })
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error || "No se pudo crear el grupo");

      if (mode === "videoconferencia") {
        // 2. Crear videollamada asociada y redirigir
        const r2 = await fetch("/api/videollamadas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grupo_id: d1.grupo.id, nombre_sala: fallbackNombre })
        });
        const d2 = await r2.json();
        if (!r2.ok) throw new Error(d2.error || "No se pudo iniciar la videollamada");
        onCreated({ grupo: d1.grupo, videollamadaId: d2.videollamada?.id });
      } else {
        onCreated({ grupo: d1.grupo });
      }
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const Icon = cfg.Icon;
  const isVideo = mode === "videoconferencia";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden modal-surface"
        >
          <div className="p-5 border-b border-black/5 dark:border-white/5 flex items-center gap-3">
            <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center", cfg.iconBg)}>
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display font-black text-lg truncate">{cfg.title}</h3>
              <p className="text-[12px] text-neutral-500">{cfg.subtitle}</p>
            </div>
            <button onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-3 border-b border-black/5 dark:border-white/5">
            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">
                {isVideo ? "Nombre de la sala (opcional)" : "Nombre"} {!isVideo && <span className="text-brand-red">*</span>}
              </label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder={isVideo ? `Videollamada ${new Date().toLocaleDateString("es")}` : (mode === "canal" ? "Anuncios generales" : "Equipo de preparación I-751")}
                className="w-full h-11 px-4 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-4 focus:ring-brand-orange/20 focus:border-brand-orange"
              />
            </div>
            {!isVideo && (
              <div>
                <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Descripción (opcional)</label>
                <input
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder={mode === "canal" ? "Comunicados oficiales del equipo" : "De qué trata este grupo"}
                  className="w-full h-11 px-4 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-4 focus:ring-brand-orange/20 focus:border-brand-orange"
                />
              </div>
            )}
          </div>

          <div className="px-5 pt-4 pb-2 flex items-center gap-2 justify-between">
            <div className="flex items-center gap-2 flex-1 h-10 px-3 rounded-xl bg-neutral-100 dark:bg-white/5 border border-transparent focus-within:border-brand-orange/40">
              <Search className="h-4 w-4 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar miembro del equipo…"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            <div className="text-[11px] text-neutral-500 font-ui tabular-nums whitespace-nowrap">
              {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
            {loadingList ? (
              <div className="py-10 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-brand-orange" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-400">Sin resultados</div>
            ) : (
              filtered.map((c) => {
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "w-full px-3 py-2.5 flex items-center gap-3 text-left rounded-lg transition",
                      on ? "bg-brand-orange/10" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    )}
                  >
                    <div className="relative">
                      <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-bold text-[11px]">
                        {c.foto_perfil_url
                          ? <img src={c.foto_perfil_url} alt={c.nombre} className="h-full w-full object-cover" />
                          : initialsOf(c.nombre)}
                      </div>
                      {c.online && <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-400 border-2 border-bg-light dark:border-bg-dark" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{c.nombre}</div>
                      <div className="text-[11px] text-neutral-500 truncate">
                        {(c.posiciones || [])[0] || c.departamento || c.email}
                      </div>
                    </div>
                    <div className={cn(
                      "h-5 w-5 rounded-md border-2 flex items-center justify-center transition",
                      on ? "bg-brand-orange border-brand-orange" : "border-neutral-300 dark:border-white/20"
                    )}>
                      {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="px-5 py-4 border-t border-black/5 dark:border-white/5 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 font-ui text-[11px] font-bold uppercase tracking-wider">
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || selected.size === 0 || (!isVideo && !nombre.trim())}
              className={cn(
                "h-11 px-5 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 flex items-center gap-2 bg-gradient-to-r",
                cfg.accent
              )}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {cfg.submit}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
