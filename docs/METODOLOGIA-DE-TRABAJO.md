# Metodología de trabajo — CRM TADI

> 🔴 **LECTURA OBLIGATORIA AL ABRIR CUALQUIER SESIÓN**, seas Claude de terminal, Claude de VSCode, o
> una persona que se incorpora. Describe **cómo se trabaja aquí**: quién hace qué, en qué orden, con
> qué entornos y qué puertas hay que pasar antes de que una línea de código llegue a un usuario real.
>
> **Qué NO es:** no sustituye a `CONVENCIONES.md` (el contrato de *cómo se escribe* el código) ni a
> `CLAUDE.md` (los guardarraíles duros). Este documento explica *cómo se organiza el trabajo*
> alrededor de esas reglas. Si algo de aquí choca con `CONVENCIONES.md §0`, gana §0.
>
> **Última actualización:** 2026-08-07.

---

## 1. Los tres actores

El trabajo lo hacen **tres actores con responsabilidades que no se solapan**. Confundirlas es la
forma más rápida de romper algo.

| Actor | Qué hace | Qué NO hace nunca |
|---|---|---|
| **Juan** — programador y operador humano | Recibe las tareas de su jefe y las plantea. **Es el único con acceso a la VPS, a las bases de datos y al repositorio remoto.** Ejecuta las migraciones, corre los scripts, hace **todos** los `push` y **todos** los `merge`, abre los PR y valida en pantalla. | Delegar la decisión final. La aprobación es suya. |
| **Claude de terminal** — planificador y auditor | Planifica cada movimiento con Juan, redacta los `PLAN-ACCION-*.md`, **escribe los prompts e instrucciones precisas** que consume el Claude de VSCode, y **audita el trabajo devuelto**. Da o niega la luz verde. | Escribir el código de la entrega. No hace `push`, `merge`, `PR`, ni ejecuta migraciones. |
| **Claude de VSCode** — ejecutor | **Escribe el código.** Crea la rama desde `dev`, implementa, commitea en local y devuelve resultados (diff crudo + salidas reales). | `push`, `merge`, `rebase`, `cherry-pick`, PR, `reset --hard`, ejecutar migraciones, tocar producción. Commitea y **se detiene**. |

> **Regla que sostiene todo lo demás:** *quien escribe el código no es quien lo aprueba, y quien
> aprueba no se fía del resumen del que lo escribió.* La auditoría se hace sobre el **diff crudo**
> (`git diff`, `git show`, `git log`) y sobre salidas reales, nunca sobre la narración del ejecutor
> (`CONVENCIONES.md` → "Flujo de trabajo por tareas").

---

## 2. El ciclo completo, paso a paso

```
  ┌─ 1. LA TAREA ────────────────────────────────────────────────────────────┐
  │  El jefe le pasa a Juan las exigencias. Pueden llegar como resumen de     │
  │  Fathom, historial de chat, o explicadas de viva voz. Juan se las         │
  │  traslada al Claude de terminal con todo el detalle disponible.           │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ 2. PLANIFICACIÓN (Juan + Claude terminal) ──────────────────────────────┐
  │  · Se lee la documentación que manda (§4) ANTES de proponer nada.        │
  │  · Se investiga contra el código y, si hace falta, contra la base.       │
  │  · Sale un `PLAN-ACCION-<slug>.md` en la raíz: diagnóstico, causa raíz   │
  │    con `archivo:línea`, cambios propuestos, criterios de aceptación y     │
  │    despliegue. Documento de trabajo: NO se commitea.                     │
  │  · Las dudas que cambian el resultado se preguntan AQUÍ, no después.     │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ 3. EL PROMPT (Claude terminal → Claude VSCode) ─────────────────────────┐
  │  Instrucciones precisas: qué construir, con qué reglas, qué NO tocar,    │
  │  qué criterios de aceptación debe demostrar y con qué evidencia.          │
  │  Se entrega **una etapa por encargo**, ordenada por dependencia.          │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ 4. EJECUCIÓN (Claude VSCode) ───────────────────────────────────────────┐
  │  Rama nueva DESDE `dev` (`autor/description`, en inglés, kebab-case).     │
  │  Implementa. Commits locales en inglés, Conventional Commits.            │
  │  Devuelve: `git --no-pager diff --stat`, `git --no-pager log --oneline    │
  │  dev..HEAD`, y la salida LITERAL de typecheck, lint y las pruebas.       │
  │  **Y ahí se detiene.** No pushea.                                        │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ 5. AUDITORÍA (Claude terminal) ─────────────────────────────────────────┐
  │  Sobre el diff crudo, no sobre el resumen. Checklist en §5.              │
  │  Salida: 🟢 luz verde · 🟡 verde con reservas anotadas · 🔴 se corrige.   │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ 6. PROMOCIÓN (Juan, y solo Juan) ───────────────────────────────────────┐
  │  push de la rama → merge a `dev` → cuando lo de `dev` está completo y     │
  │  no choca entre sí, `dev` → `qa` → **autodeploy a STAGING** →            │
  │  migraciones a mano → pruebas en staging → PR `qa` → `prod` con           │
  │  aprobación humana → **autodeploy a PRODUCCIÓN**.                        │
  └──────────────────────────────────────────────────────────────────────────┘
```

