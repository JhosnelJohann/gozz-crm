import type { Express } from "express";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { puedeEditarMontoDirecto, tiposQuePuedeAprobar } from "./lib/permisos.js";
import { emitToUser } from "./shared/socket.js";
import { getBalanceBreakdown, recomputeBalance } from "./lib/oportunidad-balance.js";

// Aprobar un cambio de monto lo puede hacer el mismo conjunto que edita el monto directo.
const puedeAprobarMonto = puedeEditarMontoDirecto;

export function registerDetailRoutes(app: Express) {
  // Oportunidad detail with joins extendidos
  app.get("/api/oportunidades/:id/puntajes", requireAuth, async (req, res) => {
    const id = req.params.id;
    const tramites = await query<any>(
      `WITH tr AS (
         SELECT tc.* FROM gozz.oportunidad_tramites ot JOIN gozz.tramites_config tc ON tc.id = ot.tipo_tramite_id WHERE ot.oportunidad_id = $1
         UNION ALL
         SELECT tc.* FROM gozz.oportunidades o JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
           WHERE o.id = $1 AND NOT EXISTS (SELECT 1 FROM gozz.oportunidad_tramites x WHERE x.oportunidad_id = $1)
       )
       SELECT id, nombre, codigo, color, formulario_uscis,
              puntaje_vendedor, puntaje_preparador, puntaje_manager_ventas, puntaje_manager_preparacion, puntaje_manager_general
       FROM tr ORDER BY nombre`,
      [id]
    );
    const sum = (k: string) => tramites.reduce((s: number, t: any) => s + Number(t[k] || 0), 0);
    res.json({
      tramites,
      por_cargo: {
        vendedor: sum("puntaje_vendedor"),
        preparador: sum("puntaje_preparador"),
        manager: sum("puntaje_manager_general"),
      },
    });
  });

  app.get("/api/oportunidades/:id", requireAuth, async (req, res) => {
    const rows = await query<any>(`
      -- ⚠️ El COALESCE del correo es el MISMO criterio que colEmail() en contactos-routes.ts, y
      -- esta aqui por lo mismo: la ventana entre el despliegue y el pnpm migrate, que corre un
      -- humano DESPUES. Se puede quitar de los dos sitios a la vez cuando la 0071 este aplicada
      -- en los tres entornos. Desde la 0071 la unica fuente es la columna email; correo_personal
      -- es historica y no se lee ni se escribe en ningun otro sitio.
      SELECT o.*,
        c.nombre_completo AS contacto_nombre, COALESCE(NULLIF(TRIM(c.email), ''), NULLIF(TRIM(c.correo_personal), '')) AS contacto_email, c.telefono AS contacto_telefono, c.whatsapp AS contacto_whatsapp,
        c.estatus_migratorio_tipo AS contacto_estatus, c.tipo_cliente AS contacto_tipo,
        -- La fecha de nacimiento se LEE del contacto en cada carga; la tabla oportunidades NO
        -- guarda copia. Si la guardara, el dia que alguien corrigiera la del contacto las
        -- negociaciones se quedarian con la vieja y nadie se enteraria, y para cotizar un seguro
        -- una fecha desactualizada es peor que ninguna. La edad se calcula en la pantalla, con
        -- edadEnAnios, que es la misma funcion que usa la ficha del contacto.
        c.fecha_nacimiento AS contacto_fecha_nacimiento,
        c.direccion_ciudad AS contacto_ciudad, c.direccion_estado AS contacto_estado,
        c.referido_por_contacto_id, c.saldo_referidos_usd AS contacto_saldo_referidos,
        ref.nombre_completo AS referido_por_nombre,
        tc.nombre AS tramite_nombre, tc.codigo AS tramite_codigo, tc.formulario_uscis, tc.sla_dias, tc.valor_base,
        tc.cuestionario_json, tc.documentos_requeridos,
        u_prep.nombre AS preparador_nombre, u_prep.foto_perfil_url AS preparador_foto,
        u_vend.nombre AS vendedor_nombre, u_vend.foto_perfil_url AS vendedor_foto,
        u_mp.nombre AS manager_preparacion_nombre,
        u_mv.nombre AS manager_ventas_nombre,
        u_sup.nombre AS supervisor_nombre,
        u_mg.nombre AS manager_general_nombre, u_mg.foto_perfil_url AS manager_general_foto
      FROM gozz.oportunidades o
      LEFT JOIN gozz.contactos_cache c ON c.id = o.contacto_id
      LEFT JOIN gozz.contactos_cache ref ON ref.id = c.referido_por_contacto_id
      LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
      LEFT JOIN gozz.users u_prep ON u_prep.id = o.preparador_id
      LEFT JOIN gozz.users u_vend ON u_vend.id = o.vendedor_id
      LEFT JOIN gozz.users u_mp ON u_mp.id = o.manager_preparacion_id
      LEFT JOIN gozz.users u_mv ON u_mv.id = o.manager_ventas_id
      LEFT JOIN gozz.users u_sup ON u_sup.id = o.supervisor_id
      LEFT JOIN gozz.users u_mg ON u_mg.id = o.manager_general_id
      WHERE o.id = $1
    `, [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: "No encontrada" }); return; }

    const tareas = await query(
      `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_limite, t.created_at, u.nombre AS responsable_nombre
       FROM gozz.tareas t
       LEFT JOIN gozz.users u ON u.id = t.responsable_id
       WHERE t.oportunidad_id = $1 ORDER BY t.created_at DESC`,
      [req.params.id]
    );

    const actividad = await query(
      `SELECT a.accion, a.datos_antes, a.datos_despues, a.created_at, u.nombre AS user_nombre
       FROM gozz.auditoria a
       LEFT JOIN gozz.users u ON u.id = a.user_id
       WHERE a.tabla_afectada = 'oportunidades' AND a.registro_id = $1
       ORDER BY a.created_at DESC LIMIT 50`,
      [req.params.id]
    );

    // Pagos reales de la tabla nueva + totales
    const pagos = await query<any>(
      `SELECT p.*, u.nombre AS registrado_por_nombre
         FROM gozz.oportunidades_pagos p
         LEFT JOIN gozz.users u ON u.id = p.registrado_por
        WHERE p.oportunidad_id = $1 AND p.anulado = false
        ORDER BY p.fecha_pago DESC, p.created_at DESC`,
      [req.params.id]
    );
    const totalPagado = pagos.reduce((s: number, p: any) => s + Number(p.monto || 0), 0);

    // Notas recientes
    const notasRecientes = await query<any>(
      `SELECT n.id, n.contenido, n.created_at, u.nombre AS usuario_nombre
         FROM gozz.oportunidades_notas n
         LEFT JOIN gozz.users u ON u.id = n.user_id
        WHERE n.oportunidad_id = $1
        ORDER BY n.created_at DESC LIMIT 5`,
      [req.params.id]
    );

    // Trámites de la oportunidad (puede tener VARIOS). Incluye el trámite PRINCIPAL
    // (oportunidades.tipo_tramite_id) + los agregados en la junction, deduplicados.
    // Sin el principal, al agregar otro el principal "desaparecía" de la lista.
    const tramites = await query<any>(
      `SELECT x.tipo_tramite_id, bool_or(x.es_principal) AS es_principal,
              tc.nombre, tc.codigo, tc.color, tc.formulario_uscis
         FROM (
           SELECT o.tipo_tramite_id AS tipo_tramite_id, true AS es_principal
             FROM gozz.oportunidades o
            WHERE o.id = $1 AND o.tipo_tramite_id IS NOT NULL
           UNION ALL
           SELECT ot.tipo_tramite_id, ot.es_principal
             FROM gozz.oportunidad_tramites ot
            WHERE ot.oportunidad_id = $1
         ) x
         JOIN gozz.tramites_config tc ON tc.id = x.tipo_tramite_id
        GROUP BY x.tipo_tramite_id, tc.nombre, tc.codigo, tc.color, tc.formulario_uscis
        ORDER BY bool_or(x.es_principal) DESC, tc.nombre`,
      [req.params.id]
    );

    // Breakdown del balance: el descuento aprobado rebaja el valor a cobrar (no es pago). Exponemos
    // total_descuentos / total_a_cobrar / a_reintegrar para la cabecera y el tab de Pagos.
    const bd = await getBalanceBreakdown(String(req.params.id));
    (rows[0] as any).total_descuentos = bd.totalDescuentos;
    (rows[0] as any).total_a_cobrar = bd.totalACobrar;
    (rows[0] as any).a_reintegrar = bd.aReintegrar;

    res.json({ oportunidad: rows[0], tramites, tareas, actividad, pagos, total_pagado: totalPagado, notas_recientes: notasRecientes });
  });

  // Agregar un trámite a la oportunidad (multi-trámite)
  app.post("/api/oportunidades/:id/tramites", requireAuth, async (req, res) => {
    const { tipo_tramite_id } = req.body;
    if (!tipo_tramite_id) { res.status(400).json({ error: "tipo_tramite_id requerido" }); return; }
    await query(
      `INSERT INTO gozz.oportunidad_tramites (oportunidad_id, tipo_tramite_id, es_principal, origen)
       VALUES ($1, $2, false, 'manual') ON CONFLICT (oportunidad_id, tipo_tramite_id) DO NOTHING`,
      [req.params.id, tipo_tramite_id]
    );
    res.json({ ok: true });
  });

  // Quitar un trámite (no permite quitar el principal)
  app.delete("/api/oportunidades/:id/tramites/:tramiteId", requireAuth, async (req, res) => {
    await query(
      `DELETE FROM gozz.oportunidad_tramites
        WHERE oportunidad_id = $1 AND tipo_tramite_id = $2
          AND tipo_tramite_id IS DISTINCT FROM (SELECT tipo_tramite_id FROM gozz.oportunidades WHERE id = $1)`,
      [req.params.id, req.params.tramiteId]
    );
    res.json({ ok: true });
  });

  // Save cuestionario responses
  app.patch("/api/oportunidades/:id/cuestionario", requireAuth, async (req, res) => {
    const { datos } = req.body;
    if (!datos) { res.status(400).json({ error: "datos requeridos" }); return; }
    await query(
      "UPDATE gozz.oportunidades SET cuestionario_datos = $1::jsonb WHERE id = $2",
      [JSON.stringify(datos), req.params.id]
    );
    res.json({ ok: true });
  });

  // Add payment to oportunidad
  app.post("/api/oportunidades/:id/pagos", requireAuth, async (req, res) => {
    const { monto, metodo, referencia, fecha } = req.body;
    if (!monto) { res.status(400).json({ error: "monto requerido" }); return; }

    const current = await query<any>("SELECT pagos, valor_total FROM gozz.oportunidades WHERE id = $1", [req.params.id]);
    if (!current[0]) { res.status(404).json({ error: "No encontrada" }); return; }

    const pagosActuales = (current[0].pagos as any[]) || [];
    const nuevoPago = {
      id: crypto.randomUUID(),
      monto: Number(monto),
      metodo: metodo || "efectivo",
      referencia: referencia || null,
      fecha: fecha || new Date().toISOString(),
      registrado_por: (req as any).user.sub
    };
    pagosActuales.push(nuevoPago);

    const totalPagado = pagosActuales.reduce((s, p) => s + Number(p.monto || 0), 0);
    const balance = Number(current[0].valor_total || 0) - totalPagado;

    await query(
      "UPDATE gozz.oportunidades SET pagos = $1::jsonb, balance_pendiente = $2 WHERE id = $3",
      [JSON.stringify(pagosActuales), balance, req.params.id]
    );
    res.json({ pago: nuevoPago, balance_pendiente: balance });
  });

  // ---------- SOLICITUDES DE CAMBIO DE MONTO ----------

  // Crear solicitud (usuario sin permiso directo). Motivo obligatorio.
  app.post("/api/oportunidades/:id/monto-solicitudes", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const montoPropuesto = Number(req.body?.monto_propuesto);
    const motivo = String(req.body?.motivo || "").trim();
    if (!Number.isFinite(montoPropuesto) || montoPropuesto < 0) { res.status(400).json({ error: "Monto propuesto inválido" }); return; }
    if (!motivo) { res.status(400).json({ error: "El motivo es obligatorio" }); return; }
    const op = await query<any>("SELECT valor_total, nombre_caso FROM gozz.oportunidades WHERE id = $1", [req.params.id]);
    if (!op[0]) { res.status(404).json({ error: "Oportunidad no encontrada" }); return; }
    const rows = await query<any>(
      `INSERT INTO gozz.oportunidad_monto_solicitudes
         (oportunidad_id, solicitante_id, monto_anterior, monto_propuesto, motivo)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, u.sub, op[0].valor_total, montoPropuesto, motivo]
    );
    // Notificar in-app a los aprobadores (admin/super_admin o user_permisos 'editar_monto')
    const aprobadores = await query<any>(
      `SELECT u.id FROM gozz.users u
        WHERE u.activo = true AND (
          u.nivel_acceso IN ('admin','super_admin')
          OR EXISTS (SELECT 1 FROM gozz.user_permisos p WHERE p.user_id = u.id AND p.permiso = 'editar_monto')
        )`
    );
    const solicitante = (await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]))[0];
    for (const a of aprobadores) {
      query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
         VALUES ($1,'monto_solicitud','Solicitud de cambio de monto',$2,'alta',$3)`,
        [a.id, `Nuevo monto propuesto: $${montoPropuesto}. Motivo: ${motivo.slice(0,120)}`, `/oportunidades/${req.params.id}`]
      ).catch(() => {});
      emitToUser(a.id, "notificacion:nueva", { tipo: "monto_solicitud" });
      // Banner de aprobación en vivo (como descuentos): pop-up con Aprobar/Rechazar/Ver.
      emitToUser(a.id, "solicitud:oportunidad", {
        solicitud_id: rows[0].id,
        tipo: "monto",
        endpoint_base: "monto-solicitudes",
        oportunidad_id: req.params.id,
        oportunidad_titulo: op[0].nombre_caso,
        from_user_id: u.sub,
        from_nombre: solicitante?.nombre || "Solicitante",
        from_foto: solicitante?.foto_perfil_url || null,
        detalle: `$${Number(op[0].valor_total).toFixed(2)} → $${montoPropuesto.toFixed(2)}`,
        motivo,
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ solicitud: rows[0] });
  });

  // Listar solicitudes de UNA oportunidad (para el indicador "pendiente")
  app.get("/api/oportunidades/:id/monto-solicitudes", requireAuth, async (req, res) => {
    const rows = await query<any>(
      `SELECT s.*, us.nombre AS solicitante_nombre, ua.nombre AS aprobador_nombre
         FROM gozz.oportunidad_monto_solicitudes s
         LEFT JOIN gozz.users us ON us.id = s.solicitante_id
         LEFT JOIN gozz.users ua ON ua.id = s.aprobador_id
        WHERE s.oportunidad_id = $1
        ORDER BY s.created_at DESC`,
      [req.params.id]
    );
    res.json({ solicitudes: rows });
  });

  // Bandeja global de pendientes (solo aprobadores)
  app.get("/api/monto-solicitudes", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!(await puedeAprobarMonto(u))) { res.status(403).json({ error: "Solo aprobadores" }); return; }
    const estado = String(req.query?.estado || "pendiente");
    const rows = await query<any>(
      `SELECT s.*, us.nombre AS solicitante_nombre, o.nombre_caso
         FROM gozz.oportunidad_monto_solicitudes s
         LEFT JOIN gozz.users us ON us.id = s.solicitante_id
         LEFT JOIN gozz.oportunidades o ON o.id = s.oportunidad_id
        WHERE s.estado = $1 ORDER BY s.created_at DESC`,
      [estado]
    );
    res.json({ solicitudes: rows });
  });

  // Aprobar: actualiza el monto + recalcula balance + audita + notifica
  app.post("/api/monto-solicitudes/:solId/aprobar", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!(await puedeAprobarMonto(u))) { res.status(403).json({ error: "Solo aprobadores" }); return; }
    const sol = await query<any>(
      "SELECT * FROM gozz.oportunidad_monto_solicitudes WHERE id = $1 AND estado = 'pendiente'",
      [req.params.solId]
    );
    if (!sol[0]) { res.status(404).json({ error: "Solicitud no encontrada o ya resuelta" }); return; }
    const s = sol[0];
    // Actualizar monto
    await query("UPDATE gozz.oportunidades SET valor_total = $1, updated_at = NOW() WHERE id = $2",
      [s.monto_propuesto, s.oportunidad_id]);
    // Recalcular balance con el helper central (valor_total - descuentos - pagos)
    const nuevoBalance = (await recomputeBalance(s.oportunidad_id)).balance;
    // Marcar solicitud
    await query(
      "UPDATE gozz.oportunidad_monto_solicitudes SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2",
      [u.sub, s.id]);
    // Auditar
    query(`INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
           VALUES ($1,$2,'oportunidades',$3,$4::jsonb,$5::jsonb)`,
      [u.sub, `Aprobó cambio de monto de ${s.monto_anterior} a ${s.monto_propuesto}`, String(s.oportunidad_id),
       JSON.stringify({ valor_total: s.monto_anterior }), JSON.stringify({ valor_total: s.monto_propuesto })]).catch(()=>{});
    // Avisar al solicitante (incluye quién aprobó)
    const aprobadorNombre = (await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]))[0]?.nombre || "Un administrador";
    query(`INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
           VALUES ($1,'monto_aprobada',$2,$3,'normal',$4)`,
      [s.solicitante_id, `Tu cambio de monto fue aprobado por ${aprobadorNombre}`, `Nuevo monto: $${s.monto_propuesto}`, `/oportunidades/${s.oportunidad_id}`]).catch(()=>{});
    emitToUser(s.solicitante_id, "notificacion:nueva", { tipo: "monto_aprobada" });
    res.json({ ok: true, balance_pendiente: nuevoBalance });
  });

  // Rechazar: no cambia el monto
  app.post("/api/monto-solicitudes/:solId/rechazar", requireAuth, async (req, res) => {
    const u = (req as any).user;
    if (!(await puedeAprobarMonto(u))) { res.status(403).json({ error: "Solo aprobadores" }); return; }
    // Obligatorio desde la 0066 (CHECK `rechazada ⇒ motivo_rechazo NOT NULL`): a quien le rechazan
    // un cambio de dinero se le dice por qué. Se valida aquí para dar 400 y no un 500 del CHECK.
    const motivoRechazo = String(req.body?.motivo_rechazo || "").trim() || null;
    if (!motivoRechazo) { res.status(400).json({ error: "El motivo del rechazo es obligatorio" }); return; }
    const rows = await query<any>(
      `UPDATE gozz.oportunidad_monto_solicitudes
          SET estado='rechazada', aprobador_id=$1, motivo_rechazo=$2, resolved_at=NOW()
        WHERE id=$3 AND estado='pendiente' RETURNING *`,
      [u.sub, motivoRechazo, req.params.solId]);
    if (!rows[0]) { res.status(404).json({ error: "Solicitud no encontrada o ya resuelta" }); return; }
    const aprobadorNombre = (await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]))[0]?.nombre || "Un administrador";
    query(`INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
           VALUES ($1,'monto_rechazada',$2,$3,'normal',$4)`,
      [rows[0].solicitante_id, `Tu cambio de monto fue rechazado por ${aprobadorNombre}`, motivoRechazo, `/oportunidades/${rows[0].oportunidad_id}`]).catch(()=>{});
    emitToUser(rows[0].solicitante_id, "notificacion:nueva", { tipo: "monto_rechazada" });
    res.json({ ok: true });
  });

  // ---------- PANEL UNIFICADO DE SOLICITUDES (vista gozz.vi_solicitudes_oportunidades) ----------

  // Panel global. Todos los usuarios pueden ver; los NO aprobadores solo ven las suyas.
  app.get("/api/solicitudes", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const esAprobador = await puedeAprobarMonto(u);
    // Qué tipos puede resolver, derivado del propio ENUM (`aprobar_<tipo>`, §10.3). Sirve para dos
    // cosas: que la solicitud LE APAREZCA a quien pueda resolverla —aunque no tenga `editar_monto`,
    // que es lo único que miraba `esAprobador`— y para que la interfaz no le ofrezca el botón a
    // quien recibiría un 403.
    const tiposAprobables = await tiposQuePuedeAprobar(u?.sub);
    const estado = String(req.query?.estado || "pendiente");
    // Filtro por tipo: monto | pago | descuento | etapa (o "todas"/vacío = sin filtro).
    const tipoMap: Record<string, string> = { monto: "oportunidad_monto", pago: "oportunidad_pago", descuento: "oportunidad_descuento", etapa: "oportunidad_etapa" };
    const tipoEnum = tipoMap[String(req.query?.tipo || "")];
    const params: any[] = [estado];
    let filtroPropias = "";
    if (!esAprobador) {
      // Ve las suyas y las que puede resolver. Sin esto, quien tenga solo
      // `aprobar_oportunidad_etapa` no vería nunca la solicitud que le toca aprobar.
      params.push(u.sub);
      const pSub = `$${params.length}`;
      params.push(tiposAprobables);
      filtroPropias = ` AND (s.solicitante_id = ${pSub} OR s.tipo::text = ANY($${params.length}::text[]))`;
    }
    let filtroTipo = "";
    if (tipoEnum) { params.push(tipoEnum); filtroTipo = ` AND s.tipo::text = $${params.length}`; }
    const rows = await query<any>(
      `SELECT s.*, o.nombre_caso, us.nombre AS solicitante_nombre, ua.nombre AS aprobador_nombre
         FROM gozz.vi_solicitudes_oportunidades s
         LEFT JOIN gozz.oportunidades o ON o.id = s.oportunidad_id
         LEFT JOIN gozz.users us ON us.id = s.solicitante_id
         LEFT JOIN gozz.users ua ON ua.id = s.aprobador_id
        WHERE ($1 = 'todas' OR s.estado = $1)${filtroPropias}${filtroTipo}
        ORDER BY s.created_at DESC`,
      params
    );
    res.json({ solicitudes: rows, es_aprobador: esAprobador, tipos_aprobables: tiposAprobables });
  });

  // Solicitudes de UNA oportunidad (pestaña Solicitudes). Los NO aprobadores solo ven las suyas.
  app.get("/api/oportunidades/:id/solicitudes", requireAuth, async (req, res) => {
    const u = (req as any).user;
    const esAprobador = await puedeAprobarMonto(u);
    const params: any[] = [req.params.id];
    let filtroPropias = "";
    if (!esAprobador) { params.push(u.sub); filtroPropias = ` AND s.solicitante_id = $${params.length}`; }
    const rows = await query<any>(
      `SELECT s.*, us.nombre AS solicitante_nombre, ua.nombre AS aprobador_nombre
         FROM gozz.vi_solicitudes_oportunidades s
         LEFT JOIN gozz.users us ON us.id = s.solicitante_id
         LEFT JOIN gozz.users ua ON ua.id = s.aprobador_id
        WHERE s.oportunidad_id = $1${filtroPropias}
        ORDER BY s.created_at DESC`,
      params
    );
    res.json({ solicitudes: rows, es_aprobador: esAprobador });
  });
}
