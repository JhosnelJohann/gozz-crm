"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Bot, Sparkles } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

interface Props {
  contenido: string;
  createdAt: string;
}

/**
 * Renderiza un mensaje de CoPilot con markdown completo — estilo Claude:
 * - títulos con jerarquía clara
 * - listas con bullets/numerado
 * - bloques de código con header y copy
 * - tablas zebra, blockquotes, hr gradient
 * - bold/italic/inline-code refinados
 */
export function CoPilotMessage({ contenido, createdAt }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contenido);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="group relative w-full"
    >
      <div
        className={cn(
          "relative rounded-2xl rounded-bl-[6px] bg-white dark:bg-[#1e2229] text-neutral-900 dark:text-white/90",
          "border border-violet-200/60 dark:border-violet-500/15",
          "shadow-[0_1px_3px_rgba(0,0,0,0.04),0_0_0_1px_rgba(139,92,246,0.04)]",
          "overflow-hidden"
        )}
      >
        {/* Aura sutil violet/fuchsia en la esquina */}
        <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br from-fuchsia-400/15 to-violet-500/15 blur-2xl" />

        <div className="relative px-4 pt-3.5 pb-2.5">
          <article className="copilot-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-[17px] leading-snug font-display font-black text-neutral-900 dark:text-white mb-2 mt-1 first:mt-0 bg-gradient-to-br from-fuchsia-600 via-violet-600 to-indigo-600 dark:from-fuchsia-400 dark:via-violet-400 dark:to-indigo-400 bg-clip-text text-transparent">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-[15px] leading-snug font-display font-black text-neutral-900 dark:text-white mb-2 mt-3 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-[13.5px] leading-snug font-display font-bold text-neutral-800 dark:text-white/90 mb-1.5 mt-3 first:mt-0">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-[13px] font-ui font-bold text-neutral-700 dark:text-white/80 mb-1 mt-2 first:mt-0 uppercase tracking-wider">
                    {children}
                  </h4>
                ),
                p: ({ children }) => (
                  <p className="text-[14px] leading-relaxed text-neutral-800 dark:text-white/85 my-1.5 first:mt-0 last:mb-0">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="my-2 space-y-1 pl-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-2 space-y-1 pl-1 list-decimal list-inside marker:text-violet-500 marker:font-bold">{children}</ol>
                ),
                li: ({ children, ...props }: any) => {
                  // Si el li pertenece a un <ol>, se ve con marker list-decimal del padre;
                  // para <ul> usamos bullet custom gradient.
                  const inOrdered = props?.node?.parent?.tagName === "ol";
                  if (inOrdered) {
                    return <li className="text-[14px] leading-relaxed text-neutral-800 dark:text-white/85 ml-4">{children}</li>;
                  }
                  return (
                    <li className="text-[14px] leading-relaxed text-neutral-800 dark:text-white/85 pl-5 relative">
                      <span className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600" />
                      {children}
                    </li>
                  );
                },
                strong: ({ children }) => (
                  <strong className="font-bold text-neutral-900 dark:text-white">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-neutral-700 dark:text-white/75">{children}</em>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-600 dark:text-fuchsia-400 font-medium underline decoration-violet-300 dark:decoration-fuchsia-500/40 underline-offset-2 hover:decoration-violet-500 transition"
                  >
                    {children}
                  </a>
                ),
                hr: () => (
                  <hr className="my-3 border-0 h-px bg-gradient-to-r from-transparent via-violet-300/60 dark:via-violet-500/30 to-transparent" />
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-3 pl-4 border-l-[3px] border-violet-400 dark:border-violet-500 bg-violet-50/50 dark:bg-violet-500/5 py-2 pr-3 rounded-r-lg text-[13.5px] text-neutral-700 dark:text-white/80 italic">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto rounded-xl border border-neutral-200 dark:border-white/10">
                    <table className="w-full text-[13px] border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-900/20 dark:to-fuchsia-900/20">
                    {children}
                  </thead>
                ),
                th: ({ children }) => (
                  <th className="px-3 py-2 text-left font-ui font-bold text-neutral-700 dark:text-white/80 text-[11.5px] uppercase tracking-wider">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2 border-t border-neutral-100 dark:border-white/5 text-neutral-700 dark:text-white/80">
                    {children}
                  </td>
                ),
                code: ({ inline, className, children, ...props }: any) => {
                  if (inline) {
                    return (
                      <code className="px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[12.5px] font-mono font-semibold border border-violet-200/60 dark:border-violet-500/20">
                        {children}
                      </code>
                    );
                  }
                  const lang = (className || "").replace("language-", "") || "code";
                  return (
                    <CodeBlock lang={lang} code={String(children).replace(/\n$/, "")} />
                  );
                },
                pre: ({ children }) => <>{children}</>,
              }}
            >
              {contenido}
            </ReactMarkdown>
          </article>

          <div className="flex items-center gap-2 justify-end mt-2 -mb-0.5">
            <button
              onClick={copy}
              className="opacity-0 group-hover:opacity-100 transition text-[10px] font-ui font-semibold text-neutral-500 hover:text-violet-600 flex items-center gap-1"
              title="Copiar respuesta"
            >
              {copied ? (
                <><Check className="h-3 w-3" /> Copiado</>
              ) : (
                <><Copy className="h-3 w-3" /> Copiar</>
              )}
            </button>
            <span className="text-[10px] text-neutral-400 dark:text-white/40 font-ui tabular-nums">
              {new Date(createdAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-neutral-200 dark:border-white/10 bg-neutral-950 dark:bg-black/40">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-neutral-900 to-neutral-800 text-white/70 border-b border-white/10">
        <div className="text-[10px] font-ui font-bold uppercase tracking-widest">{lang}</div>
        <button
          onClick={copy}
          className="text-[10px] font-ui font-semibold hover:text-white flex items-center gap-1 transition"
        >
          {copied ? <><Check className="h-3 w-3" /> Copiado</> : <><Copy className="h-3 w-3" /> Copiar</>}
        </button>
      </div>
      <pre className="px-3 py-2.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-emerald-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Avatar robótico con gradient y sparkle pulsante — para CoPilot.
 */
export function CoPilotAvatar({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center",
        "bg-gradient-to-br from-fuchsia-500 via-violet-600 to-indigo-600",
        "shadow-lg shadow-violet-500/25",
        className
      )}
      style={{ width: size, height: size }}
    >
      {/* Anillo rotante sutil */}
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        className="absolute inset-[-1px] rounded-full opacity-60"
        style={{
          background: "conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.45) 90deg, rgba(255,255,255,0) 180deg)",
        }}
      />
      {/* Core */}
      <div className="absolute inset-[2px] rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-600 to-indigo-600 flex items-center justify-center">
        <Bot className="text-white" style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
      </div>
      {/* Sparkle top-right */}
      <motion.span
        animate={{ scale: [1, 1.25, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[2px] right-[2px] pointer-events-none"
      >
        <Sparkles className="h-2 w-2 text-yellow-200" strokeWidth={2.5} />
      </motion.span>
    </div>
  );
}

/**
 * Indicador top-tier "CoPilot está pensando" — fases dinámicas según kind + waveform
 * animado + shimmer + partículas. Reemplaza al typing simple.
 */
export type CoPilotThinkingKind = "texto" | "audio" | "archivo" | "imagen" | "video";

const STAGES: Record<CoPilotThinkingKind, string[]> = {
  texto: [
    "Leyendo tu mensaje",
    "Revisando contexto y memoria",
    "Consultando información relevante",
    "Razonando con Claude Sonnet 4.6",
    "Redactando respuesta",
  ],
  audio: [
    "Escuchando tu audio",
    "Transcribiendo con Whisper",
    "Analizando lo que dijiste",
    "Razonando con Claude Sonnet 4.6",
    "Redactando respuesta",
  ],
  archivo: [
    "Descargando el documento",
    "Leyendo contenido completo",
    "Analizando datos y estructura",
    "Razonando con Claude Sonnet 4.6",
    "Redactando respuesta",
  ],
  imagen: [
    "Procesando la imagen",
    "Analizando visualmente",
    "Interpretando detalles",
    "Razonando con Claude Sonnet 4.6",
    "Redactando respuesta",
  ],
  video: [
    "Procesando el video",
    "Analizando contenido",
    "Razonando con Claude Sonnet 4.6",
    "Redactando respuesta",
  ],
};

interface CoPilotThinkingProps {
  kind?: CoPilotThinkingKind;
  startedAt?: number;
}

export function CoPilotThinking({ kind = "texto", startedAt }: CoPilotThinkingProps) {
  const stages = STAGES[kind] || STAGES.texto;
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Ciclo de fases: avanza cada 2.8s, se queda en la última.
  useEffect(() => {
    const start = Date.now();
    const phase = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, stages.length - 1));
    }, 2800);
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAt || start)) / 1000));
    }, 250);
    return () => { clearInterval(phase); clearInterval(tick); };
  }, [stages.length, startedAt]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      className="flex gap-2.5 max-w-[88%] justify-start"
    >
      <div className="self-start pt-1">
        <CoPilotAvatar size={32} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        {/* Label row */}
        <div className="text-[10px] font-ui mb-1 px-1 flex items-center gap-1.5">
          <span className="bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600 bg-clip-text text-transparent font-bold uppercase tracking-wider">CoPilot</span>
          <motion.span
            animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            className="inline-block h-1 w-1 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.8)]"
          />
          <span className="text-[9px] font-ui font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
            está pensando · {String(elapsed).padStart(2, "0")}s
          </span>
        </div>

        {/* Bubble */}
        <div
          className={cn(
            "relative rounded-2xl rounded-bl-[6px] bg-white dark:bg-[#1e2229]",
            "border border-violet-200/60 dark:border-violet-500/15",
            "shadow-[0_1px_3px_rgba(0,0,0,0.04),0_0_0_1px_rgba(139,92,246,0.04)]",
            "overflow-hidden min-w-[280px]"
          )}
        >
          {/* Conic aurora sutil rotando */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute -inset-20 opacity-[0.35]"
            style={{
              background: "conic-gradient(from 0deg, rgba(139,92,246,0) 0deg, rgba(217,70,239,0.25) 90deg, rgba(139,92,246,0) 180deg, rgba(99,102,241,0.2) 270deg, rgba(139,92,246,0) 360deg)",
              filter: "blur(30px)",
            }}
          />

          {/* Shimmer sweep */}
          <motion.div
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-violet-400/10 to-transparent"
          />

          <div className="relative px-4 py-3">
            {/* Stage text — slide transition */}
            <div className="relative h-5 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={stageIdx}
                  initial={{ y: 18, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -18, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  className="absolute inset-0 flex items-center"
                >
                  <span className="text-[13.5px] font-ui font-bold bg-gradient-to-r from-violet-700 via-fuchsia-600 to-violet-700 dark:from-violet-300 dark:via-fuchsia-300 dark:to-violet-300 bg-clip-text text-transparent">
                    {stages[stageIdx]}
                  </span>
                  <span className="ml-1 text-violet-500 dark:text-violet-400">
                    <AnimatedDots />
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Waveform — 24 barras con fase desplazada */}
            <div className="mt-3 flex items-end gap-[2px] h-3.5">
              {Array.from({ length: 24 }).map((_, i) => (
                <motion.span
                  key={i}
                  animate={{
                    scaleY: [0.3, 1, 0.55, 0.85, 0.3],
                  }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    delay: i * 0.05,
                    ease: "easeInOut",
                  }}
                  style={{ transformOrigin: "bottom" }}
                  className="w-[3px] h-full rounded-full bg-gradient-to-t from-fuchsia-500 via-violet-500 to-indigo-500"
                />
              ))}
            </div>

            {/* Progreso de fases — 5 pills */}
            <div className="mt-3 flex items-center gap-1">
              {stages.map((_, i) => (
                <motion.span
                  key={i}
                  animate={i <= stageIdx ? { opacity: 1, scale: 1 } : { opacity: 0.3, scale: 0.85 }}
                  transition={{ duration: 0.4 }}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    i <= stageIdx
                      ? "w-8 bg-gradient-to-r from-fuchsia-500 to-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.5)]"
                      : "w-6 bg-violet-200 dark:bg-violet-900/40"
                  )}
                />
              ))}
              <span className="ml-auto text-[9px] font-ui font-bold uppercase tracking-wider text-neutral-400 dark:text-white/40">
                {stageIdx + 1}/{stages.length}
              </span>
            </div>
          </div>

          {/* Partículas sutiles flotando */}
          <ThinkingParticles />
        </div>
      </div>
    </motion.div>
  );
}

