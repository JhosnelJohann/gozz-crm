// ============================================================================================
// WHATSAPP COMPLETO — `mensaje-parser.ts` + grupos, historial, reacciones, borrados, ediciones
//
// Lo que se vigila:
//   · ningún tipo de mensaje real de WhatsApp termina como burbuja vacía (antes: 28 % de la base);
//   · reacciones, borrados y ediciones MODIFICAN el mensaje original en vez de crear uno vacío;
//   · los grupos tienen su nombre y el autor de cada mensaje;
//   · el historial importado conserva la hora real, no suma "no leídos" ni avisa uno por uno;
//   · un mensaje que se guardó vacío se repara al reimportarse;
//   · la media que no se bajó se puede pedir después.
//
// 🔴 Todo sintético, en la base desechable. Nunca toca WhatsApp real.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import { parsearMensaje, parsearVcard, previewDe, desenvolver } from "../src/modules/whatsapp/mensaje-parser.js";
import * as service from "../src/modules/whatsapp/whatsapp.service.js";
import * as repo from "../src/modules/whatsapp/whatsapp.repository.js";
import { usuarioDePruebas } from "./fixtures.js";
import { verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;
const digitos = () => String((Date.now() * 3 + ++contador * 7919) % 10_000_000).padStart(7, "4");

beforeAll(async () => {
  await query(
    `INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
     VALUES ('apertura','Apertura','#5C6670',1,false,false,true) ON CONFLICT (key) DO NOTHING`
  );
});

describe("Intérprete de mensajes — ningún tipo real queda vacío", () => {
  it("texto simple y texto extendido", () => {
    expect(parsearMensaje({ conversation: "Hola" })).toMatchObject({ kind: "mensaje", tipo: "texto", contenido: "Hola" });
    expect(parsearMensaje({ extendedTextMessage: { text: "Mira esto https://x.y" } })).toMatchObject({ tipo: "texto", contenido: "Mira esto https://x.y" });
  });

  it("desenvuelve temporales, 'ver una vez' y documento con texto", () => {
    expect(parsearMensaje({ ephemeralMessage: { message: { conversation: "temporal" } } })).toMatchObject({ tipo: "texto", contenido: "temporal" });
    expect(parsearMensaje({ viewOnceMessageV2: { message: { imageMessage: { caption: "solo una vez", mimetype: "image/jpeg" } } } })).toMatchObject({ tipo: "imagen", contenido: "solo una vez" });
    expect(parsearMensaje({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "contrato.pdf", caption: "Firmado", mimetype: "application/pdf", fileLength: 2048 } } } }))
      .toMatchObject({ tipo: "archivo", contenido: "Firmado", media: { tipo: "document", nombre: "contrato.pdf", tamanio: 2048 } });
    expect(desenvolver({ ephemeralMessage: { message: { viewOnceMessage: { message: { conversation: "doble" } } } } })).toEqual({ conversation: "doble" });
  });

  it("sticker, nota de voz con duración y video", () => {
    expect(parsearMensaje({ stickerMessage: { mimetype: "image/webp" } })).toMatchObject({ tipo: "sticker", media: { tipo: "sticker" } });
    expect(parsearMensaje({ audioMessage: { seconds: 13, ptt: true, mimetype: "audio/ogg; codecs=opus" } })).toMatchObject({ tipo: "audio", media: { segundos: 13 } });
    expect(parsearMensaje({ videoMessage: { caption: "demo", seconds: 9 } })).toMatchObject({ tipo: "video", contenido: "demo" });
  });

  it("ubicación (fija y en tiempo real) con enlace al mapa", () => {
    const p = parsearMensaje({ locationMessage: { degreesLatitude: 10.07, degreesLongitude: -69.32, name: "Oficina", address: "Barquisimeto" } });
    expect(p).toMatchObject({ tipo: "ubicacion" });
    const u = JSON.parse((p as any).contenido);
    expect(u).toMatchObject({ lat: 10.07, lng: -69.32, nombre: "Oficina", vivo: false });
    expect(u.url).toContain("10.07,-69.32");
    expect(JSON.parse((parsearMensaje({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } }) as any).contenido).vivo).toBe(true);
  });

  it("contacto compartido: nombre y teléfono desde la vCard (con waid)", () => {
    const vcard = "BEGIN:VCARD\nVERSION:3.0\nFN:Ana Pérez\nitem1.TEL;waid=584141234567:+58 414-1234567\nEND:VCARD";
    const p = parsearMensaje({ contactMessage: { displayName: "Ana", vcard } });
    expect(p).toMatchObject({ tipo: "contacto" });
    expect(JSON.parse((p as any).contenido)).toEqual([{ nombre: "Ana", telefonos: ["+584141234567"] }]);
    expect(parsearVcard("FN:Sin Tel\n")).toEqual({ nombre: "Sin Tel", telefonos: [] });
    const varios = parsearMensaje({ contactsArrayMessage: { contacts: [{ displayName: "A", vcard }, { displayName: "B", vcard }] } });
    expect(JSON.parse((varios as any).contenido)).toHaveLength(2);
  });

  it("encuesta con sus opciones", () => {
    const p = parsearMensaje({ pollCreationMessageV3: { name: "¿Qué plan prefieres?", options: [{ optionName: "Crecer" }, { optionName: "Dominar" }] } });
    expect(JSON.parse((p as any).contenido)).toEqual({ pregunta: "¿Qué plan prefieres?", opciones: ["Crecer", "Dominar"] });
  });

  it("respuestas a botones/listas y mensajes de plantilla de empresas se muestran como texto", () => {
    expect(parsearMensaje({ buttonsResponseMessage: { selectedDisplayText: "Sí, me interesa" } })).toMatchObject({ tipo: "texto", contenido: "Sí, me interesa" });
    expect(parsearMensaje({ listResponseMessage: { title: "Plan Dominar" } })).toMatchObject({ contenido: "Plan Dominar" });
    expect(parsearMensaje({ templateMessage: { hydratedTemplate: { hydratedContentText: "Tu código es 1234" } } })).toMatchObject({ contenido: "Tu código es 1234" });
  });

  it("respuesta citando otro mensaje: guarda el id y un extracto del citado", () => {
    const p = parsearMensaje({ extendedTextMessage: { text: "Sí, ese", contextInfo: { stanzaId: "ABC123", quotedMessage: { imageMessage: { caption: "Plan azul" } } } } });
    expect(p).toMatchObject({ tipo: "texto", contenido: "Sí, ese", cita: { id: "ABC123", preview: "📷 Plan azul" } });
  });

  it("reacción, borrado y edición son modificaciones, no mensajes nuevos", () => {
    expect(parsearMensaje({ reactionMessage: { key: { id: "M1" }, text: "❤️" } })).toEqual({ kind: "reaccion", objetivoId: "M1", emoji: "❤️" });
    expect(parsearMensaje({ reactionMessage: { key: { id: "M1" }, text: "" } })).toEqual({ kind: "reaccion", objetivoId: "M1", emoji: "" });
    expect(parsearMensaje({ protocolMessage: { type: 0, key: { id: "M2" } } })).toEqual({ kind: "borrado", objetivoId: "M2" });
    expect(parsearMensaje({ protocolMessage: { type: 14, key: { id: "M3" }, editedMessage: { conversation: "texto corregido" } } })).toEqual({ kind: "edicion", objetivoId: "M3", contenido: "texto corregido" });
  });

  it("la señalización interna se ignora; lo desconocido se explica en vez de quedar vacío", () => {
    expect(parsearMensaje({ senderKeyDistributionMessage: { groupId: "x" }, messageContextInfo: {} })).toEqual({ kind: "ignorar" });
    expect(parsearMensaje({ protocolMessage: { type: 3 } })).toEqual({ kind: "ignorar" });
    expect(parsearMensaje(null)).toEqual({ kind: "ignorar" });
    const raro = parsearMensaje({ unMensajeDelFuturo: { algo: 1 } });
    expect(raro).toMatchObject({ kind: "mensaje", tipo: "sistema" });
    expect((raro as any).contenido).toMatch(/Ábrelo en el teléfono/);
  });

  it("vista previa legible de cada tipo", () => {
    expect(previewDe("sticker", null)).toBe("Sticker");
    expect(previewDe("audio", null)).toBe("🎤 Nota de voz");
    expect(previewDe("archivo", null, { archivoNombre: "cv.pdf" })).toBe("📄 cv.pdf");
    expect(previewDe("ubicacion", JSON.stringify({ nombre: "Oficina" }))).toBe("📍 Oficina");
    expect(previewDe("contacto", JSON.stringify([{ nombre: "Ana" }]))).toBe("👤 Ana");
    expect(previewDe("encuesta", JSON.stringify({ pregunta: "¿Cuál?" }))).toBe("📊 ¿Cuál?");
  });
});

