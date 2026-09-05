"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import { getSocket } from "@/lib/socket";
import { CallUI } from "./CallUI";
import { CallReturnBanner } from "./CallReturnBanner";

// ============================================================
// CallProvider — conexion LiveKit GLOBAL y persistente.
//
// Por que global: la llamada ya NO vive dentro de /videollamada/[id]. Si viviera ahi,
// al navegar a otra seccion del CRM el componente se desmonta y la llamada se corta.
// Aqui montamos <LiveKitRoom> en el layout RAIZ (que nunca se desmonta al navegar en el
// App Router), de modo que la conexion sobrevive mientras el usuario pasea por el CRM
// (boton "Ver CRM" -> modo mini/PiP) y puede "Volver a la llamada" a pantalla completa.
// ============================================================

export type CallMode = "full" | "mini";

interface CallContextValue {
  active: boolean;
  room: string | null;
  title: string;
  mode: CallMode;
  /** Inicia o trae a primer plano (fullscreen) la llamada de una sala. */
  enter: (room: string, opts?: { title?: string }) => void;
  /** Minimiza (Ver CRM): la llamada sigue viva como widget/PiP. */
  minimize: () => void;
  /** Vuelve a pantalla completa. */
  maximize: () => void;
  /** Cuelga: cierra la sala y notifica al backend. */
  leave: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall debe usarse dentro de <CallProvider>");
  return ctx;
}

// Mismas opciones de red que el LiveKitCall original (dynacast/adaptive + TURN client-side).
const ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: { width: 960, height: 540, frameRate: 30 } },
  publishDefaults: {
    red: false,
    dtx: true,
    videoEncoding: { maxBitrate: 800_000, maxFramerate: 30 },
  },
} as const;

const CONNECT_OPTIONS = {
  rtcConfig: {
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
      {
        urls: [
          "turn:turn.example.com:3478?transport=udp",
          "turn:turn.example.com:3478?transport=tcp",
        ],
        username: "gozz",
        credential: "gozz-turn-secret-2026",
      },
    ],
    iceTransportPolicy: "all" as RTCIceTransportPolicy,
  },
};