**Entrega por etapas.** Nunca todo de golpe: se ejecuta una etapa, se detiene, se reporta, se audita,
y solo entonces sale la siguiente.

### 2.1 Formato de entrega de prompts y consultas

Todo **prompt para el Claude de VSCode** y toda **consulta o comando para ejecutar en la VPS** se
entrega delimitado, con estas marcas exactas:

```
# ------- prompt a vscode / consulta a la vps --------
Cuerpo
# ---------- fin --------
```

🔴 **Las marcas van DENTRO del bloque de código y comentadas con `#`.** Se ven igual, pero si se
pegan a una terminal por descuido no hacen nada. Sin el `#`, bash intenta ejecutarlas y responde
`-------: command not found` — ruido que enmascara los errores de verdad. Pasó el 2026-08-10.

⚠️ **Un `read` interactivo va SIEMPRE en un bloque para él solo, sin una línea debajo.** Al pegar
varias líneas de golpe, `read` **se traga la siguiente como si fuera lo tecleado**. El 2026-08-10
eso convirtió una contraseña en basura, devolvió `login=401`, dejó el fichero del token vacío y
tumbó las cuatro comprobaciones siguientes con `401 No autenticado` — que se leían como si el código
estuviera roto, cuando lo roto era la sesión.

**Por qué:** en un mensaje largo, lo que hay que copiar y ejecutar se confunde con el análisis que lo
rodea. Las marcas dicen sin ambigüedad **dónde empieza y dónde termina** lo accionable, y evitan el
error más caro de este flujo: copiar de más, de menos, o ejecutar un fragmento de ejemplo creyendo
que era el comando real.

Reglas que acompañan al formato:

- 🔴 **El bloque se copia y se pega TAL CUAL. Cero huecos que rellenar.** Nada de `<staging>`,
  `TU-DOMINIO`, `PON-AQUI-EL-ID` ni rutas por adivinar. Si falta un dato —el dominio, un puerto, un
  uuid, el nombre de un proceso—, **lo averigua quien redacta el bloque**, preguntando o mirando el
  entorno, **antes** de entregarlo. Un placeholder es trabajo sin terminar que se traslada a quien
  ejecuta, y cuando se olvida rellenar no falla de forma limpia: en la primera versión de la batería
  de fusión, `BASE` sin sustituir devolvió `http=000` en todo y un `grep` sobre un fichero que nunca
  se creó **dio 0 coincidencias, que se leía como verde**. Un falso verde es peor que un error.
  **Única excepción: las credenciales**, que por §6.7 de `CONVENCIONES.md` no pueden ir escritas —
  se piden por `read -s` dentro del propio bloque, nunca como hueco a editar.
