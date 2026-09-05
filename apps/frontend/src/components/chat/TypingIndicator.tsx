"use client";
import { initialsOf } from "@/lib/auth-user";
import { cn } from "@/lib/utils";

/**
 * 3 bolitas con gradient brand naranja→magenta que rebotan en cascada.
 * Animación 100% CSS (keyframes en globals.css). Liviano, sin re-renders.
 */
export function TypingDots({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const cls =
    size === "lg" ? "h-2.5 w-2.5"
    : size === "md" ? "h-2 w-2"
    : "h-1.5 w-1.5";
  return (
    <span className="inline-flex items-end gap-0.5 align-middle">
      <span className={cn(cls, "rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta typing-dot")} />
      <span className={cn(cls, "rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta typing-dot")} />
      <span className={cn(cls, "rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta typing-dot")} />
    </span>
  );
}

/**
 * Burbuja "está escribiendo" al final del chat, estilo Messenger/WhatsApp web.
 * Muestra mini-avatar (foto de perfil o iniciales con gradient brand fallback)
 * + 3 dots animados dentro de un glass-bubble-other. Slide+fade on mount.
 * Para múltiples typers en grupo, apila hasta 3 avatares.
 */
export function TypingBubble({ users }: { users: Array<{ userId: string; nombre: string; foto?: string | null }> }) {
  if (!users || users.length === 0) return null;
  const show = users.slice(0, 3);
  return (
    <div className="flex gap-2.5 max-w-[88%] justify-start typing-bubble-enter">
      <div className="self-end pt-1 flex -space-x-2 shrink-0">
        {show.map((u) => (
          <div
            key={u.userId}
            className="h-7 w-7 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-neutral-900"
            title={u.nombre}
          >
            {u.foto ? (
              <img src={u.foto} alt={u.nombre} className="h-full w-full object-cover" />
            ) : initialsOf(u.nombre || "?")}
          </div>
        ))}
      </div>
      <div className="glass-bubble-other rounded-2xl rounded-bl-[6px] px-4 py-3 inline-flex items-center gap-1 shadow-sm">
        <TypingDots size="md" />
      </div>
    </div>
  );
}
