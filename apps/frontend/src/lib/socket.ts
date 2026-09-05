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
    // Next no proxea WebSockets → sin tiempo real. Definí NEXT_PUBLIC_SOCKET_URL en el .env
    // local del frontend (ej. http://localhost:4100) para conectar directo a la API.
    // Prod: la variable NO se define → conecta al MISMO ORIGEN (nginx proxea), igual que hoy.
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    socket = url ? io(url, opts) : io(opts);
    socket.on("connect", () => console.log("[socket] connected", socket?.id));
    socket.on("disconnect", () => console.log("[socket] disconnected"));
    socket.on("connect_error", (e) => console.warn("[socket] connect_error", e.message));
  }
  return socket;
}
