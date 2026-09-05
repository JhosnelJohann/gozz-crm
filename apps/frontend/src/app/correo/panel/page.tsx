"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, WifiOff, Trash, Users, ArrowLeft, Inbox, AlertCircle, CheckCircle2, Pencil, Plus } from "@/lib/bootstrap-icons";
import { AppShell } from "@/components/AppShell";
import { ConnectMailboxModal } from "@/components/correo/ConnectMailboxModal";
import { BuzonACLModal } from "@/components/correo/BuzonACLModal";
import { EditConnectionModal } from "@/components/correo/EditConnectionModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useCurrentUser } from "@/lib/auth-user";
import { cn } from "@/lib/utils";

interface PanelBuzon {
  id: string; email: string; display_name: string | null; imap_host: string;
  activo: boolean; auth_type: string | null; errores_consecutivos: number;
  ultimo_error: string | null; requiere_auth_update: boolean; ultimo_sync: string | null;
  owner_nombre: string | null; owner_email: string | null;
  total_correos: number; ultimo_correo: string | null;
}

type Estado = { key: string; label: string; dot: string; text: string };
function estadoDe(b: PanelBuzon): Estado {
  if (!b.activo) return { key: "inactivo", label: "Inactivo", dot: "bg-neutral-400", text: "text-neutral-500" };
  if (b.requiere_auth_update) return { key: "auth", label: "Reconectar", dot: "bg-amber-500", text: "text-amber-600" };
  if (Number(b.errores_consecutivos) > 0) return { key: "error", label: "Con error", dot: "bg-brand-red", text: "text-brand-red" };
  if (b.ultimo_sync && Date.now() - new Date(b.ultimo_sync).getTime() < 10 * 60 * 1000)
    return { key: "ok", label: "OK", dot: "bg-brand-green", text: "text-brand-green" };
  return { key: "espera", label: "En espera", dot: "bg-neutral-300", text: "text-neutral-400" };
}

const fmtFecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default function PanelCorreosPage() {
  const { isAdmin, loading: loadingUser } = useCurrentUser();
  const [buzones, setBuzones] = useState<PanelBuzon[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [reconectar, setReconectar] = useState<{ email: string } | null>(null);
  const [connectFresh, setConnectFresh] = useState(false); // modal SIN prefill: conectar uno nuevo, o reconectar un OAuth
  const [desvincularTarget, setDesvincularTarget] = useState<{ id: string; email: string } | null>(null);
  const [desvinculando, setDesvinculando] = useState(false);
  const [aclBuzon, setAclBuzon] = useState<string | null>(null);
  const [editConexionId, setEditConexionId] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/buzones/panel");
      if (!r.ok) { if (r.status === 403) setBuzones([]); return; }
      const d = await r.json();
      setBuzones(d.buzones || []);
    } catch { /* transitorio: no romper la vista */ } finally { setLoading(false); }
  };
  useEffect(() => { if (isAdmin) load(); else if (!loadingUser) setLoading(false); /* eslint-disable-next-line */ }, [isAdmin, loadingUser]);

  const resumen = useMemo(() => ({
    total: buzones.length,
    activos: buzones.filter((b) => b.activo).length,
    conError: buzones.filter((b) => b.activo && Number(b.errores_consecutivos) > 0 && !b.requiere_auth_update).length,
    reconectar: buzones.filter((b) => b.requiere_auth_update).length,
  }), [buzones]);

  const sync = async (id: string) => {
    setSyncing((s) => new Set(s).add(id));
    try {
      await fetch(`/api/buzones/${id}/sync`, { method: "POST" });
      toast.info("Sincronizando…");
      setTimeout(load, 4000);
    } finally {
      setTimeout(() => setSyncing((s) => { const n = new Set(s); n.delete(id); return n; }), 4000);
    }
  };
  const desvincular = (id: string, email: string) => setDesvincularTarget({ id, email });
  const confirmDesvincular = async () => {
    if (!desvincularTarget) return;
    const { id } = desvincularTarget;
    setDesvinculando(true);
    try {
      const r = await fetch(`/api/buzones/${id}`, { method: "DELETE" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "No se pudo"); }
      toast.success("Buzón desvinculado");
      setDesvincularTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setDesvinculando(false); }
  };

  if (!loadingUser && !isAdmin) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto px-6 py-20 text-center">
          <div className="h-12 w-12 rounded-2xl bg-brand-red/10 text-brand-red flex items-center justify-center mx-auto mb-4"><AlertCircle className="h-6 w-6" /></div>
          <h1 className="font-display text-xl font-black">Solo administradores</h1>
          <p className="text-sm text-neutral-500 mt-1">El panel de control de correos está reservado a admins.</p>
          <Link href="/correo" className="inline-flex items-center gap-1.5 mt-5 text-sm font-bold text-brand-orange hover:underline"><ArrowLeft className="h-4 w-4" /> Volver a Correo</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/correo" title="Volver a Correo" className="h-10 w-10 rounded-xl bg-white/70 hover:bg-white text-neutral-500 hover:text-brand-orange flex items-center justify-center transition shrink-0"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="h-10 w-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center"><Inbox className="h-5 w-5" /></div>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-black">Panel de correos</h1>
            <p className="text-[11px] text-neutral-500">Salud de todos los buzones conectados al CRM.</p>
          </div>
          {/* El modal en modo NUEVO ya estaba montado y cableado a `connectFresh`… pero nada ponía
              esa bandera en `true`: era estado muerto y desde el panel solo se podía RECONECTAR uno
              existente. Este botón es lo único que faltaba.
              No lleva control de permiso propio: la página entera ya es admin-only unas líneas más
              arriba, y añadir una segunda comprobación aquí sería otro sitio del que acordarse. */}
          <button
            onClick={() => setConnectFresh(true)}
            className="h-9 px-3 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-brand-orange/90 transition"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Conectar buzón
          </button>
          <button onClick={load} className="h-9 px-3 rounded-xl bg-white/70 hover:bg-white text-neutral-600 text-xs font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-brand-orange")} /> Recargar
          </button>
        </div>

        {/* Tarjetas resumen */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <ResumenCard label="Buzones" value={resumen.total} Icon={Inbox} color="#0F172A" />
          <ResumenCard label="Activos" value={resumen.activos} Icon={CheckCircle2} color="#43A847" />
          <ResumenCard label="Con error" value={resumen.conError} Icon={AlertCircle} color="#E53935" />
          <ResumenCard label="Reconectar" value={resumen.reconectar} Icon={WifiOff} color="#D97706" />
        </div>

        <div className="glass rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-ui uppercase tracking-wider text-neutral-400 border-b border-black/5">
                  <th className="text-left font-bold px-4 py-3">Correo</th>
                  <th className="text-left font-bold px-4 py-3">Dueño</th>
                  <th className="text-left font-bold px-4 py-3">Estado</th>
                  <th className="text-left font-bold px-4 py-3">Últ. sync</th>
                  <th className="text-left font-bold px-4 py-3">Últ. correo</th>
                  <th className="text-center font-bold px-4 py-3">Correos</th>
                  <th className="text-left font-bold px-4 py-3">Servidor</th>
                  <th className="text-center font-bold px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-10 text-neutral-400">Cargando…</td></tr>
                ) : buzones.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-neutral-400">No hay buzones</td></tr>
                ) : buzones.map((b) => {
                  const est = estadoDe(b);
                  return (
                    <tr key={b.id} className={cn("border-b border-black/[0.03] hover:bg-black/[0.015]", !b.activo && "opacity-60")}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-[13px] truncate max-w-[220px]">{b.display_name || b.email.split("@")[0]}</div>
                        <div className="text-[11px] text-neutral-400 truncate max-w-[220px]">{b.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[12px] text-neutral-600 truncate max-w-[160px]">{b.owner_nombre || "—"}</div>
                        <div className="text-[10px] text-neutral-400 truncate max-w-[160px]">{b.owner_email || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5" title={est.key === "error" ? (b.ultimo_error || "") : undefined}>
                          <span className={cn("h-2 w-2 rounded-full", est.dot)} />
                          <span className={cn("text-[11px] font-ui font-bold uppercase tracking-wider", est.text)}>{est.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-neutral-500 whitespace-nowrap">{fmtFecha(b.ultimo_sync)}</td>
                      <td className="px-4 py-3 text-[12px] text-neutral-500 whitespace-nowrap">{fmtFecha(b.ultimo_correo)}</td>
                      <td className="px-4 py-3 text-center text-[12px] font-bold tabular-nums text-neutral-600">{Number(b.total_correos).toLocaleString("es")}</td>
                      <td className="px-4 py-3 text-[11px] text-neutral-400 truncate max-w-[160px]">{b.imap_host}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <IconBtn title="Sincronizar ahora" onClick={() => sync(b.id)} disabled={!b.activo}>
                            <RefreshCw className={cn("h-3.5 w-3.5", syncing.has(b.id) && "animate-spin text-brand-orange")} />
                          </IconBtn>
                          {b.requiere_auth_update && (
                            <IconBtn title="Reconectar" className="text-brand-red hover:bg-brand-red/10"
                              onClick={() => {
                                if (b.auth_type === "oauth2_google") { setConnectFresh(true); toast.info("Reconecta con el botón de Gmail (Google)."); }
                                else setReconectar({ email: b.email });
                              }}>
                              <WifiOff className="h-3.5 w-3.5" />
                            </IconBtn>
                          )}
                          <IconBtn title="Editar conexión" onClick={() => setEditConexionId(b.id)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn title="Ver accesos" onClick={() => setAclBuzon(b.id)}>
                            <Users className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn title="Desvincular" onClick={() => desvincular(b.id, b.email)} disabled={!b.activo} className="hover:bg-brand-red/10 hover:text-brand-red">
                            <Trash className="h-3.5 w-3.5" />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(reconectar || connectFresh) && (
        <ConnectMailboxModal
          prefill={reconectar}
          onClose={() => { setReconectar(null); setConnectFresh(false); }}
          onConnected={() => { setReconectar(null); setConnectFresh(false); load(); }}
        />
      )}
      {aclBuzon && <BuzonACLModal buzonId={aclBuzon} onClose={() => setAclBuzon(null)} />}
      {editConexionId && (
        <EditConnectionModal
          buzonId={editConexionId}
          onClose={() => setEditConexionId(null)}
          onSaved={() => { setEditConexionId(null); load(); }}
        />
      )}

      {desvincularTarget && (
        <ConfirmDialog
          danger
          icon={<Trash className="h-5 w-5" />}
          title="Desvincular buzón"
          message={<>¿Desvincular <strong className="text-neutral-800 dark:text-neutral-100">{desvincularTarget.email}</strong>? Dejará de sincronizar; el historial de correos se conserva.</>}
          confirmLabel="Desvincular"
          busy={desvinculando}
          onConfirm={confirmDesvincular}
          onCancel={() => setDesvincularTarget(null)}
        />
      )}
    </AppShell>
  );
}

function ResumenCard({ label, value, Icon, color }: { label: string; value: number; Icon: any; color: string }) {
  return (
    <div className="glass rounded-2xl p-4 flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + "1A", color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-black font-display tabular-nums leading-none" style={{ color }}>{value}</div>
        <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-400 mt-1">{label}</div>
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, className }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={cn("h-8 w-8 rounded-lg text-neutral-500 hover:bg-black/5 flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed", className)}>
      {children}
    </button>
  );
}
