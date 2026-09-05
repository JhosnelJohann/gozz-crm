"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
}

export function PeerVideo({ stream, muted, mirrored, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={!!muted}
      className={cn("w-full h-full object-cover", mirrored && "scale-x-[-1]", className)}
    />
  );
}
