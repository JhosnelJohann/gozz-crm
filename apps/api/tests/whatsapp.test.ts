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
/** 7 dígitos distintos por llamada (para armar números de teléfono válidos y únicos). */
const siete = () => String((Date.now() * 7 + ++contador * 7919) % 10_000_000).padStart(7, "3");

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
    // Número de EE.UU. VÁLIDO (área 305, central que empieza en 2-9): la vinculación ahora compara
    // E.164 exacto con libphonenumber, y unos dígitos al azar no siempre forman un número válido.
    const digitos = `3052${siete().slice(0, 6)}`;
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

  it("🔴 si el primer mensaje del hilo es fromMe, su nombrePerfil (el del dueño de la conexión) NO nombra la conversación", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52178${sufijo().replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}@s.whatsapp.net`;

    // El vendedor le escribió primero desde su teléfono, fuera de GOZZ — Baileys sincroniza ese
    // mensaje como fromMe, con pushName = el nombre de la CUENTA CONECTADA, no el del contacto.
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-out-${sufijo()}`, tipo: "texto", contenido: "Hola, te escribo por tu pedido",
      timestamp: new Date(), fromMe: true, nombrePerfil: "Jhosnel",
    } as any);

    let conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.nombre_whatsapp).toBeNull();

    // Cuando el contacto responde de verdad (fromMe: false), su nombre sí se completa.
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-in-${sufijo()}`, tipo: "texto", contenido: "Hola, sí, quiero el azul",
      timestamp: new Date(), fromMe: false, nombrePerfil: "Cliente Real",
    } as any);

    conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.nombre_whatsapp).toBe("Cliente Real");
  });
});

describe("WhatsApp — ticks de entrega y leído", () => {
  it("progresa de enviado a entregado y a leído", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52133${sufijo().replace(/\D/g, "").padEnd(7, "3").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-in-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    const mensaje = await service.enviarMensaje(conv!.id, userId, { tipo: "texto", contenido: "Hola!" });
    await service.registrarConfirmacionEnvio(mensaje.id, "WA-ticks-1");
    expect((await repo.getMensaje(mensaje.id))?.estado_entrega).toBe("enviado");

    await service.registrarActualizacionEntrega("WA-ticks-1", "entregado");
    expect((await repo.getMensaje(mensaje.id))?.estado_entrega).toBe("entregado");

    await service.registrarActualizacionEntrega("WA-ticks-1", "leido");
    expect((await repo.getMensaje(mensaje.id))?.estado_entrega).toBe("leido");
  });

  it("no retrocede: un 'entregado' tardío no pisa un 'leído' ya registrado", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52144${sufijo().replace(/\D/g, "").padEnd(7, "4").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-in-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    const mensaje = await service.enviarMensaje(conv!.id, userId, { tipo: "texto", contenido: "Hola!" });
    await service.registrarConfirmacionEnvio(mensaje.id, "WA-ticks-2");

    await service.registrarActualizacionEntrega("WA-ticks-2", "leido");
    await service.registrarActualizacionEntrega("WA-ticks-2", "entregado");
    expect((await repo.getMensaje(mensaje.id))?.estado_entrega).toBe("leido");
  });

  it("un wa_message_id desconocido no revienta (mensaje de otra conexión o que nunca se guardó)", async () => {
    await expect(service.registrarActualizacionEntrega("WA-no-existe-jamas", "leido")).resolves.toBeUndefined();
  });
});

describe("WhatsApp — foto de perfil", () => {
  it("guarda la foto de perfil al crear la conversación", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52155${sufijo().replace(/\D/g, "").padEnd(7, "5").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
      fotoPerfilUrl: "https://pps.whatsapp.net/foto.jpg",
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.foto_perfil_url).toBe("https://pps.whatsapp.net/foto.jpg");
  });

  it("si el primer mensaje no trajo foto, un mensaje posterior sí la completa", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52166${sufijo().replace(/\D/g, "").padEnd(7, "6").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    let conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.foto_perfil_url).toBeNull();

    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Otro mensaje", timestamp: new Date(),
      fotoPerfilUrl: "https://pps.whatsapp.net/foto2.jpg",
    } as any);
    conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.foto_perfil_url).toBe("https://pps.whatsapp.net/foto2.jpg");
  });

  it("resuelta bajo demanda (conversación vieja sin actividad reciente), registrarFotoPerfilResuelta la guarda", async () => {
    // Simula lo que hace whatsapp-connection-manager.ts cuando el worker logra resolver la foto
    // de una conversación que existía desde antes sin ella (listar/abrir la disparó).
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52177${sufijo().replace(/\D/g, "").padEnd(7, "7").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.foto_perfil_url).toBeNull();

    await service.registrarFotoPerfilResuelta(conv!.id, "https://pps.whatsapp.net/tardia.jpg");
    const actualizada = await repo.getConversacion(conv!.id);
    expect(actualizada?.foto_perfil_url).toBe("https://pps.whatsapp.net/tardia.jpg");
  });
});

describe("WhatsApp — directorio de contactos (nombre guardado y número real detrás de un @lid)", () => {
  it("registrarContactoResuelto completa el nombre y el número real que faltaban", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const lid = `${sufijo().replace(/\D/g, "").padEnd(15, "9").slice(0, 15)}@lid`;
    // Un @lid nunca trae nombrePerfil de sobra ni jidReal la primera vez — eso es justo lo que
    // este directorio resuelve más tarde, cuando WhatsApp lo comparte.
    await service.registrarMensajeEntrante(conexion.id, {
      jid: lid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    let conv = await repo.getConversacionPorJid(conexion.id, lid);
    expect(conv?.nombre_whatsapp).toBeNull();
    expect(conv?.telefono_real).toBeNull();

    await service.registrarContactoResuelto(conexion.id, lid, { nombre: "Contacto Real", jidReal: "584121000000@s.whatsapp.net" });

    conv = await repo.getConversacionPorJid(conexion.id, lid);
    expect(conv?.nombre_whatsapp).toBe("Contacto Real");
    expect(conv?.telefono_real).toBe("584121000000@s.whatsapp.net");
  });

  it("no pisa un nombre o número que ya se hubieran resuelto antes", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const lid = `${sufijo().replace(/\D/g, "").padEnd(15, "3").slice(0, 15)}@lid`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid: lid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
      nombrePerfil: "Ya Resuelto",
    } as any);

    await service.registrarContactoResuelto(conexion.id, lid, { nombre: "Otro nombre distinto" });

    const conv = await repo.getConversacionPorJid(conexion.id, lid);
    expect(conv?.nombre_whatsapp).toBe("Ya Resuelto");
  });

  it("una conversación que no existe para esa conexión/jid no revienta", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    await expect(
      service.registrarContactoResuelto(conexion.id, "000000000000000@lid", { nombre: "Nadie" })
    ).resolves.toBeUndefined();
  });
});

describe("WhatsApp — visto por el equipo", () => {
  it("marcar leída marca los mensajes entrantes como vistos, pero no los salientes", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52188${sufijo().replace(/\D/g, "").padEnd(7, "8").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    const saliente = await service.enviarMensaje(conv!.id, userId, { tipo: "texto", contenido: "Hola!" });

    let mensajes = await repo.listMensajes(conv!.id);
    expect(mensajes.every((m) => m.visto_at === null)).toBe(true);

    await service.marcarLeida(conv!.id, userId);

    mensajes = await repo.listMensajes(conv!.id);
    const entrante = mensajes.find((m) => m.direccion === "entrante")!;
    const salienteFila = mensajes.find((m) => m.id === saliente.id)!;
    expect(entrante.visto_at).not.toBeNull();
    expect(entrante.visto_por).toBe(userId);
    expect(salienteFila.visto_at).toBeNull(); // "visto" no aplica a lo que GOZZ envía
  });

  it("no pisa un visto_at ya puesto (idempotente al volver a abrir la conversación)", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52199${sufijo().replace(/\D/g, "").padEnd(7, "9").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);

    await service.marcarLeida(conv!.id, userId);
    const primeraVez = (await repo.listMensajes(conv!.id))[0].visto_at;

    // Un segundo usuario de verdad — `usuarioDePruebas()` es un singleton (siempre el mismo id),
    // así que reutilizarlo no probaría nada aquí.
    const otro = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1, 'no-es-un-hash', 'Segundo usuario de prueba', 'usuario') RETURNING id`,
      [`suite-otro-${sufijo()}@pruebas.invalid`]
    );
    await service.marcarLeida(conv!.id, otro[0].id);
    const segundaVez = await repo.listMensajes(conv!.id);
    expect(segundaVez[0].visto_at).toEqual(primeraVez);
    expect(segundaVez[0].visto_por).toBe(userId); // el primero que lo vio, no el segundo
  });
});

