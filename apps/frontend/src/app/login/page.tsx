"use client";
import { motion } from "framer-motion";
import { FloatingOrbs } from "@/components/magic/FloatingOrbs";
import { BrandMark } from "@/components/magic/BrandMark";
import { MoonMark } from "@/components/magic/MoonMark";
import { LoginForm } from "@/features/auth/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-bg-canvas to-bg-surface-2 dark:from-bg-dark dark:to-bg-dark2 text-fg-light dark:text-fg-dark flex items-center justify-center px-4 py-10">
      {/* Fondo: orbes suaves en índigo de marca, sin grid ni ruido — un login claro no
          necesita una textura densa. */}
      <FloatingOrbs count={3} palette="light-indigo" />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 40, filter: "blur(20px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="relative rounded-3xl p-8 sm:p-10 border border-black/5 dark:border-white/10 overflow-hidden glass-light">
          {/* Filo superior con shimmer sutil, en vez del border-beam giratorio de antes */}
          <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden">
            <div className="h-full w-1/2 bg-gradient-to-r from-transparent via-brand-primary/50 to-transparent animate-shimmer" />
          </div>

          {/* Logo */}
          <div className="flex flex-col items-center mb-10">
            <motion.div
              initial={{ scale: 0.5, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 120, damping: 14, delay: 0.3 }}
              className="relative"
            >
              <div className="absolute inset-0 rounded-full bg-brand-primary/20 blur-2xl" />
              <MoonMark size={72} animated className="relative" />
            </motion.div>
            <div className="mt-6">
              <BrandMark size="lg" surface="light" />
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="mt-2 text-sm text-neutral-500 dark:text-white/50"
            >
              El CRM que compite con los mejores
            </motion.div>
          </div>

          <LoginForm />

          <div className="mt-8 text-center text-xs font-medium text-neutral-400 dark:text-white/40">
            GOZZ CRM
          </div>
        </div>

        <div className="mt-6 text-center text-[10px] text-neutral-400 dark:text-white/35 font-mono tracking-wider">
          v1.0
        </div>
      </motion.div>
    </main>
  );
}
