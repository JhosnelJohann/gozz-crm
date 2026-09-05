"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, Star, VolumeX, Volume2, Copy, Link2, Play, CheckCircle2,
  ListTree, Plus, Trash2, Users, Flag, Sparkles, Paperclip, MessageSquareMore,
  Pause, PanelLeftClose, PanelLeftOpen, ExternalLink, Pencil, Ban
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/auth-user";
import {
  resolverVinculo, paraGuardar, oportunidadesElegibles, type ContactoLite,
} from "@/lib/tareas-contacto";
import { DateField } from "@/components/ui/DateField";
import { useRouter } from "next/navigation";
import { ContactoDeTarea } from "./ContactoDeTarea";
import { TaskChatInline } from "./TaskChatInline";
import { TaskFiles } from "./TaskFiles";
import { TaskFilesStaging } from "./TaskFilesStaging";
import { TaskSubtasks } from "./TaskSubtasks";
import { TemplatePicker, type Plantilla } from "./TemplatePicker";

export interface TareaDetalle {
  id?: string;
  titulo: string;
  descripcion?: string | null;
  responsable_id?: string | null;
  observadores?: string[];
  prioridad: "baja" | "normal" | "alta" | "urgente";
  estado?: "pendiente" | "en_progreso" | "completada" | "cancelada";
  fecha_limite?: string | null;
  oportunidad_id?: string | null;
  contacto_id?: string | null;
  subtarea_de?: string | null;
  checklist?: { texto: string; hecho?: boolean }[];
  es_favorito?: boolean;
  mute_audio?: boolean;
  numero_tarea?: number;
  propietario_nombre?: string | null;
  propietario_foto?: string | null;
  created_at?: string;
  updated_at?: string;
  chat_grupo_id?: string | null;
}

interface UserLite { id: string; nombre: string; foto_perfil_url: string | null; }
/** `contacto_id` y `contacto_nombre` ya vienen en la respuesta de `GET /api/oportunidades`. */
interface OportunidadLite { id: string; nombre_caso: string; contacto_id: string | null; contacto_nombre: string | null; }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (tarea: any) => void;
  tareaId?: string | null;
  prefill?: Partial<TareaDetalle>;
  oportunidadIdLock?: string | null;
  /**
   * El contacto desde cuya ficha se abre el modal. Gemelo de `oportunidadIdLock`: fija el cliente
   * y acota el desplegable de oportunidades a las suyas. Lleva el nombre porque hay que pintarlo,
   * y quien abre el modal ya lo tiene cargado.
   */
  contactoLock?: ContactoLite | null;
}

const PRIORIDADES = [
  { v: "baja", label: "Baja", color: "#FFB51C" },
  { v: "normal", label: "Normal", color: "#43A847" },
  { v: "alta", label: "Alta", color: "#5750E8" },
  { v: "urgente", label: "Urgente", color: "#E53935" }
] as const;

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Fecha por defecto de una tarea nueva: HOY a las 6:00 PM. Si hoy ya pasaron las 6 PM,
// usa mañana a las 6 PM para que el default nunca quede en el pasado (evita bloquear "Crear").
// Formato local "YYYY-MM-DDTHH:mm" (el mismo que usa fecha_limite en el form).
function defaultFechaLimite(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
}

function SectionLabel({ icon: Icon, children, right }: { icon?: any; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <label className="text-[10px] font-ui uppercase tracking-[0.1em] text-neutral-500 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
        {children}
      </label>
      {right}
    </div>
  );
}

