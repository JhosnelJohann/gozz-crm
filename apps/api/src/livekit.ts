import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const API_KEY = process.env.LIVEKIT_API_KEY || "";
const API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LK_URL = process.env.LIVEKIT_URL || "";
const LK_HOST = process.env.LIVEKIT_HOST_URL || "http://localhost:7880";

if (!API_KEY || !API_SECRET) {
  console.warn("[livekit] Missing LIVEKIT_API_KEY/LIVEKIT_API_SECRET");
}

export const lkUrl = LK_URL;

export async function mintToken(opts: {
  roomName: string;
  identity: string;
  name: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  metadata?: Record<string, any>;
}): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: opts.identity,
    name: opts.name,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
    ttl: "6h"
  });
  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: opts.canPublish !== false,
    canSubscribe: opts.canSubscribe !== false,
    canPublishData: opts.canPublishData !== false
  });
  return await at.toJwt();
}

const roomService = new RoomServiceClient(LK_HOST, API_KEY, API_SECRET);

export async function deleteRoom(roomName: string): Promise<void> {
  try {
    await roomService.deleteRoom(roomName);
  } catch (e) {
    console.warn("[livekit] deleteRoom failed for " + roomName);
  }
}

export async function listParticipants(roomName: string) {
  try {
    return await roomService.listParticipants(roomName);
  } catch {
    return [];
  }
}
