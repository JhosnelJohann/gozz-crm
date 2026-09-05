// ============================================================================================
// LAS FRANJAS DE «POR FECHA LÍMITE» — `src/lib/tareas-fechas.ts`
//
// La regla vivía dentro del `useMemo` de `TareasPorFecha.tsx` y no se podía probar. Se saca porque
// en cuanto el tablero acepte arrastre habrá DOS sitios razonando sobre las mismas franjas —el que
// reparte las tarjetas y el que decide qué fecha escribir al soltar—, y si divergen una tarjeta
// soltada en «Esta semana» aterriza en «Atrasado».
//
// 🔴 EL RELOJ VA CONGELADO. Sin eso, «esta semana» significa algo distinto cada día y estas
// pruebas no demostrarían nada: pasarían de lunes a jueves y fallarían el fin de semana sin que
// nadie hubiera tocado el código. Mismo patrón que `tests/edad.test.ts`.
//
// La fecha falsa se construye con componentes LOCALES, no con una cadena ISO con `Z`: la vista
// clasifica en hora local, así que una cadena con zona horaria mediría otra cosa.
// ============================================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ColumnaTablero,
  HORA_LIMITE,
  accionAlSoltar,
  columnaDeTarea,
  cortesDeSemana,
  fechaParaColumna,
  inicioDelDia,
  laSemanaAdmiteFechas,
  textoDeFechaLimite,
} from "@/lib/tareas-fechas";

/** Miércoles 19 de agosto de 2026, 10:00 LOCAL. La semana va del lunes 17 al domingo 23. */
const MIERCOLES = new Date(2026, 7, 19, 10, 0, 0);

/** Un día concreto de esa misma semana, a la hora que se diga. */
const dia = (d: number, h = 12, m = 0) => new Date(2026, 7, d, h, m, 0);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(MIERCOLES); });
afterEach(() => { vi.useRealTimers(); });

describe("los cortes de la semana", () => {
  it("la semana va de LUNES a DOMINGO, no de domingo a sábado", () => {
    const c = cortesDeSemana();
    expect(c.diaSemana, "miércoles = 2 contando desde el lunes").toBe(2);
    expect(c.finEstaSemana.getDate(), "termina el domingo 23").toBe(23);
    expect(c.finProximaSemana.getDate(), "y la siguiente el domingo 30").toBe(30);
  });

  it("el final del día es 23:59:59, no medianoche del siguiente", () => {
    const c = cortesDeSemana();
    expect(c.finHoy.getDate()).toBe(19);
    expect(c.finHoy.getHours()).toBe(23);
  });

  it("`inicioDelDia` no toca el objeto que recibe", () => {
    const d = dia(19, 15, 30);
    expect(inicioDelDia(d).getHours()).toBe(0);
    expect(d.getHours(), "el original sigue igual").toBe(15);
  });
});

describe("en qué columna cae cada fecha", () => {
  it("sin fecha límite, a su columna", () => {
    expect(columnaDeTarea(null)).toBe("sin");
    expect(columnaDeTarea(undefined)).toBe("sin");
    expect(columnaDeTarea("")).toBe("sin");
  });

  it("hoy, a «Para hoy» — a cualquier hora del día", () => {
    expect(columnaDeTarea(dia(19, 0, 0))).toBe("hoy");
    expect(columnaDeTarea(dia(19, 23, 59))).toBe("hoy");
  });

  it("🔴 una hora de HOY que ya pasó sigue siendo «Para hoy», no «Atrasado»", () => {
    // El orden de las comprobaciones importa: son las 10:00 y una tarea de las 08:00 es de hoy,
    // no un atraso. Invertir ese orden mandaría media columna a «Atrasado» cada mañana.
    expect(columnaDeTarea(dia(19, 8, 0))).toBe("hoy");
  });

  it("ayer y antes, a «Atrasado»", () => {
    expect(columnaDeTarea(dia(18, 23, 59))).toBe("atrasado");
    expect(columnaDeTarea(dia(1))).toBe("atrasado");
  });

  it("de mañana al domingo, a «Esta semana»", () => {
    expect(columnaDeTarea(dia(20))).toBe("semana");
    expect(columnaDeTarea(dia(21)), "viernes").toBe("semana");
    expect(columnaDeTarea(dia(23, 23, 59)), "domingo, hasta el último segundo").toBe("semana");
  });

  it("del lunes siguiente al domingo siguiente, a «Próxima semana»", () => {
    expect(columnaDeTarea(dia(24)), "lunes que viene").toBe("proxima");
    expect(columnaDeTarea(dia(30, 23, 59)), "domingo que viene").toBe("proxima");
  });

  it("más allá, a «Más adelante»", () => {
    expect(columnaDeTarea(dia(31))).toBe("adelante");
    expect(columnaDeTarea(new Date(2027, 0, 1))).toBe("adelante");
  });

  it("una fecha ilegible no revienta la vista: cae en «sin»", () => {
    expect(columnaDeTarea("no-es-una-fecha")).toBe("sin");
  });

  it("acepta la cadena que manda la API y un Date, y dicen lo mismo", () => {
    const d = dia(21, 18, 0);
    expect(columnaDeTarea(d.toISOString())).toBe(columnaDeTarea(d));
  });
});

