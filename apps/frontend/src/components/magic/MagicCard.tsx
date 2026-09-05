"use client";
import { ReactNode } from "react";
import Tilt from "react-parallax-tilt";
import { Spotlight } from "./Spotlight";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  tiltAmount?: number;
  glare?: boolean;
}

export function MagicCard({ children, className, tiltAmount = 6, glare = true }: Props) {
  return (
    <Tilt
      tiltMaxAngleX={tiltAmount}
      tiltMaxAngleY={tiltAmount}
      glareEnable={glare}
      glareMaxOpacity={0.18}
      glareColor="#5750E8"
      glarePosition="all"
      scale={1.01}
      perspective={1200}
      transitionSpeed={1000}
      className="h-full"
    >
      <Spotlight className={cn("h-full glass rounded-3xl transition-all", className)}>
        {children}
      </Spotlight>
    </Tilt>
  );
}
