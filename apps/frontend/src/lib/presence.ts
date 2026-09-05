"use client";
import { useEffect, useState } from "react";
import { getSocket } from "./socket";

interface PresenceState {
  onlineSet: Set<string>;
  lastSeen: Record<string, string>;
}

let state: PresenceState = { onlineSet: new Set(), lastSeen: {} };
let listeners: Array<() => void> = [];

function notify() { listeners.forEach((l) => l()); }

let heartbeatStarted = false;

export function startHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  const socket = getSocket();
  const beat = () => socket.emit("presence:heartbeat");
  beat();
  setInterval(beat, 30000);
  socket.on("presence:online", (data: { userId: string }) => {
    state.onlineSet.add(data.userId);
    notify();
  });
  socket.on("presence:offline", (data: { userId: string; timestamp: string }) => {
    state.onlineSet.delete(data.userId);
    state.lastSeen[data.userId] = data.timestamp;
    notify();
  });
}

export function usePresence() {
  const [, tick] = useState(0);
  useEffect(() => {
    startHeartbeat();
    const l = () => tick((t) => t + 1);
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  }, []);
  return {
    isOnline(userId: string): boolean { return state.onlineSet.has(userId); },
    lastSeen(userId: string): string | undefined { return state.lastSeen[userId]; },
    markOnline(userIds: string[]) {
      userIds.forEach((id) => state.onlineSet.add(id));
      notify();
    }
  };
}

export function formatLastSeen(iso: string | null | undefined, ultimoLogin: string | null | undefined): string {
  if (!iso && !ultimoLogin) return "Desconectado";
  const d = iso || ultimoLogin;
  if (!d) return "Desconectado";
  const past = new Date(d).getTime();
  const now = Date.now();
  const diffMs = now - past;
  if (diffMs < 60000) return "Hace un momento";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Hace ${days} d`;
  return new Date(d).toLocaleDateString("es", { day: "2-digit", month: "short" });
}
