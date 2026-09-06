// Costura para poder enchufar la API oficial de Meta Cloud más adelante sin rehacer el resto
// del módulo. Ninguna parte fuera de este directorio (ni whatsapp.service.ts, ni las rutas, ni
// las pruebas) debe importar `@whiskeysockets/baileys` directamente — solo `baileys.provider.ts`
// y `whatsapp-connection-manager.ts` lo hacen. Así `vitest run` nunca abre una conexión real.
import type { WhatsAppConexionEstado, WhatsAppMensajeTipo } from "@gozz/shared-types";

export interface WhatsAppOutgoingMessage {
  jid: string;
  tipo: WhatsAppMensajeTipo;
  contenido?: string | null;
  archivoUrl?: string | null;
  archivoNombre?: string | null;
}

export interface WhatsAppIncomingMessage {
  jid: string;
  waMessageId: string;
  tipo: WhatsAppMensajeTipo;
  contenido?: string | null;
  archivoUrl?: string | null;
  archivoNombre?: string | null;
  archivoTipo?: string | null;
  timestamp: Date;
  nombrePerfil?: string | null;
  /** true si lo envió el número conectado (desde el teléfono físico, fuera de GOZZ) — no es un
   * mensaje del lead/cliente. Whaticket y WhatsApp Web tratan esto como parte normal del hilo. */
  fromMe?: boolean;
}

export interface WhatsAppConnectionUpdate {
  estado: WhatsAppConexionEstado;
  telefono?: string | null;
  motivoError?: string | null;
}

export interface WhatsAppProvider {
  connect(conexionId: string): Promise<void>;
  disconnect(conexionId: string): Promise<void>;
  sendMessage(conexionId: string, msg: WhatsAppOutgoingMessage): Promise<{ waMessageId: string }>;
  onQr(cb: (conexionId: string, qr: string) => void): void;
  onConnectionUpdate(cb: (conexionId: string, update: WhatsAppConnectionUpdate) => void): void;
  onMessage(cb: (conexionId: string, msg: WhatsAppIncomingMessage) => void): void;
}
