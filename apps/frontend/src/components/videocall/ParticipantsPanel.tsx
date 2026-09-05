"use client";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Hand, Crown } from "@/lib/bootstrap-icons";
import { useParticipants } from "@livekit/components-react";
import { Track } from "livekit-client";
import { shortName } from "@/lib/livekit";

interface Props {
  open: boolean;
  onClose: () => void;
  hostIdentity?: string;
  raisedHands: Set<string>;
}

export function ParticipantsPanel({ open, onClose, hostIdentity, raisedHands }: Props) {
  const participants = useParticipants();

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 bg-[rgba(10,10,20,0.92)] backdrop-blur-xl border-l border-white/10 z-30 flex flex-col"
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-ui uppercase text-[10px] tracking-wider text-brand-orange mb-0.5">Participantes</div>
              <div className="font-display font-black text-sm">{participants.length} en la sala</div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin">
            {participants.map((p) => {
              const muted = p.getTrackPublication(Track.Source.Microphone)?.isMuted ?? true;
              const isHost = p.identity === hostIdentity;
              const handUp = raisedHands.has(p.identity);
              return (
                <div key={p.identity} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition">
                  <div className="h-9 w-9 rounded-full gradient-orange flex items-center justify-center text-xs font-display font-black uppercase">
                    {shortName(p.name || p.identity)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-1.5 truncate">
                      <span className="truncate">{p.name || p.identity}</span>
                      {isHost && <Crown className="h-3.5 w-3.5 text-brand-orange flex-shrink-0" strokeWidth={2.5} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {handUp && (
                      <div className="h-7 w-7 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center animate-pulse">
                        <Hand className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center ${
                      muted ? "bg-red-600/30 text-red-300" : "bg-white/10 text-white/70"
                    }`}>
                      {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
