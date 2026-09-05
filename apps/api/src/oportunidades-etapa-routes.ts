// ============================================================================================
// CAMBIO DE ETAPA EN MASA — endpoints
//
// QUIÉN PUEDE (CONVENCIONES §2.6 — `puede()` contra la base, nunca `u.nivel` del JWT ni `isAdmin`):
//
//   ┌──────────────────────────┬───────────────┬───────────────────────────────────────────┐
//   │ Quién                    │ 1 oportunidad │ 2 o más                                   │
//   ├──────────────────────────┼───────────────┼───────────────────────────────────────────┤
//   │ con `cambiar_etapa_masivo`│ directo      │ directo                                   │
//   │ sin él                   │ directo       │ crea SOLICITUD — no se aplica nada        │
//   └──────────────────────────┴───────────────┴───────────────────────────────────────────┘
//
// El corte en 2 no es arbitrario: **arrastrar una tarjeta en el tablero ya es un cambio de etapa de
// uno**, y nadie pidió restringirlo. Lo que cambia de naturaleza es hacerlo en lote.
//
// Aprobar exige `aprobar_oportunidad_etapa`, que sale de `aprobar_<valor del ENUM>` (§10.3): el
// permiso es **derivable del `tipo`** de la solicitud, sin `switch` ni tabla de equivalencias.
//
// 🔴 Los dos permisos son NUEVOS y no están sembrados. Hoy solo los tienen admin y super_admin, por
// la regla de `puede()`. Concederlos a alguien concreto es un INSERT en `gozz.user_permisos`.
// ============================================================================================

import type { Express, Request, Response } from "express";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { emitToUser } from "./shared/socket.js";
import { puede, quienesPueden } from "./lib/permisos.js";
import {
  MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA,
  aprobarSolicitudEtapa,
  cambiarEtapaMasivo,
  crearSolicitudEtapa,
  parsearCambios,
  previaCambioEtapa,
  rechazarSolicitudEtapa,
  seleccionCuadraConCambios,
} from "./lib/oportunidades-etapa.js";
import { detalleSolicitud } from "./lib/solicitudes-detalle.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERMISO_CAMBIO_MASIVO = "cambiar_etapa_masivo";
export const PERMISO_APROBAR_ETAPA = "aprobar_oportunidad_etapa";

/**
 * La selección, con el mismo contrato que Contactos pero **solo en modo `ids`**.
 *
 * El modo `filtro` no aplica aquí y no se acepta a medias: el modal enseña **una fila por
 * oportunidad con su propio `select` de etapa**, así que para armar la petición hay que tener los
 * ids delante. Un `filtro` sin mapa por id no podría expresar "estas doce a Ganado y estas tres a
 * Preparación", que es justo lo que la pantalla permite.
 */
function parsearSeleccionIds(body: any): { ids?: string[]; error?: string } {
  const s = body?.seleccion;
  if (!s || typeof s !== "object") return { error: "seleccion requerida" };
  if (s.modo !== "ids") return { error: "seleccion.modo debe ser 'ids': el cambio de etapa se arma fila a fila" };
  const ids = Array.isArray(s.ids) ? s.ids.map((x: any) => String(x)) : [];
  if (ids.length === 0) return { error: "seleccion.ids vacía" };
  if (!ids.every((id: string) => UUID_RE.test(id))) return { error: "seleccion.ids contiene ids inválidos" };
  return { ids: [...new Set<string>(ids)] };
}

/** Lee y valida `seleccion` + `cambios`, que tienen que hablar de lo mismo. */
function leerPeticion(body: any): { ids?: string[]; cambios?: Record<string, string>; error?: string } {
  const { ids, error: eSel } = parsearSeleccionIds(body);
  if (eSel || !ids) return { error: eSel };
  const { cambios, error: eCam } = parsearCambios(body?.cambios);
  if (eCam || !cambios) return { error: eCam };
  const desajuste = seleccionCuadraConCambios(ids, cambios);
  if (desajuste) return { error: desajuste };
  // Tope DECLARADO. Nunca se recorta en silencio: se responde con el número y se dice qué hacer.
  if (ids.length > MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA) {
    return {
      error: `la selección son ${ids.length} oportunidades y el máximo por operación es ` +
             `${MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA}. Hazlo por tandas.`,
    };
  }
  return { ids, cambios };
}

