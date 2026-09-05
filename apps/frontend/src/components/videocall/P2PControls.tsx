"use client";
import { motion } from "framer-motion";
import { Mic, MicOff, Video, VideoOff, Monitor, PhoneOff, Users } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

interface Props {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreen: () => void;
  onHangup: () => void;
}

export function P2PControls(props: Props) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 p-4 sm:p-6 flex items-center justify-center pointer-events-none">
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 22 }}
        className="pointer-events-auto flex items-center gap-2 bg-[rgba(10,10,20,0.85)] backdrop-blur-2xl border border-white/10 rounded-3xl px-3 py-3 shadow-2xl"
      >
        <Btn onClick={props.onToggleMic} active={props.micOn} dangerOff label="Micrófono">
          {props.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </Btn>
        <Btn onClick={props.onToggleCam} active={props.camOn} dangerOff label="Cámara">
          {props.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </Btn>
        <Btn onClick={props.onToggleScreen} active highlighted={props.screenOn} label="Pantalla">
          <Monitor className="h-5 w-5" />
        </Btn>
        <div className="w-px h-8 bg-white/10 mx-1" />
        <button
          onClick={props.onHangup}
          title="Colgar"
          className="h-12 px-5 rounded-2xl bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 flex items-center gap-2 text-sm font-ui uppercase tracking-wider font-bold transition shadow-[0_8px_30px_rgba(220,38,38,0.4)]"
        >
          <PhoneOff className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">Colgar</span>
        </button>
      </motion.div>
    </div>
  );
}

function Btn({ children, onClick, active, dangerOff, highlighted, label }: any) {
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
