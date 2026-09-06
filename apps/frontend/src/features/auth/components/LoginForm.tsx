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
          <label className="text-xs font-semibold text-neutral-500 dark:text-white/70 block mb-2">
            Correo electrónico
          </label>
          <div className="relative group">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 dark:text-white/30 group-focus-within:text-brand-primary transition-colors" strokeWidth={1.5} />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.03] pl-10 pr-4 py-3.5 text-sm text-fg-light dark:text-fg-dark outline-none transition-all placeholder:text-neutral-400 dark:placeholder:text-white/25 focus:border-brand-primary/60 focus:ring-2 focus:ring-brand-primary/20"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-neutral-500 dark:text-white/70 block mb-2">
            Contraseña
          </label>
          <div className="relative group">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 dark:text-white/30 group-focus-within:text-brand-primary transition-colors" strokeWidth={1.5} />
            <input
              type={showPwd ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.03] pl-10 pr-12 py-3.5 text-sm text-fg-light dark:text-fg-dark outline-none transition-all placeholder:text-neutral-400 dark:placeholder:text-white/25 focus:border-brand-primary/60 focus:ring-2 focus:ring-brand-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 text-neutral-500 dark:text-white shadow-sm hover:bg-black/10 dark:hover:bg-black/60 hover:border-brand-primary/60 hover:text-brand-primary active:scale-95 transition"
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
              className="text-xs font-medium text-neutral-500 dark:text-white/55 hover:text-brand-primary transition"
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
