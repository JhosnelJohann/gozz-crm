import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

export const GlassCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("glass rounded-[20px] p-8 transition-all duration-300", className)}
      {...props}
    />
  )
);
GlassCard.displayName = "GlassCard";
