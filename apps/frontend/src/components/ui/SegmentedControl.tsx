"use client";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { alPulsarSegmento, siguienteSegmento } from "@/lib/segmented-control";

// ============================================================================================
// SEGMENTED CONTROL — un conmutador de N opciones, compartido
//
// Patrón de referencia: LINE Design System · Navigations · Segmented Control.
//
// 🔴 ES UN COMPONENTE COMPARTIDO A PROPÓSITO, PORQUE ESTE PROYECTO YA TIENE CINCO ESCRITOS A MANO,
// cada uno en su pantalla y ninguno reutilizable:
//   · lista / galería      → `components/drive/DriveBrowser.tsx`
//   · lista / galería      → `app/contactos/[id]/page.tsx`  (una segunda copia del mismo)
//   · MIS TAREAS / TODAS   → `app/tareas/page.tsx`
//   · ACTIVAS / VENCIDAS / COMPLETADAS / TODAS → la misma pantalla
//   · lista / tablero / fechas                 → la misma pantalla
//
// **No se migran aquí** —es otra entrega, y cada uno tiene su aspecto ya validado— pero quedan
// escritos arriba para que el próximo que toque uno sepa que hay a dónde ir en vez de escribir el
// sexto.
//
// ⚠️ NO SABE NADA DE AGENTES DE SEGURO ni de contactos. Recibe opciones con título y subtítulo y
// devuelve el valor elegido; se puede poner en cualquier pantalla.
//
// 🔴 SE PUEDE QUEDAR SIN NINGUNO SELECCIONADO, y no es un descuido: **pulsar el segmento activo lo
// deselecciona**. Un segmented control normalmente siempre tiene uno marcado, y eso convertiría un
// clic por error en algo irreversible. La regla vive en `lib/segmented-control.ts`, con pruebas.
// ============================================================================================

export interface OpcionSegmento {
  valor: string;
  titulo: string;
  /**
   * Segunda línea, opcional.
   *
   * 🔴 EL HUECO SE RESERVA AUNQUE NO HAYA SUBTÍTULO. Sin eso, un segmento sin segunda línea queda
   * más bajo que sus vecinos y el control se ve torcido — que es exactamente lo que pasaría con
   * «Otro» al lado de dos nombres con apellido.
   */
  subtitulo?: string;
}

export function SegmentedControl({ opciones, valor, onChange, ariaLabel, className, tituloDeseleccion }: {
  opciones: OpcionSegmento[];
  /** El valor elegido, o `null` si no hay ninguno. */
  valor: string | null;
  onChange: (v: string | null) => void;
  ariaLabel: string;
  className?: string;
  /** Qué dice el segmento activo al pasar por encima. Ver el `title` de abajo. */
  tituloDeseleccion?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const valores = opciones.map((o) => o.valor);

  const mover = (direccion: 1 | -1) => {
    const destino = siguienteSegmento(valor, valores, direccion);
    if (destino === null) return;
    onChange(destino);
    // El foco sigue a la selección: si no, la siguiente flecha partiría de donde está el foco y no
    // de lo que se ve marcado, y el control se volvería impredecible con el teclado.
    refs.current[valores.indexOf(destino)]?.focus();
  };

  return (
    // `radiogroup` y no `tablist`: esto elige un valor, no cambia de vista. El lector de pantalla
    // tiene que anunciarlo como un grupo de opciones excluyentes.
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); mover(1); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
      }}
      // Carril CLARO, del mismo palo que los botones Sí/No de la ficha: fondo blanco y un borde
      // gris suave. Los tokens salen de `tailwind.config.ts`; ni un hex suelto (§4.3).
      //
      // ⚠️ SIN RELLENO INTERNO, y a propósito: con `p-*` el carril asoma alrededor del segmento
      // activo y le dibuja un marco que no queríamos. Los segmentos van a ras del borde y el
      // `overflow-hidden` les recorta las esquinas contra el redondeo del contenedor.
      className={cn("flex items-stretch rounded-xl bg-white border border-neutral-200 overflow-hidden", className)}
    >
      {opciones.map((o, i) => {
        const activo = valor === o.valor;
        return (
          <button
            key={o.valor}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={activo}
            // Solo el activo entra en el orden de tabulación —y el primero si no hay ninguno—, que
            // es cómo se recorre un grupo de radios: se entra con Tab y se elige con las flechas.
            tabIndex={activo || (valor === null && i === 0) ? 0 : -1}
            onClick={() => onChange(alPulsarSegmento(valor, o.valor))}
            // 🔴 Que se pueda deseleccionar hay que DECIRLO: no se adivina de un control que en
            // todas partes mantiene siempre uno activo.
            title={activo ? (tituloDeseleccion || "Pulsa otra vez para quitar la selección") : o.titulo}
            className={cn(
              "flex-1 min-w-0 px-2 py-1.5 text-center transition-colors duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-orange/60",
              // Separador entre segmentos — pero NUNCA tocando al activo. Una línea gris pegada
              // al naranja se lee como un borde alrededor del naranja, que es justo lo que se
              // quería quitar. Así el segmento seleccionado queda limpio por los dos lados.
              i > 0 && !activo && valor !== opciones[i - 1].valor && "border-l border-neutral-200",
              activo
                // 🔴 NARANJA SÓLIDO. Nada de degradado ni de transparencia: el mismo trato que el
                // botón "Sí" de esta misma tarjeta, que es sólido y con el texto en blanco.
                ? "bg-brand-orange text-white"
                : "bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
            )}
          >
            <span className="block text-[12px] font-ui font-bold leading-tight truncate">{o.titulo}</span>
            {/* El hueco de la segunda línea se reserva SIEMPRE, con o sin subtítulo: si no, «Otro»
                quedaría más bajo que los dos nombres y el control se vería torcido. */}
            <span className="block text-[11px] leading-tight truncate opacity-80 min-h-[1.05rem]">
              {o.subtitulo || " "}
            </span>
          </button>
        );
      })}
    </div>
  );
}
