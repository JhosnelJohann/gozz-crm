# RUNBOOK-PROD — Migración Drive → Cloudflare R2 (ejecución en PRODUCCIÓN)

> **Estado:** ✅ **CORRIDA A PROD COMPLETADA (2026-08-04)** — migración Drive→R2 ejecutada de punta a punta en producción: prod 0044→0055, R2-only vivo, `archivos_vivos=188.365 / con_r2_ok=188.365 (100%) / sin_forma_de_servir=0`, Leads Parte B 27.758 archivados. **Resultados reales por fase en §0-quater (abajo).** · Histórico del ensayo: **ENSAYO §0-bis PASÓ LIMPIO** sobre backup fresco de prod (foto real, prod en migración 0044). Todas las fases (1→3b + migraciones 0045→0055 + 4A + Fase B) corrieron correctas de punta a punta; resultado final **188.303/188.303 archivos con `r2_status='ok'`, 0 sin forma de servir, gate Parte 0 = 0**. Números completos en «Resultados del ensayo §0-bis» (abajo). Afinamientos técnicos: scripts blindados a staging §0.6, split de migraciones §4, gotchas Supabase/pg_restore en `RUNBOOK-0BIS-ENSAYO.md`. Fase B2 previamente VALIDADA. **Bloqueador 2 (Ola A — scripts solo-BD: `fase2a/2b` + `archivar-leads`) parametrizados a `--prod` y validados end-to-end contra prod real (2026-08-04); Ola B (scripts R2) pendiente del Bloqueador 1.** **DECISIÓN BUCKET (2026-08-04):** el set de bytes es 100% GHL (`assets.cdn.filesafe.space`); el bucket de prod `crm-tadi-prod` se **siembra por copia R2→R2** del de staging (NO arranca vacío, NO se re-descarga) — ver §0 Bloqueador 1.
> **Regla de oro:** todo ADITIVO/RECONCILIATORIO y REVERSIBLE por corrida. NUNCA borrar objetos R2 ni datos de GHL. Cada paso: dry → snapshot/baseline → apply → verificación (que cubra el caso de fallo). Ante la duda, se preserva.
> **Entornos:** PROD `/root/crm-tadi` (BD `postgres`); staging fue el ensayo (sobre una copia VIEJA de prod). Todas las corridas se ensayaron en staging (ver CHECKPOINT-MAESTRO.md), pero **antes del prod real hay que repetir el ensayo con un backup FRESCO de prod — ver §0-bis (obligatorio).**

---

## 0. ANTESALA — bloqueadores a resolver ANTES de correr el runbook

> El ensayo §0-bis pasó limpio (§0-ter). El runbook **NO se corre en prod** hasta cerrar estos dos bloqueadores. Son setup + un cambio de código acotado; no requieren más ensayos.
>
> **BLOQUEADOR 1 — Credenciales + bucket R2 de PROD (SEMBRADO, no vacío)** (item 1–2 abajo). Crear bucket de prod `crm-tadi-prod` (distinto de `crm-tadi-staging`) y **sembrarlo copiando R2→R2 desde el bucket de staging** (el set migrado y verificado del ensayo — **NO re-descargar de origen**); rotar creds, revocar token maestro, poblar `apps/api/.env` de prod. Es setup, no código.
>
> **BLOQUEADOR 2 — Parametrizar los guardas de los scripts de datos** (item 6 abajo). `migrar-storage-r2.mjs`, `fase2a/2b`, `fase3a/3b` abortan si BD != `crm_staging` / bucket != `crm-tadi-staging`. Para prod: modo `--prod` (o env) que apunte a BD `postgres` + creds/bucket de prod. **Va por el pipeline (dev→qa) ANTES de la corrida.** Cambio de código acotado.
>   - **Ola A (solo-BD) ✅ HECHA** (rama `juan/scripts-prod-guard`, mergeada a qa/staging 2026-08-04): `fase2a`, `fase2b`, `archivar-leads-sin-oportunidad` toman `--prod` (conmuta `ENV_FILE`→`.env` de prod y `EXPECT_DB`→`postgres`; la guarda sigue SIEMPRE activa, solo cambia el valor esperado — sin `--prod` es idéntico al comportamiento previo). Validado end-to-end contra prod real: `GUARD OK: postgres · entorno=PROD`. **Wisdom:** `fase2a/2b --prod` solo completan el DRY **después** de las pre-migraciones (necesitan `drive_folders.contacto_id` de 0046/0047; contra prod-0044 tiran `column ... does not exist` — esperado, confirma el orden de §4); `archivar-leads --prod` corre contra prod-0044 directo (solo usa columnas de la 0042).
>   - **Ola B (scripts R2) — PENDIENTE**, atada al Bloqueador 1: `migrar-storage-r2`, `fase3a`, `fase3b` necesitan el nombre real del bucket prod + confirmar que `loadR2Creds` (en `r2-lib.mjs`) parsea `apps/api/.env`. La guarda de bucket debe quedar **estricta** (`=== 'crm-tadi-prod'`), no un `!=` flojo.
>
> *(Además, en paralelo, el frente **Leads→Clientes** — ver §5-bis — debe quedar resuelto antes o dentro de la corrida, según se decida.)*

### Pre-requisitos (detalle)

