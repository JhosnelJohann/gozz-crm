# Convenciones y buenas prácticas — CRM TADI

> **Este documento es un CONTRATO vivo.** Define las reglas que programadores **y agentes de IA** deben seguir
> al modificar este proyecto. No es opcional: antes de hacer un cambio, consúltalo; si tu cambio establece o
> revela una nueva regla, **documéntala aquí** (o en un doc enlazado).

## Cómo usar este documento

- **Antes de programar:** léelo. Si vas a tocar base de datos, autorización, backend o frontend, hay una sección para eso.
- **Cuando detectemos una mejora o regla nueva** mientras trabajamos (estructura, nomenclatura, DB, código…), se agrega aquí. Así el proyecto converge hacia un solo estándar en lugar de dispersarse.
- **Cuando esta guía crezca**, los tópicos extensos se mueven a su propio archivo en `docs/` y se enlazan desde aquí (este queda como índice + reglas núcleo).
- **Agentes:** este archivo está referenciado desde `CLAUDE.md` (raíz) para que se cargue siempre. Trátalo como fuente de verdad de convenciones; si algo en el código las contradice, es deuda técnica a corregir, no un patrón a imitar.

## Flujo de trabajo por tareas

- **Cada tarea/bug arranca con un plan de acción en `.md` en la raíz del proyecto**, ANTES de tocar código. Debe incluir: diagnóstico, **causa raíz** (con archivo:línea), cambios propuestos, criterios de aceptación y despliegue. Nombre: `PLAN-ACCION-<slug>.md`.
- Estos planes son **documentos de trabajo** (no se commitean salvo que se decida); se pueden borrar una vez la tarea está hecha y desplegada. El conocimiento durable que valga la pena se pasa a este contrato o a la doc versionada.
- 🔴 **EL TRABAJO SE ORGANIZA Y SE CIERRA MÓDULO A MÓDULO** *(regla de Juan, 2026-08-20)*. Al recibir una tanda de observaciones, lo **primero** es agruparlas **por módulo** —no por dificultad, ni por dependencia técnica, ni por tipo de trabajo—, y **se cierra un módulo antes de empezar el siguiente**. Si se está en Contactos se sale de Contactos; si se está en Drive, de Drive.
  - **El porqué, que es lo que hace que la regla se respete:** el 2026-08-20 Juan entregó ocho observaciones **ya ordenadas por módulo** y el plan las reagrupó por tipo de trabajo (migración, componente, renombrado), con lo que una sola tanda saltaba entre Contactos, Tareas y Drive. Eso obliga a **recargar el contexto de un módulo varias veces**, dispersa la validación en staging —hay que volver a la misma pantalla en tres entregas distintas— y hace **imposible decir «este módulo está cerrado»**.
  - Una excepción se **propone y se pregunta**; no se aplica por iniciativa propia. Reordenar lo que ya venía ordenado es una decisión del que planifica, y quien entregó la tanda tiene que enterarse.
- **Entrega por etapas, ordenadas por dependencia.** Una etapa por encargo: se ejecuta, se **detiene**, se reporta, se audita, y solo entonces sale la siguiente. Nunca todo de golpe.
- **El reporte de cada etapa es el diff crudo**, no la narración de quien lo escribió: salida literal de `git --no-pager diff --stat` y `git --no-pager log --oneline dev..HEAD`.
- **La auditoría nunca se hace sobre el autorresumen del ejecutor** — quien se evalúa a sí mismo siempre se aprueba. Se audita sobre `git diff` / `git show` / `git log`. Y cuando una afirmación se pueda contrastar contra una **fuente independiente** (los datos reales de producción, el esquema en vivo), se contrasta: la discrepancia se reconcilia **antes** de seguir, no se da por buena.
- **Una sola especificación viva por módulo.** Toda decisión nueva se incorpora al documento que ya existe, en su sección. **No se apilan adendas**; una adenda suelta se absorbe en la espec y se borra.

---

## 0. Preservación — manda sobre todas las demás reglas

> Va numerada como **§0** a propósito: cuando choque con cualquier otra sección de este contrato, gana esta.

1. 🔴 **Nada se borra físicamente. Nunca.** Ni una fila, ni un archivo, ni un objeto de R2. Todo "borrado" del flujo normal es **archivado lógico y reversible**, con la bitácora que permita deshacerlo (patrón de referencia: `archivado` / `archivado_motivo` / `fusionado_en_contacto_id` + `contactos_merge_log`, mig. `0042`). **Ante la duda, se preserva.**
2. **Las bitácoras son inmutables.** `crm_tadi.auditoria` y las bitácoras de proceso (`contactos_merge_log`, `contactos_archivado_log`, …) no se podan jamás, por ningún motivo. Detalle y cómo marcar filas de prueba: **§3.3**.
3. **El borrado físico existe, pero solo como herramienta aparte:** script manual, ejecutado por un `super_admin`, con **simulación (`--dry-run`) por defecto**, `--apply` explícito, listado de candidatos y de exclusiones con su motivo, snapshot previo de lo que se va a borrar en una bitácora, y **revisión humana antes de aprobar**. Nunca se expone por API ni por UI, y nunca se dispara desde un flujo de usuario.
4. **Un archivado no borra archivos físicos.** Archivar un registro jamás toca R2 ni el disco (ver §8.3 para el único caso de borrado de objetos, restringido a huérfanos reverificados).

---

## 1. Migraciones de base de datos

El runner es `scripts/run-migrations.mjs` y lleva **tabla de control** `public.schema_migrations` (estilo Laravel): registra qué migraciones ya corrieron y ejecuta **solo las pendientes**, cada una en su **propia transacción**.

### Comandos
- `pnpm migrate` — ejecuta solo las migraciones **pendientes** y las registra.
- `pnpm migrate:status` — lista `[x]` aplicadas / `[ ]` pendientes.
- `pnpm migrate:baseline` — marca **todas** las actuales como aplicadas **sin ejecutarlas**.
- `node scripts/run-migrations.mjs baseline <prefijo>` — marca como aplicadas solo las que ordenan **antes** del prefijo (para adoptar una DB que ya tiene el esquema viejo).

### Reglas
1. **Nomenclatura:** `NNNN_descripcion_en_snake_case.sql`. Número de **4 dígitos**, secuencial, sin saltos. → **El próximo número disponible se lleva en `CLAUDE.md` (raíz)** — consúltalo y actualízalo ahí al crear una migración. **No lo repitas aquí:** este documento llegó a decir "próximo `0056`" cuando ya iban cinco más, porque tener el contador en dos sitios garantiza que uno de los dos mienta.
2. **Una migración = un cambio lógico** coherente (una feature/ajuste). No mezclar cambios no relacionados.
3. **NUNCA editar una migración ya aplicada** en staging/prod. Si necesitas corregir algo, crea una **migración nueva**. (Excepción única y justificada: arreglar una no-idempotencia que rompe a todos, como se hizo con `0001` el 2026-06-30.)
4. **Idempotencia obligatoria** (defensa en profundidad, además del tracking): usa `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, etc. Una migración debe poder re-ejecutarse sin error.
5. **Transacción por migración la da el runner.** No escribas `BEGIN`/`COMMIT` de nivel superior en el `.sql`. Evita sentencias que no pueden ir en transacción (`CREATE INDEX CONCURRENTLY`, `VACUUM`). **Índices pesados sobre tablas grandes** (ej. el GIN trigram `0054` sobre `drive_files` ~200k filas) **bloquean escrituras** al construirse dentro de la transacción del runner → en prod, aplicarlos en **ventana de mantenimiento** o crearlos a mano con `CREATE INDEX CONCURRENTLY` (fuera de `pnpm migrate`) y marcar la migración con `baseline`.
6. **Esquemas:** las tablas de negocio van en `crm_tadi`. El control de migraciones vive en `public.schema_migrations`.
7. **Seeds con llave foránea:** condiciona el `INSERT` a que el registro referenciado exista, para no romper en entornos que no tienen esa data:
   ```sql
   INSERT INTO crm_tadi.user_permisos (user_id, permiso)
   SELECT '<uuid>', 'editar_monto'
   WHERE EXISTS (SELECT 1 FROM crm_tadi.users WHERE id = '<uuid>')
   ON CONFLICT DO NOTHING;
   ```
8. **Adopción de una DB existente** (que ya tiene esquema pero la tabla de control vacía): correr **una sola vez** `node scripts/run-migrations.mjs baseline <primer_pendiente>` antes del primer `pnpm migrate` (se hizo con `baseline 0029` en staging y prod).
9. **Flujo de aplicación:** LOCAL → STAGING (`crm_staging`) → PROD (`postgres`). Siempre probar en local y staging antes de prod.
10. **Datos de prueba / fixtures con credenciales:** una migración puede sembrar datos de referencia (departamentos, trámites) y usuarios de prueba, **pero credenciales conocidas (usuarios con password versionado en el repo) van SOLO en entornos no-producción**. Usa el guard `WHERE current_database() <> 'postgres'` para que NUNCA se creen en prod. Nunca commitear credenciales válidas en producción. Ejemplo: `0030_seed_usuario_prueba.sql`. Para probar en prod, usar una cuenta real o crear una temporal a mano (password fuerte) y borrarla al terminar.
11. **Nombres de objetos de DB:** las **vistas** se prefijan con `vi_` y se nombran por dominio: `vi_<dominio>_<detalle>` (ej. `vi_solicitudes_oportunidades`; a futuro `vi_solicitudes_<otro>`). Los **ENUM** (tipos) van en `crm_tadi` con nombre descriptivo (ej. `tipo_solicitud`). Tablas en `snake_case`.
12. 🔴 **Actualizar SIEMPRE la documentación de la base de datos.** Toda migración que **cree o modifique una tabla, columna, vista, FK o índice** debe venir acompañada de la actualización de **[BASE-DE-DATOS.md](BASE-DE-DATOS.md)** en el mismo cambio: la nueva tabla/columna con **su función explicada** (no solo el nombre), y —si toca el núcleo— el mapa del flujo del contacto (§1 de ese doc). Una migración sin su entrada en la doc se considera **incompleta**. Esto vale igual para programadores y para agentes: `BASE-DE-DATOS.md` es la referencia real del esquema; manténla fiel a la BD.
13. **Quién escribe y quién ejecuta.** Un agente de IA **escribe** la migración y **avisa**. La corrida que cuenta —STAGING y PROD— la hace **un humano, a mano**, en el orden LOCAL → STAGING → PROD (§1.9). Vale igual para cualquier script de datos destructivo o de saneamiento.
    - ✅ **Excepción explícita: la base LOCAL del agente.** El agente **sí puede** aplicar su migración en su base local **para verificarla**, y se espera que lo haga cuando el efecto no sea evidente leyendo el SQL. Condiciones, las tres: (a) **solo local** —jamás `crm_staging` del VPS ni `postgres`—, (b) **se reporta** que se ejecutó y qué se observó, y (c) **la base se deja como estaba**, revirtiendo por el camino auditado y **sin borrar filas de bitácora** (§0.2 y §3.3 mandan sobre la comodidad de dejarlo limpio).
    - **Por qué la excepción existe:** la redacción anterior prohibía ejecutar en cualquier entorno. Aplicada al pie de la letra habría dejado pasar un defecto real: la primera versión de la mig. `0060` usaba `bigserial`, que **reescribe la tabla y rellena las filas existentes** — le habría inventado un orden de escritura a 21.406 filas de `contactos_merge_log`, es decir, habría falsificado una bitácora, y **no se ve leyendo el SQL**. Se detectó porque se ejecutó en local. Verificar en local no es un riesgo: es la primera de las tres barreras (local → staging → prod) y es donde sale más barato descubrir que algo no hace lo que su autor creía.
    - 🔴 **Lo que la excepción NO autoriza:** ejecutar en staging o en prod, correr scripts de datos fuera de local, ni dar por buena una migración "porque en local fue bien" — la base local **no** es idéntica a staging: tiene migraciones marcadas como aplicadas que nunca se ejecutaron, así que se verifica el **esquema real**, no el registro (`METODOLOGIA-DE-TRABAJO.md` §3.2).
14. ⚠️ **El repositorio NO es la fuente de verdad del set de índices de producción.** Hay índices creados a mano en prod (§1.5: `CREATE INDEX CONCURRENTLY` fuera del runner, migración marcada con `baseline`) que no aparecen en ninguna migración del repo. Antes de proponer, crear o descartar un índice —o de razonar sobre el rendimiento de una consulta— **verifica contra producción** (`pg_indexes` + `EXPLAIN`). Deducir el estado de los índices leyendo `packages/db/migrations/` da un resultado incompleto.

---

## 2. Autorización y permisos

1. **Roles** vía columna `crm_tadi.users.nivel_acceso` ∈ `super_admin` | `admin` | `usuario`.
2. **NO agregar columnas booleanas por permiso** a la tabla `users` (anti-patrón: infla la tabla). Los permisos granulares van en **`crm_tadi.user_permisos (user_id, permiso)`**.
3. **Otorgar/revocar** un permiso = `INSERT`/`DELETE` en `user_permisos` (o una UI futura), **sin redeploy**.
4. **La verificación se hace SIEMPRE por consulta a la base**, nunca contra el JWT. Los tokens duran **365 días y no se refrescan**: `u.nivel` no dice qué es esa persona hoy, dice qué era cuando entró.
5. **JWT payload mínimo:** `{ sub, email, nivel }`. Cookie httpOnly `access_token`. No meter datos volátiles ni permisos ahí. **De ese payload sólo se usa `sub`** — la identidad, que sí es estable.

### 2.6 · `puede()` es la única puerta

```ts
// apps/api/src/lib/permisos.ts
export async function puede(userId: string | null | undefined, permiso: string): Promise<boolean>
```

Resuelve rol amplio **y** permiso granular **en una sola consulta**, y exige `activo`:

```sql
SELECT 1 FROM crm_tadi.users u
 WHERE u.id = $1 AND COALESCE(u.activo, true) = true
   AND (u.nivel_acceso IN ('admin','super_admin')
        OR EXISTS (SELECT 1 FROM crm_tadi.user_permisos p
                    WHERE p.user_id = u.id AND p.permiso = $2))
