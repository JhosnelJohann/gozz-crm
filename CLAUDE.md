# CLAUDE.md — orientación para agentes y desarrolladores

CRM AI-first GOZZ (monorepo pnpm: `apps/api` Express+TS, `apps/frontend` Next.js, `packages/db` migraciones).

## ⛔ Antes de nada, lee cómo se trabaja aquí

**[docs/METODOLOGIA-DE-TRABAJO.md](docs/METODOLOGIA-DE-TRABAJO.md) es de lectura obligatoria al abrir CUALQUIER sesión** — da igual que seas un Claude de terminal, un Claude de VSCode o una persona nueva. Define el reparto de roles (quién planifica, quién escribe código, quién audita y quién promueve), el ciclo tarea → plan de acción → prompt → código → auditoría → promoción, el mapa de las tres bases de datos (local · staging · producción) y el checklist de auditoría que hay que pasar **antes** de cualquier `push`. No la deduzcas: está escrita para no tener que explicarla en cada sesión nueva.

## ⛔ Antes de cambiar código, lee el contrato de convenciones

**[docs/CONVENCIONES.md](docs/CONVENCIONES.md) es de lectura obligatoria.** Define las reglas de migraciones, autorización, backend, frontend y despliegue. Síguelas; si el código las contradice, es deuda técnica a corregir, no un patrón a imitar. Cuando establezcas una regla nueva, documéntala ahí.

## ⛔ Guardarraíles que no se cruzan nunca

Aplican a cualquier persona o agente que toque este proyecto. Ante la duda, se preserva y se pregunta.

- **Nada se borra físicamente.** Ni una fila, ni un archivo, ni un objeto de R2. Todo "borrado" es archivado lógico y **reversible**, con bitácora que permita deshacerlo. Si alguna vez hay que purgar de verdad, es una herramienta **separada, manual, solo `super_admin`**, con simulación por defecto y revisión humana previa (detalle en `docs/CONVENCIONES.md` §0).
- **`gozz.auditoria` es intocable.** Jamás se borran sus filas, ni siquiera para limpiar los restos de una prueba.
- **El agente escribe las migraciones; el humano las aplica donde importa.** Se dejan escritas y se avisa: en **staging y prod** `pnpm migrate` lo corre un humano, a mano. El agente **sí puede** aplicarlas en **su base local para verificarlas** —y debe hacerlo cuando el efecto no se vea leyendo el SQL—, con tres condiciones: solo local, se reporta, y la base se deja como estaba sin borrar bitácora (`docs/CONVENCIONES.md` §1.13).
- **Producción no se toca.** Nunca `pm2 restart gozz-api` ni `pm2 restart gozz-frontend`: es producción viva. Las pruebas van contra staging.
- **Evidencia, no afirmaciones.** Si algo se probó, se pega la salida real. Si no se ejecutó, se dice que no se ejecutó. Nunca se reporta un resultado verde que no se corrió.
- **Ante un bloqueo, se para y se pregunta.** No se inventan nombres de tablas, columnas ni endpoints, y no se avanza sobre una suposición sin marcarla como tal.

## Reglas que más se olvidan (resumen — el detalle está en el contrato)