1. **Bucket R2 de PROD `crm-tadi-prod` creado y SEMBRADO (no arranca vacío).** El set de bytes de la migración es **100% GHL** — verificado 2026-08-04: las **189.091** URLs viven todas en `assets.cdn.filesafe.space` (el CDN de GHL); **cero** Zoho/Bitrix/Pipedrive en `drive_files` (esos son frentes aparte; los 34k de Pipedrive son los "bytes pendientes" del §2). El ensayo ya dejó el set completo y verificado en el bucket de staging (**188.303** objetos `r2_status='ok'`). Por eso el bucket de prod se **siembra copiando R2→R2** desde `crm-tadi-staging` (server-side, sin egress, **sin re-descargar de origen**); como los keys son content-addressed (`objects/{sha[0:2]}/{sha[2:4]}/{sha}`), es un espejo exacto. **Motivo:** (a) reusar un set ya verificado evita re-hacer la fase más pesada (157k objetos, 502/524); (b) protege contra links de GHL muertos aguas arriba desde la captura (una descarga fresca daría 404). **Verificar que el conteo de objetos coincida** staging→prod antes de seguir. **Credenciales R2 de PROD rotadas:** generar creds nuevas, **revocar el token maestro `crm-tadi-setup`** (ver `HANDOFF-R2-CLOUDFLARE.md` §13).
2. **Poblar `apps/api/.env` de PROD** con `R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET(=`crm-tadi-prod`)/R2_REGION=auto`. Backup del `.env` antes. NUNCA al git (gitignored). Archivo de creds prod como `--src` del merge, o manual.
3. **Índice recomendado** `fase2_log(corrida_id, accion)` (migración chica) — sin él, verificaciones/reverts se arrastran.
4. Confirmar backups frescos + `md5` de las tablas críticas antes de escribir.
5. **Prod está en migración 0044** (verificado en el ensayo 2026-08-04; `schema_migrations` → 44 aplicadas, última `0044`). Pendientes: **0045→0055**. Orden OBLIGATORIO: **0045–0049 ANTES** de las corridas de datos (agregan columnas R2 del drive `0046`, `uploads_r2_backup` `0049`, logs `0045/0048`); **0050–0055 DESPUÉS** (0050 dropea el índice único de sha que la dedup usa). Ver §4.
6. **⚠️ Los scripts de datos están BLINDADOS a staging.** `migrar-storage-r2.mjs`, `fase2a-consolidar`, `fase2b-limpieza-legacy`, `fase3a/3b` **abortan** si `current_database() != 'crm_staging'`; Fase 1 además aborta si el bucket R2 != `crm-tadi-staging` y toma creds de `/root/crm-tadi/data/.r2-staging.env`. Es una salvaguarda anti-accidente (buena). **Para la corrida REAL hay que parametrizar esos guardas** (flag `--prod` / env con nombre de BD `postgres` + archivo de creds de prod + bucket de prod) y **desplegarlo por el pipeline ANTES** de la corrida. NUNCA relajar el guard a mano en caliente sobre prod.
7. **BD = Supabase** (server PG 15.8; cliente host `pg_dump/psql` 16.x ✓). Prod = BD `postgres`, staging = BD `crm_staging`, mismo cluster, user `postgres`. El bucket R2 de prod (`crm-tadi-prod`) es **distinto** de `crm-tadi-staging` en nombre y aislamiento, pero se **siembra por copia** del de staging (ítem 1) — staging conserva su bucket intacto para no perder aislamiento.

---

## 0-bis. ⚠️ Ensayo final OBLIGATORIO — dress rehearsal con backup FRESCO de PROD

Los ensayos previos corrieron sobre una copia de staging **vieja/congelada**. Prod desde entonces acumuló datos nuevos y **le faltan un montón de migraciones + los scripts de datos**. Antes de tocar prod hay que hacer un **ensayo general con la foto ACTUAL de prod** — esto es la simulación real y el gate de confianza. **El prod real NO se corre hasta que este ensayo pase limpio y con resultados correctos.**

1. **Backup fresco de PROD** (BD `postgres`): `pg_dump` completo; verificar tamaño/integridad + guardar `md5`/conteos de tablas críticas (`drive_files`, `drive_folders`, `contactos_cache`, `oportunidades`, `uploads_*`).
2. **Restaurar ese backup en STAGING** (`crm_staging`), reemplazando la copia vieja. **CRÍTICO:** el `.env` de staging debe apuntar al **R2 de staging** (no prod) para no escribir en el bucket de prod durante el ensayo. Confirmar el bucket antes de correr cualquier cosa que suba bytes.
3. **Correr el RUNBOOK COMPLETO sobre esos datos frescos**, en el orden CORRECTO (split de migraciones): migraciones **0045–0049** (`pnpm migrate` **reteniendo** 0050–0055 fuera del dir) → corridas de datos (Fase 1–3b) → migraciones **0050–0055** → 4A (R2-only) → VACUUM → Fase B (papelera/GC). Cada paso con su dry → verificación. **Detalle operativo del ensayo** (dump/restore de Supabase scopeado a `crm_tadi`, gotchas de `pg_restore` `-d`/`-n`, split de migraciones, comandos exactos) en **`docs/RUNBOOK-0BIS-ENSAYO.md`**.
4. **Verificar que los resultados son los correctos:** los mismos invariantes/conteos de cada fase, ahora sobre datos actuales (contactos, oportunidades, `archivos_vivos`, `r2_status='ok'`, `orphan_folders=0`, dedup, etc.). **Documentar los números** del ensayo.
5. Solo si **todo pasa limpio y los resultados coinciden con lo esperado** → recién ahí se ejecuta el RUNBOOK en PROD (con las credenciales/bucket de prod del §0).

> Este paso convierte "ensayamos en un staging viejo" en "ensayamos con la foto real de prod". Es la **red de seguridad principal** de toda la corrida — sin esto, no hay corrida a prod.

---

## 0-ter. Resultados del ensayo §0-bis (2026-08-04) — la vara para la corrida real

Ensayo con backup **fresco** de prod (BD `postgres`, migración 0044) restaurado en `crm_staging` (Supabase, scopeado a `crm_tadi` + `schema_migrations`). Corrió el runbook COMPLETO contra el R2 de **staging**. Estos números son el checklist contra el que se compara en prod:

