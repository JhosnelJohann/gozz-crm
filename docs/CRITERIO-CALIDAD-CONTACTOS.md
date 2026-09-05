# Criterio de calidad de contactos (registro dorado)

> **Estado:** 📏 estándar vivo · **Fecha:** 2026-07-17 · Definido por Juan.
> **Propósito:** regla única para decidir si un contacto **sirve** o es candidato a archivar. Aplica al
> saneamiento (Bitrix) y a cualquier ingesta futura (Pipedrive, Zoho, GHL).

---

## La regla

> **Un contacto sirve solo si se le puede (a) CONTACTAR y (b) IDENTIFICAR.**

Debe cumplir **ambas**:

1. **Nombre real** — un nombre legible de persona (no "jj", no "null Test", no emojis/símbolos, no
   placeholder tipo "Deal from WhatsApp" o "bitrix lead:NNNN").
2. **Al menos uno de {teléfono, email}** — una vía real para contactarlo.

Y una regla adicional para clientes:

3. **Los contactos con oportunidades (ganadas / pagadas / perdidas) deben tener su data adjunta**
   (documentos: imágenes, PDFs, comprobantes). Una oportunidad sin ningún documento es sospechosa —
   o le faltó cargar la data, o la migración la perdió (ver Bitrix §3, "oportunidad sin archivos").

---

## Qué hacer con los que NO cumplen

| Situación | Acción |
|---|---|
| Nombre ilegible **Y** sin tel/email **Y** sin oportunidad **Y** sin documentos | **Archivar** (basura: no se puede contactar ni identificar). Reversible. |
| Nombre ilegible **pero** con tel/email **y** con algún documento | **Rescatar** — del documento se puede extraer el nombre real. NO archivar. |
| Nombre real pero sin tel/email | **Enriquecer** (buscar contacto en las fuentes: Bitrix, Pipedrive…). NO archivar. |
| Familiar anidado (hijo/cónyuge sin tel/email propio) | **Conservar** — hereda el contacto del titular. NUNCA archivar por falta de datos. Ver `IDEA-contactos-arbol-familiar.md`. |
| **Nombre ilegible que ES un teléfono** (ej. `19452584414`) | **Rescatar el teléfono, NO archivar.** Parece basura —nombre ilegible, campo teléfono vacío— pero es contactable: el dato está en el campo equivocado. Verificado en prod 2026-07-20: **6 casos**. |

**Por qué el matiz del documento:** el problema con "jj" o "null Test" es que **no hay forma de contactarlo
ni de saber quién es** — inservible. Pero si ese mismo contacto tuviera teléfono/email **y** un documento
(ej. un pasaporte escaneado), un usuario podría **extraer el nombre real del documento** y rescatarlo. El
documento es lo que hace útil a un contacto que de otro modo sería basura.

---

## 🔴 Precisión: un teléfono sin nombre NO es una vía de contacto útil

> **Regla (Juan, 2026-07-21): un contacto con nombre ilegible y SIN documentos es basura,
> aunque tenga teléfono.**

Es la corrección más importante al criterio, y hay que entender por qué antes de aplicarla.

**El teléfono sirve para vender, no para existir.** Un contacto solo vale si habilita una venta. Y con
un nombre ilegible **la llamada es inviable**:

> — *"Buenos días, le llamo para ofrecerle nuestros servicios… ¿me podría indicar su nombre?"*
>
> — *"Buenos días, veo aquí que usted trabajó antes con nosotros, pero no tenemos ningún archivo.
> ¿Cómo se llama y qué trámite le hicimos?"*

Ninguna de las dos conversaciones se sostiene. No se puede hacer postventa sin saber a quién se llama ni
qué se le hizo.

**Y el costo no lo paga la empresa, lo paga el cliente.** Esos teléfonos llegaron porque **la persona se
registró voluntariamente** esperando que la contactáramos bien. Si el dato quedó mal grabado **la culpa es
nuestra**, y llamarlo así le hace pasar un mal rato — que además, con altísima probabilidad, no termina en
venta. Es un contacto que solo puede producir daño reputacional.

