"use client";
// Paginación genérica y reutilizable (Drive papelera/árbol la reusan). Presenta prev/next + rango "X–Y de N".
// Agnóstica a la estrategia de datos: hoy la alimenta offset/limit; si mañana pasa a keyset, la UI no cambia
// (el padre calcula page/total; acá solo se navega hacia adelante/atrás y se muestra la posición).
// Extensión (Ola 1 de Contactos): selector de tamaño de página y saltos a primera/última.
// TODAS las props nuevas son OPCIONALES y sin ellas el componente se comporta EXACTAMENTE como
// antes — Drive lo usa en 5 sitios (papelera, árbol, subcarpetas, archivos, búsqueda) y no puede
// cambiar de conducta.
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  disabled?: boolean;
  className?: string;
  /** Si se pasa (junto con onPageSizeChange), muestra el selector de tamaño de página. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (n: number) => void;
  /** Añade los botones de primera y última página. */
  showFirstLast?: boolean;
  /**
   * Variante estrecha, para sitios donde no caben 5 botones y dos contadores — el pie de una
   * columna del tablero de Oportunidades mide 264 px por dentro.
   *
   * Encoge los botones y **quita el "página / total"**: el rango `21–40 de 3.072` ya dice dónde
   * estás, y repetirlo es lo único prescindible cuando el ancho manda. Opcional: sin ella el
   * componente se comporta EXACTAMENTE como antes.
   */
  compact?: boolean;
}

export function Pagination({
  page, pageSize, total, onPageChange, disabled, className,
  pageSizeOptions, onPageSizeChange, showFirstLast, compact,
}: Props) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const canPrev = !disabled && page > 1;
  const canNext = !disabled && page < totalPages;
  const btn = cn(
    "rounded-lg bg-white/70 hover:bg-white text-neutral-600 flex items-center justify-center transition disabled:opacity-40 disabled:cursor-not-allowed",
    compact ? "h-7 w-7" : "h-8 w-8"
  );
  const icono = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const mostrarSelector = !!pageSizeOptions?.length && !!onPageSizeChange;
  return (
    <div className={cn(
      "flex items-center justify-between border-t border-black/5",
      compact ? "gap-1 px-1 py-2" : "gap-3 px-4 py-3",
      className
    )}>
      <div className="flex items-center gap-3">
        <p className={cn("text-neutral-500 whitespace-nowrap", compact ? "text-[10px]" : "text-[12px]")}>
          <span className="font-bold text-neutral-700 tabular-nums">{from}–{to}</span> de{" "}
          <span className="font-bold text-neutral-700 tabular-nums">{total}</span>
        </p>
        {mostrarSelector && (
          <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            <span className="sr-only">Contactos por página</span>
            <select
              value={pageSize}
              disabled={disabled}
              onChange={(e) => onPageSizeChange!(Number(e.target.value))}
              title="Contactos por página"
              className="h-8 pl-2 pr-6 rounded-lg bg-white/70 border border-black/5 text-[12px] font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-brand-orange/30 cursor-pointer disabled:opacity-40"
            >
              {pageSizeOptions!.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>por página</span>
          </label>
        )}
      </div>
      <div className={cn("flex items-center", compact ? "gap-0.5" : "gap-1.5")}>
        {showFirstLast && (
          <button type="button" disabled={!canPrev} onClick={() => onPageChange(1)} title="Primera página" className={btn}>
            <ChevronsLeft className={icono} />
          </button>
        )}
        <button type="button" disabled={!canPrev} onClick={() => onPageChange(page - 1)} title="Página anterior" className={btn}>
          <ChevronLeft className={icono} />
        </button>
        {!compact && (
          <span className="text-[12px] font-bold text-neutral-600 px-2 tabular-nums">{page} / {totalPages}</span>
        )}
        <button type="button" disabled={!canNext} onClick={() => onPageChange(page + 1)} title="Página siguiente" className={btn}>
          <ChevronRight className={icono} />
        </button>
        {showFirstLast && (
          <button type="button" disabled={!canNext} onClick={() => onPageChange(totalPages)} title="Última página" className={btn}>
            <ChevronsRight className={icono} />
          </button>
        )}
      </div>
    </div>
  );
}