describe("🔴 el domingo, «Esta semana» no puede contener nada", () => {
  it("su franja está vacía, porque el domingo YA es el final de la semana", () => {
    // No es una curiosidad: es un día de cada siete. Cualquier cosa que intente escribir una fecha
    // «de esta semana» un domingo va a acabar en otra columna.
    vi.setSystemTime(new Date(2026, 7, 23, 10, 0, 0)); // domingo
    expect(laSemanaAdmiteFechas()).toBe(false);

    const c = cortesDeSemana();
    expect(c.finEstaSemana.getTime()).toBe(c.finHoy.getTime());
  });

  it("el resto de días sí la admite", () => {
    for (const d of [17, 18, 19, 20, 21, 22]) {
      vi.setSystemTime(new Date(2026, 7, d, 10, 0, 0));
      expect(laSemanaAdmiteFechas(), `día ${d}`).toBe(true);
    }
  });
});

describe("la clasificación es la misma cualquier día de la semana", () => {
  it("mañana siempre cae en «Esta semana» o en «Próxima semana», nunca en «Atrasado»", () => {
    // Recorre los siete días para que ninguna prueba de arriba pase por casualidad del día
    // elegido — que es justo lo que el reloj congelado podría tapar.
    for (const d of [17, 18, 19, 20, 21, 22, 23]) {
      const hoy = new Date(2026, 7, d, 10, 0, 0);
      const manana = new Date(2026, 7, d + 1, 12, 0, 0);
      expect(["semana", "proxima"], `día ${d}`).toContain(columnaDeTarea(manana, hoy));
    }
  });
});

// ============================================================================================
// 🔴 LA INVARIANTE DEL ARRASTRE
//
//     columnaDeTarea(fechaParaColumna(col, dia), dia) === col
//
// «La fecha que escribe una columna cae en esa columna.» Es la única prueba de este fichero que
// habría atrapado el defecto del intento anterior: allí «Esta semana» escribía el viernes a las
// 18:00 calculado aparte, y el viernes, el sábado y el domingo esa fecha caía en OTRA columna —
// «Para hoy» o, peor, «Atrasado». La tarjeta se iba sola delante de quien la arrastró.
//
// Se comprueba para los SIETE días porque el defecto solo aparecía tres de ellos. Con el reloj
// congelado en un miércoles —que es lo cómodo— habría pasado en verde.
// ============================================================================================

