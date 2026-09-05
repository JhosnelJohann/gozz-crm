import { describe, it, expect } from "vitest";

import {
  consultaDeTareas, vinculoGuardado, esVinculo,
  VINCULOS, VINCULO_POR_DEFECTO, ETIQUETAS_VINCULO,
  type FiltrosDeTareas,
} from "@/lib/tareas-consulta";

const BASE: FiltrosDeTareas = { scope: "mine", vinculo: "defecto", estadoFiltro: "activas" };

/** Las tres cargas de la pantalla: la lista, la columna de completadas y la de canceladas. */
const LAS_TRES = (f: FiltrosDeTareas) => [
  consultaDeTareas(f),
  consultaDeTareas(f, "completada"),
  consultaDeTareas(f, "cancelada"),
];

describe("qué se le pide al servidor", () => {
  it("siempre lleva el scope y el vínculo, también cuando es el de por defecto", () => {
    const qs = consultaDeTareas(BASE);
    expect(qs.get("scope")).toBe("mine");
    // Explícito a propósito: así la petición se lee sola, sin saberse el valor implícito.
    expect(qs.get("vinculo")).toBe("defecto");
  });

  it("las columnas de completadas y canceladas piden SU estado", () => {
    expect(consultaDeTareas(BASE, "completada").get("estado")).toBe("completada");
    expect(consultaDeTareas(BASE, "cancelada").get("estado")).toBe("cancelada");
    expect(consultaDeTareas(BASE).get("estado")).toBeNull();
  });

  it("y ese estado gana sobre el filtro de la barra: la columna es la columna", () => {
    const qs = consultaDeTareas({ ...BASE, estadoFiltro: "completadas" }, "cancelada");
    expect(qs.get("estado")).toBe("cancelada");
    expect(qs.get("include_completed")).toBeNull();
  });

  it("el filtro «todas» pide explícitamente las completadas, que el servidor excluye por defecto", () => {
    expect(consultaDeTareas({ ...BASE, estadoFiltro: "todas" }).get("include_completed")).toBe("true");
    expect(consultaDeTareas({ ...BASE, estadoFiltro: "completadas" }).get("estado")).toBe("completada");
    // «activas» y «vencidas» se resuelven en la pantalla: al servidor no le piden nada extra.
    expect(consultaDeTareas({ ...BASE, estadoFiltro: "activas" }).get("include_completed")).toBeNull();
    expect(consultaDeTareas({ ...BASE, estadoFiltro: "vencidas" }).get("include_completed")).toBeNull();
  });

  it("la búsqueda va sin espacios sobrantes, y en blanco no se manda", () => {
    expect(consultaDeTareas({ ...BASE, q: "  uscis  " }).get("q")).toBe("uscis");
    expect(consultaDeTareas({ ...BASE, q: "   " }).get("q")).toBeNull();
    expect(consultaDeTareas(BASE).get("q")).toBeNull();
  });
});

/**
 * 🔴 LA PRUEBA QUE PAGA ESTE MÓDULO. Ya se ha pagado dos veces el mismo error: se añade un filtro,
 * se le pasa a la carga principal y las columnas de completadas y canceladas siguen trayendo lo de
 * todo el mundo. No falla ruidosamente — las columnas se pintan igual de bien, solo que con tareas
 * que no tocaban.
 */
describe("🔴 todos los filtros viajan en LAS TRES cargas", () => {
  const CON_TODO: FiltrosDeTareas = {
    scope: "mine",
    vinculo: "creador",
    asUserId: "u-briset",
    contactoId: "c-ana",
    q: "uscis",
    estadoFiltro: "activas",
  };

  for (const [clave, esperado] of [
    ["vinculo", "creador"],
    ["as_user_id", "u-briset"],
    ["contacto_id", "c-ana"],
    ["q", "uscis"],
  ] as const) {
    it(`«${clave}» está en la lista, en completadas y en canceladas`, () => {
      for (const qs of LAS_TRES(CON_TODO)) expect(qs.get(clave)).toBe(esperado);
    });
  }

  it("y lo que no se ha puesto no se manda", () => {
    for (const qs of LAS_TRES(BASE)) {
      expect(qs.get("as_user_id")).toBeNull();
      expect(qs.get("contacto_id")).toBeNull();
    }
  });
});

describe("las cuatro opciones del selector", () => {
  it("son cuatro, y en el orden en que se piden en pantalla", () => {
    expect([...VINCULOS]).toEqual(["defecto", "creador", "asignado", "observador"]);
    expect(VINCULO_POR_DEFECTO).toBe("defecto");
  });

  it("cada una tiene su etiqueta, y ninguna nombra una columna de la base (§4.7)", () => {
    for (const v of VINCULOS) {
      const etiqueta = ETIQUETAS_VINCULO[v];
      expect(etiqueta).toBeTruthy();
      expect(etiqueta.toLowerCase()).not.toContain("propietario");
      expect(etiqueta).not.toContain("_id");
    }
  });

  it("reconoce los valores válidos y rechaza el resto", () => {
    expect(esVinculo("creador")).toBe(true);
    expect(esVinculo("creadorr")).toBe(false);
    expect(esVinculo("")).toBe(false);
    expect(esVinculo(null)).toBe(false);
    expect(esVinculo(undefined)).toBe(false);
  });
});

describe("recordar la elección entre visitas", () => {
  it("devuelve lo guardado cuando vale", () => {
    expect(vinculoGuardado(() => "observador")).toBe("observador");
  });

  it("un valor de otra versión, o a medio escribir, cae en el de por defecto", () => {
    expect(vinculoGuardado(() => "propietario")).toBe(VINCULO_POR_DEFECTO);
    expect(vinculoGuardado(() => "")).toBe(VINCULO_POR_DEFECTO);
    expect(vinculoGuardado(() => null)).toBe(VINCULO_POR_DEFECTO);
  });

  /**
   * En modo incógnito —y en un navegador con el almacenamiento capado— leer `localStorage` LANZA.
   * Si eso subiera, la pantalla de Tareas no llegaría a pintarse por una preferencia de adorno.
   */
  it("si el navegador no deja leer, no revienta: usa el de por defecto", () => {
    expect(vinculoGuardado(() => { throw new Error("SecurityError"); })).toBe(VINCULO_POR_DEFECTO);
  });
});
