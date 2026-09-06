"use client";
import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Tipografía Inter semibold en sentence-case (no Oswald/mayúsculas, ver docs/ROADMAP.md —
// decisión de rediseño 2026): las mayúsculas con tracking ancho leen "startup 2019", no
// "SaaS elite". `font-ui`/Oswald se deja intacto para el resto de la app que aún no migra.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-sans font-semibold transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-primary text-white shadow-glow hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0",
        secondary:
          "bg-black/[0.04] dark:bg-white/[0.06] text-fg-light dark:text-fg-dark border border-black/5 dark:border-white/10 hover:bg-black/[0.07] dark:hover:bg-white/10",
        ghost:
          "text-neutral-500 hover:text-brand-primary hover:bg-black/[0.03] dark:hover:bg-white/[0.05]",
        danger: "bg-brand-red/10 text-brand-red hover:bg-brand-red/20"
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