- **El bloque se defiende solo.** Verifica sus precondiciones (¿hay sesión?, ¿llegó respuesta?) y se
  detiene con un mensaje claro si no se cumplen, en vez de seguir produciendo salidas sin valor.
- **Un bloque = una unidad ejecutable.** Si hay que correr dos cosas en momentos distintos, son dos
  bloques, no uno con un comentario en medio.
- **El análisis va fuera del bloque.** Dentro solo lo que se copia y se pega.
- **Cada bloque declara qué toca**: lectura o escritura, contra qué base o entorno, y por qué es
  seguro. Los guardarraíles de `CLAUDE.md` no se relajan por ir dentro de un bloque.

---

## 3. Ramas y entornos

### 3.1 El esquema de ramas — no se salta ningún escalón

```
rama de trabajo  →  dev  →  qa  →  prod
 (autor/desc)              │        │
                           │        └─► autodeploy a PRODUCCIÓN (/root/crm-tadi)
                           └─► autodeploy a STAGING (/root/crm-tadi-staging)
```

- **Rama de trabajo** — se crea **siempre desde `dev`**. Nombre en inglés, `autor/description` en
  kebab-case (ej. `juan/contacts-merge-ui`). Verificar con `git branch --show-current` antes de crear.
- **`dev`** — integración. Es, junto con `qa`, la rama **más actualizada** del repositorio. Los
  cambios entran aquí solo después de la auditoría.
- **`qa`** — se promueve `dev → qa` **cuando lo acumulado en `dev` está completo y no choca entre
  sí**. El push a `qa` dispara el **autodeploy vía GitHub Actions a la caja de staging del VPS**.
- **`prod`** — **siempre por Pull Request y con aprobación humana explícita.** El merge dispara el
  autodeploy a producción. **Nada llega a prod sin haber pasado por staging.**
- La rama `main` está apartada y no se usa.

**Autoridades de promoción** (`CONVENCIONES.md §5`): `dev → qa` la gestiona QA (Jhosnel Roas), que
además valida en staging; el PR `qa → prod` **solo lo aprueba y mergea el PM (Juan David Duque)**.
**El merge ES la aprobación, y esa firma es humana.**

⚠️ **La copia local de una rama puede estar vieja.** Antes de razonar sobre "qué contiene `qa`",
comprobarlo contra el remoto, no contra el checkout local.

### 3.2 Las tres bases de datos

| Entorno | Base | Dónde | Para qué | Quién escribe |
|---|---|---|---|---|
| **Local** | `crm_staging` (local) | máquina de Juan | desarrollo y pruebas rápidas | libre |
| **STAGING** | `crm_staging` | VPS, `/root/crm-tadi-staging` | 🥇 **aquí se prueba TODO.** Es el espejo de prod y el único sitio donde se valida antes de promover | Juan, a mano |
| **PRODUCCIÓN** | `postgres` | VPS, `/root/crm-tadi` | **JAMÁS se toca.** Solo se **consulta** cuando hace falta un dato real (índices, `EXPLAIN`, conteos) | nadie, salvo el pipeline |

- El **esquema es siempre `crm_tadi`** en los tres. Lo único que cambia es el nombre de la base.
  La variable `DB_SCHEMA` del `.env` **no se usa** (red herring documentado).
- **Antes de tocar nada, confirmar a qué base se está conectado**: `current_database()` más un conteo
  conocido que difiera entre entornos. Nunca asumir.
- ⚠️ **La base local no es idéntica a staging**: tiene migraciones marcadas como aplicadas que nunca
  se ejecutaron. **Verifica el esquema real, no el registro de `schema_migrations`.**

### 3.3 Migraciones — quién escribe y quién ejecuta

- **El agente ESCRIBE la migración y avisa.** En **staging y producción** no la ejecuta nunca.
- **En su base LOCAL sí puede aplicarla para verificarla**, y se espera que lo haga cuando el efecto
  no se vea leyendo el SQL. Tres condiciones: **solo local**, **se reporta** lo que se ejecutó y lo
  que se observó, y **la base se deja como estaba** (revirtiendo por el camino auditado, sin borrar
  filas de bitácora). El porqué de esta excepción, con el caso real que la motivó, está en
  `CONVENCIONES.md` §1.13.
