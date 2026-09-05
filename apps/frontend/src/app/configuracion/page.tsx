"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { Users, KeyRound, Bell, Palette, ShieldCheck, Sparkles, ArrowRight, Building2, Cog } from "@/lib/bootstrap-icons";
import { AppShell } from "@/components/AppShell";

const SECTIONS = [
  { href: "/configuracion/usuarios", label: "Usuarios del equipo", desc: "Crear, editar y asignar roles", Icon: Users, color: "#5750E8" },
  { href: "/configuracion/departamentos", label: "Departamentos", desc: "Estructura organizacional", Icon: Building2, color: "#FFB51C" },
  { href: "/configuracion/pipeline", label: "Pipeline & Automations", desc: "Etapas, colores, disparadores y campos obligatorios", Icon: Cog, color: "#8B4EE6" },
  { href: "/configuracion/notificaciones", label: "Notificaciones", desc: "Preferencias de alertas", Icon: Bell, color: "#E53935" },
  { href: "/configuracion/api-keys", label: "API Keys", desc: "Llaves públicas para integraciones externas", Icon: KeyRound, color: "#2196C9" },
  { href: "/configuracion/seguridad", label: "Seguridad", desc: "Auditoría y sesiones activas", Icon: ShieldCheck, color: "#5C6670" }
];

// La "Papelera / Archivos sin identificar" se movió al modal de papelera del Drive (Fase B3) — ya no está acá.

export default function ConfiguracionPage() {
  const sections = SECTIONS;
  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            Admin
          </div>
          <h1 className="font-display text-4xl font-black leading-tight">
            <span className="text-gradient-orange">Configuración</span>
          </h1>
          <p className="mt-2 text-neutral-500">Panel del super administrador</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((s, i) => {
            const Icon = s.Icon;
            return (
              <motion.div
                key={s.href}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
              >
                <Link
                  href={s.href}
                  className="group glass rounded-2xl p-6 flex items-start gap-4 hover:shadow-glow-lg hover:-translate-y-0.5 transition-all"
                >
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: s.color + "15" }}>
                    <Icon className="h-6 w-6" strokeWidth={1.5} style={{ color: s.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="font-display font-black text-base">{s.label}</div>
                      <ArrowRight className="h-4 w-4 text-neutral-300 group-hover:text-brand-orange group-hover:translate-x-1 transition-all" strokeWidth={1.5} />
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">{s.desc}</div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
