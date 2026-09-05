"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@iconify/react";
import { X, ArrowRight, ArrowLeft, Check, Eye, EyeOff, Loader2, AlertCircle, UserPlus, Sparkles } from "@/lib/bootstrap-icons";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { BorderBeam } from "@/components/magic/BorderBeam";
import { ShimmerButton } from "@/components/magic/ShimmerButton";
import { AuroraBackground } from "@/components/magic/AuroraBackground";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { key: "gmail", label: "Gmail", logo: "logos:google-gmail", host: "imap.gmail.com", smtpHost: "smtp.gmail.com", imap: 993, smtp: 465, smtpSsl: true, brand: "#EA4335" },
  { key: "outlook", label: "Outlook / Microsoft 365", logo: "logos:microsoft-office", host: "outlook.office365.com", smtpHost: "smtp.office365.com", imap: 993, smtp: 587, smtpSsl: false, brand: "#0078D4" },
  { key: "icloud", label: "iCloud", logo: "logos:apple", host: "imap.mail.me.com", smtpHost: "smtp.mail.me.com", imap: 993, smtp: 587, smtpSsl: false, brand: "#000000" },
  { key: "yahoo", label: "Yahoo Mail", logo: "logos:yahoo", host: "imap.mail.yahoo.com", smtpHost: "smtp.mail.yahoo.com", imap: 993, smtp: 465, smtpSsl: true, brand: "#6001D2" },
  { key: "zoho", label: "Zoho Mail", logo: "logos:zoho", host: "imap.zoho.com", smtpHost: "smtp.zoho.com", imap: 993, smtp: 465, smtpSsl: true, brand: "#C8202F" },
  { key: "custom", label: "Personalizado (IMAP/SMTP)", logo: "mdi:server-network", host: "", imap: 993, smtp: 465, smtpSsl: true, brand: "#5C6670" },
];

interface Props {
  onClose: () => void;
  onConnected: () => void;
  // Reconexión: precarga email + preset (por dominio) y salta al paso de credenciales.
  prefill?: { email?: string } | null;
}

// Elige el preset por dominio del correo (para la reconexión). Cae a "custom" si no coincide.
function providerForEmail(email: string) {
  const domain = (email.split("@")[1] || "").toLowerCase();
  const byDomain: Record<string, string> = {
    "gmail.com": "gmail", "googlemail.com": "gmail",
    "outlook.com": "outlook", "hotmail.com": "outlook", "live.com": "outlook",
    "icloud.com": "icloud", "me.com": "icloud",
    "yahoo.com": "yahoo", "zoho.com": "zoho",
  };
  const key = byDomain[domain] || "custom";
  return PROVIDERS.find((p) => p.key === key) || PROVIDERS.find((p) => p.key === "custom")!;
}

