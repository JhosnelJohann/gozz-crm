"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MagnifyingGlass, SignOut, User, CaretDown,
  Command as CommandIcon, MagicWand, Sun, MoonStars, List
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { VoiceToTaskModal } from "./VoiceToTaskModal";
import { ClockButton } from "./clock/ClockButton";
import { CommandPalette } from "@/components/magic/CommandPalette";
import { useThemeToggle } from "@/components/magic/ThemeProvider";
import { NotificationsPanel } from "./NotificationsPanel";

interface Me { id: string; email: string; nombre: string; nivel_acceso: string; foto_perfil_url?: string | null; posiciones?: string[]; departamento?: string | null; }

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleTheme = useThemeToggle();

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user)).catch(() => {});
    setIsDark(document.documentElement.classList.contains("dark"));
    const onVoiceOpen = () => setVoiceOpen(true);
    window.addEventListener("voice-to-task-open", onVoiceOpen);
    return () => window.removeEventListener("voice-to-task-open", onVoiceOpen);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Sesión cerrada");
    setTimeout(() => { window.location.href = "/login"; }, 400);
  };

  const handleToggleTheme = () => {
    toggleTheme();
    setIsDark(document.documentElement.classList.contains("dark"));
  };

  const initials = me?.nombre?.split(" ").map((s) => s[0]).slice(0, 2).join("") || "?";

  return (
    <>
      <header className="sticky top-0 z-40 glass-topbar">
        <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3">
          {/* Hamburguesa (solo móvil) */}
          <button
            onClick={onMenuClick}
            aria-label="Abrir menú"
            className="lg:hidden shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-bg-surface-2 dark:bg-white/[0.04] border border-black/5 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.08] transition"
          >
            <List className="h-5 w-5" weight="bold" />
          </button>

          {/* Command palette trigger — icono solo en móvil (la barra ancha no cabe junto al resto
              de controles), caja completa desde `sm` en adelante. */}
          <button
            onClick={() => setCmdOpen(true)}
            aria-label="Buscar o ejecutar comando"
            className="sm:hidden shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-bg-surface-2 dark:bg-white/[0.04] border border-black/5 dark:border-white/10 hover:border-brand-primary/30 transition-all"
          >
            <MagnifyingGlass className="h-4 w-4 text-neutral-400" />
          </button>
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-3 flex-1 max-w-md h-10 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.04] border border-black/5 dark:border-white/10 hover:border-brand-primary/30 dark:hover:border-brand-primary/40 transition-all group"
          >
            <MagnifyingGlass className="h-4 w-4 text-neutral-400 group-hover:text-brand-primary transition-colors shrink-0" />
            <span className="text-sm text-neutral-400 flex-1 text-left truncate">Buscar o ejecutar comando…</span>
            <div className="flex items-center gap-1 text-[10px] font-semibold text-neutral-400 bg-black/5 dark:bg-white/5 rounded px-1.5 py-0.5">
              <CommandIcon className="h-2.5 w-2.5" weight="bold" />
              K
            </div>
          </button>

          <div className="flex-1" />

          {/* Voice to task */}
          <button
            onClick={() => setVoiceOpen(true)}
            className="hidden md:flex items-center gap-2 h-10 px-4 rounded-xl bg-gradient-to-r from-brand-orange/10 to-brand-gold/10 border border-brand-orange/20 text-brand-orange hover:from-brand-orange/20 hover:to-brand-gold/20 hover:shadow-glow transition-all font-ui text-[11px] uppercase tracking-wider font-bold"
          >
            <MagicWand className="h-4 w-4" weight="duotone" />
            <span>Voice → Task</span>
          </button>

          {/* Clock in/out */}
          <ClockButton />

          {/* Theme toggle */}
          <button
            onClick={handleToggleTheme}
            className="h-10 w-10 flex items-center justify-center rounded-xl bg-bg-surface-2 dark:bg-white/[0.04] border border-black/5 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.08] transition"
            title="Cambiar tema"
          >
            {isDark ? (
              <Sun className="h-[18px] w-[18px] text-brand-gold" weight="duotone" />
            ) : (
              <MoonStars className="h-[18px] w-[18px] text-brand-blue" weight="duotone" />
            )}
          </button>

          {/* Notifications panel (sonido + ir + marcar leída) */}
          <NotificationsPanel />

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 h-10 pl-1 pr-3 rounded-xl bg-bg-surface-2 dark:bg-white/[0.04] border border-black/5 dark:border-white/10 hover:bg-white dark:hover:bg-white/[0.08] transition"
            >
              <div className="h-8 w-8 rounded-lg overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-ui font-bold text-xs shadow-glow">
                {me?.foto_perfil_url ? <img src={me.foto_perfil_url} alt={me.nombre} className="h-full w-full object-cover" /> : initials}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-[11px] font-bold leading-tight truncate max-w-[120px]">{me?.nombre || "…"}</div>
                <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-500 truncate max-w-[140px]">{(me?.posiciones || [])[0] || me?.departamento || ""}</div>
              </div>
              <CaretDown className="h-3 w-3 text-neutral-400" weight="bold" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute right-0 mt-2 w-56 glass-panel rounded-2xl overflow-hidden z-50"
                >
                  <div className="px-4 py-3 border-b border-black/5 dark:border-white/5 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-bold text-xs">
                      {me?.foto_perfil_url ? <img src={me.foto_perfil_url} alt={me?.nombre || ""} className="h-full w-full object-cover" /> : initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm truncate">{me?.nombre}</div>
                      <div className="text-xs text-neutral-500 truncate">{me?.email}</div>
                    </div>
                  </div>
                  <button onClick={() => { if (me?.id) window.location.href = `/equipo/${me.id}`; }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition text-left">
                    <User className="h-4 w-4 text-neutral-500" weight="duotone" />
                    Mi perfil
                  </button>
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 dark:hover:bg-red-500/10 transition text-left text-brand-red"
                  >
                    <SignOut className="h-4 w-4" weight="duotone" />
                    Cerrar sesión
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <VoiceToTaskModal open={voiceOpen} onClose={() => setVoiceOpen(false)} onCreated={() => {}} />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}
