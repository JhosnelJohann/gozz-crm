"use client";
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Reply, Copy, Pencil, Forward, Sparkles, CheckSquare, Trash2, MoreHorizontal, SmilePlus, ChevronDown, CircleCheck, Pin, PinOff } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

const QUICK = ["\u{1F44D}", "❤️", "\u{1F525}", "\u{1F602}", "\u{1F62E}", "\u{1F622}"];
const MORE = ["\u{1F600}","\u{1F605}","\u{1F642}","\u{1F609}","\u{1F60A}","\u{1F970}","\u{1F60D}","\u{1F60E}","\u{1F914}","\u{1F644}","\u{1F634}","\u{1F91D}","\u{1F64F}","\u{1F44F}","\u{1F4AA}","✅","❌","⚠️","\u{1F389}","\u{1F3AF}","\u{1F4AF}","⭐","\u{1F680}","\u{1F4A1}","\u{1F440}","\u{1F4CC}","\u{1F514}","☕","\u{1F4B0}","\u{1F4DD}"];

interface Props {
  isMe: boolean;
  canEdit: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onForward: () => void;
  onAskCopilot: () => void;
  onCreateTask: () => void;
  onPin: () => void;
  isPinned?: boolean;
  onDelete: () => void;
  onSelect: () => void;
}

type Pop = null | "react" | "menu";

export interface MessageActionsHandle { openMenuAt: (x: number, y: number) => void; }