/** Una notificación por PERSONA, no una por oportunidad, y con su `emitToUser` detrás (§3.4). */
async function notificar(
  userIds: string[],
  n: { tipo: string; titulo: string; mensaje: string; prioridad?: string; url?: string; meta?: any }
): Promise<void> {
  const destinatarios = [...new Set(userIds.filter(Boolean))];
  if (destinatarios.length === 0) return;
  await query(
    `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
     SELECT x.uid::uuid, $2, $3, $4, $5, $6, $7::jsonb FROM unnest($1::text[]) AS x(uid)`,
    [destinatarios, n.tipo, n.titulo, n.mensaje, n.prioridad ?? "normal", n.url ?? "/solicitudes",
     JSON.stringify(n.meta ?? {})]
  );
  for (const uid of destinatarios) emitToUser(uid, "notificacion:nueva", { tipo: n.tipo, ...(n.meta ?? {}) });
}

export function registerOportunidadesEtapaRoutes(app: Express) {
  // ── Qué pasaría — para que la confirmación enseñe números REALES ──────────────────────────
  //
  // Hoy hay **cero automatizaciones activas** en producción. Pero se configuran desde la interfaz,
  // así que el aviso las cuenta **en vivo**: si mañana alguien activa una de `crear_tarea` en
  // Ganado, el mismo día la confirmación dirá "se crearán 100 tareas" sin tocar una línea.
  app.post("/api/oportunidades/etapa/previa", requireAuth, async (req: Request, res: Response) => {
    const { cambios, error } = parsearCambios(req.body?.cambios);
    if (error || !cambios) { res.status(400).json({ error }); return; }
    if (Object.keys(cambios).length > MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA) {
      res.status(400).json({
        error: `son ${Object.keys(cambios).length} oportunidades y el máximo por operación es ${MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA}. Hazlo por tandas.`,
      });
      return;
    }
    const u = (req as any).user;
    const previa = await previaCambioEtapa(cambios);
    // La pantalla necesita saber si su confirmación aplica o solo pide, para pedir la palabra
    // escrita únicamente cuando el cambio es inmediato.
    const puedeMasivo = await puede(u?.sub, PERMISO_CAMBIO_MASIVO);
    res.json({
      ...previa,
      puede_aplicar: puedeMasivo || Object.keys(cambios).length === 1,
      maximo: MAX_OPORTUNIDADES_POR_CAMBIO_ETAPA,
    });
  });

  // ── Aplicar (o dejar la solicitud) ────────────────────────────────────────────────────────
  app.post("/api/oportunidades/etapa", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { ids, cambios, error } = leerPeticion(req.body);
    if (error || !ids || !cambios) { res.status(400).json({ error }); return; }

    const enLote = ids.length >= 2;
    const puedeMasivo = await puede(u?.sub, PERMISO_CAMBIO_MASIVO);

    // 🔴 Sin permiso y en lote: se DEJA LA SOLICITUD y no se toca ni una etapa.
    if (enLote && !puedeMasivo) {
      const solicitud = await crearSolicitudEtapa(cambios, { userId: u.sub, motivo: req.body?.motivo });
      const aprobadores = (await quienesPueden(PERMISO_APROBAR_ETAPA)).filter((id) => id !== u.sub);
      const solicitante = (await query<any>(
        "SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]
      ))[0];
      const quien = solicitante?.nombre || "Alguien";
      await notificar(aprobadores, {
        tipo: "solicitud_etapa",
        titulo: `${quien} pide cambiar la etapa de ${ids.length} oportunidades`,
        mensaje: "Nadie ha cambiado nada todavía: la operación espera tu aprobación.",
        prioridad: "alta",
        meta: { solicitud_id: solicitud.id, oportunidades: ids.length },
      });

      // ── El banner de aprobación en vivo, el MISMO que usan monto y pago ────────────────────
      //
      // 🔴 Se emite SOLO a quien puede aprobar este tipo (`quienesPueden`), que es la misma regla
      // de `puede()` del revés. Por eso el componente no filtra por rol: si el evento llegó, el
      // servidor ya decidió. Y por eso tampoco se le ofrece a quien recibiría un 403.
      //
      // `oportunidad_id` va NULL: esto afecta a N y no hay un caso al que enlazar. El banner sabe
      // aguantarlo — enseña el resumen y "Ver" lleva a la bandeja.
      const resumen = await previaCambioEtapa(cambios);
      const linea = resumen.transiciones[0];
      const nombreEtapa = new Map(
        (await query<any>("SELECT key, label FROM gozz.pipeline_stages")).map((s: any) => [String(s.key), String(s.label)])
      );
      const etiqueta = (k: string | null) => (k ? nombreEtapa.get(k) ?? k : "—");
      const detalle = linea
        ? `${linea.n} de ${etiqueta(linea.desde)} pasan a ${etiqueta(linea.hasta)}` +
          (resumen.transiciones.length > 1 ? ` y ${resumen.transiciones.length - 1} cambio(s) más` : "")
        : `${ids.length} oportunidades`;
      for (const a of aprobadores) {
        emitToUser(a, "solicitud:oportunidad", {
          solicitud_id: solicitud.id,
          tipo: "etapa",
          endpoint_base: "solicitudes",
          oportunidad_id: null,
          oportunidad_titulo: null,
          from_user_id: u.sub,
          from_nombre: quien,
          from_foto: solicitante?.foto_perfil_url || null,
          detalle,
          motivo: solicitud.motivo || "",
          timestamp: new Date().toISOString(),
        });
      }

      res.json({ aplicado: false, solicitud, oportunidades: ids.length });
      return;
    }

    try {
      const r = await cambiarEtapaMasivo(cambios, { userId: u.sub });
      res.json({ aplicado: true, ...r });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "No se pudo cambiar la etapa" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // LA BANDEJA — `/api/solicitudes/:id/(aprobar|rechazar)`
  //
  // Ruta GENÉRICA a propósito, no `/api/etapa-solicitudes/…`. Las tres familias antiguas tienen una
  // ruta por tipo (`monto-solicitudes`, `pago-solicitudes`, `descuentos`) y la bandeja necesita un
  // `switch` para saber a cuál llamar — el mismo hábito que §10.3 quita del lado del permiso. Este
  // es el camino que deberían usar los tipos nuevos: **el `tipo` de la fila decide**, y el permiso
  // sale de él (`aprobar_` + tipo) sin tabla de equivalencias.
  //
  // Hoy solo resuelve `oportunidad_etapa`; las otras tres siguen en sus rutas históricas. Migrarlas
  // cambia quién puede qué en cada una y es entrega propia.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  // ── El detalle: QUÉ se está aprobando ─────────────────────────────────────────────────────
  //
  // 🔴 Sin esto, aprobar es firmar. La bandeja enseñaba "2 oportunidades → nuevo" y el motivo, y
  // quien pone su nombre en `aprobador_id` no sabía cuáles eran esas dos ni de qué clientes.
  //
  // Genérico por tipo: la resolución vive en `lib/solicitudes-detalle.ts`, con un registro donde
  // cada tipo dice de qué tabla sale y cómo se enriquece su selección. Las solicitudes de contactos
  // que vienen entran ahí sin tocar esta ruta.
  app.get("/api/solicitudes/:id/detalle", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await detalleSolicitud(String(req.params.id), u?.sub);
    if (!r.ok && r.motivo === "no_encontrada") { res.status(404).json({ error: "Solicitud no encontrada" }); return; }
    if (!r.ok) { res.status(403).json({ error: "No tienes permiso para ver esta solicitud" }); return; }
    res.json(r.detalle);
  });

  /** Localiza la solicitud y devuelve el permiso que hace falta para resolverla. */
  async function resolverSolicitud(id: string) {
    const fila = (await query<any>(
      "SELECT id, tipo, estado, solicitante_id, oportunidades_afectadas FROM gozz.oportunidad_etapa_solicitudes WHERE id = $1",
      [id]
    ))[0];
    if (!fila) return null;
    // El permiso sale del tipo. Sin `switch`. (§10.3)
    return { ...fila, permiso: `aprobar_${fila.tipo}` };
  }

  app.post("/api/solicitudes/:id/aprobar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const sol = await resolverSolicitud(String(req.params.id));
    if (!sol) { res.status(404).json({ error: "Solicitud no encontrada" }); return; }
    if (!(await puede(u?.sub, sol.permiso))) {
      res.status(403).json({ error: "No tienes permiso para aprobar este tipo de solicitud" });
      return;
    }

    let r;
    try {
      r = await aprobarSolicitudEtapa(sol.id, { userId: u.sub, confirmarCambios: req.body?.confirmar_cambios === true });
    } catch (e: any) {
      // La solicitud se queda en 'aprobada' con el error dentro: la aprobación no se pierde.
      res.status(500).json({ error: `La solicitud quedó aprobada pero la ejecución falló: ${e?.message}` });
      return;
    }

    if (!r.ok && r.motivo === "no_pendiente") {
      res.status(409).json({ error: "La solicitud ya no está pendiente: alguien la resolvió antes." });
      return;
    }
    if (!r.ok && r.motivo === "conjunto_cambiado") {
      // 🔴 No se ejecuta a ciegas sobre un conjunto distinto del que se pidió.
      res.status(409).json({
        error: "El conjunto cambió desde que se pidió la solicitud.",
        afectadas_al_pedir: r.afectadas_al_pedir,
        aplicables_ahora: r.aplicables_ahora,
        previa: r.previa,
        reintentar_con: { confirmar_cambios: true },
      });
      return;
    }

    const { solicitud, resultado } = r as any;
    await notificar([solicitud.solicitante_id].filter((id: string) => id !== u.sub), {
      tipo: "solicitud_etapa_resuelta",
      titulo: "Tu cambio masivo de etapa fue aprobado",
      mensaje: `Se cambiaron ${resultado.cambiadas} oportunidad${resultado.cambiadas === 1 ? "" : "es"}.` +
               (resultado.omitidas.length ? ` ${resultado.omitidas.length} quedaron fuera.` : ""),
      meta: { solicitud_id: solicitud.id },
    });
    res.json({ ok: true, solicitud, resultado });
  });

  app.post("/api/solicitudes/:id/rechazar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const sol = await resolverSolicitud(String(req.params.id));
    if (!sol) { res.status(404).json({ error: "Solicitud no encontrada" }); return; }
    if (!(await puede(u?.sub, sol.permiso))) {
      res.status(403).json({ error: "No tienes permiso para rechazar este tipo de solicitud" });
      return;
    }
    // Obligatorio desde la 0066: a quien le rechazan algo se le dice por qué (§10.2).
    const motivoRechazo = String(req.body?.motivo_rechazo || "").trim();
    if (!motivoRechazo) { res.status(400).json({ error: "El motivo del rechazo es obligatorio" }); return; }

    const solicitud = await rechazarSolicitudEtapa(sol.id, { userId: u.sub, motivoRechazo });
    if (!solicitud) { res.status(409).json({ error: "La solicitud ya no está pendiente: alguien la resolvió antes." }); return; }

    await notificar([solicitud.solicitante_id].filter((id: string) => id !== u.sub), {
      tipo: "solicitud_etapa_resuelta",
      titulo: "Tu cambio masivo de etapa fue rechazado",
      mensaje: motivoRechazo,
      meta: { solicitud_id: solicitud.id },
    });
    res.json({ ok: true, solicitud });
  });
}
