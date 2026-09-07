"use client";
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const opts = {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: true,
      // Reconexión explícita — los defaults de socket.io ya hacen casi esto,
      // pero al declararlo garantizamos comportamiento estable en caso de
      // suspender el laptop / cambiar de red / corte de WiFi.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    };
    // Dev: el front (:3100) y la API (:4100) están en puertos distintos y el dev server de
    // Next no proxea WebSockets → sin tiempo real. Por defecto (sin NEXT_PUBLIC_SOCKET_URL)
    // conectamos al MISMO HOST que ya usa el navegador (location.hostname) pero al puerto de
    // la API — así funciona sea cual sea el host con el que se abrió la app (localhost,
    // 127.0.0.1, la IP de LAN para probar desde el teléfono...). Fijar un host literal aquí
    // (p.ej. "localhost") rompe el login si el navegador entró por OTRO host: la cookie de
    // sesión queda ligada al host con el que se cargó la página y nunca se envía a un host
    // distinto, así que el socket nunca autentica — y falla en silencio (sin conexión, sin
    // error visible, "conectando" para siempre). Se detecta "estamos en el puerto de dev/self
    // de Next sin proxy" por `location.port === "3100"`: en producción nginx sirve todo por
    // 80/443 (sin puerto explícito), así que ahí esta rama nunca se activa y sigue yendo al
    // mismo origen, igual que siempre.
    const explicit = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    const enDevSinProxy = typeof window !== "undefined" && window.location.port === "3100";
    const url = explicit || (enDevSinProxy ? `${window.location.protocol}//${window.location.hostname}:4100` : undefined);
    socket = url ? io(url, opts) : io(opts);
    socket.on("connect", () => console.log("[socket] connected", socket?.id));
    socket.on("disconnect", () => console.log("[socket] disconnected"));
    socket.on("connect_error", (e) => console.warn("[socket] connect_error", e.message));
  }
  return socket;
}
