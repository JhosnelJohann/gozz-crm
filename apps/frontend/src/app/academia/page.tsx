"use client";
import { motion } from "framer-motion";
import { Sparkles, Construction } from "@/lib/bootstrap-icons";
import { AppShell } from "@/components/AppShell";

export default function Page() {
  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-3xl p-12 text-center max-w-2xl mx-auto"
        >
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-orange/10 mb-6">
            <Construction className="h-8 w-8 text-brand-orange" strokeWidth={1.5} />
          </div>
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
            <Sparkles className="h-3 w-3" strokeWidth={1.5} />
            En construcción
          </div>
          <h1 className="font-display text-4xl font-black mb-3">Academia</h1>
          <p className="text-neutral-500 max-w-md mx-auto">
            Módulo en construcción. Disponible en las próximas fases del roadmap.
          </p>
        </motion.div>
      </div>
    </AppShell>
  );
}
