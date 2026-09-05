# KB · CRM GOZZ — Guía Operacional y Arquitectura

Este KB le da a CoPilot conocimiento sobre el CRM GOZZ **completo**: qué hace cada sección, cómo navegar, dónde encontrar cosas, cómo se arma la data, qué rol tiene cada campo, qué pasa detrás de escena, cómo usar las funciones, troubleshooting común, reglas operacionales. Usalo cuando el usuario pregunte cualquier cosa relacionada con el CRM — desde 'dónde pongo una nota' hasta 'cómo se calcula el SLA'.

---

# Parte 1 · Estado actual del producto (2026-04-24)


## Navegación (sidebar izquierdo, 13 items)

1. **Dashboard** — home con stats globales (oportunidades activas, montos ganados, tareas pendientes, actividad reciente).
2. **Contactos** — CRUD de contactos/leads (tabla `contactos_cache`). Vista lista + detalle con tabs.
3. **Oportunidades** — pipeline kanban editable + lista. Por cada card: nombre, monto, etapa, SLA badge, asesor. Doble-click abre detalle con 9 tabs (Resumen, Documentos, **Drive**, Cuestionario USCIS, Pagos, Notas, Puntajes, Tareas, Actividad, Correos).
4. **Tareas** — lista personal + chat-style (hilos de tareas entre equipo). Prioridad, vencimiento, asignado, comentarios, archivos adjuntos (tabla `tareas_archivos`).
5. **Trámites** — catálogo de tipos de trámite USCIS (I-130, I-485, N-400, etc.) con honorarios y SLA configurables por tipo.
6. **Drive** — explorador de archivos backed by Cloudflare R2. Estructura: `Drive del CRM / Compañía / Usuarios / Trámites`. Carpetas por user y por oportunidad se crean lazy. Permisos: super_admin full, admin full write, usuario read en compañía + propia "Mi Drive" + carpetas de oportunidades donde está asignado.
7. **Chat** — Slack-like interno + CoPilot IA + videollamadas 1-a-1 P2P. Grupos (tipo: directo, grupo, canal, copilot), emojis, reacciones, archivos, audios, respuestas.
8. **Correo** — cliente IMAP/SMTP integrado. Por usuario se configuran buzones. Envío y recepción se ve dentro del CRM. Plantillas de correo + sync cada 2 min.
9. **Academia** — portal de formación para equipo (cursos, clases, estudiante de la semana, medallas). Comparte infra con Academia de Inglés.
10. **Reportes** — KPIs por período: ventas cerradas, tasa de conversión, tiempos de procesamiento, rankings por asesor, ingresos por pipeline. Charts interactivos.
11. **Equipo** — directorio con fotos + organigrama jerárquico + perfil individual (stats personales, tareas abiertas, agenda semanal, asistencia).
12. **Asistencia** — Clock in/out con breaks, horas trabajadas, detección automática de descansos largos, vista mensual. Medallas semanales los lunes 09:00 ET (al que cumple horario, al más productivo, al con más ventas).
13. **Configuración** — sub-rutas: Usuarios (CRUD con roles), Departamentos, Pipeline (crear/editar pipelines y stages), API Keys, Webhooks, Notificaciones (preferencias), Seguridad (2FA, sesiones).

## Stack técnico

- **Frontend**: Next.js 14 App Router + TypeScript strict, shadcn/ui + Tailwind, framer-motion, phosphor-icons + lucide-react, socket.io-client, zustand, react-query, fullcalendar, dnd-kit, sonner (toasts). Corre en :3100 (standalone build + PM2).
- **API**: Express + TypeScript, Supabase JS (schema `gozz` local en Docker), socket.io + Redis adapter, BullMQ, nodemailer/imapflow, bcryptjs, JWT cookies httpOnly, pino logs, multer. Corre en :4100.
- **AI service** (`gozz-ai`): FastAPI Python 3.12 en :8100. Endpoints: `/chat` (CoPilot con tool-use Claude Sonnet 4.6), `/transcribe` (faster-whisper base), `/analyze-document` (PDF analysis para el tab Documentos de oportunidad), `/extract-task` (voz → tarea con Claude), `/summarize-videocall`.
- **DB**: Postgres. Schema dedicado `gozz`. Migración base consolidada (`0001_init_gozz_schema.sql`).
- **Cache**: Redis (opcional; colas y cache).
- **Videollamadas**: coexisten dos implementaciones sin resolver — WebRTC P2P puro (`components/videocall/`) y LiveKit vía SFU (`components/videollamada/`, con proceso `gozz-livekit` en PM2). Ver `docs/ROADMAP.md` — es deuda técnica pendiente de decidir cuál queda.
- **Drive**: archivos en Cloudflare R2 (`R2_BUCKET`/`R2_ACCOUNT_ID` en `.env`), jerarquía + ACL en DB local. Ver `docs/DISENO-DRIVE-CICLO-ARCHIVOS.md`.

## Auth y roles

- Login por email + password (bcrypt, 10 rounds). JWT en cookie httpOnly. Expira 8h.
- 3 niveles: `super_admin` (acceso total inmutable), `admin` (todo menos borrar super admins), `usuario` (ve lo asignado a él).
- Trigger SQL `BEFORE DELETE ON users WHERE nivel_acceso='super_admin'` impide borrado accidental del super admin.
- Password reset vía `/auth/forgot` → email con token de 1h → `/auth/reset`.

## CoPilot (asistente IA en Chat)

- Grupo especial `tipo='copilot'` — uno por usuario, botón "Chatear con CoPilot" en NewChatMenu.
- Modelo: Claude Sonnet 4.6. Tool-use loop hasta 12 iteraciones, 3500 max_tokens por paso.
- 1 tool disponible: `generate_pdf` (genera documentos PDF profesionales con weasyprint). El copiloto no tiene acceso directo a datos de contactos/oportunidades vía tools — si el usuario pregunta por un caso específico, hay que pegarle los datos en el chat.
- Soporta input multimodal: texto, audios (auto-transcritos con Whisper), imágenes (vision nativa), PDFs (Sonnet 4.6 nativo), DOCX/XLSX/TXT/CSV/JSON (extract text).
- KB ventas + neuromarketing (87K tokens) cargado con prompt caching: Chase Hughes 6 necesidades sociales, Jeremy Miner NEPQ 5 tonalidades, skills ai-first-scale-marketing-hub.
- Responde en markdown estructurado (sin emojis-bullets, tablas cuando aplica, headings jerárquicos).
- Indicador visual "está pensando" con fases dinámicas según tipo de mensaje.

## Videollamadas

- Inician desde el header de un chat DM (botón naranja "Videollamada").
- Flujo: `POST /api/videollamadas/direct` + `socket.emit videollamada:ring` → receptor ve `IncomingCallModal` con ringtone → acepta → ambos entran a sala (socket room) → acceptor envía WebRTC offer → connected en 1-3s.
- Salas 1-a-1 estrictas (socket rechaza el 3ro). Auto-cierre al quedar 0 sockets.
- Busy check real: consulta socket rooms activos, NO la DB (fix del 2026-04-24 por 28 rooms huérfanos bloqueantes).
- Features in-call: mic+mute, cam+switch, screen share, hand raise, 8 emoji reactions, chat panel, panel participantes, resumen IA opt-in con tabs "Resumen Claude" + "Transcripción", colgar.
- `/fin` es instantáneo (~7ms); el resumen IA sólo se genera si el anfitrión click "Resumen IA" — **no automático**.

## Drive del CRM

- Raíz fija: `Drive del CRM` → `Drive de la compañía` (shared org-wide), `Usuarios` (→ carpeta personal por user lazy), `Trámites` (→ carpeta por oportunidad lazy).
- Subir: drag-drop o botón Subir. Multer tmp → stream a GHL Media → registra en `drive_files` con `ghl_media_id` + `ghl_url`.
- Descargar: proxy con ACL (`/api/drive/files/:id/download` fetches ghl_url → stream al browser preservando permisos).
- Límite: 500 MB por archivo.
- Se puede accede también desde el tab "Drive" de cada oportunidad (se crea/reutiliza su carpeta).

## Oportunidades detail (9 tabs)

| Tab | Qué hace |
|---|---|
| Resumen | Vista 360: contacto, monto, etapa, SLA, asesor, últimas notas, tareas, pagos recientes |
| Documentos | Upload de PDFs → AI análisis por Claude (extrae datos del cliente, llena cuestionario USCIS auto) |
| Drive | Carpeta de la oportunidad en Drive (archivos persistentes, no efímeros) |
| Cuestionario USCIS | Formulario estructurado (datos personales, familia, empleo, antecedentes) — firmable |
| Pagos | Array de pagos parciales con monto, método, fecha, comprobante adjunto |
| Notas | Notas internas del equipo + archivos asociados |
| Puntajes | KPI por rol (vendedor, preparador, manager ventas, manager preparación, supervisor) |
| Tareas | Subtareas específicas de esta oportunidad |
| Actividad | Log cronológico automático (cambio de etapa, nuevo pago, mensaje enviado, etc) |
| Correos | Hilos de email con este contacto |

## SLA y automations

- Cada oportunidad tiene `sla_fecha_limite` + `sla_estado` (`on_track`/`warning`/`vencido`/`completado`).
- Se calcula al crear basado en `tramites_config.sla_dias`.
- Badge colored en el pipeline card.
- Automations al cambiar etapa: WebSocket broadcast, notificaciones al asesor, movimiento en GHL (si sync activo).

## Asistencia / Clock

- `/asistencia` tiene Clock in / Break start / Break end / Clock out.
- Monitor de descansos: si pasan 45 min sin actividad en break → notificación al manager.
- Métricas: horas efectivas, horas en break, total diario, semanal, mensual.
- Medallas semanales (cron lunes 09:00 ET): "Cumplimiento horario", "Productividad alta", "Top ventas".

## Configuración → Pipeline

- Super admin y admin pueden crear pipelines y etapas.
- Cada etapa tiene color, posición, trigger de automation opcional.
## Email IMAP/SMTP

- Cada usuario configura su buzón en Configuración → Notificaciones.
- Sync loop cada 2 min lee INBOX.
- Envío via `POST /api/correo/send` con adjuntos.
- Plantillas compartidas por departamento.

## Endpoints REST principales (contactos + oportunidades)

- Oportunidades: `GET/POST /api/oportunidades`, `PATCH/DELETE /api/oportunidades/:id`, `GET /api/oportunidades/:id/actividad`, `POST /api/oportunidades/:id/pagos`, `POST /api/oportunidades/:id/notas`, `GET /api/oportunidades/:id/puntajes`.
- Contactos: `GET/POST /api/contactos`, `PATCH /api/contactos/:id`.
- Drive: `GET /api/drive/tree`, `GET /api/drive/folders/:id`, `POST /api/drive/folders`, `POST /api/drive/upload`, `GET /api/drive/files/:id/download`, `DELETE /api/drive/files/:id`, `GET /api/drive/resolve/user/:id`, `GET /api/drive/resolve/oportunidad/:id`.
- Chat: `GET/POST /api/chat/grupos`, `GET/POST /api/chat/grupos/:id/mensajes`, `POST /api/chat/upload`, `POST /api/chat/dm`, `POST /api/chat/copilot`, `PATCH /api/chat/grupos/:id/estado`, `POST /api/chat/grupos/:id/leer`.
- Videollamadas: `POST /api/videollamadas/direct`, `POST /api/videollamadas/:id/join`, `POST /api/videollamadas/:id/fin`, `POST /api/videollamadas/:id/invitar`, `POST /api/videollamadas/resumen-ia`.
- Auth: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/forgot`, `POST /api/auth/reset`.
- Tareas: `GET/POST /api/tareas`, `PATCH/DELETE /api/tareas/:id`, `POST /api/tareas/:id/comentarios`.

## PM2 processes activos

- `gozz-api` (port 4100) — Express backend.
- `gozz-frontend` (port 3100) — Next.js standalone.
- `gozz-ai` (port 8100) — FastAPI.
- `gozz-email-worker` — sincronización de buzones IMAP, proceso aislado.
- `gozz-livekit` — servidor LiveKit (ver nota de videollamadas en "Stack técnico": coexiste con la implementación P2P, sin resolver todavía).

## Troubleshooting común

- **Videollamada "CONECTANDO…" eterno** → PM2 frontend `↺` alto → rebuild + standalone asset copy + restart.
- **"Llamada rechazada" sin estar ocupada** → rooms huérfanos en `videollamadas fin IS NULL`. Fix: `userIsBusy` usa socket rooms, ya no DB.
- **Drive "subir deshabilitado"** → credenciales R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) faltan en `apps/api/.env`.
- **CoPilot no responde** → `pm2 logs gozz-ai` o `gozz-api`. Verificar `ANTHROPIC_API_KEY` en `apps/ai/.env`.
- **Email no recibe** → revisar `logs/api-err.log` por "Failed to establish connection" (credenciales IMAP mal) y Configuración → Notificaciones.


---

# Parte 2 · Spec V3 master (diseño de referencia)

> Este spec fue escrito al arrancar el proyecto. Algunas partes pueden haber evolucionado — la Parte 1 refleja el estado actual. Ante discrepancia, Parte 1 manda.

# CLAUDE.md V2 — CRM GOZZ
## Especificación completa para implementación con Claude Code

**Proyecto:** CRM de Procesos — GOZZ LLC  
**Dominio:** gozz-agencia.com (Namecheap) — instalar en subdominio crm.gozz-agencia.com  
**Implementador:** Jhosnel Roas  
**Stack:** React + React Native + PHP + Python + Node.js  
**Fecha:** Abril 2026  
**Versión:** 2.0  

---

## ÍNDICE

1. Stack Tecnológico Completo
2. Librerías y Dependencias — Instalar TODO
3. Base de Datos — Arquitectura Completa
4. Configuración del Servidor y Dominio
5. Variables de Entorno
6. Login y Autenticación
7. Sistema de Roles y Permisos
8. Módulos del CRM
9. Interfaz de Usuario — Estándares 2026
10. Sistema de Comunicaciones Internas
11. API Key y Webhook Generator
12. Integración Gemma 4 (Google)
13. Integración GHL
14. Módulo de Formularios USCIS
15. Sistema de Puntajes y Comisiones
16. Academia Interna (LMS)
17. Dashboards y Reportes
18. Módulo Financiero
19. Sistema de Asistencia
20. Migración de Bitrix24
21. Orden de Implementación

---

## 1. STACK TECNOLÓGICO COMPLETO

### Frontend Web
- **React 18** con Vite o Next.js 14 (App Router)
- **React Native** para app móvil del equipo
- **TypeScript** en todo el proyecto

### Backend
- **Node.js + Express** — API principal del CRM
- **PHP 8.3** — integración con cPanel, correo, utilidades del servidor
- **Python 3.12** — procesamiento IA, Whisper.cpp, Gemma 4, análisis de documentos

### Base de Datos
- **Supabase** (PostgreSQL 15) — base de datos principal
- **Redis** — caché, sesiones, colas de tareas
- **Supabase Storage** — archivos y documentos

### Infraestructura
- **VPS Hostinger** — servidor principal
- **Namecheap DNS** — dominio gozz-agencia.com
- **cPanel/Exim** — servidor de correo
- **n8n** — automatizaciones (ya instalado)
- **Jitsi Meet** — videollamadas embebidas
- **Jibri** — grabación de llamadas

---

## 2. LIBRERÍAS Y DEPENDENCIAS — INSTALAR TODO

Claude Code debe ejecutar los siguientes comandos de instalación sin omitir ninguno.

### Frontend React — package.json completo

```bash
# Crear proyecto
npx create-next-app@latest crm-tuagente --typescript --tailwind --app

cd crm-tuagente

# UI y diseño base
npm install @shadcn/ui
npm install tailwindcss @tailwindcss/forms @tailwindcss/typography
npm install class-variance-authority clsx tailwind-merge
npm install lucide-react @heroicons/react

# Componentes UI avanzados 2026
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
npm install @radix-ui/react-select @radix-ui/react-tabs
npm install @radix-ui/react-toast @radix-ui/react-tooltip
npm install @radix-ui/react-popover @radix-ui/react-accordion
npm install @radix-ui/react-avatar @radix-ui/react-badge
npm install @radix-ui/react-checkbox @radix-ui/react-switch
npm install @radix-ui/react-slider @radix-ui/react-progress
npm install @radix-ui/react-scroll-area @radix-ui/react-separator
npm install @radix-ui/react-navigation-menu @radix-ui/react-menubar

# Animaciones — TODAS las librerías
npm install framer-motion
npm install @react-spring/web @react-spring/three
npm install react-transition-group
npm install gsap
npm install lottie-react lottie-web
npm install react-lottie-player
npm install animejs
npm install motion
npm install @formkit/auto-animate
npm install react-flip-toolkit
npm install react-move
npm install react-countup
npm install react-reveal
npm install aos
npm install @vueuse/motion
npm install react-awesome-reveal
npm install react-intersection-observer
npm install react-scroll-parallax

# Dashboards y gráficas
npm install recharts
npm install @tremor/react
npm install chart.js react-chartjs-2
npm install d3 @types/d3
npm install apexcharts react-apexcharts
npm install nivo @nivo/core @nivo/bar @nivo/line @nivo/pie @nivo/heatmap
npm install victory
npm install plotly.js react-plotly.js
npm install highcharts highcharts-react-official
npm install echarts echarts-for-react

# Tablas de datos
npm install @tanstack/react-table
npm install react-data-grid
npm install ag-grid-react ag-grid-community
npm install react-virtualized

# Formularios
npm install react-hook-form
npm install @hookform/resolvers
npm install zod yup joi
npm install react-select
npm install react-datepicker react-day-picker
npm install react-dropzone
npm install react-signature-canvas
npm install react-input-mask

# Estado global
npm install zustand jotai
npm install @tanstack/react-query
npm install swr
npm install redux @reduxjs/toolkit react-redux

# Comunicaciones en tiempo real
npm install socket.io-client
npm install @supabase/supabase-js
npm install pusher-js

# Notificaciones y alertas
npm install react-hot-toast
npm install react-toastify
npm install sonner
npm install notistack
npm install react-notifications-component
npm install sweetalert2

# Sonidos y audio
npm install howler
npm install react-howler
npm install use-sound
npm install tone

# Calendario y scheduling
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid
npm install @fullcalendar/interaction @fullcalendar/list
npm install react-big-calendar moment
npm install react-calendar
npm install date-fns luxon dayjs

# Editor de texto enriquecido
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-color
npm install react-quill
npm install draft-js react-draft-wysiwyg
npm install @uiw/react-md-editor

# Drag and drop
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install react-beautiful-dnd
npm install react-dnd react-dnd-html5-backend

# Mapas y geolocalización
npm install leaflet react-leaflet
npm install @react-google-maps/api

# PDF y documentos
npm install react-pdf @react-pdf/renderer
npm install jspdf html2canvas
npm install pdfmake

# Cámara y multimedia
npm install react-webcam
npm install react-player
npm install @mux/mux-player-react

# Jitsi Meet embed
npm install @jitsi/react-sdk

# Internacionalización
npm install next-intl react-i18next i18next

# Autenticación
npm install next-auth @auth/supabase-adapter
npm install bcryptjs jsonwebtoken

# HTTP y API
npm install axios
npm install @tanstack/react-query

# Utilidades
npm install lodash @types/lodash
npm install uuid nanoid
npm install numeral accounting
npm install react-copy-to-clipboard
npm install react-qr-code qrcode.react
npm install react-barcode
npm install country-flag-icons

# Bootstrap 5 más componentes adicionales
npm install bootstrap react-bootstrap
npm install reactstrap

# Iconos completos
npm install @fortawesome/react-fontawesome @fortawesome/free-solid-svg-icons
npm install @fortawesome/free-brands-svg-icons @fortawesome/free-regular-svg-icons
npm install react-icons
npm install phosphor-react
npm install tabler-icons-react

# Temas y colores
npm install @mui/material @mui/icons-material @emotion/react @emotion/styled
npm install @mui/x-data-grid @mui/x-date-pickers @mui/x-charts
npm install antd
npm install mantine @mantine/core @mantine/hooks @mantine/notifications

# Three.js para efectos 3D
npm install three @react-three/fiber @react-three/drei

# Efectos visuales especiales
npm install react-particles tsparticles
npm install @tsparticles/react @tsparticles/engine
npm install react-confetti
npm install react-snowfall
npm install canvas-confetti

# Virtual scrolling
npm install react-window react-virtuoso

# Tour y onboarding
npm install react-joyride
npm install intro.js reactour

# Comandos keyboard
npm install react-hotkeys-hook cmdk

# Accesibilidad
npm install @axe-core/react

# Testing
npm install @testing-library/react @testing-library/jest-dom vitest

# Dev tools
npm install @storybook/react concurrently
```

### Backend Node.js

```bash
mkdir crm-backend && cd crm-backend
npm init -y

