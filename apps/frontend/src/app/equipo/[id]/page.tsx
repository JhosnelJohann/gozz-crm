"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Pencil, X, Check, Sparkles, Mail, Phone, Cake, User as UserIcon,
  MapPin, Globe, Briefcase, Building2, Languages, Smartphone, Monitor,
  ThumbsUp, Gift, Trophy, DollarSign, Crown, Wine, Cake as CakeIcon,
  Hash, Flag, Star, Heart, Calendar as CalendarIcon, ChevronLeft, ChevronRight,
  Lock, KeyRound, Clock as ClockIcon, TrendingUp, CheckSquare, AlertCircle, Target,
  Eye, EyeOff, ShieldCheck, Shield
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RoleBadge } from "@/components/equipo/RoleBadge";
import { ProfilePhotoUploader } from "@/components/equipo/ProfilePhotoUploader";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";
import { cn, fmtFechaSolo } from "@/lib/utils";

interface ProfileUser {
  id: string;
  email: string;
  nombre: string;
  nivel_acceso: string;
  posiciones: string[];
  foto_perfil_url: string | null;
  online: boolean;
  activo: boolean;
  zona_horaria: string | null;
  ultimo_login: string | null;
  telefono: string | null;
  telefono_personal: string | null;
  departamento: string | null;
  fecha_ingreso: string | null;
  cumpleanos: string | null;
  genero: string | null;
  bio: string | null;
  importado_desde: string | null;
  bitrix_id: number | null;
}

const TABS = [
  { key: "general", label: "General" },
  { key: "tareas", label: "Tareas" },
  { key: "calendario", label: "Calendario" },
  { key: "analytics", label: "Analytics" },
  { key: "tiempo", label: "Tiempo de trabajo" },
];

function splitNombre(n: string): { nombre: string; apellido: string } {
  const parts = (n || "").trim().split(/\s+/);
  if (parts.length <= 1) return { nombre: parts[0] || "", apellido: "" };
  if (parts.length === 2) return { nombre: parts[0], apellido: parts[1] };
  // 3+: first is nombre, rest is apellidos
  return { nombre: parts.slice(0, parts.length - 2).join(" "), apellido: parts.slice(-2).join(" ") };
}

function formatDate(s: string | null, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) {
  if (!s) return "—";
  try {
    // fmtFechaSolo evita el corrimiento de zona horaria en columnas `date`
    return fmtFechaSolo(s, opts) || "—";
  } catch { return s; }
}

function genderLabel(g: string | null): string {
  if (g === "M") return "Masculino";
  if (g === "F") return "Femenino";
  return "—";
}

