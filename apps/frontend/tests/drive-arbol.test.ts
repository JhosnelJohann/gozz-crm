import { describe, expect, it } from "vitest";

import {
  ID_NODO_CONTACTOS,
  TIPO_NODO_CONTACTOS,
  esNavegable,
  esNodoContactos,
  etiquetaDeCarpeta,
  ordenarSecciones,
  recortarMigas,
} from "@/lib/drive-arbol";

// Los hijos de la raíz tal como los devuelve `/api/drive/tree/path`, en el orden en que llegan
// (el backend ordena por `tipo, nombre`, y el nodo virtual se añade al final).
const COMPANIA = { id: "c-1", nombre: "Drive de la compañía", tipo: "company" };
const USUARIOS = { id: "u-1", nombre: "Usuarios", tipo: "users_root" };
const CONTACTOS = { id: ID_NODO_CONTACTOS, nombre: "Drive Contactos", tipo: TIPO_NODO_CONTACTOS };

describe("el orden de las secciones", () => {
  it("pone «Mi unidad» primero, luego la compañía y al final «Drive Contactos»", () => {
    // Lo que uno abre el Drive para ver es lo suyo. Por nombre saldría antes «Drive de la
    // compañía» que «Mi unidad», solo por la D — de ahí que el orden esté escrito a mano.
    const orden = ordenarSecciones([COMPANIA, USUARIOS, CONTACTOS]).map((f) => f.tipo);
    expect(orden).toEqual(["users_root", "company", TIPO_NODO_CONTACTOS]);
  });

  it("da igual en qué orden lleguen del servidor", () => {
    const a = ordenarSecciones([CONTACTOS, USUARIOS, COMPANIA]).map((f) => f.id);
    const b = ordenarSecciones([USUARIOS, COMPANIA, CONTACTOS]).map((f) => f.id);
    expect(a).toEqual(b);
  });

  it("🔴 lo que no reconoce lo manda al final, pero NO lo descarta", () => {
    // Descartar lo desconocido escondería una carpeta legítima que alguien cree mañana en la
    // raíz. Esconder por no reconocer es un fallo que no avisa: la carpeta simplemente no está.
    const rara = { id: "x-1", nombre: "Algo nuevo", tipo: "custom" };
    const otra = { id: "x-2", nombre: "Aaa primero", tipo: "custom" };
    const r = ordenarSecciones([rara, COMPANIA, otra, USUARIOS]);
    expect(r).toHaveLength(4);
    expect(r.map((f) => f.id)).toEqual(["u-1", "c-1", "x-2", "x-1"]); // las raras, por nombre
  });

  it("no muta el array que recibe", () => {
    // El array viene del estado de React: ordenarlo en el sitio sería mutar el store.
    const entrada = [CONTACTOS, USUARIOS, COMPANIA];
    const copia = [...entrada];
    ordenarSecciones(entrada);
    expect(entrada).toEqual(copia);
  });

  it("aguanta la lista vacía", () => {
    expect(ordenarSecciones([])).toEqual([]);
  });
});

describe("cómo se llama cada carpeta en pantalla", () => {
  it("«Usuarios» se enseña como «Mi unidad»", () => {
    // En la base se llama «Usuarios» porque ahí cuelgan los espacios de todo el equipo, pero
    // cada persona solo ve el suyo: ese nombre sugiere que se puede mirar el de al lado.
    expect(etiquetaDeCarpeta(USUARIOS)).toBe("Mi unidad");
  });

  it("el nodo agrupador se llama «Drive Contactos» aunque el servidor diga otra cosa", () => {
    expect(etiquetaDeCarpeta({ ...CONTACTOS, nombre: "lo que sea" })).toBe("Drive Contactos");
  });

  it("cualquier otra carpeta conserva su nombre tal cual", () => {
    expect(etiquetaDeCarpeta(COMPANIA)).toBe("Drive de la compañía");
    expect(etiquetaDeCarpeta({ id: "z", nombre: "Zenaida Melgarejo", tipo: "contact" })).toBe("Zenaida Melgarejo");
  });
});

describe("🔴 el nodo agrupador no es una carpeta", () => {
  it("no es navegable: pedir su contenido daría 404", () => {
    // No tiene id en `drive_folders`. Si algún día alguien lo hace navegable, se entera aquí.
    expect(esNavegable(CONTACTOS)).toBe(false);
  });

  it("todas las demás sí lo son", () => {
    expect(esNavegable(COMPANIA)).toBe(true);
    expect(esNavegable(USUARIOS)).toBe(true);
    expect(esNavegable({ id: "o", nombre: "Trámites", tipo: "opportunities_root" })).toBe(true);
  });

  it("se reconoce por su id, y nada más se le parece", () => {
    expect(esNodoContactos(ID_NODO_CONTACTOS)).toBe(true);
    expect(esNodoContactos("c-1")).toBe(false);
    expect(esNodoContactos(null)).toBe(false);
    expect(esNodoContactos(undefined)).toBe(false);
    expect(esNodoContactos("")).toBe(false);
  });

  it("🔴 su id NO tiene forma de uuid, y eso es a propósito", () => {
    // Es lo que garantiza que no pueda chocar con una carpeta real y que, si se colara en una
    // consulta que espera un uuid, reviente en vez de devolver la carpeta de otra persona.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(UUID.test(ID_NODO_CONTACTOS)).toBe(false);
  });
});

describe("🔴 las migas de pan no dejan salir del alcance", () => {
  // La cadena que devuelve el servidor es siempre completa: no sabe desde dónde se está mirando.
  const CADENA = [
    { id: "raiz", nombre: "Drive del CRM", tipo: "root" },
    { id: "tramites", nombre: "Trámites", tipo: "opportunities_root" },
    { id: "caso", nombre: "Asilo", tipo: "opportunity" },
    { id: "pagos", nombre: "Comprobantes de Pago", tipo: "custom" },
  ];

  it("dentro de una negociación, la cadena empieza en su carpeta", () => {
    // Sin esto, la pestaña Documentos de un caso pinta un enlace a «Trámites», y pulsarlo suelta
    // a la persona en el árbol de TODOS los clientes.
    const r = recortarMigas(CADENA, "caso");
    expect(r.map((b) => b.id)).toEqual(["caso", "pagos"]);
  });

  it("sin alcance (el Drive normal) no se recorta nada", () => {
    expect(recortarMigas(CADENA, null).map((b) => b.id)).toEqual(["raiz", "tramites", "caso", "pagos"]);
  });

  it("🔴 si la raíz del alcance no está en la cadena, se devuelve ENTERA y no vacía", () => {
    // Quedarse sin migas deja a alguien sin saber dónde está: peor que enseñar un tramo de más.
    const r = recortarMigas(CADENA, "una-carpeta-que-no-esta");
    expect(r.map((b) => b.id)).toEqual(["raiz", "tramites", "caso", "pagos"]);
  });

  it("si el alcance es el último tramo, queda solo ese", () => {
    expect(recortarMigas(CADENA, "pagos").map((b) => b.id)).toEqual(["pagos"]);
  });

  it("no muta la cadena que recibe", () => {
    const copia = [...CADENA];
    recortarMigas(CADENA, "caso");
    expect(CADENA).toEqual(copia);
  });

  it("aguanta la cadena vacía", () => {
    expect(recortarMigas([], "caso")).toEqual([]);
  });
});
