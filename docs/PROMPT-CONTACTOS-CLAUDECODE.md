# PROMPT PARA CLAUDE CODE (VSCode) — Módulo CONTACTOS

> 🔴 **ESTE ES EL ÚNICO DOCUMENTO DE ESPECIFICACIÓN DEL MÓDULO CONTACTOS.**
> **NO se crean adendas, nunca más.** Toda decisión nueva se incorpora AQUÍ, en su sección,
> y se anota en el registro de versiones de abajo. Si alguien te pasa una adenda suelta:
> incorpórala a este archivo y bórrala.

**v5 (2026-08-06) — absorbe la ADENDA v4 (ya borrada) y cierra la OLA 0.** Cambios respecto de
la v4: se añade la **OLA 0** (archivado lógico) con sus reglas duras **R1–R9**, que nacen de la
introspección de FKs del paso 1; se corrige la premisa falsa de que el archivado "no cambia la
conducta visible" (**R1**); y quedan congelados los índices de `contactos_cache` (**R8**) y la FK
de `contactos_notas` (**R7**) hasta verificar contra producción.

**v4 (2026-08-06) — decisiones de producto tras auditar la Fase 0.** La fusión es de
**exactamente 2 contactos** y **reutiliza el id del maestro** (§A). La Ola 1 construye la
**tabla** (el mosaico ya existía). Se aprueba la columna `responsable_user_id`. Se añade la
propagación de la fusión a GHL.

**v3 — la Ola 2 especifica la fusión MANUAL campo por campo.** El motor que ya existe solo
rellena huecos y nunca pisa un valor lleno; la herramienta de auditoría que se pide aquí sí
tiene que poder, y eso obliga a un parámetro nuevo en el motor, un contrato de API distinto y
un modal comparativo con radios por campo. Todo eso está detallado en la Ola 2, junto con la
separación entre lo que el usuario elige (campos escalares) y lo que jamás elige y siempre se
conserva íntegro (documentos, oportunidades, tareas).

**v2 — reescrito contra el código real del repo.** Esta versión ya no adivina nombres: usa
`contactos_cache`, `contactos_merge_log`, `notificaciones`, `auditoria`, `user_permisos` y las
reglas de `docs/CONVENCIONES.md`. El cambio más importante frente a la v1: **la fusión de
contactos NO se construye desde cero — ya existe y funciona** en `scripts/dedup-contactos.mjs` +
migración `0042_dedup.sql`. La Ola 2 pasa de "implementar fusión" a "extraer el motor que ya
está probado y exponerlo por UI".

> Cómo usar este archivo: **no lo pegues completo.** Pega la ola que toca. Cada ola en su turno
> y en su propia rama. El orden es **OLA 0 → OLA 1 → OLA 2 → OLA 3**.

---

## DECISIONES DE PRODUCTO CERRADAS — no las re-preguntes

**A1. Nada se borra físicamente en el flujo normal. Punto.** Ni la fusión ni el botón
"Eliminar" borran filas. Todo es archivado lógico (`archivado = true`, motivo, y en fusión
`fusionado_en_contacto_id`). Un contacto archivado es INVISIBLE en todo: listado, búsqueda,
contador total, exportación, selectores. Para el usuario dejó de existir. La fila sobrevive
solo como respaldo de auditoría y para permitir deshacer.

**A2. Existe una purga, y es una herramienta aparte, manual y de super_admin.** El borrado
físico definitivo SÍ existe, pero NO se dispara nunca desde el flujo de fusión ni desde el
botón eliminar. Es un proceso separado, explícito, que un super_admin ejecuta sobre contactos
archivados con más de N días, previa revisión. Se especifica en la OLA 0, paso 3.

**A3. La fusión es de EXACTAMENTE 2 contactos. Ni 3, ni 10.** Contacto A + Contacto B → un solo
contacto resultante. Con 1 seleccionado o con 3+, la opción "Fusionar" está deshabilitada con el
motivo visible ("Selecciona exactamente 2 contactos para fusionar"). Esto SUSTITUYE cualquier
mención a "entre 2 y 10" o "2..10" en el endpoint, en la validación y en la UI.

**A4. El contacto resultante REUTILIZA el id del maestro. No se crea un contacto nuevo.** Se
evaluó crear un "contacto AB" nuevo y se descartó: un id nuevo obliga a repuntar todos los
documentos, oportunidades, tareas y carpetas de Drive, y rompe cualquier referencia externa
(GHL, Bitrix, enlaces guardados).

**A5. La fusión debe propagarse a GHL.** Ver la sección GHL dentro de la OLA 2.

**A6. Los contactos van a tener responsable propio.** Ver OLA 3 · F1.

---

## CONTEXTO PERMANENTE (va al inicio de CADA ola)

```
Proyecto: CRM TADI. Monorepo pnpm.
  apps/api        → Express + TypeScript. El tsconfig compila SOLO src/.
  apps/frontend   → Next.js 14 App Router.  ← OJO: es "frontend", NO "web".
  packages/db/migrations → migraciones SQL.

LECTURA OBLIGATORIA ANTES DE TOCAR NADA:
  - docs/CONVENCIONES.md  (es un CONTRATO, no una sugerencia)
  - docs/BASE-DE-DATOS.md (referencia real del esquema; obligatoria antes de tocar la BD)
  - CLAUDE.md (raíz) — de ahí sale el PRÓXIMO NÚMERO DE MIGRACIÓN. No lo adivines.

REGLAS DURAS — no negociables:

1.  Rama nueva SIEMPRE desde `dev`. Verifica con `git branch --show-current` antes de crear.
    Nombre EN INGLÉS, formato `autor/description` en kebab-case (convención §5).
2.  Mensajes de commit EN INGLÉS, Conventional Commits: `tipo(scope): summary`.
    Ej: `feat(contacts): add server-side pagination`.
3.  NO haces push. NO haces merge. NO abres PR. Solo commits locales.
    El pipeline es dev → qa (Jhosnel/QA) → prod (solo Juan David aprueba). No te metas ahí.
4.  NUNCA ejecutes `pm2 restart crm-api` ni `pm2 restart crm-frontend`. Es PRODUCCIÓN VIVA.
5.  Migraciones: `NNNN_descripcion_en_snake_case.sql`, 4 dígitos, secuencial sin saltos.
    IDEMPOTENTES siempre (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
    NO escribas BEGIN/COMMIT: la transacción la da el runner.
    Tablas en el esquema `crm_tadi`.
    NO ejecutes la migración. La dejas escrita y me avisas para correr `pnpm migrate` a mano.
    Y por regla §1.12: toda migración que cree o modifique tabla/columna/vista/FK/índice DEBE
    venir con su entrada en `docs/BASE-DE-DATOS.md` explicando la FUNCIÓN de lo nuevo, no solo
    el nombre. Migración sin doc = migración incompleta. Esta es la única doc que sí actualizas.
6.  SQL: siempre el helper `query` de `./db.js` con placeholders `$1, $2`. NUNCA interpoles
    valores del usuario. (Si necesitas interpolar un IDENTIFICADOR, valídalo contra
    `/^[a-z_][a-z0-9_]*$/` primero — es el patrón que ya usa `scripts/dedup-contactos.mjs`.)
7.  Auth backend: `requireAuth` protege rutas; el usuario va en `(req as any).user` = `{sub, email, nivel}`.
    Roles: `crm_tadi.users.nivel_acceso` ∈ `super_admin` | `admin` | `usuario`.
    Helper `isAdmin(u)` = nivel ∈ {admin, super_admin}.
    Permisos granulares: tabla `crm_tadi.user_permisos (user_id, permiso)`.
    PROHIBIDO agregar columnas booleanas de permiso a `users`. PROHIBIDO meter permisos en el JWT.
    La verificación se hace por consulta a DB en cada request.
8.  Lógica compartida va en `apps/api/src/lib/` — una sola fuente de verdad, no duplicada por
    archivo de rutas.
9.  Frontend: permisos de UI con `useCurrentUser()` (`lib/auth-user.ts`) → `{user, isAdmin, isSuperAdmin}`.
    La UI NUNCA es la única barrera: todo lo que gatees en el front se valida también en el back.
    Colores de marca: naranja `#FF8609`, ámbar `#FFB51C`. Usa las clases existentes
    (`brand-orange`, `gradient-orange`), no colores sueltos.
10. RENDIMIENTO (§3.6): el sistema maneja decenas de miles de filas. PROHIBIDO O(n²) en JS sobre
    el event loop. Usa SQL o `Map` indexado. El `statement_timeout` de Postgres NO corta un bucle
    de CPU en Node: un O(n²) cuelga la API entera. Ya pasó con el árbol de Drive.
11. El build NO valida lint (`eslint.ignoreDuringBuilds: true`). Un build verde no dice nada.
    Corre typecheck y lint aparte y pégame el resultado.
12. GUARDARRAÍL DE PRESERVACIÓN — el más importante de este proyecto:
    NADA se borra físicamente. Nunca. Ni una fila, ni un archivo, ni un objeto de R2.
    Todo "borrado" es archivado lógico y REVERSIBLE, con bitácora que permita deshacerlo.
    Ante la duda, se preserva. Es el criterio con el que está construido todo el saneamiento
    de contactos y no se rompe por una feature de UI.
13. Si algo del enunciado no calza con el código real, TE DETIENES Y PREGUNTAS. No improvises
    nombres de tablas, columnas, endpoints ni componentes.
14. Reporte final de cada ola: la salida LITERAL de `git --no-pager diff --stat` y
    `git --no-pager log --oneline dev..HEAD`. No me des tu resumen de lo que hiciste.
    Yo audito el diff crudo, no tu narración.

FUERA DE ALCANCE (no lo toques ni lo propongas):
  - Revisión de los campos del contacto (qué campos hay, cuáles sobran, cómo se agrupan) → es el
    próximo sprint, ya está decidido. EXCEPCIÓN aprobada en v4: la columna `responsable_user_id`
    (OLA 3 · F1) y las columnas de trazabilidad del archivado (OLA 0 · paso 2.1). Son columnas
    puntuales de infraestructura, no un rediseño del modelo.
  - Integración con N8N.
  - "Enviar mensaje de WhatsApp" y "Comenzar a marcar": existen en Bitrix24 pero se
    descartaron explícitamente en la reunión ("esto no iría todavía").
  - "Observadores": descartado ("no, porque es un contacto").
  - Módulo Drive, R2, migración de storage.
```

---

## LO QUE YA SÉ DEL DOMINIO (dáselo, le ahorra media Fase 0 y evita que invente)

```
TABLA DE CONTACTOS: `crm_tadi.contactos_cache`  (no es "contactos")