| Fase | Resultado del ensayo |
|---|---|
| Restore (baseline prod) | `drive_files`=189.103 · `drive_folders`=60.370 · `contactos_cache`=31.613 · `oportunidades`=7.452 · `schema_migrations`=44 (última 0044) |
| Migraciones 0045–0049 (pre-datos) | aplicadas OK (columnas R2 del drive, `uploads_r2_backup`, logs) |
| **Fase 1** (bytes→R2) | 157.758 objetos distintos · **189.092/0** filas en `r2_status='ok'` (0 errores tras re-correr transitorios 502/524 con escalera de concurrencia 6→4→2) · verificación por hash R2==CDN OK |
| **Fase 2a** (consolidar carpetas) | **no-op** (invariantes ya en 0; prod: 24.669 saneados / 52 fusiones sin carpetas colgantes) |
| **Fase 2b** (limpieza legacy) | 8.399 dups soft-deleted · **41.224 carpetas** podadas · 148.655 únicos preservados · 0 errores · `archivos_vivos` 189.092→180.693 |
| **Fase 3a** (expediente /uploads) | **7.610 filas creadas** + 1.465 carpetas · 4 irresolubles (residuo estable) · 0 errores · `archivos_vivos` 180.693→188.303. `/uploads`=6.8G / ~7.990 archivos |
| **Fase 3b** (respaldo /uploads) | **7.177** filas en `uploads_r2_backup` (chats 6.5k, huérfanos 188, opps, tareas, avatars) · 0 errores |
| Migraciones 0050–0055 (post-datos) | 55/55 aplicadas · **`drive_files_dedup_idx` DROPEADO por 0050** (confirmado en BD limpia) · `drive_files_purgados` creado |
| **Fase 4A** (R2-only, smoke) | gate Parte 0 = **0** · subida nueva → `r2_status='ok'`, `r2_key`/`sha` set, `ghl_url`/`local_path` NULL · sirve viejo y nuevo |
| **Fase B** (papelera/GC, smoke) | papelera 2 niveles OK sobre datos migrados · guardrail: huérfano en cuarentena con `R2=EXISTE(200)` clasificado bien |
| **VERIFICACIÓN FINAL** | `archivos_vivos`=**188.303** · `con_r2_ok`=**188.303 (100%)** · `vivos_sin_forma_de_servir`=**0** · `gate_parte0`=**0** · `respaldo_uploads`=**7.177** |

**Hallazgos/afinamientos capturados (wisdom):**
- `pg_restore` necesita `-d <conn>` (no la URL suelta) y NO `-n crm_tadi` (filtra el `CREATE SCHEMA`) → crear schema a mano + restore sin `-n`.
- Los scripts de datos están **blindados a `crm_staging`** (abortan si BD/bucket != staging) → para prod hay que parametrizar los guardas (§0.6). Es una salvaguarda, no un bug.
- Transitorios de R2/CDN (502 PUT, 524 GET) son normales bajo carga → re-correr idempotente hasta 0. **CORRECCIÓN (2026-08-04):** el bucket de prod **NO arranca vacío** — se **siembra por copia R2→R2** desde el bucket de staging (el set migrado y verificado del ensayo). El set es **100% GHL** (`assets.cdn.filesafe.space`; cero Zoho/Bitrix/Pipedrive en `drive_files`); sembrar evita re-descargar 157k objetos y protege contra 404 aguas arriba. Fase 1 en prod solo baja el **delta** posterior al backup (GHL vivo). Ver §0 Bloqueador 1.
- **Prod está vivo:** durante el ensayo aparecieron archivos nuevos en `/uploads` entre pasadas; los scripts idempotentes los absorbieron. En prod, el gate Parte 0 + re-run de Fase 1 cierran la ventana.
- Los 8.399 dups de 2b caen a `papelera` vía backfill de 0051 — normal, sin pérdida (sha compartido → objeto R2 preservado).
- **Artefacto de ensayo (no toca prod):** tras restaurar prod en staging, las sesiones de navegador viejas quedan inválidas (su `uploaded_by` no existe en los usuarios de prod → FK `drive_files_uploaded_by_fkey`) → re-loguearse con una cuenta de prod para los smokes de UI.

---

## 0-quater. ✅ Resultados de la corrida REAL a PROD (2026-08-04) — COMPLETADA

Migración Drive→R2 ejecutada de punta a punta contra producción (BD `postgres`, bucket `crm-tadi-prod`), guiada con Claude Code. **Sin incidentes; números por encima del ensayo (prod acumuló datos entre el backup y la corrida) y todos los invariantes cumplen.**

### Verificación final (gate de cierre)

| Métrica | PROD | Ensayo (vara) |
|---|---|---|
| archivos_vivos | **188.365** | 188.303 |
| con_r2_ok | **188.365 (100%)** | 188.303 (100%) |
| **sin_forma_de_servir** | **0** | 0 |
| ciclo activo / papelera | 188.365 / 8.410 | — |
| uploads_r2_backup | **7.220** | 7.177 |

### Cronología / resultados por fase (0 errores en todas)

