"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "@/lib/bootstrap-icons";
import {
  RoomAudioRenderer,
  useTracks,
  useRoomContext,
  TrackRefContext,
  useParticipants,
  useConnectionQualityIndicator
} from "@livekit/components-react";
import { Track, RoomEvent, DataPacket_Kind, RemoteParticipant } from "livekit-client";
import { VideoTile } from "./VideoTile";
import { ControlBar } from "./ControlBar";
import { ChatPanel } from "./ChatPanel";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { BackgroundPicker } from "./BackgroundPicker";
import { cn } from "@/lib/utils";

interface Props {
  videollamadaId: string;
  nombreSala: string;
  hostIdentity: string;
  onLeave: () => void;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
}

export function CallStage({ videollamadaId, nombreSala, hostIdentity, onLeave }: Props) {
  const room = useRoomContext();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false }
    ],
    { onlySubscribed: false }
  );
  const participants = useParticipants();
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState("");

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  // Listen for data messages (reactions / hands)
  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg.kind === "reaction") {
          const id = `${msg.from}-${msg.ts}-${Math.random()}`;
          const x = 30 + Math.random() * 40; // % from left
          setReactions((p) => [...p, { id, emoji: msg.emoji, x }]);
          setTimeout(() => setReactions((p) => p.filter((r) => r.id !== id)), 3000);
        } else if (msg.kind === "hand") {
          setRaisedHands((prev) => {
            const next = new Set(prev);
            if (msg.up) next.add(msg.from); else next.delete(msg.from);
            return next;
          });
        }
      } catch {}
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room]);

  // Layout: screenshare gets the spotlight; otherwise grid
  const screenTracks = tracks.filter((t) => t.source === Track.Source.ScreenShare && t.publication);
  const cameraTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const showScreenShare = screenTracks.length > 0;

  const gridCols = (() => {
    const n = cameraTracks.length;
    if (n <= 1) return "grid-cols-1";
    if (n <= 4) return "grid-cols-2";
    if (n <= 9) return "grid-cols-3";
    return "grid-cols-4";
  })();

  return (
    <main className="fixed inset-0 bg-bg-dark text-white overflow-hidden">
      <RoomAudioRenderer />

      {/* Topbar floating */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4 sm:px-6 py-4 flex items-center gap-4 bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 bg-[rgba(10,10,20,0.7)] backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5">
          <img src="/logo-gozz.png" alt="GOZZ" className="h-8 w-8" />
          <div className="min-w-0">
            <div className="font-display font-black text-sm truncate max-w-[260px]">{nombreSala}</div>
            <div className="text-[10px] font-ui uppercase tracking-wider text-brand-orange flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              GOZZ Live · {clock}
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="pointer-events-auto flex items-center gap-2 bg-[rgba(10,10,20,0.7)] backdrop-blur-xl border border-white/10 rounded-full px-3 py-1.5 text-[11px] font-ui">
          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          {participants.length} {participants.length === 1 ? "participante" : "participantes"}
        </div>
      </div>

      {/* Main video area */}
      <div className="absolute inset-0 pt-20 pb-28 px-4 sm:px-6 flex flex-col gap-3">
        {showScreenShare ? (
          <>
            <div className="flex-1 min-h-0">
              {screenTracks[0] && (
                <TrackRefContext.Provider value={screenTracks[0]}>
                  <div className="w-full h-full rounded-3xl overflow-hidden bg-black border-2 border-brand-orange/40 shadow-[0_0_40px_rgba(87,80,232,0.2)]">
                    <VideoTile />
                  </div>
                </TrackRefContext.Provider>
              )}
            </div>
            <div className="h-32 sm:h-40 flex gap-2 overflow-x-auto scrollbar-thin">
              {cameraTracks.map((t) => (
                <TrackRefContext.Provider key={t.participant.identity + t.publication?.trackSid} value={t}>
                  <div className="flex-shrink-0 aspect-video h-full">
                    <VideoTile />
                  </div>
                </TrackRefContext.Provider>
              ))}
            </div>
          </>
        ) : (
          <div className={cn("grid gap-3 flex-1 min-h-0", gridCols)}>
            <AnimatePresence mode="popLayout">
              {cameraTracks.map((t) => (
                <TrackRefContext.Provider key={t.participant.identity + (t.publication?.trackSid || "p")} value={t}>
                  <VideoTile pinned={pinned === t.participant.identity} onPin={() => setPinned(p => p === t.participant.identity ? null : t.participant.identity)} />
                </TrackRefContext.Provider>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Floating reactions */}
      <div className="absolute inset-0 pointer-events-none z-25 overflow-hidden">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.div
              key={r.id}
              initial={{ y: "90vh", opacity: 0, scale: 0.5 }}
              animate={{ y: "10vh", opacity: 1, scale: 1.4 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 2.6, ease: "easeOut" }}
              style={{ left: r.x + "%" }}
              className="absolute text-5xl"
            >
              {r.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <ControlBar
        chatOpen={chatOpen}
        participantsOpen={participantsOpen}
        onChat={() => { setChatOpen((v) => !v); setParticipantsOpen(false); }}
        onParticipants={() => { setParticipantsOpen((v) => !v); setChatOpen(false); }}
        onBackgrounds={() => setBgOpen(true)}
        onLeave={onLeave}
      />

      <ChatPanel videollamadaId={videollamadaId} open={chatOpen} onClose={() => setChatOpen(false)} />
      <ParticipantsPanel open={participantsOpen} onClose={() => setParticipantsOpen(false)} hostIdentity={hostIdentity} raisedHands={raisedHands} />
      <BackgroundPicker open={bgOpen} onClose={() => setBgOpen(false)} />
    </main>
  );
}
