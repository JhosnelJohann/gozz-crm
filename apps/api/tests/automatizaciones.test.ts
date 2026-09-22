// ============================================================================================
// AUTOMATIZACIONES — `src/modules/automatizaciones/*` (Fase 2 del rediseño de WhatsApp)
//
// Lo que se vigila:
//   · un agente de IA es una fila real de gozz.users (es_agente_ia=true) que nunca puede iniciar
//     sesión, y su n8n_webhook_url se puede limpiar a null explícitamente sin confundirse con
//     "no lo mandaron" (mismo bug que ya se cuidó en whatsapp.repository.ts#actualizarAgenteIA);
//   · una regla exige al menos una condición (etapa o etiqueta) y un agente de IA de verdad;
//   · al llegar un mensaje ENTRANTE que calza con una regla, se asigna el agente y se avisa a su
//     webhook de n8n con el secreto compartido — un mensaje SALIENTE nunca la reevalúa;
//   · el webhook entrante de n8n reutiliza el mismo `enviarMensaje` de cualquier agente humano;
//   · los recordatorios respetan su canal (WhatsApp necesita conversación; correo necesita
//     contacto + buzón), no se programan en el pasado, y el cron los procesa de forma terminal
//     (un fallo se marca con error, nunca se reintenta solo).
//
// 🔴 Todo sintético, en la base desechable `crm_test_fusion`. Nunca toca WhatsApp real ni SMTP
// real: el mensaje "saliente" de WhatsApp solo se INSERTA en 'pendiente' (el envío real lo hace
// el worker, que aquí no corre), y el buzón de los recordatorios de correo se usa siempre
// desactivado a propósito, para probar el camino de error sin necesitar SMTP de verdad.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import http from "node:http";

