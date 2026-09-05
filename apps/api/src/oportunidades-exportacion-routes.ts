// ============================================================================================
// EXPORTACIÓN DE OPORTUNIDADES — endpoints
//
// 🔴 ES EL ÚNICO PUNTO DEL CRM POR DONDE LOS DATOS DE CLIENTES SALEN A UN TERCERO. Todo lo de aquí
// está escrito con eso delante: la lista blanca de columnas (R11), el permiso propio, y la fila de
// `auditoria` que deja constancia de cada descarga.
//
// Dos endpoints:
//   · `POST /api/oportunidades/exportar/previa` → cuántas van a salir y qué columnas hay. No escribe.
//   · `POST /api/oportunidades/exportar`        → el fichero, en streaming.
// ============================================================================================

import type { Express, Request, Response } from "express";
import { requireAuth } from "./shared/auth-middleware.js";
import { puede } from "./lib/permisos.js";
import { parsearSeleccion } from "./lib/seleccion.js";
import {
  CABECERAS_FORMATO,
  esFormato,
  escribirExportacion,
  type FormatoExportacion,
} from "./lib/exportacion.js";
import {
  columnasParaLaInterfaz,
  contarExportables,
  iterarExportables,
  registrarExportacion,
  validarColumnas,
} from "./lib/oportunidades-exportacion.js";

/**
 * El permiso, siguiendo `verbo_objeto` (§2.7): **lo que sale son oportunidades**.
 * `exportar_contactos` queda para su entrega, que exporta otra cosa con otras reglas.
 *
 * 🔴 No está sembrado en ninguna migración. Por la regla de `puede()`, admin y super_admin ya lo
 * tienen; dárselo a alguien concreto es un INSERT en `gozz.user_permisos`.
 */
export const PERMISO_EXPORTAR = "exportar_oportunidades";

/**
 * El nombre del fichero que se descarga: `oportunidades_2026-08-13_14-22-07.csv`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 LA ZONA ES `America/New_York`, NO UTC
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Antes esto usaba `new Date().toISOString()`, que es UTC. En horario de verano de Miami son
 * **cuatro horas de desfase**: cualquier exportación hecha después de las 20:00 salía **con la
 * fecha del día siguiente**. Con solo la fecha en el nombre el error pasaba desapercibido; al
 * añadir la hora se habría vuelto evidente y más confuso todavía.
 *
 * Y hay una segunda razón para esta zona y no otra: **las fechas que van DENTRO del fichero las
 * escribe Postgres con `to_char` en la zona de su sesión**. Si el nombre dijera una cosa y las
 * columnas otra, el fichero se contradiría a sí mismo.
 *
 * `Intl.DateTimeFormat("en-CA", …)` con `formatToParts` es lo que ya hace el resto del proyecto
 * (`clock-routes.ts`, `recognitions-routes.ts`).
 * ⚠️ `hourCycle: "h23"` NO es decorativo: sin él, `en-CA` devuelve `08:30:00 p.m.` — con punto y
 * con espacio, las dos cosas que este nombre no puede llevar.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE FORMATO
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * · **Con hora, no solo fecha.** Dos exportaciones el mismo día eran indistinguibles y el sistema
 *   operativo las desempataba con "(2)", "(3)", que no dice cuándo se sacó cada una.
 * · **Con segundos.** Dos descargas seguidas caben en el mismo minuto.
 * · 🔴 **Separadores `-` en la hora, nunca `:`.** Los dos puntos son ilegales en nombres de fichero
 *   en Windows y complican la cabecera `Content-Disposition`. El `_` separa fecha de hora.
 * · Sin espacios y sin más puntos que el de la extensión: acaba en una cabecera HTTP.
 *
 * `ahora` es un parámetro para poder fijar el instante en las pruebas; en producción nadie lo pasa.
 */
export function nombreFichero(formato: string, ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `oportunidades_${p("year")}-${p("month")}-${p("day")}_${p("hour")}-${p("minute")}-${p("second")}.${formato}`;
}

export function registerOportunidadesExportacionRoutes(app: Express) {
  // ── Qué se va a llevar, antes de llevárselo ───────────────────────────────────────────────
  app.post("/api/oportunidades/exportar/previa", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { seleccion, error } = parsearSeleccion(req.body);
    if (error || !seleccion) { res.status(400).json({ error }); return; }

    // 🔴 El número se cuenta AQUÍ con el mismo WHERE de la pantalla. Con "seleccionar el total" el
    // usuario no ha visto las filas: este número es lo único que le dice qué está a punto de sacar.
    const total = await contarExportables(seleccion, u?.sub ?? null);

    res.json({
      total,
      columnas: columnasParaLaInterfaz(),
      // La interfaz enseña la acción a todo el mundo (no se oculta un botón por permisos, §4.2);
      // lo que cambia es lo que se puede hacer al llegar aquí.
      puede_exportar: await puede(u?.sub, PERMISO_EXPORTAR),
    });
  });

  // ── El fichero ────────────────────────────────────────────────────────────────────────────
  app.post("/api/oportunidades/exportar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;

    // ── Todo lo que puede fallar, ANTES de tocar las cabeceras ───────────────────────────────
    // Una vez empieza el streaming ya no se puede responder un JSON de error: la respuesta lleva
    // cabeceras de descarga y un cuerpo a medias. Así que aquí se valida todo primero.
    if (!(await puede(u?.sub, PERMISO_EXPORTAR))) {
      res.status(403).json({
        error: "Exportar oportunidades requiere aprobación. Pídesela a un administrador.",
        requiere_aprobacion: true,
      });
      return;
    }

    const { seleccion, error } = parsearSeleccion(req.body);
    if (error || !seleccion) { res.status(400).json({ error }); return; }

    const { columnas, error: eCols } = validarColumnas(req.body?.columnas);
    if (eCols || !columnas) { res.status(400).json({ error: eCols }); return; }

    const formato = String(req.body?.formato || "csv");
    if (!esFormato(formato)) { res.status(400).json({ error: "formato debe ser 'csv' o 'xlsx'" }); return; }

    const total = await contarExportables(seleccion, u?.sub ?? null);
    if (total === 0) { res.status(400).json({ error: "La selección no incluye ninguna oportunidad" }); return; }

    // ── A partir de aquí ya se está escribiendo el fichero ───────────────────────────────────
    res.setHeader("Content-Type", CABECERAS_FORMATO[formato as FormatoExportacion]);
    res.setHeader("Content-Disposition", `attachment; filename="${nombreFichero(formato)}"`);
    // Sin `Content-Length`: no se sabe hasta haber escrito, y saberlo exigiría construir el fichero
    // entero en memoria, que es justo lo que este endpoint evita.
    res.setHeader("Cache-Control", "no-store");

    let filas = 0;
    try {
      filas = await escribirExportacion(
        formato as FormatoExportacion,
        res,
        columnas,
        iterarExportables(seleccion, u?.sub ?? null, columnas),
        "Oportunidades"
      );
      res.end();
    } catch (e: any) {
      // Ya hay cabeceras enviadas: no hay forma honesta de convertir esto en un 500 con JSON. Se
      // corta la conexión, que es lo que hace que el navegador marque la descarga como fallida en
      // vez de dejar un fichero truncado que parece bueno.
      console.error("[exportar oportunidades]", e?.message);
      res.destroy(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    // La constancia, con el número REAL de filas. Ver `registrarExportacion` para el porqué de
    // guardar el alcance y NO el contenido.
    await registrarExportacion({
      userId: u?.sub || null,
      filas,
      formato,
      columnas: columnas.map((c) => c.clave),
      seleccion,
      totalAlContar: total,
    });
  });
}