describe("🔴 la fecha que escribe una columna cae en esa columna — los siete días", () => {
  const QUE_ESCRIBEN: ColumnaTablero[] = ["hoy", "semana", "proxima", "adelante"];

  for (const d of [17, 18, 19, 20, 21, 22, 23]) {
    it(`día ${d} de agosto (${["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][d - 17]})`, () => {
      const hoy = new Date(2026, 7, d, 10, 0, 0);
      vi.setSystemTime(hoy);
      for (const col of QUE_ESCRIBEN) {
        const f = fechaParaColumna(col, hoy);
        // El domingo «Esta semana» no tiene hueco: es el único `null` legítimo.
        if (f === null) {
          expect(col, `día ${d}: ${col} devolvió null`).toBe("semana");
          expect(laSemanaAdmiteFechas(hoy)).toBe(false);
          continue;
        }
        expect(columnaDeTarea(f, hoy), `día ${d}: ${col} escribió ${f.toString()}`).toBe(col);

        // 🔴 Y POR EL CAMINO DE REABRIR, que es el otro sitio desde donde se escribe una fecha.
        // Sale del mismo `fechaParaColumna`, y esta comprobación es lo que impide que mañana
        // alguien le ponga una cuenta propia «solo para las reabiertas».
        for (const estado of ["cancelada", "completada"]) {
          const a = accionAlSoltar(col, { estado, fecha_limite: null }, hoy);
          expect(a.tipo, `día ${d}: ${estado} → ${col}`).toBe("reabrir");
          if (a.tipo !== "reabrir" || !a.fecha) continue;
          expect(columnaDeTarea(a.fecha, hoy), `día ${d}: ${estado} reabierta en ${col}`).toBe(col);
          expect(a.fecha.getTime(), "la misma fecha que para una tarea viva").toBe(f.getTime());
        }
      }
    });
  }

  it("y la hora que escribe es siempre las 18:00 en punto", () => {
    for (const d of [17, 18, 19, 20, 21, 22, 23]) {
      const hoy = new Date(2026, 7, d, 10, 0, 0);
      for (const col of QUE_ESCRIBEN) {
        const f = fechaParaColumna(col, hoy);
        if (!f) continue;
        expect(f.getHours(), `día ${d}, ${col}`).toBe(HORA_LIMITE);
        expect(f.getMinutes()).toBe(0);
      }
    }
  });

  it("«Para hoy» vale aunque ya sean las 19:00 — las 18:00 de hoy siguen siendo de hoy", () => {
    // El clasificador mira «hoy» antes que «atrasado». Si no lo hiciera, soltar una tarjeta en
    // «Para hoy» a última hora de la tarde la mandaría a «Atrasado» al instante.
    const tarde = new Date(2026, 7, 19, 19, 30, 0);
    const f = fechaParaColumna("hoy", tarde)!;
    expect(columnaDeTarea(f, tarde)).toBe("hoy");
  });

  it("⚠️ el viernes y el sábado, «Esta semana» NO escribe el viernes", () => {
    // Es el caso concreto que rompía. El viernes a las 18:00 ya no está por delante, así que la
    // columna escribe el último día de su franja —el domingo—, no un viernes que caería fuera.
    expect(fechaParaColumna("semana", new Date(2026, 7, 21, 10, 0, 0))!.getDate(), "viernes").toBe(23);
    expect(fechaParaColumna("semana", new Date(2026, 7, 22, 10, 0, 0))!.getDate(), "sábado").toBe(23);
    // De lunes a jueves sí, que es lo que la gente espera de «esta semana».
    expect(fechaParaColumna("semana", new Date(2026, 7, 19, 10, 0, 0))!.getDate(), "miércoles").toBe(21);
  });

  it("«Próxima semana» siempre cae en el viernes que viene, incluido el domingo", () => {
    expect(fechaParaColumna("proxima", new Date(2026, 7, 17, 10, 0, 0))!.getDate(), "lunes").toBe(28);
    expect(fechaParaColumna("proxima", new Date(2026, 7, 23, 10, 0, 0))!.getDate(), "domingo").toBe(28);
  });

  it("las columnas que no escriben fecha devuelven null", () => {
    for (const col of ["atrasado", "sin", "completada", "cancelada"] as ColumnaTablero[]) {
      expect(fechaParaColumna(col), col).toBeNull();
    }
  });
});

// ============================================================================================
// QUÉ PASA AL SOLTAR
// ============================================================================================

const activa = (fecha_limite: string | Date | null = null) => ({ estado: "pendiente", fecha_limite });

describe("las columnas de fecha cambian el plazo y NO el estado", () => {
  it("una tarea sin plazo soltada en «Para hoy» recibe hoy a las 18:00", () => {
    const a = accionAlSoltar("hoy", activa());
    expect(a.tipo).toBe("fecha");
    if (a.tipo !== "fecha") return;
    expect(columnaDeTarea(a.fecha)).toBe("hoy");
  });

  it("🔴 la acción NUNCA incluye un estado: mover de plazo no completa ni cancela nada", () => {
    for (const col of ["hoy", "semana", "proxima", "adelante"] as ColumnaTablero[]) {
      const a = accionAlSoltar(col, activa());
      expect(["fecha", "no_acepta"], col).toContain(a.tipo);
      expect(a).not.toHaveProperty("estado");
    }
  });

  it("si ya está en esa franja no se manda nada — no se pisa la hora que alguien puso a mano", () => {
    // Una tarea del viernes a las 09:00 soltada en «Esta semana» seguiría a las 09:00. Reescribirla
    // a las 18:00 sería cambiarle el plazo a alguien sin que lo haya pedido.
    expect(accionAlSoltar("semana", activa(dia(21, 9, 0))).tipo).toBe("nada");
    expect(accionAlSoltar("hoy", activa(dia(19, 8, 0))).tipo).toBe("nada");
  });
});