async function conexionNueva() {
  const userId = await usuarioDePruebas();
  return service.crearConexion(`Conexión ${sufijo()}`, userId);
}
const entrante = (o: Record<string, any>) => ({ tipo: "texto", contenido: "Hola", timestamp: new Date(), waMessageId: `WA-${sufijo()}`, ...o }) as any;

describe("Grupos", () => {
  it("🔴 un mensaje de grupo crea la conversación del grupo con su nombre y guarda quién escribió", async () => {
    const cx = await conexionNueva();
    const jid = `1203630${digitos()}@g.us`;
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, esGrupo: true, nombrePerfil: "Fotógrafos Cabudare", autorJid: "584141112233@s.whatsapp.net", autorNombre: "Jair", tipo: "sticker", contenido: null }));
    const conv = await repo.getConversacionPorJid(cx.id, jid);
    expect(conv?.es_grupo).toBe(true);
    expect(conv?.nombre_whatsapp).toBe("Fotógrafos Cabudare");
    expect(conv?.contacto_id).toBeNull();
    expect(conv?.ultimo_mensaje_preview).toBe("Jair: Sticker");
    const [m] = await repo.listMensajes(conv!.id);
    expect(m.autor_nombre).toBe("Jair");
    expect(m.tipo).toBe("sticker");
  });

  it("si el grupo cambia de nombre, se actualiza (en chats individuales el nombre no se pisa)", async () => {
    const cx = await conexionNueva();
    const jid = `1203631${digitos()}@g.us`;
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, esGrupo: true, nombrePerfil: "Nombre viejo" }));
    await service.registrarChats(cx.id, [{ jid, nombre: "Nombre nuevo", esGrupo: true }], { historial: false });
    expect((await repo.getConversacionPorJid(cx.id, jid))?.nombre_whatsapp).toBe("Nombre nuevo");

    const individual = `5841${digitos()}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(cx.id, entrante({ jid: individual, nombrePerfil: "Ana" }));
    await service.registrarChats(cx.id, [{ jid: individual, nombre: "Otro nombre", esGrupo: false }], { historial: false });
    expect((await repo.getConversacionPorJid(cx.id, individual))?.nombre_whatsapp).toBe("Ana");
  });
});

describe("Historial importado", () => {
  it("🔴 conserva la hora real, no suma no leídos y no pisa un último mensaje más nuevo", async () => {
    const cx = await conexionNueva();
    const jid = `5842${digitos()}@s.whatsapp.net`;
    const ayer = new Date(Date.now() - 86_400_000);
    await service.registrarChats(cx.id, [{ jid, nombre: "Cliente viejo", esGrupo: false, noLeidos: 3 }], { historial: true });
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, contenido: "Mensaje de hoy", timestamp: new Date(), historico: true }));
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, contenido: "Mensaje de ayer", timestamp: ayer, historico: true }));
    const conv = await repo.getConversacionPorJid(cx.id, jid);
    expect(conv?.no_leidos_count).toBe(3); // el contador que trae WhatsApp, no +2
    expect(conv?.ultimo_mensaje_preview).toBe("Mensaje de hoy");
    expect(conv?.nombre_whatsapp).toBe("Cliente viejo");
    const ms = await repo.listMensajes(conv!.id);
    expect(ms.map((m) => m.contenido)).toEqual(["Mensaje de ayer", "Mensaje de hoy"]);
    expect(new Date(ms[0].created_at).getTime()).toBe(ayer.getTime());
    expect(ms.every((m) => m.historico)).toBe(true);
  });

  it("🔴 un mensaje guardado vacío (antes del intérprete) se repara al reimportarse, y los vacíos no se listan", async () => {
    const cx = await conexionNueva();
    const jid = `5843${digitos()}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, contenido: "Hola" }));
    const conv = await repo.getConversacionPorJid(cx.id, jid);
    const waId = `WA-vacio-${sufijo()}`;
    await query(`INSERT INTO gozz.whatsapp_mensajes (conversacion_id, wa_message_id, direccion, tipo, estado_entrega) VALUES ($1, $2, 'entrante', 'sistema', 'entregado')`, [conv!.id, waId]);
    expect((await repo.listMensajes(conv!.id)).some((m) => m.wa_message_id === waId)).toBe(false);

    await service.registrarMensajeEntrante(cx.id, entrante({ jid, waMessageId: waId, tipo: "sticker", contenido: null, historico: true }));
    const reparado = (await repo.listMensajes(conv!.id)).find((m) => m.wa_message_id === waId);
    expect(reparado?.tipo).toBe("sticker");
  });

  it("registrarChats crea las conversaciones del teléfono aunque no tengan mensajes nuevos", async () => {
    const cx = await conexionNueva();
    const a = `5844${digitos()}@s.whatsapp.net`, b = `1203632${digitos()}@g.us`;
    await service.registrarChats(cx.id, [{ jid: a, nombre: "Pedro", esGrupo: false, archivado: true }, { jid: b, nombre: "Equipo", esGrupo: true }], { historial: true });
    expect((await repo.getConversacionPorJid(cx.id, a))?.archivado).toBe(true);
    expect((await repo.getConversacionPorJid(cx.id, b))?.es_grupo).toBe(true);
  });
});

