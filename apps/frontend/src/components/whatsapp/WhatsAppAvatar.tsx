"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  fotoUrl?: string | null;
  nombre: string;
  size?: number;
  className?: string;
}

/** Foto de perfil real cuando existe; si no hay, o no carga, cae a las iniciales — nunca un hueco
 * en blanco. Las iniciales se pintan DEBAJO mientras la foto carga (lazy, decodificación fuera del
 * hilo principal) y la foto entra con un fundido: con 50 conversaciones en la lista no se bloquea
 * el scroll ni se ven saltos. Las fotos se sirven desde almacenamiento propio con caché de una
 * semana (ver persistirFoto en baileys.provider.ts), no desde el CDN de WhatsApp, que caduca. */
export function WhatsAppAvatar({ fotoUrl, nombre, size = 40, className }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [cargada, setCargada] = useState<string | null>(null);
  // Primera letra o número (no un símbolo: "[DEMO] Ana" → "D", "+58 412…" → "5").
  const inicial = ((nombre || "").match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase();
  const mostrarFoto = !!fotoUrl && error !== fotoUrl;

  return (
    <div
      style={{ height: size, width: size, fontSize: Math.max(11, size * 0.4) }}
      className={cn("relative rounded-full bg-brand-green/15 text-brand-green flex items-center justify-center font-bold shrink-0 overflow-hidden", className)}
    >
      {(!mostrarFoto || cargada !== fotoUrl) && <span aria-hidden>{inicial}</span>}
      {mostrarFoto && (
        <img
          src={fotoUrl!}
          alt={nombre}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onLoad={() => setCargada(fotoUrl!)}
          onError={() => setError(fotoUrl!)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            cargada === fotoUrl ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