Columnas relevantes que YA existen (migración 0042 + 0045):
  archivado                 boolean default false
  archivado_motivo          text
  fusionado_en_contacto_id  uuid      → apunta al ganador de una fusión
  revision_dedup            boolean default false
  revision_dedup_grupo      text      → clave del grupo ("email:x@y.com" / "tel:3001234567")
  saneamiento_revision      → marca de nombre ilegible
  nombre_completo, email, telefono, whatsapp, a_number, fecha_nacimiento,
  pasaporte_*, direccion_*, estatus_*, *_tramites (ARRAY), created_at, updated_at
  IDs de origen: bitrix_contact_id, pipedrive_person_id, zoho_id (con ÍNDICE ÚNICO)
  Auto-referencia: referido_por_contacto_id

⚠️ FILTRO BASE DEL LISTADO: `where coalesce(archivado, false) = false`.
   Sin ese filtro se cuelan los contactos basura archivados y los perdedores de fusiones ya
   hechas. Es el mismo filtro que usa `scripts/dedup-contactos.mjs`.

BITÁCORAS QUE YA EXISTEN (no crees tablas nuevas para esto):
  crm_tadi.contactos_merge_log     → (corrida_id, accion, perdedor_id, ganador_id, tabla,
                                      registro_id, campo, valor_antes, valor_despues, created_at)
                                      acciones: reasignar_fk | enriquecer | archivar | marcar_revision
  crm_tadi.contactos_archivado_log → snapshot de archivados por basura
  crm_tadi.auditoria               → (user_id, accion, tabla_afectada, registro_id,
                                      datos_antes, datos_despues) — auditoría general del CRM

NOTIFICACIONES — YA EXISTEN, no montes nada nuevo:
  INSERT en crm_tadi.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
  prioridad ∈ baja | normal | alta | critica  (respeta el CHECK)
  Y SIEMPRE, además del insert: emitToUser(userId, "notificacion:nueva", { tipo })
  Sin ese emit la campanita (NotificationsPanel) solo se actualiza al refrescar. Es un error
  clásico en este repo. No lo repitas.

OPORTUNIDADES: `crm_tadi.oportunidades.contacto_id` → contactos_cache.id
```

---

# FASE 0 — Reconocimiento y PLAN-ACCIÓN (solo lectura)

```
No modifiques código en esta fase.

El contrato (docs/CONVENCIONES.md, "Flujo de trabajo por tareas") exige que toda tarea arranque
con un plan de acción en .md en la raíz ANTES de tocar código. Eso es lo que vas a producir:
`PLAN-ACCION-contactos-gestion-masiva.md`, con diagnóstico, causa raíz (archivo:línea), cambios
propuestos, criterios de aceptación y despliegue. Es documento de trabajo: NO se commitea.

Ya te di el mapa de la base de datos arriba, así que NO pierdas tiempo redescubriendo tablas.
Lo que necesito que averigües es el lado de la aplicación. Cita `ruta/archivo.ts:línea` en cada
respuesta. Si algo no existe, dilo: "no existe".

1. LISTADO DE CONTACTOS — backend
   - Endpoint que alimenta la pantalla de Contactos: ruta HTTP, archivo, función.
   - La query tal cual está hoy (pégala).
   - ¿Aplica el filtro `coalesce(archivado,false)=false`? Si NO lo aplica, es un bug aparte
     y quiero saberlo.
   - Dónde está el corte que hace que solo carguen 100 registros y no se pueda avanzar.
     Ese es el síntoma que reportó el usuario.
   - ¿La respuesta devuelve total? ¿Array pelado u objeto?

2. BÚSQUEDA
   - ¿Mismo endpoint u otro? ¿ILIKE, full-text, trigram?
   - ¿Hay índice que la soporte? (`\d+ crm_tadi.contactos_cache` o consulta a pg_indexes)
   - En la reunión se notó que buscar "Pedro" era desigual en velocidad. Quiero la causa.

3. PAGINACIÓN YA RESUELTA EN DRIVE ← esto es lo más importante de la Fase 0
   - El módulo Drive YA tiene paginación y por eso carga rápido. Encuéntrala (backend y
     frontend) y descríbeme el patrón exacto: forma del request, forma de la respuesta,
     componente de UI de paginación, y si hay algún helper reutilizable.
   - Quiero COPIAR ese patrón en contactos, no inventar uno nuevo.

4. FRONTEND — pantalla de contactos
   - Archivo del componente (bajo apps/frontend).
   - Cómo pide los datos (fetch, react-query, SWR, store).
   - ¿La tabla es propia o librería? Nombre y versión.
   - ¿Existe hoy checkbox o estado de selección? ¿Existe alguna vista mosaico/tarjetas?
   - Cómo está armado el layout (contenedor con scroll propio vs scroll del body, sidebar
     fijo). Lo necesito para anclar la barra al fondo sin romper nada.

5. ACCIONES EXISTENTES
   - Endpoints ya existentes de: editar contacto, archivar/eliminar contacto, crear tarea,
     cambiar responsable/asignado. Rutas y firmas.
   - ¿Existe exportación (CSV/Excel) en CUALQUIER módulo? Si existe, qué librería y cómo.

6. PERMISOS
   - Dónde está `isAdmin` en backend y cómo se usa hoy en las rutas de contactos.
   - Qué valores de `permiso` ya existen en `crm_tadi.user_permisos` (`SELECT DISTINCT permiso`).
     Lo necesito para nombrar los nuevos con la misma convención, no inventar un estilo.
   - ¿Existe ya algún flujo de solicitud/aprobación en el CRM? En la doc se menciona una vista
     `vi_solicitudes_oportunidades` y un ENUM `tipo_solicitud`. Averigua qué hay montado ahí:
     si ya existe un patrón de solicitudes, la Ola 3 lo reutiliza en vez de crear otro.

7. MOTOR DE FUSIÓN EXISTENTE
   - Lee `scripts/dedup-contactos.mjs` completo.
   - Dime qué partes son reutilizables tal cual como módulo de servidor: `descubrirFKs`,
     `columnasEnriquecibles`, `fusionarGrupo`, `log`, `runRevert`.
   - Corre esto y pégame la salida CRUDA (es el contrato de la fusión):
     ```sql
     select n.nspname as esquema, c.relname as tabla, a.attname as columna
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_class ref on ref.oid = con.confrelid
       join pg_namespace rn on rn.oid = ref.relnamespace
       cross join lateral unnest(con.conkey) as k(attnum)
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where con.contype='f' and rn.nspname='crm_tadi' and ref.relname='contactos_cache'
      order by 1,2,3;
     ```
   - Y estos conteos:
     `select count(*) from crm_tadi.contactos_cache where coalesce(archivado,false)=false;`
     `select count(*) from crm_tadi.contactos_cache where revision_dedup = true;`

8. Confirma el próximo número de migración leyendo CLAUDE.md (raíz).

Formato: markdown, un encabezado por punto, con `archivo:línea`. Sin proponer solución todavía.
DETENTE al terminar.
```

---

# OLA 0 — Archivado lógico y purga controlada

> Va **ANTES** de la Ola 1. Es pequeña, independiente, y quita un riesgo que está vivo en
> producción ahora mismo. Rama propia: `juan/contacts-soft-delete`, creada DESDE `dev`.

## Reglas duras de la Ola 0 (R1–R9)

**R1. Es FALSO que pasar el DELETE a archivado "no cambie la conducta visible".**
4 FKs están en `NO ACTION` (`oportunidades.contacto_id`, `oportunidades.referido_por_contacto_id`,
`tareas.contacto_id`, `drive_folders.contacto_id`). `NO ACTION` **BLOQUEA**: hoy un contacto con
una sola oportunidad, tarea o carpeta es IMPOSIBLE de borrar (`23503` → 500). Esa red de
seguridad involuntaria **desaparece** con el archivado. Se compensa con R2–R5.

**R2. Confirmación informada obligatoria antes de archivar** (individual o masivo): la UI dice
cuántas oportunidades, tareas, documentos, carpetas de Drive, notas y emails arrastra. Conteos
por consulta real, nunca estimados. Si no tiene nada, dilo también.

**R3. Registro obligatorio en `crm_tadi.auditoria`:** quién, cuándo, qué contacto y los conteos
del momento. Hoy el `DELETE` no escribe NADA (0 filas sobre contactos en 760 registros).

**R4. `deleteUploadsIfUnreferenced` sale del camino de archivado** (`contactos-routes.ts:318`).
Hoy es código muerto: `isUploadReferenced` (`lib/uploads-cleanup.ts:29`) siempre devuelve `true`
porque las notas sobreviven al DELETE. **Archivar NUNCA borra un archivo físico.** Si la función
tiene otros usos, se deja donde está y se quita solo la llamada desde aquí.

**R5. No se tocan las FKs CASCADE de `followup_coach_messages` / `followup_coach_state`.** Con
archivado lógico dejan de dispararse y las conversaciones sobreviven apuntando al contacto
archivado: es lo correcto.

**R6. Regla de reasignación en fusión** (SUSTITUYE a "las bitácoras no se reasignan"):
> ¿algún proceso **CONSULTA** esta tabla para decidir **dónde escribir en el futuro**?
> **Sí → SE REASIGNA** (mapeo vivo). **No, solo la lee un humano → SE CONGELA.**

- **Se reasignan** (ya tienen FK; se quedan como están, **NO se revierte nada histórico**):
  `pipedrive_import_log`, `zoho_import_log`, `emails`, `oportunidades` (×2), `tareas`,
  `drive_folders`, `contactos_cache.referido_por_contacto_id`,
  `oportunidad_descuento_solicitudes.referido_contacto_id`.
- **Se congelan** (sin FK + lista de exclusión explícita, cada una con comentario del porqué):
  `bitrix_import_log`, `deals_import_log`, `pipedrive_import_log_archive`,
  `contactos_saneamiento_log`, `contactos_rescate_log`, `contactos_archivado_log`,
  `rescate_telefonos_log`, `ghl_sync_log.entidad_crm_id`.
- **EXCLUSIÓN CRÍTICA** (comentario en MAYÚSCULAS en el código): `contactos_merge_log`
  (`ganador_id` / `perdedor_id`) es la bitácora que permite **DESHACER** fusiones. Si alguien le
  declara una FK, el descubrimiento dinámico reescribiría el propio registro de las fusiones y el
  revert quedaría **CORRUPTO SIN QUE SALTE NINGÚN ERROR**. Nunca se reasigna, nunca se le pone FK.
- **NO SE TOCA NUNCA:** `contactos_cache_bak_20260513_predupmerge` (respaldo pre-dedup, 24.237 filas).

**R7. `contactos_notas`: la FK queda PENDIENTE** hasta verificar **en producción** (a) que tiene
PK de una sola columna —si no, el motor la sigue omitiendo y declararla no sirve de nada— y (b)
que no hay huérfanas —si las hay, el `ALTER TABLE` falla al desplegar—. Cuando se declare será
`ON DELETE NO ACTION` **a propósito**, como segunda red de seguridad de la purga.

**R8. Índices sobre `contactos_cache`: NINGUNO, NUNCA, EN ESTE MÓDULO. CERRADO.** No es "pendiente
de datos": está decidido. Producción lo zanjó — con ~3.810 contactos activos el `ILIKE` cuesta
milisegundos y no hay nada que optimizar. No propongas, no crees y no "sugieras para más adelante"
ningún índice sobre esta tabla. (Contexto: el repo tampoco es fuente de verdad de los índices de
prod — hay índices vivos que no están en ninguna migración, `CONVENCIONES §1.5`; y la `0054` es de
Drive, no de contactos.)

**R9. Purga:** un contacto archivado queda **EXCLUIDO** si tiene oportunidad, tarea, carpeta de
Drive, nota, email, historial de coach, o si aparece como `ganador_id` en `contactos_merge_log`,
o como `perdedor_id` de una corrida que aún no cumple el plazo de `--dias`.

**R10. 🔴 `crm_tadi.auditoria` ES INMUTABLE. NUNCA se borra una fila.** Ni en producción, ni en
staging, ni en local, ni "para limpiar una prueba". Es la misma regla de preservación que rige
todo el proyecto (regla dura 12) y la bitácora de auditoría es justo lo último que puede
permitirse perder: si se puede podar, deja de ser prueba de nada. Si necesitas distinguir filas de
prueba, **márcalas en el propio registro** (por ejemplo, un `datos_antes.prueba = true` o el motivo
en la `accion`), nunca las elimines. Vale igual para `contactos_merge_log`,
`contactos_archivado_log` y cualquier otra bitácora. *(Regla nacida de un borrado real de 2 filas
de auditoría en staging durante la Ola 0; no se repite.)*

**R11. 🔴 NUNCA `SELECT *` SOBRE `contactos_cache` EN UNA RESPUESTA HTTP.** La tabla guarda el SSN
del cliente y las credenciales de su cuenta USCIS, y **pese al sufijo `_enc` NO están cifradas**:
`ssn_encrypted`, `clave_uscis_enc` y `clave_correo_uscis_enc` se escriben en claro desde el
formulario (el helper `lib/crypto.ts` existe pero nunca se llama en `contactos-routes.ts`).
Toda consulta que devuelva contactos usa **lista explícita de columnas**; los tres campos
secretos no salen de la API por ningún endpoint, y en su lugar viajan las banderas
`tiene_ssn` / `tiene_clave_uscis` / `tiene_clave_correo_uscis`. Al añadir una columna a la tabla,
decide **a propósito** si entra en la proyección: el default es que no se expone.

> **Pendiente de fondo, NO resuelto en la Ola 0:** los valores siguen en claro **en la base**.
> Cifrarlos de verdad (backfill + `encrypt()` al escribir + `decrypt()` bajo permiso explícito y
> auditado) es una tarea propia, con su migración, y hay que priorizarla.

**R12. RESURRECCIÓN — el desarchivado automático depende del MOTIVO.** El flujo Leads→Clientes
desarchiva solo cuando un contacto pasa a ser cliente (crear oportunidad, sync de GHL, webhook de
cliente ganado, importación desde GHL). Con el archivado lógico eso abría el agujero de que un
contacto **eliminado a mano** resucitara en silencio. Regla:

- `archivado_motivo` empieza por **`lead_sin_oportunidad`** o **`fusionado`** → archivado
  automático: **puede desarchivarse solo**, como hasta ahora.
- Cualquier otro motivo (incluido `eliminado por usuario`) o **motivo vacío** → lo archivó una
  persona: **NO se desarchiva solo**. El sync lo deja archivado y registra en `crm_tadi.auditoria`
  que se intentó revivirlo, con qué origen y qué usuario. Ante la duda se preserva la decisión
  humana.

Implementado en `lib/contactos-archivado.ts` (`esArchivadoAutomatico`, `desarchivarAutomatico`),
consumido por los 4 puntos de desarchivado automático. Ningún otro sitio debe hacer
`UPDATE ... SET archivado = false` a mano.

## Pasos de la Ola 0

```
--- PASO 1) INVESTIGACIÓN (hecho) ---

