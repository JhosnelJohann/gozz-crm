// Doble de pruebas: nunca toca WhatsApp real. Además de implementar la interfaz, expone métodos
// `simulate*` para que las pruebas disparen eventos (QR, conexión, mensaje entrante) a voluntad,
// sin timers ni asincronía oculta.
import { randomUUID } from "crypto";
import type { WhatsAppMensajeEstado } from "@gozz/shared-types";
import type {
  WhatsAppProvider,
  WhatsAppOutgoingMessage,
  WhatsAppIncomingMessage,
  WhatsAppConnectionUpdate,
} from "./whatsapp-provider.interface.js";

export class FakeWhatsAppProvider implements WhatsAppProvider {
  private qrCbs: ((conexionId: string, qr: string) => void)[] = [];
  private stateCbs: ((conexionId: string, update: WhatsAppConnectionUpdate) => void)[] = [];
  private msgCbs: ((conexionId: string, msg: WhatsAppIncomingMessage) => void)[] = [];
  private statusCbs: ((conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void)[] = [];
  public sent: { conexionId: string; msg: WhatsAppOutgoingMessage }[] = [];
  private connected = new Set<string>();
  public fotosPerfil = new Map<string, string | null>();

  async connect(conexionId: string): Promise<void> {
    this.stateCbs.forEach((cb) => cb(conexionId, { estado: "conectando" }));
  }

  async disconnect(conexionId: string): Promise<void> {
    this.connected.delete(conexionId);
    this.stateCbs.forEach((cb) => cb(conexionId, { estado: "desconectado" }));
  }

  async sendMessage(conexionId: string, msg: WhatsAppOutgoingMessage): Promise<{ waMessageId: string }> {
    this.sent.push({ conexionId, msg });
    return { waMessageId: `fake-${randomUUID()}` };
  }

  onQr(cb: (conexionId: string, qr: string) => void): void {
    this.qrCbs.push(cb);
  }
  onConnectionUpdate(cb: (conexionId: string, update: WhatsAppConnectionUpdate) => void): void {
    this.stateCbs.push(cb);
  }
  onMessage(cb: (conexionId: string, msg: WhatsAppIncomingMessage) => void): void {
    this.msgCbs.push(cb);
  }
  onMessageStatusUpdate(cb: (conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void): void {
    this.statusCbs.push(cb);
  }
  async resolverFotoPerfil(_conexionId: string, jid: string): Promise<string | null> {
    return this.fotosPerfil.get(jid) ?? null;
  }

  // ---- Solo para pruebas / smoke manual local ----
  simulateQr(conexionId: string, qr = "fake-qr-payload"): void {
    this.qrCbs.forEach((cb) => cb(conexionId, qr));
  }
  simulateConnected(conexionId: string, telefono = "+10000000000"): void {
    this.connected.add(conexionId);
    this.stateCbs.forEach((cb) => cb(conexionId, { estado: "conectado", telefono }));
  }
  simulateError(conexionId: string, motivoError: string): void {
    this.stateCbs.forEach((cb) => cb(conexionId, { estado: "error", motivoError }));
  }
  simulateIncomingMessage(conexionId: string, msg: WhatsAppIncomingMessage): void {
    this.msgCbs.forEach((cb) => cb(conexionId, msg));
  }
  simulateStatusUpdate(conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado): void {
    this.statusCbs.forEach((cb) => cb(conexionId, waMessageId, estado));
  }
}
