"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Track, RoomEvent } from "livekit-client";
import {
  ParticipantTile,
  VideoTrack,
  TrackToggle,
  MediaDeviceMenu,
  useTracks,
  useParticipants,
  useRoomContext,
  useDataChannel,
  useChat,
  useConnectionState,
  isTrackReference,
} from "@livekit/components-react";
import {
  UserPlus, LayoutGrid, Hand, MessageSquare, LogOut, Maximize2,
  PictureInPicture2, Mic, MicOff, Video as VideoIcon, VideoOff, Users, X, Send, Smile, MonitorUp,
} from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { InviteToCallModal } from "./InviteToCallModal";
import type { CallMode } from "./CallProvider";

// ============================================================
// Sonidos in-call (WebAudio, sin archivos): mano levantada y mensaje de chat.
// Se reproducen LOCALMENTE en cada cliente al recibir el evento, asi todos los
// oyen (igual que Zoom/Meet). No viajan por el audio de la llamada.
// ============================================================
let _ac: AudioContext | null = null;
function getAC(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    let ac = _ac;
    if (!ac) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      ac = new Ctx() as AudioContext;
      _ac = ac;
    }
    if (ac.state === "suspended") void ac.resume();
    return ac;
  } catch { return null; }
}
function playTone(kind: "hand" | "msg") {
  const ac = getAC();
  if (!ac) return;
  const now = ac.currentTime;
  const notes: Array<[number, number]> = kind === "hand" ? [[659, 0], [880, 0.13]] : [[820, 0]];
  for (const [freq, t] of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(g); g.connect(ac.destination);
    const st = now + t;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.16, st + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.24);
    osc.start(st); osc.stop(st + 0.26);
  }
}

// ============================================================
// Estado "mano levantada" compartido por data channel (cliente a cliente, sin backend).
// ============================================================
type HandMap = Record<string, boolean>;
const RaiseHandContext = createContext<HandMap>({});

function useProvideRaiseHands() {
  const room = useRoomContext();
  const [hands, setHands] = useState<HandMap>({});
  const localRaised = useRef(false);

  const { send } = useDataChannel("gozz-hands", (msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload));
      const id = (msg.from && msg.from.identity) || d.id;
      if (!id) return;
      const raised = !!d.raised;
      setHands((p) => {
        if (raised && !p[id]) playTone("hand"); // suena cuando alguien LEVANTA la mano
        return { ...p, [id]: raised };
      });
    } catch { /* ignore */ }
  });

  const broadcast = useCallback((raised: boolean) => {
    try { send(new TextEncoder().encode(JSON.stringify({ raised })), { reliable: true }); } catch { /* ignore */ }
  }, [send]);

  const toggle = useCallback(() => {
    const v = !localRaised.current;
    localRaised.current = v;
    if (v) playTone("hand");
    const myId = room.localParticipant.identity;
    setHands((p) => ({ ...p, [myId]: v }));
    broadcast(v);
  }, [room, broadcast]);

  // Re-difunde mi estado a quien se une tarde; limpia a quien se va.
  useEffect(() => {
    const onJoin = () => { if (localRaised.current) setTimeout(() => broadcast(true), 600); };
    const onLeft = (p: any) => setHands((m) => { const n = { ...m }; delete n[p.identity]; return n; });
    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => { room.off(RoomEvent.ParticipantConnected, onJoin); room.off(RoomEvent.ParticipantDisconnected, onLeft); };
  }, [room, broadcast]);

  const myId = room.localParticipant.identity;
  return { hands, toggle, myRaised: !!hands[myId] };
}