Reglas ON DELETE de las FKs hacia contactos_cache y rastro de borrados previos.
Resultado: 2 CASCADE (followup_coach_*), 4 NO ACTION (bloquean), 5 SET NULL.
Sin rastro alguno en auditoria (0 de 760 filas) ni en ninguna bitácora. De ahí salen R1–R9.

--- PASO 2) ARCHIVADO LÓGICO ---

0. `PLAN-ACCION-contacts-soft-delete.md` primero, antes de tocar código.
1. Verifica qué columnas de archivado existen hoy en crm_tadi.contactos_cache (0042 añadió
   archivado, archivado_motivo, fusionado_en_contacto_id). Si falta quién archivó y cuándo,
   propón la migración 0056 —NO la ejecutes— y actualiza docs/BASE-DE-DATOS.md explicando la
   FUNCIÓN de cada columna (CONVENCIONES §1.12).
2. Inventario COMPLETO de todo el código que lee contactos_cache: listados, búsqueda,
   autocompletados, desplegables de asignación, exportaciones, informes, jobs y scripts, en
   apps/api y apps/frontend. La lista va ANTES de modificar nada. Si se escapa una consulta, el
   contacto archivado va a seguir apareciendo en algún sitio.
3. Consulta de impacto: dado uno o varios ids, devuelve los conteos reales de R2 sin hacer una
   consulta por contacto.
4. DELETE /api/contactos/:id pasa a archivado lógico, idempotente, aplicando R3, R4 y R5.
5. Filtra archivados en TODAS las consultas del inventario. Por defecto no se ven; si algún
   listado necesita verlos, que sea con parámetro explícito opt-in.
6. Camino de desarchivado, también auditado. El archivado es reversible de verdad, no de palabra.

FUERA DE ALCANCE del paso 2: script de purga, índices, la FK de notas, el motor de fusión,
paginación, barra flotante y todo lo de las Olas 1-3.

--- PASO 3) LA PURGA (herramienta separada, NO un endpoint del CRM) ---

Crea `scripts/purgar-contactos-archivados.mjs`, siguiendo el MISMO patrón que
`scripts/dedup-contactos.mjs` (léelo antes): --dry-run por defecto, --apply explícito,
bitácora, resumen al final.

  · Candidatos: contactos con archivado = true y archivado desde hace más de N días
    (parámetro --dias=, sin valor por defecto: si no se lo pasan, aborta).
  · SALVAGUARDAS: las de R9. El script debe imprimir por qué excluyó cada uno.
  · --dry-run imprime la lista completa de lo que borraría y de lo que excluyó. Ese listado
    es el que un humano revisa ANTES de aprobar. Sin revisión no se corre --apply.
  · Antes de borrar, guarda un snapshot de la fila completa (todas las columnas) en una
    bitácora nueva `crm_tadi.contactos_purga_log`. Es lo último que queda si alguien se
    equivocó: no permite deshacer, pero permite saber qué había.
  · Migración con el número que corresponda (verifícalo contra schema_migrations) + su entrada
    en docs/BASE-DE-DATOS.md explicando la FUNCIÓN de la tabla. NO ejecutes la migración.
  · El script NO se expone por API ni por UI. Se corre a mano y solo super_admin.

--- CRITERIOS DE ACEPTACIÓN OLA 0 ---
[x] Reglas ON DELETE de las FKs pegadas antes de tocar nada (paso 1).
[ ] DELETE /api/contactos/:id ya no ejecuta ningún DELETE. Grep del diff: cero "delete from"
    sobre contactos_cache en el código de la API.
[ ] El contacto eliminado desaparece de la lista igual que antes (conducta idéntica para el
    usuario) pero sigue en la base con archivado = true. Pégame el SELECT.
[ ] Lista de TODOS los endpoints/vistas que devuelven contactos, marcando cuáles ya filtraban
    archivados y cuáles hubo que arreglar.
[ ] `node scripts/purgar-contactos-archivados.mjs --dias=90` en dry-run imprime candidatos y
    exclusiones, y NO escribe nada. (paso 3)
[ ] El script sin --dias aborta. (paso 3)
[ ] Un contacto archivado que tiene una oportunidad NUNCA aparece como candidato a purga.
    Demostrado con un caso real de la base. (paso 3)
[ ] typecheck y lint limpios.