export function ConnectMailboxModal({ onClose, onConnected, prefill }: Props) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<typeof PROVIDERS[number] | null>(null);
  const [f, setF] = useState({
    email: "", display_name: "",
    imap_host: "", imap_port: 993, imap_ssl: true, imap_user: "", imap_password: "",
    smtp_host: "", smtp_port: 465, smtp_ssl: true, smtp_user: "", smtp_password: "",
    import_desde_dias: 7,
    acl: [] as { user_id?: string; posicion?: string; permiso: "ver" | "enviar" }[],
  });
  const [showPwd, setShowPwd] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [oauthInProgress, setOauthInProgress] = useState(false);
  const [oauthSuccess, setOauthSuccess] = useState<{ email: string } | null>(null);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPollRef = useRef<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || [])); }, []);

  // Reconexión: si llega un email prellenado, elige preset por dominio, precarga los campos y
  // salta directo al paso 2 (credenciales). El upsert por (owner, email) reactualiza el buzón.
  useEffect(() => {
    if (!prefill?.email) return;
    const email = prefill.email;
    const p = providerForEmail(email);
    setProvider(p);
    setF((v) => ({
      ...v,
      email, imap_user: email, smtp_user: email,
      imap_host: p.host, imap_port: p.imap, imap_ssl: true,
      smtp_host: p.smtpHost || p.host, smtp_port: p.smtp, smtp_ssl: p.smtpSsl === true,
    }));
    setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.email]);

  const choose = (p: typeof PROVIDERS[number]) => {
    setProvider(p);
    setF((v) => ({
      ...v,
      imap_host: p.host,
      imap_port: p.imap,
      imap_ssl: true,
      smtp_host: p.smtpHost || p.host,
      smtp_port: p.smtp,
      smtp_ssl: p.smtpSsl === true,
    }));
    setTimeout(() => setStep(2), 180);
  };

  // Listener para popup OAuth Google
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e?.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "gozz_oauth_ok") {
        setOauthInProgress(false);
        if (oauthPollRef.current) { clearInterval(oauthPollRef.current); oauthPollRef.current = null; }
        try {
          confetti({ particleCount: 120, spread: 75, origin: { y: 0.5 }, colors: ["#5750E8", "#FFB51C", "#EA4335", "#FFFFFF"] });
        } catch {}
        const email = (d.email as string) || "";
        setOauthSuccess({ email });
        toast.success("Correo conectado exitosamente" + (email ? ": " + email : ""));
        // Pantalla de exito 1.6s, luego cerrar y refrescar lista. Refresh adicional a +3.5s por si el primer sync demora.
        setTimeout(() => {
          onConnected();
          setTimeout(() => { try { onConnected(); } catch {} }, 3500);
        }, 1600);
      } else if (d.type === "gozz_oauth_error") {
        setOauthInProgress(false);
        if (oauthPollRef.current) { clearInterval(oauthPollRef.current); oauthPollRef.current = null; }
        toast.error(d.message || "Error en OAuth Google");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onClose, onConnected]);

  const startGoogleOAuth = async () => {
    setOauthInProgress(true);
    try {
      const r = await fetch("/api/buzones/oauth/google/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: f.display_name || null,
          import_desde_dias: f.import_desde_dias || 7,
          acl: f.acl,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.auth_url) {
        toast.error(j.error || "No se pudo iniciar OAuth Google");
        setOauthInProgress(false); return;
      }
      const w = window.open(j.auth_url, "gozz-google-oauth", "width=560,height=680");
      oauthPopupRef.current = w;
      // detectar cierre manual del popup sin completar
      oauthPollRef.current = setInterval(() => {
        if (w && w.closed) {
          clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
          if (oauthInProgress) setOauthInProgress(false);
        }
      }, 800);
    } catch (e: any) {
      toast.error(e?.message || "Error abriendo OAuth");
      setOauthInProgress(false);
    }
  };

  const canNextStep2 = !!f.email && !!f.imap_password && !!f.imap_host && !!f.smtp_host;

  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/buzones/test-connection", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          imap_user: f.imap_user || f.email,
          smtp_user: f.smtp_user || f.imap_user || f.email,
          smtp_password: f.smtp_password || f.imap_password,
        }),
      });
      const d = await r.json();
      setTestResult(d);
    } catch (e: any) {
      setTestResult({ ok: false, imap: { ok: false, error: e.message }, smtp: { ok: false, error: "" } });
    } finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/buzones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          imap_user: f.imap_user || f.email,
          smtp_user: f.smtp_user || f.imap_user || f.email,
          smtp_password: f.smtp_password || f.imap_password,
        }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.detail || d.error || "Error"); return; }
      confetti({
        particleCount: 120,
        spread: 75,
        origin: { y: 0.5 },
        colors: ["#5750E8", "#FFB51C", "#FF006E", "#FFFFFF"],
      });
      toast.success("¡Buzón conectado!");
      setTimeout(onConnected, 800);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  const addAclUser = (uid: string) => { if (!uid) return; setF((v) => ({ ...v, acl: [...v.acl, { user_id: uid, permiso: "ver" }] })); };
  const addAclPos = (pos: string) => { if (!pos) return; setF((v) => ({ ...v, acl: [...v.acl, { posicion: pos, permiso: "ver" }] })); };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={oauthSuccess ? undefined : onClose}>
      {oauthSuccess && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 z-[90] flex items-center justify-center pointer-events-none"
        >
          <div className="bg-white dark:bg-neutral-900 rounded-3xl px-12 py-10 shadow-2xl text-center border-2 border-brand-green/30 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 240, damping: 14 }} className="w-20 h-20 mx-auto mb-4 rounded-full bg-brand-green/15 flex items-center justify-center">
              <Check className="h-10 w-10 text-brand-green" strokeWidth={3} />
            </motion.div>
            <h3 className="text-2xl font-bold mb-2">Correo conectado exitosamente</h3>
            {oauthSuccess.email && (
              <p className="text-sm font-mono text-neutral-500">{oauthSuccess.email}</p>
            )}
            <p className="text-xs text-neutral-400 mt-3">Sincronizando los primeros mensajes...</p>
          </div>
        </motion.div>
      )}
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-neutral-900 rounded-3xl overflow-hidden border border-black/10 dark:border-white/10 shadow-2xl flex flex-col"
      >
        <BorderBeam size={220} duration={8} />

        <div className="relative px-6 py-5 border-b border-black/5 dark:border-white/10">
          <div className="absolute inset-0 opacity-25 pointer-events-none">
            <AuroraBackground intensity={0.4} />
          </div>
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-brand-orange font-ui uppercase text-[10px] tracking-[0.2em] font-bold mb-1">
                <Sparkles className="h-3 w-3" /> Paso {step} de 3
              </div>
              <h2 className="font-display text-2xl font-black">Conectar buzón</h2>
            </div>
            <button onClick={onClose} className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative flex items-center gap-1.5 mt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className={cn("flex-1 h-1 rounded-full transition-all", step >= s ? "gradient-orange" : "bg-black/10 dark:bg-white/10")} />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5" data-lenis-prevent>
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                className="grid grid-cols-2 gap-3"
              >
                {PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => choose(p)}
                    className={cn(
                      "group relative glass rounded-2xl p-4 flex items-center gap-3 text-left hover:shadow-glow hover:-translate-y-0.5 transition-all overflow-hidden",
                      provider?.key === p.key ? "ring-2 ring-brand-orange shadow-glow" : ""
                    )}
                  >
                    <div className="h-10 w-10 rounded-xl bg-white dark:bg-white/10 flex items-center justify-center shrink-0 shadow-sm">
                      <Icon icon={p.logo} width={24} height={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{p.label}</div>
                      <div className="text-[10px] text-neutral-500 truncate">{p.host || "IMAP/SMTP manual"}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-neutral-300 group-hover:text-brand-orange group-hover:translate-x-1 transition-all shrink-0" />
                  </button>
                ))}
              </motion.div>
            )}

            {step === 2 && provider?.key === "gmail" && (
              <motion.div
                key="step2-gmail"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                className="space-y-5"
              >
                <div className="glass rounded-2xl p-5">
                  <div className="font-ui text-[10px] uppercase tracking-[0.2em] text-brand-orange font-bold mb-2">Conectar Gmail</div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    Vas a iniciar sesion con Google para autorizar el acceso a tu correo. <b>No escribes ningun password aqui</b> &mdash; Google nos da un token seguro que podemos revocar cuando quieras desde <span className="font-mono">myaccount.google.com/permissions</span>.
                  </p>
                </div>

                <form onSubmit={(e) => e.preventDefault()} autoComplete="on" name="conectar-buzon-gmail">
                  <FloatingField label="Nombre visible (opcional)">
                    <input
                      value={f.display_name}
                      onChange={(e) => setF({ ...f, display_name: e.target.value })}
                      name="display_name"
                      id="buzon-gmail-display-name"
                      autoComplete="name"
                      placeholder="Juan Garcia"
                      className="w-full h-11 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    />
                  </FloatingField>
                </form>

                <div className="glass rounded-2xl p-5">
                  <div className="font-ui text-[10px] uppercase tracking-[0.2em] text-brand-orange font-bold mb-3">Acceso compartido (opcional)</div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {f.acl.map((a, i) => (
                      <span key={i} className="text-[11px] px-2 py-1 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center gap-1">
                        {a.user_id ? users.find((u: any) => u.id === a.user_id)?.nombre : `pos:${a.posicion}`}
                        <button onClick={() => setF((v) => ({ ...v, acl: v.acl.filter((_, j) => j !== i) }))} className="hover:text-brand-red"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <select onChange={(e) => { addAclUser(e.target.value); e.target.value = ""; }} className="flex-1 h-9 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 text-xs">
                      <option value="">+ Agregar usuario...</option>
                      {users.map((u: any) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
                    </select>
                    <input onKeyDown={(e: any) => { if (e.key === "Enter") { addAclPos(e.target.value); e.target.value = ""; } }} placeholder="posicion + Enter" className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-white/5 border border-black/10 text-xs" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Importar historico desde</label>
                  <select value={f.import_desde_dias} onChange={(e) => setF({ ...f, import_desde_dias: Number(e.target.value) })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm">
                    <option value={7}>Ultima semana</option>
                    <option value={15}>Ultimos 15 dias</option>
                    <option value={30}>Ultimo mes</option>
                    <option value={90}>Ultimos 3 meses</option>
                    <option value={365}>Ultimo ano</option>
                  </select>
                </div>

                <button
                  onClick={startGoogleOAuth}
                  disabled={oauthInProgress}
                  className="w-full h-12 rounded-xl bg-white dark:bg-neutral-100 text-neutral-900 font-semibold text-sm border-2 border-neutral-200 hover:border-brand-orange hover:shadow-lg transition-all flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-wait"
                >
                  {oauthInProgress ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Esperando autorizacion de Google...</>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      Continuar con Google
                    </>
                  )}
                </button>
                <p className="text-[11px] text-neutral-500 text-center">
                  Permisos solicitados: leer y enviar correos. Puedes revocarlos en cualquier momento desde tu cuenta Google.
                </p>
              </motion.div>
            )}

            {step === 2 && provider?.key !== "gmail" && (
              <motion.div
                key="step2-pwd"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                className="space-y-4"
              >
                {/* ════════════════════════════════════════════════════════════════════════════
                    🔴 UN <form> DE VERDAD, Y CAMPOS CON IDENTIDAD
                    ════════════════════════════════════════════════════════════════════════════
                    Sin `<form>` y sin `name`/`id`/`autoComplete`, el navegador no sabe qué son
                    estos campos: no ofrece guardar la credencial del buzón y, peor, puede rellenar
                    la contraseña **del CRM** en un campo que va a acabar en un servidor IMAP ajeno.
                    Con `autoComplete="username"` en el correo, el gestor asocia la contraseña a ESA
                    cuenta y no a la del CRM, aunque las dos vivan en el mismo origen.

                    ⚠️ El `<form>` envuelve SOLO los campos, no el pie del modal: los botones de
                    "Atrás" y "Continuar" están fuera y no llevan `type`, así que dentro de un
                    formulario pasarían a ser `submit` y romperían el asistente de tres pasos.
                    `onSubmit` previene el envío igualmente — aquí no se navega, se guarda por AJAX. */}
                <form onSubmit={(e) => e.preventDefault()} autoComplete="on" name="conectar-buzon" className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FloatingField label="Email">
                    <input
                      value={f.email}
                      onChange={(e) => setF({ ...f, email: e.target.value, imap_user: f.imap_user || e.target.value })}
                      name="email"
                      id="buzon-email"
                      autoComplete="username"
                      placeholder="tu@dominio.com"
                      type="email"
                      className="w-full h-11 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    />
                  </FloatingField>
                  <FloatingField label="Nombre visible">
                    <input
                      value={f.display_name}
                      onChange={(e) => setF({ ...f, display_name: e.target.value })}
                      name="display_name"
                      id="buzon-display-name"
                      autoComplete="name"
                      placeholder="Juan García"
                      className="w-full h-11 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    />
                  </FloatingField>
                </div>

                <FloatingField label="Contraseña del buzón">
                  <div className="relative">
                    {/* `current-password` y no `new-password`: esta contraseña ya existe en el
                        proveedor de correo, no se está creando aquí. Con `new-password` el
                        navegador ofrecería generar una, que es absurdo para un buzón ajeno. */}
                    <input
                      value={f.imap_password}
                      onChange={(e) => setF({ ...f, imap_password: e.target.value })}
                      name="imap_password"
                      id="buzon-password"
                      autoComplete="current-password"
                      type={showPwd ? "text" : "password"}
                      placeholder="••••••••••"
                      className="w-full h-11 px-3 pr-10 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg hover:bg-black/5 flex items-center justify-center text-neutral-400">
                      {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </FloatingField>
                </form>

                <details className="rounded-xl border border-black/10 dark:border-white/10 px-4 py-2">
                  <summary className="text-[11px] font-ui uppercase tracking-wider font-bold text-neutral-500 cursor-pointer select-none">Ajustes avanzados (servidor / puertos)</summary>
                  <div className="grid grid-cols-[1fr_90px_70px] gap-2 mt-3">
                    <FloatingField label="IMAP host">
                      <input value={f.imap_host} onChange={(e) => setF({ ...f, imap_host: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm font-mono" />
                    </FloatingField>
                    <FloatingField label="Puerto">
                      <input type="number" value={f.imap_port} onChange={(e) => setF({ ...f, imap_port: Number(e.target.value) })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm" />
                    </FloatingField>
                    <label className="flex items-center gap-1 text-xs pb-2.5 self-end"><input type="checkbox" checked={f.imap_ssl} onChange={(e) => setF({ ...f, imap_ssl: e.target.checked })} /> SSL</label>
                  </div>
                  <div className="grid grid-cols-[1fr_90px_70px] gap-2 mt-3">
                    <FloatingField label="SMTP host">
                      <input value={f.smtp_host} onChange={(e) => setF({ ...f, smtp_host: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm font-mono" />
                    </FloatingField>
                    <FloatingField label="Puerto">
                      <input type="number" value={f.smtp_port} onChange={(e) => setF({ ...f, smtp_port: Number(e.target.value) })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm" />
                    </FloatingField>
                    <label className="flex items-center gap-1 text-xs pb-2.5 self-end"><input type="checkbox" checked={f.smtp_ssl} onChange={(e) => setF({ ...f, smtp_ssl: e.target.checked })} /> SSL</label>
                  </div>
                </details>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                className="space-y-5"
              >
                <div className="relative glass rounded-2xl p-5 overflow-hidden">
                  {testing && <BorderBeam size={180} duration={4} />}
                  <div className="font-ui text-[10px] uppercase tracking-[0.2em] text-brand-orange font-bold mb-3">Prueba de conexión</div>
                  <div className="space-y-2">
                    <StatusRow label="IMAP" state={testResult ? (testResult.imap?.ok ? "ok" : "err") : testing ? "loading" : "idle"} error={testResult?.imap?.error} />
                    <StatusRow label="SMTP" state={testResult ? (testResult.smtp?.ok ? "ok" : "err") : testing ? "loading" : "idle"} error={testResult?.smtp?.error} />
                  </div>
                  {!testing && (
                    <button onClick={runTest} className="mt-4 h-9 px-4 rounded-xl border border-brand-orange/40 text-brand-orange text-[11px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/10 flex items-center gap-2">
                      {testResult ? "Volver a probar" : "Probar ahora"}
                    </button>
                  )}
                </div>

                <div className="glass rounded-2xl p-5">
                  <div className="font-ui text-[10px] uppercase tracking-[0.2em] text-brand-orange font-bold mb-3">Acceso compartido (opcional)</div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {f.acl.map((a, i) => (
                      <span key={i} className="text-[11px] px-2 py-1 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center gap-1">
                        {a.user_id ? users.find((u: any) => u.id === a.user_id)?.nombre : `pos:${a.posicion}`}
                        <button onClick={() => setF((v) => ({ ...v, acl: v.acl.filter((_, j) => j !== i) }))} className="hover:text-brand-red"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <select onChange={(e) => { addAclUser(e.target.value); e.target.value = ""; }} className="flex-1 h-9 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 text-xs">
                      <option value="">+ Agregar usuario…</option>
                      {users.map((u: any) => (<option key={u.id} value={u.id}>{u.nombre}</option>))}
                    </select>
                    <input onKeyDown={(e: any) => { if (e.key === "Enter") { addAclPos(e.target.value); e.target.value = ""; } }} placeholder="posición + Enter (vendedor)" className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-white/5 border border-black/10 text-xs" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Importar histórico desde</label>
                  <select value={f.import_desde_dias} onChange={(e) => setF({ ...f, import_desde_dias: Number(e.target.value) })} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 text-sm">
                    <option value={7}>Última semana</option>
                    <option value={30}>Último mes</option>
                    <option value={90}>Últimos 3 meses</option>
                    <option value={365}>Último año</option>
                  </select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t border-black/5 dark:border-white/10 px-6 py-4 flex items-center justify-between gap-3 bg-white/90 dark:bg-neutral-900/90 backdrop-blur">
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)} className="h-11 px-4 rounded-xl border border-black/10 dark:border-white/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Atrás
            </button>
          ) : <div />}

          <div className="flex-1" />

          {step === 1 && (
            <button onClick={onClose} className="h-11 px-4 rounded-xl border border-black/10 dark:border-white/10 text-xs font-ui font-bold uppercase tracking-wider hover:bg-black/5 dark:hover:bg-white/5">
              Cancelar
            </button>
          )}
          {step === 2 && provider?.key !== "gmail" && (
            <button
              disabled={!canNextStep2}
              onClick={() => { setStep(3); setTimeout(runTest, 250); }}
              className="h-11 px-5 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              Continuar <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {step === 2 && provider?.key === "gmail" && (
            <div className="text-[11px] text-neutral-500">Al autorizar con Google se conectara automaticamente.</div>
          )}
          {step === 3 && (
            <ShimmerButton onClick={save} disabled={saving || !testResult?.ok}>
              <Check className="h-3.5 w-3.5" /> {saving ? "Guardando…" : "Conectar buzón"}
            </ShimmerButton>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function FloatingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-neutral-500 block mb-1.5 font-bold">{label}</label>
      {children}
    </div>
  );
}

function StatusRow({ label, state, error }: { label: string; state: "idle" | "loading" | "ok" | "err"; error?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 text-[11px] font-ui uppercase tracking-wider font-bold text-neutral-500">{label}</div>
      {state === "loading" && <Loader2 className="h-4 w-4 text-brand-orange animate-spin" />}
      {state === "ok" && <div className="flex items-center gap-1.5 text-brand-green"><Check className="h-4 w-4" /> <span className="text-xs font-bold">Conectado</span></div>}
      {state === "err" && <div className="flex items-start gap-1.5 text-brand-red min-w-0 flex-1"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span className="text-xs leading-relaxed break-words" title={error || "Error"}>{error || "Error"}</span></div>}
      {state === "idle" && <span className="text-xs text-neutral-400 italic">Esperando prueba…</span>}
    </div>
  );
}
