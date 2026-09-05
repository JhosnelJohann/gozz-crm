import type { Express, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { query } from "./shared/db.js";
import { requireAuth } from "./shared/auth-middleware.js";
import { emitToUser } from "./shared/socket.js";
import { placeUploadedFile } from "./lib/storage.js";
import { deleteUploadsIfUnreferenced } from "./lib/uploads-cleanup.js";
import { puedeEditarMontoDirecto } from "./lib/permisos.js";
import { recomputeBalance } from "./lib/oportunidad-balance.js";
import { auditarCambiosDeEtapa } from "./lib/auditoria-etapa.js";

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

// Filtro de ÁREA para separar reportes de Ventas vs Preparación.
// El Manager General cuenta en AMBAS áreas (supervisa todo el proceso).
function areaWhere(area: any): string | null {
  const a = String(area || "").toLowerCase();
  if (a === "ventas") return `ph.cargo_codigo IN ('vendedor','gerente_ventas','manager_general')`;
  if (a === "preparacion") return `ph.cargo_codigo IN ('preparador','gerente_preparacion','manager_general')`;
  return null; // 'todos' o vacío = sin filtro
}

// ==================== Uploads (comprobantes pagos) ====================
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
const uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
// Techo de subida: 300 MB por archivo. `files: 25` es el backstop global (permite 20 comprobantes + firma + margen);
// los topes por endpoint (comprobante/documentos) fijan el máximo real de 20 archivos por acción.
const upload = multer({ storage: uploadStorage, limits: { fileSize: 300 * 1024 * 1024, files: 25 } });

// ==================== Sumar puntos al completar ====================
export async function sumarPuntosOportunidad(oportunidadId: string): Promise<number> {
  // Ya asignado? No duplicar
  const alreadyRows = await query<any>(
    "SELECT puntos_asignados FROM gozz.oportunidades WHERE id = $1",
    [oportunidadId]
  );
  if (!alreadyRows[0]) return 0;
  if (alreadyRows[0].puntos_asignados) return 0;

  // Fetch oportunidad + tramite + cargos del equipo
  const op = (await query<any>("SELECT * FROM gozz.oportunidades WHERE id = $1", [oportunidadId]))[0];
  if (!op) return 0;

  // Puntaje ACUMULADO sumando TODOS los tramites de la oportunidad (junction; fallback al principal)
  const acc = (await query<any>(
    `WITH tr AS (
       SELECT tc.* FROM gozz.oportunidad_tramites ot JOIN gozz.tramites_config tc ON tc.id = ot.tipo_tramite_id WHERE ot.oportunidad_id = $1
       UNION ALL
       SELECT tc.* FROM gozz.oportunidades o JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
         WHERE o.id = $1 AND NOT EXISTS (SELECT 1 FROM gozz.oportunidad_tramites x WHERE x.oportunidad_id = $1)
     )
     SELECT COALESCE(SUM(puntaje_vendedor),0) AS vendedor, COALESCE(SUM(puntaje_preparador),0) AS preparador,
            COALESCE(SUM(puntaje_manager_ventas),0) AS gerente_ventas, COALESCE(SUM(puntaje_manager_preparacion),0) AS gerente_preparacion,
            COALESCE(SUM(puntaje_manager_general),0) AS manager_general FROM tr`,
    [oportunidadId]
  ))[0] || {};

  // Todos los roles se asignan POR OPORTUNIDAD (no por cargo global): si el manager
  // cambia con el tiempo, los puntos quedan con quien fue asignado en esta negociacion.
  const asignaciones: { userId: string; cargoCodigo: string; puntos: number }[] = [];
  const slots: { userId: string | null; cargo: string; puntos: number }[] = [
    { userId: op.vendedor_id, cargo: "vendedor", puntos: Number(acc.vendedor || 0) },
    { userId: op.preparador_id, cargo: "preparador", puntos: Number(acc.preparador || 0) },
    { userId: op.manager_general_id, cargo: "manager_general", puntos: Number(acc.manager_general || 0) },
    { userId: op.manager_ventas_id, cargo: "gerente_ventas", puntos: Number(acc.gerente_ventas || 0) },
    { userId: op.manager_preparacion_id, cargo: "gerente_preparacion", puntos: Number(acc.gerente_preparacion || 0) }
  ];
  for (const sl of slots) {
    if (sl.userId && sl.puntos > 0) asignaciones.push({ userId: sl.userId, cargoCodigo: sl.cargo, puntos: sl.puntos });
  }

  let insertados = 0;
  for (const a of asignaciones) {
    if (!a.userId || a.puntos <= 0) continue;
    const cargo = (await query<any>("SELECT valor_punto_usd FROM gozz.cargos WHERE codigo = $1", [a.cargoCodigo]))[0];
    const valorPunto = Number(cargo?.valor_punto_usd || 0);
    await query(
      `INSERT INTO gozz.puntajes_historial (oportunidad_id, user_id, cargo_codigo, puntos, valor_punto_usd, motivo)
       VALUES ($1, $2, $3, $4, $5, 'oportunidad_completada')`,
      [oportunidadId, a.userId, a.cargoCodigo, a.puntos, valorPunto]
    );
    insertados++;
    emitToUser(a.userId, "notificacion:nueva", {
      tipo: "puntaje_nuevo",
      puntos: a.puntos,
      monto_usd: a.puntos * valorPunto,
      titulo: `+${a.puntos} puntos (${op.nombre_caso})`
    });
  }

  await query(
    "UPDATE gozz.oportunidades SET puntos_asignados = true, fecha_completada = COALESCE(fecha_completada, NOW()) WHERE id = $1",
    [oportunidadId]
  );
  return insertados;
}

// Asigna puntos si la etapa indicada es una etapa ganada del pipeline (idempotente)
export async function asignarPuntosSiGanada(oportunidadId: string, etapa: string | null | undefined): Promise<void> {
  if (!etapa) return;
  let ganada = ["ganado", "completada", "completado"].includes(etapa);
  if (!ganada) {
    const st = (await query<any>("SELECT es_ganado FROM gozz.pipeline_stages WHERE key = $1", [etapa]))[0];
    ganada = !!st?.es_ganado;
  }
  if (ganada) await sumarPuntosOportunidad(oportunidadId);
}

// ==================== Endpoints registro ====================
export function registerReportesRoutes(app: Express) {
  // --------- COMPLETAR OPORTUNIDAD ---------
  app.post("/api/oportunidades/:id/completar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const id = String(req.params.id);

    // Verificar balance
    const op = (await query<any>("SELECT id, nombre_caso, valor_total, balance_pendiente FROM gozz.oportunidades WHERE id = $1", [id]))[0];
    if (!op) { res.status(404).json({ error: "Oportunidad no encontrada" }); return; }
    if (Number(op.balance_pendiente || 0) > 0 && !isAdmin(u) && !req.body?.forzar) {
      res.status(400).json({ error: "Balance pendiente > 0. Usa forzar:true como admin para completar igual." });
      return;
    }

    // 🔴 La etapa anterior, ANTES de pisarla: es lo único que hace auditable este camino.
    const etapaAnterior = (await query<any>("SELECT etapa FROM gozz.oportunidades WHERE id = $1", [id]))[0]?.etapa ?? null;

    await query("UPDATE gozz.oportunidades SET etapa = 'ganado' WHERE id = $1", [id]);

    // ── Bitácora del cambio de etapa, misma forma que el cambio individual (`index.ts`) ───────
    //
    // 🔴 POR QUÉ IMPORTA AQUÍ MÁS QUE EN NINGÚN SITIO: este endpoint pone la etapa en **ganado**,
    // que es justo el cambio que deja obsoleta una solicitud de cambio masivo pendiente. Sin esta
    // fila, el detalle de esa solicitud le diría al aprobador que no hay discrepancias cuando sí
    // las hay — y ese es el fallo exacto que la comprobación viene a evitar.
    await auditarCambiosDeEtapa(
      [{ id, antes: etapaAnterior, despues: "ganado", accion: "Finalizó la oportunidad como GANADA (completar)" }],
      { userId: u?.sub || null }
    );

    const insertados = await sumarPuntosOportunidad(id);
    res.json({ ok: true, puntos_asignaciones: insertados });
  });

  // --------- REPORTE PUNTAJES ---------
  app.get("/api/reportes/puntajes", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "mine" ? "mine" : "all";
    // Reportes de puntajes visibles para todo el equipo (scope=mine = solo lo propio)

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [];

    if (scope === "mine") wheres.push(`ph.user_id = ${addP(u.sub)}`);
    if (req.query.user_id) wheres.push(`ph.user_id = ${addP(req.query.user_id)}`);
    if (req.query.departamento_id) wheres.push(`up.departamento_id = ${addP(req.query.departamento_id)}`);
    if (req.query.cargo_codigo) wheres.push(`ph.cargo_codigo = ${addP(req.query.cargo_codigo)}`);
    { const aw = areaWhere(req.query.area); if (aw) wheres.push(aw); }
    if (req.query.desde) wheres.push(`ph.fecha >= (${addP(req.query.desde)}::date::timestamp AT TIME ZONE 'America/New_York')`);
    if (req.query.hasta) wheres.push(`ph.fecha < ((${addP(req.query.hasta)}::date + 1)::timestamp AT TIME ZONE 'America/New_York')`);
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const totales = await query<any>(
      `SELECT COALESCE(SUM(ph.puntos),0)::numeric(12,2) AS total_puntos,
              COALESCE(SUM(ph.monto_usd),0)::numeric(12,2) AS total_usd,
              COUNT(DISTINCT ph.oportunidad_id)::int AS negociaciones
         FROM gozz.puntajes_historial ph
         LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = ph.user_id
         ${whereSql}`,
      params
    );

    const porUsuario = await query<any>(
      `SELECT ph.user_id, u.nombre, u.foto_perfil_url, ph.cargo_codigo,
              SUM(ph.puntos)::numeric(12,2) AS puntos,
              SUM(ph.monto_usd)::numeric(12,2) AS monto_usd,
              COUNT(DISTINCT ph.oportunidad_id)::int AS negociaciones
         FROM gozz.puntajes_historial ph
         LEFT JOIN gozz.users u ON u.id = ph.user_id
         LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = ph.user_id
         ${whereSql}
         GROUP BY ph.user_id, u.nombre, u.foto_perfil_url, ph.cargo_codigo
         ORDER BY puntos DESC`,
      params
    );

    const porTramite = await query<any>(
      `SELECT tc.id AS tramite_id, tc.nombre AS tramite_nombre, tc.codigo AS tramite_codigo,
              COUNT(DISTINCT o.id)::int AS cantidad,
              SUM(ph.puntos)::numeric(12,2) AS puntos,
              SUM(ph.monto_usd)::numeric(12,2) AS monto_usd
         FROM gozz.puntajes_historial ph
         JOIN gozz.oportunidades o ON o.id = ph.oportunidad_id
         LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
         LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = ph.user_id
         ${whereSql}
         GROUP BY tc.id, tc.nombre, tc.codigo
         ORDER BY puntos DESC NULLS LAST`,
      params
    );

    const detalle = await query<any>(
      `SELECT ph.id, ph.fecha, ph.puntos, ph.valor_punto_usd, ph.monto_usd, ph.cargo_codigo,
              ph.user_id, u.nombre AS usuario_nombre,
              o.id AS oportunidad_id, o.nombre_caso, o.fecha_completada, o.valor_total,
              tc.nombre AS tramite_nombre, tc.formulario_uscis,
              c.nombre_completo AS contacto_nombre,
              o.created_at AS fecha_creacion_oportunidad
         FROM gozz.puntajes_historial ph
         JOIN gozz.users u ON u.id = ph.user_id
         JOIN gozz.oportunidades o ON o.id = ph.oportunidad_id
         LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
         LEFT JOIN gozz.contactos_cache c ON c.id = o.contacto_id
         LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = ph.user_id
         ${whereSql}
         ORDER BY ph.fecha DESC`,
      params
    );

    res.json({
      totales: totales[0] || { total_puntos: 0, total_usd: 0, negociaciones: 0 },
      por_usuario: porUsuario,
      por_tramite: porTramite,
      detalle
    });
  });

  // --------- EXPORTAR XLSX ---------
  app.get("/api/reportes/puntajes/export.xlsx", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "mine" ? "mine" : "all";

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [];
    if (scope === "mine") wheres.push(`ph.user_id = ${addP(u.sub)}`);
    if (req.query.user_id) wheres.push(`ph.user_id = ${addP(req.query.user_id)}`);
    { const aw = areaWhere(req.query.area); if (aw) wheres.push(aw); }
    if (req.query.desde) wheres.push(`ph.fecha >= (${addP(req.query.desde)}::date::timestamp AT TIME ZONE 'America/New_York')`);
    if (req.query.hasta) wheres.push(`ph.fecha < ((${addP(req.query.hasta)}::date + 1)::timestamp AT TIME ZONE 'America/New_York')`);
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = await query<any>(
      `SELECT o.nombre_caso AS titulo,
              tc.nombre AS tipo_tramite,
              o.created_at AS fecha_creacion,
              o.fecha_completada AS fecha_completada,
              u.nombre AS usuario,
              ph.cargo_codigo AS cargo,
              ph.puntos,
              ph.valor_punto_usd,
              ph.monto_usd
         FROM gozz.puntajes_historial ph
         JOIN gozz.users u ON u.id = ph.user_id
         JOIN gozz.oportunidades o ON o.id = ph.oportunidad_id
         LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
         ${whereSql}
         ORDER BY ph.fecha DESC`,
      params
    );

    const areaLabel = req.query.area === "ventas" ? "Ventas" : req.query.area === "preparacion" ? "Preparación" : "Todos";
    const wb = new ExcelJS.Workbook();
    wb.creator = "GOZZ CRM";
    const ws = wb.addWorksheet(`Puntajes - ${areaLabel}`);
    ws.columns = [
      { header: "Negociación", key: "titulo", width: 40 },
      { header: "Tipo de trámite", key: "tipo_tramite", width: 24 },
      { header: "Fecha creación", key: "fecha_creacion", width: 20 },
      { header: "Fecha completada", key: "fecha_completada", width: 20 },
      { header: "Usuario", key: "usuario", width: 22 },
      { header: "Cargo", key: "cargo", width: 18 },
      { header: "Puntos", key: "puntos", width: 12 },
      { header: "Valor punto (USD)", key: "valor_punto_usd", width: 18 },
      { header: "Monto (USD)", key: "monto_usd", width: 16 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFB51C" } };

    rows.forEach((r) => {
      ws.addRow({
        titulo: r.titulo,
        tipo_tramite: r.tipo_tramite,
        fecha_creacion: r.fecha_creacion ? new Date(r.fecha_creacion) : null,
        fecha_completada: r.fecha_completada ? new Date(r.fecha_completada) : null,
        usuario: r.usuario,
        cargo: r.cargo,
        puntos: Number(r.puntos),
        valor_punto_usd: Number(r.valor_punto_usd),
        monto_usd: Number(r.monto_usd)
      });
    });
    ws.getColumn("fecha_creacion").numFmt = "yyyy-mm-dd hh:mm";
    ws.getColumn("fecha_completada").numFmt = "yyyy-mm-dd hh:mm";
    ws.getColumn("puntos").numFmt = "0.00";
    ws.getColumn("valor_punto_usd").numFmt = '"$"#,##0.00';
    ws.getColumn("monto_usd").numFmt = '"$"#,##0.00';

    // Totales
    const totalRow = ws.addRow({
      titulo: "TOTAL",
      puntos: rows.reduce((s, r) => s + Number(r.puntos || 0), 0),
      monto_usd: rows.reduce((s, r) => s + Number(r.monto_usd || 0), 0)
    });
    totalRow.font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="puntajes_${new Date().toISOString().slice(0,10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // --------- EXPORTAR PDF ---------
  app.get("/api/reportes/puntajes/export.pdf", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "all" ? "all" : "mine";
    if (scope === "all" && !isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [];
    if (scope === "mine") wheres.push(`ph.user_id = ${addP(u.sub)}`);
    if (req.query.user_id) wheres.push(`ph.user_id = ${addP(req.query.user_id)}`);
    { const aw = areaWhere(req.query.area); if (aw) wheres.push(aw); }
    if (req.query.desde) wheres.push(`ph.fecha >= (${addP(req.query.desde)}::date::timestamp AT TIME ZONE 'America/New_York')`);
    if (req.query.hasta) wheres.push(`ph.fecha < ((${addP(req.query.hasta)}::date + 1)::timestamp AT TIME ZONE 'America/New_York')`);
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const porUsuario = await query<any>(
      `SELECT u.nombre, ph.cargo_codigo,
              SUM(ph.puntos)::numeric(12,2) AS puntos,
              SUM(ph.monto_usd)::numeric(12,2) AS monto_usd
         FROM gozz.puntajes_historial ph
         JOIN gozz.users u ON u.id = ph.user_id
         ${whereSql}
         GROUP BY u.nombre, ph.cargo_codigo
         ORDER BY puntos DESC`,
      params
    );
    const totalPuntos = porUsuario.reduce((s, r) => s + Number(r.puntos || 0), 0);
    const totalUsd = porUsuario.reduce((s, r) => s + Number(r.monto_usd || 0), 0);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="puntajes_${new Date().toISOString().slice(0,10)}.pdf"`);
    const doc = new PDFDocument({ size: "LETTER", margin: 40 });
    doc.pipe(res);

    const areaLabel = req.query.area === "ventas" ? "Ventas" : req.query.area === "preparacion" ? "Preparación" : "Todos";
    doc.fontSize(18).font("Helvetica-Bold").text(`Reporte de Puntajes — ${areaLabel}`, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#666")
       .text(`Generado: ${new Date().toLocaleString("es")}`, { align: "center" });
    if (req.query.desde || req.query.hasta) {
      doc.text(`Rango: ${req.query.desde || "inicio"} → ${req.query.hasta || "hoy"}`, { align: "center" });
    }
    doc.moveDown();

    doc.fontSize(12).fillColor("#000").font("Helvetica-Bold").text("Resumen");
    doc.font("Helvetica").fontSize(11);
    doc.text(`Total puntos: ${totalPuntos.toFixed(2)}`);
    doc.text(`Total USD: $${totalUsd.toFixed(2)}`);
    doc.moveDown();

    // Tabla por usuario
    doc.font("Helvetica-Bold").fontSize(12).text("Por usuario");
    doc.moveDown(0.3);
    const cols = [
      { key: "nombre", label: "Nombre", x: 40, w: 170 },
      { key: "cargo", label: "Cargo", x: 210, w: 150 },
      { key: "puntos", label: "Puntos", x: 360, w: 70, align: "right" as const },
      { key: "monto_usd", label: "USD", x: 430, w: 90, align: "right" as const }
    ];
    doc.font("Helvetica-Bold").fontSize(10);
    cols.forEach((c) => doc.text(c.label, c.x, doc.y, { width: c.w, align: c.align || "left", continued: c !== cols[cols.length - 1] }));
    doc.text("");
    doc.moveTo(40, doc.y).lineTo(560, doc.y).strokeColor("#FF8609").stroke();
    doc.font("Helvetica").fontSize(10).fillColor("#000");

    porUsuario.forEach((r) => {
      if (doc.y > 720) doc.addPage();
      const y = doc.y + 4;
      doc.text(r.nombre || "-", 40, y, { width: 170 });
      doc.text(r.cargo_codigo || "-", 210, y, { width: 150 });
      doc.text(Number(r.puntos).toFixed(2), 360, y, { width: 70, align: "right" });
      doc.text(`$${Number(r.monto_usd).toFixed(2)}`, 430, y, { width: 90, align: "right" });
      doc.moveDown(0.5);
    });

    doc.end();
  });

  // --------- REPORTES: ASISTENCIA ---------
// =============== Asistencia (mejorado) ===============
  app.get("/api/reportes/asistencia", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "all" ? "all" : "mine";
    if (scope === "all" && !isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [];
    if (scope === "mine") wheres.push(`e.user_id = ${addP(u.sub)}`);
    if (req.query.user_id) wheres.push(`e.user_id = ${addP(req.query.user_id)}`);
    if (req.query.desde) wheres.push(`e.fecha_local >= ${addP(req.query.desde)}::date`);
    if (req.query.hasta) wheres.push(`e.fecha_local <= ${addP(req.query.hasta)}::date`);
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = await query<any>(
      `SELECT e.id, e.user_id, u.nombre, u.foto_perfil_url,
              e.fecha_local, e.entrada_at, e.salida_at,
              e.fue_tarde, e.minutos_tarde,
              CASE
                WHEN e.salida_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - e.entrada_at))::int / 60 - COALESCE(e.minutos_break,0))
                ELSE COALESCE(e.minutos_totales, 0)
              END AS minutos_totales,
              COALESCE(e.minutos_break, 0) AS minutos_break,
              (e.salida_at IS NULL) AS activo
         FROM gozz.clock_entries e
         JOIN gozz.users u ON u.id = e.user_id
         ${whereSql}
         ORDER BY e.fecha_local DESC, e.entrada_at DESC`,
      params
    );

    // Resumen agregado
    const totalDias = rows.length;
    const totalMin = rows.reduce((s, r) => s + (r.minutos_totales || 0), 0);
    const totalBreakMin = rows.reduce((s, r) => s + (r.minutos_break || 0), 0);
    const diasTarde = rows.filter((r) => r.fue_tarde).length;
    const diasActivos = rows.filter((r) => r.activo).length;
    const minTarde = rows.reduce((s, r) => s + (r.minutos_tarde || 0), 0);
    const totalMinPuntual = rows.filter((r) => !r.fue_tarde).length;
    const puntualidad = totalDias > 0 ? Math.round((totalMinPuntual / totalDias) * 1000) / 10 : 0;

    res.json({
      entries: rows,
      resumen: {
        total_dias: totalDias,
        dias_activos: diasActivos,
        horas_totales: Math.round((totalMin / 60) * 10) / 10,
        horas_break: Math.round((totalBreakMin / 60) * 10) / 10,
        dias_tarde: diasTarde,
        minutos_tarde_acumulados: minTarde,
        puntualidad_pct: puntualidad,
      },
    });
  });

  // =============== Asistencia export Excel ===============
  app.get("/api/reportes/asistencia/export.xlsx", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "all" ? "all" : "mine";
    if (scope === "all" && !isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [];
    if (scope === "mine") wheres.push(`e.user_id = ${addP(u.sub)}`);
    if (req.query.user_id) wheres.push(`e.user_id = ${addP(req.query.user_id)}`);
    if (req.query.desde) wheres.push(`e.fecha_local >= ${addP(req.query.desde)}::date`);
    if (req.query.hasta) wheres.push(`e.fecha_local <= ${addP(req.query.hasta)}::date`);
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = await query<any>(
      `SELECT u.nombre, e.fecha_local, e.entrada_at, e.salida_at,
              e.fue_tarde, e.minutos_tarde,
              CASE
                WHEN e.salida_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - e.entrada_at))::int / 60 - COALESCE(e.minutos_break,0))
                ELSE COALESCE(e.minutos_totales, 0)
              END AS minutos_totales,
              COALESCE(e.minutos_break, 0) AS minutos_break
         FROM gozz.clock_entries e
         JOIN gozz.users u ON u.id = e.user_id
         ${whereSql}
         ORDER BY e.fecha_local DESC, u.nombre`,
      params
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "GOZZ CRM";
    const ws = wb.addWorksheet("Asistencia");
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 14 },
      { header: "Usuario", key: "usuario", width: 28 },
      { header: "Entrada", key: "entrada", width: 12 },
      { header: "Salida", key: "salida", width: 12 },
      { header: "Trabajado (h)", key: "trabajado", width: 14 },
      { header: "Break (min)", key: "break", width: 12 },
      { header: "Puntualidad", key: "puntualidad", width: 16 },
      { header: "Min tarde", key: "min_tarde", width: 12 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFA6C04" } };

    const fmt = (n: number) => {
      const h = Math.floor(n / 60);
      const m = n % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    for (const r of rows) {
      ws.addRow({
        fecha: r.fecha_local,
        usuario: r.nombre,
        entrada: r.entrada_at ? new Date(r.entrada_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "—",
        salida: r.salida_at ? new Date(r.salida_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "ACTIVO",
        trabajado: fmt(r.minutos_totales || 0),
        break: r.minutos_break || 0,
        puntualidad: r.fue_tarde ? "Tarde" : "A tiempo",
        min_tarde: r.minutos_tarde || 0,
      });
    }

    // Resumen al final
    const totalMin = rows.reduce((s, r) => s + (r.minutos_totales || 0), 0);
    const diasTarde = rows.filter((r) => r.fue_tarde).length;
    ws.addRow([]);
    const sumRow = ws.addRow({
      fecha: "TOTALES",
      usuario: `${rows.length} días`,
      trabajado: fmt(totalMin),
      puntualidad: `${rows.length - diasTarde}/${rows.length} puntuales`,
      min_tarde: rows.reduce((s, r) => s + (r.minutos_tarde || 0), 0),
    });
    sumRow.font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="asistencia_${new Date().toISOString().slice(0,10)}.xlsx"`);
    res.send(Buffer.from(buf));
  });

  // =============== Asistencia export PDF ===============
  app.get("/api/reportes/asistencia/export.pdf", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const scope = (req.query.scope as string) === "all" ? "all" : "mine";
    if (scope === "all" && !isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }

    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [];
    if (scope === "mine") wheres.push(`e.user_id = ${addP(u.sub)}`);
    if (req.query.user_id) wheres.push(`e.user_id = ${addP(req.query.user_id)}`);
    if (req.query.desde) wheres.push(`e.fecha_local >= ${addP(req.query.desde)}::date`);
    if (req.query.hasta) wheres.push(`e.fecha_local <= ${addP(req.query.hasta)}::date`);
    const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = await query<any>(
      `SELECT u.nombre, e.fecha_local, e.entrada_at, e.salida_at,
              e.fue_tarde, e.minutos_tarde,
              CASE WHEN e.salida_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - e.entrada_at))::int / 60 - COALESCE(e.minutos_break,0))
                   ELSE COALESCE(e.minutos_totales, 0) END AS minutos_totales,
              COALESCE(e.minutos_break, 0) AS minutos_break
         FROM gozz.clock_entries e
         JOIN gozz.users u ON u.id = e.user_id
         ${whereSql}
         ORDER BY e.fecha_local DESC, u.nombre`,
      params
    );

    const doc = new PDFDocument({ margin: 32, size: "A4", layout: "landscape" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="asistencia_${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fillColor("#FA6C04").fontSize(22).text("Reporte de Asistencia", 32, 32);
    doc.fillColor("#666").fontSize(10).text(`Generado: ${new Date().toLocaleString("es")} · ${rows.length} registros`, 32, 60);
    if (req.query.desde || req.query.hasta) {
      doc.text(`Período: ${req.query.desde || "—"} a ${req.query.hasta || "—"}`, 32, 74);
    }

    // Stats summary
    const totalMin = rows.reduce((s, r) => s + (r.minutos_totales || 0), 0);
    const diasTarde = rows.filter((r) => r.fue_tarde).length;
    const minTardeAcum = rows.reduce((s, r) => s + (r.minutos_tarde || 0), 0);
    doc.fillColor("#000").fontSize(11);
    const statsY = 96;
    const statW = 150;
    const stats = [
      { l: "Total días", v: String(rows.length) },
      { l: "Horas trabajadas", v: `${(totalMin / 60).toFixed(1)}h` },
      { l: "Días tarde", v: String(diasTarde) },
      { l: "Min tarde acum.", v: String(minTardeAcum) },
      { l: "Puntualidad", v: rows.length > 0 ? `${Math.round(((rows.length - diasTarde) / rows.length) * 100)}%` : "—" },
    ];
    stats.forEach((s, i) => {
      const x = 32 + i * statW;
      doc.roundedRect(x, statsY, statW - 8, 36, 4).fillAndStroke("#FFF7ED", "#FED7AA");
      doc.fillColor("#92400E").fontSize(8).text(s.l.toUpperCase(), x + 8, statsY + 6, { width: statW - 16 });
      doc.fillColor("#9A3412").fontSize(14).font("Helvetica-Bold").text(s.v, x + 8, statsY + 18);
      doc.font("Helvetica");
    });

    // Table
    let y = 150;
    const tableX = 32;
    const colWidths = [70, 140, 60, 60, 80, 60, 90, 70];
    const headers = ["Fecha", "Usuario", "Entrada", "Salida", "Trabajado", "Break", "Puntualidad", "Min tarde"];
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#FFF");
    doc.rect(tableX, y, colWidths.reduce((a, b) => a + b), 22).fill("#FA6C04");
    let x = tableX;
    headers.forEach((h, i) => {
      doc.fillColor("#FFF").text(h, x + 6, y + 6, { width: colWidths[i] - 12 });
      x += colWidths[i];
    });
    y += 22;

    const fmt = (n: number) => {
      const h = Math.floor(n / 60);
      const m = n % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    doc.font("Helvetica").fontSize(8).fillColor("#000");
    rows.forEach((r, i) => {
      if (y > 540) { doc.addPage({ margin: 32, size: "A4", layout: "landscape" }); y = 40; }
      const bg = i % 2 === 0 ? "#FAFAFA" : "#FFFFFF";
      doc.rect(tableX, y, colWidths.reduce((a, b) => a + b), 18).fill(bg).stroke("#EEE");
      doc.fillColor("#000");
      let xx = tableX;
      const cells = [
        r.fecha_local,
        r.nombre,
        r.entrada_at ? new Date(r.entrada_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "—",
        r.salida_at ? new Date(r.salida_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "ACTIVO",
        fmt(r.minutos_totales || 0),
        String(r.minutos_break || 0) + "m",
        r.fue_tarde ? "Tarde" : "A tiempo",
        String(r.minutos_tarde || 0),
      ];
      cells.forEach((c, j) => {
        if (j === 6 && r.fue_tarde) doc.fillColor("#DC2626");
        else if (j === 6) doc.fillColor("#16A34A");
        else if (j === 3 && r.salida_at === null) doc.fillColor("#16A34A");
        else doc.fillColor("#000");
        doc.text(String(c), xx + 6, y + 5, { width: colWidths[j] - 12 });
        xx += colWidths[j];
      });
      y += 18;
    });

    doc.end();
  });

  // --------- PAGOS DE OPORTUNIDAD ---------
  const PagoSchema = z.object({
    monto: z.coerce.number().positive(),
    metodo: z.enum(["efectivo","tarjeta","tarjeta_tercero","transferencia","zelle","cashapp","descuento_referido","otro"]),
    titular_tipo: z.enum(["cliente","tercero"]).optional(),
    titular_nombre: z.string().nullable().optional(),
    fecha_pago: z.string().optional(),
    notas: z.string().nullable().optional()
  });

  app.get("/api/oportunidades/:id/pagos", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT p.*, u.nombre AS registrado_por_nombre
         FROM gozz.oportunidades_pagos p
         LEFT JOIN gozz.users u ON u.id = p.registrado_por
        WHERE p.oportunidad_id = $1 AND p.anulado = false
        ORDER BY p.fecha_pago DESC, p.created_at DESC`,
      [req.params.id]
    );
    const totalRows = await query<any>(
      `SELECT COALESCE(SUM(monto),0)::numeric(12,2) AS total_pagado
         FROM gozz.oportunidades_pagos
        WHERE oportunidad_id = $1 AND anulado = false`,
      [req.params.id]
    );
    res.json({ pagos: rows, total_pagado: Number(totalRows[0]?.total_pagado || 0) });
  });

  app.post("/api/oportunidades/:id/pagos", requireAuth, upload.fields([
    { name: "comprobante", maxCount: 20 },
    { name: "firma", maxCount: 1 }
  ]), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = PagoSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data;

    const files = req.files as { [k: string]: Express.Multer.File[] };
    const comprobantes = files?.comprobante || [];
    const firma = files?.firma?.[0];

    // Comprobante obligatorio excepto descuento_referido
    if (d.metodo !== "descuento_referido" && comprobantes.length === 0) {
      res.status(400).json({ error: "El comprobante es obligatorio" });
      return;
    }
    // Tarjeta de tercero requiere firma
    if (d.metodo === "tarjeta_tercero" && !firma) {
      res.status(400).json({ error: "Tarjeta de tercero requiere el archivo de firma" });
      return;
    }

    const pagoId = randomUUID();
    const comprobantesArr = comprobantes.map((f) => ({
      url: placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "pago_comprobante", { opId: String(req.params.id), pagoId }, f.filename),
      filename: f.originalname,
      mime: f.mimetype
    }));
    const comprobanteUrl = comprobantesArr[0]?.url ?? null;
    const firmaUrl = firma ? placeUploadedFile(path.join(UPLOADS_DIR, firma.filename), "pago_firma", { opId: String(req.params.id), pagoId }, firma.filename) : null;

    const rows = await query<any>(
      `INSERT INTO gozz.oportunidades_pagos
         (id, oportunidad_id, monto, metodo, titular_tipo, titular_nombre, fecha_pago, comprobante_url, comprobantes_urls, firma_autorizacion_url, registrado_por, notas)
       VALUES ($1, $2, $3, $4, COALESCE($5,'cliente'), $6, COALESCE($7,CURRENT_DATE), $8, $9::jsonb, $10, $11, $12)
       RETURNING *`,
      [
        pagoId, req.params.id, d.monto, d.metodo,
        d.titular_tipo, d.titular_nombre ?? null,
        d.fecha_pago ? d.fecha_pago : null,
        comprobanteUrl, JSON.stringify(comprobantesArr), firmaUrl, u.sub, d.notas ?? null
      ]
    );

    // Recalcular balance con el helper central (valor_total - descuentos - pagos).
    const bal = await recomputeBalance(String(req.params.id));

    res.json({ pago: rows[0], balance_pendiente: bal.balance, total_pagado: bal.totalPagado });
  });

  app.delete("/api/oportunidades/:id/pagos/:pagoId", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!(await puedeEditarMontoDirecto(u))) { res.status(403).json({ error: "No tienes permiso para eliminar pagos" }); return; }
    const prev = (await query<any>("SELECT * FROM gozz.oportunidades_pagos WHERE id = $1 AND oportunidad_id = $2", [req.params.pagoId, req.params.id]))[0];
    await query(
      "UPDATE gozz.oportunidades_pagos SET anulado = true, anulado_motivo = $1 WHERE id = $2 AND oportunidad_id = $3",
      [req.body?.motivo || "eliminado", req.params.pagoId, req.params.id]
    );
    // Recalcular balance con el helper central.
    const bal = await recomputeBalance(String(req.params.id));
    if (prev) {
      query(
        `INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
         VALUES ($1, $2, 'oportunidades_pagos', $3, $4::jsonb, $5::jsonb)`,
        [u?.sub || null, `Eliminó un pago de $${prev.monto} (${prev.metodo})`, String(req.params.pagoId),
         JSON.stringify({ monto: prev.monto, metodo: prev.metodo, anulado: false }), JSON.stringify({ anulado: true })]
      ).catch((e) => console.error("[auditoria pago eliminar]", e?.message));
    }
    res.json({ ok: true, balance_pendiente: bal.balance });
    // Limpieza de archivos del pago. NOTA: aquí el pago se ANULA (soft-delete), así que su fila
    // sigue referenciando estas urls → el helper NO las borrará hasta que dejen de estar referenciadas.
    (async () => {
      const solsDel = await query<any>("SELECT comprobante_propuesto FROM gozz.oportunidad_pago_solicitudes WHERE pago_id = $1", [req.params.pagoId]);
      const pagoUrls = [
        prev?.comprobante_url, prev?.firma_autorizacion_url,
        ...(Array.isArray(prev?.comprobantes_urls) ? prev.comprobantes_urls.map((c: any) => c?.url) : []),
        ...(Array.isArray(prev?.documentos_adicionales) ? prev.documentos_adicionales.map((d: any) => d?.url) : []),
        ...solsDel.map((s: any) => s?.comprobante_propuesto?.url),
      ];
      await deleteUploadsIfUnreferenced(pagoUrls, { origen: "cascade_pago", userId: (req as any).user?.sub });
    })().catch((e) => console.error("[uploads-cleanup pago-del]", e?.message));
  });

  // ---- Editar un pago (monto/método/titular/fecha/notas). Mismo permiso que editar el monto. ----
  app.patch("/api/oportunidades/:id/pagos/:pagoId", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!(await puedeEditarMontoDirecto(u))) { res.status(403).json({ error: "No tienes permiso para editar pagos" }); return; }
    const b = req.body || {};
    // monto anterior para auditar cambios de monto del pago
    const prev = (await query<any>("SELECT monto FROM gozz.oportunidades_pagos WHERE id = $1 AND oportunidad_id = $2", [req.params.pagoId, req.params.id]))[0];
    const sets: string[] = [];
    const vals: any[] = [];
    if (b.monto !== undefined) {
      const m = Number(b.monto);
      if (!(m > 0)) { res.status(400).json({ error: "Monto inválido" }); return; }
      sets.push(`monto = $${vals.push(m)}`);
    }
    if (typeof b.metodo === "string" && b.metodo) sets.push(`metodo = $${vals.push(b.metodo)}`);
    if (b.titular_tipo === "cliente" || b.titular_tipo === "tercero") sets.push(`titular_tipo = $${vals.push(b.titular_tipo)}`);
    if (b.titular_nombre !== undefined) sets.push(`titular_nombre = $${vals.push(b.titular_nombre || null)}`);
    if (b.fecha_pago !== undefined) sets.push(`fecha_pago = $${vals.push(b.fecha_pago || null)}`);
    if (b.notas !== undefined) sets.push(`notas = $${vals.push(b.notas || null)}`);
    if (!sets.length) { res.status(400).json({ error: "Nada para actualizar" }); return; }
    const idIdx = vals.push(req.params.pagoId);
    const oppIdx = vals.push(req.params.id);
    const rows = await query<any>(
      `UPDATE gozz.oportunidades_pagos SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND oportunidad_id = $${oppIdx} AND anulado = false RETURNING *`,
      vals
    );
    if (!rows[0]) { res.status(404).json({ error: "Pago no encontrado" }); return; }
    // Recalcular balance con el helper central (el monto pudo cambiar).
    const bal = await recomputeBalance(String(req.params.id));
    // Auditar cambio de monto del pago
    if (prev && Number(prev.monto) !== Number(rows[0].monto)) {
      query(
        `INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
         VALUES ($1, $2, 'oportunidades_pagos', $3, $4::jsonb, $5::jsonb)`,
        [u?.sub || null, `Editó el monto de un pago de ${prev.monto} a ${rows[0].monto}`, String(req.params.pagoId),
         JSON.stringify({ monto: prev.monto }), JSON.stringify({ monto: rows[0].monto })]
      ).catch((e) => console.error("[auditoria pago]", e?.message));
    }
    res.json({ pago: rows[0], balance_pendiente: bal.balance, total_pagado: bal.totalPagado });
  });

// ---- Anexar documentos adicionales a un pago existente ----
  app.post("/api/oportunidades/:id/pagos/:pagoId/documentos", requireAuth, upload.array("documentos", 20), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) { res.status(400).json({ error: "No se adjuntaron documentos" }); return; }
    const pago = (await query<any>("SELECT id FROM gozz.oportunidades_pagos WHERE id = $1 AND oportunidad_id = $2", [req.params.pagoId, req.params.id]))[0];
    if (!pago) { res.status(404).json({ error: "Pago no encontrado" }); return; }
    const nuevos = files.map((f) => ({ url: placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "pago_documento", { opId: String(req.params.id), pagoId: String(req.params.pagoId) }, f.filename), filename: f.originalname, mime: f.mimetype, uploaded_at: new Date().toISOString(), uploaded_by: u.sub }));
    const rows = await query<any>(
      `UPDATE gozz.oportunidades_pagos
         SET documentos_adicionales = COALESCE(documentos_adicionales, '[]'::jsonb) || $1::jsonb
       WHERE id = $2 AND oportunidad_id = $3 RETURNING *`,
      [JSON.stringify(nuevos), req.params.pagoId, req.params.id]
    );
    res.json({ pago: rows[0], agregados: nuevos.length });
  });

  // ---- Eliminar un documento adicional de un pago (por url) ----
  app.delete("/api/oportunidades/:id/pagos/:pagoId/documentos", requireAuth, async (req: Request, res: Response) => {
    const url = String(req.body?.url || "");
    if (!url) { res.status(400).json({ error: "Falta url" }); return; }
    const rows = await query<any>(
      `UPDATE gozz.oportunidades_pagos
         SET documentos_adicionales = COALESCE((SELECT jsonb_agg(d) FROM jsonb_array_elements(documentos_adicionales) d WHERE d->>'url' <> $1), '[]'::jsonb)
       WHERE id = $2 AND oportunidad_id = $3 RETURNING *`,
      [url, req.params.pagoId, req.params.id]
    );
    res.json({ pago: rows[0] });
    deleteUploadsIfUnreferenced([url], { origen: "cascade_pago", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup pago-doc]", e?.message));
  });

  // ---- Eliminar UN archivo puntual del pago por url (comprobante / documento / firma), sin borrar el pago. Solo admin. ----
  app.delete("/api/oportunidades/:id/pagos/:pagoId/archivo", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const url = String(req.body?.url || "");
    if (!url) { res.status(400).json({ error: "Falta url" }); return; }
    const rows = await query<any>(
      `UPDATE gozz.oportunidades_pagos SET
         comprobantes_urls = COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(comprobantes_urls) c WHERE c->>'url' <> $1), '[]'::jsonb),
         documentos_adicionales = COALESCE((SELECT jsonb_agg(d) FROM jsonb_array_elements(documentos_adicionales) d WHERE d->>'url' <> $1), '[]'::jsonb),
         comprobante_url = CASE WHEN comprobante_url = $1 THEN NULL ELSE comprobante_url END,
         firma_autorizacion_url = CASE WHEN firma_autorizacion_url = $1 THEN NULL ELSE firma_autorizacion_url END
       WHERE id = $2 AND oportunidad_id = $3 RETURNING *`,
      [url, req.params.pagoId, req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "Pago no encontrado" }); return; }
    res.json({ pago: rows[0] });
    deleteUploadsIfUnreferenced([url], { origen: "cascade_pago", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup pago-archivo]", e?.message));
  });

  // ---- Reemplazar (editar) UN archivo puntual por otro. Solo admin. ----
  app.post("/api/oportunidades/:id/pagos/:pagoId/archivo/reemplazar", requireAuth, upload.single("archivo"), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const oldUrl = String(req.body?.url || "");
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!oldUrl || !file) { res.status(400).json({ error: "Falta url o archivo" }); return; }
    const nuevo = { url: placeUploadedFile(path.join(UPLOADS_DIR, file.filename), "pago_comprobante", { opId: String(req.params.id), pagoId: String(req.params.pagoId) }, file.filename), filename: file.originalname, mime: file.mimetype };
    const pago = (await query<any>("SELECT * FROM gozz.oportunidades_pagos WHERE id = $1 AND oportunidad_id = $2", [req.params.pagoId, req.params.id]))[0];
    if (!pago) { res.status(404).json({ error: "Pago no encontrado" }); return; }
    const comps: any[] = Array.isArray(pago.comprobantes_urls) ? pago.comprobantes_urls : [];
    const docs: any[] = Array.isArray(pago.documentos_adicionales) ? pago.documentos_adicionales : [];
    let newComps = comps, newDocs = docs;
    let newComprobanteUrl = pago.comprobante_url;
    let newFirma = pago.firma_autorizacion_url;
    let ok = false;
    if (comps.some((c) => c.url === oldUrl)) {
      newComps = comps.map((c) => (c.url === oldUrl ? nuevo : c));
      if (pago.comprobante_url === oldUrl) newComprobanteUrl = nuevo.url;
      ok = true;
    } else if (docs.some((d) => d.url === oldUrl)) {
      newDocs = docs.map((d) => (d.url === oldUrl ? { ...nuevo, uploaded_at: new Date().toISOString(), uploaded_by: u.sub } : d));
      ok = true;
    } else if (pago.comprobante_url === oldUrl) {
      newComprobanteUrl = nuevo.url; newComps = [...comps, nuevo]; ok = true;
    } else if (pago.firma_autorizacion_url === oldUrl) {
      newFirma = nuevo.url; ok = true;
    }
    if (!ok) { res.status(404).json({ error: "Archivo no encontrado en el pago" }); return; }
    const rows = await query<any>(
      `UPDATE gozz.oportunidades_pagos
         SET comprobantes_urls = $1::jsonb, documentos_adicionales = $2::jsonb, comprobante_url = $3, firma_autorizacion_url = $4
       WHERE id = $5 AND oportunidad_id = $6 RETURNING *`,
      [JSON.stringify(newComps), JSON.stringify(newDocs), newComprobanteUrl, newFirma, req.params.pagoId, req.params.id]
    );
    res.json({ pago: rows[0], archivo: nuevo });
    deleteUploadsIfUnreferenced([oldUrl], { origen: "cascade_pago", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup pago-reemplazar]", e?.message));
  });

  // ============ SOLICITUDES DE CAMBIO DE UN PAGO (solicitud -> aprobación) ============

  // Crear solicitud (usuario sin permiso). Propone editar el pago (campos + comprobante opcional). Motivo obligatorio.
  app.post("/api/oportunidades/:id/pagos/:pagoId/solicitudes", requireAuth, upload.single("comprobante"), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const b = req.body || {};
    const motivo = String(b.motivo || "").trim();
    if (!motivo) { res.status(400).json({ error: "El motivo es obligatorio" }); return; }
    const pago = (await query<any>("SELECT * FROM gozz.oportunidades_pagos WHERE id = $1 AND oportunidad_id = $2 AND anulado = false", [req.params.pagoId, req.params.id]))[0];
    if (!pago) { res.status(404).json({ error: "Pago no encontrado" }); return; }

    // Campos propuestos (solo los presentes)
    const cambios: any = {};
    if (b.monto !== undefined) { const m = Number(b.monto); if (!(m > 0)) { res.status(400).json({ error: "Monto inválido" }); return; } cambios.monto = m; }
    if (typeof b.metodo === "string" && b.metodo) cambios.metodo = b.metodo;
    if (b.titular_tipo === "cliente" || b.titular_tipo === "tercero") cambios.titular_tipo = b.titular_tipo;
    if (b.titular_nombre !== undefined) cambios.titular_nombre = b.titular_nombre || null;
    if (b.fecha_pago !== undefined) cambios.fecha_pago = b.fecha_pago || null;
    if (b.notas !== undefined) cambios.notas = b.notas || null;

    const datosAntes = {
      monto: pago.monto, metodo: pago.metodo, titular_tipo: pago.titular_tipo,
      titular_nombre: pago.titular_nombre, fecha_pago: pago.fecha_pago, notas: pago.notas,
      comprobante_url: pago.comprobante_url,
    };

    const solId = randomUUID();
    const file = (req as any).file as Express.Multer.File | undefined;
    const comprobantePropuesto = file ? { url: placeUploadedFile(path.join(UPLOADS_DIR, file.filename), "pago_solicitud", { opId: String(req.params.id), pagoId: String(req.params.pagoId), solId }, file.filename), filename: file.originalname, mime: file.mimetype } : null;
    const comprobanteModo = (b.comprobante_modo === "reemplazar" || b.comprobante_modo === "adicional") ? b.comprobante_modo : (file ? "adicional" : null);

    const rows = await query<any>(
      `INSERT INTO gozz.oportunidad_pago_solicitudes
         (id, oportunidad_id, pago_id, solicitante_id, cambios_propuestos, datos_antes, comprobante_propuesto, comprobante_modo, motivo)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) RETURNING *`,
      [solId, req.params.id, req.params.pagoId, u.sub, JSON.stringify(cambios), JSON.stringify(datosAntes),
       comprobantePropuesto ? JSON.stringify(comprobantePropuesto) : null, comprobanteModo, motivo]
    );
    // Notificar a los aprobadores (admin/super_admin o permiso 'editar_monto')
    const aprobadores = await query<any>(
      `SELECT us.id FROM gozz.users us
        WHERE us.activo = true AND (
          us.nivel_acceso IN ('admin','super_admin')
          OR EXISTS (SELECT 1 FROM gozz.user_permisos p WHERE p.user_id = us.id AND p.permiso = 'editar_monto')
        )`
    );
    const montoMsg = cambios.monto !== undefined ? `Nuevo monto: $${cambios.monto}. ` : "";
    const opRow = (await query<any>("SELECT nombre_caso FROM gozz.oportunidades WHERE id = $1", [req.params.id]))[0];
    const solicitante = (await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]))[0];
    for (const a of aprobadores) {
      query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
         VALUES ($1,'pago_solicitud','Solicitud de cambio de un pago',$2,'alta',$3)`,
        [a.id, `${montoMsg}Motivo: ${motivo.slice(0,120)}`, `/oportunidades/${req.params.id}`]
      ).catch(() => {});
      emitToUser(a.id, "notificacion:nueva", { tipo: "pago_solicitud" });
      // Banner de aprobación en vivo (como descuentos): pop-up con Aprobar/Rechazar/Ver.
      emitToUser(a.id, "solicitud:oportunidad", {
        solicitud_id: rows[0].id,
        tipo: "pago",
        endpoint_base: "pago-solicitudes",
        oportunidad_id: req.params.id,
        oportunidad_titulo: opRow?.nombre_caso,
        from_user_id: u.sub,
        from_nombre: solicitante?.nombre || "Solicitante",
        from_foto: solicitante?.foto_perfil_url || null,
        detalle: montoMsg.trim() || "Cambio en el pago",
        motivo,
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ solicitud: rows[0] });
  });

  // Listar solicitudes de pago de UNA oportunidad (para indicadores y bandeja inline)
  app.get("/api/oportunidades/:id/pago-solicitudes", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT s.*, us.nombre AS solicitante_nombre, ua.nombre AS aprobador_nombre
         FROM gozz.oportunidad_pago_solicitudes s
         LEFT JOIN gozz.users us ON us.id = s.solicitante_id
         LEFT JOIN gozz.users ua ON ua.id = s.aprobador_id
        WHERE s.oportunidad_id = $1
        ORDER BY s.created_at DESC`,
      [req.params.id]
    );
    res.json({ solicitudes: rows });
  });

  // Aprobar: aplica los cambios propuestos al pago (+ comprobante), recalcula balance, audita y notifica.
  app.post("/api/pago-solicitudes/:solId/aprobar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!(await puedeEditarMontoDirecto(u))) { res.status(403).json({ error: "Solo aprobadores" }); return; }
    const sol = (await query<any>("SELECT * FROM gozz.oportunidad_pago_solicitudes WHERE id = $1 AND estado = 'pendiente'", [req.params.solId]))[0];
    if (!sol) { res.status(404).json({ error: "Solicitud no encontrada o ya resuelta" }); return; }
    const pago = (await query<any>("SELECT * FROM gozz.oportunidades_pagos WHERE id = $1 AND anulado = false", [sol.pago_id]))[0];
    if (!pago) { res.status(404).json({ error: "El pago ya no existe" }); return; }

    // 1) aplicar cambios de campos
    const c = sol.cambios_propuestos || {};
    const sets: string[] = []; const vals: any[] = [];
    if (c.monto !== undefined && c.monto !== null && Number(c.monto) > 0) sets.push(`monto = $${vals.push(Number(c.monto))}`);
    if (typeof c.metodo === "string" && c.metodo) sets.push(`metodo = $${vals.push(c.metodo)}`);
    if (c.titular_tipo === "cliente" || c.titular_tipo === "tercero") sets.push(`titular_tipo = $${vals.push(c.titular_tipo)}`);
    if (c.titular_nombre !== undefined) sets.push(`titular_nombre = $${vals.push(c.titular_nombre)}`);
    if (c.fecha_pago !== undefined && c.fecha_pago !== null) sets.push(`fecha_pago = $${vals.push(c.fecha_pago)}`);
    if (c.notas !== undefined) sets.push(`notas = $${vals.push(c.notas)}`);
    if (sets.length) {
      vals.push(sol.pago_id);
      await query(`UPDATE gozz.oportunidades_pagos SET ${sets.join(", ")} WHERE id = $${vals.length} AND anulado = false`, vals);
    }

    // 2) aplicar comprobante propuesto (reemplazar principal o añadir adicional)
    if (sol.comprobante_propuesto && sol.comprobante_modo) {
      const nuevo = sol.comprobante_propuesto;
      if (sol.comprobante_modo === "adicional") {
        const doc = { ...nuevo, uploaded_at: new Date().toISOString(), uploaded_by: u.sub };
        await query(`UPDATE gozz.oportunidades_pagos SET documentos_adicionales = COALESCE(documentos_adicionales,'[]'::jsonb) || $1::jsonb WHERE id = $2`, [JSON.stringify([doc]), sol.pago_id]);
      } else {
        const comps: any[] = Array.isArray(pago.comprobantes_urls) ? pago.comprobantes_urls : [];
        const newComps = (pago.comprobante_url && comps.some((x) => x.url === pago.comprobante_url))
          ? comps.map((x) => (x.url === pago.comprobante_url ? nuevo : x))
          : [nuevo, ...comps];
        await query(`UPDATE gozz.oportunidades_pagos SET comprobante_url = $1, comprobantes_urls = $2::jsonb WHERE id = $3`, [nuevo.url, JSON.stringify(newComps), sol.pago_id]);
      }
    }

    // 3) recalcular balance con el helper central
    const bal = await recomputeBalance(sol.oportunidad_id);
    const nuevoBalance = bal.balance;

    // 4) marcar solicitud, auditar y notificar al solicitante
    await query("UPDATE gozz.oportunidad_pago_solicitudes SET estado='aprobada', aprobador_id=$1, resolved_at=NOW() WHERE id=$2", [u.sub, sol.id]);
    query(`INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
           VALUES ($1,$2,'oportunidades_pagos',$3,$4::jsonb,$5::jsonb)`,
      [u.sub, `Aprobó cambios en un pago`, String(sol.pago_id), JSON.stringify(sol.datos_antes || {}), JSON.stringify(c)]).catch(() => {});
    const aprobadorNombre = (await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]))[0]?.nombre || "Un administrador";
    query(`INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
           VALUES ($1,'pago_aprobada',$2,$3,'normal',$4)`,
      [sol.solicitante_id, `Tu cambio de pago fue aprobado por ${aprobadorNombre}`, `El cambio en el pago fue aplicado`, `/oportunidades/${sol.oportunidad_id}`]).catch(() => {});
    emitToUser(sol.solicitante_id, "notificacion:nueva", { tipo: "pago_aprobada" });
    res.json({ ok: true, balance_pendiente: nuevoBalance });
  });

  // Rechazar: no cambia el pago
  app.post("/api/pago-solicitudes/:solId/rechazar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!(await puedeEditarMontoDirecto(u))) { res.status(403).json({ error: "Solo aprobadores" }); return; }
    // Obligatorio desde la 0066 (CHECK `rechazada ⇒ motivo_rechazo NOT NULL`). Ver detail-routes.
    const motivoRechazo = String(req.body?.motivo_rechazo || "").trim() || null;
    if (!motivoRechazo) { res.status(400).json({ error: "El motivo del rechazo es obligatorio" }); return; }
    const rows = await query<any>(
      `UPDATE gozz.oportunidad_pago_solicitudes
          SET estado='rechazada', aprobador_id=$1, motivo_rechazo=$2, resolved_at=NOW()
        WHERE id=$3 AND estado='pendiente' RETURNING *`,
      [u.sub, motivoRechazo, req.params.solId]);
    if (!rows[0]) { res.status(404).json({ error: "Solicitud no encontrada o ya resuelta" }); return; }
    const aprobadorNombre = (await query<any>("SELECT nombre FROM gozz.users WHERE id = $1", [u.sub]))[0]?.nombre || "Un administrador";
    query(`INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
           VALUES ($1,'pago_rechazada',$2,$3,'normal',$4)`,
      [rows[0].solicitante_id, `Tu cambio de pago fue rechazado por ${aprobadorNombre}`, motivoRechazo, `/oportunidades/${rows[0].oportunidad_id}`]).catch(() => {});
    emitToUser(rows[0].solicitante_id, "notificacion:nueva", { tipo: "pago_rechazada" });
    res.json({ ok: true });
  });

  // --------- NOTAS DE OPORTUNIDAD ---------
  app.get("/api/oportunidades/:id/notas", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT n.*, u.nombre AS usuario_nombre, u.foto_perfil_url
         FROM gozz.oportunidades_notas n
         LEFT JOIN gozz.users u ON u.id = n.user_id
        WHERE n.oportunidad_id = $1
        ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json({ notas: rows });
  });

  app.post("/api/oportunidades/:id/notas", requireAuth, upload.array("archivo"), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const contenido = String(req.body?.contenido || "").trim();
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!contenido && files.length === 0) { res.status(400).json({ error: "Nota o archivo requerido" }); return; }
    const notaId = randomUUID();
    const archivos = files.map((f) => ({
      url: placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "oportunidad_nota", { opId: String(req.params.id), notaId }, f.filename),
      filename: f.originalname,
      mime: f.mimetype,
      size: f.size
    }));
    const rows = await query<any>(
      `INSERT INTO gozz.oportunidades_notas (id, oportunidad_id, user_id, contenido, archivos)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [notaId, req.params.id, u.sub, contenido, JSON.stringify(archivos)]
    );
    res.json({ nota: rows[0] });
  });

  // Editar una nota: texto y/o adjuntos (conserva los existentes + sube nuevos). Workflow colaborativo.
  app.patch("/api/oportunidades/:id/notas/:notaId", requireAuth, upload.array("archivo"), async (req: Request, res: Response) => {
    const contenido = String(req.body?.contenido ?? "").trim();
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    let keep: any[] = [];
    try { const k = JSON.parse(String(req.body?.archivos_keep ?? "[]")); if (Array.isArray(k)) keep = k; } catch { keep = []; }
    const nuevos = files.map((f) => ({ url: placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "oportunidad_nota", { opId: String(req.params.id), notaId: String(req.params.notaId) }, f.filename), filename: f.originalname, mime: f.mimetype, size: f.size }));
    const archivos = [...keep, ...nuevos];
    if (!contenido && archivos.length === 0) { res.status(400).json({ error: "La nota no puede quedar vacía" }); return; }
    const prevNota = (await query<any>("SELECT archivos FROM gozz.oportunidades_notas WHERE id = $1 AND oportunidad_id = $2", [req.params.notaId, req.params.id]))[0];
    const keepUrls = new Set(archivos.map((a: any) => a?.url));
    const quitados = (Array.isArray(prevNota?.archivos) ? prevNota.archivos : []).map((a: any) => a?.url).filter((url: any) => typeof url === "string" && !keepUrls.has(url));
    const rows = await query<any>(
      `UPDATE gozz.oportunidades_notas SET contenido = $1, archivos = $2::jsonb, updated_at = NOW()
        WHERE id = $3 AND oportunidad_id = $4 RETURNING *`,
      [contenido, JSON.stringify(archivos), req.params.notaId, req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "Nota no encontrada" }); return; }
    res.json({ nota: rows[0] });
    deleteUploadsIfUnreferenced(quitados, { origen: "cascade_nota", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup op-nota-patch]", e?.message));
  });

  app.delete("/api/oportunidades/:id/notas/:notaId", requireAuth, async (req: Request, res: Response) => {
    // Cualquier usuario autenticado puede eliminar notas (antes: solo admin).
    const prev = (await query<any>("SELECT archivos FROM gozz.oportunidades_notas WHERE id = $1 AND oportunidad_id = $2", [req.params.notaId, req.params.id]))[0];
    await query(
      "DELETE FROM gozz.oportunidades_notas WHERE id = $1 AND oportunidad_id = $2",
      [req.params.notaId, req.params.id]
    );
    res.json({ ok: true });
    deleteUploadsIfUnreferenced((Array.isArray(prev?.archivos) ? prev.archivos : []).map((a: any) => a?.url), { origen: "cascade_nota", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup op-nota-del]", e?.message));
  });

  // --------- ORGANIGRAMA + CARGOS ---------
  app.get("/api/equipo/organigrama", requireAuth, async (_req: Request, res: Response) => {
    const usuarios = await query<any>(
      `SELECT u.id, u.nombre, u.email, u.foto_perfil_url, u.nivel_acceso, u.activo,
              up.supervisor_id, up.departamento_id, up.cargo_id,
              d.nombre AS departamento_nombre, d.color AS departamento_color,
              c.codigo AS cargo_codigo, c.nombre AS cargo_nombre, c.valor_punto_usd
         FROM gozz.users u
         LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = u.id
         LEFT JOIN gozz.departamentos d ON d.id = up.departamento_id
         LEFT JOIN gozz.cargos c ON c.id = up.cargo_id
        WHERE u.activo = true
        ORDER BY u.nombre`
    );
    res.json({ usuarios });
  });

  // Organigrama visual agrupado por departamento
  app.get("/api/equipo/organigrama-visual", requireAuth, async (_req: Request, res: Response) => {
    const departamentos = await query<any>(
      `SELECT d.id, d.nombre, d.color, d.jefe_id, d.parent_id,
              COALESCE(d.pos_x, 0) AS pos_x, COALESCE(d.pos_y, 0) AS pos_y,
              COALESCE(d.orden, 0) AS orden,
              COUNT(u.id)::int AS empleados_count,
              jefe.nombre AS jefe_nombre, jefe.foto_perfil_url AS jefe_foto
         FROM gozz.departamentos d
         LEFT JOIN gozz.usuarios_perfil up ON up.departamento_id = d.id
         LEFT JOIN gozz.users u ON u.id = up.usuario_id AND u.activo = true
         LEFT JOIN gozz.users jefe ON jefe.id = d.jefe_id
         GROUP BY d.id, d.nombre, d.color, d.jefe_id, d.parent_id, d.pos_x, d.pos_y, d.orden, jefe.nombre, jefe.foto_perfil_url
         ORDER BY d.parent_id NULLS FIRST, d.orden, d.nombre`
    );

    const usuarios = await query<any>(
      `SELECT u.id, u.nombre, u.email, u.foto_perfil_url, u.nivel_acceso, u.activo,
              up.supervisor_id, up.departamento_id, up.cargo_id,
              c.codigo AS cargo_codigo, c.nombre AS cargo_nombre
         FROM gozz.users u
         LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = u.id
         LEFT JOIN gozz.cargos c ON c.id = up.cargo_id
        WHERE u.activo = true
        ORDER BY u.nombre`
    );

    // CEO = super_admin como raíz (o el usuario inmutable como Alessandro Garagozzo)
    const ceoUsers = usuarios.filter((u) => u.nivel_acceso === "super_admin");

    res.json({ departamentos, usuarios, ceo: ceoUsers[0] || null });
  });

  app.get("/api/equipo/cargos", requireAuth, async (_req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT c.*, d.nombre AS departamento_nombre
         FROM gozz.cargos c
         LEFT JOIN gozz.departamentos d ON d.id = c.departamento_id
        WHERE c.activo = true
        ORDER BY c.nombre`
    );
    res.json({ cargos: rows });
  });

  app.patch("/api/equipo/cargos/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const fields = ["nombre", "valor_punto_usd", "departamento_id"].filter((f) => f in (req.body || {}));
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const setParts = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const values = fields.map((f) => (req.body as any)[f]);
    const rows = await query<any>(
      `UPDATE gozz.cargos SET ${setParts} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json({ cargo: rows[0] });
  });

  app.patch("/api/equipo/usuarios/:id/perfil", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const { supervisor_id, departamento_id, cargo_id } = req.body || {};

    await query(
      `INSERT INTO gozz.usuarios_perfil (usuario_id, supervisor_id, departamento_id, cargo_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO UPDATE SET
         supervisor_id = COALESCE(EXCLUDED.supervisor_id, gozz.usuarios_perfil.supervisor_id),
         departamento_id = COALESCE(EXCLUDED.departamento_id, gozz.usuarios_perfil.departamento_id),
         cargo_id = COALESCE(EXCLUDED.cargo_id, gozz.usuarios_perfil.cargo_id),
         updated_at = NOW()`,
      [req.params.id, supervisor_id || null, departamento_id || null, cargo_id || null]
    );
    res.json({ ok: true });
  });
  // GET /api/reportes/tareas — stats agregadas
  app.get("/api/reportes/tareas", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const isAdmin = u.nivel === "super_admin" || u.nivel === "admin";
    const scope = (req.query.scope as string) || "mine";
    const desde = (req.query.desde as string) || "";
    const hasta = (req.query.hasta as string) || "";
    const userId = (req.query.user_id as string) || "";

    // Solo admins pueden hacer scope=all o filtrar por otro user
    const effectiveUserId = isAdmin && (scope === "all" || userId)
      ? (userId || null)
      : u.sub;

    const params: any[] = [];
    const wheres: string[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };

    if (effectiveUserId) {
      const p = addP(effectiveUserId);
      wheres.push(`(t.responsable_id = ${p} OR t.propietario_id = ${p})`);
    }
    if (desde) wheres.push(`t.created_at >= ${addP(desde + " 00:00:00")}`);
    if (hasta) wheres.push(`t.created_at <= ${addP(hasta + " 23:59:59")}`);
    const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";

    try {
      // Totales globales del filtro
      const totals = await query<any>(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE t.estado = 'pendiente')::int AS pendientes,
          COUNT(*) FILTER (WHERE t.estado = 'en_progreso')::int AS en_progreso,
          COUNT(*) FILTER (WHERE t.estado = 'completada')::int AS completadas,
          COUNT(*) FILTER (WHERE t.estado = 'cancelada')::int AS canceladas,
          COUNT(*) FILTER (WHERE t.urgente = true AND t.estado NOT IN ('completada','cancelada'))::int AS urgentes_activas,
          COUNT(*) FILTER (WHERE t.fecha_limite IS NOT NULL AND t.fecha_limite < now() AND t.estado NOT IN ('completada','cancelada'))::int AS vencidas,
          COUNT(*) FILTER (WHERE t.fecha_completada >= date_trunc('day', now()))::int AS completadas_hoy,
          COUNT(*) FILTER (WHERE t.fecha_completada >= date_trunc('week', now()))::int AS completadas_semana,
          COUNT(*) FILTER (WHERE t.fecha_completada >= date_trunc('month', now()))::int AS completadas_mes
        FROM gozz.tareas t
        ${whereSql}`,
        params
      );

      // Por prioridad
      const porPrioridad = await query<any>(
        `SELECT COALESCE(t.prioridad, 'normal') AS prioridad, COUNT(*)::int AS cantidad
         FROM gozz.tareas t
         ${whereSql}
         GROUP BY 1
         ORDER BY CASE COALESCE(t.prioridad, 'normal')
            WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 WHEN 'baja' THEN 4 ELSE 5 END`,
        params
      );

      // Por estado
      const porEstado = await query<any>(
        `SELECT t.estado, COUNT(*)::int AS cantidad
         FROM gozz.tareas t
         ${whereSql}
         GROUP BY 1`,
        params
      );

      // Por responsable (top 10)
      const porResponsable = await query<any>(
        `SELECT
            u.id AS user_id,
            u.nombre,
            u.foto_perfil_url,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t.estado = 'pendiente')::int AS pendientes,
            COUNT(*) FILTER (WHERE t.estado = 'en_progreso')::int AS en_progreso,
            COUNT(*) FILTER (WHERE t.estado = 'completada')::int AS completadas,
            COUNT(*) FILTER (WHERE t.fecha_limite < now() AND t.estado NOT IN ('completada','cancelada'))::int AS vencidas
         FROM gozz.tareas t
         JOIN gozz.users u ON u.id = t.responsable_id
         ${whereSql}
         GROUP BY u.id, u.nombre, u.foto_perfil_url
         ORDER BY total DESC
         LIMIT 10`,
        params
      );

      // Tendencia últimos 30 días (creadas por día)
      const tendencia = await query<any>(
        `SELECT
            to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') AS fecha,
            COUNT(*)::int AS creadas,
            COUNT(*) FILTER (WHERE t.estado = 'completada')::int AS completadas
         FROM gozz.tareas t
         WHERE t.created_at >= now() - interval '30 days'
           ${effectiveUserId ? "AND (t.responsable_id = $" + (params.length + 1) + " OR t.propietario_id = $" + (params.length + 1) + ")" : ""}
         GROUP BY 1
         ORDER BY 1`,
        effectiveUserId ? [...params, effectiveUserId] : params
      );

      // Tareas vencidas detalladas
      const vencidasDetalle = await query<any>(
        `SELECT
            t.id, t.titulo, t.prioridad, t.urgente, t.fecha_limite,
            EXTRACT(EPOCH FROM (now() - t.fecha_limite)) / 86400 AS dias_vencida,
            u.nombre AS responsable_nombre, u.foto_perfil_url AS responsable_foto
         FROM gozz.tareas t
         LEFT JOIN gozz.users u ON u.id = t.responsable_id
         WHERE t.fecha_limite IS NOT NULL
           AND t.fecha_limite < now()
           AND t.estado NOT IN ('completada','cancelada')
           ${effectiveUserId ? "AND (t.responsable_id = $" + (params.length + 1) + " OR t.propietario_id = $" + (params.length + 1) + ")" : ""}
         ORDER BY t.fecha_limite ASC
         LIMIT 20`,
        effectiveUserId ? [...params, effectiveUserId] : params
      );

      res.json({
        totales: totals[0] || {},
        por_prioridad: porPrioridad,
        por_estado: porEstado,
        por_responsable: porResponsable,
        tendencia,
        vencidas: vencidasDetalle,
      });
    } catch (e: any) {
      console.error("[reportes/tareas]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });




  // Update departamento (jerarquía + posición + jefe)
  app.patch("/api/equipo/departamentos/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const allowed = ["parent_id", "pos_x", "pos_y", "orden", "jefe_id", "nombre", "color"];
    const fields = allowed.filter((f) => f in (req.body || {}));
    if (fields.length === 0) { res.json({ ok: true }); return; }
    const setParts = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const values = fields.map((f) => (req.body as any)[f]);
    const rows = await query<any>(
      `UPDATE gozz.departamentos SET ${setParts} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json({ departamento: rows[0] });
  });



  // =============== Puntajes admin: bono manual + anular ===============
  app.post("/api/equipo/puntajes/bono", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const { user_id, puntos, valor_punto_usd, motivo } = req.body || {};
    if (!user_id || !puntos) { res.status(400).json({ error: "user_id y puntos requeridos" }); return; }
    const valor = Number(valor_punto_usd) > 0 ? Number(valor_punto_usd) : 1;
    const rows = await query<any>(
      `INSERT INTO gozz.puntajes_historial (user_id, puntos, valor_punto_usd, motivo)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user_id, Number(puntos), valor, (motivo || "bono_manual").slice(0, 200)]
    );
    res.json({ puntaje: rows[0] });
  });

  app.delete("/api/equipo/puntajes/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    await query("DELETE FROM gozz.puntajes_historial WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  });

  // GET listado consolidado: usuarios con totales + cargos
  app.get("/api/equipo/puntajes-resumen", requireAuth, async (_req: Request, res: Response) => {
    const usuarios = await query<any>(
      `SELECT
          u.id, u.nombre, u.foto_perfil_url, u.activo,
          c.codigo AS cargo_codigo, c.nombre AS cargo_nombre, c.valor_punto_usd AS cargo_valor_punto,
          COALESCE(SUM(ph.puntos), 0)::numeric(10,2) AS puntos_total,
          COALESCE(SUM(ph.monto_usd), 0)::numeric(12,2) AS usd_total,
          COUNT(ph.id)::int AS registros
        FROM gozz.users u
        LEFT JOIN gozz.usuarios_perfil up ON up.usuario_id = u.id
        LEFT JOIN gozz.cargos c ON c.id = up.cargo_id
        LEFT JOIN gozz.puntajes_historial ph ON ph.user_id = u.id
       WHERE u.activo = true
       GROUP BY u.id, u.nombre, u.foto_perfil_url, u.activo, c.codigo, c.nombre, c.valor_punto_usd
       ORDER BY usd_total DESC, u.nombre`
    );
    const cargos = await query<any>(
      `SELECT id, codigo, nombre, valor_punto_usd FROM gozz.cargos WHERE activo = true ORDER BY nombre`
    );
    res.json({ usuarios, cargos });
  });

}
