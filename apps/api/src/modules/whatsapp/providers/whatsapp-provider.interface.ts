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
  /** Id de WhatsApp YA asignado (y guardado en BD) antes de enviar — ver `generarIdMensaje`. */
  waMessageId?: string | null;
  /** Responder citando otro mensaje. */
  citado?: { id: string; fromMe: boolean; participant?: string | null; texto: string } | null;
}

/** Clave de un mensaje ya enviado/recibido, para reaccionar, eliminar o editar. */
export interface WhatsAppClaveMensaje { id: string; fromMe: boolean; participant?: string | null }

/** Acciones sobre WhatsApp que no son "enviar un mensaje nuevo". */
export type WhatsAppAccion =
  | { tipo: "reaccion"; jid: string; clave: WhatsAppClaveMensaje; emoji: string }
  | { tipo: "eliminar"; jid: string; clave: WhatsAppClaveMensaje }
  | { tipo: "editar"; jid: string; clave: WhatsAppClaveMensaje; contenido: string }
  | { tipo: "presencia"; jid: string; estado: "composing" | "recording" | "paused" }
  | { tipo: "suscribir_presencia"; jid: string };

export type WhatsAppPresencia = "composing" | "recording" | "paused" | "available" | "unavailable";

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
  archivoTamanio?: number | null;
  esGrupo?: boolean;
  /** Grupos: quién escribió (jid del participante), su nombre y su número real si se conoce. */
  autorJid?: string | null;
  autorNombre?: string | null;
  autorJidReal?: string | null;
  /** Respuesta citando otro mensaje: id de WhatsApp del citado y un extracto. */
  respuestaA?: string | null;
  respuestaPreview?: string | null;
  /** Mensaje serializado para bajar la media más tarde (ver `descargarMedia`). */
  mediaMeta?: string | null;
  /** Importado del historial al vincular: no cuenta como no leído ni notifica. */
  historico?: boolean;
}

/** Reacción, borrado o edición de un mensaje que ya existe. */
export type WhatsAppMensajeModificado =
  | { jid: string; tipo: "reaccion"; objetivoId: string; emoji: string; autor: string }
  | { jid: string; tipo: "borrado"; objetivoId: string; autor: string }
  | { jid: string; tipo: "edicion"; objetivoId: string; contenido: string; autor: string };

/** Un chat tal como lo informa WhatsApp (historial al vincular, o cambio de nombre de un grupo). */
export interface WhatsAppChatInfo {
  jid: string;
  nombre?: string | null;
  esGrupo: boolean;
  noLeidos?: number;
  archivado?: boolean;
  jidReal?: string | null;
}

export interface WhatsAppMediaDescargada {
  archivoUrl: string;
  archivoNombre: string;
  archivoTipo: string;
  archivoTamanio: number;
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
  /** Genera el id nativo de WhatsApp de un mensaje ANTES de enviarlo. Se guarda en BD primero para
   * que (1) el eco `fromMe` que WhatsApp emite del propio envío caiga en la idempotencia por
   * `wa_message_id` en vez de duplicar el mensaje, y (2) un acuse de "entregado" que llegue antes
   * de que `sendMessage` resuelva encuentre su mensaje en vez de perderse. */
  generarIdMensaje(conexionId: string): string;
  onQr(cb: (conexionId: string, qr: string) => void): void;
  onConnectionUpdate(cb: (conexionId: string, update: WhatsAppConnectionUpdate) => void): void;
  onMessage(cb: (conexionId: string, msg: WhatsAppIncomingMessage) => void | Promise<void>): void;
  onMensajeModificado(cb: (conexionId: string, mod: WhatsAppMensajeModificado) => void): void;
  onChats(cb: (conexionId: string, chats: WhatsAppChatInfo[], opts: { historial: boolean }) => void | Promise<void>): void;
  /** Baja la media de un mensaje que se guardó sin archivo (historial o descarga fallida). */
  descargarMedia(conexionId: string, mediaMeta: string): Promise<WhatsAppMediaDescargada>;
  /** Reaccionar, eliminar para todos, editar, "escribiendo…" y suscribirse a la presencia. */
  accion(conexionId: string, a: WhatsAppAccion): Promise<void>;
  /** "Escribiendo…", "grabando audio…", "en línea" del contacto (o de un participante en grupos). */
  onPresencia(cb: (conexionId: string, jid: string, estado: WhatsAppPresencia, participante: string | null) => void): void;
  /** Confirmaciones de entrega/lectura de WhatsApp para un mensaje YA enviado, identificado por su
   * `waMessageId` — la única forma de que el doble-check gris y el azul de "leído" avancen. */
  onMessageStatusUpdate(cb: (conexionId: string, waMessageId: string, estado: WhatsAppMensajeEstado) => void): void;
  /** Resolver la foto de perfil bajo demanda (al abrir/listar una conversación que todavía no la
   * tiene) — la resolución automática solo ocurre cuando llega o sale un mensaje nuevo, así que
   * una conversación vieja sin actividad reciente se quedaría sin foto para siempre sin esto. */
  resolverFotoPerfil(conexionId: string, jid: string, forzar?: boolean): Promise<string | null>;
  /** Avisa a WhatsApp que estos mensajes entrantes ya se leyeron (checks azules del lado del
   * contacto), igual que WhatsApp Web al abrir el chat. */
  marcarLeidos(conexionId: string, jid: string, waMessageIds: string[]): Promise<void>;
  /** WhatsApp sincroniza su directorio de contactos (nombre guardado en el teléfono, y a veces el
   * número real detrás de un `@lid`) de forma asíncrona, no bajo pedido — puede llegar mucho
   * después de que una conversación ya existe. Esto avisa cuando eso pasa, para poder corregir una
   * conversación que se creó con un nombre o número peor (p.ej. sin dato, o el del propio dueño de
   * la conexión si el primer mensaje del hilo lo mandó él desde el teléfono). */
  onContactoResuelto(cb: (conexionId: string, jid: string, info: { jidReal?: string | null; nombre?: string | null }) => void): void;
}