- **Bloqueador 1** — bucket `crm-tadi-prod` sembrado por copia R2→R2 desde staging (token `crm-tadi-copia-rw`): **198.728 objetos / 102.184.406.485 bytes**; gate = `rclone size` idéntico a staging + `rclone check --one-way --size-only` = **0 differences**.
- **Creds prod** — `apps/api/.env` poblado con el token `crm-tadi-prod-rw` (`R2_BUCKET=crm-tadi-prod`). **Gotcha:** las 3 keys pegadas traían un **espacio final** (33/33/65 en vez de 32/32/64) → SigV4 habría fallado; se limpiaron con `sed`. Smoke `--prod --apply --limit=5` = 5 `exists` + hash R2==CDN OK.
- **Backup pre-cutover** — `/root/backup-prod-precutover-20260804-2321.dump` (193M, `pg_dump -n crm_tadi -Fc`).
- **Deploy** — PR **#16** `qa→prod` (`e03c991`), autodeploy OK (`crm-api`/`crm-frontend` reiniciados). **Gotcha:** el 1er deploy falló porque el `git pull` chocaba con `.mjs` **untracked** de trabajo previo en el checkout de prod → se movieron a `/root/_untracked-prod-backup-20260804-2341` y el re-run pasó.
- **Ola B (fix)** — commit `4060928` (rama `juan/scripts-prod-guard-r2`): los scripts R2 con `--prod` leen creds de **`apps/api/.env`** (no un `.r2-prod.env` nuevo, decisión del operador).
- **Migraciones (split)** — `mv` de 0050–0055 a `_migrations_hold` → `pnpm migrate` (**0045–0049**) → corridas de datos → devolver 0050–0055 → `pnpm migrate` (**0050–0055**). Prod **0044 → 0055**. La 0054 (GIN trigram) aplicó en ~segundos sin colgarse.
- **Fase 1** (bytes→R2) — inventario 157.759; **189.093 filas `r2_status='ok'` / 0 errores**. Casi todo `exists` (seed cubrió 100%), 1 solo `subido` (delta real), 108 sha calculados. Los 502 transitorios se liquidaron con la escalera de concurrencia **728 → 42 (c4) → 5 (c2) → 0 (c1)**.
- **Fase 2a** (consolidar) — **no-op** (`grupos con trabajo: 0`).
- **Fase 2b** (limpieza legacy) — `dedup=8.399` soft-deleted + **41.224 carpetas** podadas (rondas 20.698 + 20.526), 0 err. Re-DRY de cierre: `dup=0`, `rezagados=únicos=148.655`.
- **Fase 3a** (expediente /uploads) — **7.671 filas** + 1.482 carpetas de sección, `irresolubles=0`, 0 err (los 27 + 2 transitorios se reintentaron a c2→c1). `a_crear` real (7.671) < DRY (7.932): dedup por sha **dentro** de la corrida.
- **Fase 3b** (respaldo /uploads) — **7.220 filas** en `uploads_r2_backup` (chats ~6.5k, huérfanos 188, opps 382, tareas 61, avatars 15), 0 err (45 transitorios reintentados a c2).
- **VACUUM (ANALYZE)** `drive_files` + `drive_folders` (un `-c` por VACUUM: no corre dentro de transacción).
- **Leads→Clientes Parte B** (§5-bis) — `archivar-leads-sin-oportunidad.mjs --prod --apply --corrida=LEADS-CLEANUP-01`: **27.758 archivados** (activos 31.568 → **3.810** = 3.791 clientes + 19 referidores). Reversible.
- **Cierre** — `DRIVE_GC_ENABLED` **OFF** (GC destructivo apagado). Tokens R2: el operador **conservó** `crm-tadi-setup` (rolleado) y `crm-tadi-copia-rw` (decisión propia); la app corre con `crm-tadi-prod-rw`.

### Reversibilidad disponible

Backup DB (193M) + **objetos R2 nunca borrados** + **GHL intacto**. Reversas por corrida: `fase2-revert.mjs --prod --corrida=F2B-LIMPIEZA-LEGACY|F3A-UPLOADS-EXPEDIENTE` · `fase3b-uploads-respaldo.mjs --prod --revert=F3B-UPLOADS-RESPALDO` · `archivar-leads-sin-oportunidad.mjs --prod --revert=LEADS-CLEANUP-01`.

### Pendiente menor (post-cierre)

- **Smoke UI** end-to-end (descargar un archivo viejo + subir uno nuevo): la DB está verificada; queda confirmar el comportamiento de la UI.
- Limpieza opcional: `packages/db/_migrations_hold/` (ya vacío) y `/root/_untracked-prod-backup-20260804-2341/`.
- Seguridad (opcional, decisión pendiente del operador): revocar `crm-tadi-setup` / `crm-tadi-copia-rw`.

---

## 1. Orden de ejecución (cada corrida es reversible)

### Fase 1 — bytes a R2  ·  `scripts/migrar-storage-r2.mjs`
Subir los bytes de todos los `drive_files` (GHL-CDN + disco `local_path`) a R2. Deduplica por `sha256` (agrupa), calcula el sha de los que no lo tengan, es idempotente/reanudable por `r2_status`, y trae verificación por hash (R2 vs CDN, 3 muestras) al final. Correr con `--concurrency=6` en `screen`.
- **Qué esperar en PROD (técnico):** el bucket de prod se **siembra por copia R2→R2** desde staging (§0 Bloq. 1), así que **NO arranca vacío**: Fase 1 encuentra casi todo `exists` y solo sube el **delta** de archivos que entraron a prod después del backup (todo GHL vivo, `assets.cdn.filesafe.space`). Mucho más liviana que un re-fetch completo. *(El set de la migración es 100% GHL; no hay fuentes muertas en `drive_files` — Zoho/Bitrix/Pipedrive no están en esta tabla.)*
- **Transitorios normales bajo carga:** `PUT R2 fallo` (502) y `GET CDN fallo` (524 timeout de Cloudflare). NUNCA es bug del script. **Re-correr la misma pasada** (idempotente) hasta `errores=0`. Escalera que funcionó en el ensayo: `--concurrency=6` para el grueso → **bajar a 4 y luego 2** para liquidar la cola pegajosa de transitorios (menos concurrencia = menos 502). En el ensayo convergió 620→19→3→0.
- **Guarda / variante prod:** el script aborta si BD != `crm_staging` o bucket != `crm-tadi-staging` (§0.6). Para prod necesita la variante parametrizada (BD `postgres`, creds + bucket `crm-tadi-prod`) — **Ola B del Bloqueador 2**, pendiente.
- Verificar avance real en BD: `SELECT count(*) FILTER (WHERE r2_status='ok') ok, count(*) FILTER (WHERE r2_status='error') err FROM crm_tadi.drive_files WHERE deleted_at IS NULL AND (ghl_url IS NOT NULL OR local_path IS NOT NULL);` → cerrar con `err=0`.