```

- **Una consulta y no dos** porque `/api/auth/me` la llama en cada carga de página.
- **`COALESCE(activo, true)`**: un usuario desactivado no puede, ni con la fila de `user_permisos` puesta. El `COALESCE` está para no cerrarle la puerta a los históricos con `activo` en NULL.
- **Los admin no se nombran** en ninguna regla de negocio: quien tenga el permiso puede, y los admin lo tienen por rol. Escribir *"admin, super_admin y quien tenga X"* es cablear el rol otra vez.
- Efecto inmediato y sin volver a entrar: quitar el rol, desactivar la cuenta o revocar el permiso **corta en la siguiente llamada**.

### 2.7 · Nombres de permiso

| Para | Forma | Ejemplos |
|---|---|---|
| **Hacer** | `verbo_objeto`, snake_case, español | `editar_monto`, `exportar_contactos`, `cambiar_etapa_masivo` |
| **Aprobar** | `aprobar_` + el valor del ENUM `tipo_solicitud` | `aprobar_oportunidad_monto`, `aprobar_contacto_exportar` |

Lo segundo **hace el permiso derivable del tipo**: el código que aprueba no necesita un `switch` ni una tabla de correspondencias — con el `tipo` de la solicitud ya sabe qué exigir, y un tipo nuevo trae su permiso sin tocar nada más. Ver §10.3.

### 2.8 · 🔴 Corregir un permiso no puede pasar por retirarlo

Todo sitio que **conceda** un acceso tiene que tener cómo **cambiarlo**. Si la única forma de bajar a alguien de "leer + enviar" a "solo leer" es quitarle la fila y volver a crearla, eso no es una molestia de dos clics: es un procedimiento que **deja a la persona sin acceso en el hueco** entre las dos operaciones, y que si se interrumpe a la mitad —se cierra el modal, se cae la red, quien lo hacía se distrae— la deja **fuera del todo** cuando lo que se quería era ajustarle un permiso a la baja.

En concreto:

1. **Editar es editar.** Un cambio de nivel de acceso es un `UPDATE` sobre la fila que ya existe, con su `PATCH` propio. Nunca un `DELETE` + `INSERT`, ni en el servidor ni encadenando dos llamadas desde la pantalla.
2. **La pantalla enseña las opciones, no solo la vigente.** Un estado que hay que pulsar para descubrir que alterna esconde la mitad de lo que se puede hacer. Y si el formulario de alta oculta a quien ya tiene acceso —que es lo correcto para no duplicar—, entonces **la fila existente es el único sitio donde se puede cambiar**: tiene que poder.
3. 🔴 **Un valor de permiso que no está en la lista se RECHAZA; no se coacciona al más seguro.** `permiso === "enviar" ? "enviar" : "ver"` convierte un `"enviarr"` en "solo leer" sin decir nada, y quien lo pidió se queda creyendo que concedió el envío. En autorización, adivinar es peor que fallar: 400 y un mensaje.
4. **Se devuelve la fila tal como quedó guardada**, y la pantalla pinta eso — no el valor que pidió. Así lo que se ve es el estado de la base y no la suposición del cliente.

Referencia: `apps/api/src/lib/buzon-acl.ts` y `PATCH /api/buzones/:id/acl/:aclId`.

### 2.9 · Deuda declarada, para que nadie la imite

- **`isAdmin(u)` lee el JWT.** Sigue usado en unos sesenta sitios (archivar, fusionar, revertir, revisar descuentos, configuración…). Es **deuda conocida — D11**, con entrega propia: cada uno de esos sitios cambia *quién puede qué*, y eso se decide de uno en uno, no con un `sed`. **No se añaden usos nuevos.**
- **`esAdminEnBase(userId)`** es la puerta del rol amplio *sin permiso nombrado todavía*: consulta la base y respeta `activo`, pero no distingue por permiso. Cuando el sitio que la usa tenga su `verbo_objeto`, pasa a `puede()`.
- 🔴 **`crm_tadi.roles_permisos` está OBSOLETA.** Nació en la `0001`, no es por rol pese al nombre (es `user_id` + `modulo` + un blob `jsonb`) y **tiene cero referencias en código**. Quedó huérfana al nacer `user_permisos`. **No se borra** (§0) y **no se construye nada sobre ella**: la tabla viva es `user_permisos`.

---

## 3. Backend (API · Express + TypeScript)

1. **Acceso a DB** siempre con el helper `query` de `./db.js`, placeholders `$1, $2, …`. **Nunca** interpolar valores del usuario en el SQL (inyección).
2. **Auth:** `requireAuth` protege rutas; el usuario autenticado está en `(req as any).user` = `{ sub, email, nivel }`.
3. **Auditoría:** los cambios sensibles (montos, etapas, etc.) se registran en `crm_tadi.auditoria` con columnas `(user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)`.
   🔴 **`auditoria` es INMUTABLE: nunca se borra una fila.** Ni en producción, ni en staging, ni en local, ni "para limpiar una prueba". Es la misma regla de preservación que rige todo el proyecto, y la bitácora de auditoría es lo último que puede permitirse perder: si se puede podar, deja de ser prueba de nada. Para distinguir filas de prueba, **márcalas en el propio registro** (p. ej. `datos_antes.prueba = true` o el motivo en la `accion`). Vale igual para `contactos_merge_log`, `contactos_archivado_log` y cualquier otra bitácora.
4. **Notificaciones in-app:** insertar en `crm_tadi.notificaciones` `(user_id, tipo, titulo, mensaje, prioridad, accion_url)`. `prioridad` ∈ `baja` | `normal` | `alta` | `critica` (respetar el CHECK). **SIEMPRE** emitir además el evento de socket para la entrega en tiempo real: `emitToUser(userId, "notificacion:nueva", { tipo })`. Sin ese `emit`, la campanita (`NotificationsPanel`) solo se actualiza al refrescar la página.
5. **Lógica compartida** (ej. permisos) va en módulos reutilizables bajo `apps/api/src/lib/` para tener una sola fuente de verdad, no duplicada por archivo de rutas.
6. **Rendimiento a escala:** el sistema maneja **decenas de miles de filas** (ej. ~60k carpetas de Drive). **No proceses grandes volúmenes con algoritmos O(n²) en JS** sobre el event loop de Node — usa SQL o estructuras indexadas (`Map` por clave). Ojo: `statement_timeout` de Postgres **no** corta bucles de CPU en Node (un O(n²) cuelga toda la API). Referencia: incidente "Drive tree O(n²)" en la [documentación general](crm-tadi-documentacion-general.md#7-incidente-de-referencia--drive-tree-on²-resuelto).

---

## 4. Frontend (Next.js · App Router)

1. **Permisos de UI** se leen con `useCurrentUser()` (`lib/auth-user.ts`), que expone `{ user, isAdmin, isSuperAdmin }` desde `GET /api/auth/me`.
2. La UI **nunca es la única barrera**: gatear un botón en el front es UX; la autorización real **siempre** se valida también en el backend.
3. **Identidad visual (brand):** naranja primario `#FF8609`, ámbar `#FFB51C`. Usar los tokens/clases de marca existentes (`brand-orange`, `gradient-orange`, etc.), no colores sueltos.
4. **El build NO valida calidad de código:** `next.config.mjs` tiene `eslint: { ignoreDuringBuilds: true }` (para que warnings no rompan el deploy). Por eso un build verde **no** garantiza que el lint esté limpio — corre el lint/typecheck aparte antes de subir.
5. **En Windows, `next build` no puede terminar del todo — y no es el código.** El paquete usa
   `output: "standalone"`, y ese último paso copia las dependencias creando **enlaces simbólicos**.
   Esta máquina no tiene el privilegio para crearlos, así que el build siempre acaba en
   `EPERM: operation not permitted, symlink ...`. Se comprobó el 2026-08-25 con un `fs.symlinkSync`
   suelto en un directorio temporal: falla igual, sin Next de por medio.

   🔴 **Entonces la puerta local es lo que pasa ANTES de ese paso:** `✓ Compiled successfully` y
   `✓ Generating static pages (N/N)`. Ahí es donde aparecen los fallos que tumban el despliegue —
   un import roto, un hook mal puesto, un componente de servidor usando `useState`—, que es
   justamente lo que el `typecheck` no ve. Si el build muere **antes** de «Compiled successfully»,
   eso sí es tuyo. Al pegar la evidencia se dice las dos cosas: hasta dónde llegó y que el `EPERM`
   final es del sistema operativo, no del cambio.
6. *(Sección en construcción — se irá llenando con convenciones de componentes, estilos y estructura de carpetas a medida que las definamos.)*

### 4.7 · 🔴 Ningún identificador interno en texto de cara al usuario

**Ni permisos, ni columnas, ni tablas, ni claves de ENUM, ni uuids.** Se dice **qué significa**, no
cómo se llama por dentro. Y **dentro de un `<code>` es peor**: el formato de código dice "esto es un
dato que deberías reconocer", así que lo que era ruido pasa a parecer un error del sistema.

Caso real que fijó la regla (visto en staging, 2026-08-12). El modal de cambio de etapa decía:

> ❌ *"No tienes el permiso `cambiar_etapa_masivo`, así que esto no cambia nada todavía…"*
> ❌ *"Se escribirá `fecha_completada` en 0 oportunidades"*

