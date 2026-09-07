"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  fotoUrl?: string | null;
  nombre: string;
  size?: number;
  className?: string;
}

/** Foto de perfil real cuando existe; si no hay, o la URL de WhatsApp ya expiró, cae a las
 * iniciales de siempre — nunca un hueco en blanco. */
export function WhatsAppAvatar({ fotoUrl, nombre, size = 40, className }: Props) {
  const [error, setError] = useState(false);
  const inicial = (nombre || "?").trim().slice(0, 1).toUpperCase();

  if (fotoUrl && !error) {
    return (
      <img
        src={fotoUrl}
        alt={nombre}
        onError={() => setError(true)}
        style={{ height: size, width: size }}
        className={cn("rounded-full object-cover shrink-0 bg-brand-green/15", className)}
      />
    );
  }
  return (
    <div
      style={{ height: size, width: size, fontSize: Math.max(11, size * 0.4) }}
      className={cn("rounded-full bg-brand-green/15 text-brand-green flex items-center justify-center font-bold shrink-0", className)}
    >
      {inicial}
    </div>
  );
}
