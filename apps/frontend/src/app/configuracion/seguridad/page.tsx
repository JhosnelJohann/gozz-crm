"use client";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Sparkles, ArrowLeft, Monitor, X, RefreshCw, Loader2, User, AlertTriangle, LogOut } from "@/lib/bootstrap-icons";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";

interface Sesion {
  id: string;
  user_id: string;
  nombre?: string;
  email?: string;
  foto_perfil_url?: string;
  dispositivo: string | null;
  ip: string | null;
  user_agent: string | null;
  ultimo_ping: string | null;
  activa: boolean;
  expira_at: string;
  created_at: string;
}

interface Auditoria {
  id: string;
  accion: string;
  tabla_afectada: string | null;
  registro_id: string | null;
  created_at: string;
  ip: string | null;
  user_nombre: string | null;
  user_email: string | null;
}

type Tab = "sesiones" | "auditoria";

export default function SeguridadPage() {
  const { isAdmin, user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("sesiones");
  const [sesiones, setSesiones] = useState<Sesion[]>([]);
  const [auditoria, setAuditoria] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "sesiones") {
        const r = await fetch(`/api/seguridad/sesiones?scope=${scope}`);
        const d = await r.json();
        setSesiones(d.sesiones || []);
      } else {
        const r = await fetch("/api/seguridad/auditoria?limit=100");
        if (r.ok) {
          const d = await r.json();
          setAuditoria(d.auditoria || []);
        }
      }
    } catch {} finally { setLoading(false); }
  }, [tab, scope]);

  useEffect(() => { load(); }, [load]);

  const cerrar = async (id: string) => {
    if (!confirm("¿Cerrar esta sesión?")) return;
    const r = await fetch(`/api/seguridad/sesiones/${id}`, { method: "DELETE" });
    if (!r.ok) { const e = await r.json(); toast.error(e.error); return; }
    toast.success("Sesión cerrada");
    load();
  };

  const parseUA = (ua: string | null) => {
    if (!ua) return { browser: "Desconocido", os: "" };
    const browser = /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : /Edge/i.test(ua) ? "Edge" : "Browser";
    const os = /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
    return { browser, os };
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/configuracion" className="flex items-center gap-2 text-xs text-neutral-500 hover:text-brand-orange font-ui uppercase tracking-wider mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a configuración
        </Link>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.12em] mb-3">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            Privacidad
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-black leading-tight tracking-tight">
            <span className="text-gradient-orange">Seguridad</span>
          </h1>
          <p className="mt-3 text-neutral-500 text-[15px]">Sesiones activas y auditoría de acciones.</p>
        </motion.div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 mb-4 w-fit">
          <TabBtn active={tab === "sesiones"} onClick={() => setTab("sesiones")}>Sesiones activas</TabBtn>
          {isAdmin && <TabBtn active={tab === "auditoria"} onClick={() => setTab("auditoria")}>Auditoría</TabBtn>}
        </div>

        {tab === "sesiones" && (
          <>
            {isAdmin && (
              <div className="flex items-center gap-1 p-1 rounded-xl bg-white border border-neutral-100 w-fit mb-4">
                <button onClick={() => setScope("mine")} className={cn("h-8 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider", scope === "mine" ? "bg-brand-orange text-white" : "text-neutral-500")}>Mías</button>
                <button onClick={() => setScope("all")} className={cn("h-8 px-3 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wider", scope === "all" ? "bg-brand-orange text-white" : "text-neutral-500")}>Todas</button>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-neutral-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-black text-[15px]">{sesiones.length} sesione{sesiones.length !== 1 ? "s" : ""} registrada{sesiones.length !== 1 ? "s" : ""}</h3>
                <button onClick={load} className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-500"><RefreshCw className="h-4 w-4" /></button>
              </div>
              {loading ? (
                <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline text-neutral-400" /></div>
              ) : sesiones.length === 0 ? (
                <div className="text-center py-10 text-[12px] text-neutral-400">
                  <ShieldCheck className="h-8 w-8 mx-auto mb-2" strokeWidth={1.5} />
                  Sin sesiones registradas
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sesiones.map((s) => {
                    const ua = parseUA(s.user_agent);
                    const activa = s.activa && new Date(s.expira_at) > new Date();
                    return (
                      <motion.div
                        key={s.id}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        className={cn("bg-neutral-50/60 rounded-xl px-4 py-3 border border-neutral-100 flex items-center gap-3", !activa && "opacity-60")}
                      >
                        <div className="h-10 w-10 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center shrink-0">
                          <Monitor className="h-5 w-5" strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {scope === "all" && s.nombre && (
                            <div className="flex items-center gap-2 mb-0.5">
                              {s.foto_perfil_url
                                ? <img src={s.foto_perfil_url} className="h-4 w-4 rounded-full object-cover" alt="" />
                                : <div className="h-4 w-4 rounded-full bg-brand-orange text-white text-[7px] font-bold flex items-center justify-center">{initialsOf(s.nombre)}</div>}
                              <span className="text-sm font-semibold truncate">{s.nombre}</span>
                              <span className="text-[10px] text-neutral-400 truncate">{s.email}</span>
                            </div>
                          )}
                          <div className="text-sm font-semibold">{ua.browser} · {ua.os || s.dispositivo || "Desconocido"}</div>
                          <div className="text-[11px] text-neutral-500 flex items-center gap-2 flex-wrap">
                            {s.ip && <span>{s.ip}</span>}
                            {s.ultimo_ping && <span>· Último ping {new Date(s.ultimo_ping).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                            <span className={cn("text-[10px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md", activa ? "bg-brand-green/10 text-brand-green" : "bg-neutral-200 text-neutral-500")}>
                              {activa ? "activa" : "cerrada"}
                            </span>
                          </div>
                        </div>
                        {activa && (s.user_id === user?.id || isAdmin) && (
                          <button onClick={() => cerrar(s.id)} className="h-9 px-3 rounded-lg bg-brand-red/10 text-brand-red text-[10px] font-ui font-bold uppercase tracking-wider hover:bg-brand-red/15 flex items-center gap-1.5">
                            <LogOut className="h-3 w-3" strokeWidth={2} />
                            Cerrar
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {tab === "auditoria" && (
          isAdmin ? (
            <div className="bg-white rounded-2xl border border-neutral-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-black text-[15px]">{auditoria.length} eventos de auditoría</h3>
                <button onClick={load} className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-500"><RefreshCw className="h-4 w-4" /></button>
              </div>
              {loading ? (
                <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline text-neutral-400" /></div>
              ) : auditoria.length === 0 ? (
                <div className="text-center py-10 text-[12px] text-neutral-400">Sin eventos auditados</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500 font-ui">
                        <th className="pb-2">Cuándo</th>
                        <th className="pb-2">Usuario</th>
                        <th className="pb-2">Acción</th>
                        <th className="pb-2">Tabla</th>
                        <th className="pb-2">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditoria.map((a) => (
                        <tr key={a.id} className="border-b border-neutral-50">
                          <td className="py-1.5 whitespace-nowrap text-[11px]">{new Date(a.created_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="py-1.5">{a.user_nombre || <span className="text-neutral-400">sistema</span>}</td>
                          <td className="py-1.5 font-semibold">{a.accion}</td>
                          <td className="py-1.5 text-neutral-500">{a.tabla_afectada || "—"}</td>
                          <td className="py-1.5 font-mono text-[10px] text-neutral-400">{a.ip || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-neutral-100 p-10 text-center">
              <AlertTriangle className="h-10 w-10 text-brand-red mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-neutral-500">Solo admin puede ver la auditoría</p>
            </div>
          )
        )}
      </div>
    </AppShell>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("h-9 px-4 rounded-lg font-ui text-[11px] font-bold uppercase tracking-wider transition-all", active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800")}>
      {children}
    </button>
  );
}
