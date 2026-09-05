// Íconos de archivar/desarchivar estilo WhatsApp/Material: caja + flecha (abajo = archivar,
// arriba = desarchivar). El `Archive` de lucide trae una rayita en vez de flecha, por eso no
// coincide. Mismo estilo de trazo (stroke, currentColor) para encajar con el resto de la UI.
"use client";

interface IconProps { className?: string; strokeWidth?: number }

export function ArchiveDownIcon({ className, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M12 11v5.5" />
      <path d="m9.5 14 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function ArchiveUpIcon({ className, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M12 16.5V11" />
      <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}
