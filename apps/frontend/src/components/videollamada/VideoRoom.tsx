"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff,
  PhoneOff, Hand, Smile, MessageSquare, Users as UsersIcon,
  Loader2, ChevronDown, Check, X, Send, Sparkles, Pin, PinOff, UserPlus, Search,
  Minimize2, Maximize2, Monitor, LayoutGrid, User as UserIcon
} from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { getSocket } from "@/lib/socket";
import { initialsOf } from "@/lib/auth-user";
import { PeerVideo } from "@/components/videocall/PeerVideo";
import { cn } from "@/lib/utils";
import { playHandRaise, playScreenShareStart, playScreenShareStop, playMessagePing } from "@/lib/ringtone";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  // TURN propio (coturn en el VPS) — IMPRESCINDIBLE para que la llamada funcione entre
  // redes distintas / detrás de NAT (no solo en la misma red). Sin esto las videollamadas fallan.
  {
    urls: [
      "turn:turn.example.com:3478?transport=udp",
      "turn:turn.example.com:3478?transport=tcp",
    ],
    username: "gozz",
    credential: "gozz-turn-secret-2026",
  },
];
const EMOJI_REACTIONS = ["👍", "❤️", "👏", "🎉", "😂", "🔥", "😮", "🙌"];

interface Props {
  videollamadaId: string;
  selfUserId: string;
  iniciadaPor: string;
  roomName: string;
  displayName: string;
  userPhoto?: string | null;
  onLeave: () => void;
}

type ConnState = "waiting" | "connecting" | "connected";

interface ChatMsg {
  id: string;
  userId: string;
  contenido: string;
  ts: number;
  self: boolean;
}

interface Reaction { id: string; emoji: string; from: string; }

interface PeerState { id: string; name: string; photo: string | null; micOn: boolean; camOn: boolean; handRaised: boolean; }

