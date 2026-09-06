// ============================================================================================
// BANDEJA COMPARTIDA DE WHATSAPP — `src/modules/whatsapp/*`
//
// Corre enteramente contra `providers/fake.provider.ts`: en ningún momento se importa
// `@whiskeysockets/baileys` desde este archivo ni desde whatsapp.service.ts (ver el propio
// service, que solo recibe objetos planos). Lo que se vigila:
//   · idempotencia de mensajes por wa_message_id (reintento del proveedor no duplica);
//   · vinculación automática a un contacto existente por teléfono;
//   · "Convertir a Oportunidad" exige contacto vinculado y reutiliza oportunidadesService.crear();
//   · CRUD de etapas propias (no las de Oportunidades) y de tags con su join.
//
// 🔴 Todo sintético, en la base desechable `crm_test_fusion`.
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

// El dump `--schema-only` que arma la base desechable (ver tests/setup/global-setup.ts) copia
// LAS TABLAS, no las filas del seed (0006_whatsapp_inbox_seed_pipeline_stages.sql es una
// migración de DATOS). Se siembra aquí, una vez para todo el archivo, con el mismo contenido
// que esa migración — a diferencia de `pipeline_stages` en otros tests, este catálogo no varía
// por caso (es_ganado/campos_obligatorios), así que no hace falta una etapa dedicada por test.
beforeAll(async () => {
  await query(
    `INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
     VALUES
       ('apertura','Apertura','#5C6670',1,false,false,true),
       ('activa','Conversación activa','#2196C9',2,false,false,true),
       ('oferta','Oferta presentada','#33359D',3,false,false,true),
       ('decision','Tomando decisión','#FFB51C',4,false,false,true),
       ('ganado','Cliente ganado','#43A847',5,true,true,true),
       ('perdido','Perdido','#E53935',6,true,false,true)
     ON CONFLICT (key) DO NOTHING`
  );
});

async function crearContactoConTelefono(telefono: string): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache (nombre_completo, telefono) VALUES ($1, $2) RETURNING id`,
    [`Contacto WhatsApp ${sufijo()}`, telefono]
  );
  return r[0].id;
}

describe("WhatsApp — mensajes entrantes", () => {
  it("no duplica un mensaje reintentado con el mismo wa_message_id (idempotencia)", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `521555${sufijo().replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}@s.whatsapp.net`;
    const waMessageId = `WA-${sufijo()}`;

    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId, tipo: "texto", contenido: "Hola (reintento del proveedor)", timestamp: new Date(),
    } as any);

    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv).toBeTruthy();
    const mensajes = await repo.listMensajes(conv!.id);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].contenido).toBe("Hola");
  });

  it("crea la conversación en la primera etapa activa y vincula el contacto automáticamente por teléfono", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const digitos = sufijo().replace(/\D/g, "").padEnd(10, "7").slice(0, 10);
    const contactoId = await crearContactoConTelefono(`+1${digitos}`);
    const jid = `1${digitos}@s.whatsapp.net`;

    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola, quiero info", timestamp: new Date(), nombrePerfil: "Lead de prueba",
    } as any);

    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.contacto_id).toBe(contactoId);
    expect(conv?.contacto_vinculo_estado).toBe("vinculado_auto");

    const etapas = await service.listarEtapas();
    expect(conv?.etapa_id).toBe(etapas[0].id);
  });

  it("un eco fromMe de un envío propio no duplica el mensaje saliente ya registrado", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52177${sufijo().replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}@s.whatsapp.net`;

    // Primer mensaje entrante crea la conversación.
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-in-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);

    // Un mensaje SALIENTE enviado desde GOZZ (simulando lo que hace enviarMensaje + confirmación).
    const mensaje = await service.enviarMensaje(conv!.id, userId, { tipo: "texto", contenido: "Hola, ¿en qué te ayudo?" });
    await service.registrarConfirmacionEnvio(mensaje.id, "WA-out-1");

    // Baileys reporta el mismo mensaje vía messages.upsert con fromMe:true (eco normal del socket).
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: "WA-out-1", tipo: "texto", contenido: "Hola, ¿en qué te ayudo?", timestamp: new Date(), fromMe: true,
    } as any);

    const mensajes = await repo.listMensajes(conv!.id);
    const salientes = mensajes.filter((m) => m.wa_message_id === "WA-out-1");
    expect(salientes).toHaveLength(1);
  });
});

describe("WhatsApp — convertir a Oportunidad", () => {
  it("rechaza convertir una conversación sin contacto vinculado", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52188${sufijo().replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);

    await expect(
      service.convertirAOportunidad(conv!.id, userId, { nombreCaso: "Caso de prueba" })
    ).rejects.toThrow(/vinculada a un contacto/);
  });

  it("convierte una conversación vinculada reutilizando oportunidadesService.crear()", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const digitos = sufijo().replace(/\D/g, "").padEnd(10, "3").slice(0, 10);
    const contactoId = await crearContactoConTelefono(`+1${digitos}`);
    const jid = `1${digitos}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Quiero contratar", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.contacto_id).toBe(contactoId);

    const oportunidad = await service.convertirAOportunidad(conv!.id, userId, { nombreCaso: "Caso desde WhatsApp" });
    expect(oportunidad.contacto_id).toBe(contactoId);

    const convActualizada = await repo.getConversacion(conv!.id);
    expect(convActualizada?.oportunidad_id).toBe(oportunidad.id);
  });
});

describe("WhatsApp — etapas y tags", () => {
  it("lista las 6 etapas propias sembradas, independientes del pipeline de Oportunidades", async () => {
    const etapas = await service.listarEtapas();
    expect(etapas.map((e) => e.key)).toEqual(["apertura", "activa", "oferta", "decision", "ganado", "perdido"]);
  });

  it("crea un tag con color y permite asociarlo/desasociarlo de una conversación", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52199${sufijo().replace(/\D/g, "").padEnd(7, "4").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);

    const tag = await service.crearTag(`VIP ${sufijo()}`, "#43A847");
    let tags = await service.agregarTag(conv!.id, tag.id);
    expect(tags.map((t) => t.id)).toContain(tag.id);

    tags = await service.quitarTag(conv!.id, tag.id);
    expect(tags.map((t) => t.id)).not.toContain(tag.id);
  });
});

describe("WhatsApp — FakeWhatsAppProvider (doble de pruebas)", () => {
  it("nunca toca WhatsApp real: sendMessage solo registra en memoria", async () => {
    const provider = new FakeWhatsAppProvider();
    const { waMessageId } = await provider.sendMessage("conexion-1", { jid: "521@s.whatsapp.net", tipo: "texto", contenido: "hola" });
    expect(waMessageId).toMatch(/^fake-/);
    expect(provider.sent).toHaveLength(1);
  });
});