npm install express
npm install @supabase/supabase-js
npm install socket.io
npm install jsonwebtoken bcryptjs
npm install nodemailer imapflow
npm install multer sharp
npm install node-cron
npm install axios
npm install cors helmet
npm install express-rate-limit
npm install compression
npm install morgan winston
npm install dotenv
npm install uuid nanoid
npm install ioredis
npm install bull bullmq
npm install stripe
npm install twilio
npm install @anthropic-ai/sdk
npm install openai
npm install pdf-parse pdfjs-dist
npm install puppeteer playwright
npm install cheerio
npm install xlsx csv-parse
npm install archiver unzipper
npm install ffmpeg-static fluent-ffmpeg
npm install qrcode
npm install nodemon ts-node typescript
npm install @types/node @types/express
```

### Python — requirements.txt

```bash
pip install fastapi uvicorn
pip install sqlalchemy psycopg2-binary
pip install python-jose passlib
pip install python-multipart aiofiles
pip install httpx aiohttp requests
pip install anthropic openai
pip install pillow pytesseract
pip install pypdf2 pdfplumber reportlab
pip install pandas numpy scipy
pip install scikit-learn
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install transformers datasets
pip install whisper openai-whisper
pip install faster-whisper
pip install langchain langchain-anthropic
pip install chromadb faiss-cpu
pip install python-dotenv
pip install celery redis
pip install schedule apscheduler
pip install boto3
pip install google-cloud-storage
pip install supabase
pip install websockets
```

### PHP — composer.json

```bash
composer require laravel/framework
composer require guzzlehttp/guzzle
composer require phpmailer/phpmailer
composer require setasign/fpdf
composer require dompdf/dompdf
composer require league/flysystem
composer require firebase/php-jwt
composer require vlucas/phpdotenv
composer require intervention/image
composer require league/csv
composer require spatie/pdf-to-image
composer require barryvdh/laravel-dompdf
```

### React Native — app móvil

```bash
npx react-native init CRMTuAgente --template react-native-template-typescript

npm install @react-navigation/native @react-navigation/stack
npm install @react-navigation/bottom-tabs @react-navigation/drawer
npm install react-native-screens react-native-safe-area-context
npm install react-native-gesture-handler react-native-reanimated
npm install react-native-vector-icons
npm install react-native-push-notification
npm install @react-native-async-storage/async-storage
npm install react-native-keychain
npm install react-native-camera react-native-image-picker
npm install react-native-document-picker react-native-fs
npm install react-native-sound
npm install react-native-permissions
npm install react-native-biometrics
npm install socket.io-client
npm install @supabase/supabase-js
npm install react-native-webview
npm install @jitsi/react-native-sdk
npm install react-native-calendars
npm install react-native-chart-kit
npm install lottie-react-native
npm install react-native-animatable
npm install react-native-paper
npm install react-native-elements
npm install react-native-toast-message
npm install react-native-modal
npm install zustand
```

---

## 3. BASE DE DATOS — ARQUITECTURA COMPLETA

### Ejecutar en Supabase SQL Editor

```sql
-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- =============================================
-- TABLA: users
-- =============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nivel_acceso VARCHAR(20) DEFAULT 'usuario' 
    CHECK (nivel_acceso IN ('super_admin', 'admin', 'usuario')),
  posiciones JSONB DEFAULT '[]',
  foto_perfil_url TEXT,
  color_perfil VARCHAR(7) DEFAULT '#FF6B00',
  activo BOOLEAN DEFAULT true,
  online BOOLEAN DEFAULT false,
  ultima_actividad TIMESTAMPTZ,
  zona_horaria VARCHAR(50) DEFAULT 'America/New_York',
  horario_entrada TIME DEFAULT '09:00',
  horario_salida TIME DEFAULT '18:00',
  duracion_lunch_minutos INTEGER DEFAULT 45,
  notificaciones_config JSONB DEFAULT '{}',
  preferencias_ui JSONB DEFAULT '{}',
  api_key VARCHAR(64) UNIQUE,
  webhook_url TEXT,
  webhook_secret VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: roles_permisos
-- =============================================
CREATE TABLE roles_permisos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  modulo VARCHAR(100) NOT NULL,
  permisos JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: tramites_config
-- =============================================
CREATE TABLE tramites_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  formulario_uscis VARCHAR(50),
  categoria VARCHAR(100),
  descripcion TEXT,
  puntaje_preparador DECIMAL(10,2) DEFAULT 0,
  puntaje_vendedor DECIMAL(10,2) DEFAULT 0,
  puntaje_manager_preparacion DECIMAL(10,2) DEFAULT 0,
  puntaje_supervisor DECIMAL(10,2) DEFAULT 0,
  puntaje_manager_general DECIMAL(10,2) DEFAULT 0,
  valor_base DECIMAL(10,2) DEFAULT 0,
  sla_dias INTEGER DEFAULT 30,
  requiere_seguimiento BOOLEAN DEFAULT false,
  seguimiento_inicio_dias INTEGER DEFAULT 30,
  seguimiento_intervalo_dias INTEGER DEFAULT 30,
  tiene_subtipo BOOLEAN DEFAULT false,
  subtipos JSONB DEFAULT '[]',
  campos_especificos JSONB DEFAULT '[]',
  documentos_requeridos JSONB DEFAULT '[]',
  documentos_traduccion JSONB DEFAULT '[]',
  cuestionario_json JSONB,
  etapas_personalizadas JSONB DEFAULT '[]',
  es_tramite_administrativo BOOLEAN DEFAULT false,
  plantilla_documento TEXT,
  color_badge VARCHAR(7) DEFAULT '#3B82F6',
  icono VARCHAR(100),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: contactos_cache
-- =============================================
CREATE TABLE contactos_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_contact_id VARCHAR(255) UNIQUE NOT NULL,
  nombre_completo VARCHAR(200),
  primer_nombre VARCHAR(100),
  apellido VARCHAR(100),
  otros_nombres JSONB DEFAULT '[]',
  email VARCHAR(255),
  email_alternativo VARCHAR(255),
  telefono VARCHAR(50),
  telefono_alternativo VARCHAR(50),
  whatsapp VARCHAR(50),
  direccion_fisica JSONB,
  direccion_postal JSONB,
  fecha_nacimiento DATE,
  lugar_nacimiento_ciudad VARCHAR(100),
  lugar_nacimiento_estado VARCHAR(100),
  lugar_nacimiento_pais VARCHAR(100),
  pais_origen VARCHAR(100),
  nacionalidades JSONB DEFAULT '[]',
  ssn_encrypted TEXT,
  a_number VARCHAR(20),
  itin VARCHAR(20),
  pasaporte_numero VARCHAR(50),
  pasaporte_pais VARCHAR(100),
  pasaporte_vencimiento DATE,
  i94_numero VARCHAR(50),
  estatus_migratorio VARCHAR(100),
  fecha_entrada_eeuu DATE,
  puerto_entrada VARCHAR(200),
  tipo_entrada VARCHAR(50),
  estado_civil VARCHAR(50),
  genero VARCHAR(20),
  religion VARCHAR(100),
  idioma_nativo VARCHAR(100),
  habla_ingles BOOLEAN,
  otros_idiomas JSONB DEFAULT '[]',
  conyuge JSONB DEFAULT '{}',
  hijos JSONB DEFAULT '[]',
  padres JSONB DEFAULT '{}',
  hermanos JSONB DEFAULT '[]',
  historial_direcciones JSONB DEFAULT '[]',
  historial_empleos JSONB DEFAULT '[]',
  historial_educacion JSONB DEFAULT '[]',
  membresías_organizaciones JSONB DEFAULT '[]',
  antecedentes_penales JSONB DEFAULT '{}',
  etnia VARCHAR(100),
  raza VARCHAR(100),
  estatura VARCHAR(20),
  peso VARCHAR(20),
  color_ojos VARCHAR(50),
  color_cabello VARCHAR(50),
  fecha_elegibilidad_medicare DATE,
  numero_medicare VARCHAR(50),
  cobertura_salud_actual VARCHAR(200),
  ingresos_anuales DECIMAL(12,2),
  ocupacion VARCHAR(200),
  empleador_actual VARCHAR(200),
  driver_license JSONB DEFAULT '{}',
  cuenta_uscis_existente JSONB DEFAULT '{}',
  referido_por UUID REFERENCES contactos_cache(id),
  fuente_lead VARCHAR(100),
  etiquetas JSONB DEFAULT '[]',
  notas_internas TEXT,
  idioma_preferido VARCHAR(10) DEFAULT 'es',
  ultima_sincronizacion_ghl TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX idx_contactos_nombre ON contactos_cache USING gin(to_tsvector('spanish', nombre_completo));
CREATE INDEX idx_contactos_email ON contactos_cache(email);
CREATE INDEX idx_contactos_telefono ON contactos_cache(telefono);
CREATE INDEX idx_contactos_a_number ON contactos_cache(a_number);

-- =============================================
-- TABLA: oportunidades
-- =============================================
CREATE TABLE oportunidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_id SERIAL UNIQUE,
  ghl_opportunity_id VARCHAR(255) UNIQUE,
  ghl_contact_id VARCHAR(255) NOT NULL,
  contacto_id UUID REFERENCES contactos_cache(id),
  nombre_caso VARCHAR(300),
  tipo_tramite_id UUID REFERENCES tramites_config(id),
  subtipo VARCHAR(100),
  etapa VARCHAR(100) DEFAULT 'recopilacion_documentos',
  etapa_orden INTEGER DEFAULT 1,
  etapas_completadas JSONB DEFAULT '[]',
  preparador_id UUID REFERENCES users(id),
  vendedor_id UUID REFERENCES users(id),
  manager_preparacion_id UUID REFERENCES users(id),
  manager_general_id UUID REFERENCES users(id),
  supervisor_id UUID REFERENCES users(id),
  idioma VARCHAR(10) DEFAULT 'es',
  es_dependiente BOOLEAN DEFAULT false,
  dirigido_a VARCHAR(100),
  oportunidad_titular_id UUID REFERENCES oportunidades(id),
  dependientes JSONB DEFAULT '[]',
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_primer_pago TIMESTAMPTZ,
  fecha_cierre TIMESTAMPTZ,
  fecha_limite TIMESTAMPTZ,
  sla_dias INTEGER,
  sla_vencido BOOLEAN DEFAULT false,
  dias_restantes INTEGER,
  valor_total DECIMAL(10,2) DEFAULT 0,
  servicios_adicionales JSONB DEFAULT '[]',
  descuentos JSONB DEFAULT '[]',
  total_pagado DECIMAL(10,2) DEFAULT 0,
  balance_pendiente DECIMAL(10,2) DEFAULT 0,
  pagos JSONB DEFAULT '[]',
  estado_financiero VARCHAR(50) DEFAULT 'pendiente',
  metodo_pago_principal VARCHAR(50),
  qbo_customer_id VARCHAR(255),
  qbo_invoice_id VARCHAR(255),
  qbo_payment_link TEXT,
  cuenta_uscis JSONB DEFAULT '{}',
  cuestionario_enviado BOOLEAN DEFAULT false,
  cuestionario_firmado BOOLEAN DEFAULT false,
  cuestionario_fecha_firma TIMESTAMPTZ,
  cuestionario_datos JSONB DEFAULT '{}',
  documentos JSONB DEFAULT '[]',
  documentos_por_traducir JSONB DEFAULT '[]',
  terminos_condiciones JSONB DEFAULT '{}',
  documentos_traducidos JSONB DEFAULT '[]',
  comprobantes_pago JSONB DEFAULT '[]',
  historial JSONB DEFAULT '[]',
  tareas JSONB DEFAULT '[]',
  comentarios JSONB DEFAULT '[]',
  seguimientos JSONB DEFAULT '[]',
  seguimiento_completado BOOLEAN DEFAULT false,
  seguimiento_descripcion_cierre TEXT,
  puntajes_generados BOOLEAN DEFAULT false,
  puntaje_preparador DECIMAL(10,2) DEFAULT 0,
  puntaje_vendedor DECIMAL(10,2) DEFAULT 0,
  puntaje_manager_preparacion DECIMAL(10,2) DEFAULT 0,
  puntaje_supervisor DECIMAL(10,2) DEFAULT 0,
  puntaje_manager_general DECIMAL(10,2) DEFAULT 0,
  estado VARCHAR(50) DEFAULT 'activo'
    CHECK (estado IN ('activo', 'ganado', 'perdido', 'suspendido')),
  motivo_perdida TEXT,
  fecha_corte_asilo DATE,
  fecha_vencimiento_asilo DATE,
  notas TEXT,
  prioridad VARCHAR(20) DEFAULT 'normal'
    CHECK (prioridad IN ('baja', 'normal', 'alta', 'urgente')),
  urgente BOOLEAN DEFAULT false,
  solicitud_urgente_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_oportunidades_preparador ON oportunidades(preparador_id);
CREATE INDEX idx_oportunidades_estado ON oportunidades(estado);
CREATE INDEX idx_oportunidades_tramite ON oportunidades(tipo_tramite_id);
CREATE INDEX idx_oportunidades_fecha ON oportunidades(fecha_inicio DESC);

-- =============================================
-- TABLA: asistencia
-- =============================================
CREATE TABLE asistencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  entrada TIMESTAMPTZ,
  salida_lunch TIMESTAMPTZ,
  regreso_lunch TIMESTAMPTZ,
  salida TIMESTAMPTZ,
  horas_trabajadas DECIMAL(5,2),
  horas_esperadas DECIMAL(5,2),
  tarde BOOLEAN DEFAULT false,
  minutos_tarde INTEGER DEFAULT 0,
  lunch_excedido BOOLEAN DEFAULT false,
  minutos_lunch_excedidos INTEGER DEFAULT 0,
  salio_antes BOOLEAN DEFAULT false,
  minutos_salida_anticipada INTEGER DEFAULT 0,
  ip_entrada VARCHAR(50),
  ip_salida VARCHAR(50),
  notas TEXT,
  aprobado_por UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, fecha)
);

-- =============================================
-- TABLA: chat_grupos
-- =============================================
CREATE TABLE chat_grupos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  tipo VARCHAR(50) DEFAULT 'grupo'
    CHECK (tipo IN ('grupo', 'directo', 'canal', 'departamento')),
  avatar_url TEXT,
  color VARCHAR(7) DEFAULT '#FF6B00',
  miembros JSONB DEFAULT '[]',
  admins JSONB DEFAULT '[]',
  creado_por UUID REFERENCES users(id),
  fijado BOOLEAN DEFAULT false,
  silenciado BOOLEAN DEFAULT false,
  archivado BOOLEAN DEFAULT false,
  puede_llamar BOOLEAN DEFAULT true,
  puede_videoconferencia BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: chat_mensajes
-- =============================================
CREATE TABLE chat_mensajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id UUID REFERENCES chat_grupos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  tipo VARCHAR(50) DEFAULT 'texto'
    CHECK (tipo IN ('texto', 'imagen', 'archivo', 'audio', 'video', 'sticker', 'sistema', 'llamada')),
  contenido TEXT,
  archivo_url TEXT,
  archivo_nombre VARCHAR(255),
  archivo_tamanio INTEGER,
  archivo_tipo VARCHAR(100),
  respondiendo_a UUID REFERENCES chat_mensajes(id),
  menciones JSONB DEFAULT '[]',
  reacciones JSONB DEFAULT '[]',
  leido_por JSONB DEFAULT '[]',
  editado BOOLEAN DEFAULT false,
  editado_at TIMESTAMPTZ,
  eliminado BOOLEAN DEFAULT false,
  fijado BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mensajes_grupo ON chat_mensajes(grupo_id, created_at DESC);

-- =============================================
-- TABLA: notificaciones
-- =============================================
CREATE TABLE notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tipo VARCHAR(100) NOT NULL,
  titulo VARCHAR(300),
  mensaje TEXT,
  icono VARCHAR(100),
  color VARCHAR(7),
  sonido VARCHAR(100) DEFAULT 'notification',
  leida BOOLEAN DEFAULT false,
  accion_url TEXT,
  datos JSONB DEFAULT '{}',
  prioridad VARCHAR(20) DEFAULT 'normal'
    CHECK (prioridad IN ('baja', 'normal', 'alta', 'critica')),
  expira_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notificaciones_user ON notificaciones(user_id, leida, created_at DESC);

-- =============================================
-- TABLA: academia_modulos
-- =============================================
CREATE TABLE academia_modulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  thumbnail_url TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  roles_asignados JSONB DEFAULT '[]',
  posiciones_asignadas JSONB DEFAULT '[]',
  duracion_estimada_minutos INTEGER,
  activo BOOLEAN DEFAULT true,
  color VARCHAR(7) DEFAULT '#FF6B00',
  icono VARCHAR(100),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: academia_lecciones
-- =============================================
CREATE TABLE academia_lecciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id UUID REFERENCES academia_modulos(id) ON DELETE CASCADE,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  ghl_media_url TEXT NOT NULL,
  duracion_segundos INTEGER,
  sop_texto TEXT,
  sop_html TEXT,
  recursos JSONB DEFAULT '[]',
  orden INTEGER NOT NULL DEFAULT 0,
  obligatoria BOOLEAN DEFAULT true,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: academia_quizzes
-- =============================================
CREATE TABLE academia_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id UUID REFERENCES academia_modulos(id) ON DELETE CASCADE,
  titulo VARCHAR(200),
  instrucciones TEXT,
  preguntas JSONB NOT NULL,
  puntaje_minimo INTEGER DEFAULT 70,
  max_intentos INTEGER DEFAULT 3,
  tiempo_limite_minutos INTEGER,
  mezclar_preguntas BOOLEAN DEFAULT true,
  mezclar_opciones BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: academia_progreso
-- =============================================
CREATE TABLE academia_progreso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  modulo_id UUID REFERENCES academia_modulos(id),
  leccion_id UUID REFERENCES academia_lecciones(id),
  lecciones_vistas JSONB DEFAULT '[]',
  porcentaje_completado DECIMAL(5,2) DEFAULT 0,
  intentos JSONB DEFAULT '[]',
  ultimo_puntaje INTEGER,
  mejor_puntaje INTEGER,
  aprobado BOOLEAN DEFAULT false,
  fecha_aprobacion TIMESTAMPTZ,
  oportunidades_adicionales_usadas INTEGER DEFAULT 0,
  oportunidad_adicional_autorizada_por UUID REFERENCES users(id),
  tiempo_total_segundos INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, modulo_id)
);

-- =============================================
-- TABLA: cola_asignacion
-- =============================================
CREATE TABLE cola_asignacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_tramite_id UUID REFERENCES tramites_config(id),
  subtipo VARCHAR(100),
  preparadores_activos JSONB DEFAULT '[]',
  contador_actual INTEGER DEFAULT 0,
  ultimo_asignado UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tipo_tramite_id, subtipo)
);

-- =============================================
-- TABLA: solicitudes_urgentes
-- =============================================
CREATE TABLE solicitudes_urgentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidad_id UUID REFERENCES oportunidades(id),
  solicitado_por UUID REFERENCES users(id),
  motivo TEXT NOT NULL,
  preparador_propuesto UUID REFERENCES users(id),
  estado VARCHAR(50) DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'expirado')),
  aprobado_por UUID REFERENCES users(id),
  motivo_rechazo TEXT,
  fecha_respuesta TIMESTAMPTZ,
  fecha_expiracion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: plantillas_correo
-- =============================================
CREATE TABLE plantillas_correo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  asunto VARCHAR(500),
  cuerpo_html TEXT NOT NULL,
  cuerpo_texto TEXT,
  tipo VARCHAR(100),
  variables_disponibles JSONB DEFAULT '[]',
  activo BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: correos_enviados