Commit local + `git --no-pager diff --stat`. NO hagas push.
```

---

## Paso 4 — LA PAPELERA (D8, D9, D10) · añadido el 2026-08-10

> **Cómo salió esto.** No estaba en el enunciado original. Apareció el 2026-08-10, cuando Juan hizo
> la primera fusión real en staging y preguntó lo más natural: *"¿dónde puedo ver los contactos
> archivados?"*. La respuesta era: **en ningún sitio.** Tirando de ese hilo salieron tres defectos
> encadenados. Se incorpora aquí, a la Ola 0, porque es su deuda: la ola construyó el archivado
> reversible y se dejó la pantalla.

**El principio que lo justifica:** un archivado que solo se puede consultar con `curl` **no es
reversible en la práctica**. Existe en la API, pero no para la persona que se equivoca — que es
exactamente para quien se diseñó la reversibilidad. Sin pantalla, R1–R5 son una promesa a medias.

### D8 · La papelera de contactos

Botón **"Contactos archivados"** en el listado, **solo admin**, que abre un **modal** con el patrón
de la papelera del Drive (`DriveBrowser.tsx:1187+`): cabecera con contador, barra de filtros,
paginación y acciones gateadas por `isAdmin`. No se crea ruta de API nueva: se amplía el listado con
el opt-in `?archivados=1` que ya existía.

- **Orden**: `archivado_at DESC NULLS LAST, created_at DESC, id ASC`. Lo último archivado, arriba.
  El desempate por `id` no es opcional: sin él las filas bailan al paginar (lección de C6).
- **Filtros**: por motivo (coincidencia parcial, porque los motivos de corrida llevan sufijo), por
  **autor** y por **rango de fechas** con calendario (`components/ui/DateRangePopover`,
  `PAST_PRESETS`). Las opciones de autor salen de **los datos**, no de la tabla `users`, y llevan una
  entrada propia para *"sin usuario registrado"* (`archivado_por IS NULL`): las corridas masivas no
  las hizo una persona.
- 🔴 **Proyección explícita** (R11). La papelera tiene su propio contrato de columnas, corto a
  propósito: identificar a la persona y explicar el archivado, nada más.
- 🔴 **Un perdedor de fusión NO se desarchiva desde aquí.** Sus datos ya se reasignaron al maestro y
  reaparecería visible pero vacío. La pantalla **explica** que hay que revertir la fusión por su
  `corrida_id`; **no ofrece un botón que devuelve error**. Un botón que promete lo que el sistema no
  puede cumplir es peor que no tener papelera.

### D9 · El motivo dice de dónde vino

Una fusión hecha desde la interfaz y una corrida masiva del CLI dejaban **el mismo**
`archivado_motivo`. Existe un guard entero (el revert rechaza corridas masivas) dedicado a que nadie
las confunda, y en la ficha del contacto se confundían. La ruta pasa ahora un motivo propio.

⚠️ **El prefijo `fusionado` es funcional, no cosmético:** `esArchivadoAutomatico()` clasifica por
prefijo y de ello depende **R12**. Un motivo que empezara distinto convertiría al perdedor de una
fusión en un archivado *manual*, y el sync dejaría de poder tocarlo **en silencio**.

### D10 · La fusión archiva sin dejar cuándo ni quién

El motor de fusión escribía `archivado`, `archivado_motivo` y `fusionado_en_contacto_id` pero **no**
`archivado_at` ni `archivado_por`, que sí pone la ruta normal. Corregido, con la misma comprobación
defensiva de que las columnas de la `0056` existan.

**Y los campos nuevos se LOGUEAN, no solo se escriben:** `revertir()` reproduce `valor_antes` por par
(fila, campo). Escribirlos sin bitácora dejaría un contacto revertido **activo pero con la marca de
archivado puesta** — visible y mintiendo.

### 🔴 Lo que NO se hace: rellenar el pasado

Hay ~27.800 contactos archivados sin `archivado_at`, casi todos de corridas masivas anteriores a la
`0056`. La tentación es un `UPDATE` que les ponga fecha para que la papelera ordene bien.

**No se hace, y esta regla es permanente.** Sería **inventar historia**: escribir un dato que nunca
se registró y que nadie podría distinguir de uno real. Es el mismo defecto que se cazó en la
migración `0060`. Se arregla **hacia delante**; lo histórico se ordena `NULLS LAST` y la pantalla
dice *"sin fecha registrada"*. **Se enseña el hueco, no se rellena.**

Lo mismo con el filtro de fechas: un rango deja fuera a todos los que no tienen fecha, y la pantalla
avisa de cuántos son. No se cuelan en el resultado para que "no falten".

### Nota de rendimiento — el `COALESCE` que inutilizaba un índice

`idx_contactos_archivado_at` (mig. `0056`) es parcial sobre `WHERE archivado = true AND archivado_at
IS NOT NULL`. El filtro usaba `COALESCE(archivado, false) = true`, y Postgres **no puede deducir**
`archivado = true` a través de un `COALESCE`: el índice no era elegible y llevaba desde su creación
sin usarse. Corregido **solo en esa rama**.

🔴 **La rama contraria NO se toca.** `COALESCE(archivado, false) = false` **no** equivale a
`archivado = false`: la columna es `boolean DEFAULT false` **sin `NOT NULL`** (mig. `0042`), y para
una fila con `archivado IS NULL` la primera la incluye y la segunda la excluye. Quitarlo haría
desaparecer esos contactos del listado principal **sin ningún error**. Hay un test que lo vigila
importando las constantes reales.

---

# OLA 1 — Paginación, selección y barra anclada

> Es la base. Sin paginación no hay selección masiva; sin selección no hay fusionar ni exportar.
> Juan David lo dijo en la reunión: *"es requerido, porque si no, cómo haces con el tema de la
> selección"*.

## 🔴 C0. DEUDA DE LA OLA 0 — primera tarea de esta ola, antes que la paginación

**La ventana de confirmación informada (R2) NO está hecha.** En la Ola 0 se construyó el cálculo
(`GET /api/contactos/impacto`, conteos reales en una sola consulta) pero **no la interfaz**. Hoy el
botón de eliminar **archiva sin avisar de lo que arrastra**, y eso es un estado temporal, no el
diseño final. Con las 4 FKs `NO ACTION` fuera de juego (**R1**), esta ventana es la única barrera
que queda antes de archivar un contacto con 12 oportunidades.

Qué hay que construir, individual y masivo:
- Diálogo previo que consuma `/api/contactos/impacto` y muestre los conteos **reales** de
  oportunidades, tareas, documentos, carpetas de Drive, notas y emails. Si no arrastra nada,
  decirlo también ("este contacto no tiene nada asociado").
- Nada de estimaciones ni de "puede que tenga datos asociados".
- La confirmación repite la cantidad de contactos afectados, como en el resto del CRM.

**Correcciones v4 sobre esta ola — mandan sobre el texto de abajo:**

- **C1. La tabla hay que construirla; el mosaico ya existe.** La Fase 0 confirmó que la vista
  actual de contactos ES el mosaico. El toggle no convierte una tabla en mosaico: **añade la
  vista de tabla que hoy no existe**. La selección con checkbox vive en la vista de tabla. El
  mosaico se queda como está. Persiste la preferencia del usuario; **por defecto, mosaico** (no
  cambies lo que la gente ya ve).
  🔴 **C1 SUSTITUYE al punto 5 del texto de abajo** en lo relativo a la selección: donde §5 dice
  *"la selección funciona en AMBAS vistas"*, manda C1 — **las casillas existen SOLO en la tabla**.
  Lo que sí es cierto de §5 y se cumple: **el estado de selección es único y compartido**, así que
  al pasar a mosaico la selección se conserva y la barra sigue abajo con su contador; lo único que
  no se puede hacer desde el mosaico es cambiarla, y la barra lo dice.
- **C2. Antes de optimizar la búsqueda, verifica contra PRODUCCIÓN.** Ver **R8**: índices
  congelados. La 0054 es de Drive; no cubre `contactos_cache`. Sin la salida de `pg_indexes` y
  del `EXPLAIN` de prod, no se propone ni se crea ningún índice.
- **C3. La barra anclada NO calcula el ancho del sidebar: se alinea por maquetación.**
  La barra se monta **dentro de la columna de contenido**, como último hijo, con
  `position: sticky; bottom: 0`. Al ser hija de esa columna queda alineada con ella **por layout**,
  no por cálculo, y `sticky bottom-0` la mantiene pegada al borde inferior del viewport mientras
  se scrollea — que es el requisito real (*"fija al fondo del área visible, NO al final del
  documento"*). El contenedor de la página lleva `min-h-screen` para que también quede pegada
  abajo cuando hay pocas filas, y `padding-bottom` del alto de la barra para no tapar la última.

  **Por qué NO se ata al ancho del sidebar, que era el enfoque anterior:** (a) esa "fuente de
  verdad" **no existe** — `collapsed` es un `useState` LOCAL dentro de `Sidebar.tsx`, sin contexto,
  sin variable CSS y sin `localStorage`, y ningún otro componente lo lee; exponerlo obligaría a
  tocar un componente que usan todas las pantallas. (b) Aunque se expusiera, el ancho lo anima
  `framer-motion` con un *spring*: ninguna transición CSS escrita a mano coincide con esa curva, así
  que habría un instante de desalineación en cada plegado — justo lo que la regla quería evitar.
  Sin acoplamiento no hay nada que sincronizar.

  **Verificado** (Edge headless por CDP, 1440×900): al plegar el menú el sidebar pasa de 264 px a
  76 px y el borde izquierdo de la barra lo sigue exacto (264 → 76), con desfase **0 px** en ambos
  estados; `position: sticky` y `bottom − innerHeight = 0` tanto arriba como tras scrollear 4.501 px.
- **C4. Extiende el componente de paginación de Drive, no lo dupliques.**
  `components/ui/Pagination.tsx` existe y se reutiliza en 5 sitios. Le faltan tres cosas:
  selector de tamaño de página, botones primera/última, y scroll-to-top al cambiar de página.
  Añádeselas de forma **retrocompatible** — Drive lo sigue usando y NO puede cambiar de conducta.
  Su clamp es `[1, 200]`; para contactos el tamaño de página es **lista blanca estricta {50, 100}**,
  validada EN EL SERVIDOR.
- **C5. Búsqueda: debounce y guard anti-carreras.** Hoy dispara una consulta por tecla y no se
  protege de respuestas fuera de orden. Debounce de ~300 ms y descarta las respuestas de
  peticiones que ya no son la vigente (AbortController o token de secuencia).
- **C6. El corte de 100, confirmado por producción.** `pg_stat_statements` muestra la consulta del
  listado con `LIMIT` y **sin `OFFSET`**. No es un fallo ni una regresión: **la paginación nunca se
  programó**. Y el `ORDER BY created_at DESC` **no lleva desempate por `id`**, así que en cuanto se
  añada `OFFSET` habrá filas repetidas y omitidas entre páginas. Las dos cosas se arreglan aquí.
- **C7. La búsqueda solo cubre `nombre_completo`, `email` y `telefono`.** NO cubre `whatsapp` ni
  `a_number`, y son dos de los datos por los que más se busca a una persona. Se amplían en esta
  ola. Sobre índices: **no hacen falta** — con ~3.810 contactos activos el coste es de
  milisegundos, medido en producción. Ver **R8**.

```
Rama: `juan/contacts-pagination-selection`, creada DESDE `dev`.

--- 1) PAGINACIÓN EN SERVIDOR ---

Síntoma actual: cargan los primeros 100 contactos y no hay forma de avanzar.

- El endpoint acepta `page` (1-indexado) y `pageSize`.
- `pageSize` permitido SOLO 50 y 100. Default 100. Rechaza cualquier otro valor con 400.
  No lo dejes libre: un `pageSize=100000` tumba la API.
- Respuesta: `{ items, total, page, pageSize, totalPages }`.
- `total` sale de un COUNT(*) con EXACTAMENTE el mismo WHERE que la query de items
  (incluido `coalesce(archivado,false)=false` y los filtros/búsqueda activos).
  Si el total y los items no comparten WHERE, el contador miente y "seleccionar el total" rompe.
- ORDEN: `ORDER BY created_at DESC, id ASC`. Las dos partes son obligatorias.
  · El desempate por `id` NO es opcional: sin él la paginación repite filas en una página y omite
    otras, porque `OFFSET` sobre un orden ambiguo no garantiza nada.
  · El criterio es `created_at` y NO `updated_at`, aunque "lo último tocado" suene más útil:
    `contactos_cache` tiene un trigger `trg_updated_at` que lo actualiza en CADA `UPDATE` (sync de
    GHL, saneamiento, archivado, push a GHL…). Ordenar por él haría que las filas se reordenasen
    MIENTRAS el usuario pagina —volviendo justo al problema que la paginación viene a resolver— y
    además "arriba" pasaría a significar "lo que tocó el sistema", no "lo que registraste".
    `created_at` es inmutable. Decisión tomada el 2026-08-06 con los datos de staging delante
    (3.807 de 3.808 activos tienen `updated_at <> created_at`).
- La BÚSQUEDA pasa por el MISMO pipeline paginado. Filtro y paginación viajan en la misma query.
- Todo el filtrado y el ordenamiento en SQL. Cero paginación en memoria. Cero O(n²) en JS (§3.6).
- Si la query paginada+ordenada+filtrada no está soportada por un índice, escribe la migración
  del índice (número siguiente según CLAUDE.md) + su entrada en docs/BASE-DE-DATOS.md.
  NO la ejecutes; avísame.

--- 2) UI DE PAGINACIÓN ---

- COPIA el patrón de Drive que identificaste en Fase 0. Si hay componente reutilizable, reúsalo.
- Controles: primera / anterior / siguiente / última + "Página X de Y".
- Selector de tamaño: 50 / 100.
- El TOTAL de contactos siempre visible, aunque no haya nada seleccionado. Requisito explícito:
  *"que te muestre la cantidad, el total de los contactos"*.
- Al cambiar de página, scroll arriba.

