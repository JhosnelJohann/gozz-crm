// ============================================================================================
// WHATSAPP — acciones del chat como en WhatsApp Web (Parte H, punto 3)
//
// Lo que se vigila: responder citando, reaccionar, eliminar para todos (solo propios, 48 h),
// editar (solo texto propio, 15 min), "escribiendo…", fijar conversaciones arriba, buscar dentro
// del chat y en la bandeja por texto de mensajes. El envío real a WhatsApp lo hace el worker vía
// pg_notify('whatsapp_accion'); aquí se prueba la capa de servicio con la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import * as service from "../src/modules/whatsapp/whatsapp.service.js";
import * as repo from "../src/modules/whatsapp/whatsapp.repository.js";
import { FakeWhatsAppProvider } from "../src/modules/whatsapp/providers/fake.provider.js";
import { usuarioDePruebas } from "./fixtures.js";
import { verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;
const digitos = () => String((Date.now() * 5 + ++contador * 7919) % 10_000_000).padStart(7, "6");

beforeAll(async () => {
  await query(`INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
     VALUES ('apertura','Apertura','#5C6670',1,false,false,true) ON CONFLICT (key) DO NOTHING`);
});

async function chat() {
  const userId = await usuarioDePruebas();
  const cx = await service.crearConexion(`Conexión ${sufijo()}`, userId);
  const jid = `5847${digitos()}@s.whatsapp.net`;
  const waIn = `WA-in-${sufijo()}`;
  await service.registrarMensajeEntrante(cx.id, { jid, waMessageId: waIn, tipo: "texto", contenido: "¿Cuánto cuesta el Plan Dominar?", timestamp: new Date() } as any);
  const conv = (await repo.getConversacionPorJid(cx.id, jid))!;
  return { userId, cx, jid, conv, waIn };
}

/** Un saliente ya confirmado por WhatsApp (con wa_message_id), con la antigüedad que se pida. */
async function salienteConfirmado(conversacionId: string, userId: string, texto = "Te mando el precio", minutosAtras = 0) {
  const m = await service.enviarMensaje(conversacionId, userId, { tipo: "texto", contenido: texto });
  await service.registrarConfirmacionEnvio(m.id, `WA-out-${sufijo()}`);
  if (minutosAtras) await query("UPDATE gozz.whatsapp_mensajes SET created_at = NOW() - ($2 || ' minutes')::interval WHERE id = $1", [m.id, String(minutosAtras)]);
  return (await repo.getMensaje(m.id))!;
}

describe("Responder citando", () => {
  it("guarda el id y el extracto del mensaje citado", async () => {
    const { userId, conv, waIn } = await chat();
    const m = await service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "Son 1.200 USD", respuestaA: waIn });
    expect(m.respuesta_a).toBe(waIn);
    expect(m.respuesta_preview).toBe("¿Cuánto cuesta el Plan Dominar?");
  });

  it("rechaza citar un mensaje que no es de esta conversación", async () => {
    const { userId, conv } = await chat();
    await expect(service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "x", respuestaA: "NO-EXISTE" })).rejects.toThrow(/citado no existe/);
  });
});

describe("Reaccionar", () => {
  it("la reacción propia se guarda como 'yo' y se puede quitar", async () => {
    const { conv } = await chat();
    const [entrante] = await repo.listMensajes(conv.id);
    expect((await service.reaccionar(entrante.id, "🔥"))?.reacciones).toEqual({ yo: "🔥" });
    expect((await service.reaccionar(entrante.id, ""))?.reacciones).toEqual({});
  });

  it("no se puede reaccionar a un mensaje que todavía no llegó a WhatsApp", async () => {
    const { userId, conv } = await chat();
    const pendiente = await service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "aún saliendo" });
    await expect(service.reaccionar(pendiente.id, "👍")).rejects.toThrow(/todavía no llegó/);
  });
});

describe("Eliminar para todos y editar", () => {
  it("elimina un mensaje propio reciente; no uno del contacto ni uno de hace más de 48 h", async () => {
    const { userId, conv } = await chat();
    const propio = await salienteConfirmado(conv.id, userId);
    expect((await service.eliminarParaTodos(propio.id))?.eliminado_at).toBeTruthy();

    const [entrante] = await repo.listMensajes(conv.id);
    await expect(service.eliminarParaTodos(entrante.id)).rejects.toThrow(/enviados por ti/);

    const viejo = await salienteConfirmado(conv.id, userId, "viejo", 49 * 60);
    await expect(service.eliminarParaTodos(viejo.id)).rejects.toThrow(/48 horas/);
  });

  it("edita un texto propio de menos de 15 minutos; rechaza fuera de plazo", async () => {
    const { userId, conv } = await chat();
    const propio = await salienteConfirmado(conv.id, userId, "Son 1.300 USD");
    const editado = await service.editarMensaje(propio.id, "Son 1.200 USD");
    expect(editado?.contenido).toBe("Son 1.200 USD");
    expect(editado?.editado_at).toBeTruthy();

    const viejo = await salienteConfirmado(conv.id, userId, "viejo", 20);
    await expect(service.editarMensaje(viejo.id, "otro")).rejects.toThrow(/15 minutos/);
  });
});

describe("Fijar y buscar", () => {
  it("una conversación fijada queda arriba aunque tenga mensajes más viejos", async () => {
    const userId = await usuarioDePruebas();
    const cx = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const vieja = `5848${digitos()}@s.whatsapp.net`, nueva = `5849${digitos()}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(cx.id, { jid: vieja, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "viejo", timestamp: new Date(Date.now() - 86_400_000) } as any);
    await service.registrarMensajeEntrante(cx.id, { jid: nueva, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "nuevo", timestamp: new Date() } as any);
    const cv = (await repo.getConversacionPorJid(cx.id, vieja))!;
    expect((await service.listarConversaciones(cx.id, {}))[0].wa_jid).toBe(nueva);
    await service.fijar(cv.id, true);
    expect((await service.listarConversaciones(cx.id, {}))[0].wa_jid).toBe(vieja);
  });

  it("busca dentro del chat y la bandeja encuentra conversaciones por el texto de sus mensajes", async () => {
    const { cx, conv } = await chat();
    const r = await service.buscarMensajes(conv.id, "plan dominar");
    expect(r).toHaveLength(1);
    const lista = await service.listarConversaciones(cx.id, { q: "Plan Dominar" });
    expect(lista.map((c) => c.id)).toContain(conv.id);
  });
});

describe("Presencia ('escribiendo…') — doble de pruebas", () => {
  it("el proveedor de pruebas registra la acción y emite la presencia del contacto", async () => {
    const p = new FakeWhatsAppProvider();
    const vistos: string[] = [];
    p.onPresencia((_c, _j, estado) => vistos.push(estado));
    await p.accion("cx", { tipo: "presencia", jid: "1@s.whatsapp.net", estado: "composing" });
    p.simulatePresencia("cx", "1@s.whatsapp.net", "composing");
    expect(p.acciones).toHaveLength(1);
    expect(vistos).toEqual(["composing"]);
  });
});