-- =============================================
CREATE TABLE correos_enviados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidad_id UUID REFERENCES oportunidades(id),
  contacto_id UUID REFERENCES contactos_cache(id),
  de VARCHAR(255),
  para VARCHAR(255),
  asunto VARCHAR(500),
  cuerpo_html TEXT,
  adjuntos JSONB DEFAULT '[]',
  estado VARCHAR(50) DEFAULT 'enviado',
  leido BOOLEAN DEFAULT false,
  fecha_lectura TIMESTAMPTZ,
  enviado_por UUID REFERENCES users(id),
  plantilla_id UUID REFERENCES plantillas_correo(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: videollamadas
-- =============================================
CREATE TABLE videollamadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidad_id UUID REFERENCES oportunidades(id),
  sala_jitsi VARCHAR(300),
  iniciada_por UUID REFERENCES users(id),
  participantes JSONB DEFAULT '[]',
  inicio TIMESTAMPTZ,
  fin TIMESTAMPTZ,
  duracion_segundos INTEGER,
  grabacion_url TEXT,
  transcripcion_txt TEXT,
  analisis_claude JSONB DEFAULT '{}',
  estado VARCHAR(50) DEFAULT 'programada'
    CHECK (estado IN ('programada', 'activa', 'finalizada', 'cancelada')),
  tipo VARCHAR(50) DEFAULT 'cliente'
    CHECK (tipo IN ('cliente', 'interna', 'grupal')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: api_keys
-- =============================================
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  key_prefix VARCHAR(10),
  permisos JSONB DEFAULT '[]',
  activo BOOLEAN DEFAULT true,
  ultimo_uso TIMESTAMPTZ,
  total_requests INTEGER DEFAULT 0,
  ip_whitelist JSONB DEFAULT '[]',
  expira_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: webhooks_config
-- =============================================
CREATE TABLE webhooks_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  url TEXT NOT NULL,
  secret VARCHAR(64),
  eventos JSONB DEFAULT '[]',
  activo BOOLEAN DEFAULT true,
  ultimo_envio TIMESTAMPTZ,
  total_envios INTEGER DEFAULT 0,
  total_errores INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: webhook_logs
-- =============================================
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks_config(id),
  evento VARCHAR(100),
  payload JSONB,
  respuesta_status INTEGER,
  respuesta_body TEXT,
  exitoso BOOLEAN DEFAULT false,
  tiempo_respuesta_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: auditoria
-- =============================================
CREATE TABLE auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  accion VARCHAR(200) NOT NULL,
  tabla_afectada VARCHAR(100),
  registro_id UUID,
  datos_antes JSONB,
  datos_despues JSONB,
  ip VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auditoria_user ON auditoria(user_id, created_at DESC);
CREATE INDEX idx_auditoria_tabla ON auditoria(tabla_afectada, created_at DESC);

-- =============================================
-- TABLA: sesiones_activas
-- =============================================
CREATE TABLE sesiones_activas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE,
  dispositivo VARCHAR(200),
  ip VARCHAR(50),
  ultimo_ping TIMESTAMPTZ DEFAULT NOW(),
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TRIGGERS: updated_at automático
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_oportunidades_updated_at BEFORE UPDATE ON oportunidades FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_contactos_updated_at BEFORE UPDATE ON contactos_cache FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_tramites_updated_at BEFORE UPDATE ON tramites_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_academia_modulos_updated_at BEFORE UPDATE ON academia_modulos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_academia_progreso_updated_at BEFORE UPDATE ON academia_progreso FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE oportunidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE contactos_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencia ENABLE ROW LEVEL SECURITY;

-- Usuarios solo ven sus propias notificaciones
CREATE POLICY notif_own ON notificaciones
  FOR ALL USING (user_id = auth.uid()::UUID);

-- Usuarios ven solo sus oportunidades (admins ven todo)
CREATE POLICY oport_user ON oportunidades
  FOR SELECT USING (
    preparador_id = auth.uid()::UUID
    OR vendedor_id = auth.uid()::UUID
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::UUID AND nivel_acceso IN ('admin', 'super_admin'))
  );
```


## 6. LOGIN Y AUTENTICACIÓN

### Diseño del login — estándares 2026
La pantalla de login debe tener:
- Fondo con partículas animadas o gradiente dinámico (usar tsparticles o framer-motion)
- Logo de GOZZ centrado con animación de entrada
- Card flotante con blur/glassmorphism effect
- Campo email y password con animaciones de foco
- Botón con efecto de carga animado al hacer clic
- Transición suave hacia el dashboard tras login exitoso (page transition con framer-motion)
- Modo oscuro/claro con toggle animado
- Colores de marca: naranja #FF6B00, negro #1A1A1A, blanco #FFFFFF

### Flujo de autenticación
1. Email + password → validar contra Supabase Auth o tabla users
2. Generar JWT con payload: `{ id, email, nivel_acceso, posiciones }`
3. Guardar en httpOnly cookie + localStorage para React
4. Middleware de Next.js verifica JWT en cada ruta protegida
5. Refresh token automático antes de expiración

### Super Admin — configuración inicial
Al hacer el primer deploy, Claude Code debe:
```javascript
// scripts/setup-super-admin.js
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

async function setupSuperAdmin() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD_HASH, 12);
  
  await supabase.from('users').upsert({
    email: process.env.SUPER_ADMIN_EMAIL,
    password_hash: hash,
    nombre: 'Alessandro',
    apellido: 'Garagozzo',
    nivel_acceso: 'super_admin',
    posiciones: ['super_admin', 'manager_general'],
    activo: true
  }, { onConflict: 'email' });
  
  console.log('Super admin configurado correctamente');
}
setupSuperAdmin();
```

### Restricciones del super admin
Solo `nivel_acceso = 'super_admin'` puede:
- Eliminar usuarios
- Modificar nivel de acceso de otros usuarios
- Designar administradores
- Eliminar trámites configurados
- Acceder al log de auditoría completo
- Regenerar API keys de otros usuarios
- Ver configuración de webhooks de toda la empresa
- Configurar integraciones (GHL, QBO, Anthropic)

---

## 7. SISTEMA DE ROLES Y PERMISOS

Ver sección 5 del CLAUDE.md V1 para detalle completo. Resumen:

- **super_admin:** control total, único, inamovible
- **admin:** asignado por super_admin, ve y edita todo menos configuración crítica
- **usuario:** ve solo sus oportunidades, permisos granulares por módulo

Posiciones predefinidas (editables desde panel):
Manager General, Manager de Preparación, Manager de Ventas, Manager de Taxes, Preparador de Inmigración, Preparador de Taxes, Closer, Setter, Post-venta, Supervisor

---

## 8. INTERFAZ DE USUARIO — ESTÁNDARES 2026

### Principios de diseño
- **Glassmorphism:** cards con `backdrop-filter: blur(10px)`, fondos semi-transparentes
- **Neumorphism sutil:** sombras suaves en botones y cards
- **Micro-animaciones:** cada interacción tiene feedback visual (hover, click, focus)
- **Dark mode nativo:** toggle en el header, preferencia guardada por usuario
- **Responsive total:** mobile-first, funciona en cualquier dispositivo
- **Tipografía:** Inter o Plus Jakarta Sans como fuente principal
- **Grid system:** CSS Grid + Flexbox, no solo Bootstrap

### Paleta de colores
```css
:root {
  --primary: #FF6B00;        /* Naranja marca */
  --primary-dark: #E55A00;
  --primary-light: #FF8C33;
  --secondary: #1A1A1A;      /* Negro */
  --accent: #00D4FF;         /* Azul eléctrico para highlights */
  --success: #10B981;
  --warning: #F59E0B;
  --danger: #EF4444;
  --info: #3B82F6;
  
  /* Dark mode */
  --bg-dark: #0F0F0F;
  --bg-card-dark: #1A1A1A;
  --bg-sidebar-dark: #111111;
  --text-dark: #F1F5F9;
  
  /* Light mode */
  --bg-light: #F8FAFC;
  --bg-card-light: #FFFFFF;
  --bg-sidebar-light: #1A1A1A;
  --text-light: #0F172A;
}
```

### Animaciones requeridas en todo el sistema
```javascript
// Importar y configurar en _app.tsx o layout.tsx

// 1. Page transitions (framer-motion)
import { AnimatePresence, motion } from 'framer-motion';

// 2. Scroll animations (AOS)
import AOS from 'aos';
import 'aos/dist/aos.css';

// 3. Number counters (react-countup)
import CountUp from 'react-countup';

// 4. Loading skeletons
import Skeleton from 'react-loading-skeleton';

// 5. Particles background en login
import Particles from '@tsparticles/react';

// 6. Lottie para estados vacíos y éxito
import Lottie from 'lottie-react';

// 7. GSAP para animaciones complejas de dashboard
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
```

### Barra de navegación lateral (Sidebar)
- Colapsable con animación smooth
- Iconos con tooltips al colapsar
- Badge de notificaciones en items relevantes
- Foto de perfil del usuario en la parte inferior
- Indicador de estado online (punto verde animado)
- Modo colapsado: solo iconos (64px de ancho)
- Modo expandido: iconos + labels (240px de ancho)
- Secciones: Dashboard, Oportunidades, Contactos, Comunicaciones, Finanzas, Academia, Reportes, Configuración

### Header superior
- Búsqueda global con Cmd+K (cmdk)
- Notificaciones con badge animado
- Selector de zona horaria
- Toggle dark/light mode con animación
- Avatar del usuario con dropdown
- Botón de nueva oportunidad siempre visible

### Comunicaciones — interfaz tipo Meta/WhatsApp Business
La sección de comunicaciones debe verse y funcionar exactamente como una app de mensajería moderna:
- Panel izquierdo: lista de chats con preview del último mensaje, hora, badge de no leídos
- Panel central: hilo de mensajes con burbujas, timestamps, avatares
- Panel derecho (opcional): info del contacto o grupo
- Reacciones con emoji al hover sobre mensaje
- Estado de lectura (✓✓)
- Indicador de "escribiendo..."
- Búsqueda dentro del chat
- Mensajes fijados en el header
- Compartir archivos con preview
- Botón de videollamada en el header del grupo
- Soporte para GIFs, stickers, emojis
- Notificación con sonido al recibir mensaje nuevo

---

## 9. API KEY Y WEBHOOK GENERATOR

### Generación de API Key
Cada usuario puede generar su propia API Key desde su perfil:

```javascript
// POST /api/auth/generate-api-key
const generateApiKey = async (userId, nombre, permisos) => {
  const key = `tua_${nanoid(32)}`; // formato: tua_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  const prefix = key.substring(0, 10);
  const hash = await bcrypt.hash(key, 10);
  
  await supabase.from('api_keys').insert({
    user_id: userId,
    nombre,
    key_hash: hash,
    key_prefix: prefix,
    permisos
  });
  
  return key; // Solo se muestra UNA vez al usuario
};
```

La API Key se muestra una sola vez al generarse. El usuario debe copiarla. Después solo ve el prefijo `tua_xxxxxxxx...`.

### Webhook Generator
Cada usuario puede configurar webhooks para recibir eventos del CRM:

```javascript
// Eventos disponibles para webhooks:
const WEBHOOK_EVENTOS = [
  'oportunidad.creada',
  'oportunidad.etapa_cambiada',
  'oportunidad.cerrada',
  'oportunidad.perdida',
  'pago.registrado',
  'cuestionario.firmado',
  'tarea.completada',
  'seguimiento.vencido',
  'sla.vencido',
  'usuario.asignado'
];

// Firma HMAC de cada webhook
const firmarPayload = (payload, secret) => {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
};

// Headers del webhook:
// X-TuAgente-Event: oportunidad.creada
// X-TuAgente-Signature: sha256=xxxxx
// X-TuAgente-Timestamp: 1234567890
```

---

## 10. INTEGRACIÓN GEMMA 4 (GOOGLE)

### Evaluación de instalación local vs API

**Opción A — Google AI API (recomendado si VPS tiene menos de 16GB RAM):**
```python
# pip install google-generativeai
import google.generativeai as genai

genai.configure(api_key=os.environ['GOOGLE_AI_API_KEY'])
model = genai.GenerativeModel('gemma-4')

response = model.generate_content("Analiza este documento de inmigración...")
```

**Opción B — Instalación local con Ollama (requiere mínimo 16GB RAM + GPU):**
```bash
# Instalar Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Descargar Gemma 4
ollama pull gemma4

# Verificar
ollama run gemma4 "Hola, ¿puedes analizar documentos de inmigración?"

# API local en puerto 11434
curl http://localhost:11434/api/generate -d '{
  "model": "gemma4",
  "prompt": "Analiza este formulario USCIS..."
}'
```

**Claude Code debe:**
1. Verificar RAM disponible del VPS: `free -h`
2. Verificar GPU: `nvidia-smi` o `lspci | grep -i nvidia`
3. Si RAM >= 16GB y hay GPU → instalar Ollama con Gemma 4 local
4. Si RAM < 16GB → configurar Google AI API
5. Registrar cuál opción se usó en el log de instalación

### Uso de Gemma 4 en el CRM
Gemma 4 se usa como modelo complementario a Claude para:
- Pre-procesamiento de documentos antes de enviar a Claude (reducir tokens)
- Clasificación rápida de tipo de documento
- Extracción de datos estructurados de PDFs
- Respuestas rápidas en el chat interno del equipo

```python
# /crm-python/services/gemma_service.py
class GemmaService:
    def __init__(self):
        self.use_local = os.getenv('GEMMA_USE_LOCAL', 'false') == 'true'
        
    async def analizar_documento(self, texto: str, tipo: str) -> dict:
        prompt = f"""
        Analiza este documento de tipo {tipo} y extrae los datos principales.
        Devuelve SOLO un JSON con los campos encontrados.
        
        Documento:
        {texto[:4000]}
        """
        if self.use_local:
            return await self._llamar_ollama(prompt)
        else:
            return await self._llamar_google_api(prompt)
```

---

## 11. MÓDULOS DEL CRM

Para descripción completa de todos los módulos, ver CLAUDE.md V1 secciones 6-24. Esta versión V2 complementa con:

### Módulo de documentos — 4 campos (según Bitrix actual)
Cada oportunidad tiene exactamente estos 4 campos de documentos:
1. **Documentos** — archivos del cliente relacionados al trámite
2. **Documentos por traducir** — documentos que necesitan traducción
3. **Términos y condiciones** — documento firmado por el cliente
4. **Documentos traducidos** — versiones traducidas finales

### Sistema de puntajes — 5 categorías (corregido de V1)
Cada oportunidad genera puntajes para 5 roles:
1. Puntos Venta (vendedor)
2. Puntos Manager de Ventas
3. Puntos Manager de Preparación
4. Puntos Supervisor
5. Puntos Manager General

El dashboard de puntajes tiene dos tabs: **Preparación** y **Productos Digitales**

### Chat interno — grupos predefinidos
Grupos que se crean automáticamente al instalar el sistema:
- Ventas GOZZ (todos los de ventas)
- Preparación (todos los preparadores)
- Managers
- General (todos los usuarios)
- Clock-in & Clock-out → **REEMPLAZADO** por el módulo de asistencia automático

El admin puede crear grupos adicionales con cualquier nombre.

---

## 12. MIGRACIÓN DE BITRIX24

**Volumen estimado: ~6,183 registros históricos** (visible en el dashboard de Bitrix actual)

### Script de migración
Ver sección 21 de CLAUDE.md V1 para el proceso completo.

**Prioridad de migración:**
1. Contactos activos con trámites en progreso
2. Deals/oportunidades activas
3. Historial de pagos
4. Documentos adjuntos → GHL Media Store
5. Datos históricos (los 6,183 registros)

---

## 13. ORDEN DE IMPLEMENTACIÓN

### Fase 1 — Infraestructura (días 1-3)
1. Clonar repo en VPS
2. Instalar TODAS las dependencias (sección 2)
3. Configurar Supabase con esquema SQL completo (sección 3)
4. Configurar DNS en Namecheap
5. Configurar Nginx y SSL
6. Configurar PM2
7. Ejecutar script de super admin
8. Verificar Gemma 4 e instalar según disponibilidad de recursos

### Fase 2 — Auth y UI base (días 4-7)
9. Login animado con partículas
10. Sistema de autenticación JWT
11. Layout principal con sidebar animado
12. Routing y page transitions
13. Dark/light mode
14. Sistema de notificaciones con sonido

### Fase 3 — CRM core (días 8-14)
15. Módulo de contactos + sync GHL
16. Módulo de oportunidades con kanban
17. Sistema de asignación y colas
18. Sistema de SLA con alertas visuales
19. Módulo financiero básico

### Fase 4 — Comunicaciones (días 15-18)
20. Chat interno tipo Meta con Socket.io
21. Videollamadas Jitsi embebido
22. Módulo de correo IMAP/SMTP

### Fase 5 — IA y documentos (días 19-23)
23. Integración Anthropic API para revisión de formularios
24. Integración Gemma 4 para pre-procesamiento
25. Sistema de cuestionarios JSON
26. Generación de documentos administrativos

### Fase 6 — Avanzado (días 24-30)
27. Academia LMS completa
28. Dashboards con todas las gráficas
29. API Key y Webhook generator
30. App móvil React Native
31. Integración QuickBooks Online
32. Pipeline de transcripción Jibri + Whisper
33. Migración de Bitrix24
34. Testing y ajustes finales

---

*CLAUDE.md V2 — GOZZ CRM*  
*Generado en Claude.ai — Abril 2026*  
*Para implementación con Claude Code por Jhosnel Roas*

---

## MÓDULO DE TAREAS — ESPECIFICACIÓN COMPLETA

### Inspirado en Bitrix24 — con IA integrada

---

### Vistas disponibles
El módulo de tareas debe tener exactamente estas 6 vistas con tabs navegables:
1. **Lista** — tabla con todas las tareas
2. **Fecha límite** — agrupadas por fecha de vencimiento
3. **Planificador** — vista semanal de tareas por persona
4. **Calendario** — vista mensual
5. **Gantt** — diagrama de barras por duración
6. **Kanban** — columnas por estado

---

### Tabla de tareas — columnas
| Columna | Descripción |
|---------|-------------|
| Checkbox | Selección múltiple para acciones en lote |
| Nombre | Título de la tarea con ícono 🔥 si es urgente |
| Actividad | Fecha de última actividad |
| Fecha límite | Badge con color dinámico: 🟢 verde=hoy/mañana, 🔵 azul=futuro, 🔴 rojo=vencida, gris=sin fecha |
| Creado por | Avatar + nombre |
| Responsable | Avatar + nombre |
| Proyecto/Oportunidad | Vinculada si aplica |
| Etiquetas | Pills de colores |

### Tabs de filtro rápido
- **Chats de tareas** — con badge de mensajes no leídos
- **Vencido** — con contador en rojo
- **Comentarios** — con contador de no leídos

### Filtros disponibles
- Por rol (Todos los roles / mis tareas / asignadas por mí / supervisando)
- Por estado (En progreso / Pendiente / Completada / Vencida)
- Por persona (creador / responsable)
- Por fecha límite (rango de fechas)
- Por proyecto/oportunidad vinculada
- Búsqueda por texto libre

---

### Vista individual de tarea
Cuando se abre una tarea, la pantalla se divide en dos paneles:

**Panel izquierdo — detalle de la tarea:**
- Título editable
- Descripción enriquecida (texto largo)
- Propietario de la tarea
- Responsable (quien la ejecuta)
- Fecha límite con selector de fecha/hora
- Estado: Pendiente / En progreso / Completada / Cancelada
- Observadores (pueden ver pero no editar)
- Fecha de creación + ID único de la tarea
- Tabs inferiores:
  - **Resúmenes del estado** — actualizaciones de progreso
  - **Archivos** — adjuntos de la tarea
  - **Listas de verificación** — checklist interno
  - **Subtareas** — tareas hijas vinculadas
  - **Seguimiento del tiempo** — timer para registrar horas trabajadas

**Panel derecho — Chat de la tarea:**
- Chat privado entre propietario y responsable (y observadores)
- Muestra quiénes son los miembros del chat
- Botón de videollamada directa desde el chat de la tarea
- Historial completo de mensajes
- Notificaciones automáticas del sistema (cambios de estado, vencimientos)
- Soporte para audio, archivos, imágenes
- Menciones con @

**Botones de acción:**
- **Iniciar** → cambia estado a "En progreso", registra hora de inicio
- **Completar** → cambia estado a "Completada", registra hora de cierre
- **···** → más opciones (duplicar, eliminar, mover)

---

### FUNCIÓN CLAVE: Crear tareas desde mensajes de audio (IA)

Esta es la función más importante del módulo. Funciona exactamente como el CoPilot de Bitrix:

**Flujo:**
1. El usuario envía un mensaje de **audio** en el chat interno del CRM
2. El sistema detecta que es un audio
3. **Whisper.cpp** transcribe el audio automáticamente
4. El texto transcrito se envía a **Claude API** con el siguiente prompt:

```
Analiza este mensaje de voz y extrae la información para crear una tarea.
Devuelve SOLO un JSON con:
{
  "es_tarea": true/false,
  "titulo": "título conciso de la tarea",
  "descripcion": "descripción completa de lo que se debe hacer",
  "responsable_mencionado": "nombre si se menciona alguna persona",
  "fecha_limite_sugerida": "fecha si se menciona (ISO 8601)",
  "urgente": true/false,
  "oportunidad_relacionada": "si se menciona algún cliente o trámite"
}

Mensaje transcrito: "{transcripcion}"
```

5. Si `es_tarea: true`, el sistema muestra un **card de confirmación** en el chat:
   - "CoPilot detectó una tarea en tu mensaje de audio"
   - Muestra todos los campos extraídos
   - Botón **"Crear tarea"** y botón **"Descartar"**
6. Al hacer clic en "Crear tarea":
   - Se crea la tarea con todos los campos pre-llenados
   - Se notifica al responsable mencionado
   - El card en el chat cambia a "✓ Tarea creada: [link a la tarea]"
7. Si no se menciona responsable → se asigna al usuario que mandó el audio

**Casos de uso reales (como se ve en las imágenes):**
- Juan manda un audio: "John, por favor la llamada de Fadon que tuvimos con Alejandro, sácale las tareas para nosotros..."
- El sistema crea automáticamente: Título "Extraer tareas y estructurar vídeos de agendamiento", Responsable: Jhosnel Johann, Fecha: mañana 18:00

---

### Schema MySQL para el módulo de tareas

```sql
USE crm_tuagente;

