// ============================================================================================
// EN QUÉ COLUMNA CAE UNA TAREA EN LA VISTA «POR FECHA LÍMITE»
//
// Esta regla vivía dentro de `TareasPorFecha.tsx`, en el `useMemo` que arma los buckets. Se saca
// aquí por dos motivos, y el segundo es el que importa:
//
//   · es lo único de esa vista comprobable sin navegador;
//   · 🔴 en cuanto el tablero acepte arrastre, va a haber DOS sitios razonando sobre las mismas
//     franjas: el que reparte las tarjetas y el que decide qué fecha escribir al soltar. Si cada
//     uno lleva su propia aritmética de semanas, una tarjeta soltada en «Esta semana» puede
//     aterrizar en «Atrasado» — y eso, en un tablero, es el fallo más desconcertante que hay:
//     la tarjeta se va sola a otro sitio delante de quien la arrastró.
//
// Las franjas, tal como estaban y sin cambiarlas:
//   · sin fecha            → «Sin fecha límite»
//   · hoy (00:00–23:59)    → «Para hoy»          ← se mira ANTES que «atrasado», así que una
//                                                  fecha de hoy ya pasada sigue siendo de hoy
//   · anterior a hoy       → «Atrasado»
//   · hasta el DOMINGO     → «Esta semana»       ← ⚠️ la semana acaba en domingo, no en viernes
//   · hasta el domingo +7  → «Próxima semana»
//   · más allá             → «Más adelante»
//
// ⚠️ La semana se cuenta de LUNES a DOMINGO (`(getDay() + 6) % 7`), no de domingo a sábado. Es lo
// que ya hacía la vista y lo que espera el equipo.
// ============================================================================================

export type ColumnaFecha = "atrasado" | "hoy" | "semana" | "proxima" | "adelante" | "sin";

export function inicioDelDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Los cuatro cortes que definen las franjas, calculados desde un «hoy» concreto. */
export function cortesDeSemana(hoy: Date = new Date()) {
  const inicioHoy = inicioDelDia(hoy);
  const finHoy = new Date(inicioHoy); finHoy.setHours(23, 59, 59, 999);
  const diaSemana = (inicioHoy.getDay() + 6) % 7; // lunes = 0 … domingo = 6
  const finEstaSemana = new Date(inicioHoy);
  finEstaSemana.setDate(inicioHoy.getDate() + (6 - diaSemana));
  finEstaSemana.setHours(23, 59, 59, 999);
  const finProximaSemana = new Date(finEstaSemana);
  finProximaSemana.setDate(finEstaSemana.getDate() + 7);
  return { inicioHoy, finHoy, finEstaSemana, finProximaSemana, diaSemana };
}

/**
 * La columna que le toca a una fecha límite.
 *
 * `hoy` se pasa para poder probarla: sin eso, «esta semana» significa algo distinto cada día y una
 * prueba no demostraría nada.
 */
export function columnaDeTarea(fechaLimite: string | Date | null | undefined, hoy: Date = new Date()): ColumnaFecha {
  if (!fechaLimite) return "sin";
  const d = fechaLimite instanceof Date ? fechaLimite : new Date(fechaLimite);
  if (Number.isNaN(d.getTime())) return "sin";

  const { inicioHoy, finHoy, finEstaSemana, finProximaSemana } = cortesDeSemana(hoy);

  // El orden importa: «hoy» va primero para que una hora ya pasada de hoy no caiga en «atrasado».
  if (d >= inicioHoy && d <= finHoy) return "hoy";
  if (d < inicioHoy) return "atrasado";
  if (d <= finEstaSemana) return "semana";
  if (d <= finProximaSemana) return "proxima";
  return "adelante";
}

/**
 * ⚠️ ¿Puede la columna «Esta semana» contener algo hoy?
 *
 * Su franja es «desde mañana hasta el domingo». **El domingo esa franja está VACÍA**, porque el
 * domingo ya es el final de la semana: no hay ninguna fecha que caiga ahí. No es un caso raro que
 * convenga ignorar — es un día de cada siete, y cualquier cosa que intente escribir una fecha
 * «de esta semana» un domingo va a fallar.
 */
export function laSemanaAdmiteFechas(hoy: Date = new Date()): boolean {
  const { finHoy, finEstaSemana } = cortesDeSemana(hoy);
  return finEstaSemana.getTime() > finHoy.getTime();
}

// ============================================================================================
// QUÉ PASA AL SOLTAR UNA TARJETA EN UNA COLUMNA
//
// 🔴 ESTO VIVE AQUÍ, PEGADO AL CLASIFICADOR, Y NO EN EL COMPONENTE. El fallo de raíz del intento
// anterior no fue elegir mal el viernes: fue poner una SEGUNDA definición de «esta semana» al lado
// de la que ya existía. En cuanto hay dos, divergen, y la forma en que divergen es la peor posible
// en un tablero: la tarjeta se va sola a otra columna delante de quien la arrastró.
//
// Todo lo de abajo se calcula a partir de `cortesDeSemana`. No hay ni un `getDay()` suelto ni un
// «+7» escrito a mano contra otra frontera. Si mañana la semana pasara a ir de domingo a sábado,
// se cambia `cortesDeSemana` y esto la sigue.
//
// La invariante que lo sostiene, comprobada para LOS SIETE DÍAS en `tests/tareas-fechas.test.ts`:
//
//     columnaDeTarea(fechaParaColumna(col, dia), dia) === col
//
// Es decir: la fecha que escribe una columna cae en esa columna. Siempre.
// ============================================================================================