export function VideoRoom({ videollamadaId, selfUserId, iniciadaPor, roomName, displayName, userPhoto, onLeave }: Props) {
  const router = useRouter();
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const otherPeerIdRef = useRef<string | null>(null);
  const hangingUpRef = useRef(false);
  const chatOpenRef = useRef(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [handRaised, setHandRaised] = useState(false);
  const [connState, setConnState] = useState<ConnState>("waiting");
  const [elapsed, setElapsed] = useState(0);

  const [remotePeer, setRemotePeer] = useState<PeerState | null>(null);

  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [activeDevices, setActiveDevices] = useState<{ cam: string; mic: string }>({ cam: "", mic: "" });
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const chatMsgsRef = useRef<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatUnread, setChatUnread] = useState(0);

  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [handBurst, setHandBurst] = useState<{ id: string; from: string } | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [layout, setLayout] = useState<"speaker" | "grid">("speaker");
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryTranscript, setSummaryTranscript] = useState<string>("");
  const [summaryTab, setSummaryTab] = useState<"resumen" | "transcript">("resumen");

  const amICaller = selfUserId === iniciadaPor;

  // Mantener un ref actualizado con los mensajes del chat (para capturarlos en hangup)
  useEffect(() => { chatMsgsRef.current = chatMsgs; }, [chatMsgs]);

  // ============ Paso 1: getUserMedia ============
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        setLocalStream(stream);
        enumerateDevices();
      } catch (e: any) {
        toast.error("No se pudo acceder a cámara/micrófono: " + (e?.message || e));
        onLeave();
      }
    })();
    return () => {
      cancelled = true;
      const s = localStreamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enumerateDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cams: all.filter((d) => d.kind === "videoinput"),
        mics: all.filter((d) => d.kind === "audioinput")
      });
    } catch {}
  }, []);

  // ============ Paso 2: peer connection + signaling ============
  const hangup = useCallback(() => {
    if (hangingUpRef.current) return;
    hangingUpRef.current = true;
    const socket = getSocket();
    const otherId = otherPeerIdRef.current;
    if (otherId) socket.emit("call:hangup", { to: otherId, videollamadaId });
    socket.emit("videollamada:leave", videollamadaId);
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    // Fire-and-forget: persistimos transcript + fin sin bloquear la salida.
    // El resumen IA se genera sólo si el host lo disparó durante la llamada.
    const transcript = chatMsgsRef.current
      .map((m) => `[${new Date(m.ts).toISOString().slice(11, 19)}] ${m.self ? displayName : (remotePeer?.name || "Participante")}: ${m.contenido}`)
      .join("\n");
    fetch(`/api/videollamadas/${videollamadaId}/fin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
      keepalive: true,
    }).catch(() => {});
    onLeave();
  }, [onLeave, videollamadaId, displayName, remotePeer?.name]);

  const sendCallEvent = useCallback((payload: any) => {
    const to = otherPeerIdRef.current;
    if (!to) return;
    getSocket().emit("call:event", { to, videollamadaId, ...payload });
  }, [videollamadaId]);

  useEffect(() => {
    if (!localStream) return;
    const socket = getSocket();

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    // Buffer de candidatos ICE: addIceCandidate falla si aun no hay remoteDescription.
    // Los que lleguen antes se encolan y se vuelcan al fijar la descripcion remota.
    // Sin esto, los candidatos (incluido el relay TURN) se pierden y la conexion falla (~10s).
    let remoteDescReady = false;
    const pendingIce: RTCIceCandidateInit[] = [];
    const flushPendingIce = async () => {
      remoteDescReady = true;
      while (pendingIce.length) {
        const c = pendingIce.shift()!;
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
    };

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    const remote = new MediaStream();
    setRemoteStream(remote);
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
      setRemoteStream(new MediaStream(remote.getTracks()));
      setConnState("connected");
    };

    pc.onicecandidate = (ev) => {
      const to = otherPeerIdRef.current;
      if (ev.candidate && to) {
        socket.emit("call:ice", { to, videollamadaId, candidate: ev.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") setConnState("connected");
      else if (st === "failed") { toast.error("Conexión perdida"); hangup(); }
    };

    const sendOfferTo = async (to: string) => {
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socket.emit("call:offer", { to, videollamadaId, sdp: offer });
        setConnState("connecting");
      } catch (e: any) { toast.error("Error creando oferta: " + (e?.message || e)); }
    };

    const fetchPeerInfo = async (userId: string): Promise<PeerState> => {
      try {
        const r = await fetch(`/api/users/${userId}`);
        if (r.ok) {
          const d = await r.json();
          return { id: userId, name: d.user?.nombre || "Participante", photo: d.user?.foto_perfil_url || null, micOn: true, camOn: true, handRaised: false };
        }
      } catch {}
      return { id: userId, name: "Participante", photo: null, micOn: true, camOn: true, handRaised: false };
    };

    const onPeerJoined = async (data: { userId: string; peers: string[] }) => {
      const other = data.peers.find((p) => p !== selfUserId);
      if (!other) return;
      otherPeerIdRef.current = other;
      setConnState("connecting");
      fetchPeerInfo(other).then(setRemotePeer);
      if (!amICaller) await sendOfferTo(other);
    };

    const onPeerLeft = () => {
      if (hangingUpRef.current) return;
      toast("El otro participante salió");
      hangup();
    };

    const onFull = () => { toast.error("Sala llena"); onLeave(); };

    const onReady = async (data: { from: string }) => {
      if (!otherPeerIdRef.current) {
        otherPeerIdRef.current = data.from;
        fetchPeerInfo(data.from).then(setRemotePeer);
        if (!amICaller) await sendOfferTo(data.from);
      }
    };

    const onOffer = async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      try {
        otherPeerIdRef.current = data.from;
        fetchPeerInfo(data.from).then(setRemotePeer);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("call:answer", { to: data.from, videollamadaId, sdp: answer });
        setConnState("connecting");
      } catch (e: any) { toast.error("Error respondiendo oferta: " + (e?.message || e)); }
    };

    const onAnswer = async (data: { sdp: RTCSessionDescriptionInit }) => {
      try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); await flushPendingIce(); }
      catch (e: any) { toast.error("Error aplicando respuesta: " + (e?.message || e)); }
    };

    const onIce = async (data: { candidate: RTCIceCandidateInit }) => {
      if (!remoteDescReady) { pendingIce.push(data.candidate); return; }
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
    };

    const onHangup = () => { toast("Llamada finalizada"); hangup(); };

    const onCallEvent = (data: { from: string; type: string; [k: string]: any }) => {
      if (data.type === "reaction") {
        setReactions((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, emoji: data.emoji, from: data.from }]);
      } else if (data.type === "hand") {
        setRemotePeer((p) => p ? { ...p, handRaised: !!data.raised } : p);
        if (data.raised) {
          try { playHandRaise(); } catch {}
          setHandBurst({ id: `h-${Date.now()}`, from: remotePeer?.name || "Participante" });
          setTimeout(() => setHandBurst(null), 2200);
          toast(`✋ ${remotePeer?.name || "Participante"} levantó la mano`);
        }
      } else if (data.type === "mic-state") {
        setRemotePeer((p) => p ? { ...p, micOn: !!data.on } : p);
      } else if (data.type === "cam-state") {
        setRemotePeer((p) => p ? { ...p, camOn: !!data.on } : p);
      }
    };

    const onChatMsg = (msg: any) => {
      if (!msg || msg.videollamada_id !== videollamadaId) return;
      const isSelf = msg.user_id === selfUserId;
      setChatMsgs((prev) => [...prev, {
        id: msg.id || `${Date.now()}-${Math.random()}`,
        userId: msg.user_id,
        contenido: msg.contenido,
        ts: Date.now(),
        self: isSelf
      }]);
      if (!isSelf) {
        try { playMessagePing(); } catch {}
        if (!chatOpenRef.current) setChatUnread((u) => u + 1);
      }
    };

    socket.on("videollamada:peer-joined", onPeerJoined);
    socket.on("videollamada:peer-left", onPeerLeft);
    socket.on("videollamada:full", onFull);
    socket.on("videollamada:chat", onChatMsg);
    socket.on("call:ready", onReady);
    socket.on("call:offer", onOffer);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice", onIce);
    socket.on("call:hangup", onHangup);
    socket.on("call:event", onCallEvent);

    socket.emit("videollamada:join", videollamadaId);
    setTimeout(() => {
      const to = otherPeerIdRef.current;
      if (to) socket.emit("call:ready", { to, videollamadaId });
    }, 400);

    const timeoutT = setTimeout(() => {
      if (!otherPeerIdRef.current) {
        toast.error("El otro participante no se unió");
        hangup();
      }
    }, 25000);

    return () => {
      clearTimeout(timeoutT);
      socket.off("videollamada:peer-joined", onPeerJoined);
      socket.off("videollamada:peer-left", onPeerLeft);
      socket.off("videollamada:full", onFull);
      socket.off("videollamada:chat", onChatMsg);
      socket.off("call:ready", onReady);
      socket.off("call:offer", onOffer);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice", onIce);
      socket.off("call:hangup", onHangup);
      socket.off("call:event", onCallEvent);
      try { pc.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  // ============ Paso 3: timer ============
  useEffect(() => {
    if (connState !== "connected") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [connState]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);

  // Auto-eliminar reactions tras 3.2s
  useEffect(() => {
    if (reactions.length === 0) return;
    const t = setTimeout(() => setReactions((prev) => prev.slice(1)), 3200);
    return () => clearTimeout(t);
  }, [reactions]);

  // ============ Controls ============
  const toggleMic = () => {
    const s = localStreamRef.current;
    if (!s) return;
    const nv = !micOn;
    s.getAudioTracks().forEach((t) => (t.enabled = nv));
    setMicOn(nv);
    sendCallEvent({ type: "mic-state", on: nv });
  };

  const toggleCam = () => {
    const s = localStreamRef.current;
    if (!s) return;
    const nv = !camOn;
    s.getVideoTracks().forEach((t) => (t.enabled = nv));
    setCamOn(nv);
    sendCallEvent({ type: "cam-state", on: nv });
  };

  const toggleScreen = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    if (screenOn) {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setScreenStream(null);
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
        // Restaurar parametros normales de camara (quitar el cap que pusimos para la pantalla).
        try {
          const params = sender.getParameters();
          if (params.encodings && params.encodings[0]) {
            delete params.encodings[0].maxBitrate;
            delete params.encodings[0].maxFramerate;
          }
          (params as any).degradationPreference = "balanced";
          await sender.setParameters(params);
        } catch {}
      }
      setScreenOn(false);
      try { playScreenShareStop(); } catch {}
    } else {
      try {
        // Compartir pantalla: limitar fps y resolucion + priorizar NITIDEZ sobre fluidez.
        // Sin esto, getDisplayMedia captura a resolucion/fps nativos (hasta 4K@60) y satura el
        // uplink → la pantalla compartida se ve laggy/lenta. 15fps@1080p es nitido y fluido para
        // slides/documentos/codigo (lo normal al compartir pantalla).
        const ds: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
          audio: true,
        });
        const newTrack: MediaStreamTrack = ds.getVideoTracks()[0];
        try { (newTrack as any).contentHint = "detail"; } catch {}
        screenTrackRef.current = newTrack;
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          await sender.replaceTrack(newTrack);
          // maintain-resolution: bajo congestion, baja fps antes que nitidez (mejor para texto);
          // cap de bitrate/fps para no saturar el uplink (era la causa del lag).
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            params.encodings[0].maxBitrate = 2_500_000;
            params.encodings[0].maxFramerate = 15;
            (params as any).degradationPreference = "maintain-resolution";
            await sender.setParameters(params);
          } catch {}
        }
        newTrack.onended = () => toggleScreen();
        setScreenStream(ds);
        setScreenOn(true);
        try { playScreenShareStart(); } catch {}
        toast.success("Compartiendo pantalla");
      } catch {
        toast.error("No se pudo compartir pantalla");
      }
    }
  };

  const changeMic = async (deviceId: string) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const newTrack = newStream.getAudioTracks()[0];
      const pc = pcRef.current;
      const sender = pc?.getSenders().find((s) => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(newTrack);
      // reemplazar en stream local
      const s = localStreamRef.current;
      if (s) {
        s.getAudioTracks().forEach((t) => { s.removeTrack(t); t.stop(); });
        s.addTrack(newTrack);
        newTrack.enabled = micOn;
      }
      setActiveDevices((d) => ({ ...d, mic: deviceId }));
      toast.success("Micrófono cambiado");
    } catch (e: any) { toast.error("Error cambiando micrófono"); }
    setMicMenuOpen(false);
  };

  const changeCam = async (deviceId: string) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const newTrack = newStream.getVideoTracks()[0];
      const pc = pcRef.current;
      const sender = pc?.getSenders().find((s) => s.track?.kind === "video");
      if (sender && !screenOn) await sender.replaceTrack(newTrack);
      const s = localStreamRef.current;
      if (s) {
        s.getVideoTracks().forEach((t) => { s.removeTrack(t); t.stop(); });
        s.addTrack(newTrack);
        newTrack.enabled = camOn;
        setLocalStream(new MediaStream(s.getTracks()));
      }
      setActiveDevices((d) => ({ ...d, cam: deviceId }));
      toast.success("Cámara cambiada");
    } catch { toast.error("Error cambiando cámara"); }
    setCamMenuOpen(false);
  };

  const toggleHand = () => {
    const nv = !handRaised;
    setHandRaised(nv);
    sendCallEvent({ type: "hand", raised: nv });
    if (nv) {
      try { playHandRaise(); } catch {}
      setHandBurst({ id: `h-${Date.now()}`, from: "Tú" });
      setTimeout(() => setHandBurst(null), 2200);
      toast("✋ Levantaste la mano");
    }
  };

  const sendReaction = (emoji: string) => {
    setReactions((prev) => [...prev, { id: `local-${Date.now()}`, emoji, from: selfUserId }]);
    sendCallEvent({ type: "reaction", emoji });
    setEmojiOpen(false);
  };

  const sendChatMessage = () => {
    const txt = chatInput.trim();
    if (!txt) return;
    getSocket().emit("videollamada:chat", { videollamadaId, contenido: txt });
    setChatInput("");
  };

  const generateSummary = async () => {
    setSummaryOpen(true);
    setSummaryTab("resumen");
    setSummarizing(true);
    const transcript = chatMsgs.map((m) => `[${new Date(m.ts).toISOString().slice(11, 19)}] ${m.self ? displayName : remotePeer?.name || "Participante"}: ${m.contenido}`).join("\n");
    setSummaryTranscript(transcript);
    try {
      const participantes = `${displayName}, ${remotePeer?.name || "Participante"}`;
      const r = await fetch("/api/videollamadas/resumen-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videollamadaId, roomName, participantes, duracion_segundos: elapsed, transcript })
      });
      const d = await r.json();
      setSummaryText(d.resumen || "Sin resumen disponible");
      if (typeof d.transcript === "string" && d.transcript.length > 0) setSummaryTranscript(d.transcript);
    } catch (e: any) {
      setSummaryText("Error generando resumen: " + (e?.message || e));
    } finally {
      setSummarizing(false);
    }
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const stateBadge =
    connState === "connected" ? { label: "En vivo", dot: "bg-brand-red" } :
    connState === "connecting" ? { label: "Conectando…", dot: "bg-amber-400" } :
    { label: "Esperando…", dot: "bg-neutral-400" };

  return (
    <div className="fixed inset-0 bg-neutral-950 text-white flex flex-col z-50">
      {/* Reacciones flotantes */}
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 0, scale: 0.5, x: "50vw" }}
              animate={{ opacity: [0, 1, 1, 0], y: -window.innerHeight * 0.7, scale: [0.5, 1.5, 1.2, 1], x: `${30 + Math.random() * 40}vw` }}
              transition={{ duration: 3, ease: "easeOut" }}
              className="absolute bottom-24 text-6xl select-none"
            >
              {r.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-white/10 bg-neutral-950/80 backdrop-blur shrink-0">
        <div className="h-8 px-3 rounded-lg bg-brand-red/15 text-brand-red text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5">
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }} className={cn("h-1.5 w-1.5 rounded-full", stateBadge.dot)} />
          {stateBadge.label}
        </div>
        <div className="text-sm font-bold font-display truncate">{roomName}</div>
        {connState === "connected" && (
          <div className="text-[11px] text-neutral-400 tabular-nums">{fmt(elapsed)}</div>
        )}
        <div className="flex-1" />
        <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
          <UsersIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
          {remotePeer ? 2 : 1}
        </div>
        {remotePeer?.handRaised && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.1, 1] }} className="h-7 px-2 rounded-lg bg-brand-gold/20 text-brand-gold text-[10px] font-ui font-bold uppercase tracking-wider flex items-center gap-1">
            <Hand className="h-3 w-3" strokeWidth={2} /> 1
          </motion.div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative min-h-0 p-3">
          {connState !== "connected" ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
              <div className="h-24 w-24 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold flex items-center justify-center text-3xl font-black font-display shadow-2xl">
                {initialsOf(remotePeer?.name || roomName)}
              </div>
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {connState === "connecting" ? "Conectando al otro participante…" : "Esperando a que se una…"}
              </div>
            </div>
          ) : (() => {
            const selfId = selfUserId;
            const remoteId = remotePeer?.id || "__remote__";
            const pinned = pinnedId || null;
            const isGrid = layout === "grid" && !pinned;

            const SelfTile = (
              <PeerTile
                key="self"
                stream={localStream}
                name={`${displayName} (tú)`}
                photo={userPhoto || null}
                camOn={camOn}
                micOn={micOn}
                handRaised={handRaised}
                mirrored
                muted
                isPinned={pinned === selfId}
                onTogglePin={() => setPinnedId(pinned === selfId ? null : selfId)}
              />
            );
            const RemoteTile = remotePeer ? (
              <PeerTile
                key="remote"
                stream={remoteStream}
                name={remotePeer.name}
                photo={remotePeer.photo}
                camOn={remotePeer.camOn}
                micOn={remotePeer.micOn}
                handRaised={remotePeer.handRaised}
                isPinned={pinned === remoteId}
                onTogglePin={() => setPinnedId(pinned === remoteId ? null : remoteId)}
              />
            ) : null;

            if (pinned) {
              const main = pinned === selfId ? SelfTile : RemoteTile;
              const side = pinned === selfId ? RemoteTile : SelfTile;
              return (
                <div className="w-full h-full relative">
                  <div className="w-full h-full rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 relative">
                    {main}
                  </div>
                  {side && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="absolute top-6 right-6 w-44 sm:w-56 aspect-video rounded-xl overflow-hidden ring-2 ring-white/20 shadow-2xl"
                    >
                      {side}
                    </motion.div>
                  )}
                </div>
              );
            }

            if (isGrid) {
              return (
                <motion.div
                  layout
                  className="w-full h-full grid gap-3 grid-cols-1 md:grid-cols-2 auto-rows-fr"
                >
                  {RemoteTile ? (
                    <>
                      <div className="rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 relative min-h-0">{RemoteTile}</div>
                      <div className="rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 relative min-h-0">{SelfTile}</div>
                    </>
                  ) : (
                    <div className="rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 relative min-h-0 md:col-span-2">{SelfTile}</div>
                  )}
                </motion.div>
              );
            }

            // speaker (default) · remote grande, self pip
            return (
              <div className="w-full h-full relative">
                <div className="w-full h-full rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 relative">
                  {RemoteTile || SelfTile}
                </div>
                {RemoteTile && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="absolute top-6 right-6 w-44 sm:w-56 aspect-video rounded-xl overflow-hidden ring-2 ring-white/20 shadow-2xl"
                  >
                    {SelfTile}
                  </motion.div>
                )}
              </div>
            );
          })()}

          {/* Layout switcher */}
          {connState === "connected" && (
            <div className="absolute top-6 left-6 flex items-center gap-1 rounded-xl bg-black/55 backdrop-blur-xl border border-white/10 p-1 shadow-lg">
              <button
                onClick={() => { setLayout("speaker"); setPinnedId(null); }}
                className={cn(
                  "h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-inter font-bold uppercase tracking-wider transition",
                  layout === "speaker" && !pinnedId ? "bg-brand-orange text-white" : "text-white/70 hover:bg-white/10"
                )}
                title="Vista en foco"
              >
                <UserIcon className="h-3 w-3" strokeWidth={2.5} />
                Foco
              </button>
              <button
                onClick={() => { setLayout("grid"); setPinnedId(null); }}
                className={cn(
                  "h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-inter font-bold uppercase tracking-wider transition",
                  layout === "grid" && !pinnedId ? "bg-brand-orange text-white" : "text-white/70 hover:bg-white/10"
                )}
                title="Vista en cuadrícula"
              >
                <LayoutGrid className="h-3 w-3" strokeWidth={2.5} />
                Cuadrícula
              </button>
              {pinnedId && (
                <>
                  <div className="w-px h-5 bg-white/15 mx-0.5" />
                  <button
                    onClick={() => setPinnedId(null)}
                    className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-inter font-bold uppercase tracking-wider bg-brand-orange text-white"
                    title="Quitar fijado"
                  >
                    <PinOff className="h-3 w-3" strokeWidth={2.5} />
                    Fijado
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Chat sidebar · 2026 */}
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              initial={{ x: 360, opacity: 0, filter: "blur(8px)" }}
              animate={{ x: 0, opacity: 1, filter: "blur(0)" }}
              exit={{ x: 360, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="relative w-[340px] shrink-0 border-l border-white/10 bg-[#0B0B14] flex flex-col"
            >
              <div className="absolute inset-0 opacity-35 pointer-events-none"
                style={{ backgroundImage: "radial-gradient(ellipse at 80% 0%, rgba(87,80,232,0.18), transparent 55%), radial-gradient(ellipse at 20% 100%, rgba(33,150,201,0.15), transparent 55%)" }} />

              <div className="relative h-14 px-4 flex items-center gap-2 border-b border-white/10 shrink-0">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white shadow-md shadow-brand-orange/25">
                  <MessageSquare className="h-4 w-4" strokeWidth={2.2} />
                </div>
                <div className="flex-1">
                  <div className="text-[9px] font-inter font-bold uppercase tracking-[0.2em] text-brand-orange leading-none">Chat en vivo</div>
                  <div className="font-inter font-extrabold text-[13px] text-white leading-tight">Mensajes de la llamada</div>
                </div>
                <button onClick={() => setChatOpen(false)} className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div data-lenis-prevent className="relative flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-3 space-y-1.5">
                {chatMsgs.length === 0 ? (
                  <div className="text-center py-10 text-[12px] text-white/45 font-inter flex flex-col items-center gap-2">
                    <div className="h-10 w-10 rounded-2xl bg-white/5 flex items-center justify-center">
                      <MessageSquare className="h-5 w-5 text-white/50" strokeWidth={1.8} />
                    </div>
                    Sin mensajes aún
                  </div>
                ) : chatMsgs.map((m, i) => {
                  const prev = chatMsgs[i - 1];
                  const showHeader = !prev || prev.userId !== m.userId;
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 320, damping: 24 }}
                      className={cn("flex flex-col", m.self ? "items-end" : "items-start")}
                    >
                      {showHeader && !m.self && (
                        <div className="text-[9.5px] font-inter font-bold uppercase tracking-wider text-white/50 mb-0.5 px-2">
                          {remotePeer?.name || "Participante"}
                        </div>
                      )}
                      <div className={cn(
                        "relative max-w-[82%] px-3 py-2 rounded-2xl text-[13px] font-inter leading-snug break-words shadow-md selection-doc",
                        m.self
                          ? "bg-gradient-to-br from-brand-orange to-neon-magenta text-white rounded-br-[6px] shadow-brand-orange/30"
                          : "bg-white/[0.08] border border-white/10 text-white/95 backdrop-blur-md rounded-bl-[6px]"
                      )}>
                        {m.contenido}
                        <div className={cn("text-[9px] font-mono tabular-nums mt-1 text-right", m.self ? "text-white/75" : "text-white/45")}>
                          {new Date(m.ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="relative p-3 border-t border-white/10 shrink-0 flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 h-11 px-3 rounded-2xl bg-white/[0.06] border border-white/10 focus-within:border-brand-orange/50 focus-within:ring-4 focus-within:ring-brand-orange/15 transition">
                  <MessageSquare className="h-4 w-4 text-white/30" strokeWidth={2} />
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                    placeholder="Escribe un mensaje…"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none font-inter"
                  />
                </div>
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={sendChatMessage}
                  disabled={!chatInput.trim()}
                  className={cn(
                    "h-11 w-11 rounded-2xl flex items-center justify-center shadow-md transition",
                    chatInput.trim()
                      ? "bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow-brand-orange/30 hover:scale-[1.03]"
                      : "bg-white/5 text-white/35 cursor-not-allowed"
                  )}
                >
                  <Send className="h-4 w-4" strokeWidth={2.4} />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Control bar */}
      <div className="h-[76px] px-4 flex items-center justify-center gap-2 border-t border-white/10 bg-neutral-950/80 backdrop-blur shrink-0">
        {/* Mic con dropdown */}
        <ControlWithDropdown
          active={micOn}
          Icon={micOn ? Mic : MicOff}
          onClick={toggleMic}
          onMenuToggle={() => setMicMenuOpen((v) => !v)}
          menuOpen={micMenuOpen}
          onMenuClose={() => setMicMenuOpen(false)}
          label="Micrófono"
          items={devices.mics.map((d) => ({ id: d.deviceId, label: d.label || "Micrófono", active: activeDevices.mic === d.deviceId, onClick: () => changeMic(d.deviceId) }))}
          color="#43A847"
        />
        {/* Cam con dropdown */}
        <ControlWithDropdown
          active={camOn}
          Icon={camOn ? VideoIcon : VideoOff}
          onClick={toggleCam}
          onMenuToggle={() => setCamMenuOpen((v) => !v)}
          menuOpen={camMenuOpen}
          onMenuClose={() => setCamMenuOpen(false)}
          label="Cámara"
          items={devices.cams.map((d) => ({ id: d.deviceId, label: d.label || "Cámara", active: activeDevices.cam === d.deviceId, onClick: () => changeCam(d.deviceId) }))}
          color="#43A847"
        />
        {/* Screen share */}
        <ControlBtn active={screenOn} Icon={screenOn ? ScreenShareOff : ScreenShare} color="#5750E8" onClick={toggleScreen} title={screenOn ? "Detener compartir" : "Compartir pantalla"} />

        <div className="w-px h-8 bg-white/10 mx-1" />

        {/* Hand */}
        <ControlBtn active={handRaised} Icon={Hand} color="#FFB51C" onClick={toggleHand} title={handRaised ? "Bajar mano" : "Levantar mano"} />

        {/* Emoji reactions */}
        <div className="relative">
          <ControlBtn active={emojiOpen} Icon={Smile} color="#5750E8" onClick={() => setEmojiOpen((v) => !v)} title="Reaccionar" />
          <AnimatePresence>
            {emojiOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setEmojiOpen(false)} />
                <motion.div initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 border border-white/10 rounded-2xl p-2 flex items-center gap-1 shadow-2xl">
                  {EMOJI_REACTIONS.map((e) => (
                    <motion.button key={e} whileHover={{ scale: 1.25 }} whileTap={{ scale: 0.9 }} onClick={() => sendReaction(e)}
                      className="h-10 w-10 rounded-xl hover:bg-white/10 text-2xl flex items-center justify-center">
                      {e}
                    </motion.button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Chat */}
        <div className="relative">
          <ControlBtn active={chatOpen} Icon={MessageSquare} color="#2196C9" onClick={() => setChatOpen((v) => !v)} title="Chat" />
          {chatUnread > 0 && !chatOpen && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-brand-red text-white text-[10px] font-ui font-bold flex items-center justify-center">{chatUnread}</motion.span>
          )}
        </div>

        {/* Participants */}
        <ControlBtn active={participantsOpen} Icon={UsersIcon} color="#8338EC" onClick={() => setParticipantsOpen((v) => !v)} title="Participantes" />

        <div className="w-px h-8 bg-white/10 mx-1" />

        {/* Resumen IA */}
        <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={generateSummary}
          className="h-11 px-4 rounded-2xl bg-gradient-to-r from-purple-500 to-brand-orange text-white font-ui text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-purple-500/25">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Resumen IA
        </motion.button>

        <div className="w-px h-8 bg-white/10 mx-1" />

        {/* Colgar */}
        <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={hangup}
          className="h-11 px-5 rounded-2xl bg-brand-red text-white font-ui text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-red-500/40 hover:bg-red-600">
          <PhoneOff className="h-4 w-4" strokeWidth={2} />
          Colgar
        </motion.button>
      </div>

      {/* Panel participantes */}
      <AnimatePresence>
        {participantsOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setParticipantsOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-end justify-center p-6">
            <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()}
              className="bg-neutral-900 rounded-3xl w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col border border-white/10">
              <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
                <UsersIcon className="h-4 w-4 text-brand-orange" />
                <div className="flex-1 font-display font-bold">Participantes ({remotePeer ? 2 : 1})</div>
                <button
                  onClick={() => setInviteOpen(true)}
                  className="h-9 px-3 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-[10.5px] font-inter font-bold uppercase tracking-wider flex items-center gap-1.5 hover:scale-[1.03] active:scale-95 transition shadow"
                  title="Invitar"
                >
                  <UserPlus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Invitar
                </button>
                <button onClick={() => setParticipantsOpen(false)} className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center"><X className="h-4 w-4" /></button>
              </div>
              <div className="overflow-y-auto">
                <ParticipantRow name={`${displayName} (tú)`} photo={userPhoto || null} micOn={micOn} camOn={camOn} handRaised={handRaised} />
                {remotePeer && <ParticipantRow name={remotePeer.name} photo={remotePeer.photo} micOn={remotePeer.micOn} camOn={remotePeer.camOn} handRaised={remotePeer.handRaised} />}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Resumen IA */}
      <AnimatePresence>
        {summaryOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSummaryOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.96, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col text-neutral-900">
              <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-2">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-brand-orange flex items-center justify-center text-white">
                  <Sparkles className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <div className="font-display font-black text-lg">Resumen IA</div>
                  <div className="text-[11px] text-neutral-500">{roomName} · {fmt(elapsed)}</div>
                </div>
                <button onClick={() => setSummaryOpen(false)} className="h-9 w-9 rounded-xl hover:bg-neutral-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
              </div>
              <div className="px-5 pt-3 flex items-center gap-2 border-b border-neutral-100">
                <button
                  onClick={() => setSummaryTab("resumen")}
                  className={cn(
                    "h-9 px-4 rounded-t-xl text-[11.5px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition",
                    summaryTab === "resumen"
                      ? "bg-gradient-to-r from-purple-500 to-brand-orange text-white shadow"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  Resumen Claude
                </button>
                <button
                  onClick={() => setSummaryTab("transcript")}
                  className={cn(
                    "h-9 px-4 rounded-t-xl text-[11.5px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition",
                    summaryTab === "transcript"
                      ? "bg-neutral-900 text-white shadow"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                  Transcripción
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {summarizing && summaryTab === "resumen" ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
                    <div className="text-sm text-neutral-500">Procesando resumen con IA…</div>
                  </div>
                ) : summaryTab === "resumen" ? (
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[13px] leading-relaxed">{summaryText}</div>
                ) : (
                  <div className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-neutral-700">
                    {summaryTranscript.trim().length > 0 ? summaryTranscript : (
                      <div className="text-neutral-400 italic">Sin eventos de chat durante la llamada.</div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <InviteMembersModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        videollamadaId={videollamadaId}
      />

      <AnimatePresence>
        {handBurst && <HandRaiseBurst key={handBurst.id} from={handBurst.from} />}
      </AnimatePresence>

      <AnimatePresence>
        {screenOn && screenStream && (
          <ScreenShareHUD stream={screenStream} onStop={toggleScreen} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================
function ControlBtn({ active, Icon, color, onClick, title }: { active: boolean; Icon: any; color: string; onClick: () => void; title: string }) {
  return (
    <motion.button whileTap={{ scale: 0.92 }} onClick={onClick} title={title}
      className="h-11 w-11 rounded-2xl flex items-center justify-center transition-colors"
      style={active ? { backgroundColor: color, color: "white" } : { backgroundColor: "rgba(255,255,255,0.06)", color: "white" }}>
      <Icon className="h-5 w-5" strokeWidth={2} />
    </motion.button>
  );
}

interface DropItem { id: string; label: string; active: boolean; onClick: () => void }
function ControlWithDropdown(props: {
  active: boolean; Icon: any; onClick: () => void; onMenuToggle: () => void; menuOpen: boolean; onMenuClose: () => void;
  label: string; items: DropItem[]; color: string;
}) {
  const { active, Icon, onClick, onMenuToggle, menuOpen, onMenuClose, label, items, color } = props;
  return (
    <div className="relative flex items-center">
      <motion.button whileTap={{ scale: 0.92 }} onClick={onClick} title={active ? `Apagar ${label.toLowerCase()}` : `Encender ${label.toLowerCase()}`}
        className="h-11 pl-3 pr-2 rounded-l-2xl flex items-center justify-center"
        style={{ backgroundColor: active ? color : "#E53935", color: "white" }}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </motion.button>
      <button onClick={onMenuToggle}
        className="h-11 px-1.5 rounded-r-2xl flex items-center justify-center"
        style={{ backgroundColor: active ? color : "#E53935", color: "white", opacity: 0.85 }}>
        <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={onMenuClose} />
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-full mb-2 left-0 z-40 bg-neutral-900 border border-white/10 rounded-2xl p-1.5 min-w-[220px] max-w-[320px] shadow-2xl">
              <div className="text-[9px] font-ui uppercase tracking-wider text-neutral-500 px-3 py-1.5">{label}</div>
              {items.length === 0 ? (
                <div className="text-[11px] text-neutral-500 px-3 py-2">Sin dispositivos</div>
              ) : items.map((it) => (
                <button key={it.id} onClick={() => it.onClick()}
                  className="w-full px-3 py-2 text-left rounded-lg hover:bg-white/5 flex items-center gap-2 text-[12px]">
                  {it.active && <Check className="h-3 w-3 text-brand-green" />}
                  <span className={cn("flex-1 truncate", !it.active && "pl-5")}>{it.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ParticipantRow({ name, photo, micOn, camOn, handRaised }: { name: string; photo: string | null; micOn: boolean; camOn: boolean; handRaised: boolean }) {
  return (
    <div className="px-5 py-3 flex items-center gap-3 hover:bg-white/5">
      <div className="relative">
        {photo ? (
          <img src={photo} alt="" className="h-10 w-10 rounded-xl object-cover" />
        ) : (
          <div className="h-10 w-10 rounded-xl bg-brand-orange text-white font-bold flex items-center justify-center">{initialsOf(name)}</div>
        )}
        {handRaised && <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 1, repeat: Infinity }} className="absolute -top-1 -right-1 text-lg">✋</motion.div>}
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">{name}</div>
        <div className="text-[10px] text-neutral-400 flex items-center gap-2">
          {micOn ? <Mic className="h-3 w-3 text-brand-green" /> : <MicOff className="h-3 w-3 text-brand-red" />}
          {camOn ? <VideoIcon className="h-3 w-3 text-brand-green" /> : <VideoOff className="h-3 w-3 text-brand-red" />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Modal para invitar nuevos miembros a la llamada
// ============================================================
function InviteMembersModal({
  open, onClose, videollamadaId,
}: { open: boolean; onClose: () => void; videollamadaId: string }) {
  const [contactos, setContactos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSelected(new Set());
    setLoading(true);
    fetch("/api/chat/contactos").then((r) => r.json())
      .then((d) => setContactos(d.contactos || []))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = contactos.filter((c: any) => {
    if (!q.trim()) return true;
    const qq = q.toLowerCase();
    return (c.nombre || "").toLowerCase().includes(qq) || (c.email || "").toLowerCase().includes(qq);
  });

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  const submit = async () => {
    if (selected.size === 0) { toast.error("Selecciona al menos un usuario"); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/videollamadas/${videollamadaId}/invitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: Array.from(selected) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      if (d.chat_nuevo) toast.success(`Invitado${d.invited === 1 ? "" : "s"} · nuevo chat grupal creado`);
      else toast.success(`Se invitó a ${d.invited} persona${d.invited === 1 ? "" : "s"}`);
      onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg max-h-[82vh] rounded-3xl bg-[#0F0F1B] border border-white/10 shadow-[0_30px_90px_rgba(0,0,0,0.55)] overflow-hidden flex flex-col"
        >
          <div className="absolute inset-0 pointer-events-none opacity-40"
            style={{ backgroundImage: "radial-gradient(ellipse at 20% 10%, rgba(87,80,232,0.18), transparent 55%), radial-gradient(ellipse at 80% 90%, rgba(131,56,236,0.18), transparent 55%)" }} />

          <div className="relative px-5 py-4 border-b border-white/10 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white shadow-lg">
              <UserPlus className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-inter font-bold uppercase tracking-[0.2em] text-brand-orange">Invitar a la llamada</div>
              <div className="font-inter font-extrabold text-white text-lg">Agregar participantes</div>
            </div>
            <button onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-white/10 text-white/70 flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative px-5 py-3 border-b border-white/10">
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-white/5 border border-white/10 focus-within:border-brand-orange/50">
              <Search className="h-4 w-4 text-white/40" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar miembro del equipo…"
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
              />
              {selected.size > 0 && (
                <span className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-brand-orange/15 text-brand-orange text-[11px] font-inter font-bold">
                  {selected.size}
                </span>
              )}
            </div>
          </div>

          <div className="relative flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
            {loading ? (
              <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-xs text-white/50">Sin resultados</div>
            ) : (
              filtered.map((c: any) => {
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={`w-full px-3 py-2.5 flex items-center gap-3 text-left rounded-xl transition ${on ? "bg-brand-orange/15" : "hover:bg-white/5"}`}
                  >
                    <div className="relative">
                      <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-bold text-[11px]">
                        {c.foto_perfil_url
                          ? <img src={c.foto_perfil_url} alt={c.nombre} className="h-full w-full object-cover" />
                          : initialsOf(c.nombre)}
                      </div>
                      {c.online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-[#0F0F1B]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-inter font-semibold text-white truncate">{c.nombre}</div>
                      <div className="text-[11px] text-white/50 truncate">{(c.posiciones || [])[0] || c.departamento || c.email}</div>
                    </div>
                    <div className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition ${on ? "bg-brand-orange border-brand-orange" : "border-white/25"}`}>
                      {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="relative px-5 py-4 border-t border-white/10 flex items-center gap-2">
            <div className="text-[11px] text-white/55 font-inter max-w-[240px] leading-tight">
              Si este chat era 1-a-1, se creará un <span className="text-brand-orange font-bold">nuevo chat grupal con color</span> para todos.
            </div>
            <div className="flex-1" />
            <button onClick={onClose} className="h-10 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 font-inter text-[11px] font-bold uppercase tracking-wider transition">Cancelar</button>
            <button
              onClick={submit}
              disabled={saving || selected.size === 0}
              className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white font-inter text-[11px] font-bold uppercase tracking-wider shadow-[0_8px_24px_rgba(87,80,232,0.35)] disabled:opacity-60 flex items-center gap-2 transition"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Invitar {selected.size > 0 ? `(${selected.size})` : ""}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================
// Hand raise burst · animación centro pantalla
// ============================================================
function HandRaiseBurst({ from }: { from: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
    >
      {/* Pulse background */}
      <motion.div
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: [0.2, 2.2, 3.2], opacity: [0, 0.45, 0] }}
        transition={{ duration: 1.8, ease: [0.23, 1, 0.32, 1] }}
        className="absolute h-64 w-64 rounded-full bg-gradient-to-br from-amber-400/60 via-yellow-400/50 to-orange-500/60 blur-3xl"
      />

      {/* Rings expansivos */}
      {[0, 0.15, 0.3].map((d, i) => (
        <motion.div
          key={i}
          initial={{ scale: 0.4, opacity: 0.7 }}
          animate={{ scale: 3 + i * 0.4, opacity: 0 }}
          transition={{ duration: 1.8, delay: d, ease: "easeOut" }}
          className="absolute h-48 w-48 rounded-full border-2 border-amber-400/70"
        />
      ))}

      {/* Partículas radiando */}
      {Array.from({ length: 14 }).map((_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const r = 180;
        return (
          <motion.div
            key={"p" + i}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 0], x: Math.cos(angle) * r, y: Math.sin(angle) * r, scale: [0.4, 1, 0.3] }}
            transition={{ duration: 1.3, delay: 0.12 + i * 0.015, ease: [0.23, 1, 0.32, 1] }}
            className="absolute h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)]"
          />
        );
      })}

      {/* Card central con emoji */}
      <motion.div
        initial={{ scale: 0, rotate: -25, opacity: 0, filter: "blur(12px)" }}
        animate={{
          scale: [0, 1.25, 1, 1.08, 1],
          rotate: [0, -15, 15, -8, 0],
          opacity: [0, 1, 1, 1, 1],
          filter: "blur(0px)",
        }}
        exit={{ scale: 0.6, opacity: 0, y: -40, filter: "blur(8px)" }}
        transition={{ duration: 1.4, times: [0, 0.3, 0.55, 0.8, 1], ease: [0.23, 1, 0.32, 1] }}
        className="relative flex flex-col items-center gap-3"
      >
        <div className="relative h-40 w-40 rounded-[32px] bg-gradient-to-br from-amber-400 via-yellow-400 to-orange-500 flex items-center justify-center shadow-[0_30px_80px_rgba(251,191,36,0.65)] ring-4 ring-white/25">
          <motion.div
            animate={{ rotate: [0, -18, 18, -10, 10, 0] }}
            transition={{ duration: 1.2, repeat: 0, ease: [0.23, 1, 0.32, 1] }}
            className="text-[96px] leading-none select-none"
            style={{ filter: "drop-shadow(0 6px 20px rgba(0,0,0,0.25))" }}
          >
            ✋
          </motion.div>
          {/* Sparkle corners */}
          {[
            { t: -10, l: -10 }, { t: -10, r: -10 },
            { b: -10, l: -10 }, { b: -10, r: -10 },
          ].map((p, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.4, 1, 0], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.4, delay: 0.15 + i * 0.06 }}
              className="absolute h-4 w-4 text-white"
              style={{
                top: (p as any).t !== undefined ? (p as any).t : "auto",
                bottom: (p as any).b !== undefined ? (p as any).b : "auto",
                left: (p as any).l !== undefined ? (p as any).l : "auto",
                right: (p as any).r !== undefined ? (p as any).r : "auto",
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            </motion.div>
          ))}
        </div>
        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="px-4 h-9 rounded-full bg-white/15 backdrop-blur-xl border border-white/20 text-white text-[12px] font-inter font-bold uppercase tracking-[0.2em] flex items-center gap-2 shadow-lg"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          {from === "Tú" ? "Levantaste la mano" : `${from} levantó la mano`}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// Screen share HUD · self-preview en vivo
