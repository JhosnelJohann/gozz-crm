# Diseño — Ciclo de vida de archivos del Drive (naming `(N)` + papelera de 2 niveles + GC R2)

> **Estado:** 🟢 aprobado — Fase A + B1 + B1b + **B2 (GC/borrado permanente)** IMPLEMENTADAS y validadas en staging con datos reales (guardrail R2 probado por ambas vías). **Última actualización:** 2026-08-03.
> **Alcance:** subsistema de archivos del Drive (subir, nombrar, borrar, restaurar, purgar) + su UI.
> **Contexto:** el CRM ya opera R2-only (Fase 4A). Se detectó que borrar un archivo **bloquea re-subirlo**
> (índice único por `sha`), y que el Drive no se comporta como un drive normal (identidad por contenido en
> vez de por nombre). Este diseño lo arregla y agrega una papelera con dos niveles de recuperación.

---

## 1. Decisiones tomadas (Juan)
- **Identidad por NOMBRE, no por contenido.** Se permite subir el mismo contenido varias veces; la colisión
  se resuelve por **auto-renombrado `(N)`** (estándar Google Drive / Chrome / Windows).
- **Grandfather de lo existente (Opción A).** NO se renombran los ~45.275 archivos migrados con nombre
  repetido (pre-existentes, funcionales, herencia de la migración que dedupó por sha). Solo se previenen
  colisiones **nuevas**. Sin índice único duro de nombre; concurrencia por **advisory lock**.
- **El sha se conserva** para R2 (content-addressing / dedup de bytes). Solo se retira el **índice ÚNICO**
  `(folder_id, sha256)`.
- **Papelera de dos niveles**, restaurar-a-origen, borrado permanente solo al final, con guardrail de R2.

---

## 2. Auto-renombrado `(N)` (naming)
**Regla:** al subir, si `nombre` ya existe **vivo** en la carpeta destino → separar `base` + `ext` (ext = desde
el último punto), y usar el primer `base (N).ext` libre (menor N≥1). Formato: espacio + `(N)` entre base y ext
(`pikachu (1).png`). Sin extensión → `README (1)`. Nombre que ya trae contador → literal (`pikachu (1) (1).png`).
Comparación **case-insensitive**.

**Concurrencia:** durante la resolución del nombre + el INSERT, tomar un **advisory lock** de Postgres
(`pg_advisory_xact_lock(hashtext(folder_id || '/' || base_lower))`) para serializar subidas del mismo nombre a
la misma carpeta. Sin lock, dos subidas simultáneas podrían tomar el mismo `(N)`.

**Grandfather:** los nombres repetidos existentes NO se tocan. La resolución `(N)` solo corre en subidas nuevas.
Se agrega un índice **no-único** `(folder_id, lower(nombre))` para buscar colisiones rápido. (Opción futura:
un normalizador reversible admin-triggered con preview, si algún día se quieren nombres 100% limpios.)

---

## 3. Retiro del índice único de sha
- **Qué:** eliminar `drive_files_dedup_idx (folder_id, sha256) WHERE sha256 IS NOT NULL` (mig. 0025).
- **Por qué:** prohíbe dos archivos con el mismo contenido en la misma carpeta → bloquea el re-upload y el
  comportamiento de drive normal. La identidad ahora es por nombre.
- **Se conserva:** la columna `sha256` y el índice no-único `idx_drive_files_sha256` (mig. 0046) + el
  content-addressing de R2. Subir pikachu dos veces = dos filas, **un objeto** en R2.
- **Timing (crítico):** el índice único de sha **lo usan las corridas de migración** (detectan duplicados por
  ese índice). Por eso: en **prod** se retira **DESPUÉS** de la corrida de migración; en **staging** (migración
  ya ensayada) se retira con este cambio. Queda en el orden del RUNBOOK.

---

## 4. Papelera de dos niveles (restaurar-a-origen)
**Idea clave:** la papelera NO es una carpeta física por entidad — es un **estado** del archivo, que conserva
su `folder_id` de origen. UNA papelera lógica, mostrada filtrada por contexto (oportunidad / contacto / Mi
Drive). Restaurar = volver a su carpeta original.

