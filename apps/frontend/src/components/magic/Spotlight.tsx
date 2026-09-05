"use client";
import { useRef, HTMLAttributes, forwardRef, MutableRefObject } from "react";
import { cn } from "@/lib/utils";

export const Spotlight = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, onMouseMove, children, ...props }, ref) => {
    const innerRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>;
    const mergedRef = (el: HTMLDivElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = el;
    };
    const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const el = innerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--x", `${e.clientX - rect.left}px`);
        el.style.setProperty("--y", `${e.clientY - rect.top}px`);
      }
      onMouseMove?.(e);
    };
    return (
      <div ref={mergedRef} onMouseMove={onMove} className={cn("spotlight-card", className)} {...props}>
        {children}
      </div>
    );
  }
);
Spotlight.displayName = "Spotlight";
