"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  HouseSimple, Users, Briefcase, CheckSquare, ChatCircle,
 Envelope, GraduationCap, ChartLine, Gear,
  CaretLeft, CaretRight, File, Sparkle, Clock, FolderSimple, AppWindow, Tray
} from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { useChatUnread } from "@/lib/useChatUnread";
import { useTareasPendientes } from "@/lib/useTareasPendientes";
import { BrandMark } from "@/components/magic/BrandMark";

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

export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const chatUnread = useChatUnread();
  const tareasPendientes = useTareasPendientes();
  const barraRef = useRef<HTMLElement | null>(null);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // COLAPSO AUTOMÁTICO — pedido en la reunión del 2026-08-24
  //
  // «Cuando yo cliquee que esté trabajando, que automáticamente él se colapse solito. Cuando tú
  // cliques afuera de la barra negra.» El motivo es ganar ancho para la vista de contenido, que en
  // el Drive es donde de verdad se trabaja.
  //
  // Aplica en TODO el CRM: decisión de Juan del 2026-08-24, sabiendo que cambia el hábito diario
  // en todas las pantallas y no solo en Drive.
  //
  // 🔴 `click` y NO `pointerdown`/`mousedown`, y el motivo es el tablero de Tareas. Con
  // `pointerdown` la barra empezaría a encogerse en el instante en que se APRIETA, o sea justo al
  // arrancar un arrastre de dnd-kit: la anchura se anima mientras la biblioteca está midiendo
  // dónde caen las columnas, y los destinos se mueven bajo el cursor. Un `click` no se dispara al
  // arrastrar, así que arrastrar no colapsa nada y soltar tampoco.
  //
  // ⚠️ Solo en escritorio. Por debajo de `lg` la barra no se colapsa: es un panel superpuesto que
  // se abre y se cierra con `mobileOpen`, y encogerlo a 76 px dejaría media barra flotando encima
  // del contenido.
  useEffect(() => {
    if (collapsed) return;                                  // ya está plegada: nada que hacer
    const alInteractuarFuera = (e: MouseEvent) => {
      if (window.matchMedia("(max-width: 1023px)").matches) return;   // móvil: manda `mobileOpen`
      const barra = barraRef.current;
      if (!barra || barra.contains(e.target as Node)) return;         // dentro de la barra no cuenta
      setCollapsed(true);
    };
    document.addEventListener("click", alInteractuarFuera);
    return () => document.removeEventListener("click", alInteractuarFuera);
  }, [collapsed]);

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
    <motion.aside
      ref={barraRef}
      animate={{ width: collapsed ? 76 : 264 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className={cn(
        "h-screen shrink-0 bg-bg-sidebar border-r border-white/5 text-white flex flex-col overflow-hidden z-50",
        "fixed top-0 left-0 lg:sticky transition-transform duration-300 lg:transition-none",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
    >
      {/* Subtle aurora gradient in sidebar */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse at 20% 0%, rgba(87,80,232,0.15), transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(131,56,236,0.12), transparent 50%)"
        }} />
      </div>

      {/* Header */}
      <div className="relative flex items-center gap-3 px-5 py-5 border-b border-white/5">
        <div className="relative shrink-0">
          <div className="absolute inset-0 rounded-xl bg-brand-orange/40 blur-lg animate-pulse-glow" />
          <img src="/logo-gozz.png" alt="GOZZ" className="relative h-10 w-10 drop-shadow-[0_4px_20px_rgba(87,80,232,0.6)]" />
        </div>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 min-w-0"
          >
            <BrandMark size="sm" surface="dark" />

            <div className="text-[9px] font-ui uppercase tracking-[0.2em] text-white/30 flex items-center gap-1">
              <Sparkle className="h-2.5 w-2.5" weight="fill" />
              CRM Oficial
            </div>
          </motion.div>
        )}
      </div>

      <nav className="relative flex-1 py-4 px-3 space-y-1 overflow-y-auto scrollbar-thin">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-300",
                active
                  ? "text-brand-orange bg-gradient-to-r from-brand-orange/20 via-brand-orange/10 to-transparent"
                  : "text-white/55 hover:text-white hover:bg-white/[0.04]"
              )}
              title={collapsed ? item.label : undefined}
            >
              {active && (
                <>
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r-full bg-gradient-to-b from-brand-orange to-brand-gold shadow-[0_0_20px_rgba(87,80,232,0.6)]"
                  />
                  <div className="absolute inset-0 rounded-xl opacity-50" style={{
                    background: "linear-gradient(90deg, rgba(87,80,232,0.15) 0%, transparent 100%)"
                  }} />
                </>
              )}
              {(() => {
                const badge = item.href === "/chat" ? chatUnread
                  : item.href === "/tareas" ? tareasPendientes
                  : 0;
                return (
                  <>
                    <div className="relative shrink-0">
                      <Icon className="relative h-[20px] w-[20px]" weight={active ? "duotone" : "regular"} />
                      {badge > 0 && collapsed && (
                        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 rounded-full bg-brand-red text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-bg-sidebar">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </div>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="relative text-sm font-medium truncate"
                      >
                        {item.label}
                      </motion.span>
                    )}
                    {!collapsed && badge > 0 && (
                      <span className="relative ml-auto h-5 min-w-[20px] px-1.5 rounded-full bg-brand-red text-white text-[10px] font-bold flex items-center justify-center shadow-[0_0_12px_rgba(239,68,68,0.6)]">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </>
                );
              })()}
            </Link>
          );
        })}
      </nav>

      {/* Collapse button (solo escritorio) */}
      <div className="relative p-3 border-t border-white/5 hidden lg:block">
        {/* 🔴 Naranja de MARCA y sólido, no `text-white/40`: «esta flechita, como no resalta casi,
            se pierde honestamente». Con el botón entero naranja se ve dónde se pulsa, que es lo que
            hace falta ahora que la barra se pliega sola. Token `brand-orange`, nunca un hex suelto
            (CONVENCIONES §4.3). */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expandir el menú" : "Colapsar el menú"}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 bg-brand-orange text-white transition",
            "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? (
            <CaretRight className="h-[18px] w-[18px]" weight="bold" />
          ) : (
            <>
              <CaretLeft className="h-[18px] w-[18px]" weight="bold" />
              <span className="text-[10px] font-ui uppercase tracking-[0.15em]">Colapsar</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
    </>
  );
}
