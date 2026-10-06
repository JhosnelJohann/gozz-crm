// ============================================================================================
// N8N DE NIVEL PRODUCCIÓN — `src/modules/automatizaciones/n8n-webhooks.ts` + acciones de n8n
//
// Lo que se vigila:
//   · todo aviso a n8n va FIRMADO (HMAC-SHA256 con timestamp) y la firma se puede verificar del
//     otro lado; una firma alterada, de otro secreto o vieja se rechaza;
//   · si n8n falla (5xx, caído), el aviso NO se pierde: queda pendiente, se reintenta con espera
//     creciente y, tras el último intento, queda "fallido" con el motivo;
//   · los eventos genéricos solo llegan a los agentes suscritos, activos y con webhook;
//   · el aviso de una regla conserva su forma original (compatibilidad) y suma el contexto;
//   · las acciones de n8n (etapa por key, etiqueta por nombre, asignar/soltar, contexto)
//     reutilizan el servicio de WhatsApp y disparan sus propios eventos.
//
// 🔴 Todo sintético, en la base desechable. El "n8n" es un servidor HTTP local de la prueba.
// ============================================================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { query } from "../src/shared/db.js";
import * as n8n from "../src/modules/automatizaciones/n8n-webhooks.js";
import * as service from "../src/modules/automatizaciones/automatizaciones.service.js";
import * as repo from "../src/modules/automatizaciones/automatizaciones.repository.js";
import { registerAutomatizacionesRoutes } from "../src/modules/automatizaciones/automatizaciones.routes.js";
import * as whatsappService from "../src/modules/whatsapp/whatsapp.service.js";
import * as whatsappRepo from "../src/modules/whatsapp/whatsapp.repository.js";
import { usuarioDePruebas } from "./fixtures.js";
import { verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

// ---- "n8n" falso: registra cada llamada y responde lo que la prueba le pida ----
interface Llamada { headers: http.IncomingHttpHeaders; body: string; json: any }
let llamadas: Llamada[] = [];
let respuestas: number[] = []; // códigos a devolver en orden; vacío = 200
let server: http.Server;
let base = "";

beforeAll(async () => {
  await query(
    `INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
     VALUES ('apertura','Apertura','#5C6670',1,false,false,true),
            ('activa','Conversación activa','#2196C9',2,false,false,true),
            ('oferta','Oferta presentada','#33359D',3,false,false,true)
     ON CONFLICT (key) DO NOTHING`
  );
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      llamadas.push({ headers: req.headers, body, json: body ? JSON.parse(body) : null });
      res.statusCode = respuestas.shift() ?? 200;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Registra los listeners de etapa/asignación igual que lo hace el proceso de la API.
  registerAutomatizacionesRoutes({ get() {}, post() {}, patch() {}, delete() {} } as any);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function reiniciarN8n(codigos: number[] = []) { llamadas = []; respuestas = [...codigos]; }

async function conversacion() {
  const userId = await usuarioDePruebas();
  const conexion = await whatsappService.crearConexion(`Conexión ${sufijo()}`, userId);
  const jid = `13052${String(Date.now() * 3 + ++contador).slice(-6)}@s.whatsapp.net`; // central 2xx: siempre un número válido de EE.UU.
  await whatsappService.registrarMensajeEntrante(conexion.id, { jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola, quiero info", timestamp: new Date() } as any);
  return (await whatsappRepo.getConversacionPorJid(conexion.id, jid))!;
}

async function agente(eventos: string[] = [], url: string | null = `${base}/webhook/${sufijo()}`) {
  return repo.crearAgenteIA(`Agente ${sufijo()}`, `agente-${sufijo()}@pruebas.invalid`, url, eventos);
}

describe("n8n — firma HMAC", () => {
  it("firma y verifica; rechaza cuerpo alterado, otro secreto y firma vieja", () => {
    const body = JSON.stringify({ hola: "mundo" });
    const firma = n8n.firmar(body);
    expect(firma).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(n8n.verificarFirma(body, firma)).toBe(true);
    expect(n8n.verificarFirma(body + " ", firma)).toBe(false);
    expect(n8n.verificarFirma(body, n8n.firmar(body, undefined, "otro-secreto"))).toBe(false);
    const vieja = n8n.firmar(body, Math.floor(Date.now() / 1000) - 3600);
    expect(n8n.verificarFirma(body, vieja)).toBe(false);
  });
});

describe("n8n — cola de entregas con reintentos", () => {
  it("entrega al instante, firmado y con los headers de evento y entrega", async () => {
    reiniciarN8n();
    const c = await conversacion();
    const a = await agente();
    const e = await n8n.encolar(a.id, a.n8n_webhook_url!, "mensaje.recibido", { conversacion_id: c.id });
    expect(e?.estado).toBe("entregado");
    expect(llamadas).toHaveLength(1);
    const ll = llamadas[0];
    expect(ll.headers["x-gozz-event"]).toBe("mensaje.recibido");
    expect(ll.headers["x-gozz-delivery"]).toBe(e!.id);
    expect(n8n.verificarFirma(ll.body, String(ll.headers["x-gozz-signature"]))).toBe(true);
    expect(ll.json.evento).toBe("mensaje.recibido");
    expect(ll.json.conversacion_id).toBe(c.id);
  });

  it("🔴 si n8n falla, el aviso NO se pierde: queda pendiente con espera y el reintento lo entrega", async () => {
    reiniciarN8n([503]);
    const a = await agente();
    const e = await n8n.encolar(a.id, a.n8n_webhook_url!, "mensaje.recibido", { x: 1 });
    expect(e?.estado).toBe("pendiente");
    expect(e?.intentos).toBe(1);
    expect(e?.ultimo_status).toBe(503);
    const fila = (await query<any>("SELECT proximo_intento_at FROM gozz.webhook_entregas WHERE id = $1", [e!.id]))[0];
    const espera = new Date(fila.proximo_intento_at).getTime() - Date.now();
    expect(espera).toBeGreaterThan(50_000); // primer reintento a ~1 min
    expect(espera).toBeLessThan(70_000);

    // El cron no lo toca antes de tiempo…
    await n8n.procesarPendientes();
    expect(llamadas).toHaveLength(1);
    // …y cuando vence, lo entrega.
    await query("UPDATE gozz.webhook_entregas SET proximo_intento_at = NOW() - interval '1 second' WHERE id = $1", [e!.id]);
    await n8n.procesarPendientes();
    const final = (await query<any>("SELECT estado, intentos FROM gozz.webhook_entregas WHERE id = $1", [e!.id]))[0];
    expect(final).toEqual({ estado: "entregado", intentos: 2 });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].headers["x-gozz-delivery"]).toBe(e!.id); // mismo id: n8n puede deduplicar
  });

  it("tras 4 intentos fallidos queda 'fallido' con el motivo (n8n caído = error de red)", async () => {
    const a = await agente([], "http://127.0.0.1:1/no-hay-nadie");
    const e = await n8n.encolar(a.id, a.n8n_webhook_url!, "mensaje.recibido", {});
    for (let i = 0; i < 3; i++) {
      await query("UPDATE gozz.webhook_entregas SET proximo_intento_at = NOW() - interval '1 second' WHERE id = $1", [e!.id]);
      await n8n.procesarPendientes();
    }
    const final = (await query<any>("SELECT estado, intentos, ultimo_error FROM gozz.webhook_entregas WHERE id = $1", [e!.id]))[0];
    expect(final.estado).toBe("fallido");
    expect(final.intentos).toBe(4);
    expect(final.ultimo_error).toBeTruthy();
    // Y la tarjeta del agente lo muestra.
    const listado = (await repo.listAgentesIA()).find((x) => x.id === a.id)!;
    expect(listado.ultima_entrega?.estado).toBe("fallido");
  });
});

describe("n8n — eventos por suscripción", () => {
  it("solo los agentes suscritos, activos y con webhook reciben el evento, con el contexto completo", async () => {
    reiniciarN8n();
    const c = await conversacion();
    const suscrito = await agente(["mensaje.recibido"]);
    const otroEvento = await agente(["conversacion.etapa"]); // suscrito a OTRO evento
    const inactivo = await agente(["mensaje.recibido"]);
    await repo.actualizarAgenteIA(inactivo.id, { activo: false });
    const sinWebhook = await agente(["mensaje.recibido"], null);

    await n8n.emitir("mensaje.recibido", c.id, { mensaje: { contenido: "Hola" } });
    // La base es compartida con el resto de la suite: puede haber otros agentes suscritos de
    // pruebas anteriores. Lo que importa es qué recibieron LOS DE ESTA PRUEBA.
    const recibio = (id: string) => llamadas.filter((l) => l.json.agente_id === id).length;
    expect(recibio(suscrito.id)).toBe(1);
    expect(recibio(otroEvento.id)).toBe(0);
    expect(recibio(inactivo.id)).toBe(0);
    expect(recibio(sinWebhook.id)).toBe(0);
    const p = llamadas.find((l) => l.json.agente_id === suscrito.id)!.json;
    expect(p.conversacion.id).toBe(c.id);
    expect(p.conversacion.telefono).toMatch(/^\+1305\d{7}$/); // E.164
    expect(p.conversacion.etapa.key).toBe("apertura");
    expect(Array.isArray(p.ultimos_mensajes)).toBe(true);
    expect(p.ultimos_mensajes[0].contenido).toBe("Hola, quiero info");
    expect(p.mensaje.contenido).toBe("Hola");
  });

  it("cambiar la etapa o la asignación dispara conversacion.etapa / conversacion.asignada", async () => {
    reiniciarN8n();
    const c = await conversacion();
    // La base es compartida: otros agentes suscritos (de pruebas anteriores) también reciben —
    // se mira solo lo que le llegó a ESTE agente, de ESTA conversación.
    const a = await agente(["conversacion.etapa", "conversacion.asignada"]);
    const mias = () => llamadas.filter((l) => l.json.agente_id === a.id && l.json.conversacion?.id === c.id);
    const esperarMias = async (n: number) => { for (let i = 0; i < 100 && mias().length < n; i++) await new Promise((r) => setTimeout(r, 20)); };
    const etapas = await whatsappRepo.listEtapas();
    await whatsappService.cambiarEtapa(c.id, etapas.find((e) => e.key === "oferta")!.id);
    await esperarMias(1);
    expect(mias()[0].json.evento).toBe("conversacion.etapa");
    expect(mias()[0].json.conversacion.etapa.key).toBe("oferta");

    const humano = await usuarioDePruebas();
    await whatsappService.asignar(c.id, humano);
    await esperarMias(2);
    expect(mias()[1].json.evento).toBe("conversacion.asignada");
    expect(mias()[1].json.asignado_a).toBe(humano);
  });

  it("el aviso de una regla va por la cola firmada y conserva su forma original (compatibilidad)", async () => {
    reiniciarN8n();
    const c = await conversacion();
    const a = await agente();
    // Etapa + etiqueta única: la regla más específica posible, para que no gane otra regla de
    // pruebas anteriores que solo mire la etapa.
    const tag = await whatsappService.crearTag(`Regla ${sufijo()}`, "#5750E8");
    await whatsappService.agregarTag(c.id, tag.id);
    await service.crearRegla({ nombre: `Regla ${sufijo()}`, etapaId: c.etapa_id, tagId: tag.id, agenteId: a.id, asignarConversacion: false });
    await service.evaluarReglasParaMensaje(c.id, { direccion: "entrante", contenido: "precio?", tipo: "texto" });
    const deLaRegla = llamadas.find((l) => l.json.evento === "regla.disparada" && l.json.agente_id === a.id)!;
    expect(deLaRegla).toBeTruthy();
    expect(deLaRegla.json.conversacion_id).toBe(c.id);
    expect(deLaRegla.json.mensaje).toEqual({ tipo: "texto", contenido: "precio?" });
    expect(deLaRegla.json.conversacion.id).toBe(c.id);
    expect(n8n.verificarFirma(deLaRegla.body, String(deLaRegla.headers["x-gozz-signature"]))).toBe(true);
  });
});

describe("n8n — grupos", () => {
  it("🔴 una regla nunca hace que la IA responda dentro de un grupo", async () => {
    reiniciarN8n();
    const userId = await usuarioDePruebas();
    const conexion = await whatsappService.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `1203639${String(Date.now()).slice(-7)}@g.us`;
    await whatsappService.registrarMensajeEntrante(conexion.id, { jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola grupo", timestamp: new Date() } as any);
    const c = (await whatsappRepo.getConversacionPorJid(conexion.id, jid))!;
    const a = await agente();
    const tag = await whatsappService.crearTag(`Grupo ${sufijo()}`, "#5750E8");
    await whatsappService.agregarTag(c.id, tag.id);
    await service.crearRegla({ nombre: `Regla ${sufijo()}`, etapaId: c.etapa_id, tagId: tag.id, agenteId: a.id, asignarConversacion: true });
    await service.evaluarReglasParaMensaje(c.id, { direccion: "entrante", contenido: "precio?", tipo: "texto" });
    expect(llamadas.filter((l) => l.json.agente_id === a.id)).toHaveLength(0);
    expect((await whatsappRepo.getConversacion(c.id))?.asignado_a).not.toBe(a.id);
  });
});

describe("n8n — acciones sobre la conversación", () => {
  it("cambia la etapa por key; una key que no existe es un error claro", async () => {
    const c = await conversacion();
    const actualizada = await service.n8nCambiarEtapa(c.id, { key: "activa" });
    const etapas = await whatsappRepo.listEtapas();
    expect(actualizada.etapa_id).toBe(etapas.find((e) => e.key === "activa")!.id);
    await expect(service.n8nCambiarEtapa(c.id, { key: "no-existe" })).rejects.toThrow(/Etapa no encontrada/);
  });

  it("etiqueta por nombre, la crea si se pide, y la quita", async () => {
    const c = await conversacion();
    const nombre = `Interesado ${sufijo()}`;
    await expect(service.n8nEtiquetar(c.id, { nombre, accion: "agregar" })).rejects.toThrow(/Etiqueta no encontrada/);
    const tags = await service.n8nEtiquetar(c.id, { nombre: nombre.toUpperCase(), accion: "agregar", crear: true });
    expect(tags.map((t) => t.nombre)).toContain(nombre.toUpperCase());
    const despues = await service.n8nEtiquetar(c.id, { nombre, accion: "quitar" });
    expect(despues).toHaveLength(0);
  });

  it("asigna a un humano y 'pasa a humano' soltando la conversación (null)", async () => {
    const c = await conversacion();
    const humano = await usuarioDePruebas();
    expect((await service.n8nAsignar(c.id, humano)).asignado_a).toBe(humano);
    expect((await service.n8nAsignar(c.id, null)).asignado_a).toBeNull();
    await expect(service.n8nAsignar(c.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/Usuario no encontrado/);
  });

  it("responde con media: el mensaje sale como adjunto en nombre del agente", async () => {
    const c = await conversacion();
    const a = await agente();
    const m = await service.recibirRespuestaAgente(c.id, a.id, "Te mando el folleto", {
      tipo: "archivo", archivoUrl: "/uploads/whatsapp/n8n/x/folleto.pdf", archivoNombre: "folleto.pdf", archivoTamanio: 1234,
    });
    expect(m.tipo).toBe("archivo");
    expect(m.archivo_nombre).toBe("folleto.pdf");
    expect(m.enviado_por).toBe(a.id);
    expect(m.estado_entrega).toBe("pendiente");
    await expect(service.recibirRespuestaAgente(c.id, a.id, "   ")).rejects.toThrow(/vacío/);
  });

  it("el contexto de una conversación inexistente es null (la ruta responde 404)", async () => {
    expect(await service.n8nContexto("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
