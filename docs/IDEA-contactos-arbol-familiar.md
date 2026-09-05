# Idea — Contactos anidados: árbol familiar

> **Estado:** 💡 idea de producto · **Prioridad:** media-alta
> **Origen:** Juan, 2026-07-14, mientras definíamos el saneamiento de Bitrix.
> **No tiene que ver con la migración** — pero **nace de una carencia que la migración destapó**.

---

## El problema real

En los trámites de inmigración —**asilo (I-589) sobre todo**— un caso **abarca a varias personas**: el
solicitante principal y sus **familiares dependientes** (cónyuge, hijos).

Cada familiar **existe como contacto individual**: tiene su **nombre**, su **fecha de nacimiento**, sus
**documentos** (pasaporte, partida de nacimiento, fotos). Pero **no tiene teléfono ni email propios** —
sobre todo si son menores — porque **todo el trato se hace a través del familiar titular**.

Hoy el sistema **no sabe que están relacionados**. Son registros sueltos que *parecen huérfanos*.

### La consecuencia inmediata (y grave)

Un niño en un caso de asilo tiene el perfil exacto de un "contacto basura": sin teléfono, sin email, sin
oportunidad propia. **Cualquier limpieza automática ingenua se lo lleva por delante.**

Y en el día a día: nadie puede saber, mirando la ficha del niño, **a quién llamar**.

---

## La idea

**Contactos anidados en un árbol familiar.**

1. **Un contacto puede colgar de otro** (relación *"familiar de"*, con el vínculo: cónyuge, hijo/a,
   padre/madre, hermano/a…).
2. **El registro sigue siendo individual.** El familiar tiene su ficha, sus documentos, su historial.
   **No** es un campo dentro del padre.
3. **Herencia de contactabilidad:** si el familiar **no tiene** teléfono o email propios, se **muestra
   el del titular al que está vinculado**, marcado claramente como *"a través de \<nombre del titular\>"*.
   Nunca se copia el dato — **se hereda y se muestra**, para que no haya dos fuentes de verdad.
4. **Navegación:** desde cualquier miembro se ve el **árbol completo** y se puede saltar a los demás.
5. **Búsqueda:** buscar al padre encuentra también a los hijos (y al revés).

---

## Por qué importa más de lo que parece

- **Protege data real de las limpiezas automáticas.** Una vez existe el vínculo, un contacto sin
  teléfono **pero con familia** deja de parecer basura: **tiene significado**.
- **Refleja cómo funciona el negocio de verdad.** No se venden trámites a personas sueltas: se atienden
  **familias**.
- **Mejora la operación.** El asesor ve el caso completo, sabe a quién llamar y qué documentos faltan
  **por cada miembro**.

---

## Preguntas para cuando se aborde

1. ¿El vínculo es **jerárquico** (titular → dependientes) o un **grafo** (todos con todos)?
   *Recomendación inicial:* jerárquico con un **titular explícito** — es como funciona el trámite.
2. ¿Un contacto puede pertenecer a **más de una familia**? (Ej.: un adulto que fue dependiente en un caso
   y luego titular del suyo.) Probablemente **sí** → el modelo debe permitirlo.
3. ¿La **oportunidad** cuelga solo del titular, o los dependientes también aparecen en ella?
4. ¿Se puede **inferir** el árbol de la data existente? (mismo apellido + misma dirección + mismo trámite
   + documentos que se refieren entre sí) → sería un **hallazgo del saneamiento de Bitrix**.
5. ¿Bitrix guardaba esa relación de alguna forma? **Hay que buscarla** — si existe, se puede reconstruir
   el árbol en vez de armarlo a mano.

---

## Relación con el saneamiento de Bitrix

Aunque son proyectos distintos, se tocan en dos puntos:

- El saneamiento **debe identificar** a los familiares anidados **antes** de archivar nada
  (contexto de orígenes en `CHECKPOINT-MAESTRO.md`).
- Si al investigar aparece una forma de **inferir el parentesco**, esa información es la **semilla** de
  esta funcionalidad. **Hay que guardarla, no descartarla.**

---

*Anotado el 2026-07-14. Sprint aparte.*