### Fase 2a — consolidar carpetas de contacto  ·  `scripts/fase2a-consolidar-contactos.mjs` (corrida `F2A-CONSOLIDAR`)
dry → baseline invariantes (contact_apunta_a_perdedor / contactos_con_carpeta_doble) → apply → ambos = 0. Revert: `fase2-revert.mjs --corrida=F2A-CONSOLIDAR --apply`.
- **Qué esperar en PROD (técnico):** puede ser **no-op**. Consolida carpetas por "ganador de fusión", así que solo tiene trabajo si hubo dedup de contactos que dejó carpetas colgando de un perdedor. En el ensayo 2026-08-04 dio **0 trabajo** (prod tenía saneamiento aplicado en ~24.669 contactos pero solo **52 fusiones**, ninguna con carpeta colgante → invariantes ya en 0). 2a vacía = correcto para ese estado. **Si antes de prod se corre otra ronda grande de dedup de contactos**, 2a volvería a tener trabajo → re-testear.

### Fase 2b — limpieza árbol legacy «Tramites *»  ·  `scripts/fase2b-limpieza-legacy.mjs` (corrida `F2B-LIMPIEZA-LEGACY`)
dry (ver magnitud de carpetas — pueden ser decenas de miles) → apply → verificar `archivos_vivos` (−dedup), `rezagados_restantes` (= únicos preservados), `orphan_folders=0`. Preserva los únicos; solo dedup + poda de vacías.
- **Qué esperar en PROD (técnico, del ensayo 2026-08-04):** magnitud grande. `rezagados=157.054` · **dup a soft-delete=8.399** · **únicos preservados=148.655** · **carpetas custom vacías podadas=41.224** · errores=0. Verificación de cierre: re-correr el DRY tras el apply → `dup=0` y `rezagados=únicos` (solo quedan los preservados); `archivos_vivos` baja exactamente en el nº de dups. Todo reversible: `fase2-revert.mjs --corrida=F2B-LIMPIEZA-LEGACY --apply`.

### Fase 3a — expediente /uploads al Drive  ·  `scripts/fase3a-uploads-expediente.mjs` (corrida `F3A-UPLOADS-EXPEDIENTE`)
Requiere usuario super_admin (uploaded_by). dry → apply en `screen` → **reintentar por 502 transitorios hasta 0 errores**. Verificar `fase2_log` `crear_archivo` ≈ esperado.

### Fase 3b — respaldo completo /uploads  ·  migración `0049_uploads_r2_backup.sql` + `scripts/fase3b-uploads-respaldo.mjs` (corrida `F3B-UPLOADS-RESPALDO`)
`pnpm migrate` (crea `uploads_r2_backup`). dry → apply en `screen`. **`/uploads` es disco VIVO → los conteos bailan entre pasadas; cerrar con una pasada final de `errores 0`.** Revert: `fase3b-uploads-respaldo.mjs --revert=F3B-UPLOADS-RESPALDO`.

### Fase 4A — código Drive R2-only (deploy)  ·  rama `juan/fase4a-r2-only-drive`
1. Deploy del código por el pipeline (dev→qa→autodeploy).
2. Poblar `apps/api/.env` de prod con `R2_*` (paso 0.2) y `pm2 restart crm-api` (+ frontend). dotenv recarga.
3. **Parte 0 en PROD** (antes de confiar en R2-only): `SELECT count(*) FROM crm_tadi.drive_files WHERE deleted_at IS NULL AND ghl_url IS NOT NULL AND r2_key IS NULL AND local_path IS NULL;` — debe ser 0. Si >0, correr `migrar-storage-r2.mjs` sobre esa cola ANTES.
4. Validar: botón SUBIR habilitado, UI "Cloudflare R2", subir un archivo → fila con `r2_status='ok'`/`r2_key`/`sha256` y `ghl_url`/`local_path` NULL; servir el nuevo y uno viejo.

### Post-lotes — mantenimiento
`VACUUM (ANALYZE) crm_tadi.drive_files; drive_folders; fase2_log;` en ventana tranquila (las tablas quedan infladas tras los lotes).

---

## 2. Fase 5 — reconciliación y cutover (pendiente de diseño)
Reconciliación 100% (`count(r2_status='ok')` esperado; muestra abierta desde el CRM vía R2). GHL pasa a **solo-lectura/respaldo**; **NO se borra nada de GHL** (ni ahora ni en semanas). Pipedrive (34k archivos, bytes pendientes por acceso caducado) entra al mismo modelo cuando se tengan los bytes.

---

## 3. Guardrails / aprendizajes (de los ensayos en staging)
- **R2 502/500 transitorios** bajo carga → reintento idempotente hasta `errores 0`. NUNCA es bug del script.
- **Staging levemente viejo vs prod** (copia congelada) → toda clasificación se RE-CALCULA contra prod vivo; no hornear números de staging.
- **`/uploads` es disco vivo** → cerrar corridas con una pasada final `errores 0` + `a_respaldar` bajo (goteo normal).
- **Nunca borrar** objetos R2 (content-addressed, compartidos por sha) ni datos/objetos de GHL.
- **Credenciales** solo en `.env` (gitignored), rotadas antes de prod; el código lee 100% de `process.env` (cero hardcoding).
- **Consultas de verificación**: filtrar por columnas indexadas (id/PK, folder_id, oportunidad_id, r2_status) — `nombre` no está indexado y con bloat hace seq scan lentísimo.
- **Prod sigue VIVO durante la corrida** (GHL recibe archivos nuevos a diario; contactos/oportunidades cambian). El proceso lo absorbe, no lo ignora: (a) **Fase 1 es idempotente** y se RE-CORRE hasta que la cola GHL-only (`r2_status<>'ok'`) baje a los últimos que entraron mientras corría; (b) el gate **Parte 0 de Fase 4A** exige **0** archivos GHL-only sin `r2_key` ANTES del cutover — si >0, correr `migrar-storage-r2.mjs` sobre esa cola primero; (c) una vez desplegado 4A (R2-only), los uploads nuevos van **directo a R2** y el inflow por GHL deja de ser un tema. La clasificación de contactos/carpetas se RE-CALCULA contra la foto del día (nada horneado). *En el ensayo §0-bis esto no aplica igual: es una foto puntual al bucket de staging, sin cutover real — solo valida el proceso.*


