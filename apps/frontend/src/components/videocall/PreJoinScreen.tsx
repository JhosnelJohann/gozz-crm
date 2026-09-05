"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Video, VideoOff, Sparkles, ArrowRight, Loader2 } from "@/lib/bootstrap-icons";
import { ShimmerButton } from "@/components/magic/ShimmerButton";

interface Props {
  videollamadaId: string;
  nombreSala: string;
  displayName: string;
  onJoin: (opts: { audio: boolean; video: boolean; audioDeviceId?: string; videoDeviceId?: string }) => void;
  joining?: boolean;
}

export function PreJoinScreen({ videollamadaId, nombreSala, displayName, onJoin, joining = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState<string>("");
  const [videoDeviceId, setVideoDeviceId] = useState<string>("");

  useEffect(() => {
    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const devs = await navigator.mediaDevices.enumerateDevices();
        setDevices(devs);
        const cam = devs.find((d) => d.kind === "videoinput" && d.deviceId);
        const mic = devs.find((d) => d.kind === "audioinput" && d.deviceId);
        if (cam) setVideoDeviceId(cam.deviceId);
        if (mic) setAudioDeviceId(mic.deviceId);
      } catch (e) {
        console.warn("Permission denied or no devices", e);
      }
    }
    init();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => (t.enabled = audio));
      streamRef.current.getVideoTracks().forEach((t) => (t.enabled = video));
    }
  }, [audio, video]);

  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");

  return (
    <main className="fixed inset-0 bg-bg-dark text-white flex items-center justify-center overflow-hidden">
      {/* Aurora bg */}
      <div className="absolute inset-0 opacity-50 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-orange/20 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-neon-magenta/20 rounded-full blur-3xl animate-pulse-glow" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, filter: "blur(12px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
        className="relative z-10 w-full max-w-5xl mx-4 grid grid-cols-1 md:grid-cols-2 gap-6"
      >
        {/* Cam preview */}
        <div className="relative aspect-video rounded-3xl overflow-hidden bg-black border border-white/10 shadow-2xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
            style={{ display: video ? "block" : "none" }}
          />
          {!video && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black">
              <div className="h-32 w-32 rounded-full gradient-orange flex items-center justify-center text-4xl font-display font-black">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            </div>
          )}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-center gap-3">
            <button
              onClick={() => setAudio((v) => !v)}
              className={`h-12 w-12 rounded-2xl backdrop-blur-md flex items-center justify-center transition ${
                audio ? "bg-white/15 hover:bg-white/25" : "bg-red-600/90 hover:bg-red-500"
              }`}
            >
              {audio ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setVideo((v) => !v)}
              className={`h-12 w-12 rounded-2xl backdrop-blur-md flex items-center justify-center transition ${
                video ? "bg-white/15 hover:bg-white/25" : "bg-red-600/90 hover:bg-red-500"
              }`}
            >
              {video ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Right info panel */}
        <div className="relative rounded-3xl p-8 border border-white/10 bg-[rgba(10,10,20,0.7)] backdrop-blur-2xl flex flex-col">
          <div className="flex items-center gap-2 text-[11px] font-ui uppercase tracking-[0.2em] text-brand-orange mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            GOZZ Live · Videollamada
          </div>
          <h1 className="font-display font-black text-3xl mb-2 text-gradient-neon">{nombreSala}</h1>
          <p className="text-sm text-white/60 mb-6">Estás a punto de entrar como <span className="text-white font-semibold">{displayName}</span></p>

          <div className="space-y-4 flex-1">
            <div>
              <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 mb-2 block">Cámara</label>
              <select
                value={videoDeviceId}
                onChange={(e) => setVideoDeviceId(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange"
              >
                {cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "Cámara"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-ui uppercase tracking-[0.15em] text-white/60 mb-2 block">Micrófono</label>
              <select
                value={audioDeviceId}
                onChange={(e) => setAudioDeviceId(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-brand-orange"
              >
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "Mic"}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6">
            <ShimmerButton
              onClick={() => {
                streamRef.current?.getTracks().forEach((t) => t.stop());
                onJoin({ audio, video, audioDeviceId, videoDeviceId });
              }}
              disabled={joining}
              size="lg"
              className="w-full"
            >
              {joining ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Entrar a la sala
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </ShimmerButton>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