export function CallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [room, setRoom] = useState<string | null>(null);
  const [title, setTitle] = useState("Videollamada");
  const [mode, setMode] = useState<CallMode>("full");
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const roomRef = useRef<string | null>(null);
  roomRef.current = room;

  // Pide el token de la sala activa. Al cambiar de sala, refetch (key fuerza remount del Room).
  useEffect(() => {
    if (!room) { setToken(null); setServerUrl(""); setErr(null); return; }
    let cancelled = false;
    setToken(null);
    (async () => {
      try {
        const r = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room }),
        });
        const d = await r.json();
        if (!r.ok || !d.token) throw new Error(d.error || ("No se pudo obtener el token (HTTP " + r.status + ")"));
        if (cancelled) return;
        setToken(d.token);
        setServerUrl(d.url);
        setErr(null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Error de conexion");
      }
    })();
    return () => { cancelled = true; };
  }, [room]);

  const enter = useCallback((r: string, opts?: { title?: string }) => {
    setTitle(opts?.title || "Videollamada");
    setMode("full");
    setRoom((prev) => (prev === r ? prev : r));
  }, []);

  const minimize = useCallback(() => setMode("mini"), []);
  const maximize = useCallback(() => setMode("full"), []);

  const endLocal = useCallback(() => {
    const r = roomRef.current;
    setRoom(null);
    setToken(null);
    setServerUrl("");
    setMode("full");
    return r;
  }, []);

  const leave = useCallback(() => {
    const r = endLocal();
    if (r) { fetch(`/api/videollamadas/${r}/fin`, { method: "POST" }).catch(() => {}); }
  }, [endLocal]);

  // --- Cross-sesion: "Volver a la llamada" en CUALQUIER pestana/navegador/dispositivo ---
  // La pestana en llamada emite un latido que el server reenvia a todas las sesiones del
  // mismo usuario (user:<id>). Las demas sesiones lo escuchan y muestran el banner.
  const [remoteActive, setRemoteActive] = useState<{ room: string; title: string } | null>(null);
  const remoteTsRef = useRef(0);

  // Emite el latido mientras esta pestana tiene la sala viva.
  useEffect(() => {
    if (!room || !token) return;
    const s = getSocket();
    const beat = () => { try { s.emit("videollamada:self-active", { videollamadaId: room, title }); } catch { /* ignore */ } };
    beat();
    const id = setInterval(beat, 6000);
    return () => { clearInterval(id); try { s.emit("videollamada:self-inactive", { videollamadaId: room }); } catch { /* ignore */ } };
  }, [room, token, title]);

  // Escucha el estado de otras sesiones del mismo usuario.
  useEffect(() => {
    const s = getSocket();
    const onActive = (d: any) => {
      if (!d?.videollamadaId) return;
      remoteTsRef.current = Date.now();
      setRemoteActive({ room: d.videollamadaId, title: d.title || "Videollamada" });
    };
    const onInactive = (d: any) => {
      setRemoteActive((cur) => (!cur || (d?.videollamadaId && cur.room !== d.videollamadaId) ? cur : null));
    };
    // Pregunta inmediata al montar y en cada (re)conexion -> el banner aparece al instante.
    const ask = () => { try { s.emit("videollamada:who-active"); } catch { /* ignore */ } };
    s.on("videollamada:self-active", onActive);
    s.on("videollamada:self-inactive", onInactive);
    s.on("connect", ask);
    ask();
    // Expira si dejan de llegar latidos (la pestana en llamada se cerro).
    const exp = setInterval(() => { if (remoteTsRef.current && Date.now() - remoteTsRef.current > 15000) setRemoteActive(null); }, 4000);
    return () => { s.off("videollamada:self-active", onActive); s.off("videollamada:self-inactive", onInactive); s.off("connect", ask); clearInterval(exp); };
  }, []);

  const value: CallContextValue = { active: !!room, room, title, mode, enter, minimize, maximize, leave };

  return (
    <CallContext.Provider value={value}>
      {children}

      {/* Banner "Volver a la llamada" cuando esta minimizada en ESTA pestana. */}
      {room && mode === "mini" && (
        <CallReturnBanner
          title={title}
          onReturn={() => { maximize(); router.push(`/videollamada/${room}`); }}
        />
      )}

      {/* Banner "Volver a la llamada" en OTRA pestana/navegador (esta sesion no tiene la llamada). */}
      {!room && remoteActive && (
        <CallReturnBanner
          title={remoteActive.title}
          onReturn={() => { router.push(`/videollamada/${remoteActive.room}`); }}
        />
      )}

      {/* Error de conexion (solo en fullscreen, para no tapar el CRM si esta minimizada). */}
      {room && err && mode === "full" && (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="text-brand-red font-display font-black text-lg mb-1">No se pudo conectar la llamada</div>
            <div className="text-neutral-300 text-sm mb-5">{err}</div>
            <button onClick={() => { endLocal(); router.push("/chat"); }} className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-sm font-bold uppercase tracking-wider">Volver al chat</button>
          </div>
        </div>
      )}

      {/* La sala vive aqui, en el layout raiz, asi sobrevive a la navegacion. */}
      {room && token && serverUrl && (
        <LiveKitRoom
          key={room}
          serverUrl={serverUrl}
          token={token}
          connect={true}
          video={true}
          audio={true}
          options={ROOM_OPTIONS as any}
          connectOptions={CONNECT_OPTIONS as any}
          onDisconnected={() => { endLocal(); }}
          onError={(e) => { console.error("[LiveKit] error:", e); setErr(e?.message || String(e)); }}
          data-lk-theme="default"
          style={{ position: "fixed", inset: 0, zIndex: mode === "full" ? 110 : 100, pointerEvents: mode === "full" ? "auto" : "none", background: mode === "full" ? "#0A0A12" : "transparent", height: "100dvh" }}
        >
          <RoomAudioRenderer />
          <CallUI
            roomId={room}
            title={title}
            mode={mode}
            onMinimize={() => { minimize(); router.push("/chat"); }}
            onMaximize={() => { maximize(); router.push(`/videollamada/${room}`); }}
            onLeave={() => { leave(); router.push("/chat"); }}
          />
        </LiveKitRoom>
      )}
    </CallContext.Provider>
  );
}
