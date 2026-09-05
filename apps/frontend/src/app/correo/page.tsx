"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Plus, Gauge } from "@/lib/bootstrap-icons";
import { getSocket } from "@/lib/socket";
import { useCurrentUser } from "@/lib/auth-user";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BuzonesRail, Buzon } from "@/components/correo/BuzonesRail";
import { EmailActionsBar } from "@/components/correo/EmailActionsBar";
import { EmailList, EmailItem } from "@/components/correo/EmailList";
import { EmailDetailDrawer } from "@/components/correo/EmailDetailDrawer";
import { ComposerDrawer } from "@/components/correo/ComposerDrawer";
import { ConnectMailboxModal } from "@/components/correo/ConnectMailboxModal";
import { BuzonACLModal } from "@/components/correo/BuzonACLModal";
import { EditConnectionModal } from "@/components/correo/EditConnectionModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Users, Trash2 } from "@/lib/bootstrap-icons";

export default function CorreoPage() {
  const [buzones, setBuzones] = useState<Buzon[]>([]);
  const [unreadByBuzon, setUnreadByBuzon] = useState<Record<string, number>>({});
  const [activeBuzonId, setActiveBuzonId] = useState<string | null>(null);
  const [folder, setFolder] = useState("INBOX");
  const [emails, setEmails] = useState<EmailItem[] | null>(null);
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);
  const [aclModalOpen, setAclModalOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectPrefill, setConnectPrefill] = useState<{ email?: string } | null>(null);
  const [desvincularTarget, setDesvincularTarget] = useState<{ id: string; email: string } | null>(null);
  const [desvinculando, setDesvinculando] = useState(false);
  const [editConexionId, setEditConexionId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] = useState<any | null>(null);

  const { isAdmin } = useCurrentUser();
  const activeBuzon = useMemo(() => buzones.find((b) => b.id === activeBuzonId), [buzones, activeBuzonId]);

  const loadBuzones = async (retry = 0) => {
    try {
      const r = await fetch("/api/buzones");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const list: Buzon[] = d.buzones || [];
      setBuzones(list);
      if (list.length && !activeBuzonId) setActiveBuzonId(list[0].id);
      // Fetch unread counts para cada buzón (solo INBOX)
      const counts: Record<string, number> = {};
      await Promise.all(list.map(async (b) => {
        try {
          const r2 = await fetch(`/api/buzones/${b.id}/unread-count?folder=INBOX`);
          if (r2.ok) { const dd = await r2.json(); counts[b.id] = dd.unread || 0; }
        } catch {}
      }));
      setUnreadByBuzon(counts);
    } catch {
      // Bajón momentáneo del servidor (responde HTML/error): NO borrar la lista y reintentar.
      // Antes esto vaciaba la lista y mostraba un falso "Sin buzón".
      if (retry < 3) setTimeout(() => loadBuzones(retry + 1), 1500 * (retry + 1));
    }
  };

  // `silent`: refresco automático (poll/socket) sin spinner ni limpiar la selección del usuario.
  const loadEmails = async (opts?: { silent?: boolean }) => {
    if (!activeBuzonId) { setEmails([]); return; }
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({ folder, limit: "100" });
      const r = await fetch(`/api/buzones/${activeBuzonId}/emails?${params.toString()}`);
      if (!r.ok) return; // respuesta no OK (p.ej. API reiniciando): no romper la vista
      const d = await r.json();
      setEmails(d.emails || []);
      if (!opts?.silent) setChecked(new Set());
    } catch {
      // Fallo transitorio de red (API reiniciando / bajón momentáneo): ignorar; el próximo
      // refresco (poll/socket) reintenta. Antes esto tumbaba la vista con "Failed to fetch".
    } finally { if (!opts?.silent) setLoading(false); }
  };

  useEffect(() => { loadBuzones(); }, []);
  useEffect(() => { loadEmails(); setOpenEmailId(null); }, [activeBuzonId, folder]);

  // Refs para que el poll y el socket usen siempre las últimas funciones/estado (sin closures viejas).
  const loadEmailsRef = useRef(loadEmails);
  const loadBuzonesRef = useRef(loadBuzones);
  const activeBuzonIdRef = useRef(activeBuzonId);
  loadEmailsRef.current = loadEmails;
  loadBuzonesRef.current = loadBuzones;
  activeBuzonIdRef.current = activeBuzonId;

  // Fase 1 — auto-refresh: cada 30s (solo con la pestaña visible) y al volver a la pestaña.
  useEffect(() => {
    const refresh = () => { loadBuzonesRef.current(); loadEmailsRef.current({ silent: true }); };
    const tick = () => { if (typeof document === "undefined" || document.visibilityState === "visible") refresh(); };
    const id = setInterval(tick, 30000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Fase 2 — tiempo real: el backend emite 'email:nuevo' al importar correos (via NOTIFY→socket).
  useEffect(() => {
    const socket = getSocket();
    const onNuevo = (ev: any) => {
      loadBuzonesRef.current(); // actualiza contadores de no leídos de todos los buzones
      if (ev?.buzon_id && ev.buzon_id === activeBuzonIdRef.current) loadEmailsRef.current({ silent: true });
    };
    socket.on("email:nuevo", onNuevo);
    return () => { socket.off("email:nuevo", onNuevo); };
  }, []);

  const syncNow = async () => {
    if (!activeBuzonId) return;
    await fetch(`/api/buzones/${activeBuzonId}/sync`, { method: "POST" });
    toast.info("Sincronizando...");
    setTimeout(() => { loadEmails(); loadBuzones(); }, 4500);
  };

  // Desvincular = soft-delete (activo=false). Conserva el historial; reconectar el mismo correo lo reactiva.
  // Abre nuestro modal de confirmación (no el confirm() nativo).
  const desvincular = (id: string, email: string) => setDesvincularTarget({ id, email });
  const confirmDesvincular = async () => {
    if (!desvincularTarget) return;
    const { id } = desvincularTarget;
    setDesvinculando(true);
    try {
      const r = await fetch(`/api/buzones/${id}`, { method: "DELETE" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "No se pudo desvincular"); }
      toast.success("Buzón desvinculado");
      if (activeBuzonId === id) setActiveBuzonId(null);
      setDesvincularTarget(null);
      loadBuzones();
    } catch (e: any) { toast.error(e.message); } finally { setDesvinculando(false); }
  };

  // Reconectar = abrir el asistente. Para buzones de contraseña, prellenado (preset por dominio + paso 2).
  // Para OAuth (Gmail) el prefill de contraseña no aplica: se abre limpio para reautorizar con Google.
  const reconectar = (b: Buzon) => {
    if (b.auth_type === "oauth2_google") {
      setConnectPrefill(null);
      toast.info("Reconecta este buzón con el botón de Gmail (Google).");
    } else {
      setConnectPrefill({ email: b.email });
    }
    setConnectOpen(true);
  };

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllCheck = () => {
    if (!emails) return;
    if (checked.size === emails.length && emails.length > 0) setChecked(new Set());
    else setChecked(new Set(emails.map((e) => e.id)));
  };

  const markRead = async (leido: boolean) => {
    if (checked.size === 0) return;
    const ids = [...checked];
    const r = await fetch("/api/emails/bulk", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, leido })
    });
    if (r.ok) {
      toast.success(`${ids.length} marcado${ids.length > 1 ? "s" : ""} como ${leido ? "leído" : "no leído"}`);
      setEmails((cur) => cur ? cur.map((e) => ids.includes(e.id) ? { ...e, leido } : e) : cur);
      setChecked(new Set());
      loadBuzones();
    } else toast.error("Error");
  };

  const markAllRead = async () => {
    if (!activeBuzonId) return;
    if (!confirm(`¿Marcar todos los correos como leídos?`)) return;
    const r = await fetch(`/api/buzones/${activeBuzonId}/mark-all-read`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder })
    });
    const d = await r.json();
    if (r.ok) {
      toast.success(`${d.updated || 0} marcados leídos`);
      loadEmails();
      loadBuzones();
    }
  };

  const openReply = async (email: any) => {
    const subject = email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject || ""}`;
    setComposerInitial({
      to: email.from_addr,
      subject,
      in_reply_to: email.message_id || null,
      body_html: `<p></p><br/><blockquote><p><em>El ${new Date(email.fecha_email).toLocaleString("es")}, ${email.from_name || email.from_addr} escribió:</em></p>${email.body_html_safe || `<p>${(email.body_text || "").replace(/\n/g, "<br/>")}</p>`}</blockquote>`,
      body_text: "",
      contacto_id: email.contacto_id,
      oportunidad_id: email.oportunidad_id,
    });
    setComposerOpen(true);
  };

  const openForward = async (email: any) => {
    const subject = /^Fwd:|^Fw:/i.test(email.subject || "") ? email.subject : `Fwd: ${email.subject || ""}`;
    const orig = email.body_html_safe || (email.body_text ? `<p>${(email.body_text || "").replace(/\n/g, "<br/>")}</p>` : "<p>(sin contenido)</p>");
    const tos = Array.isArray(email.to_addrs) ? email.to_addrs.map((a: any) => a.address || a).join(", ") : (email.to_addrs || "");
    const fwdHeader = `<p></p><br/><div style="border-left:3px solid #ddd;padding-left:12px;color:#555"><p><strong>---------- Mensaje reenviado ----------</strong></p><p><strong>De:</strong> ${email.from_name || ""} &lt;${email.from_addr}&gt;<br/><strong>Fecha:</strong> ${new Date(email.fecha_email).toLocaleString("es")}<br/><strong>Asunto:</strong> ${email.subject || ""}<br/><strong>Para:</strong> ${tos}</p>${orig}</div>`;
    setComposerInitial({
      to: "",
      subject,
      in_reply_to: null,
      body_html: fwdHeader,
      body_text: "",
      contacto_id: email.contacto_id,
      oportunidad_id: email.oportunidad_id,
    });
    setComposerOpen(true);
  };

  const total = emails?.length || 0;
  const unread = emails?.filter((e) => !e.leido).length || 0;
  const sel = checked.size;
  const allChecked = total > 0 && sel === total;

  return (
    <AppShell>
      <div className="h-[calc(100vh-4rem)] flex overflow-hidden">
        <BuzonesRail
          buzones={buzones}
          activeBuzonId={activeBuzonId}
          onSelectBuzon={setActiveBuzonId}
          folder={folder}
          onChangeFolder={setFolder}
          unreadByBuzon={unreadByBuzon}
          onConnectNew={() => { setConnectPrefill(null); setConnectOpen(true); }}
          onDesvincular={desvincular}
          onReconectar={reconectar}
          onEditarConexion={(b) => setEditConexionId(b.id)}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-white/30 dark:bg-white/[0.01]">
          <div className="px-5 py-3 border-b border-black/5 dark:border-white/10 flex items-center gap-3 bg-white/60 dark:bg-white/[0.02] backdrop-blur-xl">
            <div className="flex-1 min-w-0">
              <div className="font-display font-black text-sm truncate">{activeBuzon?.email || "Sin buzón"}</div>
              <div className="text-[10px] text-neutral-400 font-ui uppercase tracking-[0.15em]">
                {folder === "INBOX" ? "Bandeja de entrada" : folder === "SENT" ? "Enviados" : folder}
                {activeBuzon?.ultimo_sync && <> · sync {new Date(activeBuzon.ultimo_sync).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</>}
              </div>
            </div>
            {isAdmin && (
              <Link href="/correo/panel" title="Panel de control de correos (admin)" className="h-9 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center gap-1.5 transition text-xs font-ui font-bold uppercase tracking-wider">
                <Gauge className="h-3.5 w-3.5" /> Panel
              </Link>
            )}
            <button onClick={() => setAclModalOpen(true)} title="Compartir acceso" disabled={!activeBuzonId || !activeBuzon?.es_mio} className="h-9 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 flex items-center justify-center gap-1.5 transition text-xs font-ui font-bold uppercase tracking-wider">
              <Users className="h-3.5 w-3.5" /> Compartir
            </button>
            <button onClick={syncNow} title="Sincronizar ahora" disabled={!activeBuzonId} className="h-9 w-9 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 flex items-center justify-center transition">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-brand-orange" : ""}`} />
            </button>
            <button
              onClick={() => { setComposerInitial(null); setComposerOpen(true); }}
              disabled={!activeBuzonId}
              className="h-9 px-4 rounded-xl bg-brand-orange text-white text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 disabled:opacity-40 flex items-center gap-1.5 shadow-glow"
            >
              <Plus className="h-3.5 w-3.5" /> Nuevo
            </button>
          </div>

          <EmailActionsBar
            total={total}
            unread={unread}
            selectedCount={sel}
            allChecked={allChecked}
            onToggleAll={toggleAllCheck}
            onMarkRead={() => markRead(true)}
            onMarkUnread={() => markRead(false)}
            onMarkAllRead={markAllRead}
            buzonId={activeBuzonId}
            folder={folder}
            onOpenEmail={(id) => setOpenEmailId(id)}
          />

          <EmailList
            emails={emails}
            selectedId={openEmailId}
            checked={checked}
            onToggle={toggleCheck}
            onSelect={(e) => setOpenEmailId(e.id)}
            onConnectMailbox={() => setConnectOpen(true)}
            loading={loading}
          />
        </div>
      </div>

      <EmailDetailDrawer
        emailId={openEmailId}
        onClose={() => setOpenEmailId(null)}
        onReply={(e) => { setOpenEmailId(null); openReply(e); }}
        onForward={(e) => { setOpenEmailId(null); openForward(e); }}
        onChanged={() => { loadEmails(); loadBuzones(); }}
      />

      {composerOpen && activeBuzonId && (
        <ComposerDrawer
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onSent={() => { setComposerOpen(false); loadEmails(); loadBuzones(); }}
          buzonId={activeBuzonId}
          buzonEmail={activeBuzon?.email}
          initial={composerInitial}
        />
      )}

      {connectOpen && (
        <ConnectMailboxModal
          prefill={connectPrefill}
          onClose={() => { setConnectOpen(false); setConnectPrefill(null); }}
          onConnected={() => { setConnectOpen(false); setConnectPrefill(null); loadBuzones(); }}
        />
      )}
      {aclModalOpen && activeBuzonId && (
        <BuzonACLModal buzonId={activeBuzonId} onClose={() => setAclModalOpen(false)} />
      )}

      {desvincularTarget && (
        <ConfirmDialog
          danger
          icon={<Trash2 className="h-5 w-5" />}
          title="Desvincular buzón"
          message={<>¿Desvincular <strong className="text-neutral-800 dark:text-neutral-100">{desvincularTarget.email}</strong>? Dejará de sincronizar; el historial de correos se conserva.</>}
          confirmLabel="Desvincular"
          busy={desvinculando}
          onConfirm={confirmDesvincular}
          onCancel={() => setDesvincularTarget(null)}
        />
      )}

      {editConexionId && (
        <EditConnectionModal
          buzonId={editConexionId}
          onClose={() => setEditConexionId(null)}
          onSaved={() => { setEditConexionId(null); loadBuzones(); loadEmails(); }}
        />
      )}
    </AppShell>
  );
}
