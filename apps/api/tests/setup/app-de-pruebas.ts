import cookieParser from "cookie-parser";
import express, { type Express } from "express";

import { signToken } from "../../src/shared/auth-middleware.js";
import { registerContactosRoutes } from "../../src/modules/contactos/contactos.routes.js";
import { registerDriveRoutes } from "../../src/drive-routes.js";
import { registerTareasRoutes } from "../../src/tareas-routes.js";

// ============================================================================================
// UN EXPRESS MÍNIMO PARA PROBAR RUTAS. Ver `docs/CONVENCIONES.md` §9.
//
// Las 377 pruebas que ya había ejercitan **funciones y SQL, nunca una ruta**. Eso deja sin cubrir
// justo donde vive lo más caro: la ACL y los códigos de estado. Esto lo hace posible sin arrastrar
// la aplicación real.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 QUÉ **NO** CUBRE ESTO — léelo antes de confiar en un verde
// ════════════════════════════════════════════════════════════════════════════════════════════
// Aquí se monta `express()` + `cookieParser()` + `express.json()` y encima **solo los routers que
// se prueban**. La aplicación de producción (`src/index.ts`) lleva además:
//
//   · `helmet` — cabeceras de seguridad
//   · `cors` con su lista de orígenes
//   · `express-async-errors` y el manejador de errores final
//   · el servidor HTTP, socket.io, los cron y los bucles de fondo
//
// **Nada de eso está aquí.** Una prueba verde en este montaje dice que **la ruta** se comporta
// bien: no dice que la aplicación arranque, ni que las cabeceras salgan puestas, ni que un error
// no capturado se convierta en un 500 en vez de tumbar el proceso.
//
// Se escribe aquí, y no en un comentario suelto, porque dentro de un año alguien va a leer
// "pruebas de ruta" y va a suponer que cubren más de lo que cubren. Ampliar el montaje es una
// entrega propia, con su motivo.
//
// 🔴 POR QUÉ NO SE IMPORTA `src/index.ts`: son miles de líneas que, al importarse, arrancan
// bucles de fondo (sync de correo, GC de la cuarentena del Drive, cron de reconocimientos…)
// además de crear el servidor. Importarlo en una prueba levantaría procesos de fondo que no hace
// falta levantar. Las rutas se registran con funciones sueltas y exportadas, así que se montan
// una a una: es lo que vuelve viable todo esto.
// ============================================================================================

/**
 * El Express de las pruebas: lo mínimo para que una petición llegue a un handler.
 *
 * `cookieParser` es obligatorio y no decorativo: `requireAuth` lee `req.cookies.access_token`, así
 * que sin él toda petición autenticada daría 401 y las pruebas medirían el montaje en vez de la
 * ruta.
 */
export function crearAppDePruebas(): Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  registerDriveRoutes(app);
  registerContactosRoutes(app);
  registerTareasRoutes(app);

  return app;
}

/**
 * La cookie de sesión de un usuario, firmada de verdad.
 *
 * Se fabrica con `signToken`, el mismo de producción, en vez de pasar por `POST /api/auth/login`:
 * el login exigiría sembrar un hash de contraseña y probaría el login, que no es lo que se está
 * probando. Lo que `requireAuth` mira es **solo** esta cookie (`auth.ts`).
 *
 * ⚠️ `nivel` es lo que va en el TOKEN, que no es necesariamente lo que dice la base. Es
 * deliberado: es exactamente el material con el que trabajan las rutas, deuda D11 incluida.
 */
export function cookieDe(u: { sub: string; email: string; nivel: string }): string {
  return `access_token=${signToken(u)}`;
}