- `pnpm migrate` en **staging y prod** lo corre **Juan, a mano**, en el orden **LOCAL → STAGING → PROD**.
- **El autodeploy NO corre migraciones.** Es un paso manual posterior al deploy. Olvidarlo deja el
  código nuevo contra un esquema viejo — ya pasó.
- Numeración `NNNN_descripcion.sql` de 4 dígitos, secuencial, idempotente. **El próximo número lo
  lleva `CLAUDE.md` (raíz)**: se consulta ahí y se actualiza ahí.
- Toda migración que cree o modifique tabla, columna, vista, FK o índice **debe** venir con su entrada
  en `docs/BASE-DE-DATOS.md` explicando la **función** de lo nuevo (`CONVENCIONES.md §1.12`).
  Migración sin doc = migración incompleta.

---

## 4. Qué se lee antes de proponer nada

En este orden:

1. **`CLAUDE.md`** (raíz) — guardarraíles duros, límites de git, próximo número de migración.
2. **`docs/CONVENCIONES.md`** — el contrato. **§0 Preservación manda sobre todo lo demás.**
3. **Este documento** — cómo se organiza el trabajo.
4. **El documento de arranque del módulo que toques:**
   - Módulo **Contactos** → `docs/CHECKPOINT-CONTACTOS.md`, y su especificación viva
     `docs/PROMPT-CONTACTOS-CLAUDECODE.md`.
   - Módulo **Oportunidades** → `docs/CHECKPOINT-OPORTUNIDADES.md`.
   - **Saneamiento / migración de datos históricos** (Drive→R2, dedup masivo, Leads→Clientes) →
     `docs/CHECKPOINT-MAESTRO.md` y `docs/RUNBOOK-PROD.md`.
5. **`docs/BASE-DE-DATOS.md`** — obligatorio antes de tocar la base.

**Una sola especificación viva por módulo.** Toda decisión nueva se incorpora **al texto** del
documento que ya existe, en su sección. **No se apilan adendas**: una adenda suelta se absorbe en la
espec y se borra.

---

## 5. La auditoría — qué se revisa antes de dar luz verde

La auditoría **no se hace sobre el autorresumen del ejecutor**: quien se evalúa a sí mismo siempre se
aprueba. Se hace sobre `git diff` / `git show` / `git log`, y cuando una afirmación se puede contrastar
contra una **fuente independiente** (los datos reales, el esquema en vivo), se contrasta: la
discrepancia se reconcilia **antes** de seguir.

**Checklist mínimo de cada auditoría:**

- [ ] **Rama correcta**, creada desde `dev`, con el nombre y los mensajes de commit en la convención.
- [ ] **Cero `push`, `merge`, `rebase`, PR o `reset --hard`** en el historial de la rama.
- [ ] **El diff hace lo que dice el plan** — y nada más. Cambios fuera de alcance se señalan.
- [ ] **§0 Preservación:** cero borrado físico de filas, archivos u objetos de R2 en el flujo normal.
      Grep del diff por `DELETE FROM` sobre tablas de negocio y por borrados de bitácora.
- [ ] **Reversibilidad:** todo lo que escribe datos deja bitácora con `corrida_id` y tiene revert.
- [ ] **SQL:** helper `query` con placeholders `$1,$2`; cero interpolación de valores del usuario.
- [ ] **Autorización verificada en el backend**, por consulta a la base, no por el JWT ni por la UI.
- [ ] **Proyecciones explícitas** donde la tabla tenga datos sensibles (nunca `SELECT *` en una
      respuesta HTTP sobre `contactos_cache`).
- [ ] **Rendimiento:** nada de O(n²) en JS sobre el event loop; filtrado y orden en SQL.
- [ ] **Migraciones escritas pero NO ejecutadas**, idempotentes, con su entrada en `BASE-DE-DATOS.md`
      y el contador de `CLAUDE.md` actualizado.