---

## 4. Ciclo de vida del Drive (naming / papelera) — post-migración

> Estos cambios de CÓDIGO van por el pipeline dev→qa. En PROD se despliegan **DESPUÉS** de la corrida de migración de datos (Fase 1–3b), porque la migración usa el índice único de sha.

### Fase A — naming `(N)` + fix re-upload (LISTA, ensayada en staging)
- Migración **0050**: `DROP INDEX drive_files_dedup_idx` (único sha) + `CREATE INDEX idx_drive_files_folder_nombre` (no-único). Aplicar con `pnpm migrate` **después** de las corridas de datos.
- Deploy del código `juan/fase-a-drive-naming` (auto-renombrado por carpeta + advisory lock). Grandfather: no renombra lo existente.
- Validar: misma carpeta → `(1)`; carpetas distintas → mismo nombre; borrar+re-subir → OK.

### Fase B1 — papelera de dos niveles (LISTA, ensayada en staging)
- Migración **0051**: columnas `ciclo`/`purgar_en`/`conservado_en`/`conservado_por`/`origen_ref` en `drive_files` + índice `(ciclo, purgar_en) WHERE ciclo='cuarentena'`; backfill `deleted_at → ciclo='papelera'`.
- Backend `drive-routes.ts`: borrar → papelera; vaciar/borrar-de-papelera → cuarentena (`purgar_en = now()+30d`); restaurar-a-origen (cascada → General del contacto → "Sin ubicación", con `(N)`); conservar. **Nunca** se borra un objeto R2 en B1.
- **Fase B1b**: los `drive_files` en cuarentena/conservado se muestran en "Archivos sin identificar" (`/api/uploads/sin-identificar` unifica disco `uploads_cuarentena` + drive). Ramas `juan/fase-b1-papelera`, `juan/fase-b1b-cuarentena-en-sin-identificar`. Validado en staging.

### Fase B2 — GC + borrado permanente (VALIDADA en staging 2026-08-03)
- Migración **0055**: `drive_files_purgados` (bitácora append-only: `drive_file_id, sha256, r2_key, nombre, ciclo, origen[gc_purga|manual], r2_deleted, disk_deleted, borrado_por, created_at`). Rama `juan/fase-b2-gc-papelera` (código `1f9e932`), en dev/qa/staging.
- Núcleo `purgeDriveFiles(ids, {origen, borradoPor})`: tx = INSERT bitácora + hard DELETE de las filas → luego, por cada sha distinto, borra el objeto R2 **solo si es huérfano** (`shaHuerfano`: 0 refs en `drive_files` cualquier ciclo AND 0 en `uploads_r2_backup`), **re-verificando el orphan justo antes de cada `deleteObject`** (cierra la microventana con uploads concurrentes). v1 NO toca disco.
- Dos disparadores, mismo núcleo: endpoint admin `DELETE /api/drive/trash/purge/file/:id` (`origen='manual'`, solo ciclo cuarentena/conservado) y loop `startDriveCuarentenaGcLoop` (`origen='gc_purga'`) **detrás de env, default OFF** (`DRIVE_GC_ENABLED`, `DRIVE_GC_DRYRUN`, `DRIVE_GC_INTERVAL_MS`).
- **VALIDACIÓN CON DATOS REALES (staging, guardrail R2)** vía `scripts/b2-verificar-manual.mjs` (modos `candidatos`/`auditar`/`vencer`, con **HEAD independiente a R2** — no confía en el flag):
  - Manual · **preservar**: borrar una copia de un objeto compartido (pikachu, refs_drive>1 + refs_backup>0) → `r2_deleted=false`, R2 `HEAD=200` (objeto intacto).
  - Manual · **borrar**: borrar un huérfano limpio (refs_drive=1, refs_backup=0) → `r2_deleted=true`, R2 `HEAD=404` (objeto borrado).
  - Loop · **DRY-RUN** (`DRIVE_GC_DRYRUN=1`): ve el candidato vencido y NO borra nada.
  - Loop · **real** (`origen='gc_purga'`): `purgadas=1 objetosR2=1 preservados=0`; `auditar` confirma `r2_deleted=true` + R2 `HEAD=404`.
  - **`✅ 0 FUGAS` en todos los casos:** nunca se borró un objeto con referencias vivas.
- **En PROD:** desplegar el código con el resto de Fase B; correr `pnpm migrate` (0055); el loop arranca **apagado** (`DRIVE_GC_ENABLED` sin setear) hasta decidir prenderlo. Ver `docs/DISENO-DRIVE-CICLO-ARCHIVOS.md` §5. **Fase B3** (UI de papelera/cuarentena unificada con tabs) cubierta por B1 + el sprint de paginación.

### Sprint de paginación + filtros del Drive (UX/perf — código, va por pipeline dev→qa)
- **Sprint CERRADO (2026-08-03), en dev/qa/staging.** Migraciones **0052** (papelera), **0053** (archivos por carpeta), **0054** (pg_trgm + GIN trigram sobre `lower(nombre)` de `drive_folders`/`drive_files` + btree `(parent_id,nombre)`) — idempotentes, no destructivas. **NOTA PROD:** el GIN trigram bloquea escrituras al construirse (runner en transacción → sin `CONCURRENTLY`); en prod construir en ventana de mantenimiento o a mano con `CONCURRENTLY`. Verificado con `EXPLAIN`: papelera/archivos usan sus índices; búsqueda peor caso (scope=root, ~28k) = 122ms.
- Entregas (todas cerradas): sin-identificar, Papelera (E1), Archivos-por-carpeta (E2), Subcarpetas+búsqueda-carpetas (E3A), Árbol lateral lazy con visibilidad por-nodo validada por harness (E3B), Búsqueda scopeada al subárbol (E3C). Detalle y commits en `CHECKPOINT-MAESTRO.md`.
- **Recordatorio:** las migraciones son paso MANUAL post-deploy (`pnpm migrate`); el autodeploy NO las corre.

