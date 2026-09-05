// ==============================================================================================
// DE QUÉ CLIENTE ES UNA TAREA — una sola regla para los tres sitios que la preguntan
//
// Pedido por Juan David el 2026-09-02: «que se puedan crear tareas a los contactos… si no te
// metes en el cliente específico no puedes saber que la tarea está enlazada a ese cliente».
//
// El vínculo puede venir de tres sitios y hay que elegir uno:
//   · lo FIJA la pantalla   — se está creando desde la ficha de un contacto;
//   · lo DERIVA la oportunidad elegida — que ya tiene su propio contacto;
//   · lo ELIGE la persona a mano en el buscador.
//
// 🔴 POR QUÉ ESTO ES UN MÓDULO Y NO UN `if` DENTRO DEL MODAL. Lo preguntan el modal libre, el
// modal con el contacto fijado y el que se abre desde una oportunidad. Escrita tres veces, la
// regla no falla el día que se escribe: falla meses después, cuando una de las tres cambia y las
// otras dos no. Es `CONVENCIONES §4.8` — quien clasifica y quien escribe comparten las fronteras—,
// y por eso aquí viven las dos mitades: la que decide cuál es el contacto (`resolverVinculo`) y la
// que dice qué se manda al servidor (`paraGuardar`). La segunda se calcula desde la primera.
//
// ⚠️ Este módulo NO conoce React ni pide nada por red: es la capa que se prueba sin navegador
// (§9.1). Recibe lo que la pantalla ya tiene cargado y devuelve una decisión.
// ==============================================================================================

/** Lo mínimo para pintar un contacto y guardarlo. */
export interface ContactoLite {
  id: string;
  nombre: string;
}

/**
 * Una oportunidad tal como ya la devuelve `GET /api/oportunidades`
 * (`lib/oportunidades-filtro.ts` → `COLS_OPORTUNIDAD`), que trae el contacto resuelto.
 */
export interface OportunidadLite {
  id: string;
  nombre_caso: string;
  /** 🔴 NULLABLE de verdad: `oportunidades.contacto_id` lo es en el esquema (`0001_schema.sql:142`). */
  contacto_id: string | null;
  contacto_nombre: string | null;
}

export interface EntradaVinculo {
  /** Fijado por la pantalla que abre el modal (la ficha del contacto). Manda sobre todo lo demás. */
  contactoFijadoPorLaPantalla?: ContactoLite | null;
  /** Lo que la persona eligió a mano en el buscador. Se conserva aunque ahora no mande. */
  contactoElegido?: ContactoLite | null;
  /** La oportunidad seleccionada en el desplegable, si hay alguna. */
  oportunidad?: OportunidadLite | null;
  /**
   * 🔴 HAY UNA OPORTUNIDAD PUESTA CUYOS DATOS NO TENEMOS.
   *
   * Pasa de verdad, y por dos motivos: el modal pide la lista de oportunidades al abrirse —así que
   * hay una ventana en la que el id está puesto y la lista aún está vacía— y la lista puede no
   * traerla. Sin este dato, el módulo confundiría «esta oportunidad no tiene cliente» con «todavía
   * no sé de quién es», que son cosas distintas: la primera deja elegir, la segunda no puede.
   */
  oportunidadIdSinResolver?: string | null;
}

export type MotivoVinculo =
  /** Viene de la ficha del contacto desde la que se abrió el modal. */
  | "fijado"
  /** Lo pone la oportunidad elegida, que ya tenía contacto. */
  | "derivado"
  /** Lo eligió la persona en el buscador. */
  | "elegido"
  /** Hay una oportunidad puesta de la que aún no se sabe de quién es. */
  | "por_saber"
  /** No hay contacto todavía, y se puede poner. */
  | "libre";

export interface Vinculo {
  contactoId: string | null;
  contactoNombre: string | null;
  /** `true` = el campo no se edita, porque el contacto lo decide otra cosa. */
  editable: boolean;
  motivo: MotivoVinculo;
  /**
   * Por qué no se puede editar, en castellano y sin nombres de tabla ni de columna (§4.7). Cadena
   * vacía cuando sí se puede: un texto explicando lo que no pasa es ruido.
   */
  explicacion: string;
  /**
   * 🔴 El contacto fijado y el de la oportunidad elegida NO son el mismo.
   *
   * No debería ocurrir —`oportunidadesElegibles()` acota el desplegable—, pero un aviso escrito no
   * es una garantía (§4.9-bis): si alguien monta el modal sin filtrar la lista, esto se enciende y
   * la pantalla puede negarse a guardar en vez de escribir una tarea que dice pertenecer a dos
   * personas. El servidor lo rechaza igual, que es donde está la barrera de verdad.
   */
  conflicto: boolean;
}

