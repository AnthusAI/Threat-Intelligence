"use client";

import { motion, useReducedMotion } from "motion/react";
import React, { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { PICTOGRAM_CYCLE_MS, PICTOGRAM_EDGE_WIDTH, PICTOGRAM_NODE_RADIUS } from "./registry";

export type PictogramPalette = {
  frame: string;
  edge: string;
  node: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentGlow: string;
  safe: string;
  warning: string;
  barrier: string;
};

export const PICTOGRAM_PALETTE: PictogramPalette = {
  frame: "var(--background)",
  edge: "var(--ti-pictogram-edge)",
  node: "var(--ti-pictogram-node)",
  muted: "var(--ti-pictogram-muted)",
  accent: "var(--ti-pictogram-compromised)",
  accentSoft: "var(--ti-pictogram-throb)",
  accentGlow: "var(--ti-pictogram-accent-glow)",
  safe: "var(--grass-8)",
  warning: "var(--amber-8)",
  barrier: "var(--sand-8)",
};

export type PictogramMotion = {
  cycleS: number;
  phase: number;
  prefersReducedMotion: boolean;
  delayS: (offsetMs?: number) => number;
};

export function usePictogramMotion(phaseOffsetMs: number): PictogramMotion {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const [epochMs, setEpochMs] = useState(0);

  useEffect(() => {
    setEpochMs(Date.now() % PICTOGRAM_CYCLE_MS);
  }, []);

  return useMemo(() => {
    const cycleS = PICTOGRAM_CYCLE_MS / 1000;
    const phase = ((epochMs + phaseOffsetMs) % PICTOGRAM_CYCLE_MS) / PICTOGRAM_CYCLE_MS;
    return {
      cycleS,
      phase,
      prefersReducedMotion,
      delayS: (offsetMs = 0) =>
        prefersReducedMotion ? 0 : -(((epochMs + phaseOffsetMs + offsetMs) % PICTOGRAM_CYCLE_MS) / 1000),
    };
  }, [epochMs, phaseOffsetMs, prefersReducedMotion]);
}

export function PictogramFrame({
  aspectRatio = 1,
  frameHeight,
  frameWidth,
  children,
}: {
  aspectRatio?: number;
  frameHeight?: number;
  frameWidth?: number;
  children: ReactNode;
}) {
  const style = frameHeight
    ? ({
        height: frameHeight,
        width: frameWidth ?? "100%",
      } as CSSProperties)
    : ({ "--pictogram-aspect-ratio": String(aspectRatio) } as CSSProperties);
  return (
    <div className="pictogram-figure__frame" style={style}>
      {children}
    </div>
  );
}

export function PictogramSvg({
  alt,
  children,
  viewBox = "0 0 320 220",
}: {
  alt: string;
  children: ReactNode;
  viewBox?: string;
}) {
  return (
    <svg aria-label={alt} className="pictogram-figure__svg" role="img" viewBox={viewBox}>
      <title>{alt}</title>
      {children}
    </svg>
  );
}

export function Line({
  d,
  palette,
  tone = "edge",
  width = PICTOGRAM_EDGE_WIDTH,
  opacity = 1,
  dashArray,
  dashOffset,
}: {
  d: string;
  palette: PictogramPalette;
  tone?: "edge" | "muted" | "accent" | "safe" | "warning" | "barrier";
  width?: number;
  opacity?: number;
  dashArray?: string;
  dashOffset?: number;
}) {
  return (
    <path
      d={d}
      fill="none"
      opacity={opacity}
      stroke={resolveTone(palette, tone)}
      strokeDasharray={dashArray}
      strokeDashoffset={dashOffset}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={width}
    />
  );
}

export function MotionLine({
  animate,
  d,
  palette,
  tone = "edge",
  transition,
  width = PICTOGRAM_EDGE_WIDTH,
  opacity = 1,
  dashArray,
}: {
  animate: any;
  d: string;
  palette: PictogramPalette;
  tone?: "edge" | "muted" | "accent" | "safe" | "warning" | "barrier";
  transition: any;
  width?: number;
  opacity?: number;
  dashArray?: string;
}) {
  return (
    <motion.path
      animate={animate}
      d={d}
      fill="none"
      initial={false}
      opacity={opacity}
      stroke={resolveTone(palette, tone)}
      strokeDasharray={dashArray}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={width}
      transition={transition}
    />
  );
}

export function Node({
  glow = false,
  palette,
  r = PICTOGRAM_NODE_RADIUS,
  tone = "node",
  x,
  y,
}: {
  glow?: boolean;
  palette: PictogramPalette;
  r?: number;
  tone?: "node" | "muted" | "accent" | "safe" | "warning";
  x: number;
  y: number;
}) {
  const fill = resolveNodeTone(palette, tone);
  return (
    <g>
      {glow ? <circle cx={x} cy={y} fill={palette.accentGlow} r={r * 2.4} /> : null}
      <circle cx={x} cy={y} fill={fill} r={r} />
    </g>
  );
}

export function MotionNode({
  animate,
  glow = false,
  palette,
  r = PICTOGRAM_NODE_RADIUS,
  tone = "node",
  transition,
  x,
  y,
}: {
  animate: any;
  glow?: boolean;
  palette: PictogramPalette;
  r?: number;
  tone?: "node" | "muted" | "accent" | "safe" | "warning";
  transition: any;
  x: number;
  y: number;
}) {
  const fill = resolveNodeTone(palette, tone);
  return (
    <g>
      {glow ? (
        <motion.circle animate={animate} cx={x} cy={y} fill={palette.accentGlow} initial={false} r={r * 2.4} transition={transition} />
      ) : null}
      <motion.circle animate={animate} cx={x} cy={y} fill={fill} initial={false} r={r} transition={transition} />
    </g>
  );
}

export function Box({
  fillOpacity = 0.08,
  height,
  palette,
  strokeTone = "edge",
  width,
  x,
  y,
}: {
  fillOpacity?: number;
  height: number;
  palette: PictogramPalette;
  strokeTone?: "edge" | "muted" | "accent" | "safe" | "warning" | "barrier";
  width: number;
  x: number;
  y: number;
}) {
  const stroke = resolveTone(palette, strokeTone);
  return (
    <rect
      fill={stroke}
      fillOpacity={fillOpacity}
      height={height}
      rx={14}
      stroke={stroke}
      strokeWidth={PICTOGRAM_EDGE_WIDTH}
      width={width}
      x={x}
      y={y}
    />
  );
}

export function arrowPath(x1: number, y1: number, x2: number, y2: number, arrowSize = 9): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const bx = x2 - ux * arrowSize;
  const by = y2 - uy * arrowSize;
  const leftX = bx + px * (arrowSize * 0.55);
  const leftY = by + py * (arrowSize * 0.55);
  const rightX = bx - px * (arrowSize * 0.55);
  const rightY = by - py * (arrowSize * 0.55);
  return `M ${x1} ${y1} L ${x2} ${y2} M ${leftX} ${leftY} L ${x2} ${y2} L ${rightX} ${rightY}`;
}