--- 3) SELECCIÓN ---

- Checkbox por fila.
- Checkbox en el encabezado = seleccionar todos de LA PÁGINA ACTUAL, con estado indeterminado
  cuando la selección es parcial.
- Cuando el usuario marca toda la página y hay más páginas, aparece en la barra la opción
  "Seleccionar el total (N)" → selecciona todos los que cumplen el filtro actual.

  CÓMO SE REPRESENTA ESA SELECCIÓN — esto define la API de todas las olas siguientes,
  hazlo bien ahora o la Ola 3 hay que rehacerla:
    a) `{ modo: 'ids', ids: [...] }`
    b) `{ modo: 'filtro', filtros: {...}, excluidos: [...] }`
  Los endpoints de acción masiva aceptan LAS DOS formas desde ya. En modo 'filtro' el backend
  resuelve el conjunto con la misma query del listado. NUNCA mandes decenas de miles de ids en
  un body JSON.
- La selección sobrevive el cambio de página (Set de ids en memoria).
- Botón "Limpiar selección".

--- 4) BARRA DE ACCIONES ANCLADA ---

Requisito textual: *"quiero que quede ancladita fija aquí abajo, pequeñita, para que a medida
que tú vas cliqueando algo, tú no tengas que cliquear y darle hasta abajo. Me parece absurdo."*
Y: *"cuando usted lo selecciona es que aparece"*.

- Aparece SOLO con ≥1 seleccionado. Con 0, no se muestra.
- Fija al fondo del área visible (viewport), NO al final del documento. Si scrolleas con la
  rueda, la tabla se mueve y la barra no. z-index por encima de la tabla.
- Padding-bottom en el contenedor de la tabla = alto de la barra, para que no tape la última fila.
- Estilo con los tokens de marca existentes, no colores sueltos.
- Contenido, de izquierda a derecha:
    [ELIMINAR]  [EDITAR]  [ Seleccione la acción ▾ ]        SELECCIONADOS: n
  El select se llama literalmente **"Seleccione la acción"**.
- Opciones del select (en esta ola las 4 van DESHABILITADAS con tooltip "Próximamente";
  quiero el contenedor correcto desde ahora):
    · Agregar tarea
    · Cambiar responsable
    · Fusionar
    · Incluir en la exportación
- Habilitación:
    EDITAR   → solo con exactamente 1 seleccionado.
    ELIMINAR → con ≥1.
- ELIMINAR pide confirmación mostrando la cantidad ("¿Archivar 27 contactos?") y ejecuta
  ARCHIVADO LÓGICO: `archivado = true`, `archivado_motivo` describiendo quién y por qué.
  PROHIBIDO cualquier DELETE. Las columnas ya existen (migración 0042), no crees nada.
  Registra en `crm_tadi.auditoria`.
- En esta ola, ELIMINAR queda restringido a admin en el backend. El no-admin ve el botón
  (así lo pidieron: *"igual se lo dejan para que todos tengan la opción"*) y recibe un aviso
  de "requiere aprobación del administrador (próximamente)". El flujo real llega en la Ola 3.

--- 5) TOGGLE LISTA / MOSAICO ---

Requisito: *"ese botón cambia de mosaico a vista"*.
- Botón que alterna LISTA (tabla) ↔ MOSAICO (tarjetas).
- La selección funciona en AMBAS vistas y comparte el mismo estado.
- La preferencia se recuerda entre recargas.

--- CRITERIOS DE ACEPTACIÓN (verifícalos uno por uno antes de reportar) ---
[ ] Con >100 contactos puedo avanzar de página y ver registros distintos.
[ ] Ninguna fila aparece en dos páginas ni desaparece al paginar (pruébalo yendo 1→2→3→2→1).
[ ] El total mostrado == COUNT(*) con los mismos filtros. Verifícalo con psql y pégame ambos.
[ ] El listado NO muestra contactos con archivado=true.
[ ] Buscar un nombre devuelve resultados paginados y el total del filtro (no el total global).
[ ] Selecciono en página 1, voy a página 2, vuelvo: la selección sigue.
[ ] Con 0 seleccionados no hay barra; con 1 aparece.
[ ] Scrolleo con la rueda y la barra no se mueve.
[ ] La barra no tapa la última fila.
[ ] El select se llama exactamente "Seleccione la acción".
[ ] No hay opción de WhatsApp ni de "Comenzar a marcar".
[ ] Grep del diff: cero `DELETE FROM` sobre contactos_cache.
[ ] typecheck y lint limpios (pégame la salida; el build no los valida).

Commit local. Reporte con `git --no-pager diff --stat` y `git --no-pager log --oneline dev..HEAD`.
NO hagas push.
```

---

# OLA 2 — Fusionar duplicados (exponer el motor que YA existe)

> Prioridad máxima del cliente. Y el trabajo pesado ya está hecho: `scripts/dedup-contactos.mjs`
> resuelve la fusión reversible con descubrimiento dinámico de FKs, enriquecimiento sin pisar,
> archivado del perdedor y revert completo por `corrida_id`. **No lo reescribas: extráelo.**

**Correcciones v4 sobre esta ola — mandan sobre el texto de abajo:**

- **D1. EXACTAMENTE 2 contactos** (ver A3). Sustituye toda mención a "2..10" o "entre 2 y 10".
  El endpoint recibe `{ maestroId, perdedorId, valoresElegidos }` — **un solo perdedor, en
  singular**. Con cualquier otra cardinalidad, **400**. El modal es de dos columnas fijas.
- **D2. 🔴 ARREGLAR LAS RELACIONES NO DECLARADAS — no es opcional.** El motor descubre las
  relaciones vía `pg_constraint`, así que una tabla sin FK le es INVISIBLE. El barrido ya está
  hecho (Ola 0 · paso 1) y el criterio de qué se reasigna y qué se congela es **R6**. Pendiente:
  la FK de `contactos_notas`, bloqueada por **R7** hasta verificar producción. Las bitácoras
  congeladas van a una **lista de exclusión explícita** en el módulo de fusión, cada una con su
  comentario del porqué — igual que la exclusión ya existente de `followup_coach_*`.
  Migración con su entrada en `docs/BASE-DE-DATOS.md`. NO la ejecutes.
- **D3. Criterio de aceptación nuevo y obligatorio:** fusionar dos contactos que AMBOS tienen
  notas deja TODAS las notas colgando del maestro. Conteo antes = conteo después. Pega el SQL.

**GHL — la fusión tiene que propagarse (A5).** Si se fusiona aquí y en GHL siguen los dos
contactos, el próximo sync devuelve el duplicado y el trabajo no sirvió de nada.

```
--- E1) PRIMERO AVERIGUA, NO CONSTRUYAS ---

Antes de escribir una línea, responde con evidencia del código:
  · ¿Existe hoy un cliente saliente hacia GHL en el proyecto (escribe hacia GHL), o la
    integración es solo de lectura / solo entrante (webhooks)?
  · ¿Qué columna guarda el id de GHL en contactos_cache? ¿Tiene índice único?
  · ¿Dónde viven las credenciales de GHL y están presentes en el entorno?
  · ¿Hay algún patrón de cola / reintentos para llamadas salientes a terceros, o las
    integraciones existentes llaman en línea dentro del request?
Detente ahí. NO implementes nada de GHL hasta confirmación explícita.

--- E1-bis) RESPUESTAS (2026-08-07) — investigación cerrada ---

· Cliente saliente: SÍ, maduro. `ghlFetch()` con Bearer, y escrituras reales de contactos
  (PUT/POST /contacts), oportunidades y notas. NO es solo lectura.
  PERO: antes de esta ola NO existía ni un solo `method: "DELETE"` en todo apps/api/src. El CRM
  nunca había borrado nada en GHL; `eliminarContactoEnGhl()` es la primera operación destructiva
  del proyecto contra un tercero.
· Columna del id: `contactos_cache.ghl_contact_id`, con UNIQUE **no parcial**
  (`contactos_cache_ghl_contact_id_key`). Por eso NO es una columna elegible en la fusión.
  3.796 de 3.808 contactos activos tienen id de GHL: casi toda fusión tendrá dos.
· Credenciales: `GHL_API_KEY` / `GHL_LOCATION_ID` por `process.env`, desde `apps/api/.env`.
  En local están VACÍAS → `configured()` es falso y la integración queda inerte. Solo se puede
  probar de verdad en staging del VPS.
· Cola/reintentos: YA existía el patrón (`ghl_push_pending` + `startGhlPendingContactsLoop` cada
  120 s + detección de rate-limit + bitácora en `ghl_sync_log`). La fusión NO inventa
  infraestructura: replica ese patrón con su propia cola (`ghl_merge_cola`, mig. 0059).
· ⚠️ Existe un `ghl-gateway` en PM2 (2 instancias en cluster) que llena `ghl_request_log` con
  `consumer_id` y `bucket_remaining`. El CRM **NO pasa por él**: `GHL_BASE` está fijo a
  services.leadconnectorhq.com. O sea, el CRM consume cuota de GHL fuera de la contabilidad del
  gateway. No se cambió nada de esto en esta ola, pero conviene decidirlo aparte.

--- E2) CUANDO SE CONFIRME, EL COMPORTAMIENTO ES ---

Al confirmarse una fusión:
  1. Actualizar en GHL el contacto MAESTRO con los valores finales elegidos.
  2. Eliminar (o marcar, según lo que permita la API) el contacto PERDEDOR en GHL.

Reglas duras:
  · La llamada a GHL va FUERA de la transacción de base de datos. Si GHL falla, la fusión en
    el CRM NO se revierte y NO se queda a medias: se marca como pendiente de sincronizar y se
    reintenta. Nunca dejes una transacción abierta esperando a un tercero.
  · Cada intento y su resultado quedan registrados (qué se mandó, qué respondió, cuándo).
  · Si la fusión se REVIERTE en el CRM, hay que decidir qué pasa en GHL. No lo resuelvas por
    tu cuenta: identifica el problema, descríbelo, y pregunta.
  · Si el perdedor no tiene id de GHL, no hay nada que hacer allá: sáltalo sin error.
