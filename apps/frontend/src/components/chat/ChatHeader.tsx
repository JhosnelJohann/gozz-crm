"use client";
import { useEffect, useState } from "react";
import { Video, MoreHorizontal, Hash, Users, X, Plus, Pencil, Briefcase, CheckSquare, Trash2, Info, ArrowLeft } from "@/lib/bootstrap-icons";
import { CoPilotAvatar } from "./CoPilotMessage";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { initialsOf } from "@/lib/auth-user";
import { usePresence, formatLastSeen } from "@/lib/presence";
import { getSocket } from "@/lib/socket";
import { OutgoingCallOverlay } from "./OutgoingCallOverlay";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { TypingDots } from "./TypingIndicator";
import type { ChatListItem } from "./ChatSidebar";

interface Props {
  grupo: ChatListItem;
  typingNames?: string[];   // si hay alguien escribiendo en este chat, se muestra "escribiendo..."
  /** Solo en móvil: vuelve a la lista de chats (patrón app de mensajería — una vista a la vez). */
  onBack?: () => void;
}

function MembersModal({ open, onClose, grupoId, grupoNombre }: { open: boolean; onClose: () => void; grupoId: string; grupoNombre: string }) {
  const [miembros, setMiembros] = useState<any[] | null>(null);
  const [soyAdmin, setSoyAdmin] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setMiembros(null);
    fetch(`/api/chat/grupos/${grupoId}/miembros`).then((r) => r.json()).then((d) => { setMiembros(d.miembros || []); setSoyAdmin(!!d.soy_admin); }).catch(() => setMiembros([]));
  };
  useEffect(() => { if (open) { setAddOpen(false); load(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, grupoId]);
  const openAdd = async () => {
    try {
      const d = await (await fetch("/api/chat/contactos")).json();
      const ids = new Set((miembros || []).map((m: any) => m.id));
      setCandidatos((d.contactos || []).filter((c: any) => !ids.has(c.id)));
      setAddOpen(true);
    } catch { toast.error("No se pudieron cargar usuarios"); }
  };
  const addMember = async (userId: string) => {
    setBusy(true);
    try { await fetch(`/api/chat/grupos/${grupoId}/miembros`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) }); setAddOpen(false); load(); }
    catch { toast.error("Error al agregar"); } finally { setBusy(false); }
  };
  const removeMember = async (userId: string) => {
    setBusy(true);
    try { await fetch(`/api/chat/grupos/${grupoId}/miembros/${userId}`, { method: "DELETE" }); load(); }
    catch { toast.error("Error al quitar"); } finally { setBusy(false); }
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-bg-dark rounded-2xl w-full max-w-sm max-h-[80vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display font-black">{addOpen ? "Agregar miembro" : "Miembros" + (miembros ? " (" + miembros.length + ")" : "")}</div>
            <div className="text-[11px] text-neutral-500 truncate">{grupoNombre}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {soyAdmin && !addOpen && (
              <button onClick={openAdd} className="h-8 px-3 rounded-full bg-brand-orange/10 text-brand-orange text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/20 flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Agregar</button>
            )}
            {addOpen && <button onClick={() => setAddOpen(false)} className="h-8 px-3 rounded-full bg-neutral-100 dark:bg-white/5 text-[11px] font-ui font-bold uppercase tracking-wider">Volver</button>}
            <button onClick={onClose} className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          {addOpen ? (
            candidatos.length === 0 ? <div className="text-center py-8 text-sm text-neutral-400">Todos ya son miembros</div> :
            candidatos.map((c: any) => (
              <button key={c.id} disabled={busy} onClick={() => addMember(c.id)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/5 text-left">
                <div className="h-9 w-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white text-[11px] font-bold shrink-0">{c.foto_perfil_url ? <img src={c.foto_perfil_url} alt="" className="h-full w-full object-cover" /> : initialsOf(c.nombre || "")}</div>
                <div className="flex-1 min-w-0 text-sm font-semibold truncate">{c.nombre}</div>
                <Plus className="h-4 w-4 text-brand-orange shrink-0" />
              </button>
            ))
          ) : miembros === null ? (
            <div className="text-center py-8 text-sm text-neutral-400">Cargando...</div>
          ) : miembros.length === 0 ? (
            <div className="text-center py-8 text-sm text-neutral-400">Sin miembros</div>
          ) : miembros.map((m: any) => (
            <div key={m.id} className="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-neutral-50 dark:hover:bg-white/5">
              <div className="relative h-9 w-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                {m.foto_perfil_url ? <img src={m.foto_perfil_url} alt="" className="h-full w-full object-cover" /> : initialsOf(m.nombre || "")}
                {m.online && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-400 border-2 border-white dark:border-bg-dark" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{m.nombre}{m.admin && <span className="ml-1.5 text-[9px] font-ui font-bold uppercase tracking-wider text-brand-orange">ADMIN</span>}</div>
                <div className="text-[11px] text-neutral-500 truncate">{m.cargo || "Sin cargo"}</div>
              </div>
              {soyAdmin && (
                <button disabled={busy} onClick={() => removeMember(m.id)} title="Quitar del grupo" className="opacity-0 group-hover:opacity-100 h-8 w-8 rounded-full hover:bg-red-50 dark:hover:bg-red-500/10 text-neutral-400 hover:text-brand-red flex items-center justify-center transition shrink-0"><X className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditGroupModal({ open, onClose, grupoId, nombre, avatarUrl, onSaved }: { open: boolean; onClose: () => void; grupoId: string; nombre: string; avatarUrl?: string | null; onSaved: (g: { nombre?: string; avatar_url?: string }) => void }) {
  const [nom, setNom] = useState(nombre);
  const [preview, setPreview] = useState<string | null>(avatarUrl || null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setNom(nombre); setPreview(avatarUrl || null); setFile(null); } }, [open, nombre, avatarUrl]);
  if (!open) return null;
  const onPick = (e: any) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPreview(URL.createObjectURL(f)); } };
  const save = async () => {
    setSaving(true);
    try {
      let avatar_url: string | undefined;
      if (file) { const fd = new FormData(); fd.append("file", file); const up = await (await fetch("/api/chat/upload", { method: "POST", body: fd })).json(); avatar_url = up.url; }
      const body: any = {};
      if (nom.trim() && nom.trim() !== nombre) body.nombre = nom.trim();
      if (avatar_url) body.avatar_url = avatar_url;
      if (Object.keys(body).length === 0) { onClose(); return; }
      const r = await fetch(`/api/chat/grupos/${grupoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      onSaved({ nombre: d.grupo?.nombre, avatar_url: d.grupo?.avatar_url });
      toast.success("Grupo actualizado");
      onClose();
    } catch (e: any) { toast.error(e.message || "Error"); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[85] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-bg-dark rounded-2xl w-full max-w-xs overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
          <div className="font-display font-black">Editar grupo</div>
          <button onClick={onClose} className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-center">
            <label className="relative h-20 w-20 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white cursor-pointer group">
              {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <Hash className="h-7 w-7" />}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition"><Pencil className="h-5 w-5 text-white" /></div>
              <input type="file" accept="image/*" className="hidden" onChange={onPick} />
            </label>
          </div>
          <div>
            <label className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 block mb-1">Nombre del grupo</label>
            <input value={nom} onChange={(e) => setNom(e.target.value)} className="w-full h-11 px-3 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm outline-none focus:border-brand-orange" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-black/5 dark:border-white/5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl border border-neutral-200 dark:border-white/10 text-[11px] font-ui font-bold uppercase tracking-wider">Cancelar</button>
          <button onClick={save} disabled={saving} className="h-10 px-5 rounded-xl gradient-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider disabled:opacity-60">Guardar</button>
        </div>
      </div>
    </div>
  );
}

export function ChatHeader({ grupo, typingNames, onBack }: Props) {
  const router = useRouter();
  const presence = usePresence();
  const [starting, setStarting] = useState(false);
  const [outCall, setOutCall] = useState<{ videollamadaId: string; status: "ringing" | "declined" | "timeout" } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [headerAdmin, setHeaderAdmin] = useState(false);
  const [override, setOverride] = useState<{ nombre?: string; avatar_url?: string }>({});
  const [tareaInfo, setTareaInfo] = useState<{ tarea_id: string; oportunidad_id: string | null; oportunidad_nombre: string | null } | null>(null);
  useEffect(() => {
    setOverride({});
    if (grupo.tipo === "directo" || grupo.tipo === "copilot") { setHeaderAdmin(false); return; }
    fetch(`/api/chat/grupos/${grupo.id}/miembros`).then((r) => r.json()).then((d) => setHeaderAdmin(!!d.soy_admin)).catch(() => setHeaderAdmin(false));
  }, [grupo.id, grupo.tipo]);

  // Chat de tarea: trae la tarea (y su oportunidad) para los accesos directos del header.
  useEffect(() => {
    if (grupo.tipo !== "tarea") { setTareaInfo(null); return; }
    let cancel = false;
    fetch(`/api/chat/grupos/${grupo.id}/tarea`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancel) setTareaInfo(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [grupo.id, grupo.tipo]);

  const isDM = grupo.tipo === "directo";
  const otherId = grupo.otro_usuario?.id;
  const online = isDM && (presence.isOnline(otherId || "") || grupo.otro_usuario?.online);
  const fotoUrl = isDM ? grupo.otro_usuario?.foto_perfil_url : grupo.avatar_url;
  const grupoNombre = override.nombre || grupo.nombre;
  const grupoFoto = override.avatar_url || fotoUrl;

  const lastSeen = isDM ? presence.lastSeen(otherId || "") : undefined;
  const someoneTyping = !!(typingNames && typingNames.length > 0);
  const statusText = someoneTyping
    ? (isDM
        ? "escribiendo"
        : (typingNames!.length === 1
            ? `${typingNames![0]} está escribiendo`
            : `${typingNames!.slice(0, 2).join(", ")}${typingNames!.length > 2 ? ` +${typingNames!.length - 2}` : ""} están escribiendo`))
    : online
    ? "En línea"
    : isDM
    ? (lastSeen ? `Última vez ${formatLastSeen(lastSeen, null).toLowerCase()}` : "Desconectado")
    : "Grupo";

  const startDirectCall = async () => {
    if (!isDM || !otherId) return startGroupCall();
    setStarting(true);
    try {
      const r = await fetch("/api/videollamadas/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: otherId, grupo_id: grupo.id })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      const videollamadaId = d.videollamada.id;
      // Also emit socket ring in case REST emit missed target's user room timing
      const socket = getSocket();
      socket.emit("videollamada:ring", {
        videollamadaId,
        targetUserIds: [otherId],
        nombreSala: grupo.otro_usuario?.nombre || grupo.nombre
      });

      setOutCall({ videollamadaId, status: "ringing" });

      const onAccepted = (data: any) => {
        if (data.videollamadaId !== videollamadaId) return;
        setOutCall(null);
        router.push(`/videollamada/${videollamadaId}`);
        socket.off("videollamada:accepted", onAccepted);
        socket.off("videollamada:declined", onDeclined);
      };
      const onDeclined = (data: any) => {
        if (data.videollamadaId !== videollamadaId) return;
        setOutCall({ videollamadaId, status: "declined" });
        toast.error("Llamada rechazada");
        setTimeout(() => setOutCall(null), 2500);
        socket.off("videollamada:accepted", onAccepted);
        socket.off("videollamada:declined", onDeclined);
      };
      socket.on("videollamada:accepted", onAccepted);
      socket.on("videollamada:declined", onDeclined);

      // Timeout 45s
      setTimeout(() => {
        setOutCall((cur) => {
          if (cur && cur.videollamadaId === videollamadaId && cur.status === "ringing") {
            socket.emit("videollamada:cancel", { videollamadaId, targetUserIds: [otherId] });
            toast.error("No contestó");
            setTimeout(() => setOutCall(null), 1500);
            return { videollamadaId, status: "timeout" };
          }
          return cur;
        });
      }, 45000);
    } catch (e: any) {
      toast.error(e.message);
      setOutCall(null);
    } finally {
      setStarting(false);
    }
  };

  const startGroupCall = async () => {
    setStarting(true);
    try {
      const r = await fetch("/api/videollamadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupo_id: grupo.id, nombre_sala: grupo.nombre })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      // Redundancia (espejo del 1-1): ademas del ring por REST que hace el backend,
      // emitimos ring por socket a los miembros por si alguno estaba reconectando justo
      // en el instante del REST. El modal dedupea por videollamadaId, no molesta.
      const socket = getSocket();
      const targets: string[] = Array.isArray(d.target_user_ids) ? d.target_user_ids : [];
      if (targets.length) {
        socket.emit("videollamada:ring", { videollamadaId: d.videollamada.id, targetUserIds: targets, nombreSala: grupo.nombre });
      }
      router.push(`/videollamada/${d.videollamada.id}`);
    } catch (e: any) {
      toast.error(e.message);
      setStarting(false);
    }
  };

  const cancelOutgoing = () => {
    if (outCall?.videollamadaId && otherId) {
      getSocket().emit("videollamada:cancel", { videollamadaId: outCall.videollamadaId, targetUserIds: [otherId] });
    }
    setOutCall(null);
  };

  // Eliminar el chat para todos (solo creador/admin → headerAdmin).
  const canDelete = headerAdmin && !isDM && grupo.tipo !== "copilot";
  const deleteChat = async () => {
    if (!canDelete || deleting) return;
    if (typeof window !== "undefined" && !window.confirm("¿Eliminar este chat para todos? No se puede deshacer.")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/chat/grupos/${grupo.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo eliminar");
      toast.success("Chat eliminado");
      setMenuOpen(false);
      router.push("/chat");
    } catch (e: any) {
      toast.error(e.message || "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="h-18 px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3 glass-header z-10">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Volver a los chats"
            className="lg:hidden shrink-0 h-9 w-9 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-neutral-600 dark:text-white/80 transition"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
        <div className="relative flex-shrink-0">
          {grupo.tipo === "copilot" ? (
            <CoPilotAvatar size={44} />
          ) : (
            <div className="h-11 w-11 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-display font-bold text-sm ring-2 ring-white/60 dark:ring-white/15 shadow-[0_4px_14px_rgba(255,90,140,0.25)]">
              {grupoFoto ? (
                <img src={grupoFoto} alt={grupoNombre} className="h-full w-full object-cover" />
              ) : isDM ? initialsOf(grupo.nombre) : <Hash className="h-5 w-5" />}
            </div>
          )}
          {online && (
            <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-400 border-2 border-white dark:border-bg-dark" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="font-display font-black text-base truncate">{grupoNombre}</div>
            {headerAdmin && !isDM && (
              <button onClick={() => setEditOpen(true)} title="Editar nombre y foto" className="shrink-0 h-6 w-6 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center text-neutral-400 hover:text-brand-orange transition"><Pencil className="h-3.5 w-3.5" /></button>
            )}
          </div>
          <div className="text-[11px] text-neutral-500 flex items-center gap-1.5">
            {online && !someoneTyping && <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />}
            {someoneTyping ? (
              <span className="inline-flex items-center gap-1.5 italic font-semibold text-brand-orange typing-text">
                <span>{statusText}</span>
                <TypingDots size="sm" />
              </span>
            ) : (
              <span>{statusText}</span>
            )}
            {isDM && grupo.otro_usuario?.departamento && !someoneTyping && (
              <span>· {grupo.otro_usuario.departamento}</span>
            )}
          </div>
        </div>
        {grupo.tipo === "tarea" ? (
          <div className="flex items-center gap-2">
            {tareaInfo?.oportunidad_id && (
              <button
                onClick={() => router.push(`/oportunidades/${tareaInfo.oportunidad_id}`)}
                title={tareaInfo.oportunidad_nombre || "Ir a la oportunidad"}
                className="h-10 px-4 rounded-full bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-2 shadow hover:scale-[1.03] transition active:scale-95"
              >
                <Briefcase className="h-4 w-4" strokeWidth={2.5} />
                Oportunidad
              </button>
            )}
            <button
              onClick={() => { if (tareaInfo?.tarea_id) router.push(`/tareas?id=${tareaInfo.tarea_id}`); }}
              disabled={!tareaInfo?.tarea_id}
              title="Ver la tarea en /tareas"
              className="h-10 px-4 rounded-full border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200 text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-neutral-50 dark:hover:bg-white/5 transition active:scale-95 disabled:opacity-50"
            >
              <CheckSquare className="h-4 w-4" strokeWidth={2.5} />
              Ver tarea
            </button>
          </div>
        ) : (
          <button
            onClick={startDirectCall}
            disabled={starting}
            className="h-10 px-4 rounded-full bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-2 shadow hover:scale-[1.03] transition active:scale-95 disabled:opacity-60"
          >
            <Video className="h-4 w-4" strokeWidth={2.5} />
            Videollamada
          </button>
        )}
        {!isDM && grupo.tipo !== "copilot" && (
          <button
            onClick={() => setMembersOpen(true)}
            title="Miembros del grupo"
            className="h-10 w-10 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center transition"
          >
            <Users className="h-5 w-5 text-neutral-500" />
          </button>
        )}
        {canDelete ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Opciones del chat"
              className="h-10 w-10 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center transition"
            >
              <MoreHorizontal className="h-5 w-5 text-neutral-500" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-12 z-[61] w-56 rounded-2xl bg-white dark:bg-bg-dark border border-black/5 dark:border-white/10 shadow-2xl overflow-hidden py-1">
                  <button
                    onClick={() => { setMenuOpen(false); setInfoOpen(true); }}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left text-sm hover:bg-neutral-50 dark:hover:bg-white/5 transition"
                  >
                    <Info className="h-4 w-4 text-neutral-500" />
                    <span className="font-semibold">Información y archivos</span>
                  </button>
                  <button
                    onClick={deleteChat}
                    disabled={deleting}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left text-sm text-brand-red hover:bg-red-50 dark:hover:bg-red-500/10 transition disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="font-semibold">{deleting ? "Eliminando…" : "Eliminar chat"}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => setInfoOpen(true)}
            title="Información y archivos"
            className="h-10 w-10 rounded-full hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center transition"
          >
            <MoreHorizontal className="h-5 w-5 text-neutral-500" />
          </button>
        )}
      </div>

      <OutgoingCallOverlay
        open={outCall !== null}
        target={grupo.otro_usuario ? { id: grupo.otro_usuario.id, nombre: grupo.otro_usuario.nombre, foto_perfil_url: grupo.otro_usuario.foto_perfil_url } : null}
        status={outCall?.status || "ringing"}
        onCancel={cancelOutgoing}
      />

      <ChatInfoPanel
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        grupoId={grupo.id}
        grupoNombre={grupo.nombre}
      />

      <MembersModal open={membersOpen} onClose={() => setMembersOpen(false)} grupoId={grupo.id} grupoNombre={grupoNombre} />
      <EditGroupModal open={editOpen} onClose={() => setEditOpen(false)} grupoId={grupo.id} nombre={grupoNombre} avatarUrl={grupoFoto} onSaved={(g) => setOverride((o) => ({ ...o, ...g }))} />
    </>
  );
}
