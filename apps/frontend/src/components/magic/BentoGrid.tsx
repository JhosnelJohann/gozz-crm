import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

interface BentoProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function BentoGrid({ className, children, ...props }: BentoProps) {
  return (
    <div className={cn("grid grid-cols-12 auto-rows-[minmax(160px,auto)] gap-4", className)} {...props}>
      {children}
    </div>
  );
}

interface ItemProps extends HTMLAttributes<HTMLDivElement> {
  span?: string;
  rowSpan?: string;
  children: React.ReactNode;
}

export function BentoItem({ span = "col-span-12 md:col-span-6 lg:col-span-4", rowSpan = "", className, children, ...props }: ItemProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl2 spotlight-card",
        "bg-bg-canvas dark:bg-bg-darkcard border border-black/5 dark:border-white/[0.06] shadow-card-light transition-shadow hover:shadow-card-light-hover",
        span,
        rowSpan,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
