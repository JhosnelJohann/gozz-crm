import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Marquee({ children, className, reverse = false }: { children: ReactNode; className?: string; reverse?: boolean }) {
  return (
    <div className={cn("relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]", className)}>
      <div className={cn("flex gap-6 marquee-track w-max", reverse && "[animation-direction:reverse]")}>
        <div className="flex gap-6 shrink-0">{children}</div>
        <div className="flex gap-6 shrink-0" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}
