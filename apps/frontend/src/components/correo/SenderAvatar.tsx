"use client";
import { cn } from "@/lib/utils";

const GRADIENTS = [
  "from-[#5750E8] to-[#FFB51C]",
  "from-[#2196C9] to-[#06FFA5]",
  "from-[#FF006E] to-[#FFB51C]",
  "from-[#8338EC] to-[#3A86FF]",
  "from-[#43A847] to-[#06FFA5]",
  "from-[#FF006E] to-[#8338EC]",
  "from-[#FFBE0B] to-[#5750E8]",
  "from-[#3A86FF] to-[#8338EC]",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function SenderAvatar({
  email,
  name,
  size = 36,
  className,
}: {
  email?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const key = (email || name || "?").toLowerCase().trim();
  const grad = GRADIENTS[hash(key) % GRADIENTS.length];
  const label = name || email || "?";
  const initials = label
    .split(/\s|@|\./)
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "relative shrink-0 rounded-xl flex items-center justify-center font-ui font-bold text-white overflow-hidden bg-gradient-to-br shadow-inner",
        grad,
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.35) }}
      title={name || email || ""}
    >
      <span className="drop-shadow-sm">{initials || "?"}</span>
    </div>
  );
}