/** Columnas del tablero «Por fecha límite»: las de fecha, más las dos de estado terminal. */
export type ColumnaTablero = ColumnaFecha | "completada" | "cancelada";

export const ETIQUETA_COLUMNA: Record<ColumnaTablero, string> = {
  atrasado: "Atrasado",
  hoy: "Para hoy",
  semana: "Esta semana",
  proxima: "Próxima semana",
  adelante: "Más adelante",
  sin: "Sin fecha límite",
  completada: "Completadas",
  cancelada: "Canceladas",
};

/**
 * Final de jornada. Soltar en «Para hoy» a las 19:00 sigue valiendo: el clasificador mira «hoy»
 * antes que «atrasado», así que una hora ya pasada de hoy sigue siendo de hoy.
 */
export const HORA_LIMITE = 18;

/**
 * Cuántos días adelante escribe «Más adelante». Solo tiene que caer más allá del domingo que
 * viene —13 días como mucho—, y 30 deja margen de sobra.
 */
export const DIAS_MAS_ADELANTE = 30;

const diasDespues = (base: Date, n: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};

const aLaHoraLimite = (base: Date): Date => {
  const d = new Date(base);
  d.setHours(HORA_LIMITE, 0, 0, 0);
  return d;
};

/**
 * La fecha límite que escribe una columna, o `null` si esa columna no tiene ninguna que escribir.
 *
 * `null` significa **«no hay hueco»**, no «quitar la fecha»: son cosas distintas, y por eso quien
 * decide qué hacer al soltar es `accionAlSoltar` y no esta función. Pasa en dos sitios:
 *   · «Atrasado» y «Sin fecha límite», que por definición no escriben una fecha;
 *   · ⚠️ «Esta semana» **el domingo**, porque su franja va de mañana al domingo y el domingo eso
 *     está vacío. Es un día de cada siete, no un caso de laboratorio.
 *
 * La candidata natural es el **viernes a las 18:00**, que es lo que la gente entiende por «esta
 * semana». Pero solo se usa si cae DENTRO de la franja de la columna; si no —viernes, sábado—, se
 * usa el último día de la franja. Ese «si no» es justo el que faltaba en el intento anterior.
 */
export function fechaParaColumna(columna: ColumnaTablero, hoy: Date = new Date()): Date | null {
  const { inicioHoy, finHoy, finEstaSemana, finProximaSemana, diaSemana } = cortesDeSemana(hoy);

  /** Dentro de la franja `(desde, hasta]` — abierta por abajo, igual que el clasificador. */
  const enLaFranja = (d: Date, desde: Date, hasta: Date) => d > desde && d <= hasta;

  /** El viernes de la semana de `inicioHoy`, desplazado `semanas` semanas. Lunes = 0, viernes = 4. */
  const viernesDe = (semanas: number) => aLaHoraLimite(diasDespues(inicioHoy, 4 - diaSemana + 7 * semanas));

  switch (columna) {
    case "hoy":
      // Hoy a las 18:00 cae siempre dentro de [inicioHoy, finHoy]. No hay caso raro.
      return aLaHoraLimite(inicioHoy);

    case "semana": {
      const viernes = viernesDe(0);
      if (enLaFranja(viernes, finHoy, finEstaSemana)) return viernes;
      const ultimo = aLaHoraLimite(finEstaSemana);
      return enLaFranja(ultimo, finHoy, finEstaSemana) ? ultimo : null;
    }

    case "proxima": {
      const viernes = viernesDe(1);
      if (enLaFranja(viernes, finEstaSemana, finProximaSemana)) return viernes;
      const ultimo = aLaHoraLimite(finProximaSemana);
      return enLaFranja(ultimo, finEstaSemana, finProximaSemana) ? ultimo : null;
    }

    case "adelante": {
      const d = aLaHoraLimite(diasDespues(inicioHoy, DIAS_MAS_ADELANTE));
      return d > finProximaSemana ? d : null;
    }

    default:
      // «atrasado» y «sin» no escriben fecha, y las columnas de estado tampoco.
      return null;
  }
}

/**
 * Lo que hay que hacerle a la tarea al soltarla. El `tipo` separa los tres «no pasa nada» que de
 * otro modo se confundirían: quitar el plazo, ya estar ahí, y no poder soltarse.
 */