export const MessageActions = forwardRef<MessageActionsHandle, Props>((props, ref) => {
  const { isMe, canEdit, isPinned } = props;
  const [pop, setPop] = useState<Pop>(null);
  const [pos, setPos] = useState<{ x: number; top?: number; bottom?: number }>({ x: 0, top: 0 });
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!pop) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (wrapRef.current && wrapRef.current.contains(t)) return;
      if (t?.closest?.("[data-msg-pop]")) return;
      setPop(null); setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPop(null); setExpanded(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [pop]);

  const openPop = (which: "react" | "menu", e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const popW = which === "menu" ? 232 : 332;
    // altura estimada del popover (menu: filas variables; react: contempla expansion)
    const estH = which === "menu" ? (210 + (canEdit ? 38 : 0) + (isMe ? 47 : 0)) : 230;
    const left = Math.max(8, Math.min(r.left, vw - popW - 8));
    // abre hacia abajo solo si hay espacio; si no, hacia arriba anclado por el borde inferior
    const spaceBelow = vh - r.bottom;
    if (spaceBelow > estH + 16) {
      setPos({ x: left, top: r.bottom + 8 });
    } else {
      setPos({ x: left, bottom: Math.max(8, vh - r.top + 8) });
    }
    setExpanded(false);
    setPop((cur) => (cur === which ? null : which));
  };

  const close = () => { setPop(null); setExpanded(false); };
  const run = (fn: () => void) => { close(); fn(); };

  // Abre el menú (click derecho) en las coordenadas del cursor.
  useImperativeHandle(ref, () => ({
    openMenuAt(x: number, y: number) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const popW = 232;
      const estH = 210 + (canEdit ? 38 : 0) + (isMe ? 47 : 0);
      const left = Math.max(8, Math.min(x, vw - popW - 8));
      const spaceBelow = vh - y;
      if (spaceBelow > estH + 16) setPos({ x: left, top: y + 4 });
      else setPos({ x: left, bottom: Math.max(8, vh - y + 4) });
      setExpanded(false);
      setPop("menu");
    },
  }));

  const menuItems = [
    { key: "reply", label: "Responder", Icon: Reply, fn: props.onReply, violet: false },
    { key: "copy", label: "Copiar", Icon: Copy, fn: props.onCopy, violet: false },
    ...(canEdit ? [{ key: "edit", label: "Editar", Icon: Pencil, fn: props.onEdit, violet: false }] : []),
    { key: "forward", label: "Reenviar", Icon: Forward, fn: props.onForward, violet: false },
    { key: "copilot", label: "Pregunte a CoPilot", Icon: Sparkles, fn: props.onAskCopilot, violet: true },
    { key: "task", label: "Crear tarea", Icon: CheckSquare, fn: props.onCreateTask, violet: false },
    { key: "pin", label: isPinned ? "Desfijar mensaje" : "Fijar mensaje", Icon: isPinned ? PinOff : Pin, fn: props.onPin, violet: false },
  ];
  const MENU_W = 232;

  return (
    <div
      ref={wrapRef}
      className={cn("absolute -top-3 z-20 hidden group-hover:flex items-center gap-1", isMe ? "left-2" : "right-2", pop && "!flex")}
    >
      <button type="button" title="Reaccionar" onClick={(e) => openPop("react", e)}
        className="h-7 w-7 rounded-full bg-white dark:bg-neutral-800 shadow-md border border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/10 hover:scale-105 flex items-center justify-center transition">
        <SmilePlus className="h-3.5 w-3.5 text-neutral-500" strokeWidth={2} />
      </button>
      <button type="button" title="Más" onClick={(e) => openPop("menu", e)}
        className="h-7 w-7 rounded-full bg-white dark:bg-neutral-800 shadow-md border border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/10 hover:scale-105 flex items-center justify-center transition">
        <MoreHorizontal className="h-3.5 w-3.5 text-neutral-500" strokeWidth={2} />
      </button>

      {mounted && createPortal(
      <AnimatePresence>
        {pop === "react" && (
          <motion.div
            key="react" data-msg-pop
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.12 }}
            style={{ position: "fixed", left: pos.x, top: pos.top, bottom: pos.bottom }}
            className="z-[90]"
          >
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl border border-neutral-200 dark:border-white/10 p-1.5">
              <div className="flex items-center gap-0.5">
                {QUICK.map((em) => (
                  <button key={em} type="button" onClick={() => run(() => props.onReact(em))}
                    className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 text-xl leading-none flex items-center justify-center transition hover:scale-110">{em}</button>
                ))}
                <button type="button" title="Más emojis" onClick={() => setExpanded((v) => !v)}
                  className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 flex items-center justify-center transition">
                  <ChevronDown className={cn("h-4 w-4 text-neutral-500 transition-transform", expanded && "rotate-180")} strokeWidth={2} />
                </button>
              </div>
              <AnimatePresence>
                {expanded && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-8 gap-0.5 pt-1.5 mt-1.5 border-t border-neutral-100 dark:border-white/10 max-h-40 overflow-y-auto w-[300px]">
                      {MORE.map((em) => (
                        <button key={em} type="button" onClick={() => run(() => props.onReact(em))}
                          className="h-8 w-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/10 text-lg flex items-center justify-center transition">{em}</button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {pop === "menu" && (
          <motion.div
            key="menu" data-msg-pop
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            style={{ position: "fixed", left: pos.x, top: pos.top, bottom: pos.bottom, width: MENU_W }}
            className="z-[90] bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl border border-neutral-200 dark:border-white/10 py-1.5 overflow-hidden"
          >
            {menuItems.map((it) => (
              <button key={it.key} type="button" onClick={() => run(it.fn)}
                className={cn("w-full px-3.5 py-2 flex items-center justify-between gap-3 text-sm text-left transition hover:bg-neutral-100 dark:hover:bg-white/5",
                  it.violet ? "text-violet-600 dark:text-violet-400" : "text-neutral-700 dark:text-white/85")}>
                <span>{it.label}</span>
                <it.Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
              </button>
            ))}
            {isMe && (
              <>
                <div className="my-1 h-px bg-neutral-100 dark:bg-white/10" />
                <button type="button" onClick={() => run(props.onDelete)}
                  className="w-full px-3.5 py-2 flex items-center justify-between gap-3 text-sm text-left text-red-600 dark:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-500/10">
                  <span>Eliminar</span>
                  <Trash2 className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2} />
                </button>
              </>
            )}
            <div className="my-1 h-px bg-neutral-100 dark:bg-white/10" />
            <button type="button" onClick={() => run(props.onSelect)}
              className="w-full px-3.5 py-2 flex items-center justify-between gap-3 text-sm text-left text-neutral-700 dark:text-white/85 transition hover:bg-neutral-100 dark:hover:bg-white/5">
              <span>Seleccionar</span>
              <CircleCheck className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
});
MessageActions.displayName = "MessageActions";