export default function PerfilEquipoPage() {
  const params = useParams();
  const id = params.id as string;
  const { user: current, isAdmin } = useCurrentUser();
  const isOwner = current?.id === id;
  const canEdit = isAdmin || isOwner;
  const [u, setU] = useState<ProfileUser | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [tab, setTab] = useState("general");

  const load = async () => {
    const r = await fetch(`/api/users/${id}`);
    const d = await r.json();
    if (d.user) setU(d.user);
  };

  useEffect(() => { load(); }, [id]);

  if (!u) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 text-brand-orange animate-spin" />
        </div>
      </AppShell>
    );
  }

  const { nombre, apellido } = splitNombre(u.nombre);

  return (
    <AppShell>
      <div className="relative">
        {/* Hero banner */}
        <div className="relative h-60 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-orange via-neon-magenta to-neon-purple" />
          <div className="absolute inset-0 opacity-30"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`, mixBlendMode: "overlay" }}
          />
          <div className="absolute bottom-0 left-0 right-0 px-6 md:px-10 pb-6 flex items-end justify-between gap-4 flex-wrap">
            <h1 className="font-display text-3xl md:text-3xl sm:text-5xl font-black text-white drop-shadow-lg">{u.nombre}</h1>
            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  onClick={() => setPassOpen(true)}
                  className="h-9 px-4 rounded-xl bg-white/15 backdrop-blur-md border border-white/25 text-xs font-ui uppercase tracking-wider text-white hover:bg-white/25 transition flex items-center gap-1.5"
                >
                  <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                  Seguridad
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="sticky top-0 z-20 bg-bg-dark/80 backdrop-blur-lg border-b border-white/10">
          <div className="max-w-7xl mx-auto px-6 md:px-10 overflow-x-auto scrollbar-thin">
            <div className="flex items-center gap-1 py-2 min-w-max">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "h-9 px-4 rounded-xl text-xs font-ui uppercase tracking-wider transition",
                    tab === t.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tab === "tareas" && <TareasTab userId={id} />}
        {tab === "calendario" && <CalendarioTab userId={id} />}
        {tab === "analytics" && <AnalyticsTab userId={id} />}
        {tab === "tiempo" && <TiempoTab userId={id} />}

        {/* Body 2 cols - solo en General */}
        {tab === "general" && <div className="max-w-7xl mx-auto px-6 md:px-10 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column */}
          <div className="lg:col-span-4 space-y-4">
            {/* Photo card */}
            <div className="glass rounded-3xl p-6 border border-white/10 flex flex-col items-center">
              <div className="relative">
                <div className="h-56 w-56 rounded-full overflow-hidden p-1.5 bg-gradient-to-br from-brand-orange via-neon-magenta to-neon-purple">
                  <div className="h-full w-full rounded-full overflow-hidden bg-zinc-900 flex items-center justify-center">
                    {u.foto_perfil_url ? (
                      <img src={u.foto_perfil_url} alt={u.nombre} className="w-full h-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-6xl font-display font-black text-white">
                        {initialsOf(u.nombre)}
                      </div>
                    )}
                  </div>
                </div>
                {canEdit && <ProfilePhotoUploader userId={u.id} nombre={u.nombre} currentUrl={u.foto_perfil_url} isOwner={isOwner} onUploaded={(url) => setU({ ...u, foto_perfil_url: url })} />}
                {u.online && (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-[#0A0A12]/80 backdrop-blur-md rounded-full px-2.5 py-1 text-[10px] font-ui uppercase tracking-wider text-green-400 border border-green-400/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    En línea
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-col items-center gap-1.5">
                {((u.posiciones || [])[0] || u.departamento) && (
                  <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-ui uppercase tracking-[0.15em] font-bold bg-gradient-to-r from-brand-orange to-neon-magenta text-white shadow-lg">
                    <Briefcase className="h-3 w-3" strokeWidth={2.5} />
                    {(u.posiciones || [])[0] || u.departamento}
                  </div>
                )}
                {(u.posiciones || [])[0] && u.departamento && (
                  <div className="text-[11px] font-ui text-white/60 tracking-wide">{u.departamento}</div>
                )}
                {!u.activo && <div className="text-[10px] font-ui uppercase tracking-wider text-red-400">Inactivo</div>}
              </div>
            </div>

            {/* App promo card */}
            <div className="glass rounded-2xl p-4 border border-white/10 grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-xs">
                <div className="h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center"><Smartphone className="h-4 w-4" /></div>
                <div>
                  <div className="font-ui uppercase text-[9px] tracking-wider text-white/40">Aplicación</div>
                  <div className="font-semibold">Móvil</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center"><Monitor className="h-4 w-4" /></div>
                <div>
                  <div className="font-ui uppercase text-[9px] tracking-wider text-white/40">Aplicación</div>
                  <div className="font-semibold">Escritorio</div>
                </div>
              </div>
            </div>

            {/* Reconocimientos */}
            <div className="glass rounded-2xl p-5 border border-white/10">
              <div className="font-display font-black text-sm mb-4">Reconocimientos</div>
              <div className="grid grid-cols-7 gap-2">
                {[ThumbsUp, Gift, Trophy, DollarSign, Crown, Wine, CakeIcon, Hash, Flag, Star, Heart, Sparkles, UserIcon, Briefcase].map((Icon, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-brand-orange transition">
                    <Icon className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-8 space-y-4">
            {/* Contact info */}
            <div className="glass rounded-3xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-5">
                <div className="font-display font-black text-lg">Información de contacto</div>
                {canEdit && (
                  <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 text-xs font-ui uppercase tracking-wider text-brand-orange hover:text-brand-orange/80">
                    <Pencil className="h-3.5 w-3.5" />
                    Editar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InfoRow label="Nombre" value={nombre} />
                <InfoRow label="Apellido" value={apellido} />
                <InfoRow label="Correo electrónico" value={u.email} highlighted />
                <InfoRow label="Segundo nombre" value={null} />
                <InfoRow label="Fecha de nacimiento" value={formatDate(u.cumpleanos)} />
                <InfoRow label="Sexo" value={genderLabel(u.genero)} />
                <InfoRow label="Teléfono móvil" value={u.telefono_personal || u.telefono} />
                <InfoRow label="Idioma de las notificaciones" value="Español" />
                <InfoRow label="Posición" value={(u.posiciones || [])[0] || null} />
                <InfoRow label="Supervisor" value={null} />
                <InfoRow label="Departamento" value={u.departamento} wide />
              </div>
            </div>

            {/* Detalles personales */}
            <div className="glass rounded-3xl p-6 border border-white/10">
              <div className="font-display font-black text-lg mb-5">Detalles personales</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InfoRow label="Bio" value={u.bio} wide />
                <InfoRow label="Zona horaria" value={u.zona_horaria} />
                <InfoRow label="Fecha de ingreso" value={formatDate(u.fecha_ingreso, { year: "numeric", month: "long", day: "numeric" })} />
                <InfoRow label="Último acceso" value={u.ultimo_login ? new Date(u.ultimo_login).toLocaleString("es") : null} />
                <InfoRow label="Origen" value={u.importado_desde === "bitrix24" ? "Bitrix24 (import)" : "Registro manual"} />
                {current?.nivel === "super_admin" && u.bitrix_id && (
                  <InfoRow label="Bitrix ID" value={String(u.bitrix_id)} />
                )}
              </div>
            </div>
          </div>
        </div>}

        {/* Edit modal */}
        {editOpen && canEdit && (
          <EditProfileModal user={u} onClose={() => setEditOpen(false)} onSaved={(u2) => { setU(u2); setEditOpen(false); }} isSuperAdmin={current?.nivel === "super_admin"} mode={isAdmin ? "admin" : "owner"} />
        )}

        {passOpen && isOwner && (
          <PasswordModal onClose={() => setPassOpen(false)} />
        )}
      </div>
    </AppShell>
  );
}

// =====================================================================
// TAB: Tareas del usuario — 2026 bento
// =====================================================================
function TareasTab({ userId }: { userId: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"pendiente" | "completada" | "todas">("pendiente");
  const [tareas, setTareas] = useState<any[] | null>(null);
  useEffect(() => {
    setTareas(null);
    const q = filter === "todas" ? "" : `?estado=${filter}`;
    fetch(`/api/users/${userId}/tareas${q}`).then((r) => r.json()).then((d) => setTareas(d.tareas || []));
  }, [userId, filter]);

  const fmt = (s: string | null) => s ? new Date(s).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : null;
  const daysUntil = (s: string | null) => {
    if (!s) return null;
    const ms = new Date(s).getTime() - Date.now();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  };
  const PRIO: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    urgente: { bg: "bg-red-50 border-red-200", text: "text-red-700", dot: "bg-red-500", label: "Urgente" },
    alta: { bg: "bg-orange-50 border-orange-200", text: "text-brand-orange", dot: "bg-brand-orange", label: "Alta" },
    normal: { bg: "bg-sky-50 border-sky-200", text: "text-sky-700", dot: "bg-sky-500", label: "Normal" },
    baja: { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", dot: "bg-slate-400", label: "Baja" },
  };

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-neutral-400 mb-1">Personal</div>
          <h2 className="font-display font-black text-3xl tracking-tight text-slate-900 dark:text-white">
            Tus <span className="text-gradient-orange">tareas</span>
          </h2>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-2xl bg-white shadow-[0_4px_20px_rgba(15,23,42,0.04)] border border-slate-200 p-1">
          {(["pendiente", "completada", "todas"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn(
                "px-3.5 h-9 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider transition",
                filter === k
                  ? "bg-gradient-to-r from-brand-orange to-neon-magenta text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              )}>
              {k === "pendiente" ? "Pendientes" : k === "completada" ? "Completadas" : "Todas"}
            </button>
          ))}
        </div>
      </div>

      {tareas === null ? (
        <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>
      ) : tareas.length === 0 ? (
        <div className="rounded-3xl bg-white border border-dashed border-slate-200 py-20 text-center shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-orange/15 to-neon-magenta/10 mb-3">
            <CheckSquare className="h-7 w-7 text-brand-orange" strokeWidth={1.8} />
          </div>
          <div className="font-display font-black text-lg text-slate-900">Sin tareas {filter === "pendiente" ? "pendientes" : filter === "completada" ? "completadas" : ""}</div>
          <p className="text-sm text-slate-500 mt-1">Cuando se asignen aparecerán aquí.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tareas.map((t, i) => {
            const p = PRIO[t.prioridad || "normal"] || PRIO.normal;
            const dias = daysUntil(t.fecha_limite);
            const overdue = dias !== null && dias < 0 && t.estado !== "completada";
            const done = t.estado === "completada";
            return (
              <motion.li
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <button onClick={() => router.push(`/tareas?id=${t.id}`)}
                  className={cn(
                    "w-full rounded-2xl p-5 border bg-white text-left transition-all shadow-[0_4px_20px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_40px_rgba(15,23,42,0.10)] hover:-translate-y-0.5 group",
                    done ? "border-slate-200 opacity-80" : overdue ? "border-red-200" : "border-slate-200"
                  )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "h-9 w-9 shrink-0 rounded-xl flex items-center justify-center border",
                      done ? "bg-green-50 border-green-200 text-brand-green"
                        : overdue ? "bg-red-50 border-red-200 text-red-600"
                        : `${p.bg} ${p.text}`
                    )}>
                      <CheckSquare className="h-4 w-4" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn(
                        "font-display font-bold text-[15px] leading-snug line-clamp-2",
                        done ? "text-slate-400 line-through" : "text-slate-900 group-hover:text-brand-orange transition-colors"
                      )}>{t.titulo}</div>
                      {t.descripcion && !done && (
                        <div className="text-[12px] text-slate-500 mt-1 line-clamp-1">{t.descripcion}</div>
                      )}
                      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                        <span className={cn("inline-flex items-center gap-1 px-2 h-6 rounded-md border font-ui text-[9.5px] font-bold uppercase tracking-wider", p.bg, p.text)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", p.dot)} />
                          {p.label}
                        </span>
                        {t.fecha_limite && (
                          <span className={cn(
                            "inline-flex items-center gap-1 px-2 h-6 rounded-md font-ui text-[10px] font-bold uppercase tracking-wider",
                            overdue ? "bg-red-500 text-white" :
                            done ? "bg-slate-100 text-slate-500" :
                            dias !== null && dias <= 1 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                          )}>
                            <CalendarIcon className="h-3 w-3" strokeWidth={2.5} />
                            {overdue ? `vencida ${Math.abs(dias!)}d` : dias === 0 ? "hoy" : dias === 1 ? "mañana" : `${fmt(t.fecha_limite)}`}
                          </span>
                        )}
                        {t.oportunidad_nombre && (
                          <span className="inline-flex items-center gap-1 px-2 h-6 rounded-md bg-fuchsia-50 text-fuchsia-700 font-ui text-[10px] font-bold uppercase tracking-wider truncate max-w-[50%]">
                            <Target className="h-3 w-3" strokeWidth={2.5} />
                            {t.oportunidad_nombre}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// TAB: Calendario (mes actual con tareas + SLAs)
// =====================================================================
function CalendarioTab({ userId }: { userId: string }) {
  const router = useRouter();
  const today = new Date();
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [data, setData] = useState<{ tareas: any[]; slas: any[] } | null>(null);

  const first = new Date(month.y, month.m, 1);
  const last  = new Date(month.y, month.m + 1, 0);
  const desde = new Date(month.y, month.m, 1).toISOString();
  const hasta = new Date(month.y, month.m + 1, 0, 23, 59, 59).toISOString();

  useEffect(() => {
    setData(null);
    fetch(`/api/users/${userId}/calendario?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`)
      .then((r) => r.json())
      .then((d) => setData({ tareas: d.tareas || [], slas: d.slas || [] }));
  }, [userId, desde, hasta]);

  // días a mostrar: primer lunes anterior o igual al 1º, hasta cubrir 6 filas (42)
  const startWeekday = (first.getDay() + 6) % 7; // 0 = lunes
  const gridStart = new Date(first);
  gridStart.setDate(1 - startWeekday);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  const eventsByDay = useMemo(() => {
    const map = new Map<string, { kind: "tarea" | "sla"; item: any }[]>();
    const push = (date: Date, kind: "tarea" | "sla", item: any) => {
      const key = date.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ kind, item });
    };
    (data?.tareas || []).forEach((t) => { if (t.fecha_limite) push(new Date(t.fecha_limite), "tarea", t); });
    (data?.slas || []).forEach((o) => { if (o.sla_fecha_limite) push(new Date(o.sla_fecha_limite), "sla", o); });
    return map;
  }, [data]);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selectedEvents = selectedDay ? (eventsByDay.get(selectedDay) || []) : [];

  const monthLabel = first.toLocaleDateString("es", { month: "long", year: "numeric" });

  const totalEvents = useMemo(() => (data?.tareas?.length || 0) + (data?.slas?.length || 0), [data]);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-neutral-400 mb-1">Agenda</div>
          <h2 className="font-display font-black text-3xl tracking-tight text-slate-900 capitalize">
            <span className="text-gradient-orange">{first.toLocaleDateString("es", { month: "long" })}</span>{" "}
            <span className="text-slate-900">{first.getFullYear()}</span>
          </h2>
          <p className="text-sm text-slate-500 mt-1">{totalEvents} {totalEvents === 1 ? "compromiso" : "compromisos"} este mes</p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-2xl bg-white border border-slate-200 shadow-[0_4px_20px_rgba(15,23,42,0.04)] p-1">
          <button onClick={() => setMonth((m) => ({ y: m.m === 0 ? m.y - 1 : m.y, m: (m.m + 11) % 12 }))}
            className="h-9 w-9 rounded-xl hover:bg-slate-100 text-slate-600 flex items-center justify-center transition">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setMonth({ y: today.getFullYear(), m: today.getMonth() })}
            className="h-9 px-3 rounded-xl hover:bg-slate-100 text-slate-900 text-[11px] font-ui font-bold uppercase tracking-wider transition">
            Hoy
          </button>
          <button onClick={() => setMonth((m) => ({ y: m.m === 11 ? m.y + 1 : m.y, m: (m.m + 1) % 12 }))}
            className="h-9 w-9 rounded-xl hover:bg-slate-100 text-slate-600 flex items-center justify-center transition">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {data === null ? (
        <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>
      ) : (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-[0_4px_30px_rgba(15,23,42,0.05)] overflow-hidden">
          <div className="grid grid-cols-7 text-[10px] font-ui font-bold uppercase tracking-[0.15em] text-slate-400 border-b border-slate-100 bg-slate-50/50">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
              <div key={d} className="px-3 py-3 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-fr">
            {days.map((d, i) => {
              const inMonth = d.getMonth() === month.m;
              const key = d.toISOString().slice(0, 10);
              const evs = eventsByDay.get(key) || [];
              const isToday = d.toDateString() === today.toDateString();
              return (
                <button
                  key={i}
                  onClick={() => evs.length > 0 && setSelectedDay(key)}
                  disabled={evs.length === 0}
                  className={cn(
                    "min-h-[110px] border-b border-r border-slate-100 last-in-row:border-r-0 p-2 text-left align-top transition relative",
                    inMonth ? "bg-white" : "bg-slate-50/40",
                    evs.length > 0 && "hover:bg-brand-orange/[0.03] cursor-pointer",
                    isToday && "bg-gradient-to-br from-brand-orange/[0.06] to-neon-magenta/[0.03]"
                  )}
                >
                  <div className={cn(
                    "h-7 w-7 rounded-xl flex items-center justify-center text-[12px] font-display font-black",
                    isToday ? "bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow-md shadow-brand-orange/30"
                      : inMonth ? "text-slate-900" : "text-slate-300"
                  )}>{d.getDate()}</div>
                  <div className="mt-1.5 space-y-1">
                    {evs.slice(0, 3).map((e, k) => {
                      const isSla = e.kind === "sla";
                      const done = !isSla && e.item.estado === "completada";
                      return (
                        <div key={k} className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] truncate font-semibold flex items-center gap-1",
                          isSla ? "bg-red-100 text-red-700"
                            : done ? "bg-slate-100 text-slate-400 line-through"
                            : "bg-sky-100 text-sky-700"
                        )}>
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isSla ? "bg-red-500" : done ? "bg-slate-400" : "bg-sky-500")} />
                          <span className="truncate">{isSla ? "SLA · " : ""}{e.item.titulo || e.item.nombre_caso}</span>
                        </div>
                      );
                    })}
                    {evs.length > 3 && <div className="text-[10px] font-semibold text-brand-orange px-1.5">+{evs.length - 3} más</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 flex-wrap text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Tarea pendiente</div>
        <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" /> Tarea completada</div>
        <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> SLA oportunidad</div>
      </div>

      {selectedDay && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedDay(null)}>
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="bg-white rounded-3xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-orange/15 to-neon-magenta/10 text-brand-orange flex items-center justify-center">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-slate-400">Agenda del día</div>
                <div className="font-display font-black text-lg text-slate-900 capitalize truncate">
                  {new Date(selectedDay + "T00:00:00").toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}
                </div>
              </div>
              <button onClick={() => setSelectedDay(null)} className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/50">
              {selectedEvents.map((e, i) => {
                const done = e.kind === "tarea" && e.item.estado === "completada";
                return (
                  <button key={i}
                    onClick={() => {
                      if (e.kind === "tarea") router.push(`/tareas?id=${e.item.id}`);
                      else router.push(`/oportunidades/${e.item.id}`);
                    }}
                    className="w-full text-left px-4 py-3 rounded-2xl bg-white border border-slate-200 hover:border-brand-orange hover:shadow-md transition flex items-center gap-3">
                    <div className={cn(
                      "h-10 w-10 rounded-xl shrink-0 flex items-center justify-center",
                      e.kind === "tarea" ? (done ? "bg-green-50 text-brand-green" : "bg-sky-50 text-sky-600") : "bg-red-50 text-red-600"
                    )}>
                      {e.kind === "tarea" ? <CheckSquare className="h-5 w-5" strokeWidth={1.8} /> : <AlertCircle className="h-5 w-5" strokeWidth={1.8} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm font-display font-bold text-slate-900 truncate", done && "line-through text-slate-400")}>
                        {e.kind === "tarea" ? e.item.titulo : `SLA · ${e.item.nombre_caso}`}
                      </div>
                      <div className="text-[11px] text-slate-500 capitalize mt-0.5">
                        {e.kind === "tarea"
                          ? `Prioridad ${e.item.prioridad || "normal"} · ${e.item.estado}`
                          : `Etapa ${e.item.etapa}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB: Analytics — bento 2026
// =====================================================================
function AnalyticsTab({ userId }: { userId: string }) {
  const [stats, setStats] = useState<any | null>(null);
  useEffect(() => {
    setStats(null);
    fetch(`/api/users/${userId}/stats`).then((r) => r.json()).then(setStats);
  }, [userId]);
  if (!stats) return <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>;
  const ingresos = Number(stats.ingresos_mes_usd || 0);
  const completadas = Number(stats.tareas_completadas || 0);
  const pendientes = Number(stats.tareas_pendientes || 0);
  const total = completadas + pendientes;
  const pct = total > 0 ? Math.round((completadas / total) * 100) : 0;
  const oppPct = (Number(stats.oportunidades_activas || 0) + Number(stats.oportunidades_completadas || 0));
  const oppDone = oppPct > 0 ? Math.round((Number(stats.oportunidades_completadas || 0) / oppPct) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="mb-6">
        <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-neutral-400 mb-1">Desempeño</div>
        <h2 className="font-display font-black text-3xl tracking-tight text-slate-900">
          Panel de <span className="text-gradient-orange">analytics</span>
        </h2>
        <p className="text-sm text-slate-500 mt-1">Métricas del mes en curso y acumuladas</p>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* Hero: Ingresos */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="md:col-span-3 rounded-3xl p-7 relative overflow-hidden bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] text-white shadow-[0_10px_40px_rgba(15,23,42,0.18)]">
          <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta blur-3xl opacity-40" />
          <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-gradient-to-br from-neon-purple to-brand-orange blur-3xl opacity-30" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-white/60 mb-4">
              <DollarSign className="h-3.5 w-3.5" strokeWidth={2.5} /> Ingresos del mes
            </div>
            <div className="font-display font-black text-6xl tabular-nums text-white">${ingresos.toFixed(0)}</div>
            <div className="mt-2 text-sm text-white/70">Generado por <span className="font-bold text-brand-orange">{stats.puntos_mes || 0}</span> puntos · histórico acumulado <span className="font-bold text-white">{stats.puntos_total || 0}</span></div>
            <div className="mt-6 flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] font-ui font-bold uppercase tracking-wider">
                <Sparkles className="h-3 w-3 text-brand-orange" strokeWidth={2.5} />
                Puntos este mes
              </div>
              <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-brand-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider shadow-lg shadow-brand-orange/30">
                <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
                En progreso
              </div>
            </div>
          </div>
        </motion.div>

        {/* Productividad con ring progress */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="md:col-span-3 rounded-3xl p-7 bg-white border border-slate-200 shadow-[0_4px_30px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-slate-400 mb-4">
            <TrendingUp className="h-3.5 w-3.5 text-brand-green" strokeWidth={2.5} /> Productividad
          </div>
          <div className="flex items-center gap-6">
            <ProgressRing pct={pct} />
            <div className="flex-1">
              <div className="text-[10px] font-ui uppercase tracking-wider text-slate-400 mb-1">Tasa de cierre</div>
              <div className="font-display text-4xl font-black text-slate-900 tabular-nums">{pct}<span className="text-xl text-slate-400">%</span></div>
              <div className="text-[12px] text-slate-500 mt-1">{completadas} de {total} tareas cerradas</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-sky-50 text-sky-700 text-[10px] font-ui font-bold uppercase tracking-wider">{pendientes} pend.</span>
                <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-green-50 text-brand-green text-[10px] font-ui font-bold uppercase tracking-wider">{completadas} hechas</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Tarea pendiente */}
        <MiniCard color="sky" Icon={CheckSquare} label="Pendientes" value={pendientes} sub={`${stats.tareas_completadas_mes || 0} este mes`} delay={0.08} />

        {/* Completadas */}
        <MiniCard color="green" Icon={Check} label="Completadas" value={completadas} sub="Histórico total" delay={0.12} />

        {/* Oportunidades */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          className="md:col-span-2 rounded-3xl p-6 bg-white border border-slate-200 shadow-[0_4px_30px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-slate-400 mb-3">
            <Target className="h-3.5 w-3.5 text-fuchsia-600" strokeWidth={2.5} /> Oportunidades
          </div>
          <div className="flex items-end gap-4">
            <div>
              <div className="font-display text-4xl font-black text-slate-900 tabular-nums">{stats.oportunidades_activas || 0}</div>
              <div className="text-[11px] text-slate-500 font-medium">Activas</div>
            </div>
            <div className="text-slate-300 text-xl">·</div>
            <div>
              <div className="font-display text-4xl font-black text-fuchsia-600 tabular-nums">{stats.oportunidades_completadas || 0}</div>
              <div className="text-[11px] text-slate-500 font-medium">Cerradas</div>
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-orange to-fuchsia-600" style={{ width: `${oppDone}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">{oppDone}% cerradas del total histórico</div>
        </motion.div>
      </div>
    </div>
  );
}

function MiniCard({ color, Icon, label, value, sub, delay = 0 }: any) {
  const map: Record<string, { bg: string; text: string; accent: string }> = {
    sky: { bg: "bg-sky-50", text: "text-sky-700", accent: "bg-sky-500" },
    green: { bg: "bg-green-50", text: "text-brand-green", accent: "bg-brand-green" },
    orange: { bg: "bg-orange-50", text: "text-brand-orange", accent: "bg-brand-orange" },
    fuchsia: { bg: "bg-fuchsia-50", text: "text-fuchsia-700", accent: "bg-fuchsia-600" },
  };
  const c = map[color] || map.sky;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="md:col-span-2 rounded-3xl p-6 bg-white border border-slate-200 shadow-[0_4px_30px_rgba(15,23,42,0.05)] relative overflow-hidden">
      <div className={cn("absolute top-0 left-0 h-1 w-full", c.accent)} />
      <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-slate-400 mb-3">
        <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", c.bg)}>
          <Icon className={cn("h-3.5 w-3.5", c.text)} strokeWidth={2.5} />
        </div>
        {label}
      </div>
      <div className="font-display text-4xl font-black text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </motion.div>
  );
}

function ProgressRing({ pct, size = 96 }: { pct: number; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width={size} height={size} className="shrink-0">
      <defs>
        <linearGradient id="pr-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5750E8" />
          <stop offset="100%" stopColor="#D946EF" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#E2E8F0" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="url(#pr-grad)" strokeWidth={stroke} fill="none"
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

// =====================================================================
// TAB: Tiempo de trabajo — 2026
// =====================================================================
function TiempoTab({ userId }: { userId: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    setData(null);
    fetch(`/api/users/${userId}/clock-semana`).then((r) => r.json()).then(setData);
  }, [userId]);
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>;
  const entries: any[] = data.entries || [];
  const totalMin = entries.reduce((s, e) => s + (e.minutos_totales || 0), 0);
  const totalBreaks = entries.reduce((s, e) => s + (e.total_break_min || 0), 0);
  const tardes = entries.filter((e) => e.fue_tarde).length;
  const fmtHM = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

  const Stat = ({ label, value, color, accent, Icon, delay = 0 }: any) => (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="rounded-3xl p-5 bg-white border border-slate-200 shadow-[0_4px_30px_rgba(15,23,42,0.05)] relative overflow-hidden">
      <div className={cn("absolute top-0 left-0 h-1 w-full", accent)} />
      <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.2em] text-slate-400 mb-3">
        <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", accent, "opacity-15")}>
          <Icon className={cn("h-3.5 w-3.5", color)} strokeWidth={2.5} />
        </div>
        {label}
      </div>
      <div className={cn("font-display text-3xl font-black tabular-nums", color)}>{value}</div>
    </motion.div>
  );

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="mb-6">
        <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-neutral-400 mb-1">Control horario · 14 días</div>
        <h2 className="font-display font-black text-3xl tracking-tight text-slate-900">
          Tiempo de <span className="text-gradient-orange">trabajo</span>
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Horas trabajadas" value={fmtHM(totalMin)} color="text-brand-orange" accent="bg-brand-orange" Icon={ClockIcon} delay={0} />
        <Stat label="Breaks acumulados" value={fmtHM(totalBreaks)} color="text-sky-600" accent="bg-sky-500" Icon={ClockIcon} delay={0.04} />
        <Stat label="Racha puntualidad" value={data.racha || 0} color="text-brand-green" accent="bg-brand-green" Icon={Check} delay={0.08} />
        <Stat label="Llegadas tarde" value={tardes} color={tardes > 0 ? "text-red-600" : "text-slate-400"} accent="bg-red-500" Icon={AlertCircle} delay={0.12} />
      </div>

      {entries.length === 0 ? (
        <div className="rounded-3xl bg-white border border-dashed border-slate-200 py-16 text-center shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-orange/15 to-neon-magenta/10 mb-3">
            <ClockIcon className="h-7 w-7 text-brand-orange" strokeWidth={1.8} />
          </div>
          <div className="font-display font-black text-lg text-slate-900">Sin registros</div>
          <p className="text-sm text-slate-500 mt-1">No hay entradas en los últimos 14 días</p>
        </div>
      ) : (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-[0_4px_30px_rgba(15,23,42,0.05)] divide-y divide-slate-100 overflow-hidden">
          {entries.map((e, i) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/60 transition"
            >
              <div className={cn("h-11 w-11 rounded-2xl flex items-center justify-center shrink-0",
                e.fue_tarde ? "bg-red-50 text-red-600" : "bg-green-50 text-brand-green")}>
                <ClockIcon className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-display font-bold text-slate-900 capitalize">
                  {fmtFechaSolo(e.fecha_local, { weekday: "long", day: "numeric", month: "short" })}
                </div>
                <div className="text-[12px] text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                  <span>Entrada <span className="font-semibold text-slate-700">{new Date(e.entrada_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span></span>
                  {e.salida_at ? (
                    <span>· Salida <span className="font-semibold text-slate-700">{new Date(e.salida_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span></span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-brand-green"><span className="h-1.5 w-1.5 rounded-full bg-brand-green animate-pulse" /> en curso</span>
                  )}
                  {e.fue_tarde && e.minutos_tarde > 0 && <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded bg-red-100 text-red-700 font-ui text-[10px] font-bold">+{e.minutos_tarde}m tarde</span>}
                  {e.total_break_min > 0 && <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded bg-sky-100 text-sky-700 font-ui text-[10px] font-bold">break {e.total_break_min}m</span>}
                </div>
              </div>
              {e.minutos_totales > 0 && (
                <div className="text-right">
                  <div className="font-display text-lg font-black text-slate-900 tabular-nums">{fmtHM(e.minutos_totales)}</div>
                  <div className="text-[10px] font-ui uppercase tracking-wider text-slate-400">total</div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Modal Seguridad · 2026 top design
// =====================================================================
function passwordScore(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!p) return { score: 0, label: "—", color: "bg-slate-300" };
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  const m = [
    { label: "débil", color: "bg-red-500" },
    { label: "baja", color: "bg-orange-500" },
    { label: "ok", color: "bg-amber-400" },
    { label: "fuerte", color: "bg-emerald-500" },
    { label: "top", color: "bg-gradient-to-r from-emerald-500 via-brand-orange to-neon-magenta" }
  ];
  const idx = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  return { score: idx, label: m[idx].label, color: m[idx].color };
}

function PasswordField({
  label, value, onChange, placeholder, autoFocus, valid, invalid,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
  valid?: boolean; invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-slate-500 block mb-1.5">{label}</label>
      <div className="relative group">
        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-brand-orange transition-colors" strokeWidth={1.8} />
        <input
          type={show ? "text" : "password"}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full h-12 pl-10 pr-20 rounded-xl border-2 bg-white text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400",
            valid ? "border-emerald-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              : invalid ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/15"
          )}
        />
        {(valid || invalid) && (
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            className={cn(
              "absolute right-11 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full flex items-center justify-center",
              valid ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
            )}
          >
            {valid ? <Check className="h-3 w-3" strokeWidth={3.5} /> : <X className="h-3 w-3" strokeWidth={3.5} />}
          </motion.div>
        )}
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-900 text-white shadow-sm active:scale-95 transition flex items-center justify-center"
        >
          <motion.div
            key={show ? "off" : "on"}
            initial={{ opacity: 0, rotate: -25, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
          >
            {show ? <EyeOff className="h-4 w-4" strokeWidth={2} /> : <Eye className="h-4 w-4" strokeWidth={2} />}
          </motion.div>
        </button>
      </div>
    </div>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const strength = passwordScore(next);
  const confirmMatch = confirm.length > 0 && confirm === next;
  const confirmMismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length >= 8 && confirmMatch && !saving;

  const submit = async () => {
    if (next.length < 8) { toast.error("Mínimo 8 caracteres"); return; }
    if (next !== confirm) { toast.error("Las contraseñas no coinciden"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      setDone(true);
      setTimeout(() => { onClose(); toast.success("Contraseña actualizada con éxito"); }, 1400);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={() => !saving && onClose()}
      >
        {/* Ambient backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
        <div className="absolute inset-0 pointer-events-none opacity-60"
          style={{ backgroundImage: "radial-gradient(ellipse at 25% 20%, rgba(87,80,232,0.25), transparent 55%), radial-gradient(ellipse at 75% 80%, rgba(131,56,236,0.22), transparent 55%)" }} />

        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 18, filter: "blur(10px)" }}
          animate={{ scale: 1, opacity: 1, y: 0, filter: "blur(0)" }}
          exit={{ scale: 0.94, opacity: 0, y: 10 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-md rounded-3xl bg-white border border-black/5 shadow-[0_30px_90px_rgba(15,23,42,0.25)] overflow-hidden"
        >
          {/* Animated border beam */}
          <div className="pointer-events-none absolute inset-0 rounded-3xl border-beam opacity-50" />

          {/* Header */}
          <div className="relative p-6 pb-5 flex items-center gap-3 border-b border-slate-100">
            <motion.div
              initial={{ rotate: -8, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.1 }}
              className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-lg shadow-brand-orange/35"
            >
              <ShieldCheck className="h-6 w-6 text-white" strokeWidth={2} />
              <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
              </div>
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-brand-orange font-bold">Seguridad de cuenta</div>
              <h3 className="font-display font-black text-xl text-slate-900 leading-tight">Cambiar contraseña</h3>
            </div>
            <button onClick={onClose} disabled={saving} className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 disabled:opacity-50 transition">
              <X className="h-4 w-4" />
            </button>
          </div>

          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="p-10 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1, rotate: [0, -10, 10, 0] }}
                  transition={{ type: "spring", stiffness: 280, damping: 14 }}
                  className="mx-auto h-20 w-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_20px_60px_rgba(16,185,129,0.4)] mb-4"
                >
                  <Check className="h-10 w-10 text-white" strokeWidth={3.5} />
                </motion.div>
                <div className="font-display font-black text-xl text-slate-900 mb-1">¡Listo!</div>
                <p className="text-sm text-slate-500">Tu contraseña fue actualizada correctamente.</p>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(); }}
                className="p-6 pt-5 space-y-4"
              >
                <PasswordField
                  label="Contraseña actual"
                  value={current} onChange={setCurrent}
                  placeholder="La que usas hoy"
                  autoFocus
                />

                <div>
                  <PasswordField
                    label="Nueva contraseña"
                    value={next} onChange={setNext}
                    placeholder="Mínimo 8 caracteres"
                    valid={next.length >= 12 && strength.score >= 3}
                  />
                  {next.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        {[0, 1, 2, 3].map((i) => (
                          <div key={i} className={cn(
                            "h-1.5 flex-1 rounded-full transition-all duration-300",
                            i < strength.score ? strength.color : "bg-slate-200"
                          )} />
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-ui uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <div className={cn("flex items-center gap-1", /[A-Z]/.test(next) ? "text-emerald-600" : "text-slate-400")}>
                            {/[A-Z]/.test(next) ? <Check className="h-3 w-3" strokeWidth={3}/> : <X className="h-3 w-3" />} Mayúsc
                          </div>
                          <div className={cn("flex items-center gap-1", /\d/.test(next) ? "text-emerald-600" : "text-slate-400")}>
                            {/\d/.test(next) ? <Check className="h-3 w-3" strokeWidth={3}/> : <X className="h-3 w-3" />} Nº
                          </div>
                          <div className={cn("flex items-center gap-1", /[^A-Za-z0-9]/.test(next) ? "text-emerald-600" : "text-slate-400")}>
                            {/[^A-Za-z0-9]/.test(next) ? <Check className="h-3 w-3" strokeWidth={3}/> : <X className="h-3 w-3" />} Símb
                          </div>
                        </div>
                        <span className="font-bold text-slate-700">{strength.label}</span>
                      </div>
                    </motion.div>
                  )}
                </div>

                <PasswordField
                  label="Confirmar contraseña"
                  value={confirm} onChange={setConfirm}
                  placeholder="Vuelve a escribirla"
                  valid={confirmMatch}
                  invalid={confirmMismatch}
                />

                <div className="pt-2 flex items-center gap-2">
                  <button type="button" onClick={onClose}
                    className="h-11 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-ui text-[11px] font-bold uppercase tracking-wider transition">
                    Cancelar
                  </button>
                  <motion.button
                    type="submit"
                    disabled={!canSubmit}
                    whileTap={canSubmit ? { scale: 0.98 } : undefined}
                    className={cn(
                      "flex-1 h-11 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_8px_24px_rgba(87,80,232,0.35)] transition flex items-center justify-center gap-2",
                      canSubmit ? "bg-gradient-to-r from-brand-orange to-neon-magenta hover:shadow-[0_12px_30px_rgba(87,80,232,0.5)]" : "bg-slate-300 cursor-not-allowed shadow-none"
                    )}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    {saving ? "Actualizando…" : "Actualizar contraseña"}
                  </motion.button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function InfoRow({ label, value, wide, highlighted }: { label: string; value: string | null; wide?: boolean; highlighted?: boolean }) {
  return (
    <div className={cn(wide && "md:col-span-2")}>
      <div className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/40 mb-1">{label}</div>
      {value ? (
        <div className={cn("text-sm", highlighted ? "text-brand-orange bg-brand-orange/10 px-2 py-1 rounded-md inline-block" : "text-white/90")}>{value}</div>
      ) : (
        <div className="text-sm text-white/30 italic">el campo está vacío</div>
      )}
    </div>
  );
}

function EditProfileModal({ user, onClose, onSaved, isSuperAdmin, mode }: { user: ProfileUser; onClose: () => void; onSaved: (u: ProfileUser) => void; isSuperAdmin: boolean; mode: "owner" | "admin" }) {
  const [form, setForm] = useState<any>({
    nombre: user.nombre,
    telefono: user.telefono || "",
    telefono_personal: user.telefono_personal || "",
    departamento: user.departamento || "",
    cumpleanos: user.cumpleanos ? user.cumpleanos.slice(0, 10) : "",
    genero: user.genero || "",
    bio: user.bio || "",
    posiciones: user.posiciones?.[0] || "",
    nivel_acceso: user.nivel_acceso,
    activo: user.activo,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body: any = { ...form };
      if (body.cumpleanos === "") body.cumpleanos = null;
      const endpoint = mode === "owner" ? "/api/users/me" : `/api/admin/users/${user.id}`;
      if (mode === "owner") {
        // Owner whitelist: nombre, telefono, telefono_personal, cumpleanos, genero, bio, zona_horaria
        delete body.posiciones;
        delete body.departamento;
        delete body.nivel_acceso;
        delete body.activo;
      } else {
        body.posiciones = form.posiciones ? [form.posiciones] : [];
        if (!isSuperAdmin) { delete body.nivel_acceso; delete body.activo; }
        if (body.nivel_acceso === "super_admin") delete body.nivel_acceso;
      }
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error guardando");
      toast.success("Perfil actualizado");
      const r2 = await fetch(`/api/users/${user.id}`);
      const d2 = await r2.json();
      onSaved(d2.user || { ...user, ...body });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const [pwdOpen, setPwdOpen] = useState(false);
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const changePassword = async () => {
    if (!curPwd || !newPwd) { toast.error("Ambas contrasenas son requeridas"); return; }
    if (newPwd.length < 8) { toast.error("Nueva contrasena minimo 8 caracteres"); return; }
    setPwdSaving(true);
    try {
      const r = await fetch("/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      toast.success("Contrasena actualizada");
      setCurPwd(""); setNewPwd(""); setPwdOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin modal-surface"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display text-2xl font-black">Editar perfil</h3>
            <button onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-white/10 flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nombre completo" value={form.nombre} onChange={(v: string) => setForm({ ...form, nombre: v })} wide />
            <Field label="Teléfono móvil" value={form.telefono_personal} onChange={(v: string) => setForm({ ...form, telefono_personal: v })} />
            <Field label="Teléfono trabajo" value={form.telefono} onChange={(v: string) => setForm({ ...form, telefono: v })} />
            {mode === "admin" && <Field label="Departamento" value={form.departamento} onChange={(v: string) => setForm({ ...form, departamento: v })} />}
            {mode === "admin" && <Field label="Posición" value={form.posiciones} onChange={(v: string) => setForm({ ...form, posiciones: v })} />}
            <Field label="Fecha de nacimiento" type="date" value={form.cumpleanos} onChange={(v: string) => setForm({ ...form, cumpleanos: v })} />
            <div>
              <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 mb-1 block">Sexo</label>
              <select value={form.genero} onChange={(e) => setForm({ ...form, genero: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange">
                <option value="">—</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </div>
            <Field label="Bio" value={form.bio} onChange={(v: string) => setForm({ ...form, bio: v })} wide textarea />
            {isSuperAdmin && user.nivel_acceso !== "super_admin" && (
              <>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 mb-1 block">Nivel</label>
                  <select value={form.nivel_acceso} onChange={(e) => setForm({ ...form, nivel_acceso: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange">
                    <option value="usuario">Usuario</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 mb-1 block">Estado</label>
                  <select value={form.activo ? "1" : "0"} onChange={(e) => setForm({ ...form, activo: e.target.value === "1" })} className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange">
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {mode === "owner" && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <button onClick={() => setPwdOpen((v) => !v)} className="w-full text-left text-xs font-ui uppercase tracking-wider text-brand-orange hover:text-brand-orange/80 mb-3">
                {pwdOpen ? "Ocultar" : "Cambiar contrasena"}
              </button>
              {pwdOpen && (
                <div className="space-y-3">
                  <Field label="Contrasena actual" type="password" value={curPwd} onChange={(v: string) => setCurPwd(v)} />
                  <Field label="Nueva contrasena (min 8)" type="password" value={newPwd} onChange={(v: string) => setNewPwd(v)} />
                  <button onClick={changePassword} disabled={pwdSaving} className="w-full h-11 rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider hover:bg-white/10 disabled:opacity-60">
                    {pwdSaving ? "Actualizando..." : "Actualizar contrasena"}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 h-11 rounded-xl bg-white/5 border border-white/10 font-ui text-xs font-bold uppercase tracking-wider hover:bg-white/10">Cancelar</button>
            <button onClick={save} disabled={saving} className="flex-1 h-11 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta font-ui text-xs font-bold uppercase tracking-wider text-white shadow-xl disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4" /> Guardar</>}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Field({ label, value, onChange, type = "text", wide = false, textarea = false }: any) {
  return (
    <div className={cn(wide && "md:col-span-2")}>
      <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 mb-1 block">{label}</label>
      {textarea ? (
        <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange resize-none" />
      ) : (
        <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange" />
      )}
    </div>
  );
}