describe("🔴 «Sin fecha límite» quita el plazo y deja la tarea VIVA", () => {
  it("una tarea con plazo pierde el plazo", () => {
    expect(accionAlSoltar("sin", activa(dia(21))).tipo).toBe("quitar_fecha");
  });

  it("no la cancela: `quitar_fecha` y `estado` son acciones distintas", () => {
    // Es la confusión que costaba caro: sin plazo no es cancelada. Si «Sin fecha límite» tocara el
    // estado, arrastrar ahí una tarea la mataría, y la columna de al lado es justo Canceladas.
    const a = accionAlSoltar("sin", activa(dia(21)));
    expect(a).not.toHaveProperty("estado");
    expect(a.tipo).not.toBe("estado");
  });

  it("una que ya estaba sin plazo no manda nada", () => {
    expect(accionAlSoltar("sin", activa(null)).tipo).toBe("nada");
  });
});

describe("las columnas de estado cambian el estado y NO el plazo", () => {
  it("completar y cancelar", () => {
    expect(accionAlSoltar("completada", activa(dia(21)))).toEqual({ tipo: "estado", estado: "completada" });
    expect(accionAlSoltar("cancelada", activa(dia(21)))).toEqual({ tipo: "estado", estado: "cancelada" });
  });

  it("🔴 la acción no lleva fecha: la de la tarea se conserva", () => {
    // Si al cancelar se borrara el plazo, recuperar la tarea la devolvería sin fecha. El punto 1 de
    // esta tanda es justamente que una cancelada se pueda recuperar entera.
    expect(accionAlSoltar("cancelada", activa(dia(21)))).not.toHaveProperty("fecha");
  });

  it("soltarla donde ya está no manda nada", () => {
    expect(accionAlSoltar("cancelada", { estado: "cancelada", fecha_limite: null }).tipo).toBe("nada");
  });
});

describe("🔴 lo que NO se puede soltar tiene que decir por qué", () => {
  it("«Atrasado» no acepta: no se pone un plazo en el pasado", () => {
    const a = accionAlSoltar("atrasado", activa());
    expect(a.tipo).toBe("no_acepta");
    if (a.tipo === "no_acepta") expect(a.motivo.length).toBeGreaterThan(10);
  });

  it("⚠️ el domingo, «Esta semana» tampoco — y ese día la columna tiene que verse apagada", () => {
    vi.setSystemTime(new Date(2026, 7, 23, 10, 0, 0));
    const a = accionAlSoltar("semana", activa());
    expect(a.tipo).toBe("no_acepta");
    // El resto de días sí.
    vi.setSystemTime(new Date(2026, 7, 22, 10, 0, 0));
    expect(accionAlSoltar("semana", activa()).tipo).toBe("fecha");
  });

  it("se puede pasar de completada a cancelada y al revés", () => {
    expect(accionAlSoltar("cancelada", { estado: "completada", fecha_limite: null }).tipo).toBe("estado");
    expect(accionAlSoltar("completada", { estado: "cancelada", fecha_limite: null }).tipo).toBe("estado");
  });
});

describe("cómo se lee la fecha en el aviso", () => {
  it("hoy, mañana y ayer se dicen con palabras", () => {
    expect(textoDeFechaLimite(dia(19, 18, 0))).toMatch(/^Hoy, /);
    expect(textoDeFechaLimite(dia(20, 18, 0))).toMatch(/^Mañana, /);
    expect(textoDeFechaLimite(dia(18, 18, 0))).toMatch(/^Ayer, /);
  });

  it("más lejos, con el día del mes — y siempre con la hora", () => {
    const t = textoDeFechaLimite(dia(28, 18, 0));
    expect(t).toContain("28");
    expect(t).toContain("18:00");
  });

  it("🔴 el aviso y la tarjeta dicen lo mismo de la fecha que escribe la columna", () => {
    // Si el aviso dijera «viernes» y la tarjeta pusiera otra cosa, parecería que se guardó algo
    // distinto de lo que se pidió.
    const f = fechaParaColumna("semana")!;
    expect(textoDeFechaLimite(f)).toBe(textoDeFechaLimite(f.toISOString()));
  });

  it("una fecha ilegible no revienta el aviso", () => {
    expect(textoDeFechaLimite("no-es-una-fecha")).toBe("sin fecha");
  });
});

// ============================================================================================
// 🔴 RETOMAR UNA TAREA DADA POR TERMINADA
//
// «Algo que se canceló debería poderse regenerar y retomarse nuevamente» (Juan, 2026-08-21). Y lo
// mismo para una completada: el argumento es idéntico —algo que se dio por hecho y hay que
// rehacer— y dejar que se reabra una y la otra no sería la misma incoherencia al revés.
//
// Es la única acción que toca los DOS campos. Por eso tiene variante propia: quien la ejecuta
// tiene que saber que manda estado Y fecha en una sola petición.
// ============================================================================================

