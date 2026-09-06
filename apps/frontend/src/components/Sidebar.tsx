"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HouseSimple, Users, Briefcase, CheckSquare, ChatCircle,
  Envelope, GraduationCap, ChartLine, Gear,
  File, Clock, FolderSimple, AppWindow, Tray, CaretLeft, CaretRight, X
} from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { useChatUnread } from "@/lib/useChatUnread";
import { useTareasPendientes } from "@/lib/useTareasPendientes";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";
import { MoonMark } from "@/components/magic/MoonMark";
import { Tooltip } from "@/components/ui/Tooltip";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: HouseSimple },
  { href: "/contactos", label: "Contactos", icon: Users },
  { href: "/oportunidades", label: "Oportunidades", icon: Briefcase },
  { href: "/solicitudes", label: "Solicitudes", icon: Tray },
  { href: "/tareas", label: "Tareas", icon: CheckSquare },
  { href: "/tramites", label: "Trámites", icon: File },
  { href: "/drive", label: "Drive", icon: FolderSimple },
  { href: "/chat", label: "Chat", icon: ChatCircle },
  { href: "/correo", label: "Correo", icon: Envelope },
  { href: "/academia", label: "Academia", icon: GraduationCap },
  { href: "/reportes", label: "Reportes", icon: ChartLine },
  { href: "/equipo", label: "Equipo", icon: Users },
  { href: "/asistencia", label: "Asistencia", icon: Clock },
  { href: "/aplicaciones", label: "Aplicaciones", icon: AppWindow },
  { href: "/configuracion", label: "Configuración", icon: Gear }
];

/**
 * Rail de navegación (rediseño 2026):
 *  · Escritorio (`lg` y arriba): se puede desplegar (264px, ícono + etiqueta) o contraer
 *    (76px, solo ícono con tooltip) — el usuario elige con el botón del pie, y se recuerda
 *    en localStorage entre sesiones.
 *  · Móvil: diseño propio, no una versión angosta del de escritorio — un panel superpuesto
 *    más ancho (296px) que SIEMPRE muestra ícono + etiqueta (en touch no hay hover para
 *    tooltips, así que ocultar el texto ahí perjudica el descubrimiento).
 *
 * 🔴 El fondo se queda negro (`bg-sidebar`) SIEMPRE, en claro y en oscuro — es intencional:
 * la referencia visual mantiene el rail oscuro sin importar el tema del resto de la app.
 */