// Badge profesional de mano levantada (animacion sobria).
function HandBadge() {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0, y: -4 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
      className="absolute top-2 left-2 z-20 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-amber-400/95 text-neutral-900 shadow-lg shadow-amber-900/30 ring-1 ring-amber-200/70 backdrop-blur-sm pointer-events-none"
    >
      <motion.span
        animate={{ rotate: [0, -14, 11, -7, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
        style={{ display: "inline-flex", transformOrigin: "70% 80%" }}
      >
        <Hand className="h-3.5 w-3.5" strokeWidth={2.6} />
      </motion.span>
      <span className="text-[11px] font-bold tracking-tight">Mano</span>
    </motion.div>
  );
}

// ============================================================
// Grid de participantes (con badge de mano por tile).
// ============================================================
// Grid adaptativo: las columnas/filas cambian segun la cantidad de participantes
// para aprovechar TODO el espacio de la llamada (sin huecos en 1-4, lo comun).
function CallStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  const hands = useContext(RaiseHandContext);
  const cell = (t: (typeof tracks)[number], i: number, cls: string) => {
    const id = t.participant?.identity;
    return (
      <div key={(id || "p") + "_" + (t.source || "") + "_" + i} className={cls + " relative"}>
        <ParticipantTile trackRef={t} />
        {id && hands[id] && <HandBadge />}
      </div>
    );
  };

  // Si alguien comparte pantalla: ESA pantalla es la protagonista (grande) y las
  // camaras pasan a una tira de miniaturas abajo.
  const screenRaw = tracks.find((t) => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const screen = screenRaw && isTrackReference(screenRaw) ? screenRaw : null;
  if (screen) {
    const others = tracks.filter((t) => t !== screen);
    return (
      <div className="gozz-focus">
        <div className="gozz-focus-main relative">
          <VideoTrack trackRef={screen} className="gozz-screen-video" />
          <div className="gozz-share-label">
            <MonitorUp className="h-3.5 w-3.5" strokeWidth={2.4} />
            {(screen.participant?.name || screen.participant?.identity || "Pantalla") + " está compartiendo"}
          </div>
        </div>
        {others.length > 0 && (
          <div className="gozz-focus-strip">
            {others.map((t, i) => cell(t, i, "gozz-thumb"))}
          </div>
        )}
      </div>
    );
  }

  const n = tracks.length || 1;
  const cols = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : 5;
  return (
    <div className="gozz-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {tracks.map((t, i) => cell(t, i, "gozz-cell"))}
    </div>
  );
}

// Indicador de conexion (arriba a la derecha).
function ConnIndicator() {
  const state = useConnectionState();
  const dot = state === "connected" ? "bg-emerald-400"
    : (state === "connecting" || state === "reconnecting" || state === "signalReconnecting") ? "bg-amber-400 animate-pulse"
    : "bg-red-500";
  return (
    <div className="absolute top-3 right-3 z-30 px-3 h-7 rounded-full bg-black/55 text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 backdrop-blur-md pointer-events-none">
      <span className={"h-2 w-2 rounded-full " + dot} />
      {String(state)}
    </div>
  );
}

// ============================================================
// Document Picture-in-Picture (Chrome/Edge): ventana flotante sobre todo.
// ============================================================
function usePiP() {
  const [win, setWin] = useState<Window | null>(null);
  const supported = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const open = useCallback(async (w = 420, h = 300) => {
    if (!supported) return;
    try {
      const pip: Window = await (window as any).documentPictureInPicture.requestWindow({ width: w, height: h });
      // Copia las hojas de estilo (Tailwind + LiveKit) para que se vea igual.
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        try { pip.document.head.appendChild(node.cloneNode(true)); } catch { /* ignore */ }
      });
      pip.document.body.style.margin = "0";
      pip.document.body.style.background = "#0A0A12";
      pip.document.documentElement.classList.add("dark");
      pip.addEventListener("pagehide", () => setWin(null));
      setWin(pip);
    } catch { /* el usuario cancelo o no esta soportado */ }
  }, [supported]);
  const close = useCallback(() => { if (win) { try { win.close(); } catch { /* ignore */ } } setWin(null); }, [win]);
  useEffect(() => () => { if (win) { try { win.close(); } catch { /* ignore */ } } }, [win]);
  return { supported, win, open, close };
}

// Asignacion de onClick por DOM nativo: los eventos sinteticos de React NO cruzan a la
// ventana PiP (otro document). Con ref.onclick funciona en ventana normal Y en PiP.
const nclick = (fn: () => void) => (el: HTMLButtonElement | null) => {
  if (el) el.onclick = (e) => { e.preventDefault(); fn(); };
};

