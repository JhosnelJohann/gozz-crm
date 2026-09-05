# ROADMAP — GOZZ CRM

Este documento describe qué se migró a arquitectura limpia en esta entrega, qué quedó como
código legacy (rebrandeado y sin GHL, pero con su estructura original), y cómo migrar un
dominio legacy nuevo cuando se decida hacerlo. Refleja el estado real del código, no el plan
original — algunas decisiones de alcance cambiaron sobre la marcha (ver "Desviaciones del plan
original" al final).

## 1. Qué se migró

Arquitectura limpia vertical-slice (`routes.ts` → `service.ts` → `repository.ts` →
`schemas.ts`), con tipos compartidos en `@gozz/shared-types` y estado de UI en Zustand:

| Slice | Backend | Frontend |
|---|---|---|
| `auth` | `apps/api/src/modules/auth/` — capas completas | `apps/frontend/src/features/auth/` — store + hook + componentes extraídos de `login/page.tsx` |
| `oportunidades` | `apps/api/src/modules/oportunidades/` — capas completas (CRUD) | `apps/frontend/src/features/oportunidades/` — store de filtros + hook CRUD, cableado en `app/oportunidades/page.tsx` |
| `contactos` | `apps/api/src/modules/contactos/contactos.routes.ts` — **movido, no dividido** (ver nota abajo) | `apps/frontend/src/features/contactos/` — store de filtros + hook CRUD, cableado en `app/contactos/page.tsx` |

**`modules/oportunidades/` es la referencia completa** a seguir para migrar un dominio nuevo — es
el único slice con las 4 capas separadas de punta a punta.

**`modules/contactos/` es una relocalización física, no una migración completa.** El archivo
original (`contactos-routes.ts`, ~1565 líneas, 30 endpoints) se movió a
`modules/contactos/contactos.routes.ts` ajustando solo las rutas de import relativas
(`./shared/` → `../../shared/`, `./lib/` → `../../lib/`), sin dividirlo en repository/service.
Motivo: su SQL está profundamente entrelazado con 10 módulos especializados en
`apps/api/src/lib/contactos-*.ts` (merge, archivado, papelera, dedup, acciones,
agente-seguro, sensibles) que encapsulan reglas de negocio marcadas `🔴` en el código —
forzar la división en esta entrega tenía riesgo alto y valor bajo. Queda como el primer
candidato de la lista de migración pendiente (sección 3).

También transversal a todo el código (no solo a los 3 slices):
- Rebranding completo TADI → GOZZ (paleta de color, textos, logo, dominios de ejemplo).
- Eliminación de GoHighLevel (tablas, columnas, rutas, componentes).
- Esquema de base de datos `gozz` consolidado en `packages/db/migrations/0001_init_gozz_schema.sql`
  + `0002_seed_base_data.sql`, sin tablas de logs de importación (bitrix/pipedrive/zoho/deals)
  ni backups ad-hoc (`_bak_*`, `rescate_*`, etc.) — con la excepción documentada de
  `gozz.contactos_merge_log`, que se restauró porque es la bitácora activa que usan
  `fusionar()`/`revertir()` en `lib/contactos-merge.ts`, no un artefacto histórico.
- `apps/api/src/shared/{db,auth-middleware,socket,env,http-server,error-handler}.ts` — kernel
  compartido del backend (antes disperso dentro de `index.ts`).
- `apps/frontend/src/lib/api-client.ts` — cliente HTTP centralizado y tipado, adoptado por los
  3 slices de referencia.

## 2. Qué queda legacy

### Backend (`apps/api/src/*.ts`), por tamaño — todos rebrandeados y sin GHL, sin capas

| Archivo | Líneas |
|---|---|
| `drive-routes.ts` | 2672 |
| `email-routes.ts` | 1580 |
| `reportes-routes.ts` | 1419 |
| `chat-routes.ts` | 1042 |
| `tareas-routes.ts` | 764 |
| `videollamadas-routes.ts` | 576 |
| `detail-routes.ts` | 405 |
| `pipeline-routes.ts` | 391 |
| `clock-routes.ts` | 362 |
| `oportunidades-etapa-routes.ts` | 303 |
| `ai-proxy.ts` | 271 |
| `phase6-routes.ts` | 249 |
| `recognitions-routes.ts` | 217 |
| `uploads-routes.ts` | 191 |
| `configuracion-routes.ts` | 180 |
| `oportunidades-exportacion-routes.ts` | 167 |
| `aplicaciones-routes.ts` | 166 |
| `chat-link-preview.ts` | 157 |
| `internal-routes.ts` | 129 |
| `push.ts` | 83 |
| `stats-routes.ts` | 68 |
| `livekit.ts` | 55 |
| `notificaciones-routes.ts` | 42 |

`chat-routes.ts`, `videollamadas-routes.ts`, `stats-routes.ts` y `notificaciones-routes.ts` ya
salieron de `index.ts` (Fase 4) pero siguen siendo archivos planos sin service/repository.

### Frontend (`apps/frontend/src/app/*`)

18 áreas de ruta; `contactos`, `oportunidades` y `login` son los slices de referencia. El
resto (`academia`, `aplicaciones`, `asistencia`, `chat`, `configuracion`, `correo`, `dashboard`,
`drive`, `equipo`, `puntajes`, `reportes`, `solicitudes`, `tareas`, `tramites`, `videollamada`,
`view`) sigue con su estructura original: páginas grandes con lógica y `fetch()` inline.

63 archivos fuera de `features/` siguen usando `fetch()` suelto en vez de
`lib/api-client.ts`.

## 3. Orden sugerido de migración

1. **`modules/contactos/`** — terminar el trabajo que esta entrega dejó a medias: dividir en
   `contactos.service.ts` / `contactos.repository.ts` reutilizando los módulos `lib/contactos-*.ts`
   existentes en vez de reescribirlos. Es el candidato más urgente porque ya vive en `modules/`
   pero rompe el patrón que ahí se espera.
2. **`chat-routes.ts` (1042 líneas)** — dominio de alto tráfico, ya aislado de `index.ts`, buen
   candidato para service/repository antes que los archivos aún más grandes.
3. **`videollamadas-routes.ts` (576 líneas)** — mismo argumento; considerar resolver primero la
   duplicación de componentes de frontend (ver abajo), ya que ambos tocan la misma feature.
4. **`drive-routes.ts` (2672 líneas)** y **`email-routes.ts` (1580 líneas)** — los más grandes;
   dejar para cuando haya más contexto de negocio, ya que integran con storage externo (R2) y
   con el listener de email (LISTEN/NOTIFY) que vive en `index.ts`.
5. **`reportes-routes.ts` (1419 líneas)** y **`tareas-routes.ts` (764 líneas)** — sin bloqueos
   externos, se pueden migrar en cualquier momento después de los anteriores.
6. El resto (`detail`, `pipeline`, `clock`, `oportunidades-etapa`, `ai-proxy`, `phase6`,
   `recognitions`, `uploads`, `configuracion`, `oportunidades-exportacion`, `aplicaciones`,
   `chat-link-preview`, `internal`, `push`, `livekit`) — bajo riesgo, migrar oportunistamente.

En frontend, migrar `app/<dominio>/page.tsx` a `features/<dominio>/` en el mismo orden que su
contraparte de backend, siguiendo el patrón "cableado quirúrgico" usado en `contactos`/
`oportunidades`: mover solo el estado de filtros/UI a un store de Zustand preservando los
nombres de variable locales vía destructuring, para no tener que tocar el JSX.

## 4. Deuda técnica conocida

- **Patrón `isAdmin(u)` duplicado en 9 archivos**: `clock-routes.ts`, `configuracion-routes.ts`,
  `email-routes.ts`, `modules/contactos/contactos.routes.ts`, `pipeline-routes.ts`,
  `recognitions-routes.ts`, `reportes-routes.ts`, `tareas-routes.ts`, `uploads-routes.ts` — cada
  uno define su propia función `isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }`
  leyendo el JWT decodificado. Candidato natural para moverse a `shared/auth-middleware.ts` como
  un helper único (`isAdmin(user)`) o un middleware `requireAdmin`, el día que se toque
  cualquiera de estos archivos.
- **Duplicación de componentes de videollamada**: existen dos carpetas de componentes de
  frontend para la misma feature — `components/videocall/` (9 archivos: BackgroundPicker,
  CallStage, ChatPanel, ControlBar, P2PControls, ParticipantsPanel, PeerVideo, PreJoinScreen,
  VideoTile) y `components/videollamada/` (6 archivos: CallProvider, CallReturnBanner, CallUI,
  InviteToCallModal, LiveKitCall, VideoRoom). No se investigó en esta entrega cuál está
  realmente en uso ni si una es código muerto — resolver esto antes de migrar `videollamadas-routes.ts`.
- **Columnas de integración legacy conservadas a propósito**: `pipedrive_person_id`, `zoho_id`,
  `bitrix_contact_id` siguen en `lib/contactos-filtro.ts`, `lib/contactos-merge.ts` y
  `modules/contactos/contactos.routes.ts`. No son artefactos de GoHighLevel (que sí se eliminó
  por completo) — son claves de correlación con integraciones externas que pueden seguir activas;
  no se tocaron por falta de contexto de negocio para confirmar si están muertas.
- **63 archivos con `fetch()` suelto** en vez de `lib/api-client.ts` — se resuelve solo, dominio
  por dominio, a medida que cada área legacy se migra a `features/`.
- **`ecosystem.config.js`**: ya apunta a `/root/gozz-crm/...` (no quedó ninguna ruta con
  `crm-tadi`), pero sigue asumiendo un servidor Linux con esa estructura exacta de carpetas —
  revisar cuando se aprovisione el servidor real.
- **Configuración de videollamadas con placeholders**: `turn.example.com` (antes el dominio de
  producción real) y la configuración de LiveKit quedaron con valores de ejemplo — necesitan
  credenciales/dominio reales antes de un despliegue productivo.
- **`apps/ai/kb_crm.md`** (5598 líneas, se carga completo en el system prompt del copiloto IA): se
  corrigió branding, se quitó la sección `## GHL sync` (dead code), el conteo de tools desactualizado,
  la afirmación de que Drive usa GHL Media (es R2), el dominio/infra real de la empresa original
  (sección completa de despliegue con nginx/DNS/cPanel) y un email + nombre real de una persona que
  aparecía repetido en varios ejemplos (CEO de crm-tadi, usado como ejemplo de super_admin). Queda
  pendiente una revisión más profunda de contenido de producto (el ejemplo de DDL SQL con columnas
  `ghl_contact_id` a partir de la línea ~600 describe un diseño que nunca coincidió del todo con el
  schema real) — no se tocó por ser contenido ilustrativo, no una afirmación operacional activa.
  `apps/ai/kb_ventas.md` (8975 líneas) menciona "GHL" como referencia genérica a la herramienta de
  mercado dentro de consejos de marketing, no como integración propia — no se tocó.
- **Datos reales de personas de crm-tadi en código y tests**: además de la documentación, se
  encontraron el nombre y email reales del CEO de crm-tadi y de otra persona (agentes de seguro)
  hardcodeados en `lib/contactos-agente-seguro.ts`, `lib/dominios-propios.json`,
  `lib/contactos-dedup.ts`, `reportes-routes.ts` y en fixtures de 5 archivos de test — ya
  reemplazados por datos ficticios (Alessandro Garagozzo, Jhosnel Laya, Juan Duque — usuarios de
  ejemplo estándar para GOZZ). El historial de git del repo se reescribió para que esos datos
  tampoco queden accesibles en commits viejos de GitHub.
- **`docs/` heredado de crm-tadi**: se revisaron los 22 archivos originales. Se **borraron 13**
  (bitácoras/checklists de trabajo ya cerrado en crm-tadi, sin valor de referencia para GOZZ, algunos
  con datos reales de producción de la empresa original: `CHECKPOINT-*.md`, `PRUEBAS-STAGING-*.md`,
  `BASE-DE-DATOS.md`, `HANDOFF-R2-CLOUDFLARE.md`, `crm-tadi-documentacion-general.md`,
  `CATALOGO-SCRIPTS.md`, `followup-coach-setup.md`). Se **rebrandearon** los que sí tienen valor de
  referencia vigente (`chat-y-llamadas.md`, `CRITERIO-CALIDAD-CONTACTOS.md`,
  `DISENO-DRIVE-CICLO-ARCHIVOS.md`, `TAREA-boton-eliminar-oportunidad.md`,
  `IDEA-contactos-arbol-familiar.md`, `PENDIENTES-llamadas.md`). `PROMPT-CONTACTOS-CLAUDECODE.md`
  (1221 líneas, la especificación viva del motor de fusión/archivado de contactos) se conservó tal
  cual: sigue teniendo ~29 menciones de una propagación a GHL que se confirmó que **ya no existe en
  el código** (`pushContactoToGhl` y afines, verificado), pero no se editó a ciegas porque el propio
  documento tiene su propia disciplina de versionado ("no se crean adendas"). `CONVENCIONES.md`,
  `METODOLOGIA-DE-TRABAJO.md` y `RUNBOOK-PROD.md` se dejaron intactos a propósito — son la misma
  gobernanza (ramas dev/qa/prod, revisor humano) que ya se decidió dejar como está en `CLAUDE.md`.

## 5. Mini-guía: cómo migrar un dominio legacy nuevo

Usando `modules/oportunidades/` como plantilla:

1. **Leer el archivo legacy completo primero** (p. ej. `chat-routes.ts`) y anotar qué tablas
   toca, qué helpers importa de `lib/`, y si hay lógica de negocio no obvia (buscar comentarios
   marcados `🔴` o similares — indican reglas frágiles, como en `contactos-*`).
2. Crear `apps/api/src/modules/<dominio>/`:
   - `<dominio>.schemas.ts` — Zod, uno por payload de entrada.
   - `<dominio>.repository.ts` — todas las queries SQL del dominio, funciones puras que reciben
     un cliente/pool y devuelven filas tipadas. Nada de lógica de negocio aquí.
   - `<dominio>.service.ts` — orquesta repository + reglas de negocio; para operaciones con
     múltiples resultados posibles (éxito/error/sin-cambios), devolver un tipo discriminado
     (`{ tipo: "ok" | "error" | ... }`) en vez de lanzar excepciones genéricas — así lo hace
     `oportunidades.service.ts` con `ActualizarResultado`.
   - `<dominio>.routes.ts` — handlers delgados: parsear con el schema, llamar al service, mapear
     el resultado a status HTTP. Importar los tipos de respuesta desde `@gozz/shared-types`
     cuando el dominio los tenga.
3. Si el dominio necesita tipos nuevos para el frontend, agregarlos a
   `packages/shared-types/src/<dominio>.ts` y exportarlos desde `index.ts` — sin build step, se
   consumen como fuente TS directa.
4. Actualizar `apps/api/src/index.ts`: reemplazar el import del archivo legacy por
   `register<Dominio>Routes` desde `./modules/<dominio>/<dominio>.routes.js`, borrar el archivo
   legacy.
5. Actualizar cualquier test en `tests/` que importe el archivo legacy (buscar con grep antes de
   borrar) — ver `tests/setup/app-de-pruebas.ts` como ejemplo de dónde se registran las rutas
   para el suite de Vitest.
6. Verificar con `tsc --noEmit` en `apps/api` (config de producción y de tests) y correr el
   suite de Vitest completo — debe seguir en verde (531/531 al cierre de esta entrega) antes y
   después del cambio.
7. En frontend, si el dominio tiene una página bajo `app/<dominio>/`, crear
   `features/<dominio>/{store.ts,hooks/}` y cablear la página existente **sin tocar su JSX**:
   mover solo el estado que corresponda a UI/filtros a un store de Zustand, destructurando con
   los mismos nombres de variable que ya usaba el `useState` original (ver
   `app/contactos/page.tsx` y `app/oportunidades/page.tsx` como ejemplos de este patrón
   "cableado quirúrgico").

## 6. Desviaciones del plan original

- El plan original proponía `modules/contactos/` como la plantilla de referencia para la
  mini-guía; en la práctica terminó siendo el slice con capas incompletas (ver sección 1), así
  que la plantilla real es `modules/oportunidades/`.
- El plan original no mencionaba `gozz.contactos_merge_log`; se descubrió durante la Fase 5 que
  había sido eliminada por error en la Fase 2 y se restauró (ver sección 4 de este documento no
  aplica — está documentado como tabla activa en el comentario de la propia migración SQL).