### Orden de migraciones en PROD (split completo, prod en 0044)
**Antes** de las corridas de datos: **0045** (archivado_basura_log) → **0046** (columnas R2 del drive: `r2_key/r2_status/r2_etag/sha256`) → **0047** (folder tipo contact) → **0048** (contactos_rescate_log) → **0049** (`uploads_r2_backup`). Estas dan el esquema que Fase 1–3b necesitan (Fase 1 escribe `r2_*` de 0046; Fase 3b usa 0049).
**Después** de las corridas de datos (Fase 1–3b, que usan el índice único de sha): **0050** (naming, dropea el índice único sha) → **0051** (ciclo papelera) → **0052** (índice papelera) → **0053** (índice archivos por carpeta) → **0054** (pg_trgm + GIN trigram para búsqueda; ver NOTA PROD del sprint) → **0055** (`drive_files_purgados`, bitácora de borrado permanente — Fase B2).
> Técnica del ensayo para el split: `mv packages/db/migrations/005{0..5}_*.sql` a una carpeta hold antes de correr `pnpm migrate` (aplica 0045–0049), y devolverlos después de las corridas de datos para el segundo `pnpm migrate` (0050–0055). NO olvidar devolverlos.

---

## 5-bis. Frente Leads → Clientes (gate de sincronización + limpieza)  ·  rama `juan/leads-clientes`

> **Antesala/paralelo a la migración** (decisión: **antes** de la corrida a prod, para pasar la página con la lista limpia). Independiente y reversible.

**Problema.** GHL se usa para captar y trabajar leads; solo los que tienen una **oportunidad/negociación** (cualquier etapa) son clientes reales. Hoy CADA contacto creado en GHL entra a TADI al instante → la lista está llena de basura. Medido en el ensayo (foto fresca de prod): **31.561 activos · 3.789 clientes con oportunidad · 27.753 leads sin oportunidad (88%)**. **Confirmado sobre prod VIVO (DRY `--prod`, 2026-08-04):** 31.567 activos · 3.791 clientes · 19 referidores · **27.757 a archivar → lista resultante 3.810** (3.791 + 19). La deriva vs. el ensayo (+4 a archivar, +2 clientes) es el prod vivo: leads/opps que entraron entre el respaldo y hoy — medido, no estimado.

**Definición.** Cliente = contacto con ≥1 oportunidad. Lead = 0 oportunidades. Se conservan además los **referidores** (proxy de "familiares" hasta que exista ese sistema).

**Cómo entra la basura — diagnóstico REAL (verificado con datos 2026-08-04).** NO es el webhook (`ghl_webhooks_recibidos` tiene solo **2 eventos** en total). El chorro son **cron scripts** que pullean TODOS los contactos de GHL a `contactos_cache`: **`pull-ghl-contacts.mjs`** (diario 02:00, bulk completo) y **`sync-contactos-recientes.mjs`** (*/30, goteo continuo) — ambos hacían `INSERT ... ON CONFLICT`. (99.9% de contactos con `ghl_contact_id`; bulk inicial el 2026-06-22.) Las oportunidades hoy se crean **a mano en TADI** por los vendedores (opps recientes con `ghl_id=0`, sin marca Setter) → por eso hace falta el buscador GHL (A.2). El webhook "Cliente ganado" del Setter existe pero es minoritario (9 opps). *(`ghl-catchup.mjs` opera sobre `public.users` de la app ciudadanía — NO toca TADI.)*

**Parte A — código (rama `juan/leads-clientes`). CODE-COMPLETE + auditado.**
- **A.1** (`0928cc1`): webhook genérico `ContactCreate/Update` → **update-only** (`actualizarContactoDesdeGhlSiExiste`: si existe actualiza, si no existe loguea `skipped` y no inserta); `pullOportunidadesRecientes` importa el contacto al crear la oportunidad (nunca `contacto_id=NULL`). Cierre defensivo (el webhook casi no dispara hoy).
- **A.3** (`eb360e2`): **el gate real del flood** — `pull-ghl-contacts.mjs` + `sync-contactos-recientes.mjs` pasan a **UPDATE-only** (`UPDATE crm_tadi.contactos_cache AS c ... FROM (VALUES …) v WHERE c.ghl_contact_id = v.ghl_contact_id::text`): solo refrescan clientes existentes, no insertan leads. SQL validado en staging (`UPDATE 1`, el id inexistente no crea nada). Quitado el corte `nuevos===0` de sync-recientes (bajo update-only pararía en pág. 1).
- **A.2** (`3e129bd`): `GET /api/ghl/contactos/buscar` + `POST /api/ghl/contactos/importar` (admin) + modo "Buscar en GHL" en `ContactoPicker` del modal de crear oportunidad (badges Nuevo/Ya en TADI/Archivado). Además **desarchiva en TODA vía de promoción** (`POST /api/oportunidades`, webhook Cliente ganado, pull loop, e `importar`): un contacto con oportunidad no puede quedar invisible. *(Nota menor: `importar` no resuelve `COALESCE(fusionado_en_contacto_id,id)` — borde raro de fusionados; endurecer opcional.)*
- No se toca `POST /api/contactos` (creación manual) ni `upsertContactoDesdeGhl`.

**Parte B — datos (limpieza). Validada en staging + `--prod` LISTO.** `scripts/archivar-leads-sin-oportunidad.mjs` (`be6f851` + parametrización `--prod` en `juan/scripts-prod-guard`, mergeada). Archiva reversible (`archivado=true` + `archivado_motivo='lead_sin_oportunidad:<corrida>'`, revert `--revert=<corrida>`) los contactos con 0 oportunidades y no-referidores. **NO borra nada.** El guard `--prod` (Bloqueador 2, Ola A) ya conmuta a BD `postgres`. Ensayo 2026-08-04: **27.753 archivados → lista 3.808**. DRY `--prod` sobre prod vivo (2026-08-04): **27.757 a archivar → lista 3.810** (3.791 clientes + 19 referidores).