export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const chatUnread = useChatUnread();
  const tareasPendientes = useTareasPendientes();
  const { user } = useCurrentUser();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar-collapsed", v ? "0" : "1");
      return !v;
    });
  }

  return (
    <>
      {/* Overlay oscuro (solo móvil) */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300",
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      />

      {/* ── Escritorio: rail desplegable/contraíble ─────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 76 : 264 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="hidden lg:flex h-screen shrink-0 sticky top-0 bg-bg-sidebar border-r border-white/5 text-white flex-col overflow-hidden z-50"
      >
        <SidebarContent
          pathname={pathname}
          collapsed={collapsed}
          chatUnread={chatUnread}
          tareasPendientes={tareasPendientes}
          user={user}
          footer={
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Desplegar el menú" : "Contraer el menú"}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-white/50 hover:text-white hover:bg-white/[0.06] transition w-full",
                collapsed && "justify-center px-0"
              )}
            >
              {collapsed ? <CaretRight size={16} /> : <><CaretLeft size={16} /><span className="text-xs font-medium">Contraer</span></>}
            </button>
          }
        />
      </motion.aside>

      {/* ── Móvil: panel propio, siempre con etiquetas ──────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            initial={{ x: -296 }}
            animate={{ x: 0 }}
            exit={{ x: -296 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="lg:hidden fixed top-0 left-0 h-screen w-[296px] bg-bg-sidebar border-r border-white/5 text-white flex flex-col overflow-hidden z-50"
          >
            <SidebarContent
              pathname={pathname}
              collapsed={false}
              chatUnread={chatUnread}
              tareasPendientes={tareasPendientes}
              user={user}
              onNavigate={onClose}
              headerExtra={
                <button
                  onClick={onClose}
                  aria-label="Cerrar menú"
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06]"
                >
                  <X size={18} />
                </button>
              }
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

interface ContentProps {
  pathname: string;
  collapsed: boolean;
  chatUnread: number;
  tareasPendientes: number;
  user: ReturnType<typeof useCurrentUser>["user"];
  footer?: React.ReactNode;
  headerExtra?: React.ReactNode;
  onNavigate?: () => void;
}

function SidebarContent({ pathname, collapsed, chatUnread, tareasPendientes, user, footer, headerExtra, onNavigate }: ContentProps) {
  return (
    <>
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, rgba(87,80,232,0.15), transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(131,56,236,0.12), transparent 50%)"
          }}
        />
      </div>

      <div className={cn("relative flex items-center h-[72px] w-full shrink-0 border-b border-white/5 gap-2", collapsed ? "justify-center px-0" : "px-5")}>
        <Link href="/dashboard" aria-label="GOZZ" className="relative shrink-0" onClick={onNavigate}>
          <div className="absolute inset-0 rounded-xl bg-brand-primary/40 blur-lg" />
          <MoonMark size={30} className="relative" />
        </Link>
        {!collapsed && (
          <span className="font-display font-bold text-white/80 text-sm tracking-tight">GOZZ</span>
        )}
        {headerExtra}
      </div>

      <nav className={cn("relative flex-1 w-full py-3 space-y-1 overflow-y-auto scrollbar-thin flex flex-col", collapsed ? "items-center" : "px-3")}>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const badge = item.href === "/chat" ? chatUnread : item.href === "/tareas" ? tareasPendientes : 0;

          const link = (
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center rounded-2xl transition-colors",
                collapsed ? "justify-center h-11 w-11" : "gap-3 h-11 px-3 w-full"
              )}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className={cn("absolute inset-0 bg-brand-primary shadow-glow", collapsed ? "rounded-2xl" : "rounded-xl")}
                />
              )}
              <span className="relative shrink-0">
                <Icon
                  size={22}
                  weight={active ? "duotone" : "regular"}
                  className={cn("transition-colors", active ? "text-white" : "text-white/50")}
                />
                {badge > 0 && collapsed && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 rounded-full bg-brand-red text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-bg-sidebar">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              {!collapsed && (
                <span className={cn("relative text-sm font-medium truncate flex-1", active ? "text-white" : "text-white/60")}>
                  {item.label}
                </span>
              )}
              {!collapsed && badge > 0 && (
                <span className="relative h-5 min-w-[20px] px-1.5 rounded-full bg-brand-red text-white text-[10px] font-bold flex items-center justify-center">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );

          return collapsed ? (
            <Tooltip key={item.href} label={item.label} side="right">
              {link}
            </Tooltip>
          ) : (
            <div key={item.href}>{link}</div>
          );
        })}
      </nav>

      <div className={cn("relative w-full py-3 border-t border-white/5 flex flex-col gap-1", collapsed ? "items-center px-0" : "px-3")}>
        {footer}
        {(() => {
          const link = (
            <Link
              href="/configuracion"
              onClick={onNavigate}
              aria-label="Configuración"
              className={cn(
                "flex items-center rounded-xl transition hover:bg-white/[0.06]",
                collapsed ? "justify-center h-10 w-10" : "gap-3 h-11 px-3 w-full"
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-gold text-white text-xs font-bold">
                {user ? initialsOf(user.nombre) : <Gear size={16} weight="regular" />}
              </span>
              {!collapsed && <span className="text-sm font-medium text-white/70 truncate">{user?.nombre || "Configuración"}</span>}
            </Link>
          );
          return collapsed ? <Tooltip label={user?.nombre || "Configuración"} side="right">{link}</Tooltip> : link;
        })()}
      </div>
    </>
  );
}