`cambiar_etapa_masivo` es el nombre de una fila de `user_permisos` y `fecha_completada` el de una
columna. A un vendedor no le dicen nada, y sonaban a avería en vez de a regla de negocio. Lo que dice
ahora:

> ✅ *"No puedes cambiar la etapa de varias oportunidades a la vez, así que esto no cambia nada
> todavía: se enviará como solicitud y quedará parada hasta que un administrador la apruebe."*
> ✅ *"Se registrará **la fecha de ganado** en 3 oportunidades."*

Reglas que salen de ahí:

- **Un permiso se traduce a lo que impide**, no se nombra. "No puedes X" — nunca "te falta el permiso `x`".
- **Una columna se llama como se llama en pantalla.** `fecha_completada` es *"la fecha de ganado"*, que es como ya la llama el filtro de esa misma pantalla. Si la interfaz y el aviso le dan dos nombres, uno de los dos sobra.
- **Un uuid nunca se enseña como identificación.** Si no hay nombre, se dice que no lo hay — *"(caso sin nombre)"*, no el uuid.
- **Una clave de ENUM o de etapa tampoco.** Si no se puede resolver su etiqueta —porque el registro ya no existe—, se reformula la frase: *"la etapa de destino ya no está disponible"*.
- **Enumera solo lo que va a pasar.** Una línea que dice "0" no informa y le resta peso a las que sí traen número. ⚠️ Pero **el bloque no desaparece**: se sustituye por una frase que diga que no hay efectos. Que el sistema diga *"lo he comprobado y no hay nada"* vale más que el silencio, que no distingue "no pasa nada" de "no lo miré".

⚠️ **Esto es solo el TEXTO.** Los `value` de un desplegable, las claves de una respuesta JSON y los
nombres en comentarios de código siguen siendo los internos: ahí son contratos, y renombrarlos por
estética rompe cosas.

---

### 4.8 · 🔴 Quien clasifica y quien escribe comparten las fronteras

Si una regla decide **en qué grupo cae algo** y otra decide **qué valor escribir para meterlo en ese
grupo**, las dos tienen que salir del **mismo cálculo**. No de dos cálculos que coinciden: del mismo.
En cuanto son dos, divergen, y divergen en silencio.

Caso real que fijó la regla (tablero de Tareas, 2026-08-20). La vista «Por fecha límite» clasificaba
en franjas —hoy, esta semana, próxima semana— con una aritmética de semanas propia. Al darle
arrastre se escribió, **aparte**, qué fecha pone cada columna: «Esta semana» → viernes a las 18:00.
Suena bien y es lo que la gente entiende por «esta semana». Pero la franja acaba en **domingo**, no
en viernes, así que:

- un **viernes**, el viernes a las 18:00 cae en «Para hoy»;
- un **sábado** y un **domingo**, cae en **«Atrasado»**.

Tres días de cada siete la tarjeta se iba **sola** a otra columna delante de quien la arrastró. Y el
domingo el problema no tiene arreglo posible: la franja de «Esta semana» está **vacía** ese día.

Lo que se hizo, y es la forma de la regla:

- Un solo módulo (`lib/tareas-fechas.ts`) publica los cortes (`cortesDeSemana`), el clasificador
  (`columnaDeTarea`) **y** el generador (`fechaParaColumna`). El generador se calcula desde los
  cortes: ni un `getDay()` suelto ni un `+7` a mano contra otra frontera.
- El generador **comprueba que su propia respuesta cae donde debe** antes de darla, y si no cabe
  devuelve «no hay hueco» en vez de una fecha equivocada.
- La invariante se prueba, y **para todos los casos del ciclo**, no para el cómodo:
  `columnaDeTarea(fechaParaColumna(col, día), día) === col` para las cuatro columnas y **los siete
  días**. Congelado en un miércoles habría pasado en verde: el defecto solo salía viernes, sábado y
  domingo.

⚠️ **«No hay hueco» y «quitar el valor» son cosas distintas**, y un `null` no las distingue. Si la
misma función puede devolver las dos, van en el tipo —una unión discriminada— o en dos funciones. En
este caso «Sin fecha límite» borra el plazo y «Atrasado» no acepta nada: confundirlos habría hecho
que soltar en Atrasado dejara la tarea sin plazo.

Sale de aquí una regla de UI que va con ella: **lo que no acepta tiene que verse que no acepta,
antes de soltar.** Una columna que se ve igual que las demás, se traga la tarjeta y la devuelve de
un salto no parece una regla de negocio: parece la aplicación rota.

---

### 4.9 · 🔴 Una capa a pantalla completa se monta en `<body>`, no donde la llamen

Cualquier cosa con `position: fixed` que deba cubrir la ventana —un visor, un modal, un menú
flotante, un lightbox— va montada con `createPortal(…, document.body)`. **No es opcional y no
depende de dónde se use hoy.**

El motivo es una regla de CSS que no se ve leyendo el JSX: `fixed` deja de medirse contra la
ventana en cuanto **algún ancestro** tiene `transform`, `filter`, `will-change` o
**`backdrop-filter`**. Entonces el ancestro pasa a ser el bloque contenedor y la capa se mide
contra él. No hay aviso, no hay error de compilación y el `tsc` pasa: simplemente sale del tamaño
equivocado.

Caso real que fijó la regla (visto en staging, 2026-08-21). Abrir un PDF adjunto desde el chat de
una tarea pintaba `FilePreviewModal` **dentro de la burbuja del mensaje** —unos 240 px de ancho,
recortado por el scroll de la conversación— en vez de a pantalla completa. La culpa era de
`.glass-bubble-me` / `.glass-bubble-other`, que llevan `backdrop-filter: blur(...)` porque el chat
es de cristal. El mismo visor funcionaba bien en el Drive y en la ficha del contacto, donde se
monta a nivel de página: **el componente no estaba mal, estaba mal colgado.**

Lo revelador es que el repositorio ya contenía el arreglo, aplicado dos veces en ese mismo chat:
`MessageActions` y `ChatComposer` montan sus capas con `createPortal` justo por esto. Alguien se
topó con la regla, la resolvió en su componente y no la escribió en ninguna parte, así que el
siguiente volvió a caer. Por eso está aquí.

Reglas que salen de ahí:

- **El portal va en el componente que promete pantalla completa, no en quien lo usa.** Si vive en
  quien llama, el próximo que lo monte bajo un cristal reabre el defecto sin enterarse. Un visor a
  pantalla completa garantiza por sí mismo que lo es.
- **Guarda de montaje.** `document` no existe en el render del servidor: se porta tras el primer
  efecto (`const [montado, setMontado] = useState(false)`), y el `return null` va **después de
  todos los hooks**.
- ⚠️ **Los eventos de React siguen subiendo por el árbol de React**, no por el del DOM. Portar una
  capa **no** desconecta los `onClick` de sus ancestros de React: lo que estaba parado con
  `stopPropagation` sigue parado, y lo que llegaba sigue llegando. Lo que sí deja de llegar son los
  listeners **nativos** puestos sobre nodos ancestros del DOM.
- **La capa (`z-index`) no es un número libre**, y elegirlo mal es la forma más fácil de convertir
  un arreglo en un fallo peor. Tiene que caer **por encima** de lo que pueda abrirla y **por
  debajo** de lo que nunca puede quedar tapado. En este proyecto, hoy: modales `z-50`; lightbox del
  chat `z-[90]`; visor de archivos `z-[95]`; **llamadas `z-[99]`–`z-[120]`**; avisos y buscadores
  globales por encima. Una llamada entrante no puede quedar debajo de un documento abierto.
- **Empatar en `z-index` no es ganar.** Con el mismo valor decide el orden del documento, y eso se
  rompe moviendo una línea. Si una capa tiene que estar encima de otra, se le pone un número mayor
  y se dice por qué.

### 4.9-ter · 🔴 Lo que está abierto no se esconde con `hover`, y lo invisible no recibe clics

**Un desplegable no puede vivir dentro de un contenedor `opacity-0 group-hover:opacity-100`.** Dos
motivos, y los dos mordieron el mismo día:

1. **`opacity: 0` no cierra nada.** El menú sigue montado y sigue *abierto*: solo que no se ve. Al
   volver a pasar el ratón reaparece «solo», sin que nadie lo haya pedido.
2. **`opacity: 0` sigue recibiendo el ratón.** La capa `fixed inset-0` que cierra al pulsar fuera
   se queda tapando la pantalla entera, invisible y activa. Y si esa capa es **descendiente** del
   elemento que tiene el `group`, el navegador la cuenta como «ratón encima»: el `hover` se
   realimenta consigo mismo y el menú **parpadea** abriendo y cerrando solo.

La regla:

- Mientras el menú está **abierto**, su contenedor se ve y recibe el ratón **pase lo que pase** —
  nada de `hover` de por medio.
- Mientras está **cerrado**, además de invisible va con `pointer-events-none`, para que un botón
  que no se ve no se trague un clic.
- La capa de cerrar-al-pulsar-fuera **solo existe con el menú abierto**, y nunca dentro de algo que
  se desvanece.

Caso real (staging, 2026-08-25): «*de repente titila la pantalla… cuando el mouse pasa por el
archivo se despliegan solas las opciones… sigue titilando en intervalos de medio segundo*». Había
**cuatro** copias del mismo desplegable —fila y tarjeta de archivo, fila y tarjeta de carpeta— y el
defecto vivía en dos. El arreglo no fue tocar las dos: fue que la interacción pasara a vivir en un
solo componente (`MenuDeAcciones`), con la decisión de clases en `lib/drive-acciones` para poder
fijarla con una prueba —lo único de esto que se comprueba sin navegador—.

### 4.9-bis · Y lo mismo con `absolute`: quien promete llenar su caja, se da el marco

La regla de arriba es un caso de una más general: **un componente que se posiciona a sí mismo tiene
que traerse el marco contra el que se mide.** Si el requisito vive en quien lo usa, el siguiente que
lo use lo olvidará — y lo olvidará en silencio, porque no hay error de compilación que avise.

Caso real que la confirmó (staging, 2026-08-25). `MiniaturaArchivo` se pintaba con `absolute
inset-0` y **avisaba en su propia cabecera** de que el contenedor de fuera necesitaba `relative`.
No bastó: los tres paneles nuevos del Drive —Compartidos conmigo, Destacados y Recientes— le dieron
un cuadro de 36 px sin `relative`, así que `absolute` se midió contra la página y **un `pikachu.png`
compartido ocupó la pantalla entera**. Tres llamadores seguidos, el mismo despiste, con el aviso
escrito delante.

El arreglo fue mover la garantía dentro: el componente envuelve lo suyo en `relative h-full
w-full`, y a quien lo usa solo se le pide una caja **con tamaño**. Lo que sigue siendo de fuera es
la **forma** (`overflow-hidden` para el redondeo), que es una decisión de diseño, no de posición.

⚠️ **Un comentario que avisa no es una garantía.** Si un componente necesita algo de su contexto
para no romperse, o se lo da él, o el defecto vuelve. Documentarlo sirve para explicar por qué está
puesto, no para sustituirlo.

⚠️ **Esto no se puede probar con la suite de hoy.** La del frontend está en FASE 1 —solo lógica
pura de `src/lib/`, sin DOM (§9.1)—, así que un fallo de posicionamiento no lo caza ninguna prueba:
se caza mirando la pantalla. Razón de más para que la garantía viva en un solo sitio.

⚠️ **Dónde mirar cuando algo `fixed` sale del tamaño equivocado**: en las herramientas del
navegador, subir por los ancestros buscando `transform`, `filter`, `backdrop-filter` o
`will-change`. Es siempre eso. Y ojo con `framer-motion`: un `motion.div` pone `transform` mientras
anima, así que una capa puede salir bien parada y torcerse durante una animación del padre.

