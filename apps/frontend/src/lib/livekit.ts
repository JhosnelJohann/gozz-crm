import { LocalParticipant, Room, RoomEvent, Track, VideoPresets } from "livekit-client";

export const ROOM_DEFAULT_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720]
  },
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution
  },
  audioCaptureDefaults: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true
  }
};

export type JoinPayload = {
  token: string;
  url: string;
  displayName: string;
  role: "host" | "participant";
};

export async function fetchJoinToken(videollamadaId: string): Promise<JoinPayload> {
  const r = await fetch(`/api/videollamadas/${videollamadaId}/join`, { method: "POST" });
  if (!r.ok) throw new Error("Join failed");
  return await r.json();
}

export function shortName(name: string): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "");
}