// Controles compactos del mini/PiP (mic, cam, mano, maximizar, pop-out, colgar).
function MiniControls({
  myRaised, onToggleHand, onMaximize, onLeave, pipSupported, pipOpen, onTogglePip,
}: {
  myRaised: boolean; onToggleHand: () => void; onMaximize: () => void; onLeave: () => void;
  pipSupported: boolean; pipOpen: boolean; onTogglePip: () => void;
}) {
  const room = useRoomContext();
  const [micOn, setMicOn] = useState(room.localParticipant.isMicrophoneEnabled);
  const [camOn, setCamOn] = useState(room.localParticipant.isCameraEnabled);
  useEffect(() => {
    const sync = () => { setMicOn(room.localParticipant.isMicrophoneEnabled); setCamOn(room.localParticipant.isCameraEnabled); };
    room.localParticipant.on("trackMuted", sync).on("trackUnmuted", sync).on("trackPublished", sync);
    return () => { room.localParticipant.off("trackMuted", sync).off("trackUnmuted", sync).off("trackPublished", sync); };
  }, [room]);
  const toggleMic = () => room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
  const toggleCam = () => room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
  const btn = "h-9 w-9 inline-flex items-center justify-center rounded-full text-white transition-colors";
  return (
    <div className="gozz-mini-controls flex items-center justify-center gap-1.5 px-2.5 py-2 shrink-0">
      <button ref={nclick(toggleMic)} title="Microfono" className={btn + (micOn ? " bg-white/15 hover:bg-white/25" : " bg-red-500/90 hover:bg-red-500")}>
        {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
      <button ref={nclick(toggleCam)} title="Camara" className={btn + (camOn ? " bg-white/15 hover:bg-white/25" : " bg-red-500/90 hover:bg-red-500")}>
        {camOn ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </button>
      <button ref={nclick(onToggleHand)} title="Levantar la mano" className={btn + (myRaised ? " bg-amber-400 text-neutral-900 hover:bg-amber-300" : " bg-white/15 hover:bg-white/25")}>
        <Hand className="h-4 w-4" strokeWidth={2.4} />
      </button>
      {pipSupported && (
        <button ref={nclick(onTogglePip)} title={pipOpen ? "Cerrar ventana flotante" : "Ventana flotante"} className={btn + (pipOpen ? " bg-brand-orange hover:bg-brand-orange/90" : " bg-white/15 hover:bg-white/25")}>
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      )}
      <button ref={nclick(onMaximize)} title="Volver a pantalla completa" className={btn + " bg-emerald-500 hover:bg-emerald-400"}>
        <Maximize2 className="h-4 w-4" />
      </button>
      <button ref={nclick(onLeave)} title="Colgar" className={btn + " bg-red-600 hover:bg-red-500"}>
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

// Escenario del mini: locutor/otro participante en grande + self-pip en esquina (estilo Meet).
function MiniStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  const room = useRoomContext();
  const hands = useContext(RaiseHandContext);
  const localId = room.localParticipant.identity;
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const cams = tracks.filter((t) => t.source === Track.Source.Camera);
  const remotes = cams.filter((t) => t.participant.identity !== localId);
  const selfT = cams.find((t) => t.participant.identity === localId);
  const primary = screen || remotes.find((t) => t.participant.isSpeaking) || remotes[0] || selfT || tracks[0];
  const primId = primary?.participant?.identity;
  // self-pip solo si el track propio es real (no placeholder) y no es el principal.
  const selfReal = selfT && selfT !== primary && isTrackReference(selfT) ? selfT : null;
  return (
    <div className="relative h-full w-full bg-[#0b0b14]">
      {primary && <ParticipantTile trackRef={primary} className="gozz-mini-primary" />}
      {primId && hands[primId] && <HandBadge />}
      {selfReal && (
        <div className="absolute bottom-2 right-2 w-[36%] max-w-[120px] aspect-video rounded-lg overflow-hidden ring-1 ring-white/25 shadow-lg bg-black">
          <VideoTrack trackRef={selfReal} className="h-full w-full" style={{ objectFit: "cover" }} />
        </div>
      )}
    </div>
  );
}

// Contenido del mini (header + escenario + controles). Se renderiza en el widget o en la ventana PiP.
function MiniContent(props: {
  title: string; myRaised: boolean; onToggleHand: () => void; onMaximize: () => void; onLeave: () => void;
  pipSupported: boolean; pipOpen: boolean; onTogglePip: () => void; inPip?: boolean;
}) {
  const count = useParticipants().length;
  return (
    <div className="gozz-mini flex flex-col h-full w-full overflow-hidden">
      {/* En la ventana PiP el navegador ya pone su barra de titulo, asi que ocultamos
          este header para no duplicar. En el widget in-app si lo mostramos. */}
      {!props.inPip && (
        <div className="gozz-mini-head flex items-center gap-2 px-3 h-8 shrink-0">
          <span className="gozz-live-dot" />
          <span className="text-[11px] font-semibold text-white/90 truncate flex-1">{props.title}</span>
          <span className="text-[10px] font-bold text-white/55 inline-flex items-center gap-1">
            <Users className="h-3 w-3" strokeWidth={2.5} />{count}
          </span>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <MiniStage />
      </div>
      <MiniControls {...props} />
    </div>
  );
}

// ============================================================
// Chat profesional (custom, reemplaza el prebuilt de LiveKit) con emojis + sonido.
// ============================================================
const EMOJIS = ["😀","😁","😂","🤣","😊","😍","😎","🤔","👍","👎","🙏","👏","🙌","🔥","🎉","❤️","💯","✅","❌","👌","🤝","💪","😮","😢","😅","🥳","👀","⭐","☕","🚀"];

function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="gozz-emoji-pop">
      {EMOJIS.map((e) => (
        <button key={e} type="button" className="gozz-emoji" onClick={() => onPick(e)}>{e}</button>
      ))}
    </div>
  );
}

type ChatApi = ReturnType<typeof useChat>;

function ChatPanel({ chat, onClose }: { chat: ChatApi; onClose: () => void }) {
  const { chatMessages, send, isSending } = chat;
  const room = useRoomContext();
  const meId = room.localParticipant.identity;
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages.length]);

  const submit = async () => {
    const t = text.trim();
    if (!t || isSending) return;
    setText("");
    setEmojiOpen(false);
    playTone("msg"); // suena al enviar
    try { await send(t); } catch { /* ignore */ }
    inputRef.current?.focus();
  };

  return (
    <div className="gozz-chat w-[340px] shrink-0 flex flex-col border-l border-white/10 bg-[#0c0c14]">
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 text-white/90 text-sm font-bold"><MessageSquare className="h-4 w-4" strokeWidth={2.2} /> Chat</div>
        <button onClick={onClose} className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
        {chatMessages.length === 0 && (
          <div className="m-auto text-center text-white/35 text-[12px]">
            <MessageSquare className="h-7 w-7 mx-auto mb-2 opacity-40" />
            Aun no hay mensajes
          </div>
        )}
        {chatMessages.map((m, i) => {
          const mine = m.from?.identity === meId;
          return (
            <div key={i} className={cn("flex flex-col max-w-[88%]", mine ? "items-end self-end" : "items-start self-start")}>
              {!mine && <span className="text-[10px] text-white/45 px-1.5 mb-0.5 font-medium">{m.from?.name || m.from?.identity || "Usuario"}</span>}
              <div className={cn("px-3 py-2 text-[13px] leading-snug break-words shadow-sm", mine ? "bg-brand-orange text-white rounded-2xl rounded-br-md" : "bg-white/[0.09] text-white/90 rounded-2xl rounded-bl-md")}>{m.message}</div>
              <span className="text-[9px] text-white/30 px-1.5 mt-0.5">{new Date(m.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="relative border-t border-white/10 p-2.5 shrink-0">
        {emojiOpen && <EmojiPicker onPick={(e) => { setText((t) => t + e); inputRef.current?.focus(); }} />}
        <div className="flex items-end gap-1.5 bg-white/[0.06] rounded-2xl px-2 py-1.5 border border-white/10 focus-within:border-brand-orange/60 transition-colors">
          <button type="button" onClick={() => setEmojiOpen((v) => !v)} className={cn("h-8 w-8 inline-flex items-center justify-center rounded-lg shrink-0", emojiOpen ? "text-brand-orange bg-brand-orange/15" : "text-white/55 hover:text-white hover:bg-white/10")}>
            <Smile className="h-5 w-5" />
          </button>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Escribe un mensaje..."
            className="flex-1 min-w-0 bg-transparent text-[13px] text-white placeholder-white/35 outline-none py-1.5"
          />
          <button type="button" onClick={submit} disabled={!text.trim() || isSending} className="h-8 w-8 inline-flex items-center justify-center rounded-lg shrink-0 bg-brand-orange text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-orange/90 transition-colors">
            <Send className="h-4 w-4" strokeWidth={2.3} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CallUI principal: alterna fullscreen / mini / PiP.
// ============================================================
export function CallUI({
  roomId, title, mode, onMinimize, onMaximize, onLeave,
}: {
  roomId: string; title: string; mode: CallMode;
  onMinimize: () => void; onMaximize: () => void; onLeave: () => void;
}) {
  const raise = useProvideRaiseHands();
  const [chatOpen, setChatOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const pip = usePiP();

  // Chat a nivel de CallUI: asi el sonido + el contador de no-leidos funcionan
  // aunque el panel este cerrado o la llamada minimizada.
  const chat = useChat();
  const room = useRoomContext();
  const meId = room.localParticipant.identity;
  const [unread, setUnread] = useState(0);
  const chatCountRef = useRef(0);
  useEffect(() => {
    if (chat.chatMessages.length > chatCountRef.current) {
      const last = chat.chatMessages[chat.chatMessages.length - 1];
      if (last && last.from?.identity && last.from.identity !== meId) {
        playTone("msg");
        if (!chatOpen) setUnread((u) => u + 1);
      }
    }
    chatCountRef.current = chat.chatMessages.length;
  }, [chat.chatMessages, chatOpen, meId]);
  useEffect(() => { if (chatOpen) setUnread(0); }, [chatOpen]);

  // Al maximizar o colgar, cierra la ventana PiP si estaba abierta.
  const handleMaximize = () => { pip.close(); onMaximize(); };
  const handleLeave = () => { pip.close(); onLeave(); };
  const togglePip = () => { if (pip.win) pip.close(); else pip.open(); };

  // ---------- MODO MINI ----------
  if (mode === "mini") {
    const miniProps = {
      title,
      myRaised: raise.myRaised,
      onToggleHand: raise.toggle,
      onMaximize: handleMaximize,
      onLeave: handleLeave,
      pipSupported: pip.supported,
      pipOpen: !!pip.win,
      onTogglePip: togglePip,
    };
    const content = (
      <RaiseHandContext.Provider value={raise.hands}>
        <MiniContent {...miniProps} inPip={!!pip.win} />
      </RaiseHandContext.Provider>
    );
    // Si hay ventana PiP abierta, el contenido vive ahi (flota sobre todo, Chrome/Edge).
    if (pip.win) {
      return createPortal(content, pip.win.document.body);
    }
    // Si no, widget flotante arrastrable dentro del CRM (todos los navegadores).
    return (
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.04}
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="fixed bottom-5 right-5 z-[100] w-[330px] h-[252px] rounded-2xl p-[1.5px] bg-gradient-to-br from-brand-orange/70 via-fuchsia-500/40 to-sky-500/40 shadow-2xl shadow-black/60 cursor-grab active:cursor-grabbing"
        style={{ pointerEvents: "auto" }}
      >
        <div className="h-full w-full rounded-[15px] overflow-hidden bg-[#0b0b14]">
          {content}
        </div>
      </motion.div>
    );
  }

  // ---------- MODO FULLSCREEN ----------
  return (
    <RaiseHandContext.Provider value={raise.hands}>
      <div className="absolute inset-0 flex flex-col" style={{ pointerEvents: "auto" }}>
        <ConnIndicator />

        {/* Escenario + chat lateral. pb reserva el alto de la barra flotante (no chocan). */}
        <div className="flex-1 min-h-0 flex pb-[88px]">
          <div className="flex-1 min-w-0 relative gozz-stage">
            <CallStage />
          </div>
          {chatOpen && <ChatPanel chat={chat} onClose={() => setChatOpen(false)} />}
        </div>

        {/* Barra de controles (mismo estilo LiveKit, con botones extra integrados). */}
        <div className="lk-control-bar gozz-control-bar" data-lk-theme="default">
          <div className="lk-button-group">
            <TrackToggle source={Track.Source.Microphone} showIcon>Microfono</TrackToggle>
            <div className="lk-button-group-menu"><MediaDeviceMenu kind="audioinput" /></div>
          </div>
          <div className="lk-button-group">
            <TrackToggle source={Track.Source.Camera} showIcon>Camara</TrackToggle>
            <div className="lk-button-group-menu"><MediaDeviceMenu kind="videoinput" /></div>
          </div>
          <TrackToggle source={Track.Source.ScreenShare} showIcon captureOptions={{ audio: true, selfBrowserSurface: "include" } as any}>
            Compartir
          </TrackToggle>

          <button className={"lk-button" + (chatOpen ? " gozz-active" : "")} onClick={() => setChatOpen((v) => !v)}>
            <MessageSquare className="h-5 w-5" strokeWidth={2} /> Chat
            {unread > 0 && <span className="gozz-badge">{unread > 9 ? "9+" : unread}</span>}
          </button>

          {/* --- Botones nuevos, integrados en la barra --- */}
          <button className="lk-button" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-5 w-5" strokeWidth={2} /> Agregar
          </button>
          <button className="lk-button" onClick={() => { if (pip.supported) pip.open(); onMinimize(); }}>
            <LayoutGrid className="h-5 w-5" strokeWidth={2} /> Ver CRM
          </button>
          <button className={"lk-button gozz-hand-btn" + (raise.myRaised ? " gozz-raised" : "")} onClick={raise.toggle}>
            <Hand className="h-5 w-5" strokeWidth={2} /> {raise.myRaised ? "Bajar mano" : "Levantar mano"}
          </button>

          <button className="lk-button gozz-leave" onClick={handleLeave}>
            <LogOut className="h-5 w-5" strokeWidth={2} /> Salir
          </button>
        </div>

        <InviteToCallModal videollamadaId={roomId} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      </div>
    </RaiseHandContext.Provider>
  );
}