```

**E3) CÓMO QUEDÓ IMPLEMENTADO (2026-08-07)** — autorizado por Juan: *"hay que poder eliminar el
contacto en GHL… GHL es un espejo de nuestra db"*.

- Al confirmarse una fusión se **encolan dos operaciones** en `crm_tadi.ghl_merge_cola` (mig. `0059`)
  y se intentan de inmediato, **siempre después del COMMIT** y fuera de la transacción:
  `actualizar_maestro` (reutiliza `pushContactoToGhl`) y `eliminar_perdedor`
  (`eliminarContactoEnGhl`, `DELETE /contacts/{id}`).
- Si GHL falla, **la fusión del CRM no se toca**: la fila queda `pendiente` y la reintenta
  `startGhlMergeQueueLoop()` cada 180 s, con tope de 10 intentos para no quemar cuota escondiendo
  un error permanente. Cada intento se registra en `ghl_sync_log`.
- Sin `ghl_contact_id` → estado `omitido`. Un **404 de GHL cuenta como éxito**: el objetivo es que
  allá no exista.

🔴 **EL CASO DEL REVERT — decidido así porque la respuesta de Juan no lo cubría.** Borrar en GHL es
irreversible desde el CRM. Por eso:

- `revertir()` **cancela primero** las operaciones que sigan `pendiente`: si el borrado aún no salió,
  no llega a ocurrir. Éste es el caso común y queda resuelto solo, sin intervención.
- Si el borrado **ya se ejecutó**, NO se recrea el contacto por nuestra cuenta: recrearlo daría un
  `ghl_contact_id` NUEVO y el perdedor perdería en GHL sus conversaciones, tags e historial — justo
  lo que el revert pretendía salvar. El endpoint devuelve un aviso explícito y **lo decide una
  persona**: recrear (aceptando id nuevo e historial perdido) o dejarlo sin espejo.
- **Pregunta abierta para Juan:** ¿quieres además un *plazo de gracia* (que el borrado en GHL no
  salga hasta N horas después de la fusión, para que un revert temprano nunca llegue a tocarlo)?
  Hoy sale de inmediato y la ventana de cancelación es solo la que dure el fallo de GHL.

```
Rama: `juan/contacts-merge-ui`, creada DESDE `dev` (con la Ola 1 ya mergeada). Verifícalo.

--- 0) ANTES DE ESCRIBIR CÓDIGO ---
Lee `scripts/dedup-contactos.mjs` completo y `packages/db/migrations/0042_dedup.sql`.
Pégame de nuevo la salida de la introspección de FKs de la Fase 0 punto 7 y espera mi visto
bueno. Esa lista es el contrato de la fusión: si te falta una tabla, quedan datos huérfanos
sin ningún error visible.

--- 1) EXTRAER EL MOTOR ---

Crea `apps/api/src/lib/contactos-merge.ts` portando desde el script, SIN cambiar la semántica:
  · `descubrirFKs()` — descubrimiento dinámico vía pg_constraint.
     CONSERVA las dos exclusiones que ya trae y que son deliberadas:
       - `EXCLUIR_REASIGNACION = { followup_coach_messages, followup_coach_state }`
         (su columna referenciante es parte de su propia PK; reasignar chocaría. El FK es
         CASCADE, se quedan apuntando al perdedor archivado y no rompe nada.)
       - tablas sin PK de una sola columna: se omiten (no se pueden loguear con precisión,
         y sin log preciso no hay revert).
  · `columnasEnriquecibles()` — CONSERVA las exclusiones: columnas ARRAY (los `*_tramites`
     fallan con "malformed array literal") y columnas con índice ÚNICO (`bitrix_contact_id`,
     `pipedrive_person_id`, `zoho_id`: copiarlas al ganador mientras el perdedor archivado
     conserva las suyas viola el índice único).
  · `fusionar()` — transacción por grupo; rollback del grupo si falla, sin tumbar el resto.
  · `revertir(corridaId)` — el revert genérico desde `contactos_merge_log`.
  · El log en `contactos_merge_log` con `corrida_id`.
Usa el helper `query`/pool del proyecto, no un `pg.Client` nuevo.
El script CLI debe seguir funcionando: hazlo consumir el módulo o déjalo intacto, pero no
lo rompas — es la herramienta de saneamiento masivo y se sigue usando.

DIFERENCIA CLAVE con el script — LÉELA DOS VECES, es el corazón de esta ola:

En el script, el GANADOR se elige por heurística y el enriquecimiento SOLO rellena campos
vacíos (`if (!vacio(g[col]) || vacio(p[col])) continue;` — nunca pisa). Eso está bien para una
corrida masiva desatendida, pero NO es lo que se necesita aquí.

La UI es una HERRAMIENTA DE AUDITORÍA MANUAL: el humano arma el "contacto ideal" tomando
campo por campo de cualquiera de los contactos fusionados. Puede quedarse con el teléfono de
José Díaz 1 y el email de José Díaz 2 aunque AMBOS tengan los dos campos llenos. O sea:
**sí puede pisar un valor lleno del maestro con el del perdedor.** El script no puede hacer
eso; el motor extraído tiene que poder.

Cómo se implementa sin romper nada:
  · `fusionar()` recibe un parámetro nuevo y OPCIONAL, `valoresElegidos`. Si no se pasa, se
    comporta EXACTAMENTE como hoy (rellenar solo vacíos) — así el CLI masivo no cambia de
    conducta. Si se pasa, para esos campos manda la elección del humano.
  · cada escritura —también las que pisan— se loguea igual en contactos_merge_log con
    `accion='enriquecer'`, `valor_antes` y `valor_despues`, para que `revertir()` siga
    funcionando SIN TOCARLO. Ese es el precio de admitir el pisado: si no queda logueado,
    el revert deja el contacto corrupto y nadie se entera.
  · las columnas con índice único y las ARRAY siguen SIN ser elegibles. Mismas exclusiones.

⚠️ SEPARA MENTALMENTE LOS DOS PLANOS DE UNA FUSIÓN. No son lo mismo y solo uno se elige:

  PLANO RELACIONAL — documentos, oportunidades, tareas, notas, carpetas de Drive, y todo lo
  que cuelgue por FK. **NO se elige nada. TODO se reasigna al maestro, de todos los contactos
  fusionados.** Los archivos de José Díaz 1 y los de José Díaz 2 terminan LOS DOS colgando del
  contacto resultante. No hay descarte, no hay pregunta al usuario, no hay forma de perder un
  expediente por hacer clic mal. Esto es deliberado y NO lo hagas configurable: es la parte
  delicada, y la regla del proyecto es que nada se pierde jamás.

  PLANO ESCALAR — nombre_completo, telefono, whatsapp, email, a_number, fecha_nacimiento,
  pasaporte_*, direccion_*, estatus_*, campos uscis*. **Aquí y SOLO aquí elige el humano.**
  Un campo escalar tiene un único valor, así que hay que decidir cuál sobrevive.

  Si en la UI le das al usuario la sensación de que puede "descartar los archivos de uno de
  los dos", lo implementaste mal.

--- 2) ENDPOINT ---

POST de fusión manual: recibe `{ ganadorId, perdedorIds[], valoresElegidos{} }`.
  - `valoresElegidos` es `{ [nombreDeCampo]: contactoIdDeOrigen }` — el id del contacto del que
    se toma ese campo. NO mandes valores crudos desde el cliente: el servidor lee el valor de
    la fila de origen. Si el front pudiera mandar el texto directamente, la "fusión" se
    convertiría en un endpoint de edición arbitraria sin las validaciones del formulario de
    contacto, y además el `valor_despues` del log dejaría de ser confiable.
  - Valida en el servidor: cada campo de `valoresElegidos` está en la lista de columnas
    enriquecibles (nada de columnas únicas, ARRAY, `id`, `created_at`); cada `contactoIdDeOrigen`
    es uno de los contactos de ESTA fusión. Cualquier otra cosa → 400.
  - Si el usuario quiere un valor que no está en ninguno de los dos contactos, eso NO es una
    fusión: que fusione y luego edite el contacto por el formulario normal. Dilo así en la UI.
  - Valida: **EXACTAMENTE 2 contactos** (un maestro y un perdedor, en singular); ninguno archivado;
    el maestro no es el perdedor; los dos existen. Cualquier otra cardinalidad → **400**, incluido
    que llegue un `perdedorIds` en plural.
  - Modo 'filtro' ("seleccionar el total") → 400. Fusionar a ciegas sobre 30.000 contactos no
    tiene sentido y es irreversible en la práctica.
  - Bloquea las filas (`SELECT ... FOR UPDATE`) para evitar carreras.
  - Devuelve el `corrida_id` de la fusión.
  - Registra también en `crm_tadi.auditoria` (quién fusionó qué).
Endpoint de revert por `corrida_id`, restringido a admin. El motor ya lo resuelve.

--- 3) UI ---

- La opción "Fusionar" del select se habilita **solo con EXACTAMENTE 2 seleccionados**. Con 1 o con
  3+, deshabilitada y con el motivo visible ("Selecciona exactamente 2 contactos para fusionar").

- MODAL COMPARATIVO — es la pieza central de la ola, no la despaches con una tabla simple.
  Estructura: una COLUMNA por contacto seleccionado, una FILA por campo, más una columna
  final "RESULTADO" que se actualiza en vivo con lo que va a quedar.

  a) Elección del MAESTRO (radio en la cabecera de cada columna). El maestro es el contacto
     que SOBREVIVE: conserva su `id`, y ese id es al que apuntan todas las FKs reasignadas y
     al que llevan los enlaces existentes al contacto. Explícalo en una línea bajo el selector
     ("El contacto maestro conserva su ficha e historial; los demás quedan archivados
     apuntando a él"). Propón por defecto el que gane la heurística del script (más
     oportunidades → más campos con dato → `updated_at` más reciente) y muestra por qué.

  b) Cabecera de cada columna con los CONTADORES de lo que ese contacto aporta:
     nº de oportunidades, nº de documentos/notas, nº de tareas, fecha de creación.
     Junto a los contadores, una línea fija y visible: **"Todo lo de las columnas se conserva
     y pasa al maestro. No se descarta ningún archivo, oportunidad ni tarea."**
     El usuario tiene que entender que esos contadores son informativos, no una elección.

  c) Filas de campos elegibles: un RADIO por celda. El usuario marca de qué contacto viene
     ese campo. Cada fila es independiente — puede tomar `telefono` del contacto A y `email`
     del contacto B aunque ambos los tengan llenos. Ese es el caso de uso principal.
     · Por defecto se propone el valor del maestro; si el maestro lo tiene vacío y otro lleno,
       se propone el lleno (no perder dato por inercia).
     · Marca visualmente las filas donde los valores DIFIEREN — son las únicas que exigen
       decisión. Colapsa por defecto las filas idénticas o vacías en todos, con un "ver todos
       los campos" para desplegarlas; con ~40 columnas en `contactos_cache`, un modal que las
       muestre todas planas es inusable.
     · Si un valor elegido PISA un valor no vacío del maestro, señálalo (icono/color) y
       cuéntalos en el resumen de confirmación: "Vas a reemplazar 2 valores del maestro".
       No lo bloquees — es legítimo — pero que no pase inadvertido.

  d) Campos NO elegibles: muéstralos igual, en gris y sin radio, con el motivo al pasar el
     mouse. Son `bitrix_contact_id`, `pipedrive_person_id`, `zoho_id` (índice único: copiarlos
     al maestro mientras el perdedor archivado conserva los suyos viola el índice), los
     `*_tramites` (columnas ARRAY) y `id` / `created_at`. Que se vean es útil para auditar de
     dónde vino cada ficha; que no se puedan tocar evita un error 500 incomprensible.

  e) Vista previa del contacto resultante antes de confirmar, y confirmación que diga en
     números qué va a pasar: "Quedará 1 contacto con N oportunidades, M documentos y K tareas.
     Se archivarán 2 contactos. Reversible."

  ⚠️ ADVERTENCIA OBLIGATORIA EN EL MODAL — esto no es cosmético:
  Si los `nombre_completo` normalizados de los contactos seleccionados NO coinciden, muestra
  una advertencia destacada: "Estos contactos comparten teléfono o email pero tienen nombres
  distintos. Podría tratarse de una FAMILIA (titular y dependientes), no de un duplicado.
  Revisa antes de fusionar."
  Razón: el motor automático se niega a fusionar ese caso a propósito — lo marca
  `revision_dedup` para revisión humana. En los casos de asilo, varios familiares comparten
  el teléfono del titular. Fusionarlos destruye el expediente de un dependiente. Ver
  docs/IDEA-contactos-arbol-familiar.md y docs/CRITERIO-CALIDAD-CONTACTOS.md.

