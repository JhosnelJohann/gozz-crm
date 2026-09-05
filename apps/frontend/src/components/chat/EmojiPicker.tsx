"use client";
import { useEffect, useRef } from "react";

const GROUPS: { title: string; emojis: string[] }[] = [
  { title: "Caras", emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","🙁","☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩"] },
  { title: "Gestos", emojis: ["👍","👎","👏","🙏","💪","✌️","🤝","🫶","👋","🤚","🖐","✋","🖖","👌","🤌","🤏","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👊","✊","🤛","🤜"] },
  { title: "Corazones", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟"] },
  { title: "Celebracion", emojis: ["🎉","🎊","🥳","🎁","🎂","🍾","🥂","🍻","🎈","🎆","🎇","✨","🔥","💯","⭐","🌟","💫","💥","💡","🚀","🏆","🥇","🎯"] },
  { title: "Objetos", emojis: ["👀","✅","❌","⚠️","❓","❗","⏰","📌","📎","✏️","📝","📄","💼","💰","💵","💳","📱","💻","🔔","🔕","🔒","🔓","🔑","🎵","🎶","📷","🎥","📺","🏠","🏢","🚗","✈️","⚽","🏀","🍕","🍔","🌮","🍎","🍓","🍰","☕"] },
];

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-lenis-prevent
      className="absolute bottom-12 right-0 z-30 glass rounded-2xl p-2 w-72 max-h-72 overflow-y-auto overscroll-contain shadow-glass dark:shadow-glass-dark border border-white/20"
    >
      {GROUPS.map((g) => (
        <div key={g.title} className="mb-2 last:mb-0">
          <div className="text-[10px] font-ui tracking-widest uppercase text-neutral-500 dark:text-white/50 px-1 mb-1">{g.title}</div>
          <div className="grid grid-cols-8 gap-1">
            {g.emojis.map((em, i) => (
              <button
                key={em + i}
                type="button"
                onClick={() => onPick(em)}
                className="text-lg h-7 w-7 flex items-center justify-center rounded hover:bg-brand-orange/15 transition"
              >
                {em}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
