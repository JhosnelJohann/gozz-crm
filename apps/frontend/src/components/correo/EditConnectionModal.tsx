"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, Eye, EyeOff, AlertCircle, Server, Send } from "@/lib/bootstrap-icons";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { cn } from "@/lib/utils";

/**
 * Modal para VER y EDITAR la conexión de un buzón (host/puertos/SSL/usuario/contraseña/import).
 * Útil cuando un buzón queda con error: muestra la configuración actual y permite corregirla.
 * Guarda contra PATCH /api/buzones/:id/connection, que hace prueba estricta IMAP+SMTP antes de aplicar.
 */
export function EditConnectionModal({ buzonId, onClose, onSaved }: {
  buzonId: string; onClose: () => void; onSaved: () => void;
}) {
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showImapPwd, setShowImapPwd] = useState(false);
  const [showSmtpPwd, setShowSmtpPwd] = useState(false);
  const [err, setErr] = useState<{ imap?: any; smtp?: any; msg?: string } | null>(null);
  const [f, setF] = useState<any>({
    display_name: "", imap_host: "", imap_port: 993, imap_ssl: true, imap_user: "", imap_password: "",
    smtp_host: "", smtp_port: 465, smtp_ssl: true, smtp_user: "", smtp_password: "", import_desde_dias: 7,
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/buzones/${buzonId}/config`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "No se pudo cargar la configuración");
        setCfg(d.config);
        setF({
          display_name: d.config.display_name || "",
          imap_host: d.config.imap_host || "", imap_port: d.config.imap_port || 993, imap_ssl: !!d.config.imap_ssl,
          imap_user: d.config.imap_user || d.config.email || "", imap_password: "",
          smtp_host: d.config.smtp_host || "", smtp_port: d.config.smtp_port || 465, smtp_ssl: !!d.config.smtp_ssl,
          smtp_user: d.config.smtp_user || "", smtp_password: "", import_desde_dias: d.config.import_desde_dias || 7,
        });
      } catch (e: any) { toast.error(e.message); onClose(); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzonId]);

  const set = (k: string, v: any) => setF((prev: any) => ({ ...prev, [k]: v }));

  const guardar = async () => {
    setSaving(true); setErr(null);
    try {
      const body: any = {
        display_name: f.display_name,
        imap_host: f.imap_host, imap_port: Number(f.imap_port), imap_ssl: f.imap_ssl, imap_user: f.imap_user,
        smtp_host: f.smtp_host, smtp_port: Number(f.smtp_port), smtp_ssl: f.smtp_ssl, smtp_user: f.smtp_user || null,
        import_desde_dias: Number(f.import_desde_dias),
      };
      if (f.imap_password) body.imap_password = f.imap_password;
      if (f.smtp_password) body.smtp_password = f.smtp_password;
      const r = await fetch(`/api/buzones/${buzonId}/connection`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setErr({ imap: d.imap, smtp: d.smtp, msg: d.detail || d.error || "No se pudo guardar" }); return; }
      toast.success("Conexión actualizada y verificada");
      onSaved();
    } catch (e: any) { setErr({ msg: e.message }); } finally { setSaving(false); }
  };

  const inputCls = "w-full border-2 border-neutral-200 dark:border-white/10 dark:bg-white/5 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-orange transition";
  const isOauth = cfg?.auth_type === "oauth" || cfg?.auth_type === "oauth2_google";

  return (
    <AnimatedModal onClose={() => { if (!saving) onClose(); }} panelClassName="bg-white dark:bg-neutral-900 rounded-2xl w-full max-w-lg shadow-2xl border border-black/5 dark:border-white/10 max-h-[90vh] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div>
          <div className="text-[10px] font-ui font-bold uppercase tracking-[0.15em] text-brand-orange">Editar conexión</div>
          <h3 className="font-display text-lg font-black leading-tight">{cfg?.email || "Buzón"}</h3>
        </div>
        <button onClick={() => !saving && onClose()} className="h-8 w-8 rounded-lg text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition"><X className="h-4 w-4" /></button>
      </div>

      <div className="px-5 pb-5 overflow-y-auto">
        {loading ? (
          <div className="py-12 flex items-center justify-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : isOauth ? (
          <div className="py-8 text-center">
            <div className="h-12 w-12 rounded-2xl bg-brand-blue/10 text-brand-blue flex items-center justify-center mx-auto mb-3"><AlertCircle className="h-6 w-6" /></div>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">Este buzón usa <strong>Google (OAuth)</strong>, no tiene configuración de servidor editable.<br />Si dejó de funcionar, usa <strong>Reconectar</strong> para reautorizar con Google.</p>
          </div>
        ) : (
          // 🔴 <form> de verdad: sin él el navegador no identifica estas credenciales y puede
          // ofrecer la contraseña del CRM para un buzón ajeno. El pie con Cancelar/Guardar queda
          // FUERA a propósito —sus botones no llevan `type` y dentro serían `submit`—; los dos
          // botones de "ver contraseña" que sí están dentro ya son `type="button"`.
          <form onSubmit={(e) => e.preventDefault()} autoComplete="on" name="editar-buzon" className="space-y-4">
            {/* Estado actual / error (contexto para arreglar) */}
            {cfg && Number(cfg.errores_consecutivos) > 0 && cfg.ultimo_error && (
              <div className="rounded-xl bg-brand-red/8 border border-brand-red/20 px-3 py-2 text-[12px] text-brand-red flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span><strong>Error actual:</strong> {cfg.ultimo_error}</span>
              </div>
            )}

            {/* El correo del buzón no se edita aquí (es la identidad de la conexión), pero el
                gestor de contraseñas necesita saber A QUÉ CUENTA pertenece la contraseña de abajo.
                Sin este campo asociaría la credencial al origen a secas y podría ofrecer la del
                CRM. Va oculto y en solo lectura: es contexto para el navegador, no un dato que
                nadie deba tocar. */}
            <input
              type="text"
              name="email"
              id="editar-buzon-email"
              autoComplete="username"
              value={cfg?.email || ""}
              readOnly
              hidden
            />

            <div>
              <label htmlFor="editar-buzon-display-name" className="block text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-1">Nombre visible</label>
              <input
                className={inputCls}
                value={f.display_name}
                onChange={(e) => set("display_name", e.target.value)}
                name="display_name"
                id="editar-buzon-display-name"
                autoComplete="name"
                placeholder={cfg?.email}
              />
            </div>

            {/* IMAP (entrada / lectura) */}
            <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 space-y-3">
              <div className="flex items-center gap-1.5 text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500"><Server className="h-3.5 w-3.5" /> Servidor de entrada (IMAP)</div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Host</label>
                  <input className={inputCls} value={f.imap_host} onChange={(e) => set("imap_host", e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Puerto</label>
                  <input type="number" className={inputCls} value={f.imap_port} onChange={(e) => set("imap_port", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Usuario</label>
                  <input className={inputCls} value={f.imap_user} onChange={(e) => set("imap_user", e.target.value)} />
                </div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-300 pb-2.5 cursor-pointer">
                  <input type="checkbox" checked={f.imap_ssl} onChange={(e) => set("imap_ssl", e.target.checked)} /> SSL
                </label>
              </div>
              <div>
                <label className="block text-[10px] text-neutral-400 mb-1">Contraseña</label>
                <div className="relative">
                  <input type={showImapPwd ? "text" : "password"} className={inputCls + " pr-9"} value={f.imap_password} onChange={(e) => set("imap_password", e.target.value)}
                    name="imap_password" id="editar-buzon-imap-password" autoComplete="current-password"
                    placeholder={cfg?.has_imap_password ? "•••••••• (dejar en blanco para mantener)" : "Escribe la contraseña"} />
                  <button type="button" onClick={() => setShowImapPwd((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">{showImapPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>
            </div>

            {/* SMTP (salida / envío) */}
            <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 space-y-3">
              <div className="flex items-center gap-1.5 text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500"><Send className="h-3.5 w-3.5" /> Servidor de salida (SMTP)</div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Host</label>
                  <input className={inputCls} value={f.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Puerto</label>
                  <input type="number" className={inputCls} value={f.smtp_port} onChange={(e) => set("smtp_port", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <label className="block text-[10px] text-neutral-400 mb-1">Usuario (opcional, usa el de IMAP si vacío)</label>
                  <input className={inputCls} value={f.smtp_user} onChange={(e) => set("smtp_user", e.target.value)} placeholder={f.imap_user} />
                </div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-300 pb-2.5 cursor-pointer">
                  <input type="checkbox" checked={f.smtp_ssl} onChange={(e) => set("smtp_ssl", e.target.checked)} /> SSL
                </label>
              </div>
              <div>
                <label className="block text-[10px] text-neutral-400 mb-1">Contraseña (opcional, usa la de IMAP si vacío)</label>
                <div className="relative">
                  {/* ⚠️  a propósito: con DOS campos  en el
                      mismo formulario, el gestor rellena los dos con el mismo valor y el de SMTP
                      deja de estar vacío — que es como se dice aquí "usa la de IMAP". */}
                  <input type={showSmtpPwd ? "text" : "password"} className={inputCls + " pr-9"} value={f.smtp_password} onChange={(e) => set("smtp_password", e.target.value)}
                    name="smtp_password" id="editar-buzon-smtp-password" autoComplete="off"
                    placeholder={cfg?.has_smtp_password ? "•••••••• (dejar en blanco para mantener)" : "Usa la de IMAP"} />
                  <button type="button" onClick={() => setShowSmtpPwd((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">{showSmtpPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>
            </div>

            {/* Resultado de la prueba si falló al guardar */}
            {err && (
              <div className="rounded-xl bg-brand-red/8 border border-brand-red/20 px-3 py-2.5 text-[12px] text-brand-red space-y-1">
                <div className="flex items-center gap-1.5 font-bold"><AlertCircle className="h-4 w-4" /> No se guardó — falló la prueba:</div>
                {err.imap && <div>IMAP: {err.imap.ok ? "✓ OK" : (err.imap.error || "error")}</div>}
                {err.smtp && <div>SMTP: {err.smtp.ok ? "✓ OK" : (err.smtp.error || "error")}</div>}
                {!err.imap && !err.smtp && err.msg && <div>{err.msg}</div>}
              </div>
            )}
          </form>
        )}
      </div>

      {!loading && !isOauth && (
        <div className="flex gap-2 justify-end px-5 py-4 border-t border-black/5 dark:border-white/10 shrink-0">
          <button onClick={() => !saving && onClose()} disabled={saving} className="px-4 py-2 rounded-xl bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 text-sm font-bold hover:bg-neutral-200 disabled:opacity-60 transition">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="px-4 py-2 rounded-xl bg-brand-orange text-white text-sm font-bold hover:bg-brand-orange/90 disabled:opacity-60 transition flex items-center gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? "Probando y guardando…" : "Guardar cambios"}
          </button>
        </div>
      )}
    </AnimatedModal>
  );
}