CREATE TABLE tareas (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  numero_tarea INT NOT NULL AUTO_INCREMENT,
  titulo VARCHAR(500) NOT NULL,
  descripcion LONGTEXT,
  descripcion_html LONGTEXT,
  propietario_id CHAR(36) NOT NULL,
  responsable_id CHAR(36),
  observadores JSON DEFAULT (JSON_ARRAY()),
  estado ENUM('pendiente','en_progreso','completada','cancelada','en_espera') DEFAULT 'pendiente',
  prioridad ENUM('baja','normal','alta','urgente') DEFAULT 'normal',
  urgente TINYINT(1) DEFAULT 0,
  fecha_limite TIMESTAMP NULL,
  fecha_inicio TIMESTAMP NULL,
  fecha_inicio_real TIMESTAMP NULL,
  fecha_completada TIMESTAMP NULL,
  tiempo_estimado_minutos INT,
  tiempo_trabajado_minutos INT DEFAULT 0,
  oportunidad_id CHAR(36),
  proyecto VARCHAR(200),
  etiquetas JSON DEFAULT (JSON_ARRAY()),
  subtarea_de CHAR(36),
  creada_por_ia TINYINT(1) DEFAULT 0,
  audio_origen_url TEXT,
  transcripcion_origen TEXT,
  checklist JSON DEFAULT (JSON_ARRAY()),
  archivos JSON DEFAULT (JSON_ARRAY()),
  ultima_actividad TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  vencida TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tareas_numero (numero_tarea),
  INDEX idx_tareas_responsable (responsable_id, estado),
  INDEX idx_tareas_propietario (propietario_id),
  INDEX idx_tareas_fecha_limite (fecha_limite, vencida),
  INDEX idx_tareas_oportunidad (oportunidad_id),
  INDEX idx_tareas_estado (estado, created_at DESC),
  FOREIGN KEY fk_tareas_propietario (propietario_id) REFERENCES usuarios(id),
  FOREIGN KEY fk_tareas_responsable (responsable_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY fk_tareas_oportunidad (oportunidad_id) REFERENCES oportunidades(id) ON DELETE SET NULL,
  FOREIGN KEY fk_tareas_padre (subtarea_de) REFERENCES tareas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
AUTO_INCREMENT=70000;

-- Comentarios/chat dentro de cada tarea
CREATE TABLE tareas_comentarios (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tarea_id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  tipo ENUM('texto','audio','archivo','imagen','sistema') DEFAULT 'texto',
  contenido TEXT,
  archivo_url TEXT,
  archivo_nombre VARCHAR(255),
  archivo_tipo VARCHAR(100),
  menciones JSON DEFAULT (JSON_ARRAY()),
  leido_por JSON DEFAULT (JSON_ARRAY()),
  editado TINYINT(1) DEFAULT 0,
  eliminado TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_comentarios_tarea (tarea_id, created_at),
  FOREIGN KEY fk_comentarios_tarea (tarea_id) REFERENCES tareas(id) ON DELETE CASCADE,
  FOREIGN KEY fk_comentarios_usuario (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seguimiento de tiempo por tarea
CREATE TABLE tareas_tiempo (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tarea_id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  inicio TIMESTAMP NOT NULL,
  fin TIMESTAMP,
  duracion_minutos INT,
  notas TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_tiempo_tarea (tarea_id),
  FOREIGN KEY fk_tiempo_tarea (tarea_id) REFERENCES tareas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Propuestas de tarea generadas por IA desde audios
CREATE TABLE tareas_propuestas_ia (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  mensaje_audio_id CHAR(36),
  grupo_chat_id CHAR(36),
  usuario_origen_id CHAR(36) NOT NULL,
  transcripcion TEXT,
  titulo_sugerido VARCHAR(500),
  descripcion_sugerida TEXT,
  responsable_sugerido_id CHAR(36),
  fecha_limite_sugerida TIMESTAMP NULL,
  urgente_sugerido TINYINT(1) DEFAULT 0,
  oportunidad_sugerida_id CHAR(36),
  estado ENUM('pendiente','aceptada','descartada') DEFAULT 'pendiente',
  tarea_creada_id CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY fk_propuestas_usuario (usuario_origen_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### Notificaciones automáticas del módulo de tareas

| Evento | Quién recibe | Sonido |
|--------|-------------|--------|
| Tarea asignada a mí | Responsable | notification.mp3 |
| Tarea vence en 24h | Responsable + Propietario | warning.mp3 |
| Tarea vencida | Responsable + Propietario + Admins | alert.mp3 |
| Nuevo comentario en mi tarea | Propietario + Observadores | message.mp3 |
| IA detectó tarea en audio | Solo el emisor del audio | pop.mp3 |
| Subtarea completada | Propietario de tarea padre | success.mp3 |
| Tarea completada | Propietario | success.mp3 |

---

### Librerías adicionales para este módulo

```bash
# Gantt chart
npm install dhtmlx-gantt
npm install react-gantt-timeline
npm install frappe-gantt

# Calendario avanzado
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid
npm install @fullcalendar/interaction @fullcalendar/list @fullcalendar/gantt

# Timer de seguimiento de tiempo
npm install react-timer-hook
npm install react-stopwatch-timer

# Editor de checklist
npm install react-beautiful-dnd
npm install @dnd-kit/core @dnd-kit/sortable

# Reproductor de audio para mensajes de voz
npm install react-h5-audio-player
npm install wavesurfer.js react-wavesurfer

# Grabación de audio desde el navegador
npm install react-media-recorder
npm install recordrtc
```

---

*Sección agregada: Módulo de Tareas — Abril 2026*

---

## MÓDULO DE PERFIL DE USUARIO — ESPECIFICACIÓN COMPLETA

### Inspirado en Bitrix24 — perfil completo del equipo

---

### Vista del perfil de usuario

Cada usuario del CRM tiene su página de perfil completa accesible desde:
- El sidebar (clic en su avatar)
- El directorio del equipo
- Menciones en el chat (clic en el nombre)
- El header cuando es el propio usuario

---

### Layout del perfil

**Panel izquierdo:**
- Foto de perfil circular con borde de color del usuario
- Indicador de estado: 🟢 En línea / 🟡 Ausente / ⚫ Desconectado
- Botones: "Tomar una foto" / "Subir una foto"
- Links de descarga: App móvil (iOS + Android) / App de escritorio
- **Sección de Reconocimientos** — badges que el equipo se puede dar entre sí

**Panel derecho — Información de contacto (editable):**
- Nombre
- Apellido
- Segundo nombre
- Correo electrónico
- Fecha de nacimiento
- Sexo
- Teléfono móvil
- Idioma de notificaciones
- Posición (cargo en la empresa)
- Supervisor (con foto y nombre)
- Departamento

---

### Tabs del perfil

| Tab | Contenido |
|-----|-----------|
| **General** | Información de contacto y reconocimientos |
| **Tareas** | Todas las tareas asignadas a este usuario |
| **Calendario** | Su calendario personal |
| **Drive** | Sus archivos y documentos subidos |
| **Feed** | Actividad reciente del usuario |
| **Mis documentos** | Documentos del CRM que maneja |
| **Eficiencia** | Porcentaje de tareas completadas a tiempo |
| **Tiempo de trabajo** | Registro de horas y asistencia |
| **Reportes de trabajo** | Resumen de productividad |

---

### Tab Eficiencia — cálculo del porcentaje

El porcentaje de eficiencia se calcula así:
```
Eficiencia = (Tareas completadas a tiempo / Total tareas completadas) × 100
```

Se muestra con:
- Número grande y colorido (verde >80%, amarillo 50-80%, rojo <50%)
- Gráfica de barras por mes
- Comparativa vs. el mes anterior
- Desglose: tareas a tiempo, tardías, en progreso, canceladas

---

### Sistema de Reconocimientos (Badges)

Los usuarios pueden enviarse reconocimientos entre sí. Los admins también pueden otorgarlos.

**Tipos de reconocimientos predefinidos:**
- 👍 Buen trabajo
- 🎁 Gracias
- 🏆 Logro destacado
- 💰 Meta cumplida
- 👑 Líder del mes
- 🍸 Trabajo en equipo
- 🎂 Cumpleaños
- ① Primer trámite
- 🚩 Hito importante
- ⭐ Estrella
- ❤️ Compañero del mes
- 🍺 Viernes de logros
- 🎯 Precisión
- 😊 Mejor actitud

Cada reconocimiento muestra:
- El ícono del badge
- Quién lo otorgó
- Fecha
- Mensaje personalizado opcional
- Contador de cuántas veces recibió ese badge

---

### Schema MySQL — tablas del perfil

```sql
USE crm_tuagente;

-- =============================================
-- TABLA: departamentos
-- =============================================
CREATE TABLE departamentos (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  jefe_id CHAR(36),
  color VARCHAR(7) DEFAULT '#FF6B00',
  activo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY fk_dep_jefe (jefe_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar departamentos base
INSERT INTO departamentos (nombre, color) VALUES
('Ventas', '#3B82F6'),
('Preparación', '#10B981'),
('Taxes', '#F59E0B'),
('Marketing', '#8B5CF6'),
('Administración', '#EF4444'),
('Medicare', '#06B6D4'),
('Post-venta', '#F97316');

-- =============================================
-- TABLA: usuarios_perfil_extendido
-- (Campos adicionales del perfil que no están en usuarios)
-- =============================================
CREATE TABLE usuarios_perfil (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  usuario_id CHAR(36) NOT NULL,
  segundo_nombre VARCHAR(100),
  fecha_nacimiento DATE,
  sexo ENUM('masculino','femenino','otro','no_especificado'),
  telefono_movil VARCHAR(50),
  telefono_trabajo VARCHAR(50),
  extension_trabajo VARCHAR(20),
  departamento_id CHAR(36),
  supervisor_id CHAR(36),
  fecha_ingreso DATE,
  biografia TEXT,
  redes_sociales JSON DEFAULT (JSON_ARRAY()),
  habilidades JSON DEFAULT (JSON_ARRAY()),
  idiomas JSON DEFAULT (JSON_ARRAY()),
  estado_personalizado VARCHAR(200),
  estado_emoji VARCHAR(10),
  estado_expira TIMESTAMP NULL,
  modo_vacaciones TINYINT(1) DEFAULT 0,
  mensaje_vacaciones TEXT,
  eficiencia_porcentaje DECIMAL(5,2) DEFAULT 0,
  total_tareas_completadas INT DEFAULT 0,
  total_tareas_tiempo INT DEFAULT 0,
  total_tareas_tarde INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_perfil_usuario (usuario_id),
  FOREIGN KEY fk_perfil_usuario (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY fk_perfil_departamento (departamento_id) REFERENCES departamentos(id) ON DELETE SET NULL,
  FOREIGN KEY fk_perfil_supervisor (supervisor_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- TABLA: reconocimientos_tipos
-- =============================================
CREATE TABLE reconocimientos_tipos (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  nombre VARCHAR(100) NOT NULL,
  icono VARCHAR(10) NOT NULL,
  descripcion VARCHAR(300),
  activo TINYINT(1) DEFAULT 1,
  orden INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar tipos de reconocimiento
INSERT INTO reconocimientos_tipos (nombre, icono, orden) VALUES
('Buen trabajo', '👍', 1),
('Gracias', '🎁', 2),
('Logro destacado', '🏆', 3),
('Meta cumplida', '💰', 4),
('Líder del mes', '👑', 5),
('Trabajo en equipo', '🍸', 6),
('Cumpleaños', '🎂', 7),
('Primer trámite', '①', 8),
('Hito importante', '🚩', 9),
('Estrella', '⭐', 10),
('Compañero del mes', '❤️', 11),
('Viernes de logros', '🍺', 12),
('Precisión', '🎯', 13),
('Mejor actitud', '😊', 14);

-- =============================================
-- TABLA: reconocimientos
-- =============================================
CREATE TABLE reconocimientos (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tipo_id CHAR(36) NOT NULL,
  otorgado_a CHAR(36) NOT NULL,
  otorgado_por CHAR(36) NOT NULL,
  mensaje TEXT,
  visible_para_todos TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_reconocimientos_receptor (otorgado_a, created_at DESC),
  INDEX idx_reconocimientos_tipo (tipo_id),
  FOREIGN KEY fk_reconoc_tipo (tipo_id) REFERENCES reconocimientos_tipos(id),
  FOREIGN KEY fk_reconoc_receptor (otorgado_a) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY fk_reconoc_emisor (otorgado_por) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- VISTA: eficiencia por usuario
-- =============================================
CREATE VIEW v_eficiencia_usuarios AS
SELECT
  u.id,
  u.nombre,
  u.apellido,
  COUNT(t.id) as total_tareas,
  SUM(CASE WHEN t.estado = 'completada' THEN 1 ELSE 0 END) as completadas,
  SUM(CASE WHEN t.estado = 'completada' AND t.fecha_completada <= t.fecha_limite THEN 1 ELSE 0 END) as a_tiempo,
  SUM(CASE WHEN t.estado = 'completada' AND t.fecha_completada > t.fecha_limite THEN 1 ELSE 0 END) as tardias,
  ROUND(
    SUM(CASE WHEN t.estado = 'completada' AND t.fecha_completada <= t.fecha_limite THEN 1 ELSE 0 END) /
    NULLIF(SUM(CASE WHEN t.estado = 'completada' THEN 1 ELSE 0 END), 0) * 100, 2
  ) as eficiencia_porcentaje
FROM usuarios u
LEFT JOIN tareas t ON t.responsable_id = u.id
GROUP BY u.id;
```

---

### Directorio del equipo

Además del perfil individual, el CRM tiene una vista de **Directorio del Equipo** accesible desde el sidebar:

- Grid de cards con foto, nombre, posición, departamento y estado online
- Filtro por departamento
- Filtro por estado (en línea / todos)
- Búsqueda por nombre
- Al hacer clic en cualquier card → abre el perfil completo
- Botón de mensaje directo desde la card
- Botón de videollamada directa desde la card

---

### Campos del formulario de creación/edición de usuario (solo admins)

```
Sección: Datos personales
- Nombre *
- Apellido *
- Segundo nombre
- Email corporativo *
- Contraseña temporal (se fuerza cambio en primer login)
- Fecha de nacimiento
- Sexo
- Teléfono móvil
- Foto de perfil

Sección: Información laboral
- Posición / Cargo *
- Departamento
- Supervisor
- Fecha de ingreso
- Nivel de acceso (solo super_admin puede cambiar esto)
- Posiciones múltiples (multi-select)

Sección: Permisos granulares
- [toggles por módulo — ver sección 7 del CLAUDE.md V2]
```

---

*Sección agregada: Módulo de Perfil de Usuario — Abril 2026*

---

## MÓDULO DE VIDEOLLAMADAS — ESPECIFICACIÓN COMPLETA 2026

### Interfaz tendencia 2026 + Chat estilo Twitch + IA de transcripción gratuita

---

### Stack técnico de videollamadas

```bash
# Jitsi Meet embebido (videollamada principal)
npm install @jitsi/react-sdk

# Transcripción gratuita local — Whisper.cpp (ya instalado en VPS)
# NO usa API externa — corre 100% en el VPS sin costo

# Análisis con Claude API (ya configurada en el VPS)
# Solo se consume cuando se solicita el resumen

# Chat en tiempo real
npm install socket.io-client

# Efectos visuales de la sala
npm install @tsparticles/react framer-motion

# Waveform para audio del chat
npm install wavesurfer.js

# Grabación del audio del browser
npm install recordrtc react-media-recorder

# Notificaciones dentro de la sala
npm install react-hot-toast
```

---

### Diseño de la sala de videollamada — Estándares 2026

#### Layout principal
```
┌─────────────────────────────────────────────────────────┐
│  HEADER: Logo + Nombre de la sala + Timer + Controles   │
├────────────────────────────────────┬────────────────────┤
│                                    │  CHAT ESTILO       │
│    ÁREA DE VIDEO PRINCIPAL         │  TWITCH            │
│    (Jitsi iframe fullscreen)       │                    │
│                                    │  [Avatar] Juan     │
│    ┌──┐ ┌──┐ ┌──┐ ┌──┐            │  hola a todos 👋   │
│    │  │ │  │ │  │ │  │            │                    │
│    └──┘ └──┘ └──┘ └──┘            │  [Avatar] Jhosnel  │
│    Thumbnails participantes        │  revisando... 👀   │
│                                    │                    │
│                                    │  [Input mensaje]   │
├────────────────────────────────────┴────────────────────┤
│  BARRA INFERIOR: Mic | Cam | Screen | Chat | IA | End   │
└─────────────────────────────────────────────────────────┘
```

#### Paleta visual de la sala
```css
/* Sala de videollamada — dark mode exclusivo */
--sala-bg: #0A0A0F;
--sala-header: rgba(15, 15, 25, 0.95);
--sala-chat-bg: rgba(18, 18, 30, 0.98);
--sala-chat-input: rgba(30, 30, 50, 0.9);
--sala-control-bg: rgba(20, 20, 35, 0.95);
--sala-accent: #FF6B00;
--sala-accent-glow: rgba(255, 107, 0, 0.4);
--sala-participante-border: rgba(255, 107, 0, 0.6);
--sala-speaking-glow: 0 0 20px rgba(255, 107, 0, 0.8);
--twitch-chat-bg: #18181B;
--twitch-mensaje-hover: rgba(255,255,255,0.05);
```

---

### Chat lateral estilo Twitch

#### Características exactas
- Fondo oscuro `#18181B` igual que Twitch
- Mensajes fluyen de abajo hacia arriba
- Auto-scroll al último mensaje
- Si el usuario hace scroll hacia arriba → aparece botón "↓ Volver al chat en vivo"
- Cada mensaje tiene: avatar circular + nombre en color único por usuario + mensaje + timestamp al hover
- Badges de rol junto al nombre: 🟠 Admin, 🟣 Preparador, 🔵 Ventas, 🟢 Manager
- Soporte para emojis, GIFs y stickers del equipo
- Reacciones rápidas flotantes al hover (👍 ❤️ 😂 🔥 👏)
- Mensajes del sistema en gris centrado: "Juan activó su cámara", "Jhosnel se unió"
- Input con: emoji picker, adjuntar archivo, audio, GIF, enviar

#### Notificaciones dentro del chat Twitch
Cuando la IA está transcribiendo en tiempo real, aparece una barra sobre el input:
```
🔴 TRANSCRIBIENDO EN VIVO  |  "...Alejandro mencionó que el formulario..."
```

---

### Barra de controles inferior

```
[🎤 Mic] [📷 Cam] [🖥️ Pantalla] [💬 Chat] [👥 Participantes] [🤖 IA] [⚙️] [🔴 Terminar]
```

Cada botón con:
- Animación de pulso cuando está activo
- Badge de notificación (ej: mensajes no leídos en Chat)
- Tooltip al hover con nombre y shortcut de teclado
- El botón **🤖 IA** abre el panel de transcripción en vivo

---

### Panel de IA en vivo (durante la llamada)

Al hacer clic en 🤖 IA, se abre un panel lateral derecho (reemplaza el chat o se superpone):

```
┌─────────────────────────────────┐
│  🤖 IA — TRANSCRIPCIÓN EN VIVO  │
│  ● GRABANDO  00:14:32           │
├─────────────────────────────────┤
│                                 │
│  Juan (14:02): "Necesitamos     │
│  revisar el formulario I-485    │
│  antes del viernes..."          │
│                                 │
│  Jhosnel (14:03): "Claro, yo    │
│  lo reviso esta tarde y te      │
│  confirmo por el chat..."       │
│                                 │
│  [Scrollable - transcripción    │
│   completa en tiempo real]      │
│                                 │
├─────────────────────────────────┤
│  [🔵 Generar resumen ahora]     │
└─────────────────────────────────┘
```

---

### Flujo técnico completo de transcripción y resumen

```
DURANTE LA LLAMADA:
Jibri graba audio → chunks de 30 segundos
→ Whisper.cpp transcribe cada chunk (local, gratis)
→ Texto aparece en panel de IA en tiempo real

AL TERMINAR LA LLAMADA:
1. Jibri guarda el .mp4 completo en /var/recordings/
2. FFmpeg extrae audio .wav del .mp4
3. Whisper.cpp hace transcripción final completa
4. Se envía a Claude API con prompt profesional
5. Claude genera el resumen estructurado
6. Se muestra el card de resumen en el chat del equipo
7. Se guarda en la oportunidad vinculada (si había una)
```

---

### Prompt de Claude para el resumen (optimizado para inmigración)

```javascript
const promptResumen = `
Eres el asistente oficial de GOZZ LLC.
Analiza esta transcripción de una videollamada interna del equipo y genera un resumen ejecutivo PROFESIONAL.

PARTICIPANTES: ${participantes.join(', ')}
DURACIÓN: ${duracion}
FECHA: ${fecha}
OPORTUNIDAD VINCULADA: ${oportunidad || 'No vinculada'}

TRANSCRIPCIÓN COMPLETA:
${transcripcion}

Genera un JSON con exactamente esta estructura:
{
  "titulo": "Título descriptivo de la reunión en máximo 10 palabras",
  "resumen_ejecutivo": "Párrafo de 3-4 oraciones describiendo el propósito y resultado de la llamada",
  "puntos_clave": [
    "Punto importante 1",
    "Punto importante 2",
    "Punto importante 3"
  ],
  "decisiones_tomadas": [
    "Decisión 1 tomada en la llamada",
    "Decisión 2"
  ],
  "tareas_detectadas": [
    {
      "descripcion": "Qué hay que hacer",
      "responsable": "Nombre de quien lo dijo o a quien se le asignó",
      "fecha_mencionada": "Si se mencionó una fecha, sino null"
    }
  ],
  "proximos_pasos": [
    "Próximo paso 1",
    "Próximo paso 2"
  ],
  "tono_reunion": "positivo | neutral | tenso | urgente",
  "requiere_seguimiento": true/false,
  "notas_importantes": "Cualquier dato crítico que el equipo debe saber"
}

IMPORTANTE: 
- Responde SOLO el JSON, sin texto adicional
- Sé específico con nombres y trámites mencionados
- Detecta automáticamente tareas aunque no se digan explícitamente
- Si se menciona un cliente, trámite o formulario USCIS, inclúyelo
`;
```

---

### Card de resumen post-llamada (lo que aparece en el chat)

Exactamente como el card de Bitrix que se ve en la imagen, pero con diseño profesional 2026:

```jsx
// Componente React del card de resumen
const ResumenLlamadaCard = ({ resumen, duracion, participantes, onVerTranscripcion, onCrearTareas }) => (
  <div className="resumen-card">
    
    {/* Header del card */}
    <div className="resumen-header">
      <div className="resumen-header-left">
        <div className="ia-badge">
          <span className="ia-icon">🤖</span>
          <span>IA generó este resumen</span>
        </div>
        <span className="resumen-origen">
          a partir de la videollamada de <strong>{duracion}</strong>
        </span>
      </div>
      <div className="resumen-participantes">
        {participantes.map(p => <Avatar key={p.id} user={p} size="sm" />)}
      </div>
    </div>

    {/* Título y tono */}
    <div className="resumen-titulo-row">
      <h3 className="resumen-titulo">{resumen.titulo}</h3>
      <TonoBadge tono={resumen.tono_reunion} />
    </div>

    {/* Resumen ejecutivo */}
    <p className="resumen-ejecutivo">{resumen.resumen_ejecutivo}</p>

    {/* Grid de secciones */}
    <div className="resumen-grid">
      
      {/* Puntos clave */}
      <div className="resumen-seccion">
        <h4>📌 Puntos clave</h4>
        <ul>
          {resumen.puntos_clave.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </div>

      {/* Decisiones */}
      {resumen.decisiones_tomadas.length > 0 && (
        <div className="resumen-seccion">
          <h4>✅ Decisiones tomadas</h4>
          <ul>
            {resumen.decisiones_tomadas.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {/* Próximos pasos */}
      <div className="resumen-seccion">
        <h4>🎯 Próximos pasos</h4>
        <ul>
          {resumen.proximos_pasos.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </div>

    </div>

    {/* Tareas detectadas */}
    {resumen.tareas_detectadas.length > 0 && (
      <div className="resumen-tareas">
        <h4>📋 Tareas detectadas por IA</h4>
        {resumen.tareas_detectadas.map((t, i) => (
          <div key={i} className="tarea-detectada-row">
            <div className="tarea-info">
              <span className="tarea-desc">{t.descripcion}</span>
              <span className="tarea-responsable">→ {t.responsable}</span>
              {t.fecha_mencionada && (
                <span className="tarea-fecha">📅 {t.fecha_mencionada}</span>
              )}
            </div>
            <button className="btn-crear-tarea-mini">+ Crear tarea</button>
          </div>
        ))}
        <button className="btn-crear-todas" onClick={() => onCrearTareas(resumen.tareas_detectadas)}>
          Crear todas las tareas detectadas
        </button>
      </div>
    )}

    {/* Notas importantes */}
    {resumen.notas_importantes && (
      <div className="resumen-nota-importante">
        <span>⚠️</span>
        <p>{resumen.notas_importantes}</p>
      </div>
    )}

    {/* Footer con botones de acción */}
    <div className="resumen-footer">
      <button className="btn-transcripcion" onClick={onVerTranscripcion}>
        📄 Ver transcripción completa
      </button>
      <button className="btn-descargar">
        ⬇️ Descargar resumen
      </button>
      <button className="btn-vincular">
        🔗 Vincular a oportunidad
      </button>
    </div>

  </div>
);
```

---

### CSS del card de resumen

```css
.resumen-card {
  background: linear-gradient(135deg, rgba(20,20,40,0.95), rgba(15,15,30,0.98));
  border: 1px solid rgba(255, 107, 0, 0.3);
  border-left: 4px solid #FF6B00;
  border-radius: 16px;
  padding: 20px;
  max-width: 680px;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,107,0,0.1);
  animation: slideInUp 0.4s ease-out;
}

.resumen-titulo {
  font-size: 18px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0;
}

.ia-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 107, 0, 0.15);
  border: 1px solid rgba(255, 107, 0, 0.4);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  color: #FF8C33;
  font-weight: 600;
}

.resumen-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 16px 0;
}

.resumen-seccion h4 {
  font-size: 13px;
  font-weight: 600;
  color: #FF6B00;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.resumen-seccion ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.resumen-seccion ul li {
  font-size: 14px;
  color: #D1D5DB;
  padding: 4px 0;
  padding-left: 12px;
  position: relative;
}

.resumen-seccion ul li::before {
  content: '›';
  position: absolute;
  left: 0;
  color: #FF6B00;
}

.tarea-detectada-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255,255,255,0.04);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 8px;
  border: 1px solid rgba(255,255,255,0.08);
}

.btn-crear-tarea-mini {
  background: rgba(255, 107, 0, 0.2);
  border: 1px solid rgba(255, 107, 0, 0.5);
  color: #FF8C33;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.btn-crear-todas {
  width: 100%;
  background: linear-gradient(135deg, #FF6B00, #E55A00);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
  transition: all 0.2s;
}

.resumen-nota-importante {
  display: flex;
  gap: 10px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}

.resumen-footer {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
  flex-wrap: wrap;
}

.btn-transcripcion {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #93C5FD;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

/* Modal de transcripción completa */
.transcripcion-modal {
  background: #0A0A0F;
  border-radius: 16px;
  padding: 24px;
  max-height: 70vh;
  overflow-y: auto;
}

.transcripcion-linea {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.transcripcion-speaker {
  font-weight: 600;
  color: #FF6B00;
  min-width: 120px;
  font-size: 13px;
}

.transcripcion-tiempo {
  color: #6B7280;
  font-size: 12px;
  min-width: 50px;
}

.transcripcion-texto {
  color: #D1D5DB;
  font-size: 14px;
  line-height: 1.6;
}

@keyframes slideInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

### Badge de tono de reunión

```jsx
const TonoBadge = ({ tono }) => {
  const config = {
    positivo: { color: '#10B981', bg: 'rgba(16,185,129,0.15)', icon: '😊', label: 'Positiva' },
    neutral:  { color: '#6B7280', bg: 'rgba(107,114,128,0.15)', icon: '😐', label: 'Neutral' },
    tenso:    { color: '#EF4444', bg: 'rgba(239,68,68,0.15)', icon: '😤', label: 'Tensa' },
    urgente:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', icon: '⚡', label: 'Urgente' },
  };
  const c = config[tono] || config.neutral;
  return (
    <span style={{ 
      background: c.bg, color: c.color, border: `1px solid ${c.color}40`,
      borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: 600
    }}>
      {c.icon} {c.label}
    </span>
  );
};
```

---

### Modal de transcripción completa

Al hacer clic en "📄 Ver transcripción completa":

```
┌─────────────────────────────────────────────────────┐
│  📄 Transcripción completa                    [X]   │
│  Reunión: "Revisión formulario I-485"               │
│  14 de Abril 2026 · 14:00 · 23 minutos             │
├──────────────────────────────────────────────────── │
│  [Buscar en transcripción...    🔍]  [⬇️ Descargar] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  00:00  Juan        Buenos días a todos, vamos      │
│                     a revisar el caso de Maria...   │
│                                                     │
│  00:45  Jhosnel     El I-485 está casi listo,       │
│                     solo falta el campo 30...       │
│                                                     │
│  01:12  Juan        Perfecto, y el permiso de       │
│                     trabajo, ¿ya se envió?          │
│  ...                                                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### Schema MySQL adicional para videollamadas

```sql
USE crm_tuagente;

-- Ampliar tabla videollamadas con campos de resumen IA
ALTER TABLE videollamadas ADD COLUMN resumen_ia JSON AFTER analisis_claude;
ALTER TABLE videollamadas ADD COLUMN transcripcion_json LONGTEXT AFTER transcripcion_txt;
ALTER TABLE videollamadas ADD COLUMN tono_reunion VARCHAR(20) AFTER resumen_ia;
ALTER TABLE videollamadas ADD COLUMN tareas_detectadas JSON AFTER tono_reunion;
ALTER TABLE videollamadas ADD COLUMN resumen_generado TINYINT(1) DEFAULT 0;
ALTER TABLE videollamadas ADD COLUMN resumen_generado_at TIMESTAMP NULL;

-- Chat de la videollamada (mensajes tipo Twitch)
CREATE TABLE videollamadas_chat (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  videollamada_id CHAR(36) NOT NULL,
  usuario_id CHAR(36) NOT NULL,
  tipo ENUM('texto','audio','archivo','imagen','sistema','reaccion') DEFAULT 'texto',
  contenido TEXT,
  archivo_url TEXT,
  reaccion VARCHAR(10),
  mensaje_respondido_id CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_vl_chat (videollamada_id, created_at),
  FOREIGN KEY fk_vlchat_vl (videollamada_id) REFERENCES videollamadas(id) ON DELETE CASCADE,
  FOREIGN KEY fk_vlchat_user (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### Modelo de transcripción gratuita — Whisper.cpp

```bash
# Instalar Whisper.cpp en el VPS (100% gratuito, sin límites)
cd /opt
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make -j4

# Descargar modelo medium en español (mejor precisión para español latino)
bash ./models/download-ggml-model.sh medium.es
# O el modelo large-v3 si el VPS tiene suficiente RAM (más preciso)
bash ./models/download-ggml-model.sh large-v3

# Script de transcripción
# /opt/scripts/transcribir.sh
#!/bin/bash
AUDIO_FILE=$1
OUTPUT_FILE=$2
/opt/whisper.cpp/main \
  -m /opt/whisper.cpp/models/ggml-medium.es.bin \
  -f "$AUDIO_FILE" \
  -l es \
  --output-json \
  -of "$OUTPUT_FILE" \
  --word-timestamps true \
  --print-progress
```

---

*Sección agregada: Módulo de Videollamadas 2026 — Abril 2026*

---

## INTERFAZ SALA DE VIDEOLLAMADA — SPEC TÉCNICO COMPLETO 2026

### Componente React principal

```jsx
// /components/videollamada/SalaVideollamada.jsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { JitsiMeeting } from '@jitsi/react-sdk';
import { motion, AnimatePresence } from 'framer-motion';
import { useSound } from 'use-sound';
import Lottie from 'lottie-react';
import io from 'socket.io-client';

export default function SalaVideollamada({ oportunidadId, salaId, participantes, onTerminar }) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [blurEffect, setBlurEffect] = useState('none');
  const [showEffects, setShowEffects] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [transcripcionVivo, setTranscripcionVivo] = useState('');
  const [reaccionFlotante, setReaccionFlotante] = useState(null);
  const [duracion, setDuracion] = useState(0);
  const socketRef = useRef(null);
  const jitsiRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Sonidos
  const [playJoin] = useSound('/sounds/join.mp3', { volume: 0.5 });
  const [playMsg] = useSound('/sounds/message.mp3', { volume: 0.4 });
  const [playHand] = useSound('/sounds/hand.mp3', { volume: 0.6 });

  // Timer
  useEffect(() => {
    const interval = setInterval(() => setDuracion(d => d + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatDuracion = (secs) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // WebSocket para chat en tiempo real
  useEffect(() => {
    socketRef.current = io(process.env.NEXT_PUBLIC_SOCKET_URL);
    socketRef.current.emit('join-sala', { salaId, userId: currentUser.id });

    socketRef.current.on('chat-mensaje', (msg) => {
      setChatMsgs(prev => [...prev, msg]);
      playMsg();
    });

    socketRef.current.on('transcripcion-chunk', (texto) => {
      setTranscripcionVivo(texto);
    });

    socketRef.current.on('participante-hand', ({ userId, raised }) => {
      // Actualizar estado de mano de participante
    });

    return () => socketRef.current?.disconnect();
  }, [salaId]);

  // Grabación de audio para Whisper
  const iniciarGrabacion = useCallback(async () => {
    if (!aiOn) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream);
    audioChunksRef.current = [];

    mediaRecorderRef.current.ondataavailable = (e) => {
      audioChunksRef.current.push(e.data);
    };

    // Enviar chunk cada 30 segundos para transcripción en vivo
    mediaRecorderRef.current.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('audio', blob, 'chunk.wav');
      formData.append('salaId', salaId);

      const res = await fetch('/ai/transcribir-chunk', {
        method: 'POST',
        body: formData
      });
      const { texto } = await res.json();
      setTranscripcionVivo(texto);
      socketRef.current?.emit('transcripcion-chunk', { salaId, texto });

      // Reiniciar grabación
      if (aiOn && mediaRecorderRef.current) {
        audioChunksRef.current = [];
        mediaRecorderRef.current.start();
        setTimeout(() => mediaRecorderRef.current?.stop(), 30000);
      }
    };

    mediaRecorderRef.current.start();
    setTimeout(() => mediaRecorderRef.current?.stop(), 30000);
  }, [aiOn, salaId]);

  // Efectos de desenfoque de fondo (virtual background)
  const aplicarEfecto = async (tipo) => {
    setBlurEffect(tipo);
    if (jitsiRef.current) {
      const efectosMap = {
        'none': null,
        'blur': { type: 'blur', blurValue: 8 },
        'blur2': { type: 'blur', blurValue: 16 },
        'office': { type: 'image', url: '/backgrounds/office.jpg' },
        'nature': { type: 'image', url: '/backgrounds/nature.jpg' },
        'brand': { type: 'image', url: '/backgrounds/tuagente-brand.jpg' },
      };
      await jitsiRef.current.executeCommand(
        'toggleVirtualBackgroundEffect',
        efectosMap[tipo]
      );
    }
  };

  // Levantar la mano
  const toggleHand = () => {
    const newState = !handUp;
    setHandUp(newState);
    jitsiRef.current?.executeCommand('toggleRaiseHand');
    socketRef.current?.emit('toggle-hand', { salaId, userId: currentUser.id, raised: newState });
    if (newState) playHand();
  };

  // Terminar llamada y generar resumen
  const terminarLlamada = async () => {
    mediaRecorderRef.current?.stop();
    jitsiRef.current?.executeCommand('hangup');

    // Solicitar resumen al backend
    const res = await fetch('/api/videollamadas/generar-resumen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salaId, oportunidadId, duracion })
    });
    const resumen = await res.json();
    onTerminar(resumen);
  };

  // Enviar reacción
  const sendReaction = (emoji) => {
    setReaccionFlotante(emoji);
    setTimeout(() => setReaccionFlotante(null), 1500);
    socketRef.current?.emit('reaccion', { salaId, userId: currentUser.id, emoji });
  };

  return (
    <div className="sala-container">
      {/* Header */}
      <SalaHeader
        duracion={formatDuracion(duracion)}
        salaName={`Caso ${oportunidadId}`}
        onToggleEffects={() => setShowEffects(!showEffects)}
        onTerminar={terminarLlamada}
      />

      {/* Panel de efectos de fondo */}
      <AnimatePresence>
        {showEffects && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <EfectosPanel
              selected={blurEffect}
              onSelect={aplicarEfecto}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sala-body">
        {/* Video principal — Jitsi embebido */}
        <div className="video-area">
          <JitsiMeeting
            ref={jitsiRef}
            domain={process.env.NEXT_PUBLIC_JITSI_DOMAIN}
            roomName={salaId}
            configOverwrite={{
              startWithAudioMuted: false,
              startWithVideoMuted: false,
              prejoinPageEnabled: false,
              disableDeepLinking: true,
              toolbarButtons: [],
              virtualBackgrounds: true,
            }}
            interfaceConfigOverwrite={{
              SHOW_JITSI_WATERMARK: false,
              SHOW_BRAND_WATERMARK: false,
              TOOLBAR_ALWAYS_VISIBLE: false,
            }}
            onApiReady={(api) => {
              jitsiRef.current = api;
              iniciarGrabacion();
            }}
            getIFrameRef={(iframe) => {
              iframe.style.height = '100%';
              iframe.style.width = '100%';
              iframe.style.borderRadius = '14px';
            }}
          />

          {/* Reacción flotante */}
          <AnimatePresence>
            {reaccionFlotante && (
              <motion.div
                className="reaccion-flotante"
                initial={{ opacity: 1, y: 0, scale: 1 }}
                animate={{ opacity: 0, y: -80, scale: 1.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5 }}
              >
                {reaccionFlotante}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Chat estilo Twitch */}
        <TwitchChat
          mensajes={chatMsgs}
          transcribing={aiOn}
          transcripcionVivo={transcripcionVivo}
          onSendMsg={(text) => {
            socketRef.current?.emit('chat-mensaje', {
              salaId,
              userId: currentUser.id,
              texto: text
            });
          }}
        />
      </div>

      {/* Barra de controles */}
      <ControlBar
        micOn={micOn} onToggleMic={() => { setMicOn(!micOn); jitsiRef.current?.executeCommand('toggleAudio'); }}
        camOn={camOn} onToggleCam={() => { setCamOn(!camOn); jitsiRef.current?.executeCommand('toggleVideo'); }}
        screenOn={screenOn} onToggleScreen={() => { setScreenOn(!screenOn); jitsiRef.current?.executeCommand('toggleShareScreen'); }}
        handUp={handUp} onToggleHand={toggleHand}
        aiOn={aiOn} onToggleAI={() => setAiOn(!aiOn)}
        showReactions={showReactions} onToggleReactions={() => setShowReactions(!showReactions)}
        onSendReaction={sendReaction}
        onTerminar={terminarLlamada}
      />
    </div>
  );
}
```

### Estilos CSS globales de la sala

```css
/* /styles/videollamada.css */
.sala-container {
  background: #080810;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-height: 100vh;
  font-family: 'Inter', system-ui, sans-serif;
  color: #ffffff;
}

.sala-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 0;
}

.video-area {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

/* Animación de hablando */
@keyframes speaking-pulse {
  0%, 100% { box-shadow: 0 0 0 2px #22c55e; }
  50% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.5); }
}

.participante-hablando {
  animation: speaking-pulse 1s ease-in-out infinite;
}

/* Chat estilo Twitch */
.twitch-chat {
  width: 280px;
  background: #18181b;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
}

.twitch-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scroll-behavior: smooth;
}

.twitch-msgs::-webkit-scrollbar { width: 3px; }
.twitch-msgs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

.twitch-msg:hover { background: rgba(255, 255, 255, 0.04); }

/* Reacción flotante */
.reaccion-flotante {
  position: absolute;
  bottom: 100px;
  left: 50%;
  font-size: 48px;
  pointer-events: none;
  z-index: 100;
}

/* Controles */
.control-bar {
  background: rgba(10, 10, 20, 0.98);
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.ctrl-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.2s ease;
  position: relative;
}

.ctrl-btn.active {
  background: rgba(255, 107, 0, 0.15);
  border-color: rgba(255, 107, 0, 0.4);
}

.ctrl-btn.off {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.ctrl-btn:hover {
  transform: scale(1.1);
  filter: brightness(1.2);
}

.ctrl-btn.end-call {
  background: #ef4444;
  border-color: #dc2626;
  width: 54px;
  height: 54px;
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
}

.ctrl-btn.end-call:hover {
  background: #dc2626;
  box-shadow: 0 0 30px rgba(239, 68, 68, 0.6);
}

/* Shortcuts tooltip */
.ctrl-btn[title]:hover::after {
  content: attr(title);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  color: #fff;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
}
```

### Shortcuts de teclado

```javascript
// /hooks/useVideollamadaShortcuts.js
import { useEffect } from 'react';

export function useVideollamadaShortcuts({ onMic, onCam, onScreen, onHand, onEnd }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (key === 'm') onMic();
      if (key === 'v') onCam();
      if (key === 's' && e.metaKey) { e.preventDefault(); onScreen(); }
      if (key === 'h') onHand();
      if (key === 'escape') onEnd();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onMic, onCam, onScreen, onHand, onEnd]);
}
```

### Backend Python — transcripción en tiempo real

```python
# /crm-python/routes/transcripcion.py
from fastapi import APIRouter, UploadFile, File, Form
import subprocess, tempfile, os, json

router = APIRouter()

@router.post("/transcribir-chunk")
async def transcribir_chunk(audio: UploadFile = File(...), sala_id: str = Form(...)):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = subprocess.run([
            '/opt/whisper.cpp/main',
            '-m', '/opt/whisper.cpp/models/ggml-medium.es.bin',
            '-f', tmp_path,
            '-l', 'es',
            '--no-timestamps',
            '--output-txt',
            '-of', tmp_path
        ], capture_output=True, text=True, timeout=30)

        txt_path = tmp_path + '.txt'
        texto = ''
        if os.path.exists(txt_path):
            with open(txt_path, 'r') as f:
                texto = f.read().strip()
            os.unlink(txt_path)

        return {"texto": texto, "sala_id": sala_id}
    finally:
        os.unlink(tmp_path)

@router.post("/generar-resumen-final")
async def generar_resumen_final(sala_id: str, transcripcion_completa: str, participantes: list, duracion: str):
    import anthropic
    client = anthropic.Anthropic()

    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": f"""Eres el asistente de GOZZ LLC.
Analiza esta transcripción y genera un resumen ejecutivo profesional en JSON.

PARTICIPANTES: {', '.join(participantes)}
DURACIÓN: {duracion}

TRANSCRIPCIÓN:
{transcripcion_completa}

Devuelve SOLO JSON con: titulo, resumen_ejecutivo, puntos_clave (array), 
decisiones_tomadas (array), tareas_detectadas (array con descripcion/responsable/fecha_mencionada),
proximos_pasos (array), tono_reunion (positivo|neutral|tenso|urgente), 
requiere_seguimiento (bool), notas_importantes (string)"""
        }]
    )

    return json.loads(message.content[0].text)
```

---

*Sección agregada: Interfaz Sala Videollamada Spec Técnico — Abril 2026*

---

## DESIGN SYSTEM COMPLETO 2026 — TIPOGRAFÍAS, ANIMACIONES, ICONOS

### Este es el estándar visual obligatorio para TODO el CRM.
### Jhosnel debe aplicar este sistema en cada componente sin excepción.

---

### PASO 1 — Instalar todas las fuentes y librerías de diseño

```bash
# Google Fonts — agregar en /app/layout.tsx o _document.tsx
# URL completa para importar en el <head>:
# https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Syne:wght@400;500;600;700;800&family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap

npm install @fontsource/plus-jakarta-sans
npm install @fontsource/syne
npm install @fontsource/space-grotesk
npm install @fontsource/inter

# Iconos — instalar TODOS
npm install lucide-react
npm install @phosphor-icons/react
npm install @tabler/icons-react
npm install react-icons
npm install @heroicons/react

# Animaciones — instalar TODAS
npm install framer-motion
npm install gsap
npm install lottie-react lottie-web
npm install animejs
npm install @formkit/auto-animate
npm install react-countup
npm install react-intersection-observer
npm install aos
npm install react-awesome-reveal
npm install react-spring
npm install react-transition-group
npm install motion
```

---

### PASO 2 — Variables CSS globales del sistema

```css
/* /styles/globals.css — REEMPLAZAR COMPLETAMENTE */

@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Syne:wght@400;500;600;700;800&family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');

:root {
  /* =============================================
     TIPOGRAFÍAS
  ============================================= */
  --font-display: 'Syne', system-ui, sans-serif;        /* H1, títulos hero, números grandes */
  --font-heading: 'Plus Jakarta Sans', system-ui;        /* H2, H3, subtítulos */
  --font-body: 'Inter', system-ui, sans-serif;           /* Cuerpo, párrafos, labels */
  --font-ui: 'Space Grotesk', system-ui, sans-serif;     /* Botones, badges, datos */
  --font-mono: 'Space Grotesk', monospace;               /* Códigos, IDs, técnico */

  /* =============================================
     COLORES PRINCIPALES
  ============================================= */
  --primary: #FF6B00;
  --primary-dark: #E55A00;
  --primary-light: #FF9A3C;
  --primary-xlight: #FFB347;
  --accent-cyan: #00D4FF;
  --accent-purple: #8B5CF6;
  --accent-emerald: #10B981;

  /* =============================================
     GRADIENTES DE TEXTO — usar en títulos H1 y H2
  ============================================= */
  --gradient-text-primary: linear-gradient(135deg, #FF6B00 0%, #FF9A3C 45%, #FFD700 100%);
  --gradient-text-cool: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f97316 100%);
  --gradient-text-neon: linear-gradient(90deg, #00f5ff, #FF6B00, #ff00ff);
  --gradient-text-sunset: linear-gradient(135deg, #f97316, #ec4899, #8b5cf6);
  --gradient-text-ocean: linear-gradient(135deg, #06b6d4, #3b82f6, #8b5cf6);
  --gradient-text-gold: linear-gradient(135deg, #f59e0b, #fbbf24, #fde68a);

  /* =============================================
     GRADIENTES DE FONDO — para cards y secciones
  ============================================= */
  --gradient-bg-primary: linear-gradient(135deg, rgba(255,107,0,0.15), rgba(229,90,0,0.05));
  --gradient-bg-card: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
  --gradient-bg-hero: radial-gradient(ellipse at top, rgba(255,107,0,0.15) 0%, transparent 60%);
  --gradient-bg-mesh: radial-gradient(at 40% 20%, rgba(255,107,0,0.12) 0%, transparent 50%),
                      radial-gradient(at 80% 0%, rgba(139,92,246,0.08) 0%, transparent 50%),
                      radial-gradient(at 0% 50%, rgba(6,182,212,0.06) 0%, transparent 50%);

  /* =============================================
     FONDOS DARK MODE
  ============================================= */
  --bg-base: #080810;
  --bg-card: #111120;
  --bg-card-hover: #161628;
  --bg-sidebar: #0D0D1A;
  --bg-header: rgba(8, 8, 16, 0.95);
  --bg-glass: rgba(255, 255, 255, 0.04);
  --bg-glass-hover: rgba(255, 255, 255, 0.07);

  /* =============================================
     BORDES
  ============================================= */
  --border-default: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.15);
  --border-primary: rgba(255, 107, 0, 0.3);
  --border-primary-hover: rgba(255, 107, 0, 0.6);

  /* =============================================
     TEXTOS
  ============================================= */
  --text-primary: #F3F4F6;
  --text-secondary: #9CA3AF;
  --text-muted: #6B7280;
  --text-disabled: #374151;

  /* =============================================
     ESTADOS SEMÁNTICOS
  ============================================= */
  --success: #10B981;
  --success-bg: rgba(16, 185, 129, 0.12);
  --warning: #F59E0B;
  --warning-bg: rgba(245, 158, 11, 0.12);
  --danger: #EF4444;
  --danger-bg: rgba(239, 68, 68, 0.12);
  --info: #3B82F6;
  --info-bg: rgba(59, 130, 246, 0.12);

  /* =============================================
     ESPACIADO Y RADIOS
  ============================================= */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* =============================================
     SOMBRAS
  ============================================= */
  --shadow-glow-primary: 0 0 20px rgba(255, 107, 0, 0.3);
  --shadow-glow-primary-lg: 0 0 40px rgba(255, 107, 0, 0.5);
  --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-elevated: 0 20px 60px rgba(0, 0, 0, 0.5);

  /* =============================================
     TRANSICIONES
  ============================================= */
  --transition-fast: all 0.15s ease;
  --transition-base: all 0.25s ease;
  --transition-slow: all 0.4s ease;
  --transition-spring: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  --transition-elastic: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55);
  --transition-smooth: all 0.6s cubic-bezier(0.23, 1, 0.32, 1);
  --transition-bounce: all 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}
```

---

### PASO 3 — Clases utilitarias de tipografía

```css
/* /styles/typography.css */

/* =============================================
   DISPLAY / HERO — para H1 y títulos grandes
============================================= */
.text-display {
  font-family: var(--font-display);
  font-size: clamp(32px, 5vw, 56px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.text-h1 {
  font-family: var(--font-display);
  font-size: clamp(24px, 3vw, 36px);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.015em;
}

.text-h2 {
  font-family: var(--font-heading);
  font-size: clamp(18px, 2.5vw, 24px);
  font-weight: 600;
  line-height: 1.3;
}

.text-h3 {
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.4;
}

.text-body {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-secondary);
}

.text-caption {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.text-label {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.text-mono {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--accent-cyan);
  background: rgba(0, 212, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
}

.text-number {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}

/* =============================================
   GRADIENTES DE TEXTO — usar en H1 y H2
============================================= */
.gradient-text {
  background: var(--gradient-text-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-cool {
  background: var(--gradient-text-cool);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-sunset {
  background: var(--gradient-text-sunset);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-ocean {
  background: var(--gradient-text-ocean);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-neon {
  background: var(--gradient-text-neon);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: gradient-shift 3s linear infinite;
}

.gradient-text-gold {
  background: var(--gradient-text-gold);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@keyframes gradient-shift {
  0% { background-position: 0% center; }
  100% { background-position: 200% center; }
}
```

---

### PASO 4 — Animaciones de texto

```css
/* /styles/animations.css */

/* TYPEWRITER — para estados de carga o títulos de sección */
.anim-typewriter {
  overflow: hidden;
  border-right: 2px solid var(--primary);
  white-space: nowrap;
  animation:
    anim-typing 3.5s steps(40, end) infinite,
    anim-blink-caret 0.75s step-end infinite;
}

@keyframes anim-typing {
  0%, 10% { width: 0 }
  50%, 80% { width: 100% }
  95%, 100% { width: 0 }
}

@keyframes anim-blink-caret {
  from, to { border-color: transparent }
  50% { border-color: var(--primary) }
}

/* SHIMMER — para skeleton loaders y textos de carga */
.anim-shimmer {
  background: linear-gradient(
    90deg,
    var(--text-muted) 0%,
    var(--text-primary) 40%,
    var(--text-muted) 80%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: anim-shimmer-move 2.5s linear infinite;
}

@keyframes anim-shimmer-move {
  0% { background-position: 100% center }
  100% { background-position: -100% center }
}

/* BOUNCE IN — entrada dramática para títulos de sección */
.anim-bounce-in {
  animation: anim-bounce-in 0.6s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

@keyframes anim-bounce-in {
  0% { opacity: 0; transform: scale(0.3) translateY(20px); }
  50% { opacity: 1; transform: scale(1.05); }
  70% { transform: scale(0.95); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* FADE UP — entrada suave desde abajo */
.anim-fade-up {
  animation: anim-fade-up 0.5s cubic-bezier(0.23, 1, 0.32, 1) both;
}

@keyframes anim-fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* SLIDE IN RIGHT — para notificaciones y drawers */
.anim-slide-right {
  animation: anim-slide-right 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes anim-slide-right {
  from { opacity: 0; transform: translateX(30px); }
  to { opacity: 1; transform: translateX(0); }
}

/* FLOAT — para elementos decorativos y avatares */
.anim-float {
  animation: anim-float 3s ease-in-out infinite;
}

@keyframes anim-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}

/* PULSE GLOW — para botones de acción principal */
.anim-pulse-glow {
  animation: anim-pulse-glow 2s ease-in-out infinite;
}

@keyframes anim-pulse-glow {
  0%, 100% { box-shadow: 0 0 15px rgba(255, 107, 0, 0.3); }
  50% { box-shadow: 0 0 35px rgba(255, 107, 0, 0.7); }
}

/* NUMBER COUNT UP — usar con react-countup para métricas del dashboard */
/* Ejemplo: <CountUp end={247} duration={2} enableScrollSpy /> */

/* STAGGER — para listas de items que entran uno a uno */
.anim-stagger > * {
  animation: anim-fade-up 0.4s cubic-bezier(0.23, 1, 0.32, 1) both;
}
.anim-stagger > *:nth-child(1) { animation-delay: 0.05s; }
.anim-stagger > *:nth-child(2) { animation-delay: 0.1s; }
.anim-stagger > *:nth-child(3) { animation-delay: 0.15s; }
.anim-stagger > *:nth-child(4) { animation-delay: 0.2s; }
.anim-stagger > *:nth-child(5) { animation-delay: 0.25s; }
.anim-stagger > *:nth-child(6) { animation-delay: 0.3s; }
.anim-stagger > *:nth-child(7) { animation-delay: 0.35s; }
.anim-stagger > *:nth-child(8) { animation-delay: 0.4s; }

/* ROTATE GRADIENT — para borders animados en cards especiales */
.anim-border-gradient {
  position: relative;
  border-radius: var(--radius-lg);
}
.anim-border-gradient::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: conic-gradient(from 0deg, #FF6B00, #FFD700, #FF6B00);
  animation: anim-rotate-border 3s linear infinite;
  z-index: -1;
}
@keyframes anim-rotate-border {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

---

### PASO 5 — Transiciones de página (Framer Motion)

```jsx
// /components/ui/PageTransition.tsx
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';

const variants = {
  initial: { opacity: 0, y: 16, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.35, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, y: -8, filter: 'blur(2px)', transition: { duration: 0.2 } }
};

export function PageTransition({ children }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={pathname} variants={variants} initial="initial" animate="animate" exit="exit">
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// Variantes para elementos dentro de la página
export const fadeUpVariant = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.4, ease: [0.23, 1, 0.32, 1] }
  })
};

export const scaleInVariant = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: [0.34, 1.56, 0.64, 1] } }
};

export const slideRightVariant = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.23, 1, 0.32, 1] } }
};
```

---

### PASO 6 — Iconos: cuándo usar cada librería

```jsx
// REGLA: stroke 1.5px para todos los iconos. Nunca filled en iconos de UI.
// Tamaño base: 18px en sidebar, 20px en headers, 16px en botones, 14px en badges

// LUCIDE REACT — iconos de UI principal (nav, botones, acciones)
import { 
  LayoutDashboard, Users, FileText, DollarSign, Phone, Mail,
  Bell, Search, Settings, ChevronRight, Plus, X, Check,
  Clock, AlertTriangle, TrendingUp, Calendar, Video,
  MessageSquare, BookOpen, BarChart2, Lock, Globe,
  Upload, Download, Edit, Trash2, Eye, Filter, Star
} from 'lucide-react';

// PHOSPHOR — iconos expresivos para estados y categorías
import { 
  House, Briefcase, Certificate, Gavel, Heart,
  Handshake, ShieldCheck, ArrowsClockwise, Funnel,
  SealCheck, Warning, Info, CheckCircle, XCircle,
  MagnifyingGlass, Robot, Microphone, Camera, Paperclip
} from '@phosphor-icons/react';

// TABLER — iconos para datos, métricas y reportes
import {
  IconChartBar, IconChartLine, IconChartPie, IconChartDonut,
  IconReportAnalytics, IconFileAnalytics, IconDatabaseExport,
  IconTimelineEvent, IconProgressCheck, IconTarget
} from '@tabler/icons-react';

// CÓMO USAR — ejemplo correcto
const IconoOportunidad = () => (
  <FileText 
    size={18}
    strokeWidth={1.5}
    className="text-primary"  // color del tema
  />
);

// Icono con contenedor — estándar para el sidebar
const SidebarIcon = ({ icon: Icon, active }) => (
  <div style={{
    width: 36, height: 36,
    borderRadius: 10,
    background: active ? 'rgba(255,107,0,0.15)' : 'transparent',
    border: active ? '1px solid rgba(255,107,0,0.3)' : '1px solid transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.25s',
  }}>
    <Icon size={18} strokeWidth={1.5} color={active ? '#FF6B00' : '#6B7280'} />
  </div>
);
```

---

### PASO 7 — Componentes de UI con el design system aplicado

```jsx
// /components/ui/GradientHeading.tsx
// Usar para TODOS los títulos principales H1 y H2 del CRM
export function GradientHeading({ children, variant = 'primary', size = 'h1', className = '' }) {
  const gradients = {
    primary: 'linear-gradient(135deg, #FF6B00 0%, #FF9A3C 45%, #FFD700 100%)',
    cool: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f97316 100%)',
    sunset: 'linear-gradient(135deg, #f97316, #ec4899, #8b5cf6)',
    ocean: 'linear-gradient(135deg, #06b6d4, #3b82f6, #8b5cf6)',
    gold: 'linear-gradient(135deg, #f59e0b, #fbbf24, #fde68a)',
  };
  const sizes = {
    display: { fontFamily: "'Syne', sans-serif", fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 800 },
    h1: { fontFamily: "'Syne', sans-serif", fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 700 },
    h2: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 600 },
    h3: { fontFamily: "'Space Grotesk', sans-serif", fontSize: '16px', fontWeight: 500 },
  };
  return (
    <span style={{
      background: gradients[variant],
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
      ...sizes[size],
      letterSpacing: '-0.015em',
    }} className={className}>
      {children}
    </span>
  );
}

// /components/ui/AnimatedNumber.tsx
// Para métricas del dashboard que suben animadamente
import CountUp from 'react-countup';
import { useInView } from 'react-intersection-observer';

export function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0 }) {
  const { ref, inView } = useInView({ triggerOnce: true });
  return (
    <span ref={ref} style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
      {prefix}
      {inView ? <CountUp end={value} duration={1.8} decimals={decimals} separator="," /> : '0'}
      {suffix}
    </span>
  );
}

// /components/ui/Badge.tsx
// Badges de estado para trámites, SLA, pagos
export function Badge({ label, variant = 'default', dot = false, pulse = false }) {
  const variants = {
    primary: { bg: 'rgba(255,107,0,0.15)', border: 'rgba(255,107,0,0.4)', color: '#fb923c' },
    success: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', color: '#34d399' },
    warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', color: '#fbbf24' },
    danger:  { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#f87171' },
    info:    { bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.35)', color: '#22d3ee' },
    purple:  { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.35)', color: '#a78bfa' },
    glass:   { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', color: '#e5e7eb' },
    gradient: { bg: 'linear-gradient(135deg,#FF6B00,#f97316)', border: 'transparent', color: '#fff' },
  };
  const v = variants[variant];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 12px', borderRadius: 9999,
      fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
      background: v.bg, border: `1px solid ${v.border}`, color: v.color,
    }}>
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: 'currentColor',
          animation: pulse ? 'badge-pulse 1.5s ease infinite' : 'none',
        }} />
      )}
      {label}
    </span>
  );
}

// /components/ui/GlassCard.tsx
// Card estándar del CRM
export function GlassCard({ children, variant = 'glass', hover = true, glow = false, className = '' }) {
  const variants = {
    glass: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
    brand: { background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.2)' },
    dark: { background: '#111120', border: '1px solid rgba(255,255,255,0.05)' },
    elevated: { background: '#161628', border: '1px solid rgba(255,255,255,0.1)' },
  };
  return (
    <div style={{
      ...variants[variant],
      borderRadius: 16, padding: '18px',
      backdropFilter: 'blur(10px)',
      transition: 'all 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
      boxShadow: glow ? '0 0 30px rgba(255,107,0,0.15)' : 'none',
      cursor: hover ? 'pointer' : 'default',
    }}
    onMouseEnter={e => {
      if (hover) {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.borderColor = 'rgba(255,107,0,0.35)';
        e.currentTarget.style.boxShadow = glow ? '0 0 40px rgba(255,107,0,0.25)' : '0 8px 32px rgba(0,0,0,0.3)';
      }
    }}
    onMouseLeave={e => {
      if (hover) {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = variants[variant].border.match(/#[a-f0-9]+|rgba\([^)]+\)/i)?.[0] || 'rgba(255,255,255,0.08)';
        e.currentTarget.style.boxShadow = glow ? '0 0 30px rgba(255,107,0,0.15)' : 'none';
      }
    }}
    className={className}>
      {children}
    </div>
  );
}

// /components/ui/PrimaryButton.tsx
export function PrimaryButton({ children, onClick, size = 'md', variant = 'primary', loading = false, icon: Icon }) {
  const sizes = {
    sm: { padding: '6px 16px', fontSize: 12, borderRadius: 8 },
    md: { padding: '10px 22px', fontSize: 14, borderRadius: 10 },
    lg: { padding: '13px 28px', fontSize: 15, borderRadius: 12 },
  };
  const variants = {
    primary: { background: 'linear-gradient(135deg, #FF6B00, #E55A00)', color: '#fff', border: 'none', boxShadow: '0 4px 20px rgba(255,107,0,0.3)' },
    secondary: { background: 'rgba(255,107,0,0.1)', color: '#fb923c', border: '1px solid rgba(255,107,0,0.35)', boxShadow: 'none' },
    ghost: { background: 'rgba(255,255,255,0.05)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 'none' },
    danger: { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', boxShadow: 'none' },
    success: { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)', boxShadow: 'none' },
  };
  return (
    <button onClick={onClick} style={{
      ...sizes[size], ...variants[variant],
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
      cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
      transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
      if (variant === 'primary') e.currentTarget.style.boxShadow = '0 8px 28px rgba(255,107,0,0.45)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.transform = 'none';
      if (variant === 'primary') e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,107,0,0.3)';
    }}>
      {Icon && <Icon size={14} strokeWidth={2} />}
      {loading ? 'Cargando...' : children}
    </button>
  );
}
```

---

### PASO 8 — Aplicación obligatoria por sección del CRM

```
DASHBOARD:
  H1 → GradientHeading variant="primary" size="display"
  Métricas → AnimatedNumber con CountUp
  Cards → GlassCard variant="glass" hover glow
  Ícono de cada módulo → Lucide strokeWidth=1.5 tamaño 20px

SIDEBAR:
  Logo → font-family Syne weight 800 + gradient-text primary
  Labels de navegación → Space Grotesk weight 500 14px
  Iconos activos → Lucide color #FF6B00 strokeWidth 1.5
  Iconos inactivos → Lucide color #6B7280 strokeWidth 1.5
  Badge de notificaciones → Badge variant="danger" dot pulse

OPORTUNIDADES / KANBAN:
  Título de columna → Space Grotesk weight 700 13px uppercase
  Nombre de oportunidad → Plus Jakarta Sans weight 600 14px
  Badges de estado → Badge con variantes de color por etapa
  SLA indicator → badge rojo con punto pulsante si está vencido
  Valor monetario → AnimatedNumber con CountUp + gradient-text gold

FORMULARIOS / CUESTIONARIOS:
  Labels → Inter weight 500 13px color --text-secondary
  Inputs → border rgba(255,255,255,0.1) focus border #FF6B00
  Títulos de sección → Space Grotesk weight 700 uppercase con divider naranja
  
MÓDULO DE TAREAS:
  Título → GradientHeading variant="primary"
  Fecha vencida → Badge variant="danger" dot pulse
  Fecha próxima → Badge variant="warning"
  Sin fecha → Badge variant="glass"

PERFILES DE USUARIO:
  Nombre → Syne weight 700 gradient-text si es el usuario activo
  Posición/Cargo → Space Grotesk weight 500 color --primary
  Estadísticas → AnimatedNumber en cada métrica

ACADEMIA:
  Título del módulo → GradientHeading variant="cool"
  Porcentaje de progreso → AnimatedNumber + progress bar con shimmer
  Badges de completado → Badge variant="success"

VIDEOLLAMADAS:
  Timer → Space Grotesk tabular-nums gradient-text primary
  Nombre del participante hablando → Syne weight 700 color #22c55e
  
NOTIFICACIONES:
  Título → Space Grotesk weight 600 15px
  Descripción → Inter weight 400 13px --text-secondary
  Entrada → anim-slide-right + cubic-bezier(0.34, 1.56, 0.64, 1)
  
REPORTES / DASHBOARDS:
  Números grandes → Syne weight 800 gradient según valor (success/danger)
  Subtítulos de gráfica → Inter weight 400 12px
  Leyendas → Space Grotesk weight 500 11px uppercase
```

---

### PASO 9 — Sonidos del sistema (use-sound)

```javascript
// /hooks/useSounds.ts
import useSound from 'use-sound';

export function useSounds() {
  const [playNotification] = useSound('/sounds/notification.mp3', { volume: 0.4 });
  const [playSuccess] = useSound('/sounds/success.mp3', { volume: 0.5 });
  const [playWarning] = useSound('/sounds/warning.mp3', { volume: 0.5 });
  const [playAlert] = useSound('/sounds/alert.mp3', { volume: 0.6 });
  const [playMessage] = useSound('/sounds/message.mp3', { volume: 0.35 });
  const [playPop] = useSound('/sounds/pop.mp3', { volume: 0.4 });
  const [playWhoosh] = useSound('/sounds/whoosh.mp3', { volume: 0.3 });

  return { playNotification, playSuccess, playWarning, playAlert, playMessage, playPop, playWhoosh };
}

// CUÁNDO USAR CADA SONIDO:
// notification → nueva notificación no urgente
// success → tarea completada, pago registrado, cuestionario firmado
// warning → SLA próximo a vencer (3 días)
// alert → SLA vencido, solicitud urgente pendiente
// message → nuevo mensaje en chat
// pop → crear tarea desde audio (confirmación IA)
// whoosh → transición de página, abrir panel lateral
```

---

*Sección agregada: Design System Completo 2026 — Abril 2026*

---

## DESIGN SYSTEM — FONDOS CLAROS + SECCIONES DARK + TEXTURAS 3D

### Inspirado en FXology.com — adaptado a GOZZ

---

### REGLA FUNDAMENTAL DEL FONDO

```
FONDO BASE DEL CRM:     #F5F3EE (crema cálido, NO blanco puro)
FONDO CARDS LIGHT:      #FFFFFF con sombra sutil
FONDO ALTERNADO:        #FAFAF8 (casi blanco)
FONDO ACCENT CLARO:     #F0EDE8 (topo suave)

SECCIONES DARK:         #0A0A12 (negro profundo, como FXology)
CARDS DARK EMBEBIDAS:   #0F0F18
SIDEBAR:                #0D0D1A
HEADER (scroll):        rgba(245,243,238,0.95) con backdrop-blur

MEZCLA POR MÓDULO:
  Dashboard hero     → fondo claro #F5F3EE + partículas animadas
  Métricas globales  → sección dark #0A0A12 + estrellas + glow naranja
  Lista oportunidades → fondo claro #FAFAF8 + cards blancas
  Videollamadas      → dark #080810 (exclusivo)
  Chat interno       → dark #18181B (Twitch style)
  Academia           → fondo claro con cards blancas
  Perfil de usuario  → fondo claro con header dark embebido
  Login              → dark #080810 + partículas
```

---

### TEXTURAS Y EFECTOS DE FONDO 2026

#### 1 — Noise texture (sutil, sobre fondos claros)
```css
.bg-noise {
  position: relative;
}
.bg-noise::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.025;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-size: 200px;
  z-index: 0;
}
```

#### 2 — Radial glow animado (sobre fondos claros y dark)
```css
/* Glow naranja — fondo claro */
.glow-orange-light {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,107,0,0.12) 0%, transparent 70%);
  animation: glow-drift 8s ease-in-out infinite;
  pointer-events: none;
}

/* Glow naranja — sección dark */
.glow-orange-dark {
  background: radial-gradient(ellipse, rgba(255,107,0,0.08) 0%, transparent 70%);
  animation: glow-drift 10s ease-in-out infinite;
}

/* Glow púrpura — acento secundario */
.glow-purple {
  background: radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%);
  animation: glow-drift 12s ease-in-out infinite reverse;
}

@keyframes glow-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%       { transform: translate(20px, -15px) scale(1.05); }
  66%       { transform: translate(-10px, 20px) scale(0.97); }
}
```

#### 3 — Partículas flotantes (fondos claros)
```jsx
// /components/ui/FloatingParticles.tsx
// Puntos pequeños que flotan suavemente — NO librería externa, CSS puro

const PARTICLES = [
  { size: 3, color: 'rgba(255,107,0,0.4)', top: '20%', left: '15%', duration: '6s' },
  { size: 2, color: 'rgba(99,102,241,0.35)', top: '60%', left: '35%', duration: '8s', delay: '1s' },
  { size: 4, color: 'rgba(255,107,0,0.25)', top: '30%', right: '20%', duration: '7s', delay: '2s' },
  { size: 2, color: 'rgba(16,185,129,0.4)', bottom: '30%', right: '35%', duration: '9s', delay: '0.5s' },
  { size: 3, color: 'rgba(99,102,241,0.3)', top: '70%', left: '60%', duration: '5s', delay: '3s' },
  { size: 2, color: 'rgba(255,107,0,0.3)', top: '45%', left: '80%', duration: '11s', delay: '1.5s' },
];

export function FloatingParticles() {
  return (
    <>
      {PARTICLES.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: p.size, height: p.size,
          borderRadius: '50%',
          background: p.color,
          top: p.top, left: p.left, right: p.right, bottom: p.bottom,
          animation: `float-particle ${p.duration} ease-in-out infinite ${p.delay || '0s'}`,
          pointerEvents: 'none',
        }} />
      ))}
    </>
  );
}
// CSS:
// @keyframes float-particle {
//   0%, 100% { transform: translateY(0) scale(1); opacity: 0.6; }
//   50% { transform: translateY(-18px) scale(1.3); opacity: 1; }
// }
```

#### 4 — Estrellas en secciones dark (como FXology)
```jsx
// /components/ui/StarField.tsx
import { useEffect, useRef } from 'react';

export function StarField({ count = 80 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    for (let i = 0; i < count; i++) {
      const star = document.createElement('div');
      const size = Math.random() * 2 + 0.5;
      const duration = 2 + Math.random() * 4;
      const delay = Math.random() * 3;
      Object.assign(star.style, {
        position: 'absolute',
        width: `${size}px`, height: `${size}px`,
        borderRadius: '50%',
        background: '#ffffff',
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        animation: `twinkle ${duration}s ease-in-out infinite ${delay}s`,
        pointerEvents: 'none',
      });
      ref.current.appendChild(star);
    }
  }, []);
  return <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}
// CSS:
// @keyframes twinkle {
//   0%, 100% { opacity: 0.1; transform: scale(1); }
//   50% { opacity: 0.8; transform: scale(1.5); }
// }
```

#### 5 — Líneas geométricas SVG decorativas
```jsx
// Se coloca como fondo absoluto sobre secciones hero
// Opacidad: 0.04 sobre fondos claros, 0.08 sobre dark
export function GeoLines({ darkMode = false }) {
  const opacity = darkMode ? 0.08 : 0.04;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity }}
      viewBox="0 0 800 500" preserveAspectRatio="none">
      <line x1="0" y1="100" x2="800" y2="400" stroke="#FF6B00" strokeWidth="0.6" />
      <line x1="200" y1="0" x2="600" y2="500" stroke="#6366f1" strokeWidth="0.5" />
      <circle cx="150" cy="150" r="80" stroke="#FF6B00" strokeWidth="0.5" fill="none" />
      <circle cx="650" cy="350" r="100" stroke="#8b5cf6" strokeWidth="0.4" fill="none" />
      <polygon points="400,40 450,110 350,110" stroke="#FF6B00" strokeWidth="0.5" fill="none" />
      <rect x="580" y="80" width="60" height="60" rx="6" stroke="#6366f1"
        strokeWidth="0.4" fill="none" transform="rotate(20,610,110)" />
      <line x1="0" y1="350" x2="300" y2="150" stroke="#FF6B00" strokeWidth="0.4" opacity="0.6" />
    </svg>
  );
}
```

#### 6 — Cards 3D flotantes (como FXology)
```css
/* Card con sensación de profundidad 3D */
.card-3d-float {
  background: linear-gradient(135deg,
    rgba(255,255,255,0.92),
    rgba(245,243,238,0.75)
  );
  border: 1px solid rgba(255,107,0,0.12);
  border-radius: 20px;
  padding: 20px;
  box-shadow:
    0 20px 60px rgba(0,0,0,0.10),
    0 0 0 1px rgba(255,255,255,0.6) inset,
    0 4px 16px rgba(255,107,0,0.08);
  backdrop-filter: blur(20px);
  animation: card-float 4s ease-in-out infinite;
}

@keyframes card-float {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50%       { transform: translateY(-14px) rotate(1.5deg); }
}

/* Versión dark card flotante */
.card-3d-dark {
  background: linear-gradient(135deg,
    rgba(15,15,30,0.95),
    rgba(10,10,20,0.9)
  );
  border: 1px solid rgba(255,107,0,0.15);
  border-radius: 20px;
  box-shadow:
    0 20px 60px rgba(0,0,0,0.5),
    0 0 40px rgba(255,107,0,0.05) inset;
  animation: card-float 5s ease-in-out infinite;
}
```

---

### LAYOUT DEL CRM — ALTERNANCIA CLARO/DARK

```
SIDEBAR: dark #0D0D1A
HEADER:  claro rgba(245,243,238,0.95) + blur

PÁGINAS:
┌─────────────────────────────────────────┐
│  HERO SECTION        fondo #F5F3EE      │  ← Claro + partículas + geo lines
│  (título + métricas principales)        │
├─────────────────────────────────────────┤
│  DARK SECTION        fondo #0A0A12      │  ← Dark + estrellas + glow naranja
│  (KPIs en tiempo real)                  │
├─────────────────────────────────────────┤
│  CONTENT SECTION     fondo #FAFAF8      │  ← Claro + cards blancas
│  (lista oportunidades / tareas)         │
├─────────────────────────────────────────┤
│  ACCENT SECTION      fondo #F0EDE8      │  ← Claro topo + dark cards embebidas
│  (actividad reciente / IA)              │
├─────────────────────────────────────────┤
│  DARK FOOTER         fondo #0F0F18      │  ← Dark con links y derechos
└─────────────────────────────────────────┘

REGLA: Nunca dos secciones del mismo tono consecutivas.
Siempre alternar claro → dark → claro → mixto → dark.
```

---

### COLORES DEL SISTEMA — MODO CLARO + DARK

```css
:root {
  /* ============ FONDOS CLAROS ============ */
  --bg-base:         #F5F3EE;   /* crema principal */
  --bg-surface:      #FAFAF8;   /* superficie alternada */
  --bg-card-light:   #FFFFFF;   /* cards blancas */
  --bg-accent-light: #F0EDE8;   /* secciones accent */

  /* ============ FONDOS DARK ============ */
  --bg-dark-base:    #0A0A12;   /* secciones dark principales */
  --bg-dark-card:    #0F0F18;   /* cards dark */
  --bg-dark-elevated:#161628;   /* cards dark elevadas */
  --bg-sidebar:      #0D0D1A;   /* sidebar */
  --bg-dark-glass:   rgba(255,255,255,0.03);

  /* ============ MARCA ============ */
  --primary:         #FF6B00;
  --primary-dark:    #E55A00;
  --primary-light:   #FF9A3C;

  /* ============ TEXTOS CLARO ============ */
  --text-dark-primary:   #0F0F18;
  --text-dark-secondary: #374151;
  --text-dark-muted:     #9CA3AF;

  /* ============ TEXTOS DARK ============ */
  --text-light-primary:   #F3F4F6;
  --text-light-secondary: #9CA3AF;
  --text-light-muted:     #6B7280;
}
```

---

### TIPOGRAFÍAS — REGLA VISUAL COMO FXOLOGY

```
REGLA: Los títulos deben ser ENORMES y BOLD, como en FXology.
No hay títulos pequeños en secciones hero o de landing.

SECCIÓN HERO / LANDING:
  font-family: 'Syne', sans-serif
  font-size: clamp(40px, 7vw, 72px)     ← MUY GRANDE
  font-weight: 800
  letter-spacing: -0.03em
  + gradient de texto obligatorio

SECCIÓN DARK (métricas, KPIs):
  Números: Syne 800 gradient naranja o cool
  Labels: Space Grotesk 700 uppercase tracking-wide
  Descripciones: Plus Jakarta Sans 400 color #6B7280

SECCIÓN CLARO (contenido operativo):
  Títulos H2: Syne 700 28px color #0F0F18
  Datos: Space Grotesk 600-700 color #111118
  Cuerpo: Plus Jakarta Sans 400-500 color #374151

NUNCA usar:
  - font-weight < 600 en títulos de sección
  - Colores grises puros en titulos (#999 etc.)
  - font-size < 28px en hero headings
```

---

### ELEMENTOS 3D OBLIGATORIOS POR SECCIÓN

```
DASHBOARD HERO:
  ✓ Card 3D flotante (métricas resumen) con animación float
  ✓ GeoLines SVG decorativo en el fondo (opacidad 0.04)
  ✓ 2 radial glows animados (naranja + púrpura)
  ✓ 5-8 partículas flotantes
  ✓ Noise texture sutil

SECCIÓN DARK MÉTRICAS:
  ✓ StarField (60-80 estrellas parpadeantes)
  ✓ Radial glow centrado naranja
  ✓ Cards con glassmorphism dark y glow en hover
  ✓ Iconos con glow blur detrás (::after filter:blur)

OPORTUNIDADES / KANBAN:
  ✓ Cards con sombra direccional (bottom-left)
  ✓ Border gradient animado en cards urgentes
  ✓ Indicador SLA con pulse glow rojo si vencido

VIDEOLLAMADAS:
  ✓ Sala completamente dark
  ✓ Efectos de desenfoque de fondo Jitsi
  ✓ Partículas/glow al hablar
  ✓ Chat Twitch dark #18181B

ACADEMIA:
  ✓ Portadas de módulos con gradiente + overlay 3D
  ✓ Progress bars con shimmer animado
  ✓ Card de quiz con border gradient naranja

LOGIN:
  ✓ Fondo dark #080810
  ✓ Partículas tsParticles conectadas
  ✓ Card glassmorphism flotante centrada
  ✓ Logo con gradient text naranja
  ✓ Input fields con glow naranja al focus
```

---

*Sección agregada: Design System Claro+Dark+3D — Abril 2026*

---

## ACTUALIZACIÓN DE TIPOGRAFÍAS — RALEWAY + OSWALD

### Las fuentes oficiales del CRM son ÚNICAMENTE Raleway y Oswald.
### Reemplaza cualquier referencia anterior a Syne, Plus Jakarta Sans, Space Grotesk o Inter.

---

### Instalación

```bash
npm install @fontsource/raleway
npm install @fontsource/oswald
```

```jsx
// /app/layout.tsx — importar al inicio
import '@fontsource/raleway/400.css';
import '@fontsource/raleway/600.css';
import '@fontsource/raleway/700.css';
import '@fontsource/raleway/800.css';
import '@fontsource/raleway/900.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';

// O via Google Fonts en globals.css:
// @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@400;600;700;800;900&family=Oswald:wght@400;600;700&display=swap');
```

---

### Sistema de pesos por rol

```css
:root {
  --font-display: 'Oswald', sans-serif;   /* Títulos hero, H1 grandes */
  --font-heading: 'Raleway', sans-serif;  /* H2, H3, subtítulos */
  --font-body:    'Raleway', sans-serif;  /* Cuerpo, párrafos */
  --font-ui:      'Oswald', sans-serif;   /* Botones, badges, labels, datos */
  --font-mono:    'Oswald', monospace;    /* IDs, códigos, números */
}
```

---

### Pesos disponibles y cuándo usar cada uno

| Peso | Nombre | Fuente | Uso en el CRM |
|------|--------|--------|---------------|
| 900 | Black | Raleway | Títulos hero gigantes, landing sections, números KPI enormes |
| 800 | ExtraBold | Raleway | H1 principales de sección, métricas del dashboard |
| 700 | Bold | Oswald / Raleway | H2, títulos de cards, nombres de oportunidades |
| 600 | SemiBold | Raleway | H3, labels de campos, nombres de usuario, subtítulos |
| 400 | Regular | Raleway | Cuerpo, descripciones, textos secundarios |

---

### Clases CSS completas del sistema tipográfico

```css
/* /styles/typography.css — VERSIÓN FINAL CON RALEWAY + OSWALD */

/* =============================================
   DISPLAY — Oswald Black / Raleway Black
   Para: heroes, landing, números KPI enormes
============================================= */
.text-display {
  font-family: 'Oswald', sans-serif;
  font-size: clamp(40px, 7vw, 80px);
  font-weight: 700;                     /* Oswald máximo = 700 */
  line-height: 1.0;
  letter-spacing: -0.01em;
  text-transform: uppercase;
}

.text-display-raleway {
  font-family: 'Raleway', sans-serif;
  font-size: clamp(36px, 6vw, 72px);
  font-weight: 900;                     /* Raleway Black */
  line-height: 1.05;
  letter-spacing: -0.02em;
}

/* =============================================
   H1 — Raleway ExtraBold / Oswald Bold
   Para: títulos principales de módulo
============================================= */
.text-h1 {
  font-family: 'Raleway', sans-serif;
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 800;                     /* ExtraBold */
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.text-h1-oswald {
  font-family: 'Oswald', sans-serif;
  font-size: clamp(26px, 3.5vw, 42px);
  font-weight: 700;                     /* Bold */
  line-height: 1.1;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

/* =============================================
   H2 — Raleway Bold
   Para: títulos de sección, nombre de oportunidad
============================================= */
.text-h2 {
  font-family: 'Raleway', sans-serif;
  font-size: clamp(20px, 2.5vw, 30px);
  font-weight: 700;                     /* Bold */
  line-height: 1.2;
  letter-spacing: -0.015em;
}

/* =============================================
   H3 — Raleway SemiBold
   Para: títulos de cards, subtítulos
============================================= */
.text-h3 {
  font-family: 'Raleway', sans-serif;
  font-size: 18px;
  font-weight: 600;                     /* SemiBold */
  line-height: 1.3;
  letter-spacing: -0.01em;
}

/* =============================================
   BODY — Raleway Regular / SemiBold
   Para: texto de cuerpo, descripciones
============================================= */
.text-body {
  font-family: 'Raleway', sans-serif;
  font-size: 15px;
  font-weight: 400;                     /* Regular */
  line-height: 1.7;
}

.text-body-strong {
  font-family: 'Raleway', sans-serif;
  font-size: 15px;
  font-weight: 600;                     /* SemiBold */
  line-height: 1.6;
}

/* =============================================
   UI LABELS — Oswald SemiBold
   Para: botones, badges, labels de campo, datos
============================================= */
.text-ui {
  font-family: 'Oswald', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.text-ui-normal {
  font-family: 'Oswald', sans-serif;
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.02em;
}

/* =============================================
   NÚMEROS / KPI — Oswald Bold o Raleway Black
   Para: métricas del dashboard, contadores
============================================= */
.text-number {
  font-family: 'Oswald', sans-serif;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.text-number-raleway {
  font-family: 'Raleway', sans-serif;
  font-variant-numeric: tabular-nums;
  font-weight: 900;
  letter-spacing: -0.02em;
}

/* =============================================
   CAPTION / FOOTNOTE — Raleway Regular
   Para: fechas, IDs, textos muy pequeños
============================================= */
.text-caption {
  font-family: 'Raleway', sans-serif;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--text-dark-muted);
}

.text-label-small {
  font-family: 'Oswald', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

---

### Aplicación por sección del CRM

```
DASHBOARD HERO:
  Título principal  → Raleway Black (900) + gradient naranja
  Subtítulo         → Raleway SemiBold (600) color muted
  KPI números       → Oswald Bold (700) + gradient según valor
  KPI labels        → Oswald Regular (400) uppercase

SIDEBAR:
  Logo "Tu Agente"  → Raleway ExtraBold (800) + gradient naranja
  Ítem de nav       → Raleway SemiBold (600)
  Ítem activo       → Raleway Bold (700) color naranja

OPORTUNIDADES:
  Nombre del caso   → Raleway Bold (700) color primario
  Tipo de trámite   → Oswald SemiBold (600) uppercase badge
  Valor monetario   → Oswald Bold (700) gradient gold
  Preparador        → Raleway Regular (400)
  Fecha límite      → Oswald Regular (400) tabular-nums

KANBAN ETAPAS:
  Título columna    → Oswald Bold (700) uppercase tracking-wide
  Contador cards    → Oswald SemiBold (600)

FORMULARIOS/CUESTIONARIOS:
  Título sección    → Raleway Bold (700)
  Label de campo    → Oswald SemiBold (600) uppercase 11px
  Placeholder       → Raleway Regular (400) italic

TAREAS:
  Título tarea      → Raleway Bold (700)
  Responsable       → Raleway SemiBold (600)
  Fecha límite      → Oswald Regular (400) con badge de color

PERFIL USUARIO:
  Nombre            → Raleway ExtraBold (800) gradient si es propio
  Posición/Cargo    → Oswald SemiBold (600) color naranja
  Métricas          → Oswald Bold (700)

ACADEMIA:
  Título módulo     → Raleway ExtraBold (800)
  Número de lección → Oswald Bold (700) enorme
  Porcentaje        → Raleway Black (900) gradient

VIDEOLLAMADA:
  Timer             → Oswald Bold (700) tabular-nums
  Nombre hablando   → Raleway SemiBold (600) verde
  Chat mensajes     → Raleway Regular (400)
  Nombre en chat    → Raleway Bold (700) color único

REPORTES/DASHBOARDS:
  Número grande     → Raleway Black (900) o Oswald Bold (700)
  Eje de gráfica    → Oswald Regular (400) 11px
  Leyenda           → Raleway SemiBold (600) 12px

NOTIFICACIONES:
  Título            → Raleway Bold (700)
  Descripción       → Raleway Regular (400)
  Tiempo            → Oswald Regular (400) 11px

BOTONES:
  Texto del botón   → Oswald SemiBold (600) uppercase letra-space
  Botón primary     → Oswald Bold (700)

BADGES:
  Texto del badge   → Oswald SemiBold (600) uppercase 11px
```

---

### Ejemplos de código con las fuentes aplicadas

```jsx
// Título hero del dashboard
<h1 style={{
  fontFamily: "'Raleway', sans-serif",
  fontSize: 'clamp(40px, 6vw, 68px)',
  fontWeight: 900,
  letterSpacing: '-0.025em',
  lineHeight: 1.05,
  background: 'linear-gradient(135deg, #FF6B00, #FF9A3C, #f59e0b)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}}>
  GOZZ
</h1>

// KPI número del dashboard
<span style={{
  fontFamily: "'Oswald', sans-serif",
  fontSize: 42,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  fontVariantNumeric: 'tabular-nums',
  background: 'linear-gradient(135deg, #FF6B00, #FFD700)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}}>
  247
</span>

// Botón primario
<button style={{
  fontFamily: "'Oswald', sans-serif",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}}>
  Nueva Oportunidad
</button>

// Badge de trámite
<span style={{
  fontFamily: "'Oswald', sans-serif",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
}}>
  I-485
</span>

// Nombre de usuario en sidebar
<span style={{
  fontFamily: "'Raleway', sans-serif",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '-0.01em',
}}>
  Alessandro Garagozzo
</span>

// Etapa de kanban
<span style={{
  fontFamily: "'Oswald', sans-serif",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#FF6B00',
}}>
  Recopilación de Documentos
</span>
```

---

### Animaciones de texto con Raleway + Oswald

```css
/* Typewriter — Raleway ExtraBold en gradient */
.typewriter-raleway {
  font-family: 'Raleway', sans-serif;
  font-weight: 800;
  font-size: clamp(22px, 3vw, 36px);
  border-right: 3px solid #FF6B00;
  white-space: nowrap;
  overflow: hidden;
  width: 0;
  animation:
    typing-anim 4s steps(36, end) infinite,
    blink-caret 0.8s step-end infinite alternate;
  background: linear-gradient(135deg, #FF6B00, #FF9A3C, #f59e0b);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Shimmer — Oswald Bold */
.shimmer-oswald {
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: 28px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  background: linear-gradient(90deg, #9ca3af 0%, #ffffff 40%, #9ca3af 80%);
  background-size: 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: shimmer-move 2.5s linear infinite;
}

/* Bounce-in para KPIs del dashboard */
.bounce-in-oswald {
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(36px, 5vw, 60px);
  animation: bounce-in-anim 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
```

---

*Actualización tipográfica: Raleway + Oswald — Abril 2026*

---

## PALETA DE COLORES OFICIAL — #FF8609 + #FFB51C

### Estos son los únicos colores primarios del CRM.
### Reemplaza CUALQUIER referencia anterior a #FF6B00 o #E55A00.

---

### Tokens de color definitivos

```css
:root {
  /* ============ COLORES PRIMARIOS OFICIALES ============ */
  --primary:          #FF8609;   /* Naranja principal */
  --primary-alt:      #FFB51C;   /* Ámbar dorado secundario */

  /* ============ DERIVADOS DE #FF8609 ============ */
  --primary-dark:     #E07500;   /* Hover, pressed */
  --primary-darker:   #C46400;   /* Active, focus ring */
  --primary-light:    #FF9E30;   /* Tint suave */
  --primary-xlight:   #FFB55A;   /* Hover sobre fondo claro */
  --primary-subtle:   rgba(255, 134, 9, 0.10);
  --primary-subtle2:  rgba(255, 134, 9, 0.15);
  --primary-border:   rgba(255, 134, 9, 0.25);
  --primary-border2:  rgba(255, 134, 9, 0.45);
  --primary-glow:     rgba(255, 134, 9, 0.30);
  --primary-glow-lg:  rgba(255, 134, 9, 0.50);

  /* ============ DERIVADOS DE #FFB51C ============ */
  --secondary:        #FFB51C;   /* Ámbar dorado */
  --secondary-dark:   #E09F0F;
  --secondary-light:  #FFC94A;
  --secondary-subtle: rgba(255, 181, 28, 0.10);
  --secondary-border: rgba(255, 181, 28, 0.30);

  /* ============ GRADIENTES OFICIALES ============ */
  /* Gradiente primario — naranja a dorado */
  --gradient-primary:     linear-gradient(135deg, #FF8609 0%, #FFB51C 100%);
  --gradient-primary-rev: linear-gradient(135deg, #FFB51C 0%, #FF8609 100%);
  --gradient-primary-h:   linear-gradient(90deg,  #FF8609 0%, #FFB51C 100%);

  /* Gradiente con profundidad */
  --gradient-warm:    linear-gradient(135deg, #FF8609 0%, #FFB51C 55%, #FFD060 100%);
  --gradient-fire:    linear-gradient(135deg, #E07500 0%, #FF8609 50%, #FFB51C 100%);

  /* Gradiente cool (naranja + acento cool) */
  --gradient-cool:    linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #6366f1 100%);
  --gradient-sunset:  linear-gradient(135deg, #FF8609 0%, #FFB51C 40%, #ec4899 100%);
  --gradient-ocean:   linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #06b6d4 100%);

  /* Gradiente de texto — hero y H1 */
  --gradient-text-primary: linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #FFD060 100%);
  --gradient-text-alt:     linear-gradient(135deg, #E07500 0%, #FF8609 45%, #FFB51C 100%);

  /* ============ FONDOS CLAROS ============ */
  --bg-base:          #F5F3EE;
  --bg-surface:       #FAFAF8;
  --bg-card:          #FFFFFF;
  --bg-accent:        #F0EDE8;

  /* ============ FONDOS DARK ============ */
  --bg-dark-base:     #0A0A12;
  --bg-dark-card:     #0F0F18;
  --bg-dark-elevated: #161628;
  --bg-sidebar:       #0D0D1A;

  /* ============ SEMÁNTICOS ============ */
  --success:          #10B981;
  --success-bg:       rgba(16, 185, 129, 0.12);
  --warning:          #F59E0B;
  --warning-bg:       rgba(245, 158, 11, 0.12);
  --danger:           #EF4444;
  --danger-bg:        rgba(239, 68, 68, 0.12);
  --info:             #3B82F6;
  --info-bg:          rgba(59, 130, 246, 0.12);

  /* ============ SOMBRAS CON COLORES OFICIALES ============ */
  --shadow-primary:    0 4px 20px rgba(255, 134, 9, 0.30);
  --shadow-primary-lg: 0 8px 40px rgba(255, 134, 9, 0.45);
  --shadow-secondary:  0 4px 20px rgba(255, 181, 28, 0.25);
  --shadow-card:       0 8px 32px rgba(0, 0, 0, 0.08);
  --shadow-dark-card:  0 8px 32px rgba(0, 0, 0, 0.40);
}
```

---

### Gradientes de texto CSS — aplicar con background-clip

```css
/* Uso: className="gradient-text" en cualquier heading */

.gradient-text {
  background: linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #FFD060 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-alt {
  background: linear-gradient(135deg, #E07500 0%, #FF8609 45%, #FFB51C 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-cool {
  background: linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #6366f1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-sunset {
  background: linear-gradient(135deg, #FF8609 0%, #FFB51C 40%, #ec4899 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-ocean {
  background: linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #06b6d4 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-text-neon {
  background: linear-gradient(90deg, #FF8609, #FFB51C, #FF8609);
  background-size: 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: gradient-neon 3s linear infinite;
}

@keyframes gradient-neon {
  0%   { background-position: 0% center; }
  100% { background-position: 200% center; }
}
```

---

### Botones con colores oficiales

```css
/* Botón primario */
.btn-primary {
  background: linear-gradient(135deg, #FF8609, #FFB51C);
  color: #fff;
  border: none;
  box-shadow: 0 4px 20px rgba(255, 134, 9, 0.35);
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.btn-primary:hover {
  background: linear-gradient(135deg, #E07500, #FF8609);
  box-shadow: 0 8px 32px rgba(255, 134, 9, 0.50);
  transform: translateY(-2px);
}

/* Botón secundario outline */
.btn-secondary {
  background: rgba(255, 134, 9, 0.08);
  border: 1.5px solid rgba(255, 134, 9, 0.35);
  color: #FF8609;
}
.btn-secondary:hover {
  background: rgba(255, 134, 9, 0.15);
  border-color: #FF8609;
}

/* Botón ghost sobre dark */
.btn-ghost-dark {
  background: rgba(255, 134, 9, 0.07);
  border: 1px solid rgba(255, 134, 9, 0.25);
  color: #FFB51C;
}
```

---

### Badges con colores oficiales

```css
/* Badge primario — trámites, etapas */
.badge-primary {
  background: rgba(255, 134, 9, 0.10);
  border: 1px solid rgba(255, 134, 9, 0.28);
  color: #E07500;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 50px;
}

/* Badge primario sobre dark */
.badge-primary-dark {
  background: rgba(255, 134, 9, 0.15);
  border: 1px solid rgba(255, 134, 9, 0.40);
  color: #FFB51C;
}

/* Badge gradient */
.badge-gradient {
  background: linear-gradient(135deg, #FF8609, #FFB51C);
  color: #fff;
  border: none;
}
```

---

### Radial glows con colores oficiales

```css
/* Glow primario — sobre fondos claros */
.glow-primary-light {
  background: radial-gradient(circle,
    rgba(255, 134, 9, 0.12) 0%,
    rgba(255, 181, 28, 0.06) 40%,
    transparent 70%
  );
}

/* Glow primario — sobre fondos dark */
.glow-primary-dark {
  background: radial-gradient(ellipse,
    rgba(255, 134, 9, 0.10) 0%,
    rgba(255, 181, 28, 0.05) 40%,
    transparent 70%
  );
}

/* Box glow para cards activas o en hover */
.card-glow-primary {
  box-shadow:
    0 0 0 1px rgba(255, 134, 9, 0.20),
    0 8px 32px rgba(255, 134, 9, 0.15),
    0 0 60px rgba(255, 181, 28, 0.05);
}

/* Glow animado — botón CTA principal */
.btn-glow-anim {
  animation: glow-pulse 2s ease-in-out infinite;
}
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 15px rgba(255, 134, 9, 0.35); }
  50%       { box-shadow: 0 0 35px rgba(255, 134, 9, 0.65), 0 0 60px rgba(255, 181, 28, 0.25); }
}
```

---

### Indicadores de estado SLA con colores oficiales

```css
/* SLA verde — dentro del plazo */
.sla-ok {
  background: rgba(16, 185, 129, 0.10);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: #059669;
}

/* SLA ámbar — próximo a vencer (usa --secondary) */
.sla-warning {
  background: rgba(255, 181, 28, 0.12);
  border: 1px solid rgba(255, 181, 28, 0.35);
  color: #E09F0F;
}

/* SLA rojo — vencido */
.sla-danger {
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.30);
  color: #DC2626;
}

/* Punto pulsante para SLA vencido */
.sla-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #FF8609;
  animation: sla-pulse 1.5s ease infinite;
}
@keyframes sla-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 134, 9, 0.5); }
  50%       { box-shadow: 0 0 0 6px transparent; }
}
```

---

### Sidebar con colores oficiales

```css
.sidebar {
  background: #0D0D1A;
  border-right: 1px solid rgba(255, 134, 9, 0.08);
}

.sidebar-item-active {
  background: rgba(255, 134, 9, 0.12);
  border: 1px solid rgba(255, 134, 9, 0.25);
  color: #FF8609;
}

.sidebar-item-active svg {
  color: #FF8609;
}

.sidebar-logo-text {
  font-family: 'Raleway', sans-serif;
  font-weight: 800;
  background: linear-gradient(135deg, #FF8609, #FFB51C);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Línea decorativa inferior del sidebar logo */
.sidebar-logo-line {
  height: 2px;
  background: linear-gradient(90deg, #FF8609, #FFB51C, transparent);
  border-radius: 2px;
  margin-top: 4px;
}
```

---

### Progress bars con colores oficiales

```css
.progress-primary {
  background: linear-gradient(90deg, #FF8609, #FFB51C);
}

.progress-primary::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.30),
    transparent
  );
  animation: shimmer-bar 2s linear infinite;
}

@keyframes shimmer-bar {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

---

### Referencia rápida de color por uso

```
ACCIÓN PRINCIPAL:    #FF8609  → botón primary, CTA, links activos
ACCIÓN SECUNDARIA:   #FFB51C  → botón secondary, highlights, acento dorado
GRADIENTE DEFAULT:   #FF8609 → #FFB51C (siempre en este orden)
HOVER PRIMARY:       #E07500  → oscurecer #FF8609 en hover
TEXTO SOBRE CLARO:   #E07500  → #FF8609 sobre fondo blanco/crema
TEXTO SOBRE DARK:    #FFB51C  → más legible sobre dark
BORDE DEFAULT:       rgba(255,134,9,0.25)
BORDE HOVER:         rgba(255,134,9,0.50)
GLOW SUTIL:          rgba(255,134,9,0.12)
GLOW FUERTE:         rgba(255,134,9,0.40)
SIDEBAR ACTIVO BG:   rgba(255,134,9,0.12)
BADGE BACKGROUND:    rgba(255,134,9,0.10)
BADGE BORDER:        rgba(255,134,9,0.28)
BADGE TEXT CLARO:    #E07500
BADGE TEXT DARK:     #FFB51C
SLA WARNING:         #FFB51C (usa el secundario)
```

---

*Paleta oficial actualizada: #FF8609 + #FFB51C — Abril 2026*

---

## PALETA COMPLETA OFICIAL — EXTRAÍDA DEL LOGO

### Logo: /assets/logo/logo-gozz.svg
### El logo es la fuente de verdad de todos los colores del sistema.

---

### Tokens CSS finales — paleta completa

```css
:root {
  /* ============================================
     COLORES PRIMARIOS — del círculo naranja
  ============================================ */
  --primary:           #FF8609;
  --primary-alt:       #FFB51C;
  --primary-dark:      #E07500;
  --primary-darker:    #C96800;
  --primary-light:     #FF9E30;
  --primary-subtle:    rgba(255, 134, 9, 0.10);
  --primary-border:    rgba(255, 134, 9, 0.30);
  --primary-glow:      rgba(255, 134, 9, 0.30);

  /* ============================================
     AZUL — del globo terráqueo del logo
     Uso: info, videollamadas, formularios USCIS,
          cuestionarios, IA, datos externos
  ============================================ */
  --blue:              #2196C9;
  --blue-dark:         #1565A0;
  --blue-light:        #42A5C5;
  --blue-subtle:       rgba(33, 150, 201, 0.10);
  --blue-border:       rgba(33, 150, 201, 0.30);

  /* ============================================
     VERDE — figura verde del logo
     Uso: éxito, completado, SLA OK, pago recibido,
          cuestionario firmado, academia aprobada
  ============================================ */
  --green:             #43A847;
  --green-dark:        #2E7D32;
  --green-light:       #66BB6A;
  --green-subtle:      rgba(67, 168, 71, 0.10);
  --green-border:      rgba(67, 168, 71, 0.30);

  /* ============================================
     ROJO — figura roja del logo
     Uso: error, urgente, SLA vencido,
          pago crítico, alerta máxima
  ============================================ */
  --red:               #E53935;
  --red-dark:          #C62828;
  --red-light:         #EF5350;
  --red-subtle:        rgba(229, 57, 53, 0.10);
  --red-border:        rgba(229, 57, 53, 0.30);

  /* ============================================
     GRIS — figura gris del logo
     Uso: neutral, inactivo, textos secundarios,
          iconos sin seleccionar, borders suaves
  ============================================ */
  --gray:              #5C6670;
  --gray-dark:         #3D4650;
  --gray-light:        #8A949E;
  --gray-subtle:       rgba(92, 102, 112, 0.10);
  --gray-border:       rgba(92, 102, 112, 0.20);

  /* ============================================
     NEGRO y BLANCO — texto logo
  ============================================ */
  --dark-base:         #1A1A1A;
  --dark-card:         #0F0F18;
  --dark-section:      #0A0A12;
  --white:             #FFFFFF;
  --bg-base:           #F5F3EE;
  --bg-surface:        #FAFAF8;
  --bg-accent:         #F0EDE8;
}
```

---

### Mapa de uso semántico por módulo

```
ACCIÓN PRINCIPAL (botones, CTAs, sidebar activo):
  → #FF8609 + #FFB51C (gradient)

INFORMACIÓN / DATOS (formularios, USCIS, IA, videollamadas):
  → #2196C9 (azul globo)

ÉXITO / COMPLETADO (trámite cerrado, pago, cuestionario firmado):
  → #43A847 (verde figura)

ALERTA / URGENTE (SLA vencido, pago crítico, error):
  → #E53935 (rojo figura)

ADVERTENCIA / PRÓXIMO (SLA 3 días, revisión pendiente):
  → #FFB51C (dorado secundario)

NEUTRO / INACTIVO (textos secundarios, iconos off):
  → #5C6670 (gris figura)

DARK SECTIONS (secciones oscuras, sidebar, login):
  → #0A0A12 / #0F0F18 / #1A1A1A
```

---

### Gradientes con colores del logo

```css
/* Primario — naranja a dorado */
--g-primary:   linear-gradient(135deg, #FF8609, #FFB51C);

/* Brand completo — naranja, dorado, azul */
--g-brand:     linear-gradient(135deg, #FF8609, #FFB51C, #2196C9);

/* Urgente — naranja a rojo */
--g-urgente:   linear-gradient(135deg, #FF8609, #E53935);

/* Éxito — verde a azul */
--g-exito:     linear-gradient(135deg, #43A847, #2196C9);

/* Advertencia — dorado a naranja */
--g-warning:   linear-gradient(135deg, #FFB51C, #FF8609);

/* Fuego — oscuro a naranja a dorado */
--g-fire:      linear-gradient(135deg, #E07500, #FF8609, #FFB51C);

/* Hero texto */
--g-text-hero: linear-gradient(135deg, #FF8609 0%, #FFB51C 50%, #FFD060 100%);
```

---

### Colores por tipo de trámite (para badges y kanban)

```
Asilo (todos)          → #2196C9  (azul — proceso largo, información)
Permiso de Trabajo     → #FF8609  (naranja — acción directa)
Permiso de Viaje       → #FFB51C  (dorado — temporal)
Petición I-130         → #43A847  (verde — familia, conexión)
Ajuste de Estatus      → #FF8609  (naranja — cambio importante)
Remoción de Condiciones→ #FFB51C  (dorado)
Cambio de Estatus      → #5C6670  (gris — administrativo)
Visa VAWA              → #E53935  (rojo — urgencia, protección)
Visa K1                → #43A847  (verde — amor, unión)
Visa Juvenil           → #2196C9  (azul — menores)
Visa T / U             → #E53935  (rojo — protección)
Ciudadanía N-400       → gradient #FF8609→#FFB51C (el más importante)
Taxes Personal/Empresa → #FFB51C  (dorado — dinero)
Medicare               → #2196C9  (azul — salud)
Administrativos        → #5C6670  (gris — rutinario)
Traducción             → #5C6670  (gris)
```

---

### Sidebar con logo integrado

```jsx
// El logo se muestra en la parte superior del sidebar
// Versión: icono circular + texto

<div className="sidebar-logo">
  <img src="/assets/logo/logo-gozz.svg" 
       alt="GOZZ"
       style={{ width: 36, height: 36, borderRadius: '50%' }} />
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <span style={{
      fontFamily: "'Oswald', sans-serif",
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      background: 'linear-gradient(135deg, #FF8609, #FFB51C)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }}>Tu Agente</span>
    <span style={{
      fontFamily: "'Raleway', sans-serif",
      fontWeight: 400,
      fontSize: 10,
      color: '#5C6670',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}>de Inmigración</span>
  </div>
</div>
```

---

*Paleta completa oficial con logo — Abril 2026*