/**
 * Quién es el cliente de esta tarea, ahora mismo, con lo que hay puesto en el formulario.
 *
 * El orden de las reglas ES la regla, y es el que se prueba:
 *
 *  1. Fijado por la pantalla → ése, y no se toca.
 *  2. Oportunidad elegida que tiene contacto → el suyo, derivado y no editable. Para poner otro
 *     hay que quitar la oportunidad; si se pudieran cambiar los dos por separado, se podría
 *     guardar una tarea atada al cliente A y al caso de B, y ya nadie sabría cuál manda.
 *  3. Oportunidad elegida SIN contacto → el campo queda LIBRE. Es el caso que se olvida: hay
 *     oportunidades sin contacto asignado, y dar por hecho que toda oportunidad trae uno deja el
 *     campo bloqueado y vacío, sin forma de rellenarlo.
 *  4. Nada de lo anterior → lo que la persona haya elegido, o vacío.
 */
export function resolverVinculo(e: EntradaVinculo): Vinculo {
  const fijado = e.contactoFijadoPorLaPantalla ?? null;
  const elegido = e.contactoElegido ?? null;
  const op = e.oportunidad ?? null;
  const contactoDeLaOportunidad = op?.contacto_id ? op : null;

  if (fijado) {
    return {
      contactoId: fijado.id,
      contactoNombre: fijado.nombre,
      editable: false,
      motivo: "fijado",
      explicacion: "Esta tarea es de este cliente porque se está creando desde su ficha.",
      conflicto: !!contactoDeLaOportunidad && contactoDeLaOportunidad.contacto_id !== fijado.id,
    };
  }

  if (contactoDeLaOportunidad) {
    return {
      contactoId: contactoDeLaOportunidad.contacto_id,
      contactoNombre: contactoDeLaOportunidad.contacto_nombre,
      editable: false,
      motivo: "derivado",
      explicacion: "El cliente lo pone la oportunidad elegida. Quita la oportunidad para elegir otro.",
      conflicto: false,
    };
  }

  // Hay oportunidad puesta pero no se sabe de quién es. Se enseña lo último que se sabía —para no
  // pintar un hueco donde había un nombre— y NO se deja editar: elegir a mano aquí sería apostar a
  // que la oportunidad no tiene dueño. Lo que se guarde lo decidirá el servidor (ver `paraGuardar`).
  if (e.oportunidadIdSinResolver && !op) {
    return {
      contactoId: elegido?.id ?? null,
      contactoNombre: elegido?.nombre ?? null,
      editable: false,
      motivo: "por_saber",
      explicacion: "El cliente lo pone la oportunidad elegida.",
      conflicto: false,
    };
  }

  if (elegido) {
    return {
      contactoId: elegido.id,
      contactoNombre: elegido.nombre,
      editable: true,
      motivo: "elegido",
      explicacion: "",
      conflicto: false,
    };
  }

  return {
    contactoId: null,
    contactoNombre: null,
    editable: true,
    motivo: "libre",
    explicacion: "",
    conflicto: false,
  };
}

/**
 * Qué se manda al servidor. Sale de `resolverVinculo`, **no de leer el formulario otra vez**: si
 * lo que se guarda se calculase aparte, es exactamente donde las dos mitades empiezan a divergir.
 *
 * Devuelve `null` cuando hay conflicto, para que la pantalla no tenga que acordarse de mirarlo.
 */
export function paraGuardar(e: EntradaVinculo): { contacto_id: string | null; oportunidad_id: string | null } | null {
  const v = resolverVinculo(e);
  if (v.conflicto) return null;
  return {
    // 🔴 Con una oportunidad de la que no se sabe el cliente se manda `null` A PROPÓSITO, y lo
    // deriva el servidor. Mandar el que teníamos guardado sería mandar un dato que quizá ya no
    // case con esa oportunidad, y el servidor rechazaría con un 400 que la persona no entendería
    // —le saldría al pulsar Guardar sin haber tocado nada del cliente—.
    contacto_id: v.motivo === "por_saber" ? null : v.contactoId,
    oportunidad_id: e.oportunidad?.id ?? e.oportunidadIdSinResolver ?? null,
  };
}

/**
 * Qué oportunidades se le pueden ofrecer.
 *
 * Con el contacto fijado, **solo las suyas**. Sin este recorte, desde la ficha de una persona se
 * podría elegir el caso de otra y la regla 1 chocaría con la 2 — y el choque se guardaría, porque
 * las dos partes del formulario se ven correctas por separado.
 *
 * Sin contacto fijado se ofrecen todas: ahí la oportunidad es la que manda.
 */
export function oportunidadesElegibles<T extends { contacto_id: string | null }>(
  oportunidades: T[],
  contactoFijadoId: string | null | undefined
): T[] {
  if (!contactoFijadoId) return oportunidades;
  return oportunidades.filter((o) => o.contacto_id === contactoFijadoId);
}
