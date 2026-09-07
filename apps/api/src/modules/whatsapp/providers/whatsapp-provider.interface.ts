// Costura para poder enchufar la API oficial de Meta Cloud más adelante sin rehacer el resto
// del módulo. Ninguna parte fuera de este directorio (ni whatsapp.service.ts, ni las rutas, ni
// las pruebas) debe importar `@whiskeysockets/baileys` directamente — solo `baileys.provider.ts`
// y `whatsapp-connection-manager.ts` lo hacen. Así `vitest run` nunca abre una conexión real.
import type { WhatsAppConexionEstado, WhatsAppMensajeEstado, WhatsAppMensajeTipo } from "@gozz/shared-types";

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
  /** URL pública de la foto de perfil de WhatsApp, cuando se pudo resolver (privacidad permite y
   * no hubo error de red) — null si no se pudo, undefined si ni se intentó. */
  fotoPerfilUrl?: string | null;
  /** El número real (`...@s.whatsapp.net`) detrás de un `jid` que llegó como `@lid`, cuando el
   * directorio de contactos de WhatsApp ya lo reveló — null/undefined si `jid` ya es un número
   * real o si WhatsApp todavía no lo comparte. */
  jidReal?: string | null;
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
  /** Confirmaciones de entrega/lectura de WhatsApp para un mensaje YA enviado, identificado por su
   * `waMessageId` — la única forma de que el doble-check gris y el azul de "leído" avancen. */
  onMessageStatusUpdate(cb: (conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void): void;
  /** Resolver la foto de perfil bajo demanda (al abrir/listar una conversación que todavía no la
   * tiene) — la resolución automática solo ocurre cuando llega o sale un mensaje nuevo, así que
   * una conversación vieja sin actividad reciente se quedaría sin foto para siempre sin esto. */
  resolverFotoPerfil(conexionId: string, jid: string): Promise<string | null>;
  /** WhatsApp sincroniza su directorio de contactos (nombre guardado en el teléfono, y a veces el
   * número real detrás de un `@lid`) de forma asíncrona, no bajo pedido — puede llegar mucho
   * después de que una conversación ya existe. Esto avisa cuando eso pasa, para poder corregir una
   * conversación que se creó con un nombre o número peor (p.ej. sin dato, o el del propio dueño de
   * la conexión si el primer mensaje del hilo lo mandó él desde el teléfono). */
  onContactoResuelto(cb: (conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }) => void): void;
}
