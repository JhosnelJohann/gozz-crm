// ============================================================================================
// LAS DOS REGLAS DE UN SEGMENTED CONTROL — `src/lib/segmented-control.ts`
//
// El componente es JSX y `apps/frontend` no tiene runner de componentes (FASE 2, §9.1). Lo que sí
// se puede probar, y lo que de verdad se puede romper, son las dos decisiones que lo gobiernan.
//
// 🔴 LA PRIMERA ES LA QUE IMPORTA: pulsar el segmento activo lo deselecciona. Un segmented control
// normalmente siempre tiene uno marcado, así que la tentación de "simplificar" esta línea es real
// — y quitarla convertiría un clic por error en algo sin vuelta atrás. Es §2.8: todo sitio que
// concede algo tiene que tener cómo cambiarlo, y «quitarlo» cuenta.
// ============================================================================================

import { describe, expect, it } from "vitest";

import { alPulsarSegmento, siguienteSegmento } from "@/lib/segmented-control";

describe("🔴 pulsar un segmento", () => {
  it("uno distinto lo selecciona", () => {
    expect(alPulsarSegmento(null, "a")).toBe("a");
    expect(alPulsarSegmento("a", "b")).toBe("b");
  });

  it("🔴 el que YA está seleccionado lo DESELECCIONA", () => {
    // Sin esto, marcar un agente por error no se puede deshacer: un grupo de radios no se
    // desmarca, y aquí «sin agente» es el estado de casi toda la cartera.
    expect(alPulsarSegmento("a", "a")).toBeNull();
  });

  it("y volver a pulsarlo lo selecciona otra vez: es un ciclo, no un camino de ida", () => {
    let v: string | null = null;
    v = alPulsarSegmento(v, "a"); expect(v).toBe("a");
    v = alPulsarSegmento(v, "a"); expect(v).toBeNull();
    v = alPulsarSegmento(v, "a"); expect(v).toBe("a");
  });
});

describe("recorrerlo con el teclado", () => {
  const v = ["a", "b", "c"];

  it("avanza y retrocede", () => {
    expect(siguienteSegmento("a", v, 1)).toBe("b");
    expect(siguienteSegmento("b", v, -1)).toBe("a");
  });

  it("da la vuelta por los dos extremos", () => {
    // Llegar al final y seguir pulsando no puede dejar al usuario atascado sin saber por qué.
    expect(siguienteSegmento("c", v, 1)).toBe("a");
    expect(siguienteSegmento("a", v, -1)).toBe("c");
  });

  it("🔴 sin nada seleccionado, la PRIMERA flecha entra igualmente", () => {
    // Un control que ignora la primera pulsación parece roto. Entra por el principio o por el
    // final según la dirección, que es lo que espera quien pulsa.
    expect(siguienteSegmento(null, v, 1)).toBe("a");
    expect(siguienteSegmento(null, v, -1)).toBe("c");
  });

  it("un valor que ya no está en la lista se trata como «ninguno»", () => {
    // Pasa de verdad: el agente guardado puede haberse dado de baja y desaparecer de las opciones.
    expect(siguienteSegmento("zzz", v, 1)).toBe("a");
  });

  it("sin opciones no revienta", () => {
    expect(siguienteSegmento(null, [], 1)).toBeNull();
    expect(siguienteSegmento("a", [], -1)).toBeNull();
  });

  it("con una sola opción, la flecha se queda donde está", () => {
    expect(siguienteSegmento("a", ["a"], 1)).toBe("a");
    expect(siguienteSegmento("a", ["a"], -1)).toBe("a");
  });
});