- [ ] **Evidencia real pegada**: typecheck, lint y las pruebas, con su salida literal. El build **no**
      valida lint (`eslint.ignoreDuringBuilds: true`), así que un build verde no dice nada.
- [ ] **Lo que NO se pudo verificar se declara como NO verificado.** Un "0 errores" solo vale si el
      chequeo miró donde el fallo haría daño.
- [ ] **El guion de pruebas de staging del módulo se actualizó EN LA MISMA ENTREGA.** Si el cambio
      añade una migración o una conducta nueva, su comprobación entra en el guion antes de cerrar,
      no después. Un guion desactualizado es peor que no tenerlo: da por verde lo que nadie miró.
      *(Contactos → `docs/PRUEBAS-STAGING-CONTACTOS.md`.)*

**Veredicto:** 🟢 luz verde para push · 🟡 verde con reservas anotadas y encoladas · 🔴 se devuelve
con la corrección concreta. **Sin luz verde no hay push.**

🔴 **El veredicto se dice EXPLÍCITAMENTE, y el auditor lo dice sin que se lo pidan.** No basta con
describir que el trabajo está bien: hay que escribir si se puede **pushear** y hasta **qué rama se
puede mergear** (`dev`, `qa`, o ninguna todavía), y qué queda bloqueado. Quien aprueba no debería
tener que deducir su propia autorización de un informe técnico. Si el auditor termina una entrega y
no ha dicho esa frase, la entrega está a medias.

El veredicto incluye además, cuando aplique:

- **Si hay migraciones que aplicar a mano** tras el deploy, o si explícitamente **no las hay**.
- **Qué hay que volver a comprobar en staging** una vez desplegado.
- **Qué decisiones siguen bloqueando** el siguiente escalón (típicamente el PR `qa → prod`).

---

## 6. Lo que ningún agente hace, nunca

Aplica al Claude de terminal y al de VSCode por igual. Detalle completo en `CLAUDE.md` → "Git —
límites del agente".

- **Git:** `push` (ni `--force`, ni tags), `merge`, `rebase`, `cherry-pick`, crear/aprobar/mergear
  PRs, `reset --hard`, descartar cambios no pedidos, borrar ramas, tocar `dev`/`qa`/`prod` directo.
- **Producción:** `pm2 restart crm-api` / `crm-frontend` — es producción viva y corta el servicio.
  El despliegue lo hace el pipeline, no una mano.
- **Migraciones y scripts de datos destructivos:** se escriben, se avisan; los ejecuta un humano.
- **Credenciales:** nunca se escriben en un chat. Van al `.env` del servidor (gitignored) y se leen
  por `process.env`.
- **Nada es autorización implícita:** ni que el trabajo esté terminado, ni que los tests pasen, ni un
  "dale" en un mensaje anterior. Si un agente cree que hace falta un push o un merge para avanzar,
  **se detiene y lo dice**; no lo hace y lo cuenta después.
- **Ante un bloqueo, se para y se pregunta.** No se inventan nombres de tablas, columnas ni endpoints,
  y no se avanza sobre una suposición sin marcarla como tal.

---

## 7. Registro de cambios de este documento

- **2026-08-10** — Nueva **§2.1: formato de entrega de prompts y consultas**. Todo prompt para el
  Claude de VSCode y todo comando para la VPS va delimitado entre `------- prompt a vscode /
  consulta a la vps --------` y `---------- fin --------`. Pedido por Juan tras varias sesiones en
  las que lo accionable quedaba embebido en el análisis: las marcas eliminan la ambigüedad sobre qué
  se copia y qué no.
- **2026-08-07** — Creación. Formaliza lo que hasta ahora se explicaba de viva voz en cada sesión
  nueva: el reparto de roles (Juan opera y aprueba · Claude de terminal planifica y audita · Claude
  de VSCode ejecuta), el ciclo tarea → plan → prompt → código → auditoría → promoción, el mapa de las
  tres bases de datos y el checklist de auditoría previo al push. Referenciado como lectura
  obligatoria desde `CLAUDE.md`.