function AnimatedDots() {
  return (
    <span className="inline-flex gap-0.5 ml-0.5">
      {[0, 0.15, 0.3].map((d, i) => (
        <motion.span
          key={i}
          animate={{ y: [0, -2, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: d, ease: "easeInOut" }}
          className="inline-block w-[3px] h-[3px] rounded-full bg-current"
        />
      ))}
    </span>
  );
}

function ThinkingParticles() {
  // 6 partículas flotantes con offsets aleatorios fijos para no romper SSR.
  const particles = [
    { left: "10%", delay: 0 },
    { left: "28%", delay: 0.8 },
    { left: "46%", delay: 0.3 },
    { left: "64%", delay: 1.2 },
    { left: "80%", delay: 0.6 },
    { left: "92%", delay: 1.5 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <motion.span
          key={i}
          initial={{ y: 40, opacity: 0 }}
          animate={{
            y: [-5, -40],
            opacity: [0, 0.7, 0],
            scale: [0.6, 1, 0.3],
          }}
          transition={{
            duration: 3.2,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeOut",
          }}
          style={{ left: p.left, bottom: 0 }}
          className="absolute h-1 w-1 rounded-full bg-gradient-to-br from-fuchsia-400 to-violet-500 blur-[0.5px]"
        />
      ))}
    </div>
  );
}

/**
 * Alias legacy para mantener compat con cualquier import viejo.
 * @deprecated Usar CoPilotThinking.
 */
export function CoPilotTyping() {
  return <CoPilotThinking kind="texto" />;
}
