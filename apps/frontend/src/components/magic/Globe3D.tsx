"use client";
import { useEffect, useRef } from "react";
import createGlobe from "cobe";

export function Globe3D({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);
  const pointerInteracting = useRef<number | null>(null);
  const pointerInteractionMovement = useRef(0);

  useEffect(() => {
    let width = 0;
    const onResize = () => {
      if (canvasRef.current) width = canvasRef.current.offsetWidth;
    };
    window.addEventListener("resize", onResize);
    onResize();

    if (!canvasRef.current) return;
    const globe = createGlobe(canvasRef.current, ({
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: 0.2,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.1, 0.1, 0.15],
      markerColor: [255/255, 134/255, 9/255],
      glowColor: [1, 0.5, 0.1],
      markers: [
        { location: [25.7617, -80.1918], size: 0.08 }, // Miami
        { location: [26.1224, -80.1373], size: 0.06 }, // Fort Lauderdale
        { location: [28.5383, -81.3792], size: 0.05 }, // Orlando
        { location: [29.7604, -95.3698], size: 0.06 }, // Houston
        { location: [34.0522, -118.2437], size: 0.05 }, // LA
        { location: [10.4806, -66.9036], size: 0.04 }, // Caracas
        { location: [4.7110, -74.0721], size: 0.04 }, // Bogota
        { location: [19.4326, -99.1332], size: 0.04 }, // CDMX
      ],
      onRender: (state: any) => {
        if (!pointerInteracting.current) phiRef.current += 0.003;
        state.phi = phiRef.current + pointerInteractionMovement.current;
        state.width = width * 2;
        state.height = width * 2;
      }
    }) as any);

    return () => { globe.destroy(); window.removeEventListener("resize", onResize); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => { pointerInteracting.current = e.clientX - pointerInteractionMovement.current; if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"; }}
      onPointerUp={() => { pointerInteracting.current = null; if (canvasRef.current) canvasRef.current.style.cursor = "grab"; }}
      onPointerOut={() => { pointerInteracting.current = null; if (canvasRef.current) canvasRef.current.style.cursor = "grab"; }}
      onMouseMove={(e) => { if (pointerInteracting.current !== null) { pointerInteractionMovement.current = (e.clientX - pointerInteracting.current) / 200; } }}
      className={className}
      style={{ cursor: "grab", aspectRatio: "1", width: "100%", height: "auto", maxWidth: "100%", contain: "layout paint size", opacity: 1 }}
    />
  );
}
