"use client";
import { useEffect, useState } from "react";
import { LiveKitRoom, VideoConference, RoomAudioRenderer, useConnectionState } from "@livekit/components-react";
import "@livekit/components-styles";
import { Loader2, UserPlus } from "@/lib/bootstrap-icons";
import { InviteToCallModal } from "./InviteToCallModal";

// Sala de llamada basada en LiveKit (SFU). Reemplaza al P2P casero: pide un token al backend
// para la sala (= id de la videollamada) y conecta al servidor LiveKit. La senalizacion va por
// wss://.../livekit (puerto 443, ya ruteado por nginx); el media por UDP 50000-50100 o TCP 8080,
// con fallback TURN (coturn) configurado server-side en livekit.yaml para NAT restrictivos.

// Badge de estado de conexion (observabilidad). Vive DENTRO de <LiveKitRoom> porque
// useConnectionState() necesita el contexto de la sala. v2.9 no expone onConnectionStateChanged.
function ConnIndicator() {
  const state = useConnectionState();
  useEffect(() => { console.log("[LiveKit] state:", state); }, [state]);
  const dot = state === "connected" ? "bg-emerald-400"
    : (state === "connecting" || state === "reconnecting" || state === "signalReconnecting") ? "bg-amber-400 animate-pulse"
    : "bg-red-500";
  return (
    <div className="absolute top-3 right-3 z-50 px-3 h-7 rounded-full bg-black/55 text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 backdrop-blur-md">
      <span className={"h-2 w-2 rounded-full " + dot} />
      {String(state)}
    </div>
  );
}

export function LiveKitCall({ room, onLeave }: { room: string; onLeave: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [lkError, setLkError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
      } catch (e: any) {
        if (!cancelled) setErr(e.message || "Error");
      }
    })();
    return () => { cancelled = true; };
  }, [room]);

  if (err) {
    return (
      <div className="fixed inset-0 bg-neutral-950 text-white flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-brand-red font-display font-black text-lg mb-1">No se pudo conectar la llamada</div>
          <div className="text-neutral-400 text-sm mb-5">{err}</div>
          <button onClick={onLeave} className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-sm font-bold uppercase tracking-wider">Volver al chat</button>
        </div>
      </div>
    );
  }
  if (!token || !serverUrl) {
    return (
      <div className="fixed inset-0 bg-neutral-950 text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0" data-lk-theme="default" style={{ height: "100dvh", background: "#0A0A12" }}>
      {/* Panel de error visible (en vez de spinner/negro infinito) */}
      {lkError && (
        <div className="absolute inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="text-brand-red font-display font-black text-lg mb-1">Error de conexion</div>
            <div className="text-neutral-300 text-sm mb-5">{lkError}</div>
            <button onClick={onLeave} className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-sm font-bold uppercase tracking-wider">Volver al chat</button>
          </div>
        </div>
      )}
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect={true}
        video={true}
        audio={true}
        options={{
          // --- Reducir delay/congestion ---
          // dynacast: el publicador solo envia las capas de video que alguien consume
          //   (en 1-a-1 baja el uplink de ~2.3Mbps a ~la capa usada).
          // adaptiveStream: ajusta calidad al estado de la red.
          // cap a 540p + 800kbps: el video dominaba la congestion en redes inestables
          //   (RTT ~100ms + jitter alto) -> menos congestion = jitter buffer mas chico = menos delay.
          // red:false + dtx: audio Opus plano y sin transmitir silencios (menos latencia/ancho de banda).
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: { resolution: { width: 960, height: 540, frameRate: 30 } },
          publishDefaults: {
            red: false,
            dtx: true,
            videoEncoding: { maxBitrate: 800_000, maxFramerate: 30 },
          },
        }}
        connectOptions={{
          // TURN client-side: el server-side rtc.turn_servers de livekit.yaml NO se estaba
          // advirtiendo al navegador (sin relay ni srflx -> ICE fallaba para NAT restrictivos).
          // Inyectamos aca el MISMO coturn que ya hace andar el P2P legacy cross-network.
          // El navegador junta host + srflx + relay independientemente de lo que mande el SFU.
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
            iceTransportPolicy: "all",
          },
        }}
        onDisconnected={onLeave}
        onError={(e) => { console.error("[LiveKit] error:", e); setLkError(e?.message || String(e)); }}
        style={{ height: "100%" }}
      >
        <ConnIndicator />
        <VideoConference />
        <RoomAudioRenderer />
      </LiveKitRoom>
      {/* Agregar / invitar usuarios a la llamada en curso */}
      <button onClick={() => setInviteOpen(true)}
        className="absolute top-3 left-3 z-50 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-[12px] font-ui font-bold uppercase tracking-wider shadow-lg hover:scale-105 transition">
        <UserPlus className="h-4 w-4" strokeWidth={2.5} /> Agregar
      </button>
      <InviteToCallModal videollamadaId={room} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