--- 4) BONUS DE ALTO VALOR: filtro "duplicados por revisar" ---

Ya hay contactos marcados con `revision_dedup = true` y agrupados por `revision_dedup_grupo`
(el motor los dejó ahí esperando ojo humano). Agrega un filtro en el listado que los muestre
AGRUPADOS por `revision_dedup_grupo`. Es exactamente el flujo de la reunión: *"supongamos que
estos dos Pedro son el mismo"* — pero con los candidatos ya detectados por el sistema en vez
de que el usuario los cace a mano buscando "Pedro".
Al fusionar desde ahí, limpia el flag `revision_dedup` del grupo resuelto (logueado, reversible).

--- CRITERIOS DE ACEPTACIÓN ---
[ ] Fusionar dos contactos con oportunidades/tareas/notas deja TODAS colgando del maestro.
    Verifícalo con SQL y pégame el antes/después.
[ ] El perdedor desaparece del listado pero SIGUE en la base con archivado=true y
    fusionado_en_contacto_id = maestro. Pégame el SELECT.
[ ] Cero DELETE físico en todo el flujo (grep del diff).
[ ] Si el maestro tenía un campo vacío y el perdedor lleno, el valor se conserva.
[ ] PRUEBA DEL ARMADO MANUAL: con dos contactos que tengan AMBOS teléfono y email distintos y
    llenos, fusiona eligiendo el teléfono del maestro y el email del perdedor. El resultado
    tiene esa combinación exacta. Pégame el SELECT del contacto resultante.
[ ] Y su revert: revierte esa misma corrida y verifica que el maestro recuperó SU email
    original y el perdedor volvió a estar activo con los suyos. Pégame el antes/después.
    (Este es el caso que el motor automático nunca ejecuta —nunca pisa— así que es el que más
    fácil se rompe en el revert. Pruébalo de verdad, no lo des por bueno.)
[ ] Fusionar dos contactos que tienen documentos CADA UNO deja los documentos de LOS DOS
    colgando del maestro. Conteo antes = conteo después. Ninguna elección del usuario puede
    hacer que se pierda un documento.
[ ] Mandar en `valoresElegidos` un campo con índice único, un ARRAY, o un id de origen que no
    esté en la fusión, devuelve 400 y no escribe nada.
[ ] contactos_merge_log tiene una fila por cada escritura, con valor_antes correcto.
[ ] `revertir(corrida_id)` deja la base EXACTAMENTE como antes de la fusión. Pruébalo de
    verdad: fusiona, revierte, y compara conteos y valores. Pégame la salida.
[ ] Intentar fusionar contactos con nombres distintos muestra la advertencia de familia.
[ ] Intentar fusionar en modo 'filtro' devuelve 400.
[ ] El CLI `node scripts/dedup-contactos.mjs --dry-run` sigue funcionando igual que antes.
[ ] typecheck y lint limpios.

Commit local + `git --no-pager diff --stat`. NO hagas push.
```

---

# OLA 3 — Acciones restantes y flujo de aprobación

> Regla de negocio dicha textualmente: *"si no eres un usuario admin, le mandas el request a
> los admin… pero igual se lo dejan para que todos tengan la opción, simplemente que no lo
> permites"*. Lo que cambia no es la visibilidad del botón: es el efecto.

**Correcciones v4 sobre esta ola — mandan sobre el texto de abajo:**

- **F1. "Cambiar responsable": SÍ se agrega la columna.** `crm_tadi.contactos_cache` no tiene
  responsable. Se aprueba añadir `responsable_user_id` con FK a `crm_tadi.users`
  `ON DELETE SET NULL` (dar de baja a un empleado deja al contacto sin responsable; **jamás** borra
  el contacto) y **SIN ÍNDICE**. Es una columna, no un rediseño del modelo — lo que quedó fuera de
  alcance en la reunión fue la revisión de los campos del contacto, no esto.
  *(Corregido en v9: este punto decía "e índice". La regla **R8** —posterior y categórica— prohíbe
  cualquier índice nuevo sobre `contactos_cache` en este módulo, y su razón aplica igual aquí: con
  ~3.810 contactos activos, filtrar por responsable es un scan de milisegundos. Manda R8. Si algún
  día hiciera falta, se mide antes contra PRODUCCIÓN, §1.14.)*
  Migración + entrada en `docs/BASE-DE-DATOS.md`
  explicando su función. NO la ejecutes. Al reasignar en masa, registra en `crm_tadi.auditoria` y
  hazlo en **una sola sentencia sobre el conjunto** — no un UPDATE por contacto en un bucle (§3.6).
- **F2. Reutiliza el sistema de solicitudes que YA existe.** Hay un patrón maduro: ENUM
  `tipo_solicitud`, vista `vi_solicitudes_oportunidades`, bandeja y banners. **No crees uno
  nuevo.** Extiende el ENUM y sigue la misma nomenclatura, la misma forma de vista y los mismos
  componentes de bandeja. Si algo del patrón existente no encaja, dilo antes de desviarte.
  *(Cerrado en v10: algo no encajaba. La tabla de contactos necesita un cuarto estado,
  `'ejecutada'`, que la familia de oportunidades no tiene, y los componentes compartidos solo
  conocen tres —`solicitudes/page.tsx:8` y el badge de `SolicitudesList.tsx:36-41`—. **No se tocan
  los componentes: normaliza la VISTA**, `CASE estado WHEN 'ejecutada' THEN 'aprobada' ELSE estado
  END`, igual que la `0037` hizo con `aprobado/rechazado`. La tabla conserva los cuatro porque los
  necesita para el CAS y el trigger; la ejecución no se pierde, viaja en `detalle`.)*
- **F3. Convención de nombres para los permisos nuevos.** `crm_tadi.user_permisos` está vacía y
  el único permiso que existe en todo el repo es `editar_monto`. La convención queda fijada como
  **`verbo_objeto`, snake_case, en español**. Los permisos de esta ola son exactamente dos:
  · `exportar_contactos` · `archivar_contactos`. No inventes otros sin consultar. Y recuerda:
  permisos en filas de `user_permisos`, jamás como columnas booleanas en `users`, jamás en el JWT (§2.2).
- **F3-bis. QUIÉN PUEDE EXPORTAR — resuelto el 2026-08-10.** El documento se contradecía: la cita de
  la reunión decía *"solo el mega admin"* y el criterio de aceptación decía *"como admin, Eliminar y
  Exportar siguen siendo directos"*. **Decisión de Juan (PM):**

  | Quién | Exportar | Aprobar una solicitud de exportación |
  |---|---|---|
  | Quien tenga `exportar_contactos` | ✅ directo | — |
  | Quien tenga `aprobar_contacto_exportar` | ✅ directo | ✅ |
  | El resto | ❌ **crea solicitud** | ❌ |

  🔴 **Corregido el 2026-08-12.** Esta tabla decía *"`admin` y `super_admin` exportan directo"*: eso
  es **cablear el rol**, que es justo el anti-patrón que `user_permisos` existe para evitar. La
  puerta es el **permiso**, y los admin lo tienen **por rol, sin nombrarlos** — es lo que hace
  `puede()` (`CONVENCIONES` §2.6). El resultado práctico para los admin es el mismo; la diferencia
  es que ahora se le puede dar `exportar_contactos` a una persona concreta sin hacerla administradora
  de todo, que era el objetivo desde el principio.

  Es el mismo patrón que ya tiene Archivar, así que no se inventa nada. **El botón se ve para
  todos** —la espec insiste en no ocultarlo— y la barrera está en el backend, verificada por consulta
  a la base (`CONVENCIONES` §2.6). La Etapa 2 entrega la exportación con el gate; la Etapa 3, el
  flujo de solicitud sobre `contacto_solicitudes`, que ya existe desde la etapa 1.

  ⚠️ **La exportación sigue siendo el mayor riesgo de la ola** (R11): es un fichero con datos de
  clientes que sale del edificio. Lista explícita de columnas, y los tres campos secretos no salen
  por ningún camino.
- **F4. La acción "Eliminar" en masa ARCHIVA. Nunca borra.** Es la misma semántica de la Ola 0,
  aplicada a un conjunto, con la confirmación informada de **R2** y el registro de **R3**. La
  purga sigue siendo el script aparte de super_admin (Ola 0 · paso 3).

```
Rama: `juan/contacts-actions-approvals`, DESDE `dev` (con Olas 1 y 2 mergeadas). Verifícalo.

ANTES DE EMPEZAR: en la Fase 0 punto 6 averiguaste si ya existe un patrón de solicitudes en el
CRM (vi_solicitudes_oportunidades / ENUM tipo_solicitud). Si existe, REUSA ese patrón y esa
nomenclatura. Solo crea algo nuevo si de verdad no hay nada. Dime cuál de los dos casos aplica
antes de implementar.

--- 1) ACCIONES DEL SELECT ---

Habilita las que quedaron en "Próximamente":

· Agregar tarea — asocia una tarea a los contactos seleccionados. Reutiliza el módulo de tareas
  existente. Si son N contactos, decide "una tarea por contacto" vs "una tarea con N contactos
  vinculados" SEGÚN cómo esté modelada hoy la relación tarea↔contacto. No lo elijas al azar:
  míralo y justifícalo en el reporte.

· Cambiar responsable — reasigna el usuario responsable. Selector de usuario + confirmación con
  la cantidad. Registra en crm_tadi.auditoria.

· Incluir en la exportación — exporta los contactos seleccionados. Usa la librería que ya exista
  en el proyecto (Fase 0 punto 5); si no existe ninguna, CSV UTF-8 con BOM.
  Debe funcionar en modo 'filtro' resolviendo el conjunto en el servidor y transmitiendo en
  STREAMING con cursor. Prohibido cargar decenas de miles de filas en memoria para armar el
  archivo — es exactamente el tipo de cosa que tumba la API (§3.6).

--- 2) SOLICITUD Y APROBACIÓN ---

Aplica a DOS acciones sensibles: ELIMINAR (archivar) y EXPORTAR.

- Admin / super_admin → ejecuta directo.
- Usuario normal → el botón está VISIBLE Y HABILITADO igual, pero al confirmar NO se ejecuta
  nada: se crea una SOLICITUD y se le informa "Tu solicitud fue enviada al administrador".
