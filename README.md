# GOZZ CRM

CRM AI-first para agencias de servicios (vertical inicial: inmigración). Monorepo (pnpm
workspaces) con frontend Next.js, API en Express/TypeScript y un microservicio de IA en Python.
Base de datos PostgreSQL.

---

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Next.js 14 (App Router) · React 18 · Tailwind · Zustand |
| Backend | Node.js · Express · TypeScript · Socket.IO |
| IA | FastAPI (Python) · Claude (Anthropic) · whisper.cpp (transcripción local) |
| Base de datos | PostgreSQL (esquema `gozz`) |
| Tiempo real / video | Socket.IO · LiveKit |
| Gestor de paquetes | **pnpm** (obligatorio; npm/yarn no funcionan en este workspace) |

**Requisitos:** Node `>= 20` y pnpm `>= 9`.

---

## Estructura del monorepo

```text
gozz-crm/
├─ apps/
│  ├─ frontend/   Next.js 14 — UI del CRM                              (puerto 3100)
│  ├─ api/        Express + TS — API REST + Socket.IO                  (puerto 4100)
│  │              · email-worker → sincronización de buzones (proceso aislado)
│  └─ ai/         FastAPI — copiloto IA, análisis de PDF y transcripción (puerto 8100)
├─ packages/
│  ├─ db/            migraciones SQL del esquema (packages/db/migrations)
│  └─ shared-types/  tipos TypeScript compartidos entre api y frontend (@gozz/shared-types)
├─ scripts/       utilidades de mantenimiento (migraciones, seed, limpieza de uploads)
├─ docs/          notas técnicas — ver docs/ROADMAP.md para el estado de la migración a
│                  arquitectura de vertical slices
└─ ecosystem.config.js   configuración de procesos PM2 (producción)
```

---

## Puertos

| Servicio | Puerto |
| --- | --- |
| Frontend (Next.js) | 3100 |
| API (Express) | 4100 |
| Microservicio IA (FastAPI) | 8100 |

El frontend habla con la API mediante un *proxy* (`/api/*` → `127.0.0.1:4100`, ver
[apps/frontend/next.config.mjs](apps/frontend/next.config.mjs)), así que basta con abrir el frontend.

> **Puerto de la API en local:** el frontend (3100) reenvía tanto `/api` como `/uploads` a la API en el
> puerto **4100** (default, configurable con `API_URL`). Si cambias el puerto de la API, ajusta el
> valor de `API_URL` o los *rewrites* en [apps/frontend/next.config.mjs](apps/frontend/next.config.mjs).

---

## Puesta en marcha (local)

```bash
# 1. Dependencias
pnpm install

# 2. Variables de entorno — copia las plantillas y rellena los valores
cp apps/api/.env.example apps/api/.env
cp .env.example .env
cp .env.local.example .env.local        # opcional (overrides locales)

# 3. Base de datos (PostgreSQL local o remota). Carga el esquema:
pnpm migrate
pnpm seed:super-admin                    # crea el usuario admin del .env

# 2b. Carpeta local para archivos subidos (pruebas; NO se versiona).
#     Se crea sola con `pnpm install`, o manualmente con:
pnpm setup:local-dirs
# Copia la ruta que imprime y ponla en apps/api/.env como UPLOADS_DIR=<esa ruta>

# 4. Arrancar API + frontend a la vez (modo desarrollo, recarga en caliente)
pnpm dev
```

Luego abre <http://localhost:3100> e inicia sesión con
`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` de tu `.env`.

> Los archivos `.env` reales contienen secretos y **no se versionan** (ver `.gitignore`).
> Usa siempre los `*.env.example` como referencia de las variables necesarias.

---

## Scripts (raíz)

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Levanta API (4100) y frontend (3100) en paralelo con recarga en caliente |
| `pnpm build` | Compila todos los workspaces |
| `pnpm lint` | Ejecuta ESLint en los workspaces que lo tengan |
| `pnpm lint:fix` | Igual que `lint`, corrigiendo automáticamente lo que se pueda |
| `pnpm migrate` | Aplica las migraciones SQL de `packages/db/migrations` |
| `pnpm seed:super-admin` | Crea/actualiza el super admin definido en el `.env` |
| `pnpm setup:local-dirs` | Crea las carpetas locales `data/uploads` para archivos de prueba (git-ignored; también se ejecuta en `postinstall`) |

El microservicio de IA (`apps/ai`) es **opcional** para el arranque del CRM y se ejecuta aparte
(Python + `uvicorn`); requiere `vendor/whisper.cpp` para la transcripción de audio local.

---

## Producción

El despliegue usa **PM2** con [ecosystem.config.js](ecosystem.config.js), que orquesta los procesos:
`gozz-frontend`, `gozz-api`, `gozz-email-worker`, `gozz-ai` y `gozz-livekit`.

```bash
pnpm build
pm2 start ecosystem.config.js
```

---

## Notas

- **pnpm obligatorio:** es un monorepo de pnpm workspaces; usar `npm`/`yarn` rompe la resolución de dependencias.
- **Servicios opcionales:** Redis (colas/cache), LiveKit (videollamadas) y `apps/ai` (IA) no bloquean
  el arranque del CRM; si faltan, esas funciones quedan deshabilitadas pero el resto navega normal.
- **`UPLOADS_DIR`:** define dónde se guardan los archivos subidos (notas, pagos, chat, avatares...).
  En local es una carpeta git-ignored con datos de **PRUEBA** que **nunca** debe llegar al repo remoto
  ni a los despliegues; si se deja sin definir, usa por defecto la ruta del VPS.
- **Estado de la migración a arquitectura limpia:** los dominios `auth`, `oportunidades` y
  `contactos` ya viven en `apps/api/src/modules/` con capas separadas (o, en el caso de
  `contactos`, reubicados sin dividir aún — ver el roadmap). El resto de los dominios sigue en
  archivos planos bajo `apps/api/src/*.ts`, ya rebrandeados y sin GoHighLevel. Ver
  [docs/ROADMAP.md](docs/ROADMAP.md) para el detalle completo y el orden sugerido de migración.
