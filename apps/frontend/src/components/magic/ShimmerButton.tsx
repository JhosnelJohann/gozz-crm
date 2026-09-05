"use client";
import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
}

export const ShimmerButton = forwardRef<HTMLButtonElement, Props>(
  ({ children, className, size = "md", ...props }, ref) => {
    const sizes = {
      sm: "h-9 px-4 text-[11px]",
      md: "h-11 px-6 text-xs",
      lg: "h-14 px-8 text-sm"
    };
    return (
      <button
        ref={ref}
        className={cn(
          "shimmer-btn relative inline-flex items-center justify-center rounded-xl font-ui font-bold uppercase tracking-wider text-white disabled:opacity-60",
          sizes[size],
          className
        )}
        {...props}
      >
        <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      </button>
    );
  }
);
ShimmerButton.displayName = "ShimmerButton";