describe("Reacciones, borrados y ediciones", () => {
  async function conMensaje() {
    const cx = await conexionNueva();
    const jid = `5845${digitos()}@s.whatsapp.net`;
    const waId = `WA-orig-${sufijo()}`;
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, waMessageId: waId, contenido: "Precio final 100" }));
    const conv = await repo.getConversacionPorJid(cx.id, jid);
    return { cx, jid, waId, conv: conv! };
  }

  it("una reacción se agrega al mensaje y se quita con emoji vacío; no crea mensajes", async () => {
    const { cx, jid, waId, conv } = await conMensaje();
    await service.registrarModificacion(cx.id, { jid, tipo: "reaccion", objetivoId: waId, emoji: "🔥", autor: jid });
    await service.registrarModificacion(cx.id, { jid, tipo: "reaccion", objetivoId: waId, emoji: "👍", autor: "yo" });
    let [m] = await repo.listMensajes(conv.id);
    expect(m.reacciones).toEqual({ [jid]: "🔥", yo: "👍" });
    await service.registrarModificacion(cx.id, { jid, tipo: "reaccion", objetivoId: waId, emoji: "", autor: jid });
    const lista = await repo.listMensajes(conv.id);
    expect(lista).toHaveLength(1);
    expect(lista[0].reacciones).toEqual({ yo: "👍" });
  });

  it("un borrado marca el mensaje como eliminado y conserva el original para el equipo", async () => {
    const { cx, jid, waId, conv } = await conMensaje();
    await service.registrarModificacion(cx.id, { jid, tipo: "borrado", objetivoId: waId, autor: jid });
    const [m] = await repo.listMensajes(conv.id);
    expect(m.eliminado_at).toBeTruthy();
    expect(m.contenido).toBe("Precio final 100");
  });

  it("una edición cambia el texto y lo marca como editado", async () => {
    const { cx, jid, waId, conv } = await conMensaje();
    await service.registrarModificacion(cx.id, { jid, tipo: "edicion", objetivoId: waId, contenido: "Precio final 90", autor: jid });
    const [m] = await repo.listMensajes(conv.id);
    expect(m.contenido).toBe("Precio final 90");
    expect(m.editado_at).toBeTruthy();
  });

  it("modificar un mensaje que no tenemos no revienta", async () => {
    const cx = await conexionNueva();
    await expect(service.registrarModificacion(cx.id, { jid: "x@s.whatsapp.net", tipo: "borrado", objetivoId: "NO-EXISTE", autor: "x" })).resolves.toBeUndefined();
  });
});

describe("Media diferida", () => {
  it("un mensaje con media sin archivo queda 'pendiente'; al descargarse se completa y deja de estarlo", async () => {
    const cx = await conexionNueva();
    const jid = `5846${digitos()}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(cx.id, entrante({ jid, tipo: "imagen", contenido: null, mediaMeta: JSON.stringify({ key: { id: "x" }, message: { imageMessage: {} } }), historico: true }));
    const conv = await repo.getConversacionPorJid(cx.id, jid);
    const [m] = await repo.listMensajes(conv!.id);
    expect(m.media_pendiente).toBe(true);
    expect((m as any).media_meta).toBeUndefined(); // nunca sale hacia la API

    await service.registrarMediaDescargada(m.id, { archivoUrl: "/uploads/whatsapp/entrantes/x/foto.jpg", archivoNombre: "foto.jpg", archivoTipo: "image/jpeg", archivoTamanio: 999 });
    const listo = await repo.getMensaje(m.id);
    expect(listo?.archivo_url).toBe("/uploads/whatsapp/entrantes/x/foto.jpg");
    expect(listo?.media_pendiente).toBe(false);
  });
});