**Dónde se prueba qué.** Staging NO tiene creds GHL → el buscador/importar (A.2), el webhook y los cron **no se ejercitan ahí**; sí se valida build + el desarchivado (SQL). El end-to-end GHL se prueba en **prod** (aditivo, solo-admin, read-only sobre GHL / import controlado → bajo riesgo).

**Secuencia en PROD (orden obligatorio).** 1) merge `juan/leads-clientes` → dev → qa (autodespliega a la caja de staging, NO prod); 2) deploy a prod por pipeline → los cron ya corren update-only + buscador disponible; 3) **recién ahí** correr Parte B (con `--prod`, Bloqueador 2); 4) opcional: retirar `sync-contactos-recientes` del crontab. **Si se archiva (B) antes de desplegar A, el pull vuelve a llenar la lista.** Encaja como paso de la antesala (§0), antes de la corrida Drive→R2.

---

## 6. 🔴 Módulo CONTACTOS — el interruptor del borrado en GoHighLevel (`GHL_MERGE_DELETE_ENABLED`)

> **Cuándo se ejecuta este paso:** al desplegar a producción el módulo de contactos (Olas 0–3), es
> decir, con el PR `qa → prod` que arrastra la fusión de duplicados. **Antes de que el pipeline
> despliegue**, no después.

**Qué está en juego.** Al fusionar dos contactos, el CRM hace dos cosas en GHL: actualiza el maestro
(`PUT`, inofensivo) y **elimina el perdedor** (`DELETE`). Ese `DELETE` es la **única operación
destructiva del proyecto contra un sistema de terceros** y es **irreversible**: GHL no permite
desborrar un contacto, y con él se van sus conversaciones, tags e historial. No espera a ningún
reconciliador: sale **en línea, dentro del request de fusión**, en el instante en que alguien pulsa
Fusionar (`contactos-routes.ts` → `encolarFusionGhl`).

⚠️ **`GHL_SYNC_ENABLED` no protege de esto.** Solo apaga el *pull loop*. Nunca tuvo nada que ver con
el borrado, y creer lo contrario es el error caro de esta sección.

### Qué hay que decidir, y quién

| | |
|---|---|
| **La decisión** | Si producción borra o no el contacto perdedor en GHL al fusionar. |
| **Quién la toma** | Juan David Duque (PM), que es quien aprueba el PR `qa → prod`. No es una decisión técnica: es de negocio, porque destruye datos de la cuenta real de la empresa. |
| **Prerrequisito para poder decir que SÍ** | 🔴 **Nadie ha comprobado nunca que el token tenga permiso de `DELETE /contacts/{id}`.** GHL no tiene entorno de pruebas —es un único sistema, el real— y staging no tiene credenciales, así que es inverificable fuera de producción. Para cerrarlo hace falta un contacto de prueba **propio** creado en GHL (nunca uno de cliente) o una *location* aparte. Detalle en `CHECKPOINT-CONTACTOS.md §10.3`. |

### Qué hay que poner en el `.env` de producción

En `/root/crm-tadi/apps/api/.env`:

```bash
# El borrado del perdedor en GHL al fusionar. Por defecto NO borra.
GHL_MERGE_DELETE_ENABLED=false
```

**Y qué pasa si no se pone: no se borra.** El valor por defecto en el código es `false` y es un
fail-safe deliberado — un entorno donde nadie tocó esta variable no puede destruir nada por
descuido. Escribirla explícitamente en `false` no cambia la conducta; sirve para que quien lea el
`.env` dentro de seis meses vea que **fue una decisión** y no un olvido.

**Recomendación al promover: dejarlo en `false`.** El módulo se despliega igual y funciona: las
fusiones se hacen en el CRM, el maestro se actualiza en GHL, y lo único que no pasa es el borrado —
el duplicado sigue vivo allá hasta que se decida. Encenderlo puede hacerse después, sin redeploy de
código, editando el `.env` y reiniciando por el pipeline. Al revés no: lo borrado no vuelve.

### Cómo se comprueba que quedó como se quería

```bash
# El proceso lo dice en voz alta al arrancar. No imprime ninguna credencial.
pm2 logs crm-api --lines 200 --nostream | grep 'merge-ghl'
#  DESACTIVADO → "[merge-ghl] borrado del perdedor en GHL DESACTIVADO (GHL_MERGE_DELETE_ENABLED!=true): …"
#  ACTIVADO    → "[merge-ghl] 🔴 borrado del perdedor en GHL ACTIVADO (GHL_MERGE_DELETE_ENABLED=true): …"
```

Y en la base, tras la primera fusión que se haga en prod:

```sql
select operacion, estado, intentos, left(ultimo_error, 90) as motivo, ejecutado_at
  from crm_tadi.ghl_merge_cola order by created_at desc limit 4;
```

Con el interruptor **apagado**, lo correcto es ver `actualizar_maestro` en `ok` y
`eliminar_perdedor` en **`omitido`**, con un motivo que nombre `GHL_MERGE_DELETE_ENABLED` y
`ejecutado_at` en `NULL`. Si aparece en `pendiente`, algo va mal: estaría reintentando un borrado
que nunca debe salir. Si aparece en `ok`, peor: se borró.

### Checklist del paso

- [ ] Decidido el valor con el PM, y anotada la fecha de la decisión.
- [ ] `GHL_MERGE_DELETE_ENABLED` escrita explícitamente en `/root/crm-tadi/apps/api/.env`.
- [ ] Copia del `.env` con sufijo de fecha antes de tocarlo (§ regla de backup de `CONVENCIONES §6.5`).
- [ ] Tras el deploy, el log de arranque dice el estado esperado.
- [ ] Tras la primera fusión en prod, `ghl_merge_cola` muestra lo que corresponde al estado elegido.
- [ ] Si se dejó en `false`: anotado en `CHECKPOINT-CONTACTOS.md §10` qué falta para poder encenderlo.