export type AccionSoltar =
  /** Escribir `fecha_limite`. El estado NO se toca. */
  | { tipo: "fecha"; fecha: Date }
  /** `fecha_limite = null`. La tarea sigue VIVA: sin plazo no es lo mismo que cancelada. */
  | { tipo: "quitar_fecha" }
  /** Cambiar `estado`. La fecha NO se toca. */
  | { tipo: "estado"; estado: "completada" | "cancelada" }
  /**
   * 🔴 RETOMAR una tarea dada por terminada: vuelve a «pendiente» **y** se le escribe el plazo de
   * la columna (o `null`, si es «Sin fecha límite»).
   *
   * Es la ÚNICA acción que toca los dos campos, y por eso tiene su propia variante en vez de
   * colarse dentro de `fecha` o de `estado`. Quien la ejecuta **tiene que saber** que manda los
   * dos, en UNA sola petición: encadenar dos dejaría la tarea reabierta sin plazo, o con plazo y
   * todavía cancelada, si la segunda falla — y nadie sabría cuál de las dos pasó.
   */
  | { tipo: "reabrir"; estado: "pendiente"; fecha: Date | null }
  /** La tarea ya está como quedaría. No se manda nada. */
  | { tipo: "nada" }
  /** No se puede soltar ahí, y hay que decir por qué. */
  | { tipo: "no_acepta"; motivo: string };

type TareaParaSoltar = { estado: string; fecha_limite: string | Date | null };

/**
 * Qué hacer al soltar `tarea` en `columna`.
 *
 * Depende de la tarea y no solo de la columna, y las dos ramas son distintas de verdad:
 *
 *   · una tarea VIVA cambia UNA cosa — el plazo en las columnas de fecha, el estado en las de
 *     estado. Nunca las dos;
 *   · una tarea CANCELADA o COMPLETADA soltada en una columna de fecha **se retoma**: algo que se
 *     dio por hecho y hay que rehacer vuelve a estar pendiente, con plazo nuevo. Dejar que se
 *     reabriera una y la otra no sería la misma incoherencia al revés.
 *
 * ⚠️ El orden de las comprobaciones importa: lo terminal se decide **antes** que los atajos de una
 * tarea viva. Una completada cuyo plazo cayera justo en la columna donde la sueltas tiene que
 * reabrirse igual, no salir por el «ya está ahí, no mando nada».
 */
export function accionAlSoltar(
  columna: ColumnaTablero,
  tarea: TareaParaSoltar,
  hoy: Date = new Date(),
): AccionSoltar {
  const terminada = tarea.estado === "completada" || tarea.estado === "cancelada";

  if (columna === "completada" || columna === "cancelada") {
    return tarea.estado === columna ? { tipo: "nada" } : { tipo: "estado", estado: columna };
  }

  if (columna === "atrasado") {
    return {
      tipo: "no_acepta",
      // 🔴 Motivos distintos porque son cosas distintas. Retomar una tarea ya vencida no es «una
      // fecha en el pasado» a secas: es darle por nacido un atraso que nadie ha incumplido
      // todavía. Se retoma con plazo nuevo, o sin ninguno.
      motivo: terminada
        ? "Al retomarla hay que darle un plazo nuevo, o ninguno. No se puede reabrir vencida."
        : "No se puede poner una fecha límite en el pasado.",
    };
  }

  if (columna === "sin") {
    if (terminada) return { tipo: "reabrir", estado: "pendiente", fecha: null };
    return tarea.fecha_limite ? { tipo: "quitar_fecha" } : { tipo: "nada" };
  }

  // 🔴 La fecha sale SIEMPRE de `fechaParaColumna` — también por el camino de retomar. Si el
  // domingo «Esta semana» no tiene hueco, tampoco lo tiene para reabrir ahí.
  const fecha = fechaParaColumna(columna, hoy);
  if (!fecha) {
    return {
      tipo: "no_acepta",
      motivo: "Hoy es domingo: «esta semana» acaba hoy y no queda ningún día en esa franja.",
    };
  }

  if (terminada) return { tipo: "reabrir", estado: "pendiente", fecha };

  // Ya está en esa franja: no se reescribe la hora que alguien puso a mano.
  if (columnaDeTarea(tarea.fecha_limite, hoy) === columna) return { tipo: "nada" };

  return { tipo: "fecha", fecha };
}
/**
 * Cómo se lee una fecha límite en pantalla: «Hoy, 18:00», «Mañana, 18:00», «28 de agosto, 18:00».
 *
 * Estaba dentro de `TareasPorFecha.tsx`. Se saca porque el aviso al soltar tiene que decir **la
 * fecha exacta** a la que quedó la tarea, y tiene que decirla igual que la tarjeta: si el aviso y
 * la tarjeta la escriben distinto, parece que se guardó otra cosa.
 */
export function textoDeFechaLimite(fecha: string | Date, hoy: Date = new Date()): string {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "sin fecha";
  const dias = Math.round((inicioDelDia(d).getTime() - inicioDelDia(hoy).getTime()) / 86400000);
  const hora = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const dia =
    dias === 0 ? "Hoy"
    : dias === 1 ? "Mañana"
    : dias === -1 ? "Ayer"
    : d.toLocaleDateString("es", { day: "numeric", month: "long" });
  return `${dia}, ${hora}`;
}
