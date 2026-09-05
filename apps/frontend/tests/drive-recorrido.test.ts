import { describe, expect, it } from "vitest";

import { construirRecorrido } from "@/lib/drive-recorrido";

const archivo = (id: string) => ({
  id,
  folder_id: "f",
  nombre: `${id}.pdf`,
  mime: "application/pdf",
  size_bytes: 10,
  uploaded_by: "",
  created_at: "2026-08-24T00:00:00Z",
  updated_at: "2026-08-24T00:00:00Z",
}) as any;

const SUBS = [
  { id: "s1", nombre: "Contratos" },
  { id: "s2", nombre: "Pagos" },
];

describe("el orden del recorrido es el orden de la pantalla", () => {
  it("sin nada desplegado, es exactamente la lista de siempre", () => {
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(),
      archivosPorSubcarpeta: {},
      archivosPropios: [archivo("a"), archivo("b")],
    });
    expect(r.planos.map((x) => x.file.id)).toEqual(["a", "b"]);
    expect(r.porSubcarpeta).toEqual({});
    expect(r.propios).toHaveLength(2);
  });

  it("las subcarpetas desplegadas van primero, en el orden en que se pintan", () => {
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1", "s2"]),
      archivosPorSubcarpeta: { s1: [archivo("c1")], s2: [archivo("p1"), archivo("p2")] },
      archivosPropios: [archivo("a")],
    });
    expect(r.planos.map((x) => x.file.id)).toEqual(["c1", "p1", "p2", "a"]);
  });

  it("🔴 los índices salen SEGUIDOS y coinciden con la posición", () => {
    // Es lo único que hace que «avanzar» sea sumar uno. Un hueco pararía la flecha en la nada.
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1", "s2"]),
      archivosPorSubcarpeta: { s1: [archivo("c1"), archivo("c2")], s2: [archivo("p1")] },
      archivosPropios: [archivo("a"), archivo("b")],
    });
    expect(r.planos.map((x) => x.indice)).toEqual([0, 1, 2, 3, 4]);
    r.planos.forEach((x, i) => expect(r.planos[x.indice].file.id).toBe(r.planos[i].file.id));
  });

  it("🔴 una desplegada que aún NO trajo sus archivos no deja hueco", () => {
    // Mientras la petición está en vuelo la carpeta se ve abierta y vacía. Si reservara sitio en
    // el recorrido, la flecha se pararía en un archivo que no existe.
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1", "s2"]),
      archivosPorSubcarpeta: { s2: [archivo("p1")] },      // s1 todavía no llegó
      archivosPropios: [archivo("a")],
    });
    expect(r.planos.map((x) => x.file.id)).toEqual(["p1", "a"]);
    expect(r.planos.map((x) => x.indice)).toEqual([0, 1]);
    expect(r.porSubcarpeta.s1).toBeUndefined();
  });

  it("una desplegada VACÍA tampoco aporta nada", () => {
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1"]),
      archivosPorSubcarpeta: { s1: [] },
      archivosPropios: [archivo("a")],
    });
    expect(r.planos.map((x) => x.file.id)).toEqual(["a"]);
    expect(r.porSubcarpeta.s1).toBeUndefined();
  });

  it("lo cargado de una subcarpeta PLEGADA no se cuela en el recorrido", () => {
    // Al plegar no se tira lo traído (para no volver a pedirlo), pero lo que no se ve no se camina.
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s2"]),
      archivosPorSubcarpeta: { s1: [archivo("c1")], s2: [archivo("p1")] },
      archivosPropios: [archivo("a")],
    });
    expect(r.planos.map((x) => x.file.id)).toEqual(["p1", "a"]);
  });
});

describe("cada archivo sabe de dónde sale", () => {
  it("los de una subcarpeta la nombran; los de la carpeta abierta llevan null", () => {
    // Es lo que permite pintar «Contratos ›» encima de una fila sin volver a buscar su carpeta.
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1"]),
      archivosPorSubcarpeta: { s1: [archivo("c1")] },
      archivosPropios: [archivo("a")],
    });
    expect(r.planos[0].subcarpetaId).toBe("s1");
    expect(r.planos[0].subcarpetaNombre).toBe("Contratos");
    expect(r.planos[1].subcarpetaId).toBeNull();
    expect(r.planos[1].subcarpetaNombre).toBeNull();
  });

  it("el elemento de `porSubcarpeta` y el de `planos` son EL MISMO objeto", () => {
    // Si fueran copias, cambiar uno dejaría al otro desactualizado y volveríamos al problema que
    // este módulo existe para evitar.
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1"]),
      archivosPorSubcarpeta: { s1: [archivo("c1")] },
      archivosPropios: [],
    });
    expect(r.porSubcarpeta.s1[0]).toBe(r.planos[0]);
  });
});

describe("los bordes", () => {
  it("una carpeta sin nada devuelve un recorrido vacío, no revienta", () => {
    const r = construirRecorrido({
      subcarpetas: [],
      desplegadas: new Set(),
      archivosPorSubcarpeta: {},
      archivosPropios: [],
    });
    expect(r.planos).toEqual([]);
    expect(r.propios).toEqual([]);
  });

  it("aguanta que el servidor mande algo que no es una lista", () => {
    const r = construirRecorrido({
      subcarpetas: SUBS,
      desplegadas: new Set(["s1"]),
      archivosPorSubcarpeta: { s1: undefined },
      archivosPropios: [archivo("a")],
    });
    expect(r.planos.map((x) => x.file.id)).toEqual(["a"]);
  });
});
