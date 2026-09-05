"use client";
import { useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

interface Props {
  value: number | null | undefined;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}

export function NumberTicker({ value, decimals = 0, prefix = "", suffix = "", duration = 1200, className }: Props) {
  const [display, setDisplay] = useState(0);
  const prevValueRef = useRef(0);
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.3 });

  // Normalize: undefined or non-number → null
  const safeValue = value === null || value === undefined || isNaN(Number(value))
    ? null
    : Number(value);

  useEffect(() => {
    if (safeValue === null || !inView) return;
    const start = prevValueRef.current;
    const end = safeValue;
    const startTime = performance.now();

    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      setDisplay(current);
      if (progress < 1) raf = requestAnimationFrame(step);
      else prevValueRef.current = end;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [safeValue, inView, duration]);

  if (safeValue === null) {
    return (
      <span ref={ref} className={className}>
        <span className="inline-block w-16 h-8 skeleton rounded" />
      </span>
    );
  }

  let formatted: string;
  try {
    formatted = display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  } catch {
    formatted = String(display);
  }

  return (
    <span ref={ref} className={className}>
      {prefix}{formatted}{suffix}
    </span>
  );
}
