// src/push.ts — Web Push (VAPID) para el GOZZ CRM.
// Envia notificaciones push del navegador (chat, llamadas, tareas).
import webpush from "web-push";
import { query } from "./shared/db.js";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:soporte@tuimpulsolatino.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  kind?: "chat" | "llamada" | "tarea" | "general";
  renotify?: boolean;
  requireInteraction?: boolean;
  grupoId?: string;
}

export async function saveSubscription(userId: string, sub: any, userAgent?: string) {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error("subscription invalida");
  await query(
    `INSERT INTO gozz.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4, user_agent=$5, last_used_at=NOW()`,
    [userId, endpoint, p256dh, auth, userAgent || null]
  );
}

export async function removeSubscription(endpoint: string) {
  await query("DELETE FROM gozz.push_subscriptions WHERE endpoint=$1", [endpoint]);
}

// Envia push a TODOS los dispositivos de un usuario. Borra las suscripciones muertas (404/410).
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  if (!userId) return;
  const subs = await query<any>(
    "SELECT id, endpoint, p256dh, auth FROM gozz.push_subscriptions WHERE user_id=$1",
    [userId]
  );
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 6 * 60 * 60 }
        );
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await query("DELETE FROM gozz.push_subscriptions WHERE id=$1", [s.id]).catch(() => {});
        }
      }
    })
  );
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  const uniq = Array.from(new Set((userIds || []).filter(Boolean)));
  await Promise.all(uniq.map((id) => sendPushToUser(id, payload)));
}