### Cómo queda la regla — hacen falta las TRES condiciones

Un contacto ilegible solo es **rescatable** si se cumple:

> **Nombre ilegible + documentos + teléfono/email = RESCATABLE**

Las tres, no dos. El documento aporta la **identidad**; el teléfono aporta el **acceso**. Falta
cualquiera de los dos y el contacto no habilita una venta.

| Nombre | Documentos | Vía de contacto | Veredicto |
|---|---|---|---|
| Ilegible | ✅ | ✅ | ✅ **RESCATABLE** — abrir el documento, asignar nombre, y ya se puede llamar |
| Ilegible | ✅ | ❌ | ⚠️ Identificable pero **incontactable** — se sabría quién es, pero no hay cómo llegarle |
| Ilegible | ❌ | ✅ | ❌ **BASURA** — el teléfono no alcanza: la llamada es inviable |
| Ilegible | ❌ | ❌ | ❌ **BASURA DURA** |
| Legible | — | ✅ | ✅ Se conserva |
| Legible | — | ❌ | ⚠️ Incontactable — enriquecer si hay fuente; si no, decidir |

⚠️ **El rescate por documento requiere revisión humana.** Que un contacto tenga archivos no garantiza que
de ahí salga un nombre: hay que **abrirlos** para saberlo. Por eso los "ilegibles con documentos" no se
archivan automáticamente ni se dan por rescatados: **van a una cola de revisión manual**.

**Formulación corta:** para conservar un contacto hace falta **nombre para ofrecerle un servicio**, o
**documentos que permitan asignarle uno**. Sin ninguna de las dos, el teléfono no alcanza.

---

## Regla de oro operativa

> **Nunca archivar a ciegas.** Antes de archivar un contacto por "inútil", verificar que NO tenga
> documentos rescatables en **ninguna** fuente (nuestra BD, Bitrix, Pipedrive). Un contacto que parece
> vacío aquí puede tener su expediente en otro origen.

### ✅ Verificación cumplida para la Fase 4 (2026-07-21)

La versión original de esta regla decía que el archivado **esperaría** a integrar todas las fuentes,
Pipedrive incluido. **Esa espera dejó de ser viable** (acceso a Pipedrive caducado, cuenta de Drive
bloqueada, y la suscripción de Bitrix vence el 23/07). Así que en vez de esperar, **se verificó**:

| Comprobación sobre los 1.815 candidatos | Resultado |
|---|---|
| Con `pipedrive_person_id` | **1** |
| Con `zoho_id` | 7 |
| Con documentos en `contactos_notas` | 2 (quedan **excluidos**, son rescatables) |
| Con oportunidades | 0 (excluidos por salvaguarda) |
| Con documentos en el Drive | **imposible por diseño** — `drive_folders` cuelga de `oportunidad_id`, y estos contactos no tienen oportunidades |

⇒ **El cruce contra el CSV de Pipedrive no habría cambiado el resultado** (1 contacto de 1.815).
La regla de oro se cumplió **por verificación, no por espera**.

📌 **Cuando Pipedrive se recupere**, el trabajo pendiente es distinto y no depende de esto: comparar
sus CSV y archivos contra nuestra base, e importar lo que falte con su saneamiento. Archivar ahora
no lo impide — el archivado es **reversible**, así que si aparece un expediente para alguno de estos
contactos, se des-archiva y listo.

---

## Estado de aplicación

- El saneamiento ya marca `saneamiento_revision` (nombre ilegible) y `archivado` (fusionado por dedup).
- La **auditoría** de cuántos cumplen/incumplen es de solo lectura (ver query en la sesión de trabajo).
- El **archivado** de los que incumplen queda **pendiente** hasta cruzar Pipedrive (no archivar a ciegas).

---

*Estándar definido el 2026-07-17. Aplicar en el saneamiento y en toda ingesta futura de contactos.*
