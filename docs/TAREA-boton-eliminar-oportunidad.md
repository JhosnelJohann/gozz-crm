# Tarea — Botón de eliminación de oportunidades (con salvaguardas)

> **Prioridad:** 🔴 ALTA · **Estado:** §1 y §2 resueltos en GOZZ (2026-09-05); §3 y el resto del
> alcance (botón en UI, modal de confirmación) siguen pendientes.
> **Origen:** detectado el 2026-07-13 durante la Etapa 4 (borrado en cascada de archivos), en crm-tadi.
> **Nota:** el de **seguridad (§1) ya estaba resuelto** en
> `apps/api/src/modules/oportunidades/oportunidades.routes.ts` — el DELETE valida `nivel_acceso`
> (`super_admin`/`admin`) antes de borrar. El de **estabilidad (§2) se corrigió** con la migración
> `0003_tareas_cascade_on_oportunidad_delete.sql`: la FK `gozz.tareas_oportunidad_id_fkey` ahora tiene
> `ON DELETE CASCADE` (opción **(a)** de las 3 propuestas abajo), verificado con una transacción de
> prueba y con el suite completo (531/531) en verde. El punto §3 (Drive/GHL) ya no aplica tal cual:
> GOZZ no tiene integración con GoHighLevel y el Drive es R2-only (ver
> `DISENO-DRIVE-CICLO-ARCHIVOS.md`) — la pregunta pendiente ahí es la misma pero con el bucket R2.

---

## Contexto

Hoy **no existe botón en la UI** para eliminar una oportunidad. El endpoint `DELETE /api/oportunidades/:id`
sí existe (`apps/api/src/index.ts:647`), pero tiene problemas serios.

## 🔴 Problemas detectados (ya presentes en prod)

### 1. Seguridad — cualquiera puede borrar una oportunidad
```ts
app.delete("/api/oportunidades/:id", requireAuth, ...)   // ← solo valida que esté logueado
```
**No hay chequeo de rol.** Un usuario con rol `usuario` puede borrar **cualquier** oportunidad llamando la
API directamente (curl / consola del navegador). La UI no lo expone, pero la puerta está abierta.
→ **Hay que restringirlo a `admin` / `super_admin` en el BACKEND** (ocultar el botón no basta).

### 2. Bug — el borrado FALLA si la oportunidad tiene tareas vinculadas
```sql
tareas.oportunidad_id UUID REFERENCES gozz.oportunidades(id)   -- ⚠️ sin ON DELETE
```
Sin `ON DELETE CASCADE` ni `SET NULL`, PostgreSQL **bloquea el DELETE** con violación de clave foránea.
Resultado: borrar una oportunidad con **una sola tarea vinculada** revienta con un 500.

**Decisión pendiente** (elegir una):
- **(a)** Borrar las tareas junto con la oportunidad (con sus archivos) — *recomendado: sin la oportunidad
  no tienen sentido*. Requiere borrarlas en la app antes del DELETE, o migrar la FK a `ON DELETE CASCADE`.
- **(b)** Bloquear el borrado si hay tareas (obligar a resolverlas primero).
- **(c)** Desvincularlas (`SET NULL`), dejando la tarea huérfana de oportunidad.

### 3. Drive — los documentos quedan huérfanos en R2
La carpeta de Drive y las filas de `drive_files` **sí** se borran en cascada, pero los **archivos físicos
viven en Cloudflare R2** (ver `DISENO-DRIVE-CICLO-ARCHIVOS.md`) y quedarían huérfanos allá. El módulo
Drive está fuera del alcance de la reorganización de `/uploads`.

**Decisión pendiente:** ¿solo advertir en el modal, o también borrarlos del bucket R2?

---

## Qué hay que construir

### Backend
1. **Restringir el DELETE a `admin` / `super_admin`** (validación en backend). ← *fix de seguridad, se puede
   hacer de inmediato y por separado.*
2. **Manejar las tareas vinculadas** según la decisión tomada (posible migración de la FK).
3. **Endpoint de "preview de eliminación"** — devuelve, para poblar el modal:
   - Archivos de la oportunidad (notas, pagos: comprobantes/firma/documentos, análisis IA) con `url`,
     `filename`, `mime` y de dónde vienen.
   - Tareas vinculadas (cantidad + listado).
   - Documentos del Drive (para el aviso).
4. Investigar el manejo de los documentos de Drive/R2.

### Frontend
1. **Botón "Eliminar oportunidad"** — visible **solo** para `admin` / `super_admin`, en el área de
   *Finalizar oportunidad*, **visualmente diferenciado** (destructivo, separado del resto) para evitar
   clics accidentales.
2. **Modal de confirmación** (estilo alert, consistente con los del sistema), que:
   - Advierta que la acción es **IRREVERSIBLE** y que se eliminarán **todos los documentos**.
   - Muestre **miniaturas de los anexos** (imágenes / PDF / documentos) con **vista previa**.
   - Avise si hay **tareas vinculadas** y qué pasará con ellas.
   - Avise sobre los **documentos del Drive**.
   - Exija escribir la palabra **`ELIMINAR`** (en mayúsculas) para habilitar el botón de confirmación.

---

## Nota adicional (futuro)

Agregar un **nuevo tipo de solicitud** para que los usuarios normales puedan **pedir** la eliminación de una
oportunidad, con aprobación de un admin — siguiendo el patrón de las solicitudes ya existentes
(monto, descuento, pago).

---

## Lo que YA está resuelto (referencia)

- **El borrado en cascada de ARCHIVOS ya está implementado** (Etapa 4a): el endpoint recolecta las URLs de
  notas, pagos, solicitudes y análisis IA **antes** del DELETE y las borra si quedan sin referencia
  (`deleteUploadsIfUnreferenced`). Cuando el botón exista, la limpieza de archivos ya funciona.

- **FKs hacia `oportunidades`** (verificadas):
  | Tabla | ON DELETE |
  |---|---|
  | `oportunidades_notas`, `oportunidades_pagos`, `oportunidad_*_solicitudes`, `oportunidad_tramites`, `drive_folders`, `pipeline`/`puntajes` | `CASCADE` ✅ |
  | `emails` | `SET NULL` ✅ |
  | **`tareas`** | **sin ON DELETE → bloquea el borrado** ⚠️ |

---

*Documentado el 2026-07-13. Retomar en un sprint dedicado.*