describe("WhatsApp — crear contacto desde WhatsApp (email opcional)", () => {
  it("crea el contacto sin email", async () => {
    const contacto = await service.crearContactoDesdeWhatsApp(`Sin email ${sufijo()}`, "+15550002222", null);
    expect(contacto.id).toBeTruthy();
  });

  it("crea el contacto con email cuando se da", async () => {
    const nombre = `Con email ${sufijo()}`;
    const contacto = await service.crearContactoDesdeWhatsApp(nombre, "+15550003333", "prueba@ejemplo.com");
    expect(contacto.nombre_completo).toBe(nombre);
  });
});

describe("WhatsApp — abrir conversación desde un contacto", () => {
  it("crea (o encuentra) la conversación por el teléfono del contacto y la deja vinculada", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const digitos = sufijo().replace(/\D/g, "").padEnd(10, "8").slice(0, 10);
    const contactoId = await crearContactoConTelefono(`+1${digitos}`);

    const { conversacionId } = await service.abrirConversacionConContacto(contactoId, conexion.id);
    const conv = await repo.getConversacion(conversacionId);
    expect(conv?.contacto_id).toBe(contactoId);
    expect(conv?.contacto_vinculo_estado).toBe("vinculado_manual");

    // Repetir la operación (el usuario le da "Contactar por WhatsApp" dos veces) no crea una
    // segunda conversación — es la misma, por el upsert (conexion_id, wa_jid).
    const otraVez = await service.abrirConversacionConContacto(contactoId, conexion.id);
    expect(otraVez.conversacionId).toBe(conversacionId);
  });

  it("rechaza un contacto sin teléfono ni whatsapp guardado", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const r = await query<any>(`INSERT INTO gozz.contactos_cache (nombre_completo) VALUES ($1) RETURNING id`, [`Sin teléfono ${sufijo()}`]);
    await expect(service.abrirConversacionConContacto(r[0].id, conexion.id)).rejects.toThrow(/teléfono/);
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

describe("WhatsApp — asignar, cambiar etapa y archivar", () => {
  it("cambiarEtapa actualiza la etapa de la conversación", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52170${sufijo().replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    const destino = (await service.listarEtapas()).find((e) => e.key === "oferta")!;

    await service.cambiarEtapa(conv!.id, destino.id);

    const actualizada = await repo.getConversacion(conv!.id);
    expect(actualizada?.etapa_id).toBe(destino.id);
  });

  it("asignar cambia el asignado y admite desasignar con null", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52171${sufijo().replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);

    // Un agente distinto del usuario base — `usuarioDePruebas()` es un singleton, así que
    // reutilizarlo no probaría que el id asignado es realmente el que se pidió.
    const agente = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1, 'no-es-un-hash', 'Agente de prueba', 'usuario') RETURNING id`,
      [`suite-agente-${sufijo()}@pruebas.invalid`]
    );
    const agenteId = agente[0].id as string;

    await service.asignar(conv!.id, agenteId);
    let actualizada = await repo.getConversacion(conv!.id);
    expect(actualizada?.asignado_a).toBe(agenteId);

    await service.asignar(conv!.id, null);
    actualizada = await repo.getConversacion(conv!.id);
    expect(actualizada?.asignado_a).toBeNull();
  });

  it("archivar marca y desmarca archivado", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52172${sufijo().replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
    } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);

    await service.archivar(conv!.id, true);
    let actualizada = await repo.getConversacion(conv!.id);
    expect(actualizada?.archivado).toBe(true);

    await service.archivar(conv!.id, false);
    actualizada = await repo.getConversacion(conv!.id);
    expect(actualizada?.archivado).toBe(false);
  });
});

describe("WhatsApp — filtros de listarConversaciones", () => {
  it("filtra por etapaId", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const destino = (await service.listarEtapas()).find((e) => e.key === "decision")!;

    const jidA = `52173${sufijo().replace(/\D/g, "").padEnd(7, "3").slice(0, 7)}@s.whatsapp.net`;
    const jidB = `52174${sufijo().replace(/\D/g, "").padEnd(7, "4").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid: jidA, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "A", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(conexion.id, { jid: jidB, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "B", timestamp: new Date() } as any);
    const convA = await repo.getConversacionPorJid(conexion.id, jidA);
    await service.cambiarEtapa(convA!.id, destino.id);

    const filtradas = await service.listarConversaciones(conexion.id, { etapaId: destino.id });
    expect(filtradas.map((c) => c.id)).toEqual([convA!.id]);
  });

  it("filtra por tagId y trae el tag agregado en el resultado (fix del N+1)", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jidA = `52175${sufijo().replace(/\D/g, "").padEnd(7, "5").slice(0, 7)}@s.whatsapp.net`;
    const jidB = `52176${sufijo().replace(/\D/g, "").padEnd(7, "6").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid: jidA, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "A", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(conexion.id, { jid: jidB, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "B", timestamp: new Date() } as any);
    const convA = await repo.getConversacionPorJid(conexion.id, jidA);

    const tag = await service.crearTag(`Prioridad ${sufijo()}`, "#E53935");
    await service.agregarTag(convA!.id, tag.id);

    const filtradas = await service.listarConversaciones(conexion.id, { tagId: tag.id });
    expect(filtradas.map((c) => c.id)).toEqual([convA!.id]);
    expect(filtradas[0].tags.map((t) => t.id)).toContain(tag.id);
  });

  it("filtra por asignadoId", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jidA = `52177${sufijo().replace(/\D/g, "").padEnd(7, "7").slice(0, 7)}@s.whatsapp.net`;
    const jidB = `52178${sufijo().replace(/\D/g, "").padEnd(7, "8").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid: jidA, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "A", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(conexion.id, { jid: jidB, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "B", timestamp: new Date() } as any);
    const convA = await repo.getConversacionPorJid(conexion.id, jidA);

    const agente = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1, 'no-es-un-hash', 'Agente filtro', 'usuario') RETURNING id`,
      [`suite-agente-filtro-${sufijo()}@pruebas.invalid`]
    );
    await service.asignar(convA!.id, agente[0].id);

    const filtradas = await service.listarConversaciones(conexion.id, { asignadoId: agente[0].id });
    expect(filtradas.map((c) => c.id)).toEqual([convA!.id]);
  });

  it("filtra por búsqueda de texto (q) sobre el nombre de perfil", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52179${sufijo().replace(/\D/g, "").padEnd(7, "9").slice(0, 7)}@s.whatsapp.net`;
    const nombrePerfil = `Cliente Buscable ${sufijo()}`;
    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(), nombrePerfil,
    } as any);

    const filtradas = await service.listarConversaciones(conexion.id, { q: "Buscable" });
    expect(filtradas.map((c) => c.wa_jid)).toContain(jid);
  });

  it("por defecto excluye archivadas, y el filtro archivado:true trae solo esas", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jidA = `52180${sufijo().replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}@s.whatsapp.net`;
    const jidB = `52181${sufijo().replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid: jidA, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "A", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(conexion.id, { jid: jidB, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "B", timestamp: new Date() } as any);
    const convA = await repo.getConversacionPorJid(conexion.id, jidA);
    await service.archivar(convA!.id, true);

    const activas = await service.listarConversaciones(conexion.id, {});
    expect(activas.map((c) => c.id)).not.toContain(convA!.id);

    const archivadas = await service.listarConversaciones(conexion.id, { archivado: true });
    expect(archivadas.map((c) => c.id)).toEqual([convA!.id]);
  });
});

describe("WhatsApp — contador de no leídos (insignia del menú lateral)", () => {
  it("suma no_leidos_count de las conversaciones con acceso, excluye archivadas, y baja al marcar leída", async () => {
    const agente = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1, 'no-es-un-hash', 'Agente no-leídos', 'usuario') RETURNING id`,
      [`suite-no-leidos-${sufijo()}@pruebas.invalid`]
    );
    const agenteId = agente[0].id as string;
    // Conexión propia de este agente (nadie más la posee ni tiene ACL sobre ella) — así el total
    // que se mida abajo depende solo de lo que este test crea, sin importar qué haya dejado el
    // resto de la suite en la base compartida.
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, agenteId);

    const jidA = `52190${sufijo().replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}@s.whatsapp.net`;
    const jidB = `52191${sufijo().replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid: jidA, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "A1", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(conexion.id, { jid: jidA, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "A2", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(conexion.id, { jid: jidB, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "B1", timestamp: new Date() } as any);

    expect(await service.contarNoLeidos(agenteId, "usuario")).toBe(3);

    const convA = await repo.getConversacionPorJid(conexion.id, jidA);
    await service.marcarLeida(convA!.id, agenteId);
    expect(await service.contarNoLeidos(agenteId, "usuario")).toBe(1); // solo queda el de jidB

    const convB = await repo.getConversacionPorJid(conexion.id, jidB);
    await service.archivar(convB!.id, true);
    expect(await service.contarNoLeidos(agenteId, "usuario")).toBe(0);

    const ajeno = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
       VALUES ($1, 'no-es-un-hash', 'Sin acceso a esta conexión', 'usuario') RETURNING id`,
      [`suite-sin-acceso-${sufijo()}@pruebas.invalid`]
    );
    expect(await service.contarNoLeidos(ajeno[0].id, "usuario")).toBe(0);
  });
});

