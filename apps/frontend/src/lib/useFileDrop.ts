"use client";
import { useCallback, useRef, useState } from "react";
import type React from "react";

/**
 * Hook reutilizable para arrastrar-y-soltar archivos (drag & drop) en cualquier
 * contenedor. Devuelve `isOver` (para pintar un overlay) y `dropProps` que se
 * esparcen sobre el div objetivo.
 *
 * Uso:
 *   const { isOver, dropProps } = useFileDrop((files) => setFiles(files));
 *   <div className="relative" {...dropProps}> ... {isOver && <Overlay/>} </div>
 */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  opts?: { disabled?: boolean }
) {
  const [isOver, setIsOver] = useState(false);
  const counter = useRef(0);
  const disabled = opts?.disabled;

  // Solo reaccionar cuando lo que se arrastra son ARCHIVOS (no texto/selección).
  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes("Files");

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    counter.current += 1;
    setIsOver(true);
  }, [disabled]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, [disabled]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    counter.current -= 1;
    if (counter.current <= 0) {
      counter.current = 0;
      setIsOver(false);
    }
  }, [disabled]);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    counter.current = 0;
    setIsOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) onFiles(files);
  }, [disabled, onFiles]);

  return {
    isOver,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
