// ============================================================================================
// WHATSAPP — Estados (historias de 24 h), Parte H punto 4
//
// Lo que se vigila: los estados de los contactos se guardan una sola vez (idempotente), solo se
// listan los vigentes (24 h), "ver" marca visto una sola vez, los propios nacen vistos, y
// publicar valida lo mínimo. El envío real a WhatsApp lo hace el worker (pg_notify).
// ============================================================================================

import { describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import * as service from "../src/modules/whatsapp/whatsapp.service.js";
import * as repo from "../src/modules/whatsapp/whatsapp.repository.js";
import { usuarioDePruebas } from "./fixtures.js";
import { verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

const estado = (o: Record<string, any> = {}) => ({
  waMessageId: `EST-${sufijo()}`, autorJid: "584141112233@s.whatsapp.net", autorNombre: "Ana", propio: false,
  tipo: "texto" as const, contenido: "¡Nueva promo esta semana!", fondo: "#5750e8", archivoUrl: null, mediaMeta: null, timestamp: new Date(), ...o,
});

async function conexion() {
  return service.crearConexion(`Conexión ${sufijo()}`, await usuarioDePruebas());
}

describe("Estados de WhatsApp", () => {
  it("guarda el estado de un contacto una sola vez y lo lista mientras está vigente", async () => {
    const cx = await conexion();
    const e = estado();
    await service.registrarEstado(cx.id, e);
    await service.registrarEstado(cx.id, e); // WhatsApp lo puede reenviar
    const lista = await service.listarEstados(cx.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ autor_nombre: "Ana", tipo: "texto", fondo: "#5750e8", propio: false, visto_at: null });
  });

  it("un estado de hace más de 24 h ya no se lista", async () => {
    const cx = await conexion();
    await service.registrarEstado(cx.id, estado({ timestamp: new Date(Date.now() - 25 * 3600_000) }));
    await service.registrarEstado(cx.id, estado());
    expect(await service.listarEstados(cx.id)).toHaveLength(1);
  });

  it("ver un estado lo marca visto una sola vez; los propios nacen vistos", async () => {
    const cx = await conexion();
    await service.registrarEstado(cx.id, estado());
    await service.registrarEstado(cx.id, estado({ propio: true, autorJid: null, autorNombre: null }));
    const [a, b] = await service.listarEstados(cx.id);
    const ajeno = [a, b].find((x) => !x.propio)!;
    const propio = [a, b].find((x) => x.propio)!;
    expect(propio.visto_at).toBeTruthy();
    await service.verEstado(ajeno.id);
    const visto = await repo.getEstado(ajeno.id);
    expect(visto?.visto_at).toBeTruthy();
    expect(await repo.marcarEstadoVisto(ajeno.id)).toBe(false); // segunda vez: nada
  });

  it("publicar valida que haya texto o archivo", async () => {
    const cx = await conexion();
    await expect(service.publicarEstado(cx.id, { tipo: "texto", contenido: "  " })).rejects.toThrow(/texto del estado/);
    await expect(service.publicarEstado(cx.id, { tipo: "imagen" })).rejects.toThrow(/foto o el video/);
    await expect(service.publicarEstado(cx.id, { tipo: "texto", contenido: "Hola" })).resolves.toBeUndefined();
  });

  it("los destinatarios de un estado propio son los chats individuales, nunca los grupos", async () => {
    await query(`INSERT INTO gozz.whatsapp_pipeline_stages (key, label, color, orden, es_terminal, es_ganado, activa)
       VALUES ('apertura','Apertura','#5C6670',1,false,false,true) ON CONFLICT (key) DO NOTHING`);
    const cx = await conexion();
    await service.registrarMensajeEntrante(cx.id, { jid: "584149990011@s.whatsapp.net", waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola", timestamp: new Date() } as any);
    await service.registrarMensajeEntrante(cx.id, { jid: "120363999999@g.us", esGrupo: true, waMessageId: `WA-${sufijo()}`, tipo: "texto", contenido: "Hola grupo", timestamp: new Date() } as any);
    expect(await repo.destinatariosEstados(cx.id)).toEqual(["584149990011@s.whatsapp.net"]);
  });
});