describe("WhatsApp — FakeWhatsAppProvider (doble de pruebas)", () => {
  it("nunca toca WhatsApp real: sendMessage solo registra en memoria", async () => {
    const provider = new FakeWhatsAppProvider();
    const { waMessageId } = await provider.sendMessage("conexion-1", { jid: "521@s.whatsapp.net", tipo: "texto", contenido: "hola" });
    expect(waMessageId).toMatch(/^fake-/);
    expect(provider.sent).toHaveLength(1);
  });

  it("respeta el id de WhatsApp asignado antes de enviar", async () => {
    const provider = new FakeWhatsAppProvider();
    const id = provider.generarIdMensaje("conexion-1");
    const { waMessageId } = await provider.sendMessage("conexion-1", { jid: "521@s.whatsapp.net", tipo: "texto", contenido: "hola", waMessageId: id });
    expect(waMessageId).toBe(id);
  });
});

async function conversacionNueva(prefijo: string) {
  const userId = await usuarioDePruebas();
  const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
  const jid = `${prefijo}${siete()}@s.whatsapp.net`;
  await service.registrarMensajeEntrante(conexion.id, {
    jid, waMessageId: `WA-in-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date(),
  } as any);
  const conv = await repo.getConversacionPorJid(conexion.id, jid);
  return { userId, conexion, jid, conv: conv! };
}

describe("WhatsApp — carreras del envío (Parte G)", () => {
  it("🔴 un acuse de 'entregado' que llega ANTES de la confirmación de envío no se pierde ni retrocede a 'enviado'", async () => {
    const { userId, conv } = await conversacionNueva("52155");
    const mensaje = await service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "¿Seguimos?" });
    const waId = `WA-race-${sufijo()}`;
    expect(await service.reservarIdEnvio(mensaje.id, waId)).toBe(waId);

    // Orden real posible con Baileys: el DELIVERY_ACK llega antes de que sendMessage resuelva.
    await service.registrarActualizacionEntrega(waId, "entregado");
    expect((await repo.getMensaje(mensaje.id))?.estado_entrega).toBe("entregado");

    await service.registrarConfirmacionEnvio(mensaje.id, waId);
    expect((await repo.getMensaje(mensaje.id))?.estado_entrega).toBe("entregado");
  });

  it("🔴 el eco fromMe del propio envío que llega ANTES de la confirmación no duplica el mensaje ni lo marca fallido", async () => {
    const { userId, conexion, jid, conv } = await conversacionNueva("52166");
    const mensaje = await service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "Te mando la info" });
    const waId = `WA-eco-${sufijo()}`;
    await service.reservarIdEnvio(mensaje.id, waId);

    await service.registrarMensajeEntrante(conexion.id, {
      jid, waMessageId: waId, tipo: "texto", contenido: "Te mando la info", timestamp: new Date(), fromMe: true,
    } as any);
    await service.registrarConfirmacionEnvio(mensaje.id, waId);

    const mensajes = (await repo.listMensajes(conv.id)).filter((m) => m.wa_message_id === waId);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].id).toBe(mensaje.id);
    expect(mensajes[0].estado_entrega).toBe("enviado");
  });

  it("un reintento conserva el id de WhatsApp ya reservado (WhatsApp deduplica, no llega doble)", async () => {
    const { userId, conv } = await conversacionNueva("52167");
    const mensaje = await service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "Reintento" });
    const primero = await service.reservarIdEnvio(mensaje.id, `WA-a-${sufijo()}`);
    const segundo = await service.reservarIdEnvio(mensaje.id, `WA-b-${sufijo()}`);
    expect(segundo).toBe(primero);
  });

  it("un mensaje marcado fallido que en realidad salió pasa a 'enviado' al confirmarse", async () => {
    const { userId, conv } = await conversacionNueva("52168");
    const mensaje = await service.enviarMensaje(conv.id, userId, { tipo: "texto", contenido: "Fallido falso" });
    await service.registrarFalloEnvio(mensaje.id, "timeout");
    await service.registrarConfirmacionEnvio(mensaje.id, `WA-tarde-${sufijo()}`);
    const m = await repo.getMensaje(mensaje.id);
    expect(m?.estado_entrega).toBe("enviado");
    expect(m?.error_envio).toBeNull();
  });
});

describe("WhatsApp — confirmación de lectura hacia WhatsApp (Parte G)", () => {
  it("marcarLeida devuelve los wa_message_id de los entrantes recién vistos (checks azules del contacto), y solo una vez", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const jid = `52199${siete()}@s.whatsapp.net`;
    const ids = [`WA-l1-${sufijo()}`, `WA-l2-${sufijo()}`];
    for (const id of ids) {
      await service.registrarMensajeEntrante(conexion.id, { jid, waMessageId: id, tipo: "texto", contenido: id, timestamp: new Date() } as any);
    }
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    const vistos = await repo.marcarLeida(conv!.id, userId);
    expect([...vistos].sort()).toEqual([...ids].sort());
    expect(await repo.marcarLeida(conv!.id, userId)).toEqual([]);
  });
});

describe("WhatsApp — vinculación por teléfono en E.164 (Parte G)", () => {
  it("🔴 NO vincula un número de Venezuela con un contacto de EE.UU. que comparte los últimos 10 dígitos", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const local = `412${siete()}`; // 412 = área de Pittsburgh en EE.UU. y prefijo móvil en Venezuela
    await crearContactoConTelefono(`+1 ${local}`);
    const jid = `58${local}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date() } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.contacto_id).toBeNull();
    expect(conv?.contacto_vinculo_estado).toBe("sin_vincular");
  });

  it("vincula un contacto guardado SIN código de país, interpretándolo con el país del número de WhatsApp", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const local = `414${siete()}`;
    const contactoId = await crearContactoConTelefono(`0${local.slice(0, 3)}-${local.slice(3)}`);
    const jid = `58${local}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date() } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.contacto_id).toBe(contactoId);
  });

  it("si dos contactos distintos tienen el mismo número, no elige uno al azar", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const local = `3052${siete().slice(0, 6)}`;
    await crearContactoConTelefono(`+1${local}`);
    await crearContactoConTelefono(`(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`);
    const jid = `1${local}@s.whatsapp.net`;
    await service.registrarMensajeEntrante(conexion.id, { jid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date() } as any);
    const conv = await repo.getConversacionPorJid(conexion.id, jid);
    expect(conv?.contacto_id).toBeNull();
  });

  it("🔴 un @lid sin número real NO se compara como teléfono; al revelarse el número real, se vincula", async () => {
    const userId = await usuarioDePruebas();
    const conexion = await service.crearConexion(`Conexión ${sufijo()}`, userId);
    const local = `3053${siete().slice(0, 6)}`;
    const contactoId = await crearContactoConTelefono(`+1${local}`);
    // LID cuyos últimos dígitos coinciden con el contacto — antes esto lo vinculaba por error.
    const lid = `98765${local}@lid`;
    await service.registrarMensajeEntrante(conexion.id, { jid: lid, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date() } as any);
    let conv = await repo.getConversacionPorJid(conexion.id, lid);
    expect(conv?.contacto_id).toBeNull();

    await service.registrarContactoResuelto(conexion.id, lid, { jidReal: `1${local}@s.whatsapp.net` });
    conv = await repo.getConversacionPorJid(conexion.id, lid);
    expect(conv?.contacto_id).toBe(contactoId);
  });
});

describe("WhatsApp — fotos de perfil con caché propia (Parte G)", () => {
  it("fotoNecesitaRefresco: sin resolver, URL vieja del CDN, o más de 7 días → sí; propia y reciente → no", () => {
    const ahora = new Date().toISOString();
    const hace8dias = new Date(Date.now() - 8 * 86400_000).toISOString();
    expect(service.fotoNecesitaRefresco({ foto_perfil_url: null, foto_actualizada_at: null })).toBe(true);
    expect(service.fotoNecesitaRefresco({ foto_perfil_url: "https://pps.whatsapp.net/x.jpg", foto_actualizada_at: ahora })).toBe(true);
    expect(service.fotoNecesitaRefresco({ foto_perfil_url: "/uploads/whatsapp/avatares/a.jpg", foto_actualizada_at: hace8dias })).toBe(true);
    expect(service.fotoNecesitaRefresco({ foto_perfil_url: "/uploads/whatsapp/avatares/a.jpg", foto_actualizada_at: ahora })).toBe(false);
    // Sin foto (privada) pero resuelta hace poco: no se vuelve a pedir en cada carga.
    expect(service.fotoNecesitaRefresco({ foto_perfil_url: null, foto_actualizada_at: ahora })).toBe(false);
  });

  it("una foto nueva del contacto reemplaza la anterior, y 'sin foto' también queda registrado", async () => {
    const { conv } = await conversacionNueva("52188");
    await service.registrarFotoPerfilResuelta(conv.id, "/uploads/whatsapp/avatares/v1.jpg");
    await service.registrarFotoPerfilResuelta(conv.id, "/uploads/whatsapp/avatares/v2.jpg");
    expect((await repo.getConversacion(conv.id))?.foto_perfil_url).toBe("/uploads/whatsapp/avatares/v2.jpg");

    await service.registrarFotoPerfilResuelta(conv.id, null);
    const final = await repo.getConversacion(conv.id);
    expect(final?.foto_perfil_url).toBeNull();
    expect(final?.foto_actualizada_at).toBeTruthy();
  });
});