**Ciclo de vida del archivo:**

| Estado | Cómo llega | Restaurar | Se va a… |
|---|---|---|---|
| **activo** | vivo en su carpeta | — | — |
| **papelera** (Nivel 1) | el usuario borra | → a su carpeta de origen (con `(N)` si el nombre colisiona al volver) | activo |
| **cuarentena** (Nivel 2) | se vacía la papelera / se borra un ítem de la papelera → contador **30 días** | → a su carpeta de origen | activo |
| **conservado** (Nivel 2) | admin "Conservar" en cuarentena → sin vencimiento | → a su carpeta de origen | activo |
| *(purgado)* | 30 días en cuarentena, o "Eliminar" manual | — | **borrado permanente** (ver §5) |

- **Restaurar siempre vuelve al ORIGEN**, nunca a la papelera. Si la carpeta de origen ya no existe → fallback
  (General del contacto si se puede resolver; si no, queda como "sin identificar" para reasignación manual admin).
- **Nivel 1 (papelera)** es de uso normal del usuario. **Nivel 2 (cuarentena/conservados)** es la red de
  seguridad, solo admin/super_admin (como la vista "Archivos sin identificar" hoy).

**Esquema (en `drive_files`, no en la tabla legacy de disco):**
- `deleted_at`, `deleted_by` (ya existen) — marcan no-activo.
- `ciclo text default 'activo'` check in (`activo`,`papelera`,`cuarentena`,`conservado`).
- `purgar_en timestamptz` — vencimiento de cuarentena (fecha de vaciado + 30 días); NULL en otros estados.
- `conservado_en`, `conservado_por` — auditoría de "Conservar".
- El **origen** es `folder_id` (el soft-delete no lo mueve). Para robustez ante carpeta borrada, guardar al
  borrar un `origen_ref` mínimo (contacto_id / oportunidad_id / seccion) para el fallback de restauración.

> La tabla legacy `uploads_cuarentena` (mig 0040) es de **disco/`/uploads`** — se deja como está para los
> huérfanos legacy. La vista "Sin identificar / Conservados" se **extiende** para mostrar también los
> `drive_files` en `cuarentena`/`conservado` (que tienen origen conocido → restauran a origen).

---

## 5. Borrado permanente + GC + guardrail R2
- **Cuándo:** un archivo en `cuarentena` que pasa `purgar_en` (GC automático), o "Eliminar" manual desde
  cuarentena/conservados (admin).
- **Qué se hace:** borrar la fila de `drive_files` (o marcarla) + **registrar en la bitácora** (`uploads_borrados`
  o equivalente) + borrar el objeto R2 **SOLO si ninguna otra fila viva/conservada usa ese `sha256`**
  (content-addressed, compartido). Si otra fila lo usa → NO se borra el objeto (se romperían esos archivos).
- **GC job:** un loop/cron (patrón de los que ya existen, p.ej. `startGhlPendingContactsLoop`) que corre las
  purgas de cuarentena vencida, con la verificación de sha-huérfano antes de tocar R2.
- **Regla dura:** "si un archivo se elimina de cuarentena/sin-identificar, es historia pasada" — no se busca
  más ni en DB ni en R2. Pero **nunca** se borra un objeto R2 que otra fila siga usando.

---

## 6. Cambios de esquema (migraciones)
1. **DROP** `drive_files_dedup_idx` (único de sha). *(timing §3)*
2. **CREATE INDEX** no-único `idx_drive_files_folder_nombre` on `(folder_id, lower(nombre)) WHERE deleted_at IS NULL`.
3. **ALTER** `drive_files` ADD `ciclo` / `purgar_en` / `conservado_en` / `conservado_por` / `origen_ref` (según §4).
4. Índice para el GC: `(ciclo, purgar_en)`.

> Numeración: próximas disponibles (0050+), idempotentes, registradas en `BASE-DE-DATOS.md`.

---