---

## 5. Ramas y despliegue

- Modelo real: `dev` → `qa` (= STAGING) → `prod` (= PRODUCCIÓN). La rama `main` está apartada.
- **Ramas de trabajo** se crean desde `dev` con nombre **en inglés** `autor/description` en kebab-case (ej. `juan/amount-change-requests`), se mergean a `dev`, luego `dev → qa`, y por último `qa → prod`.
- **Mensajes de commit en inglés**, estilo Conventional Commits: `tipo(scope): summary` (tipos: `feat`, `fix`, `docs`, `chore`, `refactor`, `ci`…). Ej.: `feat(payments): add payment change requests`.
- **El merge ES la aprobación:** promover por Pull Request a la siguiente rama es el mecanismo de aprobación y dispara el auto-deploy (GitHub Actions vía SSH al VPS).
- **Autoridad de promoción (quién puede hacer qué):**
  - `dev → qa`: lo gestiona **Jhosnel Roas (QA)**, que además valida en staging.
  - `qa → prod`: **Jhosnel abre el PR**, pero **solo Juan David Duque (PM) puede aprobarlo y mergearlo**. Es el control final antes de producción.
- **Nada directo a producción.** Ningún cambio llega a prod sin (1) validación de QA en staging y (2) aprobación explícita del PM sobre el PR `qa → prod`.
- Probar siempre en local y luego en staging antes de promover.
- 🔴 **El despliegue lo hace el pipeline, no una mano.** Nunca ejecutar `pm2 restart crm-api` ni `pm2 restart crm-frontend`: eso es **producción en vivo** y corta el servicio a los usuarios. Las pruebas de extremo a extremo van contra **staging**, sobre el caso que de verdad importa, no sobre uno cómodo.
- **Límites de los agentes de IA en git:** ningún agente hace `push`, `merge`, `rebase`, `cherry-pick`, Pull Requests, `reset --hard` ni borrado de ramas. Commitea en local, en su propia rama, y se detiene. La lista completa de lo prohibido y lo permitido está en **`CLAUDE.md` → "Git — límites del agente"**.

