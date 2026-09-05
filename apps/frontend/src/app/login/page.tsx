"use client";
import { motion } from "framer-motion";
import { Sparkles } from "@/lib/bootstrap-icons";
import { AuroraBackground } from "@/components/magic/AuroraBackground";
import { FloatingOrbs } from "@/components/magic/FloatingOrbs";
import { GridPattern } from "@/components/magic/GridPattern";
import { BrandMark } from "@/components/magic/BrandMark";
import { LoginForm } from "@/features/auth/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-bg-dark text-white flex items-center justify-center">
      {/* Layered background */}
      <AuroraBackground intensity={0.8} />
      <FloatingOrbs count={5} />
      <GridPattern />

      {/* Noise on top of gradients */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`
        }}
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 40, filter: "blur(20px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        {/* Glow halo behind card */}
        <div className="absolute -inset-8 rounded-[32px] bg-gradient-to-r from-neon-orange/30 via-neon-magenta/20 to-neon-purple/30 blur-3xl opacity-60 animate-pulse-glow" />

        <div className="relative rounded-3xl p-10 border border-white/10 overflow-hidden bg-[rgba(10,10,20,0.85)] backdrop-blur-2xl backdrop-saturate-200 shadow-[0_10px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
          {/* Animated border beam */}
          <div className="pointer-events-none absolute inset-0 rounded-3xl border-beam" />

          {/* Logo */}
          <div className="flex flex-col items-center mb-10">
            <motion.div
              initial={{ scale: 0.5, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 120, damping: 14, delay: 0.3 }}
              className="relative"
            >
              <div className="absolute inset-0 rounded-full bg-brand-orange/40 blur-2xl animate-pulse-glow" />
              <img
                src="/logo-gozz.png"
                alt="GOZZ"
                className="relative h-28 w-28 drop-shadow-[0_12px_40px_rgba(87,80,232,0.8)]"
              />
            </motion.div>
            <div className="mt-6">
              <BrandMark size="lg" surface="dark" />
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="mt-2 flex items-center gap-1.5 text-[11px] text-white/65 font-ui uppercase tracking-[0.2em]"
            >
              <Sparkles className="h-3 w-3 text-brand-orange" strokeWidth={1.5} />
              El primer CRM oficial · 2026
            </motion.div>
          </div>

          <LoginForm />

          <div className="mt-8 text-center text-[10px] text-white/55 font-ui uppercase tracking-[0.2em]">
            GOZZ CRM
          </div>
        </div>

        <div className="mt-6 text-center text-[10px] text-white/45 font-mono tracking-wider">
          v1.0
        </div>
      </motion.div>
    </main>
  );
}
