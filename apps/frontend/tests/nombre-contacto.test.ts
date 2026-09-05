// ============================================================================================
// EL NOMBRE DEL ENCABEZADO DE UN CONTACTO — `src/lib/nombre-contacto.ts`
//
// El encabezado dejó de ser un campo que se teclea y pasó a ser una etiqueta compuesta. Lo único
// que hay que garantizar, y la razón de que exista este fichero:
//
//   🔴 LA ETIQUETA NUNCA PUEDE ENSEÑAR MENOS DE LO QUE HOY SE VE.
//
// Medido en producción el 2026-08-20 sobre 3.811 contactos vivos: 33 no tienen ninguna parte y
// 160 no tienen apellido. Sin respaldo, los primeros se quedarían en "Sin nombre" y los segundos
// perderían el apellido en pantalla — «Juan Antonio» donde hoy se lee «Juan Antonio Tercero
// Lopez». Ese caso es el que más importa de todos los de abajo.
//
// 🔴 Fixtures sintéticos (§9.3): nombres inventados. Ni un contacto real.
// ============================================================================================

import { describe, expect, it } from "vitest";

import { SIN_NOMBRE, nombreEnDosLineas, nombreParaEncabezado, usaRespaldoDeNombre } from "@/lib/nombre-contacto";

describe("la composición normal", () => {
  it("con las tres partes, se leen las tres", () => {
    expect(nombreParaEncabezado({
      nombre: "Ana", segundo_nombre: "Maria", apellido: "Perez Ruiz",
      nombre_completo: "Ana Maria Perez Ruiz",
    })).toBe("Ana Maria Perez Ruiz");
  });

  it("sin segundo nombre, no queda un espacio doble", () => {
    expect(nombreParaEncabezado({
      nombre: "Ana", segundo_nombre: null, apellido: "Perez", nombre_completo: "Ana Perez",
    })).toBe("Ana Perez");
  });

  it("con espacios de más, se recortan", () => {
    expect(nombreParaEncabezado({
      nombre: "  Ana  ", segundo_nombre: "   ", apellido: " Perez ", nombre_completo: "Ana Perez",
    })).toBe("Ana Perez");
  });

  it("sin `nombre_completo` guardado, manda la composición", () => {
    expect(nombreParaEncabezado({ nombre: "Ana", apellido: "Perez", nombre_completo: null })).toBe("Ana Perez");
  });
});

describe("🔴 el respaldo — la etiqueta nunca enseña menos que hoy", () => {
  it("🔴 SIN NINGUNA PARTE (los 33): se lee el `nombre_completo`, no «Sin nombre»", () => {
    // Es el caso de la ficha que motivó la tanda. El dato entró entero desde Pipedrive/Zoho/Bitrix
    // y nadie lo repartió nunca; sin este respaldo, 33 fichas perderían su nombre en pantalla.
    const c = { nombre: null, segundo_nombre: null, apellido: null, nombre_completo: "Juan Antonio Tercero Lopez" };
    expect(nombreParaEncabezado(c)).toBe("Juan Antonio Tercero Lopez");
    expect(usaRespaldoDeNombre(c), "y la ficha puede avisar de que faltan las partes").toBe(true);
  });

  it("🔴 SIN APELLIDO (los 160): NO se pierde el apellido en pantalla", () => {
    // La composición diría «Juan Antonio» donde hoy se lee el nombre entero. Es la mitad del
    // problema, y la que una comprobación de «¿está vacía?» dejaría escapar.
    const c = { nombre: "Juan", segundo_nombre: "Antonio", apellido: null, nombre_completo: "Juan Antonio Tercero Lopez" };
    expect(nombreParaEncabezado(c)).toBe("Juan Antonio Tercero Lopez");
    expect(usaRespaldoDeNombre(c)).toBe(true);
  });

  it("con solo el nombre de pila y un completo más largo, también respalda", () => {
    expect(nombreParaEncabezado({ nombre: "Ana", nombre_completo: "Ana Maria Perez Ruiz" }))
      .toBe("Ana Maria Perez Ruiz");
  });

  it("ni composición ni completo: «Sin nombre», que es lo que ya decía la ficha", () => {
    expect(nombreParaEncabezado({})).toBe(SIN_NOMBRE);
    expect(nombreParaEncabezado({ nombre: "", segundo_nombre: "  ", apellido: null, nombre_completo: "" })).toBe(SIN_NOMBRE);
    expect(usaRespaldoDeNombre({}), "no hay respaldo que avisar").toBe(false);
  });
});