import { query } from "../src/shared/db.js";
import * as service from "../src/modules/automatizaciones/automatizaciones.service.js";
import * as repo from "../src/modules/automatizaciones/automatizaciones.repository.js";
import * as whatsappService from "../src/modules/whatsapp/whatsapp.service.js";
import * as whatsappRepo from "../src/modules/whatsapp/whatsapp.repository.js";
import { usuarioDePruebas } from "./fixtures.js";
import { verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

// Mismo seed que whatsapp.test.ts (ver ese archivo para el porqué) — `ON CONFLICT DO NOTHING`
// hace que da igual cuál de los dos archivos corra primero dentro de la misma base desechable.
beforeAll(async () => {
  await query(
    `INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
     VALUES
       ('apertura','Apertura','#5C6670',1,false,false,true),
       ('activa','Conversación activa','#2196C9',2,false,false,true)
     ON CONFLICT (key) DO NOTHING`
  );
});

async function crearAgenteDePrueba(webhookUrl: string | null = null) {
  return repo.crearAgenteIA(`Agente ${sufijo()}`, `agente-${sufijo()}@pruebas.invalid`, webhookUrl);
}

async function crearConversacionDePrueba(userId: string) {
  const conexion = await whatsappService.crearConexion(`Conexión ${sufijo()}`, userId);
  const jid = `5219${sufijo().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}@s.whatsapp.net`;
  await whatsappService.registrarMensajeEntrante(conexion.id, {
    jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
  } as any);
  return (await whatsappRepo.getConversacionPorJid(conexion.id, jid))!;
}

describe("Automatizaciones — agentes de IA", () => {
  it("crea un agente de IA como fila de gozz.users, sin poder iniciar sesión", async () => {
    const agente = await crearAgenteDePrueba("https://n8n.example.invalid/webhook/abc");
    expect(agente.n8n_webhook_url).toBe("https://n8n.example.invalid/webhook/abc");
    const fila = await query<any>("SELECT es_agente_ia, password_hash, nivel_acceso FROM gozz.users WHERE id = $1", [agente.id]);
    expect(fila[0].es_agente_ia).toBe(true);
    expect(fila[0].nivel_acceso).toBe("usuario");
    expect(fila[0].password_hash).not.toBe("no-es-un-hash"); // no reutiliza el hash falso de los fixtures
  });

  it("actualizarAgenteIA puede limpiar el webhook a null explícitamente, sin confundirlo con 'no lo mandaron'", async () => {
    const agente = await crearAgenteDePrueba("https://n8n.example.invalid/webhook/x");
    const limpiado = await service.actualizarAgenteIA(agente.id, { n8nWebhookUrl: null });
    expect(limpiado.n8n_webhook_url).toBeNull();

    const sinTocarlo = await service.actualizarAgenteIA(agente.id, { nombre: "Renombrado" });
    expect(sinTocarlo.n8n_webhook_url).toBeNull();
    expect(sinTocarlo.nombre).toBe("Renombrado");
  });

  it("rechaza actualizar un agente que no existe", async () => {
    await expect(service.actualizarAgenteIA("00000000-0000-0000-0000-000000000000", { nombre: "x" })).rejects.toThrow(/no encontrado/);
  });
});

describe("Automatizaciones — reglas", () => {
  it("rechaza asignar la regla a un usuario que no es agente de IA", async () => {
    const userId = await usuarioDePruebas();
    await expect(
      service.crearRegla({ nombre: "Regla", etapaId: null, tagId: "00000000-0000-0000-0000-000000000000", agenteId: userId, asignarConversacion: true })
    ).rejects.toThrow(/agente de IA/);
  });

  it("rechaza una regla sin ninguna condición (ni etapa ni etiqueta)", async () => {
    const agente = await crearAgenteDePrueba();
    await expect(
      service.crearRegla({ nombre: "Regla", etapaId: null, tagId: null, agenteId: agente.id, asignarConversacion: true })
    ).rejects.toThrow(/condición/);
  });

  it("busca la regla más específica cuando hay varias que podrían aplicar", async () => {
    const agenteGeneral = await crearAgenteDePrueba();
    const agenteEspecifico = await crearAgenteDePrueba();
    const etapa = (await whatsappService.listarEtapas()).find((e) => e.key === "activa")!;
    const tag = await whatsappService.crearTag(`VIP ${sufijo()}`, "#43A847");

    await service.crearRegla({ nombre: "Por etapa", etapaId: etapa.id, tagId: null, agenteId: agenteGeneral.id, asignarConversacion: true });
    await service.crearRegla({ nombre: "Por etapa y etiqueta", etapaId: etapa.id, tagId: tag.id, agenteId: agenteEspecifico.id, asignarConversacion: true });

    const encontrada = await repo.buscarReglaParaConversacion(etapa.id, [tag.id]);
    expect(encontrada?.agente_id).toBe(agenteEspecifico.id);
  });
});

describe("Automatizaciones — evaluación de reglas al llegar un mensaje", () => {
  it("asigna la conversación al agente cuando el mensaje entrante calza con la regla", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    const agente = await crearAgenteDePrueba();
    // Etiqueta propia de este test — todas las conversaciones del archivo caen en la misma primera
    // etapa ("apertura"), así que una regla solo-por-etapa competiría por especificidad con las de
    // otros tests en esa misma etapa. El tag exclusivo evita cualquier choque entre tests.
    const tag = await whatsappService.crearTag(`Asignar ${sufijo()}`, "#2196C9");
    await whatsappService.agregarTag(conv.id, tag.id);
    await service.crearRegla({ nombre: `Regla ${sufijo()}`, etapaId: conv.etapa_id, tagId: tag.id, agenteId: agente.id, asignarConversacion: true });

    await service.evaluarReglasParaMensaje(conv.id, { direccion: "entrante", contenido: "Hola", tipo: "texto" });

    const actualizada = await whatsappRepo.getConversacion(conv.id);
    expect(actualizada?.asignado_a).toBe(agente.id);
  });

  it("no reacciona a mensajes salientes (no se re-dispara con la respuesta del propio agente)", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    const agente = await crearAgenteDePrueba();
    await service.crearRegla({ nombre: `Regla ${sufijo()}`, etapaId: conv.etapa_id, tagId: null, agenteId: agente.id, asignarConversacion: true });

    await service.evaluarReglasParaMensaje(conv.id, { direccion: "saliente", contenido: "Hola", tipo: "texto" });

    const actualizada = await whatsappRepo.getConversacion(conv.id);
    expect(actualizada?.asignado_a).toBeNull();
  });

  it("avisa al webhook de n8n del agente con el secreto compartido y el payload correcto", async () => {
    const recibido: any[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        recibido.push({ headers: req.headers, body: JSON.parse(body || "{}") });
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      const userId = await usuarioDePruebas();
      const conv = await crearConversacionDePrueba(userId);
      const agente = await crearAgenteDePrueba(`http://127.0.0.1:${port}/webhook`);
      // Etiqueta propia de este test, además de la etapa: como todas las conversaciones de este
      // archivo caen en la misma primera etapa ("apertura"), una regla que solo pidiera esa etapa
      // empataría en especificidad con las que ya crearon los tests anteriores (y, a igual
      // especificidad, gana la más vieja) — el tag exclusivo de este test hace la regla más
      // específica que cualquier otra y evita ese choque.
      const tag = await whatsappService.crearTag(`Webhook ${sufijo()}`, "#5750E8");
      await whatsappService.agregarTag(conv.id, tag.id);
      await service.crearRegla({ nombre: `Regla ${sufijo()}`, etapaId: conv.etapa_id, tagId: tag.id, agenteId: agente.id, asignarConversacion: false });

      await service.evaluarReglasParaMensaje(conv.id, { direccion: "entrante", contenido: "Necesito ayuda", tipo: "texto" });

      expect(recibido).toHaveLength(1);
      expect(recibido[0].headers["x-gozz-secret"]).toBe("secreto-de-pruebas"); // fijado en vitest.config.ts
      expect(recibido[0].body.conversacion_id).toBe(conv.id);
      expect(recibido[0].body.agente_id).toBe(agente.id);
      expect(recibido[0].body.mensaje.contenido).toBe("Necesito ayuda");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Automatizaciones — respuesta del agente (webhook entrante de n8n)", () => {
  it("recibirRespuestaAgente envía el mensaje EN NOMBRE del agente, reutilizando enviarMensaje", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    const agente = await crearAgenteDePrueba();

    const mensaje = await service.recibirRespuestaAgente(conv.id, agente.id, "Respuesta automática");

    expect(mensaje.direccion).toBe("saliente");
    expect(mensaje.enviado_por).toBe(agente.id);
    const mensajes = await whatsappRepo.listMensajes(conv.id);
    expect(mensajes.some((m) => m.contenido === "Respuesta automática" && m.enviado_por === agente.id)).toBe(true);
  });

  it("rechaza responder en nombre de un agente desactivado", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    const agente = await crearAgenteDePrueba();
    await service.actualizarAgenteIA(agente.id, { activo: false });

    await expect(service.recibirRespuestaAgente(conv.id, agente.id, "x")).rejects.toThrow(/desactivado/);
  });

  it("rechaza un agente_id que no existe o no es agente de IA", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    await expect(service.recibirRespuestaAgente(conv.id, userId, "x")).rejects.toThrow(/no encontrado/);
  });
});

