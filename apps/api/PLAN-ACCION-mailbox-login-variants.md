# PLAN-ACCION-mailbox-login-variants

## Diagnóstico
La validación de conexión de buzones asumía una sola forma de credencial, normalmente `usuario` o `usuario@dominio`, dependiendo del flujo. En los proveedores con autenticación dual, el servidor puede aceptar el correo completo o el usuario local, y el orden real importa.

## Causa raíz
El problema estaba en la lógica de generación de candidatos de login y en la prueba de IMAP/SMTP: se intentaba una sola variante en vez de probar el conjunto válido de credenciales para cada host.

## Cambios propuestos
- Generalizar la generación de candidatos de login para priorizar el correo completo y dejar el usuario local como fallback.
- Deduplicar variantes repetidas, conservando el orden seguro.
- Reutilizar la misma lógica en la validación de IMAP y SMTP.
- Añadir regresión para cubrir el caso dual/host-agnostic.

## Criterios de aceptación
- `buildLoginCandidates` devuelve el orden seguro y deduplicado.
- La validación IMAP/SMTP prueba todas las variantes relevantes antes de fallar.
- `npx vitest run tests/buzon-propietario.test.ts` queda en verde.

## Despliegue
- Rama de trabajo local creada desde `dev`.
- Commit local en la rama del autor.
- `git push` y `merge` quedan reservados a Juan, según la metodología del proyecto.
