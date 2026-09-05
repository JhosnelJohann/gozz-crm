"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Mail, Lock, Eye, EyeOff } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { ShimmerButton } from "@/components/magic/ShimmerButton";
import { useAuth, ApiError } from "../hooks/useAuth";
import { useAuthUiStore } from "../store";
import { ForgotPasswordModal } from "./ForgotPasswordModal";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const { login, loggingIn } = useAuth();
  const resetOpen = useAuthUiStore((s) => s.resetModalOpen);
  const openReset = useAuthUiStore((s) => s.openResetModal);
  const closeReset = useAuthUiStore((s) => s.closeResetModal);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await login({ email, password });
      toast.success("Bienvenido " + (data.user?.nombre || ""));
      setTimeout(() => { window.location.href = "/dashboard"; }, 600);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Credenciales inválidas");
    }
  };

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5 relative z-10">
        <div>
          <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/75 block mb-2">
            Correo electrónico
          </label>
          <div className="relative group">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-brand-orange transition-colors" strokeWidth={1.5} />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-4 py-3.5 text-sm outline-none transition-all placeholder:text-white/25 focus:border-brand-orange/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-orange/20"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/75 block mb-2">
            Contraseña
          </label>
          <div className="relative group">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-brand-orange transition-colors" strokeWidth={1.5} />
            <input
              type={showPwd ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-12 py-3.5 text-sm outline-none transition-all placeholder:text-white/25 focus:border-brand-orange/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-orange/20"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center bg-black/40 border border-white/10 text-white shadow-sm hover:bg-black/60 hover:border-brand-orange/60 hover:text-brand-orange active:scale-95 transition"
            >
              <motion.div
                key={showPwd ? "off" : "on"}
                initial={{ opacity: 0, scale: 0.8, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
              >
                {showPwd ? <EyeOff className="h-4 w-4" strokeWidth={2} /> : <Eye className="h-4 w-4" strokeWidth={2} />}
              </motion.div>
            </button>
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={openReset}
              className="text-[11px] font-ui uppercase tracking-[0.15em] text-white/55 hover:text-brand-orange transition"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        </div>

        <ShimmerButton type="submit" disabled={loggingIn} size="lg" className="w-full mt-4">
          {loggingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar al CRM"}
        </ShimmerButton>
      </form>

      <AnimatePresence>
        {resetOpen && <ForgotPasswordModal defaultEmail={email} onClose={closeReset} />}
      </AnimatePresence>
    </>
  );
}