export function pointsPath(points: Array<[number, number]>): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

export function ringNodes(cx: number, cy: number, radius: number, count: number, startAngle = -90): Array<[number, number]> {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((startAngle + (360 / count) * index) * Math.PI) / 180;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

function resolveTone(palette: PictogramPalette, tone: "edge" | "muted" | "accent" | "safe" | "warning" | "barrier"): string {
  switch (tone) {
    case "muted":
      return palette.muted;
    case "accent":
      return palette.accent;
    case "safe":
      return palette.safe;
    case "warning":
      return palette.warning;
    case "barrier":
      return palette.barrier;
    default:
      return palette.edge;
  }
}

function resolveNodeTone(palette: PictogramPalette, tone: "node" | "muted" | "accent" | "safe" | "warning"): string {
  switch (tone) {
    case "muted":
      return palette.muted;
    case "accent":
      return palette.accent;
    case "safe":
      return palette.safe;
    case "warning":
      return palette.warning;
    default:
      return palette.node;
  }
}

export function Actor({
  palette,
  x,
  y,
  scale = 1,
  colorAnimation,
  hatAnimation,
  bgAnimation,
  baseColor,
  state = "user",
}: {
  palette: PictogramPalette;
  x: number;
  y: number;
  scale?: number;
  colorAnimation?: string;
  hatAnimation?: string;
  bgAnimation?: string;
  baseColor?: string;
  state?: "user" | "threat";
}) {
  const isThreat = state === "threat";
  
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {/* Background circle for threat state */}
      <circle
        cx={0}
        cy={-4}
        r={18}
        fill={palette.accent}
        style={{ 
          opacity: isThreat ? 1 : 0,
          animation: bgAnimation 
        }}
      />
      
      {/* Person (standard color regardless of state) */}
      <g style={{ color: baseColor || palette.muted, animation: colorAnimation }}>
        <circle cx={0} cy={-4} r={6} fill="currentColor" />
        <path d="M -11 11 C -11 3, 11 3, 11 11" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      </g>
      
      {/* Hat (always black) */}
      <g style={{ 
        color: "#000000",
        opacity: isThreat ? 1 : 0, 
        animation: hatAnimation 
      }}>
        <path d="M -6 -10 L -4 -18 L 4 -18 L 6 -10 Z" fill="currentColor" strokeLinejoin="round" />
        <path d="M -11 -10 L 11 -10" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      </g>
    </g>
  );
}

export function RiskGlyph({
  palette,
  x,
  y,
  scale = 1,
  color,
}: {
  palette: PictogramPalette;
  x: number;
  y: number;
  scale?: number;
  color?: string;
}) {
  const fillColor = color || palette.warning;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path 
        d="M 0 -14 L 14 0 L 0 14 L -14 0 Z" 
        fill={fillColor} 
      />
      <path 
        d="M 0 -6 V 3 M 0 7 V 9" 
        stroke={palette.frame} 
        strokeWidth={3.5} 
        strokeLinecap="round" 
        fill="none"
      />
    </g>
  );
}

export function PadlockGlyph({
  palette,
  x,
  y,
  scale = 1,
  color,
  state = "locked",
  shackleAnimation,
}: {
  palette: PictogramPalette;
  x: number;
  y: number;
  scale?: number;
  color?: string;
  state?: "locked" | "unlocked";
  shackleAnimation?: string;
}) {
  const fillColor = color || palette.node;
  const isUnlocked = state === "unlocked";
  
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g style={{ 
        animation: shackleAnimation, 
        transform: isUnlocked ? "translateY(-6px)" : undefined,
        transformOrigin: "center"
      }}>
        <path 
          d="M -5 6 V -7 C -5 -14, 5 -14, 5 -7 V -1" 
          fill="none" 
          stroke={palette.edge} 
          strokeWidth={4.5} 
          strokeLinecap="round" 
        />
      </g>
      <rect 
        x={-11} 
        y={0} 
        width={22} 
        height={16} 
        rx={3} 
        fill={fillColor} 
        stroke={palette.edge} 
        strokeWidth={4} 
      />
      {/* Keyhole */}
      <circle cx={0} cy={6} r={2.5} fill={palette.frame} />
      <path d="M 0 6 V 11" stroke={palette.frame} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}
