export function GridPattern({ className }: { className?: string }) {
  return <div className={`absolute inset-0 grid-pattern pointer-events-none ${className || ""}`} aria-hidden="true" />;
}

export function DotPattern({ className }: { className?: string }) {
  return <div className={`absolute inset-0 dot-pattern pointer-events-none ${className || ""}`} aria-hidden="true" />;
}