const TERMINADAS = ["cancelada", "completada"] as const;
const terminada = (estado: string, fecha_limite: string | Date | null = null) => ({ estado, fecha_limite });

describe("🔴 una cancelada o una completada se retoman", () => {
  for (const estado of TERMINADAS) {
    it(`una ${estado} soltada en una columna de fecha vuelve a pendiente CON plazo`, () => {
      for (const col of ["hoy", "semana", "proxima", "adelante"] as ColumnaTablero[]) {
        const a = accionAlSoltar(col, terminada(estado));
        expect(a.tipo, `${estado} → ${col}`).toBe("reabrir");
        if (a.tipo !== "reabrir") continue;
        expect(a.estado).toBe("pendiente");
        expect(a.fecha, `${estado} → ${col} sin fecha`).not.toBeNull();
      }
    });

    it(`una ${estado} soltada en «Sin fecha límite» vuelve a pendiente SIN plazo`, () => {
      const a = accionAlSoltar("sin", terminada(estado));
      expect(a).toEqual({ tipo: "reabrir", estado: "pendiente", fecha: null });
    });

    it(`🔴 una ${estado} NO se reabre vencida: «Atrasado» sigue sin aceptar`, () => {
      // «No le puede asignar al regenerarse que dicha tarea se regenera ya atrasada.» Retomar algo
      // no es darle por nacido un incumplimiento que nadie ha tenido todavía.
      const a = accionAlSoltar("atrasado", terminada(estado));
      expect(a.tipo).toBe("no_acepta");
      if (a.tipo === "no_acepta") expect(a.motivo).toMatch(/retomarla/i);
    });

    it(`una ${estado} sigue pudiendo pasar a la otra columna de estado`, () => {
      const otra = estado === "cancelada" ? "completada" : "cancelada";
      expect(accionAlSoltar(otra, terminada(estado))).toEqual({ tipo: "estado", estado: otra });
      expect(accionAlSoltar(estado, terminada(estado)).tipo, "y a la suya, nada").toBe("nada");
    });

    it(`⚠️ el domingo, una ${estado} tampoco se reabre en «Esta semana»`, () => {
      // Si la franja no tiene hueco, no lo tiene para nadie. La regla de reabrir no se salta la
      // frontera: pide la fecha al mismo sitio.
      vi.setSystemTime(new Date(2026, 7, 23, 10, 0, 0));
      expect(accionAlSoltar("semana", terminada(estado)).tipo).toBe("no_acepta");
      vi.setSystemTime(new Date(2026, 7, 22, 10, 0, 0));
      expect(accionAlSoltar("semana", terminada(estado)).tipo).toBe("reabrir");
    });

    it(`🔴 una ${estado} con plazo que YA cae en esa columna se reabre igual`, () => {
      // El atajo de «ya está ahí, no mando nada» es para tareas vivas. Aplicado a una terminada
      // dejaría la tarjeta en Completadas sin decir nada: parecería que el arrastre no funciona.
      const a = accionAlSoltar("hoy", terminada(estado, dia(19, 9, 0)));
      expect(a.tipo).toBe("reabrir");
    });
  }

  it("🔴 la acción de reabrir lleva SIEMPRE los dos campos", () => {
    // Es lo que obliga a mandarlos en una sola petición. Encadenar dos dejaría la tarea reabierta
    // sin plazo, o con plazo y todavía cancelada, si la segunda falla — y nadie sabría cuál pasó.
    for (const estado of TERMINADAS) {
      for (const col of ["hoy", "semana", "proxima", "adelante", "sin"] as ColumnaTablero[]) {
        const a = accionAlSoltar(col, terminada(estado));
        expect(a.tipo, `${estado} → ${col}`).toBe("reabrir");
        expect(a).toHaveProperty("estado");
        expect(a).toHaveProperty("fecha");
      }
    }
  });

  it("🔴 y una tarea VIVA no cambia de estado por soltarla en una columna de fecha", () => {
    // La regresión que hay que impedir. Reabrir es para lo terminado; para lo vivo, mover de plazo
    // sigue siendo mover de plazo y nada más.
    for (const col of ["hoy", "semana", "proxima", "adelante"] as ColumnaTablero[]) {
      expect(accionAlSoltar(col, activa()).tipo, col).toBe("fecha");
    }
    expect(accionAlSoltar("sin", activa(dia(21))).tipo).toBe("quitar_fecha");
    for (const col of ["hoy", "semana", "proxima", "adelante", "sin"] as ColumnaTablero[]) {
      expect(accionAlSoltar(col, { estado: "en_progreso", fecha_limite: null })).not.toHaveProperty("estado");
    }
  });
});
