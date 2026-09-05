"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard, Users, Briefcase, CheckSquare, MessageSquare,
  FileText, GraduationCap, BarChart3, Settings, KeyRound, Search, UserPlus,
  Plus, LogOut, Mic, Sparkles, ArrowDown, ArrowUp, CornerDownLeft
} from "@/lib/bootstrap-icons";

interface Action {
  id: string;
  label: string;
  subtitle?: string;
  icon: any;
  iconColor?: string;
  keywords?: string;
  onSelect: () => void;
  section?: string;
  shortcut?: string;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) onOpenChange(false);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const go = (href: string) => { router.push(href); onOpenChange(false); };

  const nav: Action[] = [
    { id: "dash", label: "Dashboard", subtitle: "Vista general del CRM", icon: LayoutDashboard, iconColor: "#5750E8", section: "Navegar", onSelect: () => go("/dashboard"), shortcut: "G D" },
    { id: "cont", label: "Contactos", subtitle: "Base de leads y clientes", icon: Users, iconColor: "#2196C9", section: "Navegar", onSelect: () => go("/contactos"), shortcut: "G C" },
    { id: "opo", label: "Oportunidades", subtitle: "Pipeline de casos", icon: Briefcase, iconColor: "#8B4EE6", section: "Navegar", onSelect: () => go("/oportunidades"), shortcut: "G O" },
    { id: "tar", label: "Tareas", subtitle: "To-do del equipo", icon: CheckSquare, iconColor: "#43A847", section: "Navegar", onSelect: () => go("/tareas"), shortcut: "G T" },
    { id: "tra", label: "Trámites", subtitle: "Plantillas USCIS", icon: FileText, iconColor: "#FFB51C", section: "Navegar", onSelect: () => go("/tramites") },
    { id: "cha", label: "Chat interno", subtitle: "Mensajes del equipo", icon: MessageSquare, iconColor: "#06BCC1", section: "Navegar", onSelect: () => go("/chat") },
    { id: "aca", label: "Academia", subtitle: "Capacitaciones", icon: GraduationCap, iconColor: "#E53935", section: "Navegar", onSelect: () => go("/academia") },
    { id: "rep", label: "Reportes", subtitle: "Análisis y métricas", icon: BarChart3, iconColor: "#9D174D", section: "Navegar", onSelect: () => go("/reportes") },
    { id: "con2", label: "Configuración", subtitle: "Panel admin", icon: Settings, iconColor: "#5C6670", section: "Navegar", onSelect: () => go("/configuracion") },
    { id: "api", label: "API Keys", subtitle: "Integraciones externas", icon: KeyRound, iconColor: "#0EA5E9", section: "Admin", onSelect: () => go("/configuracion/api-keys") },
    { id: "usr", label: "Gestión de usuarios", subtitle: "Equipo y roles", icon: UserPlus, iconColor: "#EC4899", section: "Admin", onSelect: () => go("/configuracion/usuarios") },
  ];

  const actions: Action[] = [
    { id: "new-op", label: "Nueva oportunidad", subtitle: "Crear caso en pipeline", icon: Plus, iconColor: "#5750E8", section: "Acciones rápidas", onSelect: () => go("/oportunidades") },
    { id: "new-ct", label: "Nuevo contacto", subtitle: "Agregar lead/cliente", icon: Plus, iconColor: "#2196C9", section: "Acciones rápidas", onSelect: () => go("/contactos") },
    { id: "new-tk", label: "Nueva tarea", subtitle: "To-do nuevo", icon: Plus, iconColor: "#43A847", section: "Acciones rápidas", onSelect: () => go("/tareas") },
    { id: "voice", label: "Voice → Task con IA", subtitle: "Graba una nota y Claude crea la tarea", icon: Mic, iconColor: "#8B4EE6", section: "Acciones rápidas", onSelect: () => { onOpenChange(false); window.dispatchEvent(new Event("voice-to-task-open")); } },
    { id: "logout", label: "Cerrar sesión", subtitle: "Salir del CRM", icon: LogOut, iconColor: "#E53935", section: "Sistema", onSelect: async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; } },
  ];

  const all = [...nav, ...actions];
  const sections = Array.from(new Set(all.map(a => a.section || "Otros")));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-neutral-900/40 dark:bg-black/60 backdrop-blur-md flex items-start justify-center p-4 pt-24 animate-fade-in"
      onClick={() => onOpenChange(false)}
    >
      <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Glow exterior */}
        <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-brand-orange/30 via-amber-400/20 to-brand-orange/30 blur-2xl opacity-60 pointer-events-none" />

        <div className="relative bg-white dark:bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-200 dark:border-white/10 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.25)]">
          <Command label="Command" shouldFilter>
            {/* Search hero */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100 dark:border-white/5 bg-gradient-to-b from-orange-50/40 to-transparent dark:from-orange-900/10">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-orange to-amber-500 flex items-center justify-center shadow-sm shadow-brand-orange/20">
                <Search className="h-4 w-4 text-white" strokeWidth={2.4} />
              </div>
              <Command.Input
                placeholder="Escribe un comando o busca..."
                className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-neutral-400 dark:text-white font-medium"
                autoFocus
              />
              <kbd className="text-[10px] font-ui font-black uppercase tracking-wider px-2 py-1 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-500 dark:text-neutral-300 border border-neutral-200 dark:border-white/10">ESC</kbd>
            </div>

            {/* Lista */}
            <Command.List className="max-h-[440px] overflow-y-auto scrollbar-thin p-2 bg-white dark:bg-neutral-900">
              <Command.Empty className="py-12 text-center">
                <div className="inline-flex flex-col items-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-brand-orange" strokeWidth={2} />
                  </div>
                  <p className="text-sm font-display font-black text-neutral-700 dark:text-neutral-300">Sin resultados</p>
                  <p className="text-xs text-neutral-400">Probá con otro término o presiona ESC para cerrar</p>
                </div>
              </Command.Empty>

              {sections.map((section) => (
                <Command.Group
                  key={section}
                  heading={section}
                  className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-ui [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-neutral-400 dark:[&_[cmdk-group-heading]]:text-neutral-500"
                >
                  {all.filter(a => (a.section || "Otros") === section).map(action => {
                    const Icon = action.icon;
                    const color = action.iconColor || "#5750E8";
                    return (
                      <Command.Item
                        key={action.id}
                        onSelect={action.onSelect}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border-l-2 border-transparent aria-selected:border-brand-orange aria-selected:bg-gradient-to-r aria-selected:from-orange-50 aria-selected:to-transparent dark:aria-selected:from-orange-900/20 dark:aria-selected:to-transparent aria-selected:shadow-sm"
                      >
                        <div
                          className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-aria-selected:scale-105"
                          style={{ background: color + "15", color }}
                        >
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-neutral-900 dark:text-white truncate group-aria-selected:text-brand-orange transition-colors">
                            {action.label}
                          </div>
                          {action.subtitle && (
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                              {action.subtitle}
                            </div>
                          )}
                        </div>
                        {action.shortcut && (
                          <kbd className="text-[9px] font-ui font-black uppercase tracking-wider px-1.5 py-1 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-500 dark:text-neutral-300 border border-neutral-200/80 dark:border-white/10 shrink-0">
                            {action.shortcut}
                          </kbd>
                        )}
                        <CornerDownLeft className="h-3 w-3 text-neutral-300 dark:text-neutral-600 opacity-0 group-aria-selected:opacity-100 transition-opacity shrink-0" strokeWidth={2} />
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>

            {/* Footer */}
            <div className="border-t border-neutral-100 dark:border-white/5 px-4 py-2.5 bg-neutral-50/50 dark:bg-white/[0.02] flex items-center gap-4 text-[10px] font-ui text-neutral-500 dark:text-neutral-400">
              <span className="flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-white/10 border border-neutral-200 dark:border-white/10 font-bold"><ArrowUp className="h-2.5 w-2.5 inline" /></kbd>
                  <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-white/10 border border-neutral-200 dark:border-white/10 font-bold"><ArrowDown className="h-2.5 w-2.5 inline" /></kbd>
                </span>
                Navegar
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-white/10 border border-neutral-200 dark:border-white/10 font-bold flex items-center gap-0.5"><CornerDownLeft className="h-2.5 w-2.5" /></kbd>
                Seleccionar
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-brand-orange" /> GOZZ CRM
              </span>
            </div>
          </Command>
        </div>
      </div>
    </div>
  );
}
