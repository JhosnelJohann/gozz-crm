"use client";
import { Shield, Crown, User } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; cls: string; Icon: any }> = {
  super_admin: { label: "SUPER ADMIN", cls: "bg-gradient-to-r from-brand-orange to-neon-magenta text-white", Icon: Crown },
  admin:       { label: "ADMINISTRADOR", cls: "bg-gradient-to-r from-blue-500 to-purple-600 text-white", Icon: Shield },
  usuario:     { label: "USUARIO", cls: "bg-zinc-700 text-white", Icon: User },
};

export function RoleBadge({ nivel, className }: { nivel: string; className?: string }) {
  const cfg = STYLES[nivel] || STYLES.usuario;
  const Icon = cfg.Icon;
  return (
    <div className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-ui uppercase tracking-[0.15em] font-bold shadow-lg", cfg.cls, className)}>
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {cfg.label}
    </div>
  );
}
