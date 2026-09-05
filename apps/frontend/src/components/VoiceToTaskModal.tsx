"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Square, X, Sparkles, Loader2, Check, Trash2, Wand2,
  UserCircle2, Briefcase, Tag as TagIcon, Flame, FileText, Calendar, AlertOctagon, Plus
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/ui/DateField";
import { FancySelect } from "@/components/ui/FancySelect";
import { initialsOf } from "@/lib/auth-user";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type Step = "idle" | "recording" | "uploading" | "review" | "saving";

interface TaskSuggestion {
  esTarea: boolean;
  titulo: string;
  descripcion: string | null;
  prioridad_sugerida: string;
  fecha_limite_sugerida: string | null;
  razonamiento: string;
}

interface UserLite { id: string; nombre: string; email: string; foto_perfil_url?: string | null; }
interface OportLite { id: string; nombre_caso: string; numero_caso?: number; }

export function VoiceToTaskModal({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcripcion, setTranscripcion] = useState("");
  const [suggestion, setSuggestion] = useState<TaskSuggestion | null>(null);
  const [meId, setMeId] = useState<string>("");
  const [users, setUsers] = useState<UserLite[]>([]);
  const [ops, setOps] = useState<OportLite[]>([]);
  const [edited, setEdited] = useState({
    titulo: "",
    descripcion: "",
    prioridad: "normal",
    fecha_limite: "",
    responsable_id: "",
    oportunidad_id: "",
    urgente: false,
    etiquetas: [] as string[]
  });
  const [tagDraft, setTagDraft] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!open) reset();
    else {
      // Pre-cargar usuarios + me + oportunidades activas
      fetch("/api/auth/me").then((r) => r.json()).then((d) => {
        const id = d?.user?.id || "";
        setMeId(id);
        setEdited((s) => ({ ...s, responsable_id: id }));
      }).catch(() => {});
      fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
      fetch("/api/oportunidades?estado=abiertas&limit=200").then((r) => r.ok ? r.json() : { oportunidades: [] }).then((d) => {
        setOps(d.oportunidades || d.ops || []);
      }).catch(() => {});
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [open]);

  const reset = () => {
    setStep("idle");
    setRecordingSeconds(0);
    setTranscripcion("");
    setSuggestion(null);
    setEdited({ titulo: "", descripcion: "", prioridad: "normal", fecha_limite: "", responsable_id: meId, oportunidad_id: "", urgente: false, etiquetas: [] });
    setTagDraft("");
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => { processAudio(); };
      mr.start();
      setStep("recording");
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (e) {
      toast.error("No se pudo acceder al micrófono");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setStep("uploading");
  };

  const processAudio = async () => {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("file", blob, "note.webm");
    try {
      const r = await fetch("/api/ai/voice-to-task", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error procesando");
      setTranscripcion(d.transcripcion);
      setSuggestion(d.tarea);
      setEdited((prev) => ({
        ...prev,
        titulo: d.tarea.titulo || "",
        descripcion: d.tarea.descripcion || "",
        prioridad: d.tarea.prioridad_sugerida || "normal",
        fecha_limite: d.tarea.fecha_limite_sugerida?.slice(0, 10) || "",
        urgente: (d.tarea.prioridad_sugerida === "urgente"),
        responsable_id: prev.responsable_id || meId
      }));
      setStep("review");
    } catch (e: any) {
      toast.error(e.message);
      setStep("idle");
    }
  };

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v) return;
    if (edited.etiquetas.includes(v)) { setTagDraft(""); return; }
    setEdited({ ...edited, etiquetas: [...edited.etiquetas, v] });
    setTagDraft("");
  };
  const removeTag = (t: string) => setEdited({ ...edited, etiquetas: edited.etiquetas.filter((x) => x !== t) });

  const confirmSave = async () => {
    setStep("saving");
    try {
      const r = await fetch("/api/ai/voice-to-task/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: edited.titulo,
          descripcion: edited.descripcion || null,
          prioridad: edited.prioridad,
          fecha_limite: edited.fecha_limite || null,
          responsable_id: edited.responsable_id || meId,
          oportunidad_id: edited.oportunidad_id || null,
          urgente: edited.urgente,
          etiquetas: edited.etiquetas,
          transcripcion
        })
      });
      if (!r.ok) throw new Error("Error al guardar");
      const respUser = users.find((u) => u.id === (edited.responsable_id || meId));
      const asignadoTxt = respUser ? respUser.nombre.split(" ")[0] : "ti";
      toast.success(`Tarea creada y asignada a ${asignadoTxt} ✨`);
      onCreated?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
      setStep("review");
    }
  };

  const discard = () => reset();

  if (!open) return null;

  const respUser = users.find((u) => u.id === edited.responsable_id);
  const isAssignedToMe = (edited.responsable_id || meId) === meId;
  const opSelected = ops.find((o) => o.id === edited.oportunidad_id);

  const userOpts = users.map((u) => ({
    value: u.id,
    label: u.nombre,
    sub: u.email,
    avatar: u.foto_perfil_url || undefined,
    initials: initialsOf(u.nombre)
  }));
  const opOpts = ops.map((o: any) => ({
    value: o.id,
    label: o.nombre_caso || `Caso #${o.numero_caso}`,
    sub: o.numero_caso ? `#${o.numero_caso}` : ""
  }));
  const prioOpts = [
    { value: "baja", label: "Baja", color: "#FFB51C" },
    { value: "normal", label: "Normal", color: "#43A847" },
    { value: "alta", label: "Alta", color: "#5750E8" },
    { value: "urgente", label: "Urgente", color: "#E53935" }
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-2xl rounded-3xl overflow-hidden bg-white dark:bg-neutral-900 shadow-2xl border border-black/10 dark:border-white/10 max-h-[92vh] flex flex-col"
        >
          {/* Header gradient */}
          <div className="relative bg-gradient-to-br from-brand-orange via-amber-500 to-orange-600 px-7 py-5 overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.25),transparent_60%)] pointer-events-none" />
            <div className="absolute -bottom-10 -right-8 w-44 h-44 rounded-full bg-white/10 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
                  <Wand2 className="h-6 w-6 text-white" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-black text-white leading-tight">Voice to Task</h2>
                  <div className="text-[10px] font-ui font-bold uppercase tracking-[0.18em] text-white/80 flex items-center gap-1.5 mt-0.5">
                    <Sparkles className="h-3 w-3" />
                    Powered by Claude + Whisper
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white shrink-0 backdrop-blur transition-colors">
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {/* IDLE */}
            {step === "idle" && (
              <div className="text-center px-7 py-10">
                <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-6 max-w-md mx-auto">
                  Graba una nota de voz. La IA transcribe, extrae la tarea y vos eliges <strong>a quién asignársela</strong>, prioridad, vencimiento y más.
                </p>
                <motion.button
                  onClick={startRecording}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="h-24 w-24 rounded-full bg-gradient-to-br from-brand-orange to-amber-500 mx-auto flex items-center justify-center shadow-[0_12px_40px_rgba(87,80,232,0.4)] hover:shadow-[0_16px_50px_rgba(87,80,232,0.5)] transition-all"
                >
                  <Mic className="h-10 w-10 text-white" strokeWidth={2.2} />
                </motion.button>
                <div className="mt-4 text-[11px] font-ui font-bold uppercase tracking-[0.18em] text-neutral-400">Click para grabar</div>
              </div>
            )}

            {/* RECORDING */}
            {step === "recording" && (
              <div className="text-center px-7 py-10">
                <div className="relative h-28 w-28 mx-auto mb-4">
                  <span className="absolute inset-0 rounded-full bg-brand-red animate-ping opacity-40" />
                  <span className="absolute inset-0 rounded-full bg-brand-red/30 animate-pulse" />
                  <button onClick={stopRecording} className="relative h-28 w-28 rounded-full bg-brand-red flex items-center justify-center shadow-[0_12px_40px_rgba(229,57,53,0.5)]">
                    <Square className="h-9 w-9 text-white fill-white" strokeWidth={0} />
                  </button>
                </div>
                <div className="font-display text-4xl font-black tabular-nums text-neutral-900 dark:text-white">
                  {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:{String(recordingSeconds % 60).padStart(2, "0")}
                </div>
                <div className="mt-2 text-[11px] font-ui font-bold uppercase tracking-[0.18em] text-brand-red flex items-center justify-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-red animate-pulse" />
                  Grabando · click para detener
                </div>
              </div>
            )}

            {/* UPLOADING */}
            {step === "uploading" && (
              <div className="text-center px-7 py-14">
                <Loader2 className="h-12 w-12 text-brand-orange animate-spin mx-auto mb-4" />
                <div className="font-display font-black text-lg mb-1 text-neutral-900 dark:text-white">Procesando con IA…</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">Transcribiendo con Whisper + extrayendo con Claude</div>
              </div>
            )}

            {/* REVIEW */}
            {step === "review" && suggestion && (
              <div className="px-7 py-5 space-y-5">
                {/* Transcripción */}
                <div className="rounded-xl bg-neutral-100 dark:bg-white/5 px-4 py-3 border border-neutral-200/60 dark:border-white/5">
                  <div className="text-[10px] font-ui font-black uppercase tracking-[0.15em] text-neutral-500 dark:text-neutral-400 mb-1 flex items-center gap-1.5">
                    <Mic className="h-3 w-3" /> Transcripción
                  </div>
                  <div className="text-[13px] text-neutral-700 dark:text-neutral-200 italic leading-snug">«{transcripcion}»</div>
                </div>

                {/* AI razonamiento */}
                {!suggestion.esTarea ? (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-4 py-3 flex items-start gap-3">
                    <AlertOctagon className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2.2} />
                    <div className="text-[13px]">
                      <div className="font-bold text-amber-900 dark:text-amber-200">La IA detectó que esto no es una tarea clara.</div>
                      <div className="text-xs mt-0.5 text-amber-800 dark:text-amber-300">{suggestion.razonamiento}</div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-emerald-50/50 dark:from-emerald-900/20 dark:to-transparent border border-emerald-200/70 dark:border-emerald-800/40 px-4 py-3 flex items-start gap-3">
                    <div className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                      <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                    </div>
                    <div className="text-[13px] text-emerald-900 dark:text-emerald-200">
                      <div className="font-bold">Tarea detectada por IA</div>
                      <div className="text-xs mt-0.5 text-emerald-800/80 dark:text-emerald-300">{suggestion.razonamiento}</div>
                    </div>
                  </div>
                )}

                {/* Sección 1: Asignación (DESTACADA) */}
                <section>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">1</div>
                    <h3 className="font-display font-black text-[13px] text-neutral-900 dark:text-white">Asignación</h3>
                    <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400">¿A quién va esta tarea?</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                      Responsable <span className="text-brand-red">*</span>
                    </label>
                    <FancySelect
                      value={edited.responsable_id || meId}
                      onChange={(v) => setEdited({ ...edited, responsable_id: v })}
                      options={userOpts}
                      placeholder="Selecciona responsable…"
                      label=""
                      icon={UserCircle2}
                      width={"100%" as any}
                    />
                    {respUser && (
                      <div className="mt-2 flex items-center gap-2 text-[11px]">
                        <div className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isAssignedToMe ? "bg-brand-orange" : "bg-emerald-500 animate-pulse"
                        )} />
                        <span className="font-bold text-neutral-700 dark:text-neutral-300">
                          {isAssignedToMe ? "Para ti" : `Notificaremos a ${respUser.nombre.split(" ")[0]}`}
                        </span>
                        {!isAssignedToMe && (
                          <span className="text-neutral-400">— recibirá la notificación + entrará al chat de la tarea</span>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                {/* Sección 2: Detalles */}
                <section>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">2</div>
                    <h3 className="font-display font-black text-[13px] text-neutral-900 dark:text-white">Detalles de la tarea</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                        Título <span className="text-brand-red">*</span>
                      </label>
                      <input
                        value={edited.titulo}
                        onChange={(e) => setEdited({ ...edited, titulo: e.target.value })}
                        placeholder="¿Qué hay que hacer?"
                        className="w-full h-11 px-4 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-sm font-medium outline-none transition-all focus:bg-white dark:focus:bg-neutral-800 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 text-neutral-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                        Descripción
                      </label>
                      <textarea
                        value={edited.descripcion}
                        onChange={(e) => setEdited({ ...edited, descripcion: e.target.value })}
                        rows={2}
                        placeholder="Contexto, instrucciones, links útiles…"
                        className="w-full px-4 py-2.5 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-sm font-medium outline-none transition-all focus:bg-white dark:focus:bg-neutral-800 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 resize-none text-neutral-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                        <Briefcase className="h-3 w-3 inline mr-1" /> Vincular a oportunidad <span className="text-neutral-400 font-normal normal-case tracking-normal">(opcional)</span>
                      </label>
                      {opSelected ? (
                        <div className="flex items-center gap-2 h-11 px-4 rounded-xl bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-200 dark:border-purple-800/40">
                          <Briefcase className="h-4 w-4 text-purple-600" />
                          <span className="text-sm font-bold text-purple-900 dark:text-purple-200 truncate flex-1">{opSelected.nombre_caso}</span>
                          {opSelected.numero_caso && <span className="text-[10px] font-ui font-black text-purple-600">#{opSelected.numero_caso}</span>}
                          <button
                            onClick={() => setEdited({ ...edited, oportunidad_id: "" })}
                            className="h-7 w-7 rounded-lg hover:bg-purple-200/60 dark:hover:bg-purple-800/40 flex items-center justify-center text-purple-700 dark:text-purple-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <FancySelect
                          value={edited.oportunidad_id}
                          onChange={(v) => setEdited({ ...edited, oportunidad_id: v })}
                          options={opOpts}
                          placeholder="Sin vincular"
                          label=""
                          icon={Briefcase}
                          width={"100%" as any}
                        />
                      )}
                    </div>
                  </div>
                </section>

                {/* Sección 3: Configuración */}
                <section>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">3</div>
                    <h3 className="font-display font-black text-[13px] text-neutral-900 dark:text-white">Prioridad & vencimiento</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">Prioridad</label>
                      <FancySelect
                        value={edited.prioridad}
                        onChange={(v) => setEdited({ ...edited, prioridad: v, urgente: v === "urgente" ? true : edited.urgente })}
                        options={prioOpts}
                        placeholder="Prioridad"
                        label=""
                        icon={Flame}
                        searchable={false}
                        width={"100%" as any}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 block mb-1.5">
                        <Calendar className="h-3 w-3 inline mr-1" /> Vence
                      </label>
                      <DateField
                        value={edited.fecha_limite}
                        onChange={(v) => setEdited({ ...edited, fecha_limite: v })}
                        minDate={new Date()}
                        placeholder="Sin fecha"
                      />
                    </div>
                  </div>

                  {/* Urgente toggle */}
                  <button
                    onClick={() => setEdited({ ...edited, urgente: !edited.urgente })}
                    className={cn(
                      "mt-3 w-full h-11 rounded-xl border-2 px-4 flex items-center justify-between transition-all",
                      edited.urgente
                        ? "bg-gradient-to-r from-red-50 to-red-50/50 dark:from-red-900/20 dark:to-transparent border-red-300 dark:border-red-800/60"
                        : "bg-neutral-50 dark:bg-white/5 border-transparent hover:border-neutral-200 dark:hover:border-white/10"
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <div className={cn(
                        "h-7 w-7 rounded-lg flex items-center justify-center transition-all",
                        edited.urgente ? "bg-red-500 text-white" : "bg-neutral-200 dark:bg-white/10 text-neutral-500"
                      )}>
                        <Flame className={cn("h-4 w-4", edited.urgente && "animate-pulse")} strokeWidth={2.2} />
                      </div>
                      <span className="text-left">
                        <div className={cn("text-[13px] font-bold", edited.urgente ? "text-red-700 dark:text-red-300" : "text-neutral-700 dark:text-neutral-300")}>
                          Marcar como urgente
                        </div>
                        <div className="text-[10px] text-neutral-500">Aparece destacada y notifica con prioridad crítica</div>
                      </span>
                    </span>
                    <div className={cn(
                      "h-6 w-11 rounded-full p-0.5 transition-all",
                      edited.urgente ? "bg-red-500" : "bg-neutral-300 dark:bg-white/15"
                    )}>
                      <div className={cn(
                        "h-5 w-5 rounded-full bg-white shadow transition-transform",
                        edited.urgente ? "translate-x-5" : "translate-x-0"
                      )} />
                    </div>
                  </button>
                </section>

                {/* Sección 4: Etiquetas */}
                <section>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="h-6 w-6 rounded-lg bg-brand-orange/15 text-brand-orange flex items-center justify-center text-[10px] font-black">4</div>
                    <h3 className="font-display font-black text-[13px] text-neutral-900 dark:text-white">Etiquetas</h3>
                    <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400">Para filtrar luego</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-2 min-h-[28px]">
                    {edited.etiquetas.map((t) => (
                      <motion.span
                        key={t}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="inline-flex items-center gap-1.5 h-7 pl-3 pr-1 rounded-full bg-gradient-to-r from-brand-orange/15 to-amber-500/15 border border-brand-orange/30 text-[11px] font-bold text-brand-orange"
                      >
                        <TagIcon className="h-3 w-3" />
                        {t}
                        <button onClick={() => removeTag(t)} className="h-5 w-5 rounded-full hover:bg-brand-orange/25 flex items-center justify-center">
                          <X className="h-3 w-3" strokeWidth={2.5} />
                        </button>
                      </motion.span>
                    ))}
                    {edited.etiquetas.length === 0 && (
                      <span className="text-[11px] text-neutral-400">Aún sin etiquetas</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                      placeholder="Agregar etiqueta y presionar Enter"
                      className="flex-1 h-10 px-4 rounded-xl bg-neutral-50 dark:bg-white/5 border-2 border-transparent text-[12px] outline-none focus:bg-white dark:focus:bg-neutral-800 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 text-neutral-900 dark:text-white"
                    />
                    <button
                      onClick={addTag}
                      disabled={!tagDraft.trim()}
                      className="h-10 px-4 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[10px] font-black uppercase tracking-wider hover:bg-brand-orange hover:text-white transition-all disabled:opacity-40 flex items-center gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Añadir
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* SAVING */}
            {step === "saving" && (
              <div className="text-center px-7 py-14">
                <Loader2 className="h-12 w-12 text-brand-orange animate-spin mx-auto mb-4" />
                <div className="font-display font-black text-lg text-neutral-900 dark:text-white">Creando tarea…</div>
                <div className="text-xs text-neutral-500 mt-1">Notificando al responsable</div>
              </div>
            )}
          </div>

          {/* Footer (sólo en review) */}
          {step === "review" && suggestion && (
            <div className="border-t border-neutral-100 dark:border-white/5 bg-neutral-50/60 dark:bg-white/[0.02] px-7 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="text-[10px] font-ui text-neutral-500 dark:text-neutral-400 hidden sm:flex items-center gap-1">
                <span className="text-brand-red">*</span> Campos obligatorios
              </div>
              <div className="flex gap-3 ml-auto">
                <button
                  onClick={discard}
                  className="h-11 px-5 rounded-xl bg-white dark:bg-white/5 border-2 border-neutral-200 dark:border-white/10 font-ui text-[11px] font-black uppercase tracking-wider text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/10 transition-all flex items-center gap-2"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Descartar
                </button>
                <button
                  onClick={confirmSave}
                  disabled={!edited.titulo.trim() || !(edited.responsable_id || meId)}
                  className="h-11 px-6 rounded-xl bg-gradient-to-r from-brand-orange to-amber-500 text-white font-ui text-[11px] font-black uppercase tracking-wider shadow-lg shadow-brand-orange/30 hover:shadow-brand-orange/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  Crear tarea
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