## 7. Cambios de código
**Backend (`drive-routes.ts` + helpers):**
- **Upload:** resolver nombre con auto-`(N)` bajo advisory lock; INSERT sin depender del índice de sha (se
  retira el catch de `dedup_idx`). Sigue R2-primero → disco de emergencia.
- **Borrar (soft):** a `papelera` (Nivel 1).
- **Vaciar papelera / borrar ítem de papelera:** a `cuarentena` (setear `purgar_en = now()+30d`), NO borrado
  físico.
- **Restaurar** (papelera y cuarentena/conservados): volver a `folder_id` de origen (o fallback), con `(N)`.
- **Conservar:** cuarentena → conservado (limpiar `purgar_en`).
- **Eliminar permanente** (admin, desde cuarentena/conservados): fila + bitácora + R2 GC (§5).
- **GC loop:** purga de cuarentena vencida.
- **Listados:** papelera por contexto (Nivel 1) y cuarentena/conservados (Nivel 2, admin).

**Frontend:**
- Vista de **papelera** por oportunidad/contacto/Mi Drive con restaurar.
- "Sin identificar / Conservados" extendida con los `drive_files` en cuarentena/conservado (+ acciones
  restaurar / conservar / eliminar).
- El auto-renombrado es transparente en la subida (el usuario ve el nombre final `(N)`).

---

## 8. Reversibilidad / guardrails
- Retiro de índice y ALTER ADD COLUMN: no destructivos (no borran datos).
- Grandfather: cero cambios a los 45k nombres existentes.
- **Nada se borra físico salvo el nivel final** (cuarentena vencida / eliminar manual), y **nunca** un objeto
  R2 compartido por sha.
- Toda purga queda en bitácora (`uploads_borrados`).

---

## 9. Fases de implementación (estado)
- **Fase A — naming `(N)` + fix re-upload:** ✅ IMPLEMENTADA (mig **0050**; rama `juan/fase-a-drive-naming`). Grandfather: no renombra lo existente.
- **Fase B1 — papelera de 2 niveles (backend + UI):** ✅ IMPLEMENTADA (mig **0051**). Estados activo→papelera→cuarentena(30d)/conservado; restaurar-a-origen; conservar. Nunca borra R2.
- **Fase B1b — cuarentena del Drive en "Archivos sin identificar":** ✅ IMPLEMENTADA. La vista unifica disco (`uploads_cuarentena`) + drive (`drive_files` en cuarentena/conservado).
- **Fase B2 — GC + borrado permanente + guardrail R2:** ✅ VALIDADA en staging (2026-08-03). Mig **0055** (`drive_files_purgados`). Núcleo `purgeDriveFiles` (bitácora + hard delete → borra R2 **solo si sha huérfano**, re-verificando justo antes del `deleteObject`). Dos disparadores: endpoint admin `DELETE /api/drive/trash/purge/file/:id` (`origen='manual'`) y loop `startDriveCuarentenaGcLoop` (`origen='gc_purga'`, detrás de env, default OFF). **Guardrail probado con datos reales** (`scripts/b2-verificar-manual.mjs`, con HEAD independiente a R2): preservar objeto compartido (`r2_deleted=false`, R2 200) y borrar huérfano (`r2_deleted=true`, R2 404), por vía manual y por loop (DRY-RUN + real) → **`✅ 0 FUGAS`**. Ver §5.
- **(Track paralelo) Paginación + filtros del Drive** (UX/perf): ✅ CERRADO (2026-08-03). Todo el Drive paginado (sin-identificar, papelera, archivos por carpeta, subcarpetas, árbol lateral lazy) + búsqueda scopeada por subárbol; la visibilidad del árbol lazy se validó por harness (`✅ IGUALDAD TOTAL`). Migs **0052/0053/0054**. Detalle en `CHECKPOINT-MAESTRO.md`.

## 10. Secuencia con la migración a prod
En **prod**: correr la migración de datos (Fase 1–3b, que usa el índice de sha) → **luego** desplegar Fase A
(retiro sha + naming) → Fase B. En **staging** (migración ya ensayada) se implementa/prueba ahora.
