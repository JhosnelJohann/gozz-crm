import { cn } from "@/lib/utils";

export function PresenceBadge({
  name,
  online = false,
  size = 40,
  className
}: { name: string; online?: boolean; size?: number; className?: string }) {
  const initials = name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <div
        className="gradient-orange rounded-xl flex items-center justify-center text-white font-ui font-bold"
        style={{ width: size, height: size, fontSize: size * 0.35 }}
      >
        {initials}
      </div>
      {online && (
        <>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-brand-green ring-2 ring-white dark:ring-bg-dark-card" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-brand-green animate-ping opacity-75" />
        </>
      )}
    </div>
  );
}
