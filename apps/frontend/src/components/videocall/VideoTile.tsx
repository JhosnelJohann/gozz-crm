"use client";
import { Participant, Track } from "livekit-client";
import { useIsSpeaking, useParticipantInfo, VideoTrack, useTrackRefContext, useEnsureParticipant } from "@livekit/components-react";
import { Mic, MicOff, Pin } from "@/lib/bootstrap-icons";
import { motion } from "framer-motion";
import { shortName } from "@/lib/livekit";
import { cn } from "@/lib/utils";

interface Props {
  pinned?: boolean;
  onPin?: () => void;
}

export function VideoTile({ pinned = false, onPin }: Props) {
  const trackRef = useTrackRefContext();
  const participant: Participant = trackRef.participant;
  const { metadata, identity, name } = useParticipantInfo({ participant });
  const isSpeaking = useIsSpeaking(participant);
  const isCamMuted = participant.getTrackPublication(Track.Source.Camera)?.isMuted ?? true;
  const isMicMuted = participant.getTrackPublication(Track.Source.Microphone)?.isMuted ?? true;
  const displayName = name || identity || "Participante";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        "relative group rounded-3xl overflow-hidden bg-black border-2 transition-all",
        isSpeaking ? "border-brand-orange shadow-[0_0_24px_rgba(87,80,232,0.4)]" : "border-white/10",
        pinned && "ring-2 ring-brand-orange"
      )}
    >
      {!isCamMuted ? (
        <VideoTrack trackRef={trackRef as any} className="w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 via-black to-zinc-950">
          <div className="h-24 w-24 rounded-full gradient-orange flex items-center justify-center text-3xl font-display font-black uppercase">
            {shortName(displayName)}
          </div>
        </div>
      )}

      {/* Bottom name bar */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-2">
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center transition",
          isMicMuted ? "bg-red-600/80" : isSpeaking ? "bg-brand-orange" : "bg-white/15"
        )}>
          {isMicMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </div>
        <div className="text-xs font-ui font-semibold truncate flex-1">{displayName}</div>
        {onPin && (
          <button
            onClick={onPin}
            className="opacity-0 group-hover:opacity-100 transition h-7 w-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