- **Migraciones:** runner con tracking (`pnpm migrate` corre solo las pendientes). Nomenclatura `NNNN_descripcion.sql`, **próximo número: `0074`**. Idempotentes siempre. Nunca editar una migración ya aplicada en prod; crea una nueva.
  - **Estado por entorno — 🔴 NO SE REPITE UN NÚMERO DE MEMORIA, SE CONSULTA.** Esta línea decía que en staging solo estaban la `0056` y la `0057`; el 2026-08-19 se corrió allí `pnpm migrate:status` y devolvió **«69 aplicada(s), 0 pendiente(s)»**. El dato caducado llevaba meses propagándose a los planes.
    - **staging:** **73 aplicadas, 0 pendientes** — verificado el **2026-08-25** corriendo
      `pnpm migrate:status` en `/root/crm-tadi-staging`, contra `crm_staging`.
    - **producción:** **73 aplicadas, 0 pendientes** — verificado el **2026-08-25** corriendo
      `pnpm migrate:status` en `/root/crm-tadi`, contra la base `postgres` del contenedor
      `supabase-db`, justo después del despliegue del PR #28 (tag `prod-20260825-1108`). Antes de
      aplicar, el runner listaba **exactamente dos** pendientes —la `0072` y la `0073`—, así que
      el atraso que este bloque llevaba meses sin poder descartar **no existía**.
      ⚠️ Aquí decía «estado SIN VERIFICAR», y eso era lo correcto mientras nadie mirara: **un
      número a ojo en este fichero se lee como verificado**. La regla no cambia porque hoy haya
      salido bien — la próxima vez se vuelve a consultar.
    - **local:** al día hasta la `0073` (aplicadas por el agente para verificarlas, §1.13).
    - **`0072_drive_comparticiones`** (compartir en el Drive) y
      **`0073_drive_destacados_recientes`** (estrellas y «Recientes»): **aplicadas en los tres
      entornos** — local y staging el 24 y el 25 de agosto, **producción el 2026-08-25**. En los
      tres se comprobó el **efecto y no que el runner dijera OK**: las tres tablas vacías, los
      tres CHECK de `drive_comparticiones`, sus dos índices únicos parciales, y —lo que de verdad
      importaba— **los dos índices de `drive_destacados` con sus dos semánticas distintas**:
      `..._compania_uniq` **sin** `user_id` (una estrella por cosa para todo el equipo) y
      `..._personal_uniq` **con** `user_id` (una por cosa y por persona). Si esos dos salieran
      iguales, las estrellas se pisarían entre usuarios.
  - **Adopción de una DB existente:** correr **una sola vez** `node scripts/run-migrations.mjs baseline <primer_pendiente>` antes del primer `pnpm migrate` (ya hecho en staging y prod con `baseline 0029`). Detalle en `docs/CONVENCIONES.md` §1.
- **Permisos:** roles por `nivel_acceso`; permisos granulares en tabla `gozz.user_permisos` (NO columnas booleanas en `users`). Verificación por consulta a DB, no en el JWT.
- **SQL:** siempre el helper `query` con placeholders `$1,$2`; nunca interpolar valores.

## Git — límites del agente

Aplica a **todo agente de IA del proyecto** (el que ejecuta código y el que audita). El agente trabaja en su rama, commitea en local, y ahí se detiene. Juan audita el diff crudo y decide si sube y si integra: **el merge es la aprobación y esa firma es humana** (CONVENCIONES §5).

- **Prohibido siempre, sin excepciones ni permiso implícito:** `git push` (incluidos `--force`, `--force-with-lease` y push de tags); `git merge` de cualquier rama a cualquier otra; `git rebase`; `git cherry-pick` entre ramas; crear, aprobar o mergear Pull Requests (ni por web, ni con `gh`, ni por API); `git reset --hard`, `git checkout -- <archivo>` o cualquier descarte de cambios no commiteados que no se haya pedido; borrar ramas locales o remotas; tocar `dev`, `qa` o `prod` directamente.
- **Permitido sin preguntar:** crear una rama nueva desde `dev`; `git add` y `git commit` en la rama de trabajo propia; `git status`, `log`, `diff`, `show` y cualquier lectura.
- **Nada es autorización implícita:** ni que el trabajo esté terminado, ni que los tests pasen, ni un "dale" en un mensaje anterior. Si el agente cree que hace falta un push o un merge para avanzar, se detiene y lo dice; no lo hace y lo cuenta después.

## Despliegue

`dev` → `qa` (STAGING) → `prod` (PRODUCCIÓN). Nada directo a prod; promoción `qa → prod` con **PR + aprobación humana**. Probar en local y staging primero.