describe("Automatizaciones — recordatorios", () => {
  it("valida los campos requeridos según el canal", async () => {
    const userId = await usuarioDePruebas();
    await expect(service.crearRecordatorio({
      canal: "whatsapp", conversacionId: null, contactoId: null, buzonId: null,
      asunto: null, mensaje: "Hola", programadoPara: new Date(Date.now() + 60_000).toISOString(), creadoPor: userId,
    })).rejects.toThrow(/conversación/);

    await expect(service.crearRecordatorio({
      canal: "email", conversacionId: null, contactoId: null, buzonId: null,
      asunto: "Asunto", mensaje: "Hola", programadoPara: new Date(Date.now() + 60_000).toISOString(), creadoPor: userId,
    })).rejects.toThrow(/contacto o el buzón/);
  });

  it("rechaza una fecha programada en el pasado", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    await expect(service.crearRecordatorio({
      canal: "whatsapp", conversacionId: conv.id, contactoId: null, buzonId: null,
      asunto: null, mensaje: "Hola", programadoPara: new Date(Date.now() - 60_000).toISOString(), creadoPor: userId,
    })).rejects.toThrow(/futuro/);
  });

  it("el cron envía un recordatorio de WhatsApp vencido y lo marca enviado", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    const creado = await service.crearRecordatorio({
      canal: "whatsapp", conversacionId: conv.id, contactoId: null, buzonId: null,
      asunto: null, mensaje: "No olvides tu cita", programadoPara: new Date(Date.now() + 60_000).toISOString(), creadoPor: userId,
    });
    // crearRecordatorio ya probó que no se puede programar en el pasado; lo que se prueba aquí es
    // el barrido del cron, así que se fuerza el vencimiento directo en la base.
    await query("UPDATE gozz.whatsapp_recordatorios SET programado_para = NOW() - interval '1 minute' WHERE id = $1", [creado.id]);

    await service.procesarRecordatoriosPendientes();

    const fila = (await query<any>("SELECT enviado_at, error FROM gozz.whatsapp_recordatorios WHERE id = $1", [creado.id]))[0];
    expect(fila.enviado_at).not.toBeNull();
    expect(fila.error).toBeNull();
    const mensajes = await whatsappRepo.listMensajes(conv.id);
    expect(mensajes.some((m) => m.contenido === "No olvides tu cita")).toBe(true);
  });

  it("un recordatorio de correo a un buzón desactivado queda con error, de forma terminal (no se reintenta solo)", async () => {
    const userId = await usuarioDePruebas();
    const contacto = await query<any>(
      `INSERT INTO gozz.contactos_cache (nombre_completo, email) VALUES ($1, $2) RETURNING id`,
      [`Contacto ${sufijo()}`, `contacto-${sufijo()}@pruebas.invalid`]
    );
    const buzon = await query<any>(
      `INSERT INTO gozz.buzones_email (owner_user_id, email, imap_host, imap_user, smtp_host, activo)
       VALUES ($1, $2, 'imap.invalid', $2, 'smtp.invalid', false) RETURNING id`,
      [userId, `buzon-desactivado-${sufijo()}@pruebas.invalid`]
    );
    const creado = await service.crearRecordatorio({
      canal: "email", conversacionId: null, contactoId: contacto[0].id, buzonId: buzon[0].id,
      asunto: "Asunto", mensaje: "Hola", programadoPara: new Date(Date.now() + 60_000).toISOString(), creadoPor: userId,
    });
    await query("UPDATE gozz.whatsapp_recordatorios SET programado_para = NOW() - interval '1 minute' WHERE id = $1", [creado.id]);

    await service.procesarRecordatoriosPendientes();

    const fila = (await query<any>("SELECT enviado_at, error FROM gozz.whatsapp_recordatorios WHERE id = $1", [creado.id]))[0];
    expect(fila.enviado_at).not.toBeNull();
    expect(fila.error).toMatch(/desvinculado/);
  });

  it("cancelarRecordatorio borra uno pendiente pero no uno ya enviado o inexistente", async () => {
    const userId = await usuarioDePruebas();
    const conv = await crearConversacionDePrueba(userId);
    const creado = await service.crearRecordatorio({
      canal: "whatsapp", conversacionId: conv.id, contactoId: null, buzonId: null,
      asunto: null, mensaje: "x", programadoPara: new Date(Date.now() + 3_600_000).toISOString(), creadoPor: userId,
    });
    await service.cancelarRecordatorio(creado.id);
    const fila = await query<any>("SELECT id FROM gozz.whatsapp_recordatorios WHERE id = $1", [creado.id]);
    expect(fila).toHaveLength(0);

    await expect(service.cancelarRecordatorio("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/ya se envió|no existe/);
  });
});