describe("cuándo NO se respalda", () => {
  it("si la composición cubre todas las palabras, gana la composición", () => {
    const c = { nombre: "Ana", segundo_nombre: "Maria", apellido: "Perez", nombre_completo: "Ana Maria Perez" };
    expect(nombreParaEncabezado(c)).toBe("Ana Maria Perez");
    expect(usaRespaldoDeNombre(c), "no está respaldando: coinciden").toBe(false);
  });

  it("🔴 y si la composición es MÁS RICA, también gana ella", () => {
    // Alguien rellenó un segundo nombre que la importación no traía. Respaldar aquí sería enseñar
    // menos de lo que el usuario acaba de escribir, que es el error simétrico.
    expect(nombreParaEncabezado({
      nombre: "Ana", segundo_nombre: "Maria", apellido: "Perez", nombre_completo: "Ana Perez",
    })).toBe("Ana Maria Perez");
  });

  it("🔴 una tilde de diferencia NO tira del respaldo", () => {
    // Si las partes dicen «José» y el completo dice «Jose», es la misma persona. Sin normalizar,
    // la comparación vería una palabra distinta y respaldaría, enseñando el dato viejo sin tilde
    // justo después de que alguien lo corrigiera.
    expect(nombreParaEncabezado({
      nombre: "José", apellido: "Pérez", nombre_completo: "Jose Perez",
    })).toBe("José Pérez");
  });

  it("el orden distinto no cuenta como más pobre: son las mismas palabras", () => {
    // «Perez Ana» y «Ana Perez» tienen las mismas palabras. Se prefiere la composición, que es la
    // que refleja los campos que la persona rellenó.
    expect(nombreParaEncabezado({
      nombre: "Ana", apellido: "Perez", nombre_completo: "Perez Ana",
    })).toBe("Ana Perez");
  });

  it("mayúsculas y minúsculas tampoco", () => {
    expect(nombreParaEncabezado({ nombre: "ANA", apellido: "perez", nombre_completo: "Ana Perez" })).toBe("ANA perez");
  });
});

describe("entradas raras que no pueden romper la ficha", () => {
  it("valores que no son cadenas se ignoran", () => {
    expect(nombreParaEncabezado({ nombre: 42 as any, apellido: {} as any, nombre_completo: "Ana Perez" }))
      .toBe("Ana Perez");
  });

  it("undefined en todo", () => {
    expect(nombreParaEncabezado({ nombre: undefined, segundo_nombre: undefined, apellido: undefined, nombre_completo: undefined }))
      .toBe(SIN_NOMBRE);
  });
});

describe("partir un nombre en dos líneas", () => {
  it("la última palabra baja: es el apellido", () => {
    expect(nombreEnDosLineas("Alessandro Garagozzo")).toEqual({ titulo: "Alessandro", subtitulo: "Garagozzo" });
    expect(nombreEnDosLineas("Jhosnel Laya")).toEqual({ titulo: "Jhosnel", subtitulo: "Laya" });
  });

  it("una sola palabra se queda arriba, sin subtítulo", () => {
    // Es el caso de «Otro». El hueco de la segunda línea lo reserva el componente, así que ese
    // segmento no queda más bajo que los que sí tienen apellido.
    expect(nombreEnDosLineas("Otro")).toEqual({ titulo: "Otro" });
  });

  it("con más de tres palabras, solo baja la última", () => {
    expect(nombreEnDosLineas("Ana Maria Perez Ruiz")).toEqual({ titulo: "Ana Maria Perez", subtitulo: "Ruiz" });
  });

  it("no revienta con espacios de más ni con nada", () => {
    expect(nombreEnDosLineas("  Ana   Perez  ")).toEqual({ titulo: "Ana", subtitulo: "Perez" });
    expect(nombreEnDosLineas("")).toEqual({ titulo: "" });
    expect(nombreEnDosLineas("   ")).toEqual({ titulo: "" });
  });
});