- La autorización se decide en el BACKEND consultando la DB (nivel_acceso + user_permisos),
  nunca por lo que diga el front ni por el JWT.
- Datos mínimos de una solicitud: tipo (archivar | exportar), solicitante, payload de la
  selección EN EL MISMO FORMATO 'ids' | 'filtro', cantidad de contactos afectados, estado
  (pendiente | aprobada | rechazada), aprobador, fecha de resolución, motivo del rechazo.
  Migración con el número que corresponda + entrada en docs/BASE-DE-DATOS.md. NO la ejecutes.
- Bandeja del admin: solicitudes pendientes con quién pidió, qué acción, cuántos contactos y
  previsualización de a cuáles afecta. Botones Aprobar / Rechazar.
- Al APROBAR se ejecuta en ese momento, con los mismos guardarraíles (archivado lógico,
  transacción, auditoría). El resultado queda en la solicitud.
- Una solicitud aprobada NO se puede ejecutar dos veces. Blíndalo con estado + constraint.
- NOTIFICACIONES: usa `crm_tadi.notificaciones` (existe) con prioridad `normal` para la
  solicitud entrante y `normal` para la resolución. Y NO OLVIDES el
  `emitToUser(userId, "notificacion:nueva", { tipo })` después de cada insert — sin él la
  campanita no se entera hasta que refresquen.
  `accion_url` debe llevar a la bandeja de solicitudes.
- El "mega admin" que menciona la reunión es el `super_admin` (Juan David). Si hace falta
  distinguir quién aprueba exportaciones frente a quién aprueba archivados, hazlo con filas en
  `user_permisos`, NO con columnas nuevas en `users` (§2.2).

--- CRITERIOS DE ACEPTACIÓN ---
[ ] Como usuario normal VEO los botones Eliminar y Exportar; no están ocultos.
[ ] Como usuario normal, confirmar Eliminar NO archiva nada: crea una solicitud. Verifícalo
    con SQL (el conteo de archivados no cambia).
[ ] Llamar el endpoint directo con curl como usuario normal tampoco ejecuta nada (la barrera
    está en el backend, no solo en la UI).
[ ] El admin recibe notificación in-app EN VIVO, sin refrescar (prueba el emit).
[ ] Aprobar ejecuta; rechazar no ejecuta y guarda el motivo.
[ ] Una solicitud aprobada no se puede volver a ejecutar.
[ ] Exportar "el total" con filtro genera el archivo completo sin picos de memoria
    (mídelo y pégame el dato).
[ ] Como admin, Eliminar y Exportar siguen siendo directos.
[ ] typecheck y lint limpios.

Commit local + `git --no-pager diff --stat`. NO hagas push.
```

---

## Trazabilidad — de lo que se dijo a dónde queda

| Reunión | Dónde |
|---|---|
| "poder seleccionarlos es lo que nos está faltando" | Ola 1 · selección |
| "la barrita fija aquí abajo… ancladita" / "no me gusta que llegue hasta abajo" | Ola 1 · barra fija al viewport |
| "cuando usted lo selecciona es que aparece" | Ola 1 · barra solo con ≥1 |
| "seleccione acción, hace lo mismo" | Ola 1 · select con esa etiqueta literal |
| "editar, eliminar" | Ola 1 · botones directos |
| "ese va el botón fusionar" (prioridad máxima) | Ola 2 |
| "supongamos que estos dos Pedro son el mismo" | Ola 2 · filtro `revision_dedup` |
| "agregar tarea, cambiar persona responsable" | Ola 3 |
| "incluir en la exportación… solo el mega admin" | Ola 3 · **resuelto el 2026-08-10, corregido el 2026-08-12 → exporta directo quien tenga `exportar_contactos` (los admin, por rol); el resto crea solicitud** (ver F3-bis) |
| "si no eres admin, le mandas el request a los admin" | Ola 3 · solicitudes |
| "pero igual se lo dejan para que todos tengan la opción" | Ola 3 · botón visible, barrera en backend |
| "una lista de 100 en 100" / "50 en 50" | Ola 1 · pageSize 50/100 |
| "que te muestre el total de los contactos" | Ola 1 · total siempre visible |
| "seleccionar el total" | Ola 1 · modo 'filtro' |
| "le falta la paginación… nos va a tirar la velocidad de carga" | Ola 1 · paginación en servidor |
| "en el drive carga más rápido porque le metí paginación" | Fase 0 §3 · copiar ese patrón |
| "ese botón cambia de mosaico a vista" | Ola 1 · toggle |
| "esto no iría todavía" (WhatsApp) | Excluido |
| "observadores no, porque es un contacto" | Excluido |
| "los cambios del contacto vienen para el próximo sprint" | Fuera de alcance (salvo las 2 excepciones de v4) |
| (v4) "nada se borra físicamente en el flujo normal" | Ola 0 · A1 · R1–R5 |
| (v4) "la fusión es de exactamente 2 contactos" | Ola 2 · A3 · D1 |
| (v4) "el resultado reutiliza el id del maestro" | Ola 2 · A4 |
| (v4) "la fusión tiene que llegar a GHL" | Ola 2 · A5 · E1/E2 |
| (v4) "los contactos van a tener responsable propio" | Ola 3 · A6 · F1 |

---

## Deuda técnica detectada — SOLO DOCUMENTADA, no se toca en este módulo

Hallazgos de `pg_stat_statements` en producción (2026-08-06). No son de contactos y **no entran en
ninguna ola de este documento**; se anotan aquí para que no se pierdan.

1. **La consulta de tareas es el mayor consumidor de base del CRM.**
   `SELECT t.*, u.nombre AS responsable_nombre, …` acumula **670.042 llamadas** y **~2,5 horas** de
   tiempo de base, devolviendo **210 filas por llamada**. El volumen de llamadas sugiere que el
   frontend la está pidiendo en bucle (polling, un `useEffect` sin dependencias estables, o un
   render que refetchea). Hay que mirar quién la llama y con qué frecuencia antes de tocar el SQL:
   optimizar una consulta que se llama 100 veces de más no arregla nada.
2. **Una consulta de mantenimiento tarda 2,8 HORAS por ejecución** (`WITH opp AS … doc_cf AS …`),
   3 ejecuciones registradas. Si es un script manual de saneamiento, no pasa nada. **Si algo la
   tiene programada (cron, job, loop del servidor), hay que saberlo ya**: son 2,8 horas de una
   conexión ocupada. Primer paso: identificar de dónde sale.

## Registro de versiones de este documento

- **v11 — 2026-08-10.** Jornada de pruebas en staging. **La Ola 0 gana un Paso 4: la papelera**
  (**D8**), más **D9** (el motivo dice si la fusión vino de la interfaz o del CLI) y **D10** (la
  fusión archiva registrando cuándo y quién). Salió de usar el sistema: la primera fusión real acabó
  en la pregunta *"¿dónde veo los archivados?"* y la respuesta era "en ningún sitio" — la ola había
  construido el archivado reversible y se había dejado la pantalla. Se fija la regla permanente de
  **no rellenar el pasado**: los ~27.800 sin `archivado_at` se ordenan `NULLS LAST` y se muestran
  como *"sin fecha registrada"*, porque inventarles una fecha sería falsificar historia (el defecto
  de la `0060`). Se documenta el `COALESCE` que hacía inelegible al índice parcial de la `0056`, con
  la advertencia de que **la rama contraria no se toca**. Y **F3-bis** cierra la contradicción sobre
  quién exporta: `admin` y `super_admin` directo, `usuario` crea solicitud.
- **v10 — 2026-08-07.** Correcciones de la auditoría de la etapa 1, sobre las mismas migraciones (no
  aplicadas en ningún entorno, así que se editan y no se apila otra). **C1:** la vista normaliza
  `'ejecutada'` → `'aprobada'` para no romper los componentes de bandeja que **F2** obliga a
  reutilizar; queda cerrado en el propio F2. **C2:** las dos FKs a `users` de la `0063` pasan a
  `ON DELETE NO ACTION` **explícito y razonado** —son la firma de quién pidió y quién autorizó—,
  con el contraste frente al SET NULL de la `0061` escrito en la migración.
- **v9 — 2026-08-07.** Ola 3, etapa 1 (esquema). **Se corrige el texto de F1**, que pedía la columna
  `responsable_user_id` "con FK e índice" y contradecía a **R8** (cero índices nuevos sobre
  `contactos_cache`, cerrado en v6): manda R8, la columna va con FK `ON DELETE SET NULL` y **sin
  índice**. Se arregla el punto, no se apila una nota. Migraciones `0061`–`0064` escritas y
  aplicadas **solo en la base LOCAL** (§1.13); en staging y prod siguen pendientes.
- **v8 — 2026-08-07.** Ola 2 implementada. Cardinalidad cerrada en **exactamente 2** y corregidos
  los dos restos del texto que decían "2..10". GHL autorizado por Juan: se añade **E1-bis** (las
  respuestas de la investigación) y **E3** (cómo quedó implementado, con el caso del revert
  resuelto por la vía segura y la pregunta abierta del plazo de gracia).
- **v7 — 2026-08-06.** Ola 1 implementada. Se corrigen tres puntos con lo aprendido al construirla:
  **C1** deja explícito que sustituye al §5 (casillas solo en la tabla; el estado de selección sí
  es compartido), **C3** se reescribe entero —la barra se alinea por maquetación con `sticky`, no
  calculando el ancho del sidebar, porque esa fuente de verdad no existía y el *spring* de
  framer-motion hacía imposible sincronizarla— y el **criterio de orden** pasa a `created_at DESC,
  id ASC` con el motivo (el trigger `trg_updated_at` reordenaría las filas mientras se pagina).
- **v6 — 2026-08-06.** Datos de producción (`pg_stat_statements`) + cierre del paso 2 de la Ola 0.
  Reglas nuevas: **R10** (auditoría inmutable), **R11** (prohibido `SELECT *`; credenciales USCIS y
  SSN están en claro y no salen de la API) y **R12** (resurrección según el motivo del archivado).
  **R8** pasa de "congelado" a **cerrado**: cero índices en este módulo. Ola 1 gana **C0** (la
  ventana de confirmación de R2, deuda de la Ola 0), **C6** (paginación: `LIMIT` sin `OFFSET` y
  orden sin desempate) y **C7** (la búsqueda no cubre `whatsapp` ni `a_number`). Nueva sección de
  deuda técnica observada. El documento se mueve a `docs/` y pasa a estar versionado en el repo.
- **v5 — 2026-08-06.** Absorbe la `ADENDA-v4-CONTACTOS.md` (borrada) y añade la **OLA 0** con las
  reglas **R1–R9**. Este archivo pasa a ser el **único** documento de especificación del módulo:
  no se crean adendas nuevas.
- **v4 — 2026-08-06.** Decisiones de producto tras auditar la Fase 0 (A1–A6, C1–C5, D1–D3, E, F1–F4).
- **v3.** La Ola 2 pasa a fusión manual campo por campo.
- **v2.** Reescrito contra el código real del repo.
