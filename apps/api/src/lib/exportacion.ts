// ============================================================================================
// MOTOR DE ESCRITURA DE EXPORTACIONES — CSV y XLSX, en streaming de verdad
//
// Vive en `lib/` y no dentro de una ruta porque **la exportación de contactos lo va a reutilizar**:
// la maquinaria de escribir un fichero tabular no es del dominio de oportunidades. Lo propio de
// cada dominio es qué columnas hay y de dónde salen las filas; eso lo pone el llamador.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 STREAMING DE VERDAD, NO "CASI"
// ════════════════════════════════════════════════════════════════════════════════════════════
// El proyecto tiene dos patrones de exportación y **ninguno de los dos sirve aquí**:
//
//   · `reportes-routes.ts` (asistencia) → `wb.xlsx.writeBuffer()`: construye el libro entero en
//     memoria Y ADEMÁS lo duplica en un Buffer antes de mandarlo.
//   · `reportes-routes.ts` (puntajes) → `wb.xlsx.write(res)`: no duplica el buffer, pero **sigue
//     construyendo el libro entero en memoria**. Para unos cientos de filas da igual; para
//     "exportar todas" —miles de oportunidades— no.
//
// Aquí se usa `ExcelJS.stream.xlsx.WorkbookWriter`, que emite cada fila al `res` y la suelta. El
// consumo no crece con el número de filas: crece con el tamaño del LOTE, que fija el llamador.
//
// El CSV no tenía precedente en el proyecto. Se escribe directo al `res`, con los dos cuidados que
// no son opcionales (BOM y escapado) — ver abajo, cada uno con su porqué.
// ============================================================================================

import ExcelJS from "exceljs";
import type { Writable } from "node:stream";

/** Una columna del fichero: la clave con la que viene el dato y la cabecera que se escribe. */
export interface ColumnaSalida {
  clave: string;
  etiqueta: string;
}

/**
 * De dónde salen las filas. Un **generador por lotes**, no un array: es lo que permite que el
 * llamador recorra la tabla por tandas y que aquí nunca haya más de un lote vivo.
 */
export type FuenteDeFilas = AsyncIterable<Record<string, any>[]>;

// --------------------------------------------------------------------------------------------
// CSV
// --------------------------------------------------------------------------------------------

/**
 * 🔴 EL BOM UTF-8. Sin él, **Excel abre el fichero con los acentos rotos** —"Rodríguez" sale como
 * "RodrÃ­guez"— y parece un fichero corrupto. Alguien va a abrirlo antes de subirlo a un CRM externo, y
 * lo primero que hará es pensar que la exportación está mal. Son tres bytes.
 */
export const BOM_UTF8 = "﻿";

/**
 * 🔴 EL ESCAPADO, Y POR QUÉ ROMPE EN SILENCIO.
 *
 * Un nombre de caso con una coma —"Asilo Pérez, Juan"— **parte la fila en dos columnas** si no se
 * entrecomilla. El fichero se genera sin error, se descarga sin error y **entra mal en un CRM externo
 * sin dar ningún error**: se descubre cuando la campaña sale rara, días después.
 *
 * Regla RFC 4180: si el valor contiene coma, comilla doble, salto de línea o retorno de carro, se
 * envuelve en comillas y **las comillas internas se duplican**.
 *
 * ⚠️ El espacio inicial también fuerza comillas: sin ellas algunos lectores lo recortan y un
 * teléfono con espacio delante deja de cuadrar al comparar.
 */
export function escaparCsv(valor: any): string {
  if (valor === null || valor === undefined) return "";
  const s = String(valor);
  if (s === "") return "";
  if (/[",\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Una línea CSV a partir de las columnas pedidas. CRLF, que es lo que espera Excel. */
export const filaCsv = (columnas: ColumnaSalida[], fila: Record<string, any>): string =>
  columnas.map((c) => escaparCsv(fila[c.clave])).join(",") + "\r\n";

/**
 * Escribe el CSV entero en el destino. Devuelve cuántas filas de datos salieron.
 *
 * Se respeta la contrapresión (`write` → `drain`): sin eso, un cliente lento hace que el buffer del
 * socket crezca sin límite y el proceso acabe comiéndose la memoria que el streaming venía a
 * ahorrar. Es la mitad del trabajo que la gente se salta al "hacer streaming".
 */
export async function escribirCsv(
  destino: Writable,
  columnas: ColumnaSalida[],
  fuente: FuenteDeFilas
): Promise<number> {
  const escribir = (txt: string) =>
    new Promise<void>((resolve, reject) => {
      if (destino.write(txt)) return resolve();
      destino.once("drain", resolve);
      destino.once("error", reject);
    });

  await escribir(BOM_UTF8 + columnas.map((c) => escaparCsv(c.etiqueta)).join(",") + "\r\n");
  let n = 0;
  for await (const lote of fuente) {
    if (lote.length === 0) continue;
    // Una sola escritura por lote: mil `write()` de una línea cada uno cuestan mil viajes al socket.
    await escribir(lote.map((f) => filaCsv(columnas, f)).join(""));
    n += lote.length;
  }
  return n;
}

// --------------------------------------------------------------------------------------------
// XLSX
// --------------------------------------------------------------------------------------------

/**
 * Escribe el XLSX en el destino, fila a fila.
 *
 * `useSharedStrings: false` a propósito: la tabla de cadenas compartidas **es un diccionario en
 * memoria que crece con cada texto distinto** — justo lo que no queremos con miles de nombres. El
 * fichero sale algo más grande y se escribe sin acumular.
 *
 * `useStyles: false` por lo mismo, y porque aquí no hay estilos que dar: es un fichero para
 * importar en otra herramienta, no un informe para mirar.
 */
export async function escribirXlsx(
  destino: Writable,
  columnas: ColumnaSalida[],
  fuente: FuenteDeFilas,
  nombreHoja = "Datos"
): Promise<number> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: destino,
    useStyles: false,
    useSharedStrings: false,
  });
  const hoja = wb.addWorksheet(nombreHoja);
  hoja.columns = columnas.map((c) => ({ header: c.etiqueta, key: c.clave }));

  let n = 0;
  for await (const lote of fuente) {
    for (const f of lote) {
      // `commit()` por fila es lo que la suelta: sin él, `WorkbookWriter` las va acumulando.
      hoja.addRow(columnas.map((c) => f[c.clave] ?? null)).commit();
      n += 1;
    }
  }
  hoja.commit();
  await wb.commit();
  return n;
}

// --------------------------------------------------------------------------------------------

export type FormatoExportacion = "csv" | "xlsx";

export const FORMATOS: FormatoExportacion[] = ["csv", "xlsx"];

export const esFormato = (v: any): v is FormatoExportacion => FORMATOS.includes(String(v) as any);

export const CABECERAS_FORMATO: Record<FormatoExportacion, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Escribe en el formato pedido. Un solo sitio donde elegir, para que las rutas no ramifiquen. */
export function escribirExportacion(
  formato: FormatoExportacion,
  destino: Writable,
  columnas: ColumnaSalida[],
  fuente: FuenteDeFilas,
  nombreHoja?: string
): Promise<number> {
  return formato === "csv"
    ? escribirCsv(destino, columnas, fuente)
    : escribirXlsx(destino, columnas, fuente, nombreHoja);
}
