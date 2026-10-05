-- Fotos de perfil de WhatsApp en almacenamiento propio (ver persistirFoto en baileys.provider.ts).
-- Hasta ahora `foto_perfil_url` guardaba la URL firmada del CDN de WhatsApp (pps.whatsapp.net),
-- que CADUCA en días: las fotos se rompían solas y caían a iniciales. Esta columna registra cuándo
-- se resolvió la foto por última vez, para refrescarla periódicamente (el contacto puede cambiarla)
-- sin pedirla en cada carga de la lista.
ALTER TABLE gozz.whatsapp_conversaciones
  ADD COLUMN IF NOT EXISTS foto_actualizada_at timestamptz;

-- Las URL del CDN ya guardadas están caducadas o lo estarán pronto: se limpian para que el worker
-- las vuelva a resolver y guarde una copia propia la próxima vez que se liste o abra la conversación.
UPDATE gozz.whatsapp_conversaciones
   SET foto_perfil_url = NULL
 WHERE foto_perfil_url IS NOT NULL AND foto_perfil_url NOT LIKE '/uploads/%';
