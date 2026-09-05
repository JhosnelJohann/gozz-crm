"use client";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowLeft, KeyRound, ShieldCheck, Check, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { useAuth, ApiError } from "../hooks/useAuth";

// =====================================================================
// Modal: Olvidé mi contraseña (flujo 2 pasos + OTP + password strength)
// =====================================================================
export function ForgotPasswordModal({ defaultEmail, onClose }: { defaultEmail: string; onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const { forgotPassword, sendingCode, resetPassword, resettingPassword } = useAuth();
  const loading = sendingCode || resettingPassword;

  const strength = passwordStrength(newPwd);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) { toast.error("Ingresa tu correo"); return; }
    try {
      await forgotPassword(email.trim());
      toast.success("Si el correo existe, enviamos un código de 6 dígitos");
      setStep("code");
      setTimeout(() => inputs.current[0]?.focus(), 300);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Error");
    }
  };

  const submitReset = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const fullCode = code.join("");
    if (fullCode.length !== 6) { toast.error("Ingresa los 6 dígitos"); return; }
    if (newPwd.length < 8) { toast.error("Mínimo 8 caracteres"); return; }
    if (newPwd !== confirm) { toast.error("Las contraseñas no coinciden"); return; }
    try {
      await resetPassword(email.trim(), fullCode, newPwd);
      setStep("done");
      setTimeout(() => onClose(), 1800);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Error");
    }
  };

  const setDigit = (idx: number, v: string) => {
    const only = v.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[idx] = only;
    setCode(next);
    if (only && idx < 5) inputs.current[idx + 1]?.focus();
  };

  const onKeyDownDigit = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !code[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowLeft" && idx > 0) inputs.current[idx - 1]?.focus();
    else if (e.key === "ArrowRight" && idx < 5) inputs.current[idx + 1]?.focus();
  };

  const onPasteCode = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (txt.length) {
      e.preventDefault();
      const next = ["", "", "", "", "", ""];
      for (let i = 0; i < txt.length; i++) next[i] = txt[i];
      setCode(next);
      inputs.current[Math.min(txt.length, 5)]?.focus();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Ambient blur backdrop */}
      <div className="absolute inset-0 bg-[rgba(5,5,10,0.72)] backdrop-blur-xl" />
      <div className="absolute inset-0 opacity-40 pointer-events-none"
        style={{ backgroundImage: "radial-gradient(ellipse at 30% 20%, rgba(87,80,232,0.25), transparent 55%), radial-gradient(ellipse at 70% 80%, rgba(131,56,236,0.25), transparent 55%)" }} />

      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 24, filter: "blur(12px)" }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: "blur(0)" }}
        exit={{ scale: 0.94, opacity: 0, y: 12, filter: "blur(8px)" }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[rgba(12,12,22,0.9)] backdrop-blur-2xl shadow-[0_30px_100px_rgba(0,0,0,0.6)] overflow-hidden"
      >
        {/* Border beam */}
        <div className="pointer-events-none absolute inset-0 rounded-3xl border-beam" />

        {/* Header */}
        <div className="relative px-6 py-5 flex items-center gap-3 border-b border-white/5">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-lg shadow-brand-orange/30">
            {step === "done" ? <Check className="h-5 w-5 text-white" strokeWidth={3} />
              : step === "code" ? <KeyRound className="h-5 w-5 text-white" strokeWidth={2} />
              : <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-ui uppercase tracking-[0.2em] text-white/55">
              {step === "done" ? "Contraseña actualizada" : step === "code" ? "Paso 2 de 2" : "Paso 1 de 2"}
            </div>
            <div className="font-display font-black text-lg text-white">
              {step === "done" ? "Listo" : step === "code" ? "Verificación + nueva contraseña" : "Recuperar acceso"}
            </div>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-1.5">
            {["email", "code", "done"].map((s, i) => (
              <div key={s} className={
                "h-1 flex-1 rounded-full transition-all duration-500 " +
                (step === "done" || ["email","code"].indexOf(step) >= ["email","code"].indexOf(s)
                  ? "bg-gradient-to-r from-brand-orange to-neon-magenta"
                  : "bg-white/10")
              } />
            ))}
          </div>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {step === "email" && (
            <motion.form key="email"
              initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              onSubmit={sendCode}
              className="px-6 py-5 space-y-4"
            >
              <p className="text-sm text-white/70">Te enviaremos un código de <b className="text-brand-orange">6 dígitos</b> a tu correo.</p>
              <div>
                <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 block mb-2">Correo electrónico</label>
                <div className="relative group">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-brand-orange transition-colors" strokeWidth={1.8} />
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-brand-orange/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
              </div>
              <div className="pt-2 flex items-center gap-2">
                <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 font-ui text-[11px] font-bold uppercase tracking-wider transition">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-[0_10px_30px_rgba(87,80,232,0.35)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enviar código
                </button>
              </div>
            </motion.form>
          )}

          {step === "code" && (
            <motion.form key="code"
              initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              onSubmit={submitReset}
              className="px-6 py-5 space-y-4"
            >
              <p className="text-sm text-white/70">Revisa <b className="text-brand-orange">{email}</b> e ingresa el código:</p>

              {/* OTP 6 boxes */}
              <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                {code.map((c, i) => (
                  <motion.input
                    key={i}
                    ref={(el) => { inputs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={1}
                    value={c}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKeyDownDigit(i, e)}
                    onPaste={onPasteCode}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={
                      "h-14 w-full max-w-[50px] rounded-xl text-center font-display text-2xl font-black tabular-nums text-white bg-white/[0.03] border-2 outline-none transition-all " +
                      (c ? "border-brand-orange bg-brand-orange/10 shadow-[0_0_0_3px_rgba(87,80,232,0.15)]" : "border-white/10 focus:border-brand-orange/60")
                    }
                  />
                ))}
              </div>

              {/* Nueva contraseña */}
              <div>
                <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 block mb-2">Nueva contraseña</label>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-brand-orange transition-colors" strokeWidth={1.8} />
                  <input
                    type={showPwd ? "text" : "password"}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-12 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-brand-orange/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-orange/20"
                  />
                  <button type="button" onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center text-white/55 hover:text-brand-orange hover:bg-white/5 transition">
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* Strength meter */}
                <div className="mt-2 flex items-center gap-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className={
                      "h-1 flex-1 rounded-full transition-all duration-300 " +
                      (i < strength.score ? strength.color : "bg-white/10")
                    } />
                  ))}
                  <div className="text-[10px] font-ui uppercase tracking-wider text-white/60 w-14 text-right">{strength.label}</div>
                </div>
              </div>

              {/* Confirmar */}
              <div>
                <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 block mb-2">Confirmar contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" strokeWidth={1.8} />
                  <input
                    type={showPwd ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Vuelve a escribirla"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-brand-orange/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
              </div>

              <div className="pt-1 flex items-center gap-2">
                <button type="button" onClick={() => setStep("email")}
                  className="h-11 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 font-ui text-[11px] font-bold uppercase tracking-wider transition flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Atrás
                </button>
                <button type="submit" disabled={loading || code.join("").length !== 6}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-[0_10px_30px_rgba(87,80,232,0.35)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Cambiar contraseña
                </button>
              </div>

              <button type="button" onClick={sendCode}
                className="w-full text-center text-[11px] text-white/55 hover:text-brand-orange font-ui uppercase tracking-[0.15em] transition">
                Reenviar código
              </button>
            </motion.form>
          )}

          {step === "done" && (
            <motion.div key="done"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="px-4 sm:px-6 py-6 sm:py-10 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: [0, -10, 10, 0] }}
                transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
                className="mx-auto h-20 w-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_20px_60px_rgba(16,185,129,0.35)] mb-5"
              >
                <Check className="h-10 w-10 text-white" strokeWidth={3.5} />
              </motion.div>
              <div className="font-display font-black text-xl text-white mb-1">Contraseña actualizada</div>
              <p className="text-sm text-white/65">Ya puedes iniciar sesión con tu nueva contraseña.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function passwordStrength(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!p) return { score: 0, label: "—", color: "" };
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  const map = [
    { label: "débil", color: "bg-red-500" },
    { label: "baja",  color: "bg-orange-500" },
    { label: "ok",    color: "bg-amber-400" },
    { label: "fuerte",color: "bg-emerald-500" },
    { label: "top",   color: "bg-gradient-to-r from-emerald-500 to-brand-orange" }
  ];
  const idx = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  return { score: idx, label: map[idx].label, color: map[idx].color };
}