// ============================================================
function ScreenShareHUD({ stream, onStop }: { stream: MediaStream; onStop: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [minimized, setMinimized] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <motion.div
      initial={{ x: 40, y: 40, opacity: 0, scale: 0.85, filter: "blur(12px)" }}
      animate={{ x: 0, y: 0, opacity: 1, scale: 1, filter: "blur(0)" }}
      exit={{ x: 40, y: 40, opacity: 0, scale: 0.85 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      drag
      dragMomentum={false}
      dragElastic={0.06}
      className="fixed bottom-24 right-6 z-[55] select-none"
    >
      {/* Glow halo */}
      <motion.div
        animate={{ opacity: [0.4, 0.75, 0.4] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -inset-3 rounded-3xl bg-gradient-to-br from-emerald-400/40 via-brand-orange/30 to-neon-magenta/40 blur-2xl pointer-events-none"
      />

      <motion.div
        layout
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className={
          "relative rounded-2xl overflow-hidden bg-[#0A0A12] border border-emerald-400/40 shadow-[0_20px_60px_rgba(0,0,0,0.55)] " +
          (minimized ? "w-[240px]" : "w-[320px] sm:w-[380px]")
        }
      >
        {/* Animated border beam */}
        <span className="pointer-events-none absolute inset-0 rounded-2xl" style={{
          background: "conic-gradient(from var(--angle,0deg), transparent 0%, #10B981 12%, #5750E8 22%, transparent 32%)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "1px",
          animation: "border-spin 5s linear infinite",
        }} />

        {/* Header */}
        <div className="relative px-3 py-2 flex items-center gap-2 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent border-b border-white/5 cursor-move">
          <div className="relative flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/20 border border-emerald-400/40">
            <motion.span
              animate={{ scale: [1, 1.4], opacity: [0.7, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
              className="absolute inset-0 rounded-lg bg-emerald-400"
            />
            <Monitor className="relative h-4 w-4 text-emerald-300" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
              <span className="text-[10px] font-inter font-bold uppercase tracking-[0.18em] text-emerald-300">Compartiendo</span>
            </div>
            <div className="text-[11px] text-white/70 font-inter tabular-nums">{mm}:{ss} · Tu pantalla</div>
          </div>
          <button
            onClick={() => setMinimized((v) => !v)}
            className="h-7 w-7 rounded-lg hover:bg-white/10 text-white/70 flex items-center justify-center transition"
            title={minimized ? "Expandir" : "Minimizar"}
          >
            {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onStop}
            className="h-7 px-2.5 rounded-lg bg-red-500/90 hover:bg-red-500 text-white flex items-center gap-1 text-[10px] font-inter font-bold uppercase tracking-wider shadow-md transition"
          >
            <ScreenShareOff className="h-3 w-3" strokeWidth={2.5} />
            Detener
          </button>
        </div>

        {/* Preview */}
        {!minimized && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="relative bg-black aspect-video"
          >
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="w-full h-full object-contain"
            />
            {/* Overlay sutil */}
            <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-white/10" />
            <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 h-6 rounded-md bg-black/55 backdrop-blur-md text-white text-[10px] font-inter font-bold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              En vivo
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// PeerTile · baldosa de video con overlays + pin
// ============================================================
function PeerTile({
  stream, name, photo, camOn, micOn, handRaised, mirrored, muted,
  isPinned, onTogglePin,
}: {
  stream: MediaStream | null;
  name: string;
  photo?: string | null;
  camOn: boolean;
  micOn: boolean;
  handRaised?: boolean;
  mirrored?: boolean;
  muted?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <div className="relative w-full h-full bg-neutral-900 group overflow-hidden rounded-[inherit]">
      {stream && camOn ? (
        <PeerVideo stream={stream} muted={muted} mirrored={mirrored} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#14141c] to-[#0A0A12]">
          {photo ? (
            <img src={photo} alt={name} className="h-28 w-28 rounded-full object-cover ring-4 ring-white/10" />
          ) : (
            <div className="h-28 w-28 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white text-3xl font-inter font-black ring-4 ring-white/10">
              {initialsOf(name)}
            </div>
          )}
        </div>
      )}

      {/* Gradient overlay bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/65 to-transparent" />

      {/* Name pill */}
      <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/10 text-[11px] font-inter font-semibold text-white/95">
        {isPinned && <Pin className="h-3 w-3 text-brand-orange" strokeWidth={2.5} />}
        <span className="truncate max-w-[160px]">{name}</span>
        {!micOn && <MicOff className="h-3 w-3 text-red-400" strokeWidth={2.5} />}
      </div>

      {/* Hand raised */}
      {handRaised && (
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-3 left-3 h-9 w-9 rounded-full bg-amber-400 flex items-center justify-center text-xl shadow-[0_6px_24px_rgba(251,191,36,0.55)]"
        >
          ✋
        </motion.div>
      )}

      {/* Pin button (hover) */}
      {onTogglePin && (
        <button
          onClick={onTogglePin}
          className={cn(
            "absolute top-3 right-3 h-9 w-9 rounded-xl flex items-center justify-center transition",
            isPinned
              ? "bg-brand-orange text-white shadow-lg"
              : "bg-black/55 backdrop-blur-md border border-white/15 text-white/75 opacity-0 group-hover:opacity-100 hover:bg-black/70 hover:text-white"
          )}
          title={isPinned ? "Quitar fijado" : "Fijar participante"}
        >
          {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
