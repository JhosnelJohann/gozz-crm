// ============================================================================================
// LO QUE COMPARTEN LOS DOS TABLEROS — `src/lib/tareas-tablero.ts`
//
// Las dos funciones de aquí son las que fallaron de verdad en producción, cada una a su manera:
//
//   · `buscarEnListas` es la que buscaba en UNA lista en vez de en las tres. Por eso una tarea
//     cancelada no se podía arrastrar de vuelta: no se encontraba, y no se hacía nada.
//   · `agruparSinRepetir` es la que evita que la tarjeta salga dos veces justo después de moverla,
//     cuando llega a la vez por la lista activa y por la carga aparte.
//
// Estaban escritas dos veces, una en cada tablero. Aquí hay una sola, y con pruebas.
//
// 🔴 Fixtures sintéticos (§9.3): ids y títulos inventados.
// ============================================================================================

import { describe, expect, it } from "vitest";

import {
  DISTANCIA_ARRASTRE,
  OPACIDAD_ARRASTRANDO,
  agruparSinRepetir,
  buscarEnListas,
  opacidadDeTarjeta,
} from "@/lib/tareas-tablero";

const tarea = (id: string, estado = "pendiente") => ({ id, estado, titulo: `Tarea ${id}` }) as any;

describe("🔴 buscar una tarea en TODAS las listas", () => {
  const activas = [tarea("a"), tarea("b")];
  const completadas = [tarea("c", "completada")];
  const canceladas = [tarea("d", "cancelada")];

  it("la encuentra en la lista activa", () => {
    expect(buscarEnListas("b", activas, completadas, canceladas)?.id).toBe("b");
  });

  it("🔴 y también en las que el listado por defecto EXCLUYE", () => {
    // Es el defecto entero en una línea: si solo se mirara `activas`, arrastrar una cancelada de
    // vuelta a «Pendiente» no encontraría la tarea y no haría nada. La tarjeta se quedaría quieta
    // y no habría forma de recuperarla desde el tablero.
    expect(buscarEnListas("c", activas, completadas, canceladas)?.id).toBe("c");
    expect(buscarEnListas("d", activas, completadas, canceladas)?.id).toBe("d");
  });

  it("devuelve null si no está en ninguna, en vez de reventar", () => {
    expect(buscarEnListas("z", activas, completadas, canceladas)).toBeNull();
  });

  it("aguanta listas sin cargar todavía", () => {
    // Las de completadas y canceladas llegan en su propia petición: durante los primeros
    // milisegundos de la pantalla son `undefined`.
    expect(buscarEnListas("a", activas, undefined, undefined)?.id).toBe("a");
    expect(buscarEnListas("a", undefined, undefined)).toBeNull();
  });
});

describe("repartir en columnas sin repetir", () => {
  it("cada tarea va a su columna", () => {
    const { grupos, poner } = agruparSinRepetir(["uno", "dos"] as const);
    poner(tarea("a"), "uno");
    poner(tarea("b"), "dos");
    expect(grupos.uno.map((t) => t.id)).toEqual(["a"]);
    expect(grupos.dos.map((t) => t.id)).toEqual(["b"]);
  });

  it("🔴 la misma tarea no entra dos veces, ni siquiera en columnas distintas", () => {
    // Justo después de mover una tarea, la recarga la trae por los dos caminos: sigue en la lista
    // activa que ya estaba en memoria y además llega en la carga aparte. Sin esto la tarjeta se ve
    // duplicada y el contador de la columna miente.
    const { grupos, poner } = agruparSinRepetir(["uno", "dos"] as const);
    poner(tarea("a"), "uno");
    poner(tarea("a"), "dos");
    poner(tarea("a"), "uno");
    expect(grupos.uno).toHaveLength(1);
    expect(grupos.dos).toHaveLength(0);
  });

  it("gana la primera columna en la que se pone", () => {
    // El orden no es casual: los tableros clasifican primero por estado y solo después vuelcan las
    // listas aparte, para que una completada nunca acabe en una columna de fecha.
    const { grupos, poner } = agruparSinRepetir(["fecha", "completada"] as const);
    poner(tarea("a", "completada"), "completada");
    poner(tarea("a", "completada"), "fecha");
    expect(grupos.completada).toHaveLength(1);
    expect(grupos.fecha).toHaveLength(0);
  });

  it("arranca con todas las columnas vacías, incluidas las que nadie use", () => {
    const { grupos } = agruparSinRepetir(["uno", "dos", "tres"] as const);
    expect(grupos).toEqual({ uno: [], dos: [], tres: [] });
  });
});

describe("el umbral del arrastre", () => {
  it("no es cero: las tarjetas también se pulsan para abrir la ficha", () => {
    // Con umbral 0, un clic con un temblor de un píxel se lee como arrastre y la tarea no se abre.
    expect(DISTANCIA_ARRASTRE).toBeGreaterThan(0);
  });
});

describe("🔴 una tarjeta no puede quedarse invisible", () => {
  it("ninguna entrada devuelve 0", () => {
    // Es la única afirmación que hace falta. Los dos tableros ocultaban la tarjeta de origen con
    // `opacity: 0` atado a `isDragging`, que es estado interno de dnd-kit: si se queda encendido,
    // la tarjeta desaparece de la pantalla y no vuelve. Visto en staging — la columna Canceladas
    // marcaba 2, se veía una, y en el DOM la otra tenía `opacity: 0; transform: none`.
    for (const arrastrando of [true, false]) {
      expect(opacidadDeTarjeta(arrastrando), `arrastrando=${arrastrando}`).toBeGreaterThan(0);
    }
  });

  it("pero sí se atenúa mientras se arrastra, para no verse duplicada con la copia", () => {
    // Si no se atenuara, se verían dos tarjetas iguales: la de la columna y la que va con el
    // puntero. El punto medio es que se distinga cuál se está moviendo sin que ninguna se pierda.
    expect(opacidadDeTarjeta(true)).toBeLessThan(1);
    expect(opacidadDeTarjeta(true)).toBe(OPACIDAD_ARRASTRANDO);
    expect(opacidadDeTarjeta(false)).toBe(1);
  });

  it("y sigue siendo visible de sobra: el peor caso es una tarjeta pálida, no una que no está", () => {
    // Una tarea que existe y no se ve es peor que una que se ve mal: quien la buscaba cree que la
    // ha perdido. Es el mismo daño que la tanda anterior cerró con las canceladas.
    expect(OPACIDAD_ARRASTRANDO).toBeGreaterThanOrEqual(0.25);
  });
});