export function TaskModal({ open, onClose, onSaved, tareaId: initialTareaId, prefill, oportunidadIdLock, contactoLock }: Props) {
  const [tareaId, setTareaId] = useState<string | null>(initialTareaId || null);
  const editing = !!tareaId;
  const [origFecha, setOrigFecha] = useState("");
  const [origResponsable, setOrigResponsable] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Adjuntos seleccionados ANTES de crear la tarea (no hay id todavía): se suben tras crearla.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingPending, setUploadingPending] = useState(false);
  const [usuarios, setUsuarios] = useState<UserLite[]>([]);
  const [oportunidades, setOportunidades] = useState<OportunidadLite[]>([]);
  /**
   * El contacto elegido A MANO. Se guarda aparte de `form.contacto_id` a propósito: mientras hay
   * una oportunidad puesta manda el suyo, y al quitarla hay que poder devolver éste en vez de
   * haberlo perdido. Quién gana lo decide `resolverVinculo`, no este estado.
   */
  const [contactoElegido, setContactoElegido] = useState<ContactoLite | null>(null);
  const [padre, setPadre] = useState<any | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  // Edicion inline (via lapiz) de titulo y descripcion en una tarea ya creada
  const [editTitulo, setEditTitulo] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [origTitulo, setOrigTitulo] = useState("");
  const [origDesc, setOrigDesc] = useState("");
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Garantizar scroll con rueda dentro del panel de detalles aunque el modal
  // o framer-motion absorban eventos. Se engancha como native listener con
  // passive:false para poder usar preventDefault.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Si el target está dentro de un popup (select/datepicker) con su propio scroll, dejar al browser
      const target = e.target as HTMLElement;
      if (target.closest('[data-scroll-ignore]')) return;
      // Solo actuar si hay algo que scrollear
      const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const canScrollUp = el.scrollTop > 0;
      if ((e.deltaY > 0 && canScrollDown) || (e.deltaY < 0 && canScrollUp)) {
        el.scrollTop += e.deltaY;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); };
  }, [open, tareaId, loading]);
  const [form, setForm] = useState<TareaDetalle>({
    titulo: "",
    descripcion: "",
    prioridad: "normal",
    estado: "pendiente",
    fecha_limite: defaultFechaLimite(),
    observadores: [],
    checklist: [],
    responsable_id: null,
    oportunidad_id: oportunidadIdLock ?? null,
    ...prefill
  });

  // Auto-alto del textarea de descripción: crece con el contenido hasta ~8 líneas (max-h-40) y
  // luego scrollea interno. Mismo patrón que el composer del chat.
  const descRef = useRef<HTMLTextAreaElement>(null);
  const autoGrowDesc = () => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px"; // 160px = max-h-40 (~8 líneas)
  };
  useEffect(() => { autoGrowDesc(); }, [form.descripcion, editDesc]);

  // Resetear el id interno CADA VEZ que se abre el modal (no solo cuando cambia el prop).
  // Sin esto, tras crear una tarea el `tareaId` interno (puesto en save()) persistía y "Nueva
  // tarea" reabría en modo edición de esa tarea en vez de un formulario en blanco.
  useEffect(() => { if (open) setTareaId(initialTareaId || null); }, [open, initialTareaId]);

  // Limpiar adjuntos en cola al cerrar (evita arrastrarlos a la próxima tarea).
  useEffect(() => { if (!open) setPendingFiles([]); }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/chat/contactos").then((r) => r.json()).then((d) => setUsuarios(d.contactos || []));
    fetch("/api/oportunidades").then((r) => r.json()).then((d) => setOportunidades(d.oportunidades || []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (tareaId) {
      let ignore = false;
      setLoading(true);
      fetch(`/api/tareas/${tareaId}`)
        .then((r) => r.json())
        .then((d) => {
          if (ignore) return; // respuesta de una tarea que ya no está abierta: ignorar
          const t = d.tarea;
          if (!t) return;
          setPadre(d.padre || null);
          setForm({
            id: t.id,
            titulo: t.titulo,
            descripcion: t.descripcion || "",
            responsable_id: t.responsable_id,
            observadores: Array.isArray(t.observadores) ? t.observadores : [],
            prioridad: t.prioridad,
            estado: t.estado,
            fecha_limite: toLocalInput(t.fecha_limite),
            oportunidad_id: t.oportunidad_id,
            contacto_id: t.contacto_id,
            subtarea_de: t.subtarea_de,
            checklist: Array.isArray(t.checklist) ? t.checklist : [],
            es_favorito: t.es_favorito,
            mute_audio: t.mute_audio,
            numero_tarea: t.numero_tarea,
            propietario_nombre: t.propietario_nombre,
            propietario_foto: t.propietario_foto,
            created_at: t.created_at,
            updated_at: t.updated_at,
            chat_grupo_id: t.chat_grupo_id
          });
          // El nombre viene resuelto en la respuesta (`SELECT_BASE` de la API), así que no hay que
          // ir a buscarlo para poder pintarlo.
          setContactoElegido(t.contacto_id ? { id: t.contacto_id, nombre: t.contacto_nombre || "" } : null);
          setOrigFecha(toLocalInput(t.fecha_limite));
          setOrigResponsable(t.responsable_id || "");
          setOrigTitulo(t.titulo || "");
          setOrigDesc(t.descripcion || "");
          setEditTitulo(false);
          setEditDesc(false);
        })
        .finally(() => { if (!ignore) setLoading(false); });
      return () => { ignore = true; };
    } else {
      // Tarea NUEVA: resetear a un formulario en blanco (+ prefill / oportunidad bloqueada).
      // Limpia los datos de una tarea creada antes para que "Nueva tarea" abra vacío.
      setPadre(null);
      setPendingFiles([]);
      setEditTitulo(false);
      setEditDesc(false);
      setLoading(false);
      setContactoElegido(prefill?.contacto_id ? { id: prefill.contacto_id, nombre: "" } : null);
      setForm({
        titulo: "",
        descripcion: "",
        prioridad: "normal",
        estado: "pendiente",
        fecha_limite: defaultFechaLimite(),
        observadores: [],
        checklist: [],
        responsable_id: null,
        ...prefill,
        oportunidad_id: oportunidadIdLock ?? prefill?.oportunidad_id ?? null
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tareaId]);

  const borderColor = useMemo(() => PRIORIDADES.find((p) => p.v === form.prioridad)?.color || "#5C6670", [form.prioridad]);

  // ── De quién es esta tarea ────────────────────────────────────────────────────────────────
  // Se calcula, no se guarda: si el contacto viviera en `form` habría que acordarse de
  // recalcularlo en cada `onChange` de la oportunidad, y ahí es donde las dos mitades divergen.
  const oportunidadElegida = oportunidades.find((o) => o.id === form.oportunidad_id) ?? null;
  const entradaVinculo = {
    contactoFijadoPorLaPantalla: contactoLock ?? null,
    contactoElegido,
    oportunidad: oportunidadElegida,
    // La lista se pide al abrir el modal: hay un instante en que el id está puesto y la lista aún
    // no ha llegado. Y al abrir una tarea vieja su oportunidad puede no venir en la lista.
    oportunidadIdSinResolver: form.oportunidad_id ?? null,
  };
  const vinculo = resolverVinculo(entradaVinculo);
  // Con el contacto fijado, solo sus casos: si no, desde la ficha de una persona se podría elegir
  // el caso de otra y guardar una tarea que dice pertenecer a las dos.
  const oportunidadesOfrecidas = oportunidadesElegibles(oportunidades, contactoLock?.id ?? null);

  if (!open) return null;

  const validateDate = (): string | null => {
    if (!form.fecha_limite) return null;
    const d = new Date(form.fecha_limite);
    if (isNaN(d.getTime())) return "Fecha inválida";
    const nowMinusMinute = new Date(Date.now() - 60000);
    if (d < nowMinusMinute) return "La fecha debe ser igual o posterior a hoy";
    return null;
  };

  const save = async () => {
    if (!form.titulo || form.titulo.trim().length < 2) { toast.error("Título requerido"); return; }
    const dateError = validateDate();
    if (dateError) { toast.error(dateError); return; }

    // El cliente y la oportunidad salen del MISMO cálculo que la pantalla enseña. `null` significa
    // que el par es contradictorio; el servidor lo rechaza igual, pero no se manda a propósito.
    const vinculoAGuardar = paraGuardar(entradaVinculo);
    if (!vinculoAGuardar) {
      toast.error("Esta tarea no puede ser de un cliente y de la oportunidad de otro.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion || null,
        responsable_id: form.responsable_id || null,
        observadores: form.observadores || [],
        prioridad: form.prioridad,
        // estado NO se envia al editar: lo gestionan los botones INICIAR/COMPLETAR (setEstado).
        // Enviarlo aqui hacia que GUARDAR pisara el estado y revirtiera "completada" -> "pendiente".
        fecha_limite: form.fecha_limite ? new Date(form.fecha_limite).toISOString() : null,
        oportunidad_id: vinculoAGuardar.oportunidad_id,
        contacto_id: vinculoAGuardar.contacto_id,
        subtarea_de: form.subtarea_de || null,
        checklist: form.checklist || []
      };
      if (!editing) payload.estado = form.estado;
      const url = editing ? `/api/tareas/${tareaId}` : "/api/tareas";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "Error al guardar");
      toast.success(editing ? "Tarea actualizada" : "Tarea creada");

      // Subir adjuntos seleccionados antes de crear (la tarea ya tiene id). Secuencial: backend = upload.single.
      const newId = d.tarea?.id;
      if (!editing && newId && pendingFiles.length > 0) {
        setUploadingPending(true);
        let okCount = 0;
        for (const file of pendingFiles) {
          try {
            const fd = new FormData();
            fd.append("file", file);
            const ur = await fetch(`/api/tareas/${newId}/archivos`, { method: "POST", body: fd });
            if (ur.ok) okCount++;
          } catch { /* contar como fallo abajo */ }
        }
        setUploadingPending(false);
        if (okCount > 0) toast.success(`${okCount} adjunto(s) subido(s)`);
        if (okCount < pendingFiles.length) toast.error(`${pendingFiles.length - okCount} adjunto(s) no se subieron`);
        setPendingFiles([]);
      }

      onSaved?.(d.tarea);
      // Tras crear, cambiar a modo edición para ver chat y archivos inmediatamente
      if (!editing && newId) setTareaId(newId);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  // Guardar SOLO la fecha de vencimiento (editable aunque la tarea ya este creada).
  const saveFecha = async () => {
    if (!tareaId) return;
    const err = validateDate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/tareas/${tareaId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha_limite: form.fecha_limite ? new Date(form.fecha_limite).toISOString() : null })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "Error al guardar");
      toast.success("Fecha actualizada");
      setOrigFecha(form.fecha_limite || "");
      onSaved?.(d.tarea);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  const saveResponsable = async () => {
    if (!tareaId) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/tareas/${tareaId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsable_id: form.responsable_id || null })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "Error al guardar");
      toast.success("Responsable actualizado");
      setOrigResponsable(form.responsable_id || "");
      onSaved?.(d.tarea);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  // Prioridad y observadores: editables aunque la tarea esté creada. Al editar guardan al instante
  // (igual que fecha/responsable); al crear solo actualizan el form (se persiste al crear).
  const savePrioridad = async (v: TareaDetalle["prioridad"]) => {
    setForm((f) => ({ ...f, prioridad: v }));
    if (!tareaId) return;
    try {
      const r = await fetch(`/api/tareas/${tareaId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prioridad: v })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "Error");
      toast.success("Prioridad actualizada");
      onSaved?.(d.tarea);
    } catch (e: any) { toast.error(e.message || "No se pudo cambiar la prioridad"); }
  };

  const toggleObservador = async (uid: string) => {
    const curr = form.observadores || [];
    const next = curr.includes(uid) ? curr.filter((x) => x !== uid) : [...curr, uid];
    setForm((f) => ({ ...f, observadores: next }));
    if (!tareaId) return;
    try {
      const r = await fetch(`/api/tareas/${tareaId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observadores: next })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "Error");
      onSaved?.(d.tarea);
    } catch (e: any) { toast.error(e.message || "No se pudo actualizar observadores"); }
  };

  // Guardar SOLO titulo o descripcion (editables via lapiz aunque la tarea ya este creada).
  const saveCampo = async (campo: "titulo" | "descripcion") => {
    if (!tareaId) return;
    if (campo === "titulo" && form.titulo.trim().length < 2) { toast.error("Título requerido (mín. 2 caracteres)"); return; }
    setSaving(true);
    try {
      const value = campo === "titulo" ? form.titulo.trim() : (form.descripcion || null);
      const r = await fetch(`/api/tareas/${tareaId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: value })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.[0]?.message || d.error || "Error al guardar");
      if (campo === "titulo") {
        const tt = form.titulo.trim();
        setForm((f) => ({ ...f, titulo: tt }));
        setOrigTitulo(tt);
        setEditTitulo(false);
        toast.success("Título actualizado");
      } else {
        setOrigDesc(form.descripcion || "");
        setEditDesc(false);
        toast.success("Descripción actualizada");
      }
      onSaved?.(d.tarea);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  const cancelCampo = (campo: "titulo" | "descripcion") => {
    if (campo === "titulo") { setForm((f) => ({ ...f, titulo: origTitulo })); setEditTitulo(false); }
    else { setForm((f) => ({ ...f, descripcion: origDesc })); setEditDesc(false); }
  };

  const setEstado = async (nuevo: TareaDetalle["estado"]) => {
    if (!tareaId) { setForm({ ...form, estado: nuevo }); return; }
    const r = await fetch(`/api/tareas/${tareaId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevo })
    });
    if (r.ok) {
      setForm({ ...form, estado: nuevo });
      toast.success(nuevo === "completada" ? "Completada" : `Estado: ${nuevo}`);
      const d = await r.json();
      onSaved?.(d.tarea);
    }
  };

  const toggleFavorito = async () => {
    if (!tareaId) { setForm({ ...form, es_favorito: !form.es_favorito }); return; }
    const r = await fetch(`/api/tareas/${tareaId}/favorito`, { method: "POST" });
    const d = await r.json();
    setForm({ ...form, es_favorito: d.es_favorito });
  };

  const toggleMute = async () => {
    if (!tareaId) { setForm({ ...form, mute_audio: !form.mute_audio }); return; }
    const r = await fetch(`/api/tareas/${tareaId}/mute`, { method: "POST" });
    const d = await r.json();
    setForm({ ...form, mute_audio: d.mute_audio });
  };

  const clonar = async () => {
    if (!tareaId) return;
    const r = await fetch(`/api/tareas/${tareaId}/clonar`, { method: "POST" });
    if (r.ok) {
      toast.success("Tarea clonada");
      const d = await r.json();
      onSaved?.(d.tarea);
      setTareaId(d.tarea.id);
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/tareas?id=${tareaId || "nueva"}`;
    try { await navigator.clipboard.writeText(url); toast.success("Enlace copiado"); } catch { toast.error("No se pudo copiar"); }
  };

  const applyTemplate = (p: Plantilla) => {
    setForm((prev) => ({
      ...prev,
      titulo: prev.titulo || p.titulo_tpl,
      descripcion: prev.descripcion || p.descripcion_tpl || "",
      prioridad: p.prioridad,
      responsable_id: prev.responsable_id || p.responsable_default_id,
      observadores: prev.observadores?.length ? prev.observadores : (p.observadores_default || []),
      checklist: prev.checklist?.length ? prev.checklist : (p.checklist_default || []),
      fecha_limite: prev.fecha_limite || (() => {
        if (p.dias_vencimiento <= 0 && p.horas_vencimiento <= 0) return "";
        const ms = (p.dias_vencimiento * 86400 + p.horas_vencimiento * 3600) * 1000;
        return toLocalInput(new Date(Date.now() + ms).toISOString());
      })()
    }));
    toast.success(`Plantilla "${p.nombre}" aplicada`);
  };

  const addChecklist = () => setForm({ ...form, checklist: [...(form.checklist || []), { texto: "", hecho: false }] });
  const updateChecklist = (i: number, patch: Partial<{ texto: string; hecho: boolean }>) => {
    const next = [...(form.checklist || [])];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, checklist: next });
  };
  const removeChecklist = (i: number) => {
    const next = [...(form.checklist || [])];
    next.splice(i, 1);
    setForm({ ...form, checklist: next });
  };

  const dateError = validateDate();
  const done = form.estado === "completada";
  const cancelada = form.estado === "cancelada";
  const enProgreso = form.estado === "en_progreso";
  const readOnly = editing; // tarea creada: campos bloqueados

  const miembrosCount = 1 + (form.observadores?.length || 0) + (form.responsable_id && form.responsable_id !== form.propietario_nombre ? 1 : 0);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-2 md:p-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28, mass: 0.8 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-[28px] w-full max-w-[1280px] h-[94vh] overflow-hidden flex flex-col shadow-[0_32px_80px_-12px_rgba(0,0,0,0.5)] relative"
        >
          {/* Top priority bar */}
          <motion.div
            key={form.prioridad}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="h-1 origin-left shrink-0"
            style={{ backgroundColor: borderColor, boxShadow: `0 0 20px ${borderColor}60` }}
          />

          {/* Header global */}
          <div className="px-6 py-4 flex items-center gap-3 border-b border-neutral-100 shrink-0">
            <button onClick={() => setShowDetails((x) => !x)} title={showDetails ? "Ocultar detalles" : "Mostrar detalles"} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center text-neutral-500 lg:hidden">
              {showDetails ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>

            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-ui uppercase tracking-[0.12em] text-brand-orange">
                <Sparkles className="h-3 w-3" strokeWidth={2} />
                {editing && form.numero_tarea ? `Tarea · #${form.numero_tarea}` : "Nueva tarea"}
                {form.subtarea_de && <span className="text-neutral-400 font-normal normal-case">· Subtarea</span>}
              </div>
              <h2 className="font-display text-[20px] font-black leading-tight tracking-tight truncate">
                {form.titulo || (editing ? "Sin título" : "Crear nueva tarea")}
              </h2>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {!editing && <TemplatePicker onPick={applyTemplate} />}
              <IconBtn onClick={toggleFavorito} title={form.es_favorito ? "Quitar de favoritos" : "Favorito"}>
                <Star className={cn("h-[18px] w-[18px] transition-colors", form.es_favorito ? "text-brand-gold fill-brand-gold" : "text-neutral-400")} strokeWidth={1.8} />
              </IconBtn>
              <IconBtn onClick={toggleMute} title={form.mute_audio ? "Activar sonidos" : "Silenciar"}>
                {form.mute_audio
                  ? <VolumeX className="h-[18px] w-[18px] text-neutral-600" strokeWidth={1.8} />
                  : <Volume2 className="h-[18px] w-[18px] text-neutral-400" strokeWidth={1.8} />}
              </IconBtn>
              {editing && (
                <>
                  <IconBtn onClick={clonar} title="Clonar"><Copy className="h-[18px] w-[18px] text-neutral-500" strokeWidth={1.8} /></IconBtn>
                  <IconBtn onClick={copyLink} title="Copiar enlace"><Link2 className="h-[18px] w-[18px] text-neutral-500" strokeWidth={1.8} /></IconBtn>
                </>
              )}
              <IconBtn onClick={onClose} title="Cerrar" className="ml-1">
                <X className="h-[18px] w-[18px] text-neutral-500" strokeWidth={1.8} />
              </IconBtn>
            </div>
          </div>

          {/* Split body */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Panel izquierdo: detalles */}
            {showDetails && (
              <div
                className={cn(
                  "flex flex-col border-r border-neutral-100 shrink-0 bg-white overflow-hidden h-full",
                  "w-full lg:w-[540px]"
                )}
              >
                <div
                  ref={scrollRef}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 space-y-5"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                    {loading ? (
                      <div className="py-16 text-center text-neutral-400">
                        <Loader2 className="h-5 w-5 animate-spin inline" />
                      </div>
                    ) : (
                      <>
                        {/* Meta del creador */}
                        {editing && (form.propietario_nombre || form.created_at) && (
                          <div className="text-[11px] text-neutral-400 bg-neutral-50 rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap">
                            {form.propietario_nombre && (
                              <span className="inline-flex items-center gap-1.5">
                                {form.propietario_foto
                                  ? <img src={form.propietario_foto} alt="" className="h-5 w-5 rounded-full object-cover" />
                                  : <span className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-[8px] font-bold flex items-center justify-center">{form.propietario_nombre.trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span>}
                                Creador: <strong className="text-neutral-600">{form.propietario_nombre}</strong>
                              </span>
                            )}
                            {form.created_at && <span>· {new Date(form.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                            {form.updated_at && form.updated_at !== form.created_at && <span>· Modif. {new Date(form.updated_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                          </div>
                        )}

                        {/* Título */}
                        <div>
                          <SectionLabel right={editing && !editTitulo ? (
                            <button type="button" onClick={() => setEditTitulo(true)} title="Editar título" className="inline-flex items-center gap-1 text-[10px] font-ui font-bold uppercase tracking-wider text-brand-orange hover:text-brand-gold transition-colors">
                              <Pencil className="h-3 w-3" strokeWidth={2.2} /> Editar
                            </button>
                          ) : undefined}>Título *</SectionLabel>
                          <input
                            autoFocus={!editing}
                            value={form.titulo}
                            onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                            readOnly={readOnly && !editTitulo}
                            placeholder="Llamar al cliente..."
                            className={cn("w-full h-12 px-4 rounded-2xl border text-[15px] outline-none transition-all", (readOnly && !editTitulo) ? "bg-neutral-50 border-neutral-200 text-neutral-700 cursor-default" : "bg-white border-neutral-200 hover:border-neutral-300 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange")}
                          />
                          {editTitulo && (
                            <div className="flex gap-2 mt-2">
                              <motion.button initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.97 }}
                                onClick={() => saveCampo("titulo")} disabled={saving}
                                className="h-9 px-4 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />}
                                Guardar
                              </motion.button>
                              <button type="button" onClick={() => cancelCampo("titulo")} disabled={saving}
                                className="h-9 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors">
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Descripción */}
                        <div>
                          <SectionLabel right={editing && !editDesc ? (
                            <button type="button" onClick={() => setEditDesc(true)} title="Editar descripción" className="inline-flex items-center gap-1 text-[10px] font-ui font-bold uppercase tracking-wider text-brand-orange hover:text-brand-gold transition-colors">
                              <Pencil className="h-3 w-3" strokeWidth={2.2} /> Editar
                            </button>
                          ) : undefined}>Descripción</SectionLabel>
                          {(readOnly && !editDesc) ? (
                            // Lectura: caja scrollable (~8 líneas). data-scroll-ignore/lenis-prevent para
                            // que la rueda desplace el texto y no el modal (como en el textarea de edición).
                            <div
                              data-scroll-ignore
                              data-lenis-prevent
                              className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-200 text-sm text-neutral-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto overscroll-contain"
                            >
                              {form.descripcion || <span className="text-neutral-400">Sin descripcion</span>}
                            </div>
                          ) : (
                            <>
                              <textarea
                                ref={descRef}
                                data-scroll-ignore
                                data-lenis-prevent
                                value={form.descripcion || ""}
                                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                                rows={2}
                                placeholder="Detalles, contexto, pasos"
                                className="w-full px-4 py-3 rounded-2xl bg-white border border-neutral-200 text-sm outline-none resize-none max-h-40 overflow-y-auto overscroll-contain transition-all hover:border-neutral-300 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange"
                              />
                              {editDesc && (
                                <div className="flex gap-2 mt-2">
                                  <motion.button initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.97 }}
                                    onClick={() => saveCampo("descripcion")} disabled={saving}
                                    className="h-9 px-4 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />}
                                    Guardar
                                  </motion.button>
                                  <button type="button" onClick={() => cancelCampo("descripcion")} disabled={saving}
                                    className="h-9 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors">
                                    Cancelar
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* Prioridad + fecha */}
                        <div className="grid grid-cols-1 gap-4">
                          <div>
                            <SectionLabel icon={Flag}>Prioridad</SectionLabel>
                            <div className="flex gap-1.5">
                              {PRIORIDADES.map((p) => (
                                <motion.button
                                  key={p.v}
                                  type="button"
                                  onClick={() => savePrioridad(p.v)}
                                  whileHover={{ scale: 1.03 }}
                                  whileTap={{ scale: 0.96 }}
                                  className={cn(
                                    "flex-1 h-10 rounded-xl text-[10px] font-ui font-bold uppercase tracking-[0.1em] transition-all border",
                                    form.prioridad === p.v
                                      ? "text-white shadow-md border-transparent"
                                      : "bg-white text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 border-neutral-200"
                                  )}
                                  style={form.prioridad === p.v ? { backgroundColor: p.color, boxShadow: `0 6px 18px -6px ${p.color}80` } : undefined}
                                >
                                  {p.label}
                                </motion.button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <SectionLabel>Vence (fecha y hora)</SectionLabel>
                            <DateField
                              value={form.fecha_limite || ""}
                              onChange={(v) => setForm({ ...form, fecha_limite: v })}
                              placeholder="Selecciona fecha y hora"
                              withTime
                              minDate={new Date()}
                            />
                            {editing && form.fecha_limite !== origFecha && (
                              <motion.button
                                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                                whileTap={{ scale: 0.97 }}
                                onClick={saveFecha}
                                disabled={saving || !!dateError}
                                className="mt-2 h-9 px-4 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />}
                                Guardar fecha
                              </motion.button>
                            )}
                            {dateError && (
                              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1.5 text-[11px] text-brand-red font-medium">
                                {dateError}
                              </motion.div>
                            )}
                          </div>
                        </div>

                        {/* Responsable + Oportunidad */}
                        <div className="grid grid-cols-1 gap-4">
                          <div>
                            <SectionLabel>Responsable</SectionLabel>
                            <select
                              value={form.responsable_id || ""}
                              onChange={(e) => setForm({ ...form, responsable_id: e.target.value || null })}
                              className="w-full h-12 px-4 rounded-2xl bg-white border border-neutral-200 text-sm outline-none transition-all hover:border-neutral-300 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange"
                            >
                              <option value="">(yo)</option>
                              {usuarios.map((u) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
                            </select>
                            {editing && (form.responsable_id || "") !== origResponsable && (
                              <motion.button
                                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                                whileTap={{ scale: 0.97 }}
                                onClick={saveResponsable}
                                disabled={saving}
                                className="mt-2 h-9 px-4 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />}
                                Guardar responsable
                              </motion.button>
                            )}
                          </div>
                          <div>
                            <SectionLabel>Cliente</SectionLabel>
                            <ContactoDeTarea
                              contactoId={vinculo.contactoId}
                              contactoNombre={vinculo.contactoNombre}
                              editable={vinculo.editable}
                              explicacion={vinculo.explicacion}
                              readOnly={readOnly}
                              onElegir={setContactoElegido}
                            />
                            {vinculo.contactoId && (
                              <button
                                type="button"
                                onClick={() => { onClose(); router.push(`/contactos/${vinculo.contactoId}`); }}
                                className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition-colors"
                              >
                                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /> Ver el contacto
                              </button>
                            )}
                          </div>
                          <div>
                            <SectionLabel>Oportunidad</SectionLabel>
                            <select
                              disabled={readOnly || !!oportunidadIdLock}
                              value={form.oportunidad_id || ""}
                              onChange={(e) => setForm({ ...form, oportunidad_id: e.target.value || null })}
                              className="w-full h-12 px-4 rounded-2xl bg-white border border-neutral-200 text-sm outline-none transition-all hover:border-neutral-300 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange disabled:opacity-60"
                            >
                              <option value="">(sin oportunidad)</option>
                              {oportunidadesOfrecidas.map((o) => (<option key={o.id} value={o.id}>{o.nombre_caso}</option>))}
                            </select>
                            {form.oportunidad_id && (
                              <button
                                type="button"
                                onClick={() => { onClose(); router.push(`/oportunidades/${form.oportunidad_id}`); }}
                                className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition-colors"
                              >
                                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /> Ver en la oportunidad
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Observadores */}
                        <div>
                          <SectionLabel icon={Users}>Observadores</SectionLabel>
                          <div className="flex flex-wrap gap-1.5">
                            {usuarios.map((u, idx) => {
                              const selected = (form.observadores || []).includes(u.id);
                              return (
                                <motion.button
                                  key={u.id}
                                  type="button"
                                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: Math.min(0.02 * idx, 0.25) }}
                                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                                  onClick={() => toggleObservador(u.id)}
                                  className={cn(
                                    "px-3 h-8 rounded-full text-[11px] font-ui font-semibold flex items-center gap-1.5 transition-all border",
                                    selected ? "bg-brand-orange text-white border-brand-orange shadow-md shadow-brand-orange/25" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300 hover:text-neutral-700"
                                  )}
                                >
                                  {u.foto_perfil_url
                                    ? <img src={u.foto_perfil_url} className="h-4 w-4 rounded-full object-cover" alt="" />
                                    : <span className={cn("h-4 w-4 rounded-full text-white text-[7px] font-bold flex items-center justify-center", selected ? "bg-white/20" : "bg-gradient-to-br from-brand-orange to-brand-gold")}>{initialsOf(u.nombre)}</span>
                                  }
                                  {u.nombre.split(" ")[0]}
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Checklist */}
                        <div>
                          <SectionLabel
                            icon={ListTree}
                            right={
                              <button type="button" disabled={readOnly}
                                onClick={addChecklist} className="text-[11px] font-ui font-bold uppercase tracking-wider text-brand-orange hover:text-brand-gold flex items-center gap-1 transition-colors">
                                <Plus className="h-3 w-3" strokeWidth={2.5} /> Añadir
                              </button>
                            }
                          >Checklist</SectionLabel>
                          <div className="space-y-1.5">
                            <AnimatePresence initial={false}>
                              {(form.checklist || []).map((item, i) => (
                                <motion.div
                                  key={i}
                                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                                  className="flex items-center gap-2 overflow-hidden"
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!item.hecho}
                                    disabled={readOnly}
                                    onChange={(e) => updateChecklist(i, { hecho: e.target.checked })}
                                    className="h-4 w-4 rounded accent-brand-green cursor-pointer"
                                  />
                                  <input
                                    readOnly={readOnly}
                                    value={item.texto}
                                    onChange={(e) => updateChecklist(i, { texto: e.target.value })}
                                    placeholder="Paso..."
                                    className={cn(
                                      "flex-1 h-10 px-3 rounded-xl bg-white border border-neutral-200 text-sm outline-none transition-all hover:border-neutral-300 focus:ring-2 focus:ring-brand-orange/25 focus:border-brand-orange",
                                      item.hecho && "line-through text-neutral-400"
                                    )}
                                  />
                                  <button type="button" disabled={readOnly}
                                    onClick={() => removeChecklist(i)} className="h-9 w-9 rounded-xl hover:bg-red-50 text-neutral-400 hover:text-brand-red flex items-center justify-center transition-colors">
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                </motion.div>
                              ))}
                            </AnimatePresence>
                          </div>
                        </div>

                        {/* Archivos — disponible SIEMPRE. Al crear se quedan en cola y se suben al guardar. */}
                        <div>
                          <SectionLabel icon={Paperclip}>Archivos</SectionLabel>
                          {editing && tareaId ? (
                            <TaskFiles tareaId={tareaId} />
                          ) : (
                            <TaskFilesStaging files={pendingFiles} onChange={setPendingFiles} uploading={uploadingPending} />
                          )}
                        </div>

                        {editing && tareaId && (
                          <>
                            {/* Subtareas */}
                            <div>
                              <SectionLabel icon={ListTree}>Subtareas</SectionLabel>
                              <TaskSubtasks
                                tareaId={tareaId}
                                padre={padre}
                                usuarios={usuarios} oportunidadId={form.oportunidad_id} contactoId={form.contacto_id} defaultResponsableId={form.responsable_id} onChanged={() => onSaved?.(form as any)} onOpenTask={(id) => setTareaId(id)}
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
              </div>
            )}

            {/* Panel derecho: chat */}
            <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
              {editing && tareaId ? (
                <TaskChatInline tareaId={tareaId} tareaTitulo={form.titulo} miembrosCount={miembrosCount} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-center px-8 bg-gradient-to-b from-neutral-50 to-neutral-100">
                  <div>
                    <div className="h-16 w-16 mx-auto rounded-2xl bg-white shadow-md flex items-center justify-center mb-4 text-brand-orange">
                      <MessageSquareMore className="h-7 w-7" strokeWidth={1.5} />
                    </div>
                    <div className="font-display font-bold text-base mb-1">Chat de la tarea</div>
                    <div className="text-[13px] text-neutral-500 max-w-xs">
                      Crea la tarea para habilitar el chat con responsables y observadores.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-neutral-100 flex items-center gap-2 bg-white shrink-0">
            {editing && !done && !cancelada && (
              <>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setEstado(enProgreso ? "pendiente" : "en_progreso")}
                  className={cn(
                    "h-10 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors",
                    enProgreso ? "bg-brand-gold/20 text-amber-700 hover:bg-brand-gold/30" : "bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/15"
                  )}
                >
                  {enProgreso ? <Pause className="h-3.5 w-3.5" strokeWidth={2} /> : <Play className="h-3.5 w-3.5" strokeWidth={2} />}
                  {enProgreso ? "Pausar" : "Iniciar"}
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setEstado("completada")}
                  className="h-10 px-4 rounded-xl bg-brand-green/10 text-brand-green font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-green/15 flex items-center gap-1.5 transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Completar
                </motion.button>
                {/*
                  🔴 «Cancelar tarea», NUNCA «Eliminar». Decisión de Juan David (2026-09-02): quitar
                  una tarea es cancelarla. La fila se conserva y se puede reabrir desde aquí mismo o
                  arrastrándola en el tablero. El `DELETE` de la API borra físicamente y por eso no
                  se cablea a ningún botón (§0 del contrato).
                */}
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { if (confirm("¿Cancelar esta tarea? Podrás recuperarla desde la columna de canceladas.")) setEstado("cancelada"); }}
                  className="h-10 px-4 rounded-xl bg-brand-red/10 text-brand-red font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-red/15 flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="h-3.5 w-3.5" strokeWidth={2} />
                  Cancelar tarea
                </motion.button>
              </>
            )}
            {editing && done && (
              <div className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-green/10 text-brand-green font-ui text-[11px] font-bold uppercase tracking-wider">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                Completada
              </div>
            )}
            {editing && cancelada && (
              <>
                <div className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-red/10 text-brand-red font-ui text-[11px] font-bold uppercase tracking-wider">
                  <Ban className="h-3.5 w-3.5" strokeWidth={2} />
                  Cancelada
                </div>
                {/* Que se vea que se puede deshacer es lo que hace cierta la palabra «cancelar». */}
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setEstado("pendiente")}
                  className="h-10 px-4 rounded-xl bg-brand-blue/10 text-brand-blue font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-blue/15 flex items-center gap-1.5 transition-colors"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={2} />
                  Reabrir
                </motion.button>
              </>
            )}
            <div className="flex-1" />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className="h-11 px-5 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-neutral-50 text-neutral-700 transition-colors"
            >
              Cerrar
            </motion.button>
            {!editing && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={save}
              disabled={saving || !!dateError}
              className="h-11 px-6 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-brand-orange/25 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 transition-shadow hover:shadow-xl hover:shadow-brand-orange/30"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "Guardar" : "Crear tarea"}
            </motion.button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function IconBtn({ children, onClick, title, className }: { children: React.ReactNode; onClick?: () => void; title?: string; className?: string }) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      onClick={onClick} title={title}
      className={cn("h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center transition-colors", className)}
    >
      {children}
    </motion.button>
  );
}
