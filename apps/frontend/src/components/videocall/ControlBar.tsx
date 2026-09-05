"use client";
import { useState } from "react";
import { Mic, MicOff, Video, VideoOff, Monitor, Hand, MessageSquare, Smile, Users, PhoneOff, Sparkles } from "@/lib/bootstrap-icons";
import { motion, AnimatePresence } from "framer-motion";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Track } from "livekit-client";
import { cn } from "@/lib/utils";

interface Props {
  onChat: () => void;
  onParticipants: () => void;
  onBackgrounds: () => void;
  onLeave: () => void;
  chatOpen: boolean;
  participantsOpen: boolean;
}

const REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👏"];

export function ControlBar({ onChat, onParticipants, onBackgrounds, onLeave, chatOpen, participantsOpen }: Props) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [showReactions, setShowReactions] = useState(false);
  const [handUp, setHandUp] = useState(false);

  const micEnabled = localParticipant.isMicrophoneEnabled;
  const camEnabled = localParticipant.isCameraEnabled;
  const screenEnabled = localParticipant.isScreenShareEnabled;

  const toggleMic = () => localParticipant.setMicrophoneEnabled(!micEnabled);
  const toggleCam = () => localParticipant.setCameraEnabled(!camEnabled);
  const toggleScreen = () => localParticipant.setScreenShareEnabled(!screenEnabled);

  const sendReaction = (emoji: string) => {
    const data = new TextEncoder().encode(JSON.stringify({ kind: "reaction", emoji, from: localParticipant.identity, ts: Date.now() }));
    room.localParticipant.publishData(data, { reliable: false });
    setShowReactions(false);
  };

  const toggleHand = () => {
    const next = !handUp;
    setHandUp(next);
    const data = new TextEncoder().encode(JSON.stringify({ kind: "hand", up: next, from: localParticipant.identity, name: localParticipant.name }));
    room.localParticipant.publishData(data, { reliable: true });
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 p-4 sm:p-6 flex items-center justify-center pointer-events-none">
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 22 }}
        className="pointer-events-auto flex items-center gap-2 bg-[rgba(10,10,20,0.85)] backdrop-blur-2xl border border-white/10 rounded-3xl px-3 py-3 shadow-2xl"
      >
        <CtrlBtn onClick={toggleMic} active={micEnabled} dangerOff label="Micrófono">
          {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </CtrlBtn>
        <CtrlBtn onClick={toggleCam} active={camEnabled} dangerOff label="Cámara">
          {camEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </CtrlBtn>
        <CtrlBtn onClick={toggleScreen} active={screenEnabled} highlighted={screenEnabled} label="Pantalla">
          <Monitor className="h-5 w-5" />
        </CtrlBtn>
        <CtrlBtn onClick={toggleHand} active highlighted={handUp} label="Mano">
          <Hand className="h-5 w-5" />
        </CtrlBtn>

        <div className="relative">
          <CtrlBtn onClick={() => setShowReactions((v) => !v)} active label="Reacciones">
            <Smile className="h-5 w-5" />
          </CtrlBtn>
          <AnimatePresence>
            {showReactions && (
              <motion.div
                initial={{ y: 10, opacity: 0, scale: 0.9 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 10, opacity: 0, scale: 0.9 }}
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[rgba(10,10,20,0.95)] backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex gap-1 shadow-2xl"
              >
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => sendReaction(emoji)}
                    className="h-10 w-10 text-2xl hover:bg-white/10 rounded-xl transition"
                  >
                    {emoji}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <CtrlBtn onClick={onBackgrounds} active label="Fondo">
          <Sparkles className="h-5 w-5" />
        </CtrlBtn>
        <CtrlBtn onClick={onChat} active highlighted={chatOpen} label="Chat">
          <MessageSquare className="h-5 w-5" />
        </CtrlBtn>
        <CtrlBtn onClick={onParticipants} active highlighted={participantsOpen} label="Participantes">
          <Users className="h-5 w-5" />
        </CtrlBtn>

        <div className="w-px h-8 bg-white/10 mx-1" />

        <button
          onClick={onLeave}
          title="Salir"
          className="h-12 px-5 rounded-2xl bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 flex items-center gap-2 text-sm font-ui uppercase tracking-wider font-bold transition shadow-[0_8px_30px_rgba(220,38,38,0.4)]"
        >
          <PhoneOff className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </motion.div>
    </div>
  );
}

function CtrlBtn({ children, onClick, active, dangerOff, highlighted, label }: any) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "h-12 w-12 rounded-2xl flex items-center justify-center transition active:scale-95",
        highlighted
          ? "bg-gradient-to-br from-brand-orange to-neon-magenta text-white shadow-[0_4px_20px_rgba(87,80,232,0.4)]"
          : !active && dangerOff
          ? "bg-red-600/90 hover:bg-red-500 text-white"
          : "bg-white/10 hover:bg-white/20 text-white"
      )}
    >
      {children}
    </button>
  );
}