> Detalle completo del pipeline y CI/CD en la [documentación general §3](crm-tadi-documentacion-general.md#3-repositorio-github-y-pipeline-cicd).

---

## 6. Base de datos — conexión, entornos y operación

> Contexto completo (topología Supabase/Docker, pooler, watchdog) en la [documentación general §5–6](crm-tadi-documentacion-general.md#5-base-de-datos). Aquí solo las reglas duras.

1. **El esquema SIEMPRE es `crm_tadi`** en ambos entornos. Lo único que cambia entre entornos es el **nombre de la base**: `postgres` (prod) vs `crm_staging` (staging/local). El esquema está hardcodeado en las queries (`crm_tadi.tabla`).
2. **Ignora la variable `DB_SCHEMA` del `.env`** (dice `crm_tadi_staging` pero **no se usa** y ese esquema no existe). Red herring documentado.
3. **Conexión directa** al Postgres (`supabase-db`), **no el pooler** (Supavisor en modo `transaction` rompe los prepared statements de `pg.Pool`). Tanto staging como prod usan conexión directa vía `DATABASE_URL`.
4. **Antes de tocar prod, confirma a qué base estás conectado**: comparar `current_database()` y un conteo conocido que difiera entre entornos. Nunca asumir.
5. **Backup antes de cambios mayores:** dump (`.dump`) de la base, y copia del `.env` con sufijo de fecha/motivo antes de modificarlo (rollback rápido).
6. **Para diagnóstico de base, desde el VPS:** `docker exec -i supabase-db psql -U postgres -d <base> -c "<query>"` es la vía más confiable (no depende de IPs internas volátiles).
7. 🔴 **Las credenciales NUNCA se escriben en un chat**, ni con un agente de IA ni en un canal de equipo. Van directo a los archivos de configuración del servidor (`.env`, gitignored) y se leen por `process.env`. Lo que pasa por un chat queda en un historial que nadie controla; además §1.10 ya prohíbe versionarlas.

---

## 7. Estructura del monorepo

Monorepo pnpm. Apps independientes (cada una se despliega y corre por separado, gestionadas por PM2 en el VPS):

```
apps/
├── api/        → Backend Express (Node.js + TypeScript). El tsconfig compila SOLO src/.
│   ├── src/    → Código de runtime (rutas, lib/, db.ts, …)
│   └── scripts/→ Herramientas de QA/validación: NO entran al build ni al runtime.
├── frontend/   → Frontend Next.js 14 (App Router).
└── ai/         → Capa de IA (Python / FastAPI).
packages/
└── db/migrations/ → Migraciones SQL (ver §1).
```

> **Nota:** la documentación general menciona `apps/web` por una versión vieja; la carpeta real del frontend es **`apps/frontend`**. Mantener esta convención.

---

## 8. Capa de archivos — Cloudflare R2 (R2-only)

Desde la migración Drive→R2 (completada en prod 2026-08-04), **R2 es el único backend de almacenamiento de archivos.** Reglas duras:

1. **Content-addressed:** cada objeto se guarda por su `sha256` en la clave `objects/<sha[0:2]>/<sha[2:4]>/<sha>`. Mismo contenido = mismo objeto (dedup automático por hash).
2. **Se sirve por proxy del CRM con verificación de ACL** (`readFileBytes` en `drive-routes.ts` → `getObject`), **nunca** por URL pública ni presigned pública. La identidad del archivo en el Drive es por **nombre** (mig. `0050` dropeó el índice único de `sha`), no por contenido.
3. **NUNCA borrar un objeto R2 compartido por `sha`.** El borrado permanente (Fase B2, `drive_files_purgados`) solo elimina un objeto si es **huérfano** (0 refs en `drive_files` cualquier ciclo AND 0 en `uploads_r2_backup`), re-verificando justo antes del `DELETE`. Ciclo de vida y guardrail: [DISENO-DRIVE-CICLO-ARCHIVOS.md](DISENO-DRIVE-CICLO-ARCHIVOS.md). El loop de GC destructivo va detrás de env **`DRIVE_GC_ENABLED`, default OFF**.
4. **R2 no tiene versionado.** Para no sobrescribir al subir se usa `If-None-Match: *` (respuesta `412` = ya existe → se reutiliza). Infra/restricciones en [HANDOFF-R2-CLOUDFLARE.md](HANDOFF-R2-CLOUDFLARE.md).
5. **Credenciales R2** solo en `apps/api/.env` (gitignored), leídas vía `process.env` / `loadR2Creds`. Bucket por entorno: `crm-tadi-prod` (prod) / `crm-tadi-staging` (staging). Los scripts de datos toman `--prod` para conmutar bucket+BD con **guard estricto** (`current_database()` y `bucket` esperados).
6. **GHL quedó retirado del almacenamiento/servido:** `ghl_url` es metadata/respaldo legacy que ya no se lee; `local_path` es fallback de disco de emergencia. GHL sigue solo para el sync de contactos.

### 8.1 · Prefijos del bucket, y qué es original y qué derivada

| Prefijo | Qué es | ¿Se puede regenerar? |
|---|---|---|
| `objects/<sha[0:2]>/<sha[2:4]>/<sha>` | **El archivo original.** Lo que subió una persona | ❌ **Nunca.** Es el dato |
| `thumbs/<sha256>/320.jpg` | **Miniatura derivada** (~320 px, JPEG q72) para la galería | ✅ Sí, bajo demanda |

Sobre `thumbs/` (2026-08-19):

- **Lo genera `GET /api/drive/files/:id/thumb`**, bajo demanda y nunca por lotes. `drive_files`
  tiene ~189.000 filas: **no hay backfill** ni lo habrá.
- 🔴 **JAMÁS toca `objects/`.** El original se lee para derivar y no se escribe nunca. Una
  miniatura que pudiera pisar un documento sería una forma de perder datos disfrazada de caché.
- **Content-addressed igual que el original**, así que hereda el dedup: el mismo archivo en dos
  carpetas comparte una sola miniatura.
- 🔴 **Sin `sha256` NO se cachea.** `drive_files.sha256` es TEXT **NULLABLE** (mig. `0025`): hay
  filas antiguas sin hash. **No se compone una clave con el `id`, el nombre ni el `r2_key`.** La
  clave significa *"la miniatura DE ESTE CONTENIDO"*; una clave basada en otra cosa rompe esa
  promesa, y **una clave de caché equivocada sirve la miniatura de otro documento** — en un CRM de
  inmigración, el pasaporte de otra persona. Sin hash se genera al vuelo y se sirve sin guardar.
- **Es purgable.** A diferencia de `objects/`, borrar un objeto de `thumbs/` no pierde nada: se
  vuelve a generar en la siguiente visita. Es la única parte del bucket de la que eso es cierto.
  (§0 protege datos; una derivada regenerable no lo es. Aun así, no hay ninguna herramienta que lo
  borre y no hace falta ninguna.)
- **La ACL es la misma que la de `/raw`** (`canAccessFolder(u, f.folder_id, "read")`). Una
  miniatura es el contenido del archivo, más pequeño: si su comprobación fuera más laxa, sería una
  puerta trasera a documentos no compartidos — y una que nadie vigila, porque *"solo es una imagen"*.

### 8.2 · 🔴 Dependencia de SISTEMA: `poppler-utils`

La página 1 de un PDF se rasteriza con **`pdftoppm`**, del paquete **`poppler-utils`** (24.02 en el
VPS). **No está en el repositorio**: no lo instala `pnpm install` ni lo trae el deploy. Es lo
primero que faltará el día que se levante una máquina nueva.

```bash
# Comprobarlo en un servidor:  (si no imprime versión, no está)
pdftoppm -v
# Instalarlo en Debian/Ubuntu:
apt-get install -y poppler-utils
```

El código **degrada a 404 y la galería pinta el icono**: `rasterizarPdf` captura el `ENOENT` y
devuelve `null`, nunca lanza. Que falte poppler tiene que costar miniaturas, no la API.

⚠️ **`sharp`, en cambio, sí es dependencia npm — y nativa.** Va en `apps/api`, y por eso tiene que
estar en **las DOS listas** de `pnpm-workspace.yaml` (`allowBuilds` y `onlyBuiltDependencies`):
pnpm bloquea el script de instalación de todo lo que no esté ahí, así que sin esas entradas **el
despliegue sale VERDE y la API falla en la primera petición**. Es el fallo más caro posible: el que
no aparece al desplegar.

---

## 9. Pruebas automatizadas

> Sección nueva (2026-08-10). El proyecto no tenía pruebas: se estrena con la suite del **motor de
> fusión de contactos y su cola de GHL**, que es lo único que no se puede validar a mano en staging.
> Todo lo que se añada a partir de ahora sigue estas reglas.
>
> **Ampliada el 2026-08-19: ya son DOS suites.** `apps/frontend` tenía funciones de fecha con husos
> y bisiestos y **ningún sitio donde probarlas**, así que cada entrega se cerraba declarando la
> excepción. Se monta su runner (FASE 1: **solo lógica pura de `src/lib/`**). Lo que sigue vale para
> las dos salvo donde se diga; las reglas §9.3, §9.4 y §9.5 **no cambian y aplican a ambas**.

### 9.1 Dónde viven y cómo se corren

**Runner: Vitest en los dos paquetes, y la MISMA versión** (`^4.1.10`). Dos versiones del mismo
runner en un monorepo es pedir que un día los tests pasen en un paquete y no en el otro por un
cambio del propio runner, y que se pierda medio día buscándolo en el código.

| | `apps/api` | `apps/frontend` |
|---|---|---|
| Qué prueba | Motor de fusión, cola de GHL, permisos, acciones masivas… | **Solo lógica pura de `src/lib/`** |
| Base de datos | **Sí**, desechable y con guard (§9.2) | **No**, y no debe hacer falta |
| `environment` | por defecto | **`node`, explícito** — no hay DOM |
| Tests en | `apps/api/tests/` | `apps/frontend/tests/` |

⚠️ **La suite del frontend está en FASE 1: nada de pruebas de componente.** No hay `jsdom`,
`happy-dom` ni `@testing-library/*`, y `environment: "node"` está escrito a mano en
`vitest.config.ts` para que se vea. Montar la FASE 2 es una decisión propia, con su entrega: si
aparece un `jsdom` de rondón, esta suite deja de ser lo que se autorizó.

#### `apps/api`

- **Runner: Vitest**, como `devDependency` de `apps/api`.
- Los tests viven en **`apps/api/tests/`**, con extensión `.test.ts`. **Fuera de `src/`**, igual que
  `apps/api/scripts/`: el `tsconfig.json` de producción hace `include: ["src/**/*"]`, así que **no
  entran al build sin tocarlo**. 🔴 **No se mete `tests/` en el tsconfig de producción** — irían a
  `dist/` y viajarían al servidor. El typecheck de la suite va en `apps/api/tsconfig.tests.json`.
- Comandos:
  - `pnpm --filter @crm-tadi/api test` — una pasada (`vitest run`).
  - `pnpm --filter @crm-tadi/api test:watch` — modo vigilancia mientras se programa.
  - `pnpm --filter @crm-tadi/api typecheck:tests` — typecheck de la suite.
- El reporter es **`verbose`** a propósito: el reporte de una entrega es la **salida literal**, y un
  "2 passed" no dice qué se probó.

#### `apps/frontend`

- Los tests viven en **`apps/frontend/tests/`**, con extensión `.test.ts`. Importan con el alias
  `@/lib/…` igual que el resto del código; el alias se resuelve en `vitest.config.ts` con
  `node:path`, **sin instalar `vite-tsconfig-paths`** — una dependencia menos para replicar tres
  líneas.
- Comandos, **con los mismos nombres que la API** para que se aprendan una vez:
  - `pnpm --filter @crm-tadi/frontend test`
  - `pnpm --filter @crm-tadi/frontend test:watch`
  - `pnpm --filter @crm-tadi/frontend typecheck:tests`
- Reporter **`verbose`**, por el mismo motivo que la API.
- Los tests importan `describe`/`it`/`expect` **desde `"vitest"`, explícitamente**. Nada de
  `globals`, y **`"vitest/globals"` no entra en los `types` del tsconfig de producción**: el tipado
  de la aplicación no tiene por qué saber que existe un runner.

##### 🔴 Los dos `tsconfig`, y por qué el motivo del frontend NO es el de la API

Los dos paquetes acaban con un `tsconfig.tests.json` aparte, pero **por razones distintas**, y
confundirlas lleva a “arreglarlo” en el sitio equivocado:

| | Qué pasaría si `tests/` entrara en el tsconfig de producción |
|---|---|
| `apps/api` | Los tests **se compilarían a `dist/` y viajarían al servidor**, y además rompería `rootDir` |
| `apps/frontend` | 🔴 **Un error de tipos en un TEST tumbaría `next build`, y con él el despliegue** |

El del frontend es el que muerde. Su `tsconfig.json` hace `include: ["**/*.ts", "**/*.tsx"]` —todo
el paquete, no solo `src/`—, y `next.config.mjs` desactiva ESLint en el build
(`eslint.ignoreDuringBuilds: true`) pero **no** los errores de TypeScript: no hay
`typescript.ignoreBuildErrors`. Así que:

- `apps/frontend/tsconfig.json` lleva **`"exclude": ["node_modules", "tests"]`**.
- `apps/frontend/tsconfig.tests.json` hereda de él y **vuelve a declarar `exclude`**.
  ⚠️ Esto último no es adorno: **`exclude` se hereda y gana sobre el `include` del hijo**. Sin
  redeclararlo, el typecheck de la suite excluye justo lo que viene a comprobar y **devuelve EXIT 0
  con un error de tipos delante**. Se descubrió metiendo un error a propósito, que es la única
  forma de saber que una comprobación comprueba algo.

🔴 **Nunca se relaja el tsconfig de producción para que la suite compile.** Una red de seguridad que
estorba al despliegue es una red que alguien acaba quitando.

#### 🔴 Pruebas de RUTA — qué cubren y qué NO (2026-08-19)

Hasta hoy las pruebas de la API ejercitaban **funciones y SQL, nunca una ruta**, así que la ACL y
los códigos de estado —donde vive lo más caro— se quedaban fuera. `supertest` monta un Express
mínimo (`tests/setup/app-de-pruebas.ts`) con `cookieParser`, `express.json()` y **solo los routers
que se prueban**, y la sesión se fabrica con `signToken` sin pasar por el login.

| | |
|---|---|
| **Sí cubren** | Que una petición real llegue al handler: la ACL, el código de estado y **el cuerpo** de la respuesta |
| **NO cubren** | `helmet`, `cors`, `express-async-errors` y el manejador de errores final, el servidor HTTP, socket.io, los cron y los bucles de fondo |

🔴 **Un verde aquí dice que la RUTA se comporta bien. No dice que la aplicación arranque**, ni que
las cabeceras de seguridad salgan puestas, ni que un error no capturado acabe en un 500 en vez de
tumbar el proceso. Está escrito también en la cabecera del fichero de setup, porque es la
suposición que alguien va a hacer dentro de un año leyendo «pruebas de ruta».

⚠️ **`src/index.ts` NO se importa nunca en una prueba.** Son 2.399 líneas y **al importarse arranca
los bucles de GHL** (`startGhlSyncLoop`, `startGhlPendingContactsLoop`, `startGhlMergeQueueLoop`)
además de crear el servidor: una prueba levantaría procesos de fondo y **tocaría la red** contra un
sistema que no tiene entorno de pruebas. Las rutas se registran con funciones sueltas y exportadas
(`registerDriveRoutes`, `registerContactosRoutes`, `registerDetailRoutes`), y se montan una a una.

**Son tres pruebas, no cobertura**, y a propósito: el 403 de `/thumb`, el 403 de los datos
sensibles y la asimetría del alta frente a la edición. Ampliar el alcance es una entrega con su
propio motivo, no algo que crece solo.

### 9.2 🔴 La base desechable y su guard

> **Solo `apps/api`.** La suite del frontend no toca base ni debe necesitarla: si algún día una
> prueba de `src/lib/` pidiera base, es señal de que esa lógica no está donde le toca.

Lo que se prueba aquí hace **SQL real y descubrimiento dinámico de FKs**: con todo simulado no se
probaría nada de lo que importa. Así que la suite necesita base — y **nunca es la de desarrollo**.

- La suite **crea su propia base local, `crm_test_fusion`**, le carga el esquema con
  `pg_dump --schema-only` de la base local, siembra fixtures sintéticos y **la destruye al terminar**.
- **Por qué el dump y no `pnpm migrate`:** la base se adoptó con `baseline 0029`, así que las
  migraciones `0001`–`0028` **no** reconstruyen el esquema desde cero. Un `pnpm migrate` contra una
  base vacía ni siquiera crearía `contactos_cache`.
- **Esto NO contradice §0.** Lo que se destruye es un **andamio** creado por la propia suite, que
  jamás contiene datos de negocio. §0 protege datos, no ficheros temporales. Está escrito como
  comentario en `apps/api/tests/setup/test-db.ts` para que dentro de seis meses nadie lea ese
  `DROP DATABASE` y le dé un vuelco el corazón.
- **El guard es obligatorio y falla ruidosamente**, con tres condiciones: (a) el host es
  `localhost`/`127.0.0.1`; (b) el nombre de la base es **exactamente** `crm_test_fusion`; (c) ese
  nombre es una **constante del módulo**, no se compone de ninguna variable, así que una env mal
  puesta no puede convertirlo en `crm_staging` ni en `postgres`. **El guard tiene su propio fichero
  de pruebas** (`tests/guard-base.test.ts`): que no se puede tocar otra base es una afirmación, y
  las afirmaciones se comprueban.
- Única excepción, y no puede no serla: `CREATE DATABASE` no se puede emitir desde dentro de la base
  que crea. Hay una conexión de mantenimiento a `postgres` **local** por la que solo pasan dos
  sentencias, las dos nombrando la constante.

### 9.3 Fixtures y red

- **Fixtures sintéticos siempre, en las DOS suites.** Ni un nombre, ni un email, ni un teléfono
  sale de la base de negocio. En la API se crean en `apps/api/tests/fixtures.ts`; en el frontend
  van en el propio fichero de prueba, que es lógica pura y no necesita más.
- 🔴 **Cero peticiones de red en cualquier test.** Todo integrador externo se simula con `vi.mock`
  sobre su módulo. Para GHL esto no es higiene: `eliminarContactoEnGhl()` es la **única operación
  destructiva del proyecto contra un tercero**, GHL **no tiene entorno de pruebas** (es un único
  sistema, el real) y un contacto borrado allá no se puede desborrar.
- Si para poder simular algo hiciera falta cambiar el código de producción, **se para y se pregunta**.

### 9.4 🔴 Un test que falla es un hallazgo, no un test que hay que arreglar

**No se ajusta el código de producción para que un test pase, ni se silencia el test.** Se reporta
con el comportamiento observado frente al esperado y decide un humano. Un test que se adapta al
defecto no sirve para nada: convierte un fallo en documentación de que el fallo es correcto.

### 9.5 Todo cambio trae sus pruebas

> 🔴 **CAMBIO DE CONDUCTA — 2026-08-19. Desde hoy esto aplica TAMBIÉN al frontend.**
> Hasta ahora, todo cambio de lógica en `apps/frontend` se cerraba **declarando la excepción**:
> no había runner y se decía en el reporte. Ya lo hay, así que **la excepción se acaba**: todo
> cambio de lógica en **`apps/frontend/src/lib/`** entra con sus pruebas en la misma entrega, y
> **la suite verde es puerta para promover a `dev`**, al lado del typecheck y del lint. Lo que
> sigue sin runner —componentes, hooks, pantallas— mantiene la excepción **declarada**, y deja de
> tenerla el día que se monte la FASE 2.

- 🔴 **TODA ENTREGA TRAE PRUEBAS EN LOS DOS PAQUETES.** Regla de Juan, 2026-08-19: *«a partir de
  este momento siempre tanto backend como frontend deben tener sus test»*. Si un cambio toca los
  dos lados, trae pruebas de los dos; si toca uno, del que toca. **Lo que no vale es cerrar una
  entrega diciendo que no había dónde probar** — ya lo hay en ambos.
- **Un cambio de comportamiento entra con sus pruebas en la MISMA entrega.** Un arreglo trae el test
  que reproduce el fallo; una funcionalidad, los que cubren su contrato y sus bordes. Sin pruebas la
  entrega está **incompleta**, exactamente igual que una migración sin su entrada en
  `BASE-DE-DATOS.md` (§1.12).
- **Excepciones, y se declaran:** documentación, estilo sin efecto observable y configuración. Si
  algo no es razonablemente testeable, **se dice por qué en el reporte**; no se omite en silencio.
- 🔴 **Las suites tienen que estar VERDES para promover a `dev`** —las dos, la que toque el cambio
  y la otra—. Es una puerta, al lado del typecheck y del lint. Tocar un paquete y no correr la
  suite del otro es cómo se rompe lo que ya funcionaba sin enterarse.
- **Cómo convive esto con §9.4:** un test en rojo es un hallazgo, así que no se silencia ni se
  acomoda el código para que pase — **se arregla**. Si se decide conscientemente **aplazar** el
  arreglo, el test se marca como **defecto abierto** con la referencia del hallazgo, para que el
  rojo nunca se normalice. Un rojo permanente que todo el mundo ignora es peor que no tener
  pruebas: da sensación de cobertura sin darla.
- **El reporte de cada entrega incluye la salida literal de la suite, sin recortar.** Igual que el
  diff crudo: lo que se audita es la salida, no el resumen de quien la corrió.

---

## 10. Solicitudes y aprobaciones

> **Por qué existe esta sección.** Llegamos a tener **cuatro tablas de solicitudes con tres
> convenciones distintas**, y las vistas tapaban la divergencia traduciendo el estado a la salida.
> La única razón de que hubiera tres convenciones es que **nunca se escribió cuál era la buena**.
> Ésta es. Lo que no se ajuste a ella es deuda a corregir, no un patrón a imitar.

Un flujo de solicitud es: alguien **pide** algo que no puede hacer solo, otro con permiso lo
**aprueba o lo rechaza**, y el sistema lo **ejecuta**. Aparece cada vez que una acción es
irreversible, cara o sensible.

### 10.1 · La receta, en cinco pasos

1. **El valor del ENUM**, en su propia migración: `ALTER TYPE crm_tadi.tipo_solicitud ADD VALUE IF NOT EXISTS '<dominio>_<accion>'`. Prefijo de dominio siempre (`oportunidad_`, `contacto_`). **Va sola**: Postgres no deja usar un valor de ENUM en la transacción que lo añade, y el runner corre cada migración en la suya.
2. **La tabla**, con la forma canónica de §10.2 — los cinco CHECK y el trigger incluidos.
3. **El permiso**: `aprobar_<valor del ENUM>` (§2.2). **No se crea en una migración de infraestructura: nace con su funcionalidad.**
4. **La vista del dominio**: una rama `UNION ALL` más en `vi_solicitudes_<dominio>`, con el shape canónico de §10.4. Si el dominio no tenía vista, se crea con **ese mismo shape**.
5. **La ejecución**: CAS (`UPDATE … WHERE estado='aprobada' RETURNING *`) → hacer el trabajo → `estado='ejecutada'` con `ejecutada_at` y `resultado`. Si falla, la fila **se queda en `aprobada`** con el error en `resultado` y se reintenta.
6. **La ruta**: los tipos nuevos usan **`POST /api/solicitudes/:id/(aprobar|rechazar)`**, que deduce del `tipo` de la fila qué permiso exigir (§10.3). Las tres familias antiguas tienen una ruta por tipo y una tabla de equivalencias en el frontend — eso es lo que no se replica.

🔴 **Aprobar no es un atajo.** La ejecución pasa **por el mismo código** que la acción directa:
validaciones, efectos secundarios y auditoría. Si el camino de aprobación se los saltara, tendríamos
dos semánticas para la misma acción y la aprobada sería la que no dispara nada.

### 10.2 · La forma canónica de la tabla

| Columna | Regla |
|---|---|
| `id` | `uuid` PK, `DEFAULT gen_random_uuid()` |
| `tipo` | `crm_tadi.tipo_solicitud NOT NULL` + CHECK que lo acota a su familia. **`DEFAULT` sólo si la familia tiene un único valor**; si tiene varios, obligar a decirlo |
| `solicitante_id` | `uuid NOT NULL` → `users`, **`ON DELETE NO ACTION`, explícito**: es una firma |
| *(payload)* | Lo propio del tipo. `jsonb` si es una selección; columnas si son escalares |
| `motivo` | `text` |
| `estado` | `text NOT NULL DEFAULT 'pendiente'`, CHECK ∈ **pendiente · aprobada · rechazada · ejecutada** |
| `aprobador_id` | `uuid` → `users`, `ON DELETE NO ACTION`, explícito |
| `motivo_rechazo` | `text` |
| `resultado` | `jsonb` — qué pasó al ejecutar, incluido el error si falló |
| `created_at` · `resolved_at` · `ejecutada_at` | `timestamptz` |

**Estados en femenino** (`aprobada`), nunca en masculino. **Nombres de columna exactamente ésos**:
`solicitado_por`, `revisado_at` o `revision_comentario` son las variantes que costaron esta entrega.

**Los cinco CHECK**, que son parte de la forma y no un extra:

```sql
CHECK (estado IN ('pendiente','aprobada','rechazada','ejecutada'))
CHECK (tipo = '<su valor>'::crm_tadi.tipo_solicitud)             -- o IN (…) si la familia tiene varios
CHECK (estado = 'pendiente' OR (aprobador_id IS NOT NULL AND resolved_at IS NOT NULL))
CHECK (estado <> 'rechazada' OR motivo_rechazo IS NOT NULL)
CHECK (estado <> 'ejecutada' OR (ejecutada_at IS NOT NULL AND resultado IS NOT NULL))
```

**Y el trigger anti-reapertura**, que es compartido — una función para las cuatro tablas:

```sql
CREATE TRIGGER trg_<tabla>_no_regresa BEFORE UPDATE ON crm_tadi.<tabla>
  FOR EACH ROW EXECUTE FUNCTION crm_tadi.solicitud_no_regresa();
```

Sin él, un `UPDATE` suelto devuelve a `pendiente` una solicitud ya resuelta y se vuelve a ejecutar.
Terminales son **`rechazada` y `ejecutada`**; `aprobada` **no** lo es, porque de ahí se sale hacia
`ejecutada`.

**Por qué cuatro estados y no tres:** la ejecución puede fallar después de aprobar. Con tres habría
que elegir entre marcarla aprobada sin haber hecho nada o perder la aprobación. Con cuatro se queda
en `aprobada` con el error en `resultado` y se reintenta: **una aprobación humana no se tira por un
fallo de red.**

**Consecuencia del CHECK de rechazo, y es deliberada:** *rechazar sin motivo deja de ser posible.*
La ruta valida y devuelve **400** con un mensaje —no un 500 del CHECK— y el diálogo del frontend no
deja pulsar con el campo vacío. A quien le rechazan una solicitud se le dice por qué.

### 10.3 · El permiso sale del tipo

`aprobar_<valor del ENUM>`. Con el `tipo` de la fila delante, el código que aprueba ya sabe qué
exigir: `puede(userId, 'aprobar_' + solicitud.tipo)`. **Sin `switch`, sin tabla de
correspondencias, y un tipo nuevo no obliga a tocar el aprobador.**

### 10.4 · La vista: una por DOMINIO, no por tipo

**Una vista por dominio** (`vi_solicitudes_oportunidades`, `vi_solicitudes_contactos`), con una rama
`UNION ALL` por tipo. **No una por tipo**: la bandeja lee de una vista por dominio, y fragmentarlas
la obligaría a leer de N y a ramificar por familia.

Las **15 columnas** del shape canónico, en este orden y con estos tipos:

```text
id · tipo · oportunidad_id · pago_id · solicitante_id · detalle · motivo · estado ·
aprobador_id · motivo_rechazo · created_at · resolved_at · ejecutada_at ·
datos_antes · comprobante_propuesto
```

- Lo que no aplica al dominio va **`NULL` con su cast explícito** (`NULL::uuid AS pago_id`).
- Lo propio del tipo viaja en **`detalle` (jsonb)**.
- `tipo` sale de **la columna** de la tabla, no de un literal escrito en la vista: así un tipo mal puesto lo caza el CHECK y no la lectura de nadie.
- Las vistas de dos dominios distintos tienen que ser **intercambiables**: `EXCEPT` en los dos sentidos sobre `(ordinal_position, column_name, data_type)` da vacío. Está probado en `apps/api/tests/solicitudes-estandar.test.ts`.

### 10.5 · 🔴 Las vistas no traducen

**Una vista que reescribe el estado real está mintiendo sobre sus datos.** Nada de:

```sql
CASE estado WHEN 'ejecutada' THEN 'aprobada' ELSE estado END   -- ❌ oculta información real
CASE estado WHEN 'aprobado'  THEN 'aprobada' … END             -- ❌ tapa que el origen diverge
```

El primero impedía distinguir *"aprobada, pendiente de ejecutar"* de *"ya ejecutada"*, que en una
acción masiva es justo lo que hay que saber. El segundo reconstruía a la salida una forma común que
**no se estaba respetando en el origen** — y cada tabla que divergía añadía otro `CASE`.

**La forma común se respeta en la tabla. La vista sólo une.** Si la interfaz no entiende un estado,
lo que se cambia es la interfaz.

### 10.6 · 🔴 Una solicitud sobre una selección tiene que poder enseñar QUÉ afecta

**No es acabado: es lo que separa aprobar de firmar.** Una bandeja que dice *"2 oportunidades →
nuevo"* le pide a alguien que autorice un cambio sobre casos concretos **a ciegas**, y su nombre
queda en `aprobador_id`. Una aprobación sin visibilidad no es una aprobación: es un sello de goma, y
toda esta arquitectura existe para que alguien decida con criterio.

Toda solicitud cuyo payload sea **una selección** expone un detalle —`GET /api/solicitudes/:id/detalle`—
con, por cada elemento:

- **Lo que lo hace reconocible**, y lo mismo que vio quien la armó: para que los dos miren lo mismo.
- **El estado de HOY**, leído en el momento, y **lo que se pidió** para él.
- 🔴 **El estado de ORIGEN, guardado al pedirlo — no reconstruido después.** La selección registra de qué estado partía cada elemento, igual que registra cuántos había. Así, saber si algo cambió es **comparar dos valores**.
  Reconstruirlo a posteriori desde `auditoria` *funciona*, pero depende de que **todo** camino que modifica ese estado deje rastro, y basta un `UPDATE` que se olvide de auditar —o un arreglo a mano en la base— para que el detalle diga "sin discrepancias" cuando las hay: **el fallo exacto que la función viene a evitar**, y encima silencioso. La reconstrucción se queda como **vía de respaldo** para lo escrito antes de la regla, con un comentario que diga que lo es.
  ⚠️ **Cambiar la forma de lo guardado no obliga a migrar lo viejo.** Los lectores aguantan las dos formas y las filas antiguas se dejan morir al resolverse. Reescribirles el dato sería grabar una conjetura —la misma que hace el respaldo— pero ya sin la marca de que es una conjetura.
- 🔴 **Las discrepancias, marcadas explícitamente.** Entre pedir y aprobar pasan horas: alguien pudo
  mover el registro, dejarlo sin un campo obligatorio o borrarlo. **Lo que se omite en silencio es
  lo que acaba ejecutándose sin que nadie lo mirara.** Como mínimo: *ya no está donde estaba al
  pedirse* · *ya está en el destino, no hay nada que hacer* · *no existe* · *no pasaría la
  validación*.
- **Los efectos, recalculados ahora**, no los del momento de pedirla — quien aprueba es quien
  ejecuta. Se reutiliza el cálculo de la previa; no se duplica.

**Y el resumen agregado va también en la confirmación de aprobar**, con su número: *"1 de las 2 ya
no está en la etapa que tenía cuando se pidió."*

**Quién lo ve:** quien puede aprobar ese tipo (`aprobar_<tipo>`, §10.3) **o quien la pidió**. Nadie
más — es una lista con nombres de clientes.

⚠️ **Genérico por tipo, no por familia.** Un registro `tipo → { tabla, cómo se enriquece su
selección }`: añadir un tipo es sumar una entrada, no reescribir el endpoint. Las solicitudes de
contactos que vienen —archivar, exportar— son también sobre una selección y entran por ahí.

### 10.7 · La confirmación de una acción masiva

Una acción en lote tiene que confirmarse enseñando **lo que va a pasar**, no preguntando "¿seguro?".
Tres piezas, y las tres importan:

1. **Resumen agregado**, no la lista entera: *"**12** de **Nuevo** pasan a **Ganado**"*, una línea
   por transición. Ciento cuarenta filas no se leen; cuatro líneas sí.
2. 🔴 **Los efectos colaterales, con los números REALES y contados en vivo.** Cambiar de etapa
   dispara automatizaciones, reparte puntos y escribe fechas, y **nada de eso se ve en pantalla**:
   quien pulsa cree que ordena tarjetas. Los números se piden al servidor en el momento (un endpoint
   de *previa* que no escribe nada), nunca se escriben a mano en el texto — un "se crearán tareas"
   genérico envejece mal, y un número fijo miente el día que alguien configure una automatización.
   **Negritas en las cifras y en las consecuencias**: es lo que separa un aviso que se lee de uno
   que se acepta sin mirar.
3. **Palabra escrita** cuando el efecto es inmediato e irreversible: el usuario teclea una palabra
   exacta (`CAMBIAR`) y el botón no se habilita hasta que coincide **carácter a carácter** — sin
   `trim()` ni mayúsculas automáticas, o el guardarraíl se lo salta el navegador.

🔴 **Y la regla que menos se ve venir: la palabra NO se pide cuando la acción no aplica nada.** Si al
confirmar lo que se crea es una *solicitud*, se pide sin palabra escrita y con el botón diciendo
"Enviar solicitud". Pedirla para algo que no cambia nada **enseña a teclearla sin leer**, y erosiona
el guardarraíl justo donde hace falta — incluido el momento en que un aprobador ejecuta de verdad la
solicitud de otro.

**El botón se le ofrece a todo el mundo.** No se esconde a quien no tiene el permiso: la barrera está
en el backend, y quien no pueda aplicar verá en la confirmación que lo suyo crea una solicitud.
Esconder el botón es decidir en el navegador quién puede qué (§4.2).

**Y la operación se deja deshacer**: una fila de `auditoria` de la operación con los ids y su estado
previo, además de la fila por registro que ya deja la acción individual. Sin ella, deshacer es
adivinar por fecha y arrastra lo que otra persona hiciera en ese minuto.

---

## Documentos relacionados
- [METODOLOGIA-DE-TRABAJO.md](METODOLOGIA-DE-TRABAJO.md) — **cómo se organiza el trabajo** (lectura obligatoria al abrir sesión): reparto de roles, ciclo tarea→plan→prompt→código→auditoría→promoción, mapa de los tres entornos y checklist de auditoría previo al `push`. Este contrato dice *cómo se escribe* el código; aquél, *cómo se trabaja*.
- [crm-tadi-documentacion-general.md](crm-tadi-documentacion-general.md) — **referencia/contexto** del sistema (arquitectura, infra VPS, topología de DB, incidentes). Este contrato extrae de ahí las reglas; el general da el "cómo es".
- [BASE-DE-DATOS.md](BASE-DE-DATOS.md) — **referencia real del esquema** (71 tablas, columnas y FKs, con foco en el flujo crítico del contacto). **De lectura obligatoria antes de tocar la BD** y de actualización obligatoria al cambiarla (regla §1.12).
- [CHECKPOINT-MAESTRO.md](CHECKPOINT-MAESTRO.md) — historial maestro de saneamiento + migración de datos (doc de arranque para retomar contexto).
- [CHECKPOINT-OPORTUNIDADES.md](CHECKPOINT-OPORTUNIDADES.md) — **doc de arranque del módulo OPORTUNIDADES** (tablero, filtrado y conteos en servidor, paginación por columna, vista de lista, cambio masivo de etapa con solicitud). Incluye el diagnóstico de por qué el tablero contaba sobre una muestra, y los requisitos pendientes de la exportación que pidió el equipo.
- [CHECKPOINT-CONTACTOS.md](CHECKPOINT-CONTACTOS.md) — **doc de arranque del módulo CONTACTOS** (archivado lógico, paginación/selección, fusión de duplicados, purga). Estado, traza por olas, decisiones cerradas y próximos pasos. Su especificación viva es [PROMPT-CONTACTOS-CLAUDECODE.md](PROMPT-CONTACTOS-CLAUDECODE.md).
- [RUNBOOK-PROD.md](RUNBOOK-PROD.md) — registro de la corrida Drive→R2 a producción (§0-quater: resultados reales).
- [DISENO-DRIVE-CICLO-ARCHIVOS.md](DISENO-DRIVE-CICLO-ARCHIVOS.md) — ciclo de vida del Drive (naming `(N)`, papelera 2 niveles, cuarentena, GC/borrado permanente).

## Registro de cambios del contrato
- **2026-08-25** — **Nueva §4.9-bis: quien se posiciona a sí mismo se trae su propio marco.**
  Generaliza la §4.9 de `fixed` a `absolute`. Sale de que `MiniaturaArchivo` se pintaba con
  `absolute inset-0` y **avisaba en su cabecera** de que el contenedor necesitaba `relative`: los
  tres paneles nuevos del Drive se lo saltaron igual y un `pikachu.png` compartido ocupó la
  pantalla entera de «Compartidos conmigo». La regla fija que la garantía va DENTRO del componente
  —`relative h-full w-full`—, que a quien llama solo se le pide una caja con tamaño, y que un
  comentario que avisa no sustituye a una garantía. Queda dicho además que la suite de hoy no
  puede cazar esto: FASE 1 no tiene DOM. Sin migración.
- **2026-08-21** — **Nueva §4.9: una capa a pantalla completa se monta en `<body>`.** Sale de un defecto del chat: abrir un PDF adjunto desde el chat de una tarea pintaba el visor **dentro de la burbuja del mensaje**, 240 px de ancho, porque `position: fixed` deja de medirse contra la ventana cuando un ancestro tiene `backdrop-filter` — y las burbujas del chat son de cristal. El repositorio **ya contenía el arreglo** aplicado dos veces en ese mismo chat (`MessageActions`, `ChatComposer` montan con `createPortal`), pero nadie lo había escrito, así que el siguiente volvió a caer. La regla fija que el portal va en el componente que promete pantalla completa y no en quien lo llama, la guarda de montaje para el render del servidor, que portar **no** cambia la propagación de eventos de React, y que el `z-index` cae entre dos límites explícitos —por encima de lo que la abre, por debajo de una llamada entrante—, con el mapa de capas del proyecto escrito. Nuevo guion `docs/PRUEBAS-STAGING-VISOR-ARCHIVOS.md`: el visor lo comparten cinco pantallas de tres módulos.
- **2026-08-20** — **Nueva §4.8: quien clasifica y quien escribe comparten las fronteras.** Sale de un defecto del tablero de Tareas: la vista «Por fecha límite» clasificaba en franjas con su propia aritmética de semanas y, al darle arrastre, se escribió **aparte** qué fecha pone cada columna. «Esta semana» → viernes 18:00 suena bien, pero la franja acaba en **domingo**: el viernes esa fecha cae en «Para hoy» y el sábado y el domingo en **«Atrasado»**. Tres días de cada siete la tarjeta se iba sola a otra columna. La regla exige un solo módulo que publique cortes, clasificador y generador; que el generador se calcule **desde** los cortes y compruebe su propia respuesta; que la invariante se pruebe para **todo el ciclo** y no para el día cómodo; que «no hay hueco» y «quitar el valor» no compartan un `null`; y que **lo que no acepta se vea que no acepta antes de soltar**.
- **2026-08-20** — **Nueva regla en «Flujo de trabajo por tareas»: el trabajo se organiza y se cierra
  MÓDULO A MÓDULO.** Una tanda de observaciones se agrupa primero por módulo —no por dificultad ni
  por tipo de trabajo— y no se empieza el siguiente hasta cerrar el que se tiene entre manos. Sale
  de que ese mismo día Juan entregó ocho observaciones **ya ordenadas por módulo** y el plan las
  reagrupó por tipo de trabajo (migración, componente, renombrado): una sola tanda acababa saltando
  entre Contactos, Tareas y Drive, obligando a recargar el contexto de cada módulo varias veces,
  dispersando la validación en staging y dejando **imposible decir «este módulo está cerrado»**. Una
  excepción se propone y se pregunta; no se aplica por iniciativa propia.
- **2026-08-19** — **§9 gana las pruebas de RUTA (`supertest`) y la regla de que TODA ENTREGA TRAE
  PRUEBAS EN LOS DOS PAQUETES.** Al ir a cumplir esa regla apareció que en el backend no se podía:
  las 377 pruebas ejercitaban **funciones y SQL, nunca una ruta**, así que la ACL y los códigos de
  estado —lo más caro que tiene el proyecto— dependían de que alguien se acordara de comprobarlos
  con `curl`. Se montan tres, y **tres es el alcance**: el 403 de `/thumb` sobre el drive personal
  ajeno, el 403 de los datos sensibles **comprobando también el cuerpo** (un 403 que trae el dato
  en el JSON sigue siendo una fuga), y la **asimetría** entre exigir la fecha de nacimiento al
  crear y no exigirla al editar. Queda escrito **qué NO cubren** —helmet, cors, el manejador de
  errores, el arranque— porque «pruebas de ruta» se lee fácilmente como «la app está probada». Y
  queda escrito por qué **`src/index.ts` no se importa jamás en una prueba**: al importarse arranca
  los bucles de GHL y tocaría la red. Las tres **se vieron en rojo** rompiendo a propósito la línea
  que protegen antes de darlas por buenas. Sin migración y sin tocar `src/`; solo `supertest` como
  devDependency y el lockfile.
- **2026-08-19** — **Nuevas §8.1 y §8.2: el bucket deja de ser solo `objects/`.** Las miniaturas de
  la galería de documentos estrenan el prefijo **`thumbs/<sha256>/320.jpg`**, y se documenta porque
  **un prefijo nuevo que no está escrito es exactamente lo que dentro de seis meses nadie sabe si
  se puede purgar**. §8.1 fija qué es original y qué derivada, que `thumbs/` **jamás toca**
  `objects/`, que se genera bajo demanda y **sin backfill** (~189.000 filas), y la regla que
  sostiene todo: 🔴 **sin `sha256` no se cachea y no se inventa una clave** — la clave significa "la
  miniatura DE ESTE CONTENIDO", y una clave equivocada sirve el documento de otra persona. §8.2
  declara **`poppler-utils` como dependencia de SISTEMA**: `pdftoppm` no lo instala `pnpm`, su
  ausencia degrada a 404 y nunca tumba la API, y se dice cómo comprobarlo e instalarlo. Ahí queda
  también la trampa de `sharp`: es nativa y tiene que estar en **las dos** listas de
  `pnpm-workspace.yaml`, porque si no **el despliegue sale verde y la API falla en la primera
  petición**. Sin migración.
- **2026-08-19** — **§9 pasa a cubrir DOS suites: `apps/frontend` estrena la suya** (Vitest, misma
  versión que la API, FASE 1 **solo lógica pura de `src/lib/`**). 🔴 **Es un cambio de conducta, no
  solo herramienta:** hasta hoy cada cambio de lógica del frontend se cerraba **declarando la
  excepción de §9.5** —no había dónde probar—, y eso ya no vale: entra con sus pruebas, y la suite
  verde es **puerta para promover a `dev`**. Lo motivó tener funciones de fecha con husos y
  bisiestos sin una sola prueba: `edadEnAnios` se entregó con una tabla de casos corrida a mano, y
  esa tabla cambiaba de significado cada día. Ahora el reloj se congela y el caso del cumpleaños se
  prueba de verdad. Se documenta además **por qué los dos `tsconfig.tests.json` existen por razones
  distintas**: en la API `tests/` acabaría en `dist/`; en el frontend **un error de tipos en un test
  tumbaría `next build`**, porque su `include` abarca el paquete entero y Next no ignora los errores
  de TypeScript. Y el detalle que costó una vuelta: **`exclude` se hereda y gana sobre el `include`
  del hijo**, así que el tsconfig de la suite tiene que redeclararlo o no comprueba nada. Sin
  migración; solo `devDependency` y lockfile.
- **2026-08-14** — **Nueva §2.8: corregir un permiso no puede pasar por retirarlo** (la deuda
  declarada pasa de §2.8 a §2.9). Sale de los permisos de buzón compartido: había cómo dar acceso y
  cómo quitarlo, pero **no cómo cambiarlo**, así que bajar a alguien de *leer + enviar* a *solo
  leer* obligaba a borrarle la fila y volver a darle de alta. Eso deja a la persona **sin acceso en
  el hueco** entre las dos operaciones, y fuera del todo si la segunda no llega a ocurrir. La regla
  fija las cuatro piezas: editar es un `UPDATE` sobre la fila que ya está (nunca `DELETE`+`INSERT`),
  la pantalla enseña las dos opciones y no solo la vigente, **un valor de permiso desconocido se
  rechaza en vez de coaccionarse al más seguro** —`permiso === "enviar" ? "enviar" : "ver"` guardaba
  un `"enviarr"` como *solo leer* en silencio— y se devuelve la fila **tal como quedó guardada**, no
  lo que se pidió. `PATCH /api/buzones/:id/acl/:aclId`. Sin migración.
- **2026-08-12** — **Nueva §10.6: una solicitud sobre una selección tiene que poder enseñar QUÉ
  afecta**, y **nueva §4.7: ningún identificador interno en texto de cara al usuario**. Las dos
  salen de probar el cambio masivo de etapa en staging. La primera es la de fondo: la bandeja decía
  *"2 oportunidades → nuevo"* y nada más, así que **quien aprueba lo hacía a ciegas** sobre casos
  concretos mientras su nombre quedaba en `aprobador_id` — una aprobación sin visibilidad es un
  sello de goma. El detalle enseña **el estado de hoy**, marca **explícitamente** lo que ya no cuadra
  con lo que se pidió (se movió, ya está en el destino, no existe, no pasaría la validación) y
  recalcula los efectos, porque entre pedir y aprobar pasan horas. La segunda: el modal decía *"no
  tienes el permiso `cambiar_etapa_masivo`"* y *"se escribirá `fecha_completada`"* — nombres de una
  fila de `user_permisos` y de una columna, que a un vendedor le suenan a avería. `GET
  /api/solicitudes/:id/detalle`, genérico por tipo. Sin migración.
- **2026-08-12** — **Nueva §10.7 (antes §10.6): cómo se confirma una acción masiva**, y §10.1 gana dos reglas (la
  ruta genérica `/api/solicitudes/:id/…` para los tipos nuevos, y que **aprobar no es un atajo**: la
  ejecución pasa por el mismo código que la acción directa). Sale del cambio masivo de etapa, que
  dispara automatizaciones, reparte puntos y escribe fechas **sin que nada de eso se vea en
  pantalla**: quien pulsa cree que ordena tarjetas. La regla fija las tres piezas de la confirmación
  —resumen agregado, efectos con números **contados en vivo**, y palabra escrita— y la que no se ve
  venir: **la palabra NO se pide cuando la acción no aplica nada**, porque teclearla para algo
  inocuo enseña a teclearla sin leer. Más: el botón **no se esconde** a quien no tiene el permiso
  (§4.2), y la operación **se deja deshacer** con una fila de `auditoria` de la operación entera.
  Migración `0069`, permisos `cambiar_etapa_masivo` y `aprobar_oportunidad_etapa` — **sin sembrar**.
- **2026-08-12** — **Un solo estándar para permisos y solicitudes: §2 se completa y nace la §10.**
  Al ir a mirar el esquema real aparecieron tres cosas. (1) `puedeEditarMontoDirecto` —que guarda
  **las tres puertas de aprobación de solicitudes de dinero**— leía el rol del **JWT**, y los tokens
  duran 365 días sin refrescarse: a un admin degradado le duraban los poderes hasta un año, y
  tampoco comprobaba `activo`. Se sustituye por **`puede()`, una sola consulta que exige `activo`**
  (§2.1), y se fija la **convención de nombres de permiso** (§2.2). (2) Había **dos tablas de
  permisos, las dos vacías**: `roles_permisos` (de la `0001`, cero referencias en código) queda
  documentada como **obsoleta** — no se borra (§0), pero no se construye sobre ella. (3) Había
  **cuatro tablas de solicitudes con tres convenciones**, y **sólo una tenía el trigger
  anti-reapertura**: en las otras tres un `UPDATE` suelto devolvía a `pendiente` una solicitud de
  dinero ya resuelta. La nueva **§10** fija la receta de cinco pasos, la forma canónica de tabla
  (cuatro estados, cinco CHECK, trigger compartido), la de vista (**una por dominio, 15 columnas
  idénticas entre dominios**) y la regla que corta el hábito: **las vistas no traducen** — la
  traducción `ejecutada → aprobada` ocultaba información real. Migraciones `0065`–`0068`.
  **Cambio de conducta declarado:** rechazar una solicitud **sin motivo** deja de ser posible.
- **2026-08-10** — **Nueva §9.5: todo cambio trae sus pruebas**, y la suite verde es puerta para
  promover a `dev`, al lado del typecheck y del lint. Incluye cómo convive con §9.4: un rojo se
  arregla, y si se aplaza conscientemente se marca como **defecto abierto** con su hallazgo, para
  que nunca se normalice. Se cierra además el primer hallazgo que produjo la suite: `fusionar()`
  validaba `valoresElegidos` contra `columnasEnriquecibles()`, que **incluye** los tres campos
  sensibles, así que la única barrera vivía en la ruta y el comentario del motor —*"el motor no
  confía en su llamador"*— era falso justo para ellos. Y este registro pasa a ir en **orden
  cronológico inverso**, que es como se lee un changelog.
- **2026-08-10** — **El proyecto estrena pruebas automatizadas: nueva §9.** No había ninguna. La
  primera suite cubre el **motor de fusión de contactos** y su **cola de propagación a GHL**, que es
  justo lo que no se puede validar a mano en staging: por decisión de producto allí no se fusionan
  contactos reales, ningún par de staging tiene notas —así que la razón de ser de la mig. `0058` era
  indemostrable con datos reales— y GHL **no tiene entorno de pruebas**. La §9 fija dónde viven los
  tests (`apps/api/tests/`, fuera del build, como `apps/api/scripts/`), cómo se corren, la regla de
  la **base desechable `crm_test_fusion`** con su **guard de tres condiciones** —que tiene su propio
  fichero de pruebas—, por qué el esquema sale de `pg_dump` y no de `pnpm migrate` (la base se
  adoptó con `baseline 0029`), la prohibición de red en cualquier test, y la regla que más importa:
  **un test que falla es un hallazgo, no un test que hay que arreglar.**
- **2026-08-07** — **§1.13 se matiza: el agente SÍ puede aplicar una migración en su base LOCAL para verificarla** (solo local, se reporta, y se deja la base como estaba sin borrar bitácora). La prohibición sigue intacta para staging y producción. Motivo, documentado en la propia regla: la redacción anterior prohibía ejecutar en cualquier entorno, y aplicada al pie de la letra habría dejado pasar un defecto real —la primera versión de la mig. `0060` usaba `bigserial`, que reescribe la tabla y **rellena las filas existentes**, inventándole un orden de escritura a 21.406 filas de `contactos_merge_log`— que **no se ve leyendo el SQL** y solo salió al ejecutarla en local. Alineados `CLAUDE.md` y `METODOLOGIA-DE-TRABAJO.md` §3.3, que decían lo contrario.
- **2026-08-07** — **La metodología de trabajo pasa a documento propio: [METODOLOGIA-DE-TRABAJO.md](METODOLOGIA-DE-TRABAJO.md)**, referenciado como lectura obligatoria desde `CLAUDE.md`. Formaliza lo que se venía explicando de viva voz en cada sesión nueva: el reparto de roles (el humano opera la VPS/BD/git remoto y aprueba · el Claude de terminal planifica y **audita** · el Claude de VSCode **solo** escribe código y commitea en local), el ciclo tarea → plan de acción → prompt → código → auditoría → promoción, el mapa de los tres entornos (local · staging donde se prueba todo · producción que **jamás** se toca) y el **checklist de auditoría previo al `push`**. Este contrato sigue definiendo *cómo se escribe* el código; aquél, *cómo se trabaja*.
- **2026-08-06** — **Metodología de trabajo elevada a contrato.** Estas reglas se venían repitiendo encargo por encargo (y vivían dentro de la espec del módulo de Contactos, que caduca cuando el módulo cierre); ahora son permanentes. Nueva **§0 Preservación** (nada se borra físicamente; bitácoras inmutables; el borrado físico solo como script manual de `super_admin` con `--dry-run` y revisión humana), que **manda sobre el resto del contrato**. "Flujo de trabajo por tareas" suma entrega **por etapas**, reporte con **diff crudo**, auditoría que **nunca** se hace sobre el autorresumen del ejecutor y se contrasta contra fuente independiente, y **una sola especificación viva por módulo** (sin adendas apiladas). §1.13 (el agente escribe la migración, el humano la ejecuta) y §1.14 (el repo **no** es fuente de verdad de los índices de prod: verificar contra `pg_indexes`/`EXPLAIN`). §5 suma la prohibición de `pm2 restart` y el puntero a los límites de git de los agentes (en `CLAUDE.md`). §6.7: credenciales nunca por chat. `CLAUDE.md` suma la sección "Guardarraíles que no se cruzan nunca".
- **2026-08-04** — **Migración Drive→R2 completada en prod + Leads→Clientes.** Nueva **§8** (capa de archivos R2-only: content-addressed, servido por proxy con ACL, nunca borrar objeto compartido por `sha`, GHL retirado del storage). §1 contador de migraciones → prod en `0055`, próximo `0056`. §1.5: nota de índices pesados en prod (GIN trigram bloquea escrituras → ventana/`CONCURRENTLY`). "Documentos relacionados" sumó CHECKPOINT-MAESTRO, RUNBOOK-PROD y DISENO-DRIVE-CICLO-ARCHIVOS.
- **2026-07-16** — Creada [BASE-DE-DATOS.md](BASE-DE-DATOS.md) (referencia real del esquema, generada del esquema en vivo). Nueva regla §1.12: toda migración que cree/modifique tabla, columna, vista, FK o índice **debe** actualizar ese doc con la función explicada — migración sin doc = incompleta. El "próximo número de migración" pasa a llevarse en `CLAUDE.md` (raíz).
- **2026-06-30** — Regla de fixtures con credenciales (§1.10): usuarios de prueba con password versionado solo en no-prod vía guard `current_database() <> 'postgres'`. Creada migración `0030_seed_usuario_prueba.sql` (usuario QA nivel `usuario`).
- **2026-06-30** — Gobernanza del pipeline: autoridad de promoción por rol (Jhosnel/QA gestiona `dev→qa` y valida staging; solo Juan David/PM aprueba y mergea `qa→prod`). Documentación general §3 actualizada con la tabla de roles y el flujo nombrado.
- **2026-06-30** — Incorporadas reglas extraídas de la documentación general: base de datos (esquema `crm_tadi` fijo, conexión directa, `DB_SCHEMA` ignorado, backups, diagnóstico), estructura del monorepo (`apps/api|frontend|ai`), rendimiento a escala (evitar O(n²) en JS), brand y ramas (naming + "el merge es la aprobación").
- **2026-06-30** — Creación. Reglas de migraciones (runner con tracking + nomenclatura + idempotencia) y de autorización/permisos (`user_permisos`, no columnas en `users`).
