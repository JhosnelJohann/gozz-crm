"use client";
import { Download } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { fileVisual, formatBytes, type DriveFile } from "./DriveBrowser";
import { MiniaturaArchivo } from "./MiniaturaArchivo";

// ============================================================================================
// UN ARCHIVO COMO TARJETA DE GALERIA
//
// Solo sabe pintar un archivo. No sabe de contactos, ni de carpetas, ni del Drive: recibe el
// archivo y dos cosas que hacer con el. Asi se puede poner en cualquier vista que tenga archivos.
//
// 🔴 LA CARGA PEREZOSA SIGUE HACIENDO FALTA, aunque ya haya miniaturas. Medido contra produccion
// el 2026-08-19: **25 MB en una sola ficha**, 34 archivos, uno suelto de 7,8 MB. `/thumb` recorta
// el peso de cada tarjeta, pero 34 peticiones al abrir la pestania siguen siendo 34 peticiones, y
// las que no se ven no hacen falta. Las dos medidas resuelven cosas distintas: la perezosa acota
// CUANDO se paga; la miniatura acota CUANTO.
//
// Por eso hay DOS mecanismos y no uno:
//   · `IntersectionObserver` decide **si se pone el `src`**. Mientras la tarjeta no se acerque a
//     la pantalla, no hay `<img>` con direccion, y sin direccion no hay peticion. Esta es la
//     barrera de verdad.
//   · `loading="lazy"` va ademas, pero es solo una SUGERENCIA al navegador, que puede adelantarse
//     si le parece. Confiar solo en el atributo seria confiar en una heuristica ajena para no
//     bajar 25 MB.
//
// ⚠️ LO QUE TIENE MINIATURA Y LO QUE NO. Desde la Etapa 2 la tienen las imagenes (via `sharp`) y
// los PDF (via `pdftoppm`, que es un paquete del SISTEMA y no del repositorio). Un `.docx`, un
// `.heic` o un archivo de mas de 25 MB reciben 404 y salen con su icono — y eso es la respuesta
// correcta, no un caso pendiente. El servidor tiene la ultima palabra: aqui solo se conjetura para
// no pedir miniaturas que se sabe que van a fallar (`lib/miniaturas.ts`).
// ============================================================================================

export function FileThumbCard({ file, onPreview, onDownload }: {
  file: DriveFile;
  onPreview: () => void;
  onDownload?: () => void;
}) {
  const v = fileVisual(file.mime, file.nombre);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm hover:shadow-lg transition-all">
      <button
        type="button"
        onClick={onPreview}
        title={`Ver ${file.nombre}`}
        className="block w-full aspect-[4/3] relative overflow-hidden bg-neutral-50 cursor-pointer"
      >
        {/* 🔴 EL RESPALDO SE PASA TAL CUAL ESTABA. La galeria se validó en staging y no puede
            cambiar de aspecto al extraer el componente: mismo gradiente al 10 %, mismo cuadro de
            16, mismo `group-hover:scale-105`, misma etiqueta arriba a la izquierda. Si al
            refactorizar se viera distinta, el refactor estaria mal. */}
        <MiniaturaArchivo
          file={file}
          fallback={
            <>
              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-10", v.gradient)} />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={cn("h-16 w-16 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-xl transition-transform group-hover:scale-105", v.gradient)}>
                  <v.Icon className="h-7 w-7 text-white" strokeWidth={2} />
                </div>
              </div>
              <div className="absolute top-2 left-2 text-[9px] font-ui font-bold text-white/90 bg-black/30 backdrop-blur px-1.5 rounded-full tracking-wider">
                {v.label}
              </div>
            </>
          }
        />
      </button>

      <div className="p-3">
        <div className="text-xs font-ui font-bold truncate" title={file.nombre}>{file.nombre}</div>
        <div className="text-[10px] text-neutral-500 font-ui mt-0.5">{formatBytes(file.size_bytes)}</div>
      </div>

      {onDownload && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          title="Descargar"
          className="absolute top-2 right-2 h-7 w-7 rounded-lg bg-white/90 backdrop-blur shadow border border-black/5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition flex items-center justify-center text-neutral-600 hover:text-purple-600"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
