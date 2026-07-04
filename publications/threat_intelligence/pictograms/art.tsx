"use client";

import { motion } from "motion/react";
import type { CSSProperties, ReactElement } from "react";
import type { ThreatIntelligencePictogramSlug } from "./registry";
import {
  arrowPath,
  Box,
  Line,
  Node,
  PictogramSvg,
  pointsPath,
  type PictogramMotion,
  type PictogramPalette,
} from "./system";

export type RegisteredPictogramProps = {
  alt: string;
  timing: PictogramMotion;
  palette: PictogramPalette;
};

export type PictogramRegistryEntry = {
  aspectRatio?: number;
  render: (props: RegisteredPictogramProps) => ReactElement;
};

function BalanceShiftPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const scalePalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const nodeTransition = timing.prefersReducedMotion
    ? { duration: 0 }
    : {
        duration: timing.cycleS,
        repeat: Infinity,
        ease: "easeInOut",
        times: [0, 0.24, 0.42, 0.62, 1],
        delay: timing.delayS(900),
      };
  const animationDelay = `${timing.delayS()}s`;
  const beamStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-scale-beam ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    transform: timing.prefersReducedMotion ? "rotate(7deg)" : undefined,
    transformBox: "view-box",
    transformOrigin: "160px 118px",
  } as CSSProperties;
  const leftPanStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-scale-left-pan ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    transform: timing.prefersReducedMotion ? "translateY(-10px)" : undefined,
  } as CSSProperties;
  const rightPanStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-scale-right-pan ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    transform: timing.prefersReducedMotion ? "translateY(12px)" : undefined,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-scale-beam {
            0%, 16%, 100% { transform: rotate(0deg); }
            38%, 82% { transform: rotate(7deg); }
          }

          @keyframes ti-scale-left-pan {
            0%, 16%, 100% { transform: translateY(0); }
            38%, 82% { transform: translateY(-10px); }
          }

          @keyframes ti-scale-right-pan {
            0%, 16%, 100% { transform: translateY(0); }
            38%, 82% { transform: translateY(12px); }
          }
        `}
      </style>
      <g transform="translate(160 166) scale(1.14) translate(-160 -166)">
        <Line d="M 160 86 V 246" palette={scalePalette} width={8} />
        <Line d="M 124 246 H 196" palette={scalePalette} width={9} />
        <g>
          <g style={beamStyle}>
            <path
              d="M 72 118 L 248 118"
              fill="none"
              stroke={scalePalette.edge}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={8}
            />
            <path
              d="M 160 118 L 248 118"
              fill="none"
              stroke={palette.accent}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={8}
            />
          </g>
          <g style={leftPanStyle}>
            <path
              d="M 78 118 L 42 198 H 128 L 78 118 Z"
              fill="none"
              stroke={scalePalette.edge}
              strokeLinejoin="round"
              strokeWidth={6}
            />
            <circle cx={70} cy={180} fill={scalePalette.node} opacity={0.88} r={15} />
            <circle cx={92} cy={190} fill={scalePalette.muted} opacity={0.86} r={11} />
          </g>
          <g style={rightPanStyle}>
            <path
              d="M 246 118 L 190 212 H 288 L 246 118 Z"
              fill="none"
              stroke={palette.accent}
              strokeLinejoin="round"
              strokeWidth={7}
            />
            <motion.circle
              animate={timing.prefersReducedMotion ? { opacity: 0.78, scale: 1 } : { opacity: [0.42, 0.42, 0.62, 0.82, 0.82], scale: [1, 1, 1.02, 1.04, 1.04] }}
              cx={208}
              cy={198}
              fill={palette.accent}
              initial={false}
              opacity={0.78}
              r={13}
              transition={nodeTransition as any}
            />
            <motion.circle
              animate={timing.prefersReducedMotion ? { opacity: 0.9, scale: 1 } : { opacity: [0.5, 0.5, 0.76, 0.95, 0.95], scale: [1, 1, 1.03, 1.07, 1.07] }}
              cx={232}
              cy={188}
              fill={palette.accent}
              initial={false}
              opacity={0.9}
              r={14}
              transition={{ ...nodeTransition, delay: timing.delayS(1200) } as any}
            />
            <motion.circle
              animate={timing.prefersReducedMotion ? { opacity: 1, scale: 1 } : { opacity: [0.55, 0.55, 0.84, 1, 1], scale: [1, 1, 1.03, 1.1, 1.1] }}
              cx={254}
              cy={200}
              fill={palette.accent}
              initial={false}
              opacity={1}
              r={16}
              transition={{ ...nodeTransition, delay: timing.delayS(1550) } as any}
            />
            <motion.circle
              animate={timing.prefersReducedMotion ? { opacity: 0.82, scale: 1 } : { opacity: [0.38, 0.38, 0.68, 0.88, 0.88], scale: [1, 1, 1.02, 1.06, 1.06] }}
              cx={274}
              cy={189}
              fill={palette.accent}
              initial={false}
              opacity={0.82}
              r={12}
              transition={{ ...nodeTransition, delay: timing.delayS(1900) } as any}
            />
          </g>
        </g>
        <circle cx={160} cy={118} fill={palette.frame} r={23} stroke={scalePalette.edge} strokeWidth={7} />
      </g>
    </PictogramSvg>
  );
}

function NewsroomFlowPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const newsroomPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const animationDelay = `${timing.delayS()}s`;
  const wheelStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-newsroom-wheel ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    transform: timing.prefersReducedMotion ? "rotate(7deg)" : undefined,
    transformBox: "view-box",
    transformOrigin: "160px 70px",
  } as CSSProperties;
  const dotStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-newsroom-dot ${timing.cycleS}s linear ${timing.delayS(1200)}s infinite`,
    transform: timing.prefersReducedMotion ? "translate(196px, 0)" : undefined,
  } as CSSProperties;
  const activeLineStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-newsroom-flow ${timing.cycleS}s linear ${timing.delayS(1200)}s infinite`,
    opacity: timing.prefersReducedMotion ? 0.85 : undefined,
    strokeDashoffset: timing.prefersReducedMotion ? -224 : undefined,
  } as CSSProperties;
  const flowCenters = [
    [62, 214],
    [160, 160],
    [258, 214],
    [160, 264],
    [62, 214],
  ] as Array<[number, number]>;
  const flowPath = pointsPath(flowCenters);
  const states = [
    { cx: 62, cy: 214, r: 30, inner: "M 48 214 H 76" },
    { cx: 160, cy: 160, r: 32, inner: "M 146 152 H 174 M 146 168 H 174" },
    { cx: 258, cy: 214, r: 30, inner: "M 246 204 H 270 M 246 214 H 270 M 246 224 H 270" },
    { cx: 160, cy: 264, r: 30, inner: "M 148 256 L 160 268 L 176 250" },
  ];

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-newsroom-wheel {
            0%, 16%, 100% { transform: rotate(-5deg); }
            34% { transform: rotate(8deg); }
            54% { transform: rotate(-3deg); }
            72% { transform: rotate(6deg); }
          }

          @keyframes ti-newsroom-dot {
            0%, 100% { transform: translate(0, 0); }
            18% { transform: translate(98px, -54px); }
            36% { transform: translate(196px, 0); }
            54% { transform: translate(98px, 50px); }
            72% { transform: translate(0, 0); }
          }

          @keyframes ti-newsroom-flow {
            0% { opacity: 0.2; stroke-dashoffset: 0; }
            18% { opacity: 0.95; stroke-dashoffset: -112; }
            36% { opacity: 0.95; stroke-dashoffset: -224; }
            54% { opacity: 0.95; stroke-dashoffset: -334; }
            72%, 100% { opacity: 0.2; stroke-dashoffset: -444; }
          }
        `}
      </style>
      <g transform="translate(160 172) scale(1.12) translate(-160 -172)">
        <g style={wheelStyle}>
          <circle cx={160} cy={70} fill="none" r={44} stroke={newsroomPalette.edge} strokeWidth={8} />
          <circle cx={160} cy={70} fill={palette.frame} r={8} stroke={newsroomPalette.edge} strokeWidth={5} />
          <Line d="M 160 70 V 28" palette={newsroomPalette} width={5} />
          <Line d="M 160 70 L 124 94" palette={newsroomPalette} width={5} />
          <Line d="M 160 70 L 196 94" palette={newsroomPalette} width={5} />
        </g>
        <Line d="M 160 116 V 128" opacity={0.7} palette={newsroomPalette} tone="muted" width={4} />
        <Line d={flowPath} opacity={0.42} palette={newsroomPalette} tone="muted" width={5} />
        <path
          d={flowPath}
          fill="none"
          stroke={palette.accent}
          strokeDasharray="44 440"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={5}
          style={activeLineStyle}
        />
        {states.map((state, index) => (
          <g key={`${state.cx}-${state.cy}`}>
            <circle cx={state.cx} cy={state.cy} fill={palette.frame} r={state.r} stroke={newsroomPalette.edge} strokeWidth={6} />
            <Line d={state.inner} opacity={index === 2 ? 0.9 : 0.72} palette={index === 2 ? palette : newsroomPalette} tone={index === 2 ? "accent" : "muted"} width={4} />
            <Node palette={index === 2 ? palette : newsroomPalette} tone={index === 2 ? "accent" : "node"} x={state.cx} y={state.cy} />
          </g>
        ))}
        <circle cx={62} cy={214} fill={palette.accent} r={7} style={dotStyle} />
      </g>
    </PictogramSvg>
  );
}

function AwsDiscoveryPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const awsPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const riskStyle = (offsetMs: number, resting = false) =>
    ({
      animation: timing.prefersReducedMotion ? "none" : `ti-aws-risk ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion && resting ? 1 : timing.prefersReducedMotion ? 0.86 : 0.18,
      transformBox: "fill-box",
      transformOrigin: "center",
    }) as CSSProperties;
  const buckets = [
    { x: 92, y: 74, risk: null },
    { x: 160, y: 74, risk: null },
    { x: 228, y: 74, risk: "warning", offset: 2200, markerDx: 15, markerDy: -20 },
    { x: 92, y: 150, risk: "warning", offset: 4200 },
    { x: 160, y: 150, risk: null },
    { x: 228, y: 150, risk: null },
    { x: 92, y: 226, risk: null },
    { x: 160, y: 226, risk: "accent", offset: 6200, markerDx: 24, markerDy: -16, markerR: 20 },
    { x: 228, y: 226, risk: "accent", offset: 8200, markerDx: 12, markerDy: -24 },
  ];

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-aws-risk {
            0%, 18%, 100% { opacity: 0.18; transform: scale(0.9); }
            26% { opacity: 1; transform: scale(1.14); }
            34%, 78% { opacity: 1; transform: scale(1); }
            88% { opacity: 0.42; transform: scale(0.96); }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.14) translate(-160 -150)">
        {buckets.map((bucket) => {
          const stroke = bucket.risk === "accent" ? palette.accent : bucket.risk === "warning" ? palette.warning : awsPalette.edge;
          const markerX = bucket.x + (bucket.markerDx ?? 20);
          const markerY = bucket.y + (bucket.markerDy ?? -19);
          const markerR = bucket.markerR ?? 10;
          return (
            <g key={`aws-bucket-${bucket.x}-${bucket.y}`}>
              <path
                d={`M ${bucket.x - 22} ${bucket.y - 16} C ${bucket.x - 22} ${bucket.y - 27}, ${bucket.x + 22} ${bucket.y - 27}, ${bucket.x + 22} ${bucket.y - 16} V ${bucket.y + 18} C ${bucket.x + 22} ${bucket.y + 29}, ${bucket.x - 22} ${bucket.y + 29}, ${bucket.x - 22} ${bucket.y + 18} Z`}
                fill={palette.frame}
                stroke={awsPalette.edge}
                strokeLinejoin="round"
                strokeWidth={5}
              />
              <path
                d={`M ${bucket.x - 22} ${bucket.y - 16} C ${bucket.x - 22} ${bucket.y - 5}, ${bucket.x + 22} ${bucket.y - 5}, ${bucket.x + 22} ${bucket.y - 16}`}
                fill="none"
                opacity={0.72}
                stroke={awsPalette.muted}
                strokeLinecap="round"
                strokeWidth={4}
              />
              <Node palette={awsPalette} x={bucket.x} y={bucket.y + 2} />
              {bucket.risk ? (
                <g style={riskStyle(bucket.offset ?? 0, bucket.risk === "accent")}>
                  <circle cx={markerX} cy={markerY} fill={stroke} r={markerR} />
                  <path d={`M ${markerX - markerR * 0.8} ${markerY} H ${markerX + markerR * 0.8} M ${markerX} ${markerY - markerR * 0.8} V ${markerY + markerR * 0.8}`} stroke={palette.frame} strokeLinecap="round" strokeWidth={markerR >= 16 ? 4.8 : 3.4} />
                </g>
              ) : null}
            </g>
          );
        })}
      </g>
    </PictogramSvg>
  );
}

function AzureBlastRadiusPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const azurePalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const animationDelay = `${timing.delayS(1000)}s`;
  const pathStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-azure-path ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    opacity: timing.prefersReducedMotion ? 0.95 : undefined,
    strokeDashoffset: timing.prefersReducedMotion ? -270 : undefined,
  } as CSSProperties;
  const riskStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion ? "none" : `ti-azure-risk ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 0.95 : 0.18,
      transformBox: "fill-box",
      transformOrigin: "center",
    }) as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-azure-path {
            0%, 16%, 100% { opacity: 0.18; stroke-dashoffset: 0; }
            34%, 66% { opacity: 0.95; stroke-dashoffset: -270; }
            78% { opacity: 0.28; stroke-dashoffset: -270; }
          }

          @keyframes ti-azure-risk {
            0%, 20%, 100% { opacity: 0.18; transform: scale(0.9); }
            32%, 70% { opacity: 1; transform: scale(1.08); }
            82% { opacity: 0.35; transform: scale(1); }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        <rect fill={palette.frame} height={214} rx={12} stroke={azurePalette.edge} strokeWidth={7} width={222} x={49} y={54} />
        <Line d="M 82 88 H 238 M 82 232 H 238" opacity={0.38} palette={azurePalette} tone="muted" width={4} />
        <circle cx={104} cy={112} fill={palette.frame} r={34} stroke={azurePalette.edge} strokeWidth={6} />
        <Line d="M 92 118 C 94 102, 114 102, 116 118" palette={azurePalette} tone="muted" width={4} />
        <Node palette={azurePalette} x={104} y={104} />
        <rect fill={palette.frame} height={52} rx={8} stroke={azurePalette.edge} strokeWidth={6} width={74} x={184} y={86} />
        <rect fill={palette.frame} height={52} rx={8} stroke={azurePalette.edge} strokeWidth={6} width={74} x={184} y={154} />
        <rect fill={palette.frame} height={40} rx={8} stroke={azurePalette.edge} strokeWidth={6} width={64} x={96} y={196} />
        <Line d="M 198 112 H 244 M 198 180 H 244 M 108 216 H 148" opacity={0.72} palette={azurePalette} tone="muted" width={4} />
        <Line d={pointsPath([[138, 112], [184, 112], [184, 180], [160, 216]])} opacity={0.34} palette={azurePalette} tone="muted" width={4} />
        <path
          d={pointsPath([[104, 112], [142, 112], [184, 112], [222, 112], [222, 180], [160, 216]])}
          fill="none"
          stroke={palette.accent}
          strokeDasharray="44 270"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={6}
          style={pathStyle}
        />
        <Node palette={azurePalette} x={104} y={112} />
        <Node palette={azurePalette} x={222} y={112} />
        <Node palette={azurePalette} x={222} y={180} />
        <Node palette={azurePalette} x={160} y={216} />
        <g style={riskStyle(3400)}>
          <circle cx={222} cy={112} fill={palette.warning} r={12} />
          <path d="M 213 112 H 231 M 222 103 V 121" stroke={palette.frame} strokeLinecap="round" strokeWidth={4} />
        </g>
        <g style={riskStyle(6200)}>
          <circle cx={160} cy={216} fill={palette.accent} r={18} />
          <path d="M 146 216 H 174 M 160 202 V 230" stroke={palette.frame} strokeLinecap="round" strokeWidth={5} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function OpenAIInfraPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const aiPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const animationDelay = `${timing.delayS(1400)}s`;
  const pathStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-ai-path ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    opacity: timing.prefersReducedMotion ? 0.95 : undefined,
    strokeDashoffset: timing.prefersReducedMotion ? -280 : undefined,
  } as CSSProperties;
  const riskStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion ? "none" : `ti-ai-risk ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 0.95 : 0.16,
      transformBox: "fill-box",
      transformOrigin: "center",
    }) as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-ai-path {
            0%, 16%, 100% { opacity: 0.16; stroke-dashoffset: 0; }
            34%, 68% { opacity: 0.95; stroke-dashoffset: -280; }
            82% { opacity: 0.28; stroke-dashoffset: -280; }
          }

          @keyframes ti-ai-risk {
            0%, 20%, 100% { opacity: 0.16; transform: scale(0.9); }
            30%, 72% { opacity: 1; transform: scale(1.08); }
            84% { opacity: 0.34; transform: scale(1); }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        <rect fill={palette.frame} height={72} rx={12} stroke={aiPalette.edge} strokeWidth={7} width={94} x={113} y={44} />
        <Line d="M 130 68 H 190 M 130 92 H 190" opacity={0.72} palette={aiPalette} tone="muted" width={4} />
        <Node palette={aiPalette} x={160} y={80} />
        <rect fill={palette.frame} height={54} rx={9} stroke={aiPalette.edge} strokeWidth={6} width={78} x={44} y={154} />
        <rect fill={palette.frame} height={54} rx={9} stroke={aiPalette.edge} strokeWidth={6} width={78} x={198} y={154} />
        <rect fill={palette.frame} height={48} rx={9} stroke={aiPalette.edge} strokeWidth={6} width={72} x={124} y={226} />
        <Line d={pointsPath([[160, 116], [83, 154], [83, 181], [160, 226]])} opacity={0.32} palette={aiPalette} tone="muted" width={4} />
        <Line d={pointsPath([[160, 116], [237, 154], [237, 181], [160, 226]])} opacity={0.32} palette={aiPalette} tone="muted" width={4} />
        <path
          d={pointsPath([[83, 181], [120, 142], [160, 80], [200, 142], [237, 181], [160, 250]])}
          fill="none"
          stroke={palette.accent}
          strokeDasharray="44 280"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={6}
          style={pathStyle}
        />
        <Line d="M 58 181 H 108 M 212 181 H 262 M 140 250 H 180" opacity={0.72} palette={aiPalette} tone="muted" width={4} />
        <Node palette={aiPalette} x={83} y={181} />
        <Node palette={aiPalette} x={237} y={181} />
        <Node palette={aiPalette} x={160} y={250} />
        <g style={riskStyle(2600)}>
          <circle cx={83} cy={181} fill={palette.warning} r={12} />
          <path d="M 74 181 H 92 M 83 172 V 190" stroke={palette.frame} strokeLinecap="round" strokeWidth={4} />
        </g>
        <g style={riskStyle(5600)}>
          <circle cx={237} cy={181} fill={palette.accent} r={14} />
          <path d="M 226 181 H 248 M 237 170 V 192" stroke={palette.frame} strokeLinecap="round" strokeWidth={4.5} />
        </g>
        <g style={riskStyle(8200)}>
          <circle cx={160} cy={250} fill={palette.accent} r={18} />
          <path d="M 146 250 H 174 M 160 236 V 264" stroke={palette.frame} strokeLinecap="round" strokeWidth={5} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function GamingIsolationPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const gamingPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const animationDelay = `${timing.delayS(1200)}s`;
  const attemptStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-gaming-attempt ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    opacity: timing.prefersReducedMotion ? 0.86 : undefined,
  } as CSSProperties;
  const barrierStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-gaming-barrier ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
  } as CSSProperties;
  const blockedDotStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-gaming-blocked-dot ${timing.cycleS}s ease-in-out ${animationDelay} infinite`,
    opacity: timing.prefersReducedMotion ? 1 : undefined,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-gaming-attempt {
            0%, 16%, 100% { opacity: 0.18; }
            34%, 58% { opacity: 0.95; }
            72% { opacity: 0.3; }
          }

          @keyframes ti-gaming-barrier {
            0%, 20%, 100% { opacity: 0.62; }
            38%, 62% { opacity: 1; }
          }

          @keyframes ti-gaming-blocked-dot {
            0%, 24%, 100% { opacity: 0; }
            38%, 64% { opacity: 1; }
            76% { opacity: 0.24; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.12) translate(-160 -160)">
        <rect fill={palette.frame} height={152} rx={10} stroke={gamingPalette.edge} strokeWidth={7} width={92} x={202} y={84} />
        <Line d="M 160 58 V 262" opacity={0.72} palette={gamingPalette} tone="muted" width={5} />
        <path
          d="M 160 58 V 262"
          fill="none"
          stroke={palette.accent}
          strokeDasharray="10 13"
          strokeLinecap="round"
          strokeWidth={5}
          style={barrierStyle}
        />

        <g transform="translate(34 67) scale(0.47)">
          <path
            d="M 24 170 C 31 136, 58 122, 88 128 C 98 130, 101 135, 106 135 H 114 C 119 135, 122 130, 132 128 C 162 122, 189 136, 196 170 L 207 200 C 216 228, 194 246, 170 236 C 154 230, 142 214, 132 198 L 125 187 H 95 L 88 198 C 78 214, 66 230, 50 236 C 26 246, 4 228, 13 200 Z"
            fill={palette.frame}
            stroke={gamingPalette.edge}
            strokeLinejoin="round"
            strokeWidth={7}
          />
          <Line d="M 52 176 H 86 M 69 159 V 193" opacity={0.9} palette={gamingPalette} tone="muted" width={7} />
          <circle cx={151} cy={166} fill={gamingPalette.node} r={8} />
          <circle cx={173} cy={184} fill={gamingPalette.muted} r={8} />
          <circle cx={173} cy={148} fill={gamingPalette.muted} r={8} />
        </g>
        <Node palette={palette} tone="warning" x={102} y={136} />

        <path
          d={pointsPath([
            [102, 136],
            [124, 150],
            [142, 160],
            [151, 160],
          ])}
          fill="none"
          stroke={palette.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={6}
          style={attemptStyle}
        />
        <g style={blockedDotStyle}>
          <Line d="M 151 151 L 169 169 M 169 151 L 151 169" palette={palette} tone="accent" width={5} />
        </g>

        <Box fillOpacity={0.04} height={34} palette={gamingPalette} strokeTone="edge" width={50} x={224} y={110} />
        <Box fillOpacity={0.04} height={34} palette={gamingPalette} strokeTone="edge" width={50} x={224} y={156} />
        <Box fillOpacity={0.04} height={34} palette={gamingPalette} strokeTone="edge" width={50} x={224} y={202} />
        <Line d="M 236 127 H 262 M 236 173 H 262 M 236 219 H 262" opacity={0.72} palette={gamingPalette} tone="muted" width={4} />
        <Node palette={gamingPalette} x={249} y={127} />
        <Node palette={gamingPalette} x={249} y={173} />
        <Node palette={gamingPalette} x={249} y={219} />
      </g>
    </PictogramSvg>
  );
}

function SensitiveDataEstatePictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const estatePalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const copyStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-estate-copy ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 1 : 0.14,
    }) as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-estate-copy {
            0%, 12% { opacity: 0.14; transform: translate(-8px, 0); }
            26% { opacity: 1; transform: translate(0, 0); }
            80% { opacity: 1; transform: translate(0, 0); }
            94%, 100% { opacity: 0.14; transform: translate(-8px, 0); }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* Governed source: database cylinder, calm */}
        <path
          d="M 52 106 C 52 92, 124 92, 124 106 V 214 C 124 228, 52 228, 52 214 Z"
          fill={palette.frame}
          stroke={estatePalette.edge}
          strokeWidth={6}
        />
        <path d="M 52 106 C 52 120, 124 120, 124 106" fill="none" stroke={estatePalette.muted} strokeWidth={5} />
        <path d="M 52 160 C 52 174, 124 174, 124 160" fill="none" stroke={estatePalette.muted} strokeWidth={5} />
        <Node palette={estatePalette} x={88} y={196} />
        {/* Drift lines from source to derivatives */}
        <Line d="M 128 128 C 152 118, 164 104, 182 96" dashArray="3 9" opacity={0.55} palette={estatePalette} tone="muted" width={4} />
        <Line d="M 128 162 C 152 162, 166 166, 186 168" dashArray="3 9" opacity={0.55} palette={estatePalette} tone="muted" width={4} />
        <Line d="M 128 196 C 152 206, 162 220, 180 232" dashArray="3 9" opacity={0.55} palette={estatePalette} tone="muted" width={4} />
        {/* Derivative: notebook page */}
        <g style={copyStyle(1400)}>
          <path
            d="M 192 58 H 248 L 268 78 V 130 H 192 Z"
            fill={palette.frame}
            stroke={palette.accent}
            strokeLinejoin="round"
            strokeWidth={5}
          />
          <path d="M 248 58 V 78 H 268" fill="none" stroke={palette.accent} strokeWidth={4} />
          <Line d="M 206 88 H 252 M 206 104 H 252" opacity={0.75} palette={estatePalette} tone="muted" width={4} />
        </g>
        {/* Derivative: log lines */}
        <g style={copyStyle(2900)}>
          <path d="M 196 150 H 276 V 190 H 196 Z" fill={palette.frame} stroke={palette.accent} strokeLinejoin="round" strokeWidth={5} />
          <Line d="M 206 162 H 240 M 206 178 H 262" opacity={0.75} palette={estatePalette} tone="muted" width={4} />
        </g>
        {/* Derivative: vector cluster */}
        <g style={copyStyle(4400)}>
          <Line d={pointsPath([[204, 262], [232, 244], [258, 262], [232, 278], [204, 262]])} opacity={0.8} palette={palette} tone="accent" width={4} />
          <Node palette={palette} r={6} tone="accent" x={204} y={262} />
          <Node palette={palette} r={6} tone="accent" x={232} y={244} />
          <Node palette={palette} r={6} tone="accent" x={258} y={262} />
          <Node palette={palette} r={6} tone="accent" x={232} y={278} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function LessonsCheckedPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const lessonsPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const burstStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-lessons-burst ${timing.cycleS}s ease-in-out ${timing.delayS()}s infinite`,
    opacity: timing.prefersReducedMotion ? 0.55 : 1,
  } as CSSProperties;
  const tickStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-lessons-tick ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 1 : 0.1,
    }) as CSSProperties;
  const burstRays = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const inner = 20;
    const outer = 34;
    return `M ${78 + Math.cos(rad) * inner} ${120 + Math.sin(rad) * inner} L ${78 + Math.cos(rad) * outer} ${120 + Math.sin(rad) * outer}`;
  });

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-lessons-burst {
            0%, 20% { opacity: 1; }
            42%, 78% { opacity: 0.35; }
            94%, 100% { opacity: 1; }
          }

          @keyframes ti-lessons-tick {
            0%, 18% { opacity: 0.1; transform: scale(0.85); }
            30% { opacity: 1; transform: scale(1.08); }
            38%, 84% { opacity: 1; transform: scale(1); }
            96%, 100% { opacity: 0.1; transform: scale(0.85); }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.12) translate(-160 -160)">
        {/* Incident burst */}
        <g style={burstStyle}>
          <circle cx={78} cy={120} fill={palette.frame} r={17} stroke={palette.accent} strokeWidth={6} />
          {burstRays.map((d) => (
            <Line d={d} key={d} palette={palette} tone="accent" width={5} />
          ))}
        </g>
        {/* Lesson flowing into the checklist */}
        <Line d={arrowPath(120, 120, 168, 120, 11)} palette={lessonsPalette} width={6} />
        {/* Checklist */}
        <path d="M 182 60 H 282 V 262 H 182 Z" fill={palette.frame} stroke={lessonsPalette.edge} strokeLinejoin="round" strokeWidth={6} />
        <Line d="M 206 60 V 48 H 258 V 60" opacity={0.8} palette={lessonsPalette} tone="muted" width={5} />
        {[
          { y: 104, offset: 2200 },
          { y: 160, offset: 3800 },
          { y: 216, offset: 5400 },
        ].map((row) => (
          <g key={row.y}>
            <rect fill="none" height={26} rx={6} stroke={lessonsPalette.edge} strokeWidth={5} width={26} x={198} y={row.y - 13} />
            <Line d={`M 238 ${row.y} H 268`} opacity={0.7} palette={lessonsPalette} tone="muted" width={5} />
            <g style={{ ...tickStyle(row.offset), transformBox: "view-box", transformOrigin: `211px ${row.y}px` } as CSSProperties}>
              <Line d={`M 202 ${row.y} L 209 ${row.y + 8} L 222 ${row.y - 9}`} palette={palette} tone="accent" width={5} />
            </g>
          </g>
        ))}
      </g>
    </PictogramSvg>
  );
}

function KnowledgeBasePictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const kbPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const joinStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-kb-join ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 1 : 0.12,
    }) as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-kb-join {
            0%, 16% { opacity: 0.12; }
            32% { opacity: 1; }
            84% { opacity: 1; }
            96%, 100% { opacity: 0.12; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* Document above the floor */}
        <path d="M 118 44 H 186 L 204 62 V 116 H 118 Z" fill={palette.frame} stroke={kbPalette.edge} strokeLinejoin="round" strokeWidth={6} />
        <path d="M 186 44 V 62 H 204" fill="none" stroke={kbPalette.muted} strokeWidth={4} />
        <Line d="M 132 76 H 190 M 132 94 H 176" opacity={0.72} palette={kbPalette} tone="muted" width={4} />
        {/* Newsroom floor */}
        <Line d="M 40 132 H 280" palette={kbPalette} width={6} />
        {/* Knowledge graph beneath, holding the work up */}
        <Line d={pointsPath([[70, 196], [136, 242]])} opacity={0.75} palette={kbPalette} tone="muted" width={4} />
        <Line d={pointsPath([[136, 242], [112, 286]])} opacity={0.75} palette={kbPalette} tone="muted" width={4} />
        <Line d={pointsPath([[136, 242], [258, 250]])} opacity={0.75} palette={kbPalette} tone="muted" width={4} />
        <Node palette={kbPalette} r={9} x={70} y={196} />
        <Node palette={kbPalette} r={9} x={136} y={242} />
        <Node palette={kbPalette} r={9} x={258} y={250} />
        <Node palette={kbPalette} r={9} x={112} y={286} />
        {/* New node joins the graph and its context rises into the document */}
        <g style={joinStyle(1600)}>
          <Line d={pointsPath([[136, 242], [206, 186]])} palette={palette} tone="accent" width={4} />
          <Line d={pointsPath([[206, 186], [258, 250]])} palette={palette} tone="accent" width={4} />
          <Line d={pointsPath([[206, 186], [70, 196]])} opacity={0.7} palette={palette} tone="accent" width={4} />
          <Node glow palette={palette} r={11} tone="accent" x={206} y={186} />
        </g>
        <g style={joinStyle(3600)}>
          <Line d="M 206 182 C 204 160, 190 142, 176 120" dashArray="4 10" palette={palette} tone="accent" width={5} />
          <Node palette={palette} r={6} tone="accent" x={176} y={116} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function SignalsPipelinePictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const pipePalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const packetStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pipe-packet ${timing.cycleS}s ease-in-out ${timing.delayS(800)}s infinite`,
    transform: timing.prefersReducedMotion ? "translate(216px, 0)" : undefined,
  } as CSSProperties;
  const stampStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pipe-stamp ${timing.cycleS}s ease-in-out ${timing.delayS(800)}s infinite`,
    opacity: timing.prefersReducedMotion ? 1 : 0.15,
  } as CSSProperties;
  const stations = [
    { x: 52, glyph: "M 44 152 A 10 10 0 1 1 44 172 A 10 10 0 1 1 44 152 M 61 179 L 70 188" },
    { x: 124, glyph: "M 112 154 H 136 M 112 164 H 136 M 112 174 H 128" },
    { x: 196, glyph: "M 184 178 L 204 150 L 210 154 L 190 182 L 183 184 Z" },
    { x: 268, glyph: "M 256 164 L 265 174 L 281 152" },
  ];

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-pipe-packet {
            0%, 10% { transform: translate(0, 0); opacity: 1; }
            26% { transform: translate(72px, 0); opacity: 1; }
            30% { transform: translate(72px, 0); }
            46% { transform: translate(144px, 0); }
            50% { transform: translate(144px, 0); }
            66%, 82% { transform: translate(216px, 0); opacity: 1; }
            92%, 100% { transform: translate(216px, 0); opacity: 0; }
          }

          @keyframes ti-pipe-stamp {
            0%, 62% { opacity: 0.15; }
            70%, 88% { opacity: 1; }
            98%, 100% { opacity: 0.15; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.13) translate(-160 -166)">
        {stations.map((station, index) => (
          <g key={station.x}>
            <circle cx={station.x} cy={166} fill={palette.frame} r={28} stroke={pipePalette.edge} strokeWidth={6} />
            <Line
              d={station.glyph}
              opacity={index === 3 ? 0.95 : 0.78}
              palette={index === 3 ? palette : pipePalette}
              tone={index === 3 ? "accent" : "muted"}
              width={4}
            />
            {index < 3 ? <Line d={arrowPath(station.x + 32, 166, station.x + 40, 166, 8)} palette={pipePalette} width={5} /> : null}
          </g>
        ))}
        {/* The packet handed station to station */}
        <g style={packetStyle}>
          <rect fill={palette.accent} height={16} rx={4} width={16} x={44} y={116} />
          <Line d="M 52 132 V 144" opacity={0.7} palette={palette} tone="accent" width={4} />
        </g>
        {/* Shipped with a check */}
        <g style={stampStyle}>
          <circle cx={268} cy={116} fill="none" r={15} stroke={palette.accent} strokeWidth={5} />
          <Line d="M 260 116 L 266 123 L 277 109" palette={palette} tone="accent" width={5} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function FindingsPipelinePictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const stackPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const fallStyle = (offsetMs: number, dx: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-stack-fall ${timing.cycleS}s ease-in ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 0.85 : 0,
      transform: timing.prefersReducedMotion ? "translate(0, 34px)" : `translate(${dx}px, 0)`,
    }) as CSSProperties;
  const slotStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-stack-slot ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 1 : 0.15,
    }) as CSSProperties;
  const closeStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-stack-close ${timing.cycleS}s ease-in-out ${timing.delayS(7200)}s infinite`,
    opacity: timing.prefersReducedMotion ? 1 : 0.12,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-stack-fall {
            0%, 8% { opacity: 0; transform: translate(0, 0); }
            16% { opacity: 0.9; transform: translate(0, 10px); }
            30% { opacity: 0.9; transform: translate(0, 34px); }
            38%, 100% { opacity: 0; transform: translate(0, 34px); }
          }

          @keyframes ti-stack-slot {
            0%, 22% { opacity: 0.15; }
            34%, 82% { opacity: 1; }
            94%, 100% { opacity: 0.15; }
          }

          @keyframes ti-stack-close {
            0%, 40% { opacity: 0.12; }
            52%, 84% { opacity: 1; }
            96%, 100% { opacity: 0.12; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* Scattered findings */}
        {[
          { x: 96, y: 52, offset: 0 },
          { x: 148, y: 40, offset: 900 },
          { x: 204, y: 54, offset: 1800 },
          { x: 124, y: 72, offset: 2700 },
          { x: 178, y: 76, offset: 3600 },
        ].map((dot) => (
          <g key={`${dot.x}-${dot.y}`} style={fallStyle(dot.offset, 0)}>
            <Node palette={stackPalette} r={7} tone="muted" x={dot.x} y={dot.y} />
          </g>
        ))}
        {/* Funnel */}
        <Line d={pointsPath([[72, 96], [248, 96], [178, 158], [178, 190], [142, 190], [142, 158], [72, 96]])} palette={stackPalette} width={6} />
        {/* Ordered queue */}
        {[
          { x: 92, offset: 4400 },
          { x: 148, offset: 5400 },
          { x: 204, offset: 6400 },
        ].map((slot, index) => (
          <g key={slot.x}>
            <rect fill={palette.frame} height={38} rx={8} stroke={stackPalette.edge} strokeWidth={5} width={44} x={slot.x - 22} y={214} />
            <g style={slotStyle(slot.offset)}>
              <Node palette={palette} r={8} tone={index === 0 ? "accent" : "warning"} x={slot.x} y={233} />
            </g>
          </g>
        ))}
        {/* Owner takes the first item to closure */}
        <g style={closeStyle}>
          <Line d={arrowPath(238, 233, 262, 233, 8)} palette={palette} tone="accent" width={5} />
          <circle cx={282} cy={226} fill="none" r={11} stroke={stackPalette.edge} strokeWidth={5} />
          <path d="M 268 254 C 268 242, 296 242, 296 254" fill="none" stroke={stackPalette.edge} strokeLinecap="round" strokeWidth={5} />
          <Line d="M 276 226 L 281 231 L 289 220" palette={palette} tone="accent" width={4} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function S3PiiDiscoveryPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const piiPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const lensStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pii-lens ${timing.cycleS}s ease-in-out ${timing.delayS()}s infinite`,
    transform: timing.prefersReducedMotion ? "translate(118px, 62px)" : undefined,
  } as CSSProperties;
  const hitStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pii-hit ${timing.cycleS}s ease-in-out ${timing.delayS()}s infinite`,
    opacity: timing.prefersReducedMotion ? 1 : 0.1,
  } as CSSProperties;
  const bucketShape = (x: number, y: number, stroke: string) => (
    <path
      d={`M ${x - 24} ${y - 16} C ${x - 24} ${y - 28}, ${x + 24} ${y - 28}, ${x + 24} ${y - 16} V ${y + 18} C ${x + 24} ${y + 30}, ${x - 24} ${y + 30}, ${x - 24} ${y + 18} Z`}
      fill={palette.frame}
      stroke={stroke}
      strokeLinejoin="round"
      strokeWidth={5}
    />
  );

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-pii-lens {
            0%, 8% { transform: translate(0, 0); }
            30% { transform: translate(118px, 0); }
            52% { transform: translate(0, 62px); }
            74%, 88% { transform: translate(118px, 62px); }
            100% { transform: translate(0, 0); }
          }

          @keyframes ti-pii-hit {
            0%, 66% { opacity: 0.1; }
            76%, 90% { opacity: 1; }
            100% { opacity: 0.1; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {[
          { x: 92, y: 92 },
          { x: 160, y: 92 },
          { x: 228, y: 92 },
          { x: 92, y: 176 },
          { x: 160, y: 176 },
        ].map((bucket) => (
          <g key={`${bucket.x}-${bucket.y}`}>
            {bucketShape(bucket.x, bucket.y, piiPalette.edge)}
            <Node palette={piiPalette} tone="muted" x={bucket.x} y={bucket.y + 4} />
          </g>
        ))}
        {/* The one bucket where sensitivity and reachability overlap */}
        <g style={hitStyle}>
          {bucketShape(228, 176, palette.accent)}
          <Node glow palette={palette} r={7} tone="accent" x={228} y={180} />
          <Line d="M 216 156 H 240" opacity={0.9} palette={palette} tone="accent" width={4} />
        </g>
        {/* Sweeping lens */}
        <g style={lensStyle}>
          <circle cx={110} cy={114} fill="none" r={34} stroke={piiPalette.edge} strokeWidth={7} />
          <Line d="M 134 138 L 158 162" palette={piiPalette} width={8} />
        </g>
        {/* Shelf line */}
        <Line d="M 56 246 H 264" opacity={0.6} palette={piiPalette} tone="muted" width={5} />
      </g>
    </PictogramSvg>
  );
}

function PrivilegeExpiryPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const pimPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const arcCircumference = 2 * Math.PI * 92;
  const arcStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pim-arc ${timing.cycleS}s linear ${timing.delayS()}s infinite`,
    strokeDashoffset: timing.prefersReducedMotion ? arcCircumference * 0.72 : undefined,
  } as CSSProperties;
  const keyStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pim-key ${timing.cycleS}s ease-in-out ${timing.delayS()}s infinite`,
    opacity: timing.prefersReducedMotion ? 0.55 : undefined,
  } as CSSProperties;
  const approveStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-pim-approve ${timing.cycleS}s ease-in-out ${timing.delayS()}s infinite`,
    opacity: timing.prefersReducedMotion ? 1 : 0,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-pim-arc {
            0%, 10% { stroke-dashoffset: 0; }
            72% { stroke-dashoffset: ${Math.round(arcCircumference)}px; }
            100% { stroke-dashoffset: ${Math.round(arcCircumference)}px; }
          }

          @keyframes ti-pim-key {
            0%, 64% { opacity: 1; }
            74%, 88% { opacity: 0.28; }
            100% { opacity: 1; }
          }

          @keyframes ti-pim-approve {
            0%, 80% { opacity: 0; }
            88%, 96% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.12) translate(-160 -160)">
        {/* Timer ring: muted track + accent countdown */}
        <circle cx={160} cy={160} fill="none" opacity={0.4} r={92} stroke={pimPalette.muted} strokeWidth={7} />
        <circle
          cx={160}
          cy={160}
          fill="none"
          r={92}
          stroke={palette.accent}
          strokeDasharray={arcCircumference}
          strokeLinecap="round"
          strokeWidth={7}
          style={arcStyle}
          transform="rotate(-90 160 160)"
        />
        {/* The key that expires */}
        <g style={keyStyle}>
          <circle cx={126} cy={136} fill={palette.frame} r={26} stroke={pimPalette.edge} strokeWidth={7} />
          <circle cx={126} cy={136} fill="none" r={9} stroke={pimPalette.muted} strokeWidth={5} />
          <Line d="M 146 156 L 202 212" palette={pimPalette} width={9} />
          <Line d="M 178 188 L 194 172" palette={pimPalette} width={8} />
          <Line d="M 196 206 L 214 188" palette={pimPalette} width={8} />
        </g>
        {/* Deliberate re-activation: brief approval check */}
        <g style={approveStyle}>
          <circle cx={226} cy={104} fill={palette.frame} r={20} stroke={palette.accent} strokeWidth={5} />
          <Line d="M 216 104 L 223 112 L 237 96" palette={palette} tone="accent" width={5} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function AzureDataPathsPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const pathPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const routeLength = 300;
  const routeStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-azdata-route ${timing.cycleS}s ease-in-out ${timing.delayS(1000)}s infinite`,
    strokeDashoffset: timing.prefersReducedMotion ? 0 : routeLength,
  } as CSSProperties;
  const reachStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-azdata-reach ${timing.cycleS}s ease-in-out ${timing.delayS(1000)}s infinite`,
    opacity: timing.prefersReducedMotion ? 1 : 0.12,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-azdata-route {
            0%, 10% { stroke-dashoffset: ${routeLength}px; }
            44% { stroke-dashoffset: 0; }
            84% { stroke-dashoffset: 0; }
            96%, 100% { stroke-dashoffset: ${routeLength}px; }
          }

          @keyframes ti-azdata-reach {
            0%, 40% { opacity: 0.12; }
            52%, 84% { opacity: 1; }
            96%, 100% { opacity: 0.12; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* Identity */}
        <circle cx={62} cy={120} fill={palette.frame} r={20} stroke={pathPalette.edge} strokeWidth={6} />
        <path d="M 40 168 C 40 146, 84 146, 84 168" fill="none" stroke={pathPalette.edge} strokeLinecap="round" strokeWidth={6} />
        {/* Gate posts along the route */}
        {[136, 196].map((x) => (
          <g key={x}>
            <Line d={`M ${x} 128 V 196`} palette={pathPalette} width={6} />
            <Line d={`M ${x + 22} 128 V 196`} palette={pathPalette} width={6} />
            <Line d={`M ${x} 138 H ${x + 22}`} opacity={0.7} palette={pathPalette} tone="muted" width={4} />
          </g>
        ))}
        {/* Route from identity through the gates to the data */}
        <Line d="M 84 156 C 110 168, 118 162, 147 162 L 207 162 C 228 162, 234 168, 250 172" opacity={0.4} palette={pathPalette} tone="muted" width={5} />
        <path
          d="M 84 156 C 110 168, 118 162, 147 162 L 207 162 C 228 162, 234 168, 250 172"
          fill="none"
          stroke={palette.accent}
          strokeDasharray={routeLength}
          strokeLinecap="round"
          strokeWidth={5}
          style={routeStyle}
        />
        {/* Classified data store: labeled cylinder */}
        <path
          d="M 236 148 C 236 136, 296 136, 296 148 V 224 C 296 236, 236 236, 236 224 Z"
          fill={palette.frame}
          stroke={pathPalette.edge}
          strokeWidth={6}
        />
        <path d="M 236 148 C 236 160, 296 160, 296 148" fill="none" stroke={pathPalette.muted} strokeWidth={4} />
        {/* Classification tag */}
        <g style={reachStyle}>
          <path d="M 252 96 H 292 L 302 108 L 292 120 H 252 Z" fill={palette.frame} stroke={palette.accent} strokeLinejoin="round" strokeWidth={5} />
          <Node palette={palette} r={4.5} tone="accent" x={262} y={108} />
          <Line d="M 268 132 V 138" dashArray="2 6" opacity={0.8} palette={palette} tone="accent" width={4} />
          <Node glow palette={palette} r={7} tone="accent" x={266} y={192} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function KeyScopePictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const keyPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const sprawlStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-keys-sprawl ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 0.2 : 0.8,
    }) as CSSProperties;
  const keptStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-keys-kept ${timing.cycleS}s ease-in-out ${timing.delayS()}s infinite`,
    opacity: timing.prefersReducedMotion ? 1 : 0.45,
  } as CSSProperties;
  const jobs = [
    { y: 64, kept: false, offset: 3600 },
    { y: 128, kept: true, offset: 0 },
    { y: 192, kept: false, offset: 4600 },
    { y: 256, kept: false, offset: 5600 },
  ];

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-keys-sprawl {
            0%, 26% { opacity: 0.8; }
            44%, 88% { opacity: 0.12; }
            100% { opacity: 0.8; }
          }

          @keyframes ti-keys-kept {
            0%, 30% { opacity: 0.45; }
            52%, 90% { opacity: 1; }
            100% { opacity: 0.45; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* The key */}
        <circle cx={70} cy={160} fill={palette.frame} r={28} stroke={keyPalette.edge} strokeWidth={7} />
        <circle cx={70} cy={160} fill="none" r={10} stroke={keyPalette.muted} strokeWidth={5} />
        <Line d="M 96 160 H 122" palette={keyPalette} width={8} />
        <Line d="M 112 160 V 174 M 122 160 V 170" palette={keyPalette} width={6} />
        {/* Its jobs */}
        {jobs.map((job) => (
          <g key={job.y} style={job.kept ? undefined : sprawlStyle(job.offset)}>
            <path
              d={`M 126 160 C 158 160, 168 ${job.y + 22}, 196 ${job.y + 22}`}
              fill="none"
              stroke={job.kept ? palette.accent : keyPalette.muted}
              strokeDasharray={job.kept ? undefined : "5 9"}
              strokeLinecap="round"
              strokeWidth={job.kept ? 6 : 4}
              style={job.kept ? keptStyle : undefined}
            />
            <rect
              fill={palette.frame}
              height={44}
              rx={9}
              stroke={job.kept ? palette.accent : keyPalette.edge}
              strokeWidth={job.kept ? 6 : 5}
              width={64}
              x={196}
              y={job.y}
            />
            <Line
              d={`M 208 ${job.y + 16} H 248 M 208 ${job.y + 29} H 236`}
              opacity={0.72}
              palette={keyPalette}
              tone="muted"
              width={4}
            />
          </g>
        ))}
        {/* One job, one owner */}
        <g style={keptStyle}>
          <Node glow palette={palette} r={7} tone="accent" x={228} y={150} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function ConnectorGovernancePictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const appsPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const approveStyle = (offsetMs: number) =>
    ({
      animation: timing.prefersReducedMotion
        ? "none"
        : `ti-apps-approve ${timing.cycleS}s ease-in-out ${timing.delayS(offsetMs)}s infinite`,
      opacity: timing.prefersReducedMotion ? 1 : 0.25,
    }) as CSSProperties;
  const denyStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-apps-deny ${timing.cycleS}s ease-in-out ${timing.delayS(4200)}s infinite`,
    opacity: timing.prefersReducedMotion ? 0.3 : 0.7,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-apps-approve {
            0%, 18% { opacity: 0.25; }
            34%, 86% { opacity: 1; }
            98%, 100% { opacity: 0.25; }
          }

          @keyframes ti-apps-deny {
            0%, 26% { opacity: 0.7; }
            42%, 90% { opacity: 0.14; }
            100% { opacity: 0.7; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* Chat surface */}
        <path
          d="M 46 96 H 158 C 168 96, 174 102, 174 112 V 176 C 174 186, 168 192, 158 192 H 96 L 68 216 V 192 H 62 C 52 192, 46 186, 46 176 V 112 C 46 102, 52 96, 62 96 Z"
          fill={palette.frame}
          stroke={appsPalette.edge}
          strokeLinejoin="round"
          strokeWidth={6}
        />
        <Line d="M 66 128 H 152 M 66 150 H 136" opacity={0.72} palette={appsPalette} tone="muted" width={5} />
        {/* Gates and connected systems */}
        {[
          { y: 84, offset: 1200, approved: true, glyph: "M 246 76 L 258 68 L 270 76 V 96 H 246 Z" },
          { y: 156, offset: 2600, approved: true, glyph: "M 246 144 H 268 V 172 H 246 Z M 252 152 H 262 M 252 160 H 262" },
          { y: 228, offset: 0, approved: false, glyph: "M 246 216 H 270 V 242 H 246 Z M 246 224 H 270 M 252 212 V 218 M 264 212 V 218" },
        ].map((connection) => (
          <g key={connection.y} style={connection.approved ? approveStyle(connection.offset) : denyStyle}>
            <path
              d={`M 178 144 C 200 144, 202 ${connection.y + 8}, 216 ${connection.y + 8}`}
              fill="none"
              stroke={connection.approved ? palette.accent : appsPalette.muted}
              strokeDasharray={connection.approved ? undefined : "5 9"}
              strokeLinecap="round"
              strokeWidth={5}
            />
            {/* Gate valve on the line */}
            <rect
              fill={palette.frame}
              height={22}
              rx={5}
              stroke={connection.approved ? palette.accent : appsPalette.edge}
              strokeWidth={5}
              width={22}
              x={205}
              y={connection.y - 3}
            />
            {connection.approved ? (
              <Line d={`M 210 ${connection.y + 8} L 215 ${connection.y + 13} L 224 ${connection.y + 2}`} palette={palette} tone="accent" width={4} />
            ) : (
              <Line d={`M 210 ${connection.y + 2} L 222 ${connection.y + 14} M 222 ${connection.y + 2} L 210 ${connection.y + 14}`} palette={appsPalette} tone="muted" width={4} />
            )}
            <Line d={connection.glyph} opacity={0.85} palette={appsPalette} width={5} />
          </g>
        ))}
      </g>
    </PictogramSvg>
  );
}

function AccountSeparationPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const acctPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const sparkStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-accts-spark ${timing.cycleS}s ease-in ${timing.delayS(1000)}s infinite`,
    opacity: timing.prefersReducedMotion ? 0 : 0,
    transform: timing.prefersReducedMotion ? "translate(46px, 0)" : undefined,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-accts-spark {
            0%, 14% { opacity: 0; transform: translate(0, 0) scale(1); }
            22% { opacity: 1; transform: translate(18px, 0) scale(1); }
            36% { opacity: 1; transform: translate(46px, 0) scale(1); }
            44% { opacity: 0.4; transform: translate(50px, 0) scale(1.5); }
            50%, 100% { opacity: 0; transform: translate(50px, 0) scale(0.4); }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.12) translate(-160 -160)">
        {/* Gaming identity */}
        <circle cx={84} cy={140} fill={palette.frame} r={52} stroke={acctPalette.edge} strokeWidth={7} />
        <rect fill="none" height={30} rx={14} stroke={acctPalette.muted} strokeWidth={5} width={58} x={55} y={126} />
        <Node palette={acctPalette} tone="muted" x={68} y={141} />
        <Line d="M 96 136 V 146 M 91 141 H 101" opacity={0.85} palette={acctPalette} tone="muted" width={4} />
        {/* Real-life identity */}
        <circle cx={236} cy={140} fill={palette.frame} r={52} stroke={acctPalette.edge} strokeWidth={7} />
        <path d="M 210 128 H 262 V 158 H 210 Z" fill="none" stroke={acctPalette.muted} strokeLinejoin="round" strokeWidth={5} />
        <path d="M 210 130 L 236 146 L 262 130" fill="none" stroke={acctPalette.muted} strokeLinejoin="round" strokeWidth={4} />
        {/* The bridge that isn't there */}
        <Line d="M 142 140 H 154" opacity={0.6} palette={acctPalette} tone="muted" width={5} />
        <Line d="M 166 140 H 178" dashArray="2 10" opacity={0.35} palette={acctPalette} tone="muted" width={5} />
        {/* Attacker spark dies at the gap */}
        <g style={sparkStyle}>
          <Node glow palette={palette} r={8} tone="accent" x={140} y={140} />
        </g>
        {/* Separate keys, separate lives */}
        <g>
          <circle cx={70} cy={232} fill="none" r={11} stroke={acctPalette.edge} strokeWidth={5} />
          <Line d="M 80 240 L 102 258 M 94 254 L 100 247" palette={acctPalette} width={5} />
        </g>
        <g>
          <circle cx={222} cy={232} fill="none" r={11} stroke={acctPalette.edge} strokeWidth={5} />
          <Line d="M 232 240 L 254 258 M 246 254 L 252 247" palette={acctPalette} width={5} />
        </g>
      </g>
    </PictogramSvg>
  );
}

function UntrustedModPictogram({ alt, palette, timing }: RegisteredPictogramProps) {
  const modPalette = {
    ...palette,
    edge: "var(--foreground-strong)",
    node: "var(--foreground-strong)",
    muted: "color-mix(in srgb, var(--foreground-strong) 54%, var(--background) 46%)",
  };
  const pieceStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-mods-drop ${timing.cycleS}s ease-in-out ${timing.delayS(600)}s infinite`,
    transform: timing.prefersReducedMotion ? "translate(0, 96px)" : undefined,
  } as CSSProperties;
  const zoneStyle = {
    animation: timing.prefersReducedMotion ? "none" : `ti-mods-zone ${timing.cycleS}s ease-in-out ${timing.delayS(600)}s infinite`,
    opacity: timing.prefersReducedMotion ? 0.9 : 0.5,
  } as CSSProperties;

  return (
    <PictogramSvg alt={alt} viewBox="0 0 320 320">
      <style>
        {`
          @keyframes ti-mods-drop {
            0%, 12% { transform: translate(0, 0); }
            38% { transform: translate(0, 96px); }
            84% { transform: translate(0, 96px); }
            96%, 100% { transform: translate(0, 0); }
          }

          @keyframes ti-mods-zone {
            0%, 30% { opacity: 0.5; }
            42%, 84% { opacity: 1; }
            96%, 100% { opacity: 0.5; }
          }
        `}
      </style>
      <g transform="translate(160 160) scale(1.1) translate(-160 -160)">
        {/* The mod: puzzle piece descending */}
        <g style={pieceStyle}>
          <path
            d="M 130 62 H 152 C 150 48, 170 48, 168 62 H 190 V 84 C 204 82, 204 102, 190 92 V 114 H 130 V 92 C 116 102, 116 82, 130 84 Z"
            fill={palette.frame}
            stroke={modPalette.edge}
            strokeLinejoin="round"
            strokeWidth={6}
          />
          <Line d="M 148 88 H 172" opacity={0.7} palette={modPalette} tone="muted" width={4} />
        </g>
        {/* Quarantine zone, willing to be rebuilt */}
        <g style={zoneStyle}>
          <rect
            fill="none"
            height={110}
            rx={16}
            stroke={palette.accent}
            strokeDasharray="14 12"
            strokeWidth={6}
            width={168}
            x={76}
            y={168}
          />
        </g>
        {/* The slot inside the sandbox */}
        <Line d="M 108 226 H 130 M 190 226 H 212" opacity={0.6} palette={modPalette} tone="muted" width={5} />
        <Line d="M 130 226 V 246 H 190 V 226" opacity={0.6} palette={modPalette} tone="muted" width={5} />
        {/* Everything irreplaceable stays outside */}
        <g>
          <path d="M 262 236 H 296 V 262 H 262 Z" fill="none" stroke={modPalette.muted} strokeLinejoin="round" strokeWidth={5} />
          <path d="M 270 236 V 228 C 270 218, 288 218, 288 228 V 236" fill="none" stroke={modPalette.muted} strokeLinecap="round" strokeWidth={5} />
        </g>
      </g>
    </PictogramSvg>
  );
}

export const THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY: Record<ThreatIntelligencePictogramSlug, PictogramRegistryEntry> = {
  "the-balance-of-power-is-shifting": { aspectRatio: 1, render: BalanceShiftPictogram },
  "how-our-newsroom-learns": { aspectRatio: 1, render: NewsroomFlowPictogram },
  "audit-aws-exposure-before-attackers-do": { aspectRatio: 1, render: AwsDiscoveryPictogram },
  "audit-azure-blast-radius-before-attackers-do": { aspectRatio: 1, render: AzureBlastRadiusPictogram },
  "treat-openai-accounts-like-production-infrastructure": { aspectRatio: 1, render: OpenAIInfraPictogram },
  "how-to-play-games-securely": { aspectRatio: 1, render: GamingIsolationPictogram },
  "the-new-sensitive-data-estate": { aspectRatio: 1, render: SensitiveDataEstatePictogram },
  "from-lessons-learned-to-defenses-checked": { aspectRatio: 1, render: LessonsCheckedPictogram },
  "the-knowledge-base-beneath-the-newsroom": { aspectRatio: 1, render: KnowledgeBasePictogram },
  "from-signals-to-practical-advice": { aspectRatio: 1, render: SignalsPipelinePictogram },
  "build-the-aws-exposure-control-stack": { aspectRatio: 1, render: FindingsPipelinePictogram },
  "find-pii-risk-in-s3-buckets": { aspectRatio: 1, render: S3PiiDiscoveryPictogram },
  "make-azure-privilege-temporary": { aspectRatio: 1, render: PrivilegeExpiryPictogram },
  "find-sensitive-data-paths-in-azure": { aspectRatio: 1, render: AzureDataPathsPictogram },
  "shrink-openai-api-key-blast-radius": { aspectRatio: 1, render: KeyScopePictogram },
  "control-chatgpt-workspace-access-and-connected-data": { aspectRatio: 1, render: ConnectorGovernancePictogram },
  "separate-game-accounts-from-real-life": { aspectRatio: 1, render: AccountSeparationPictogram },
  "treat-mods-and-launchers-like-untrusted-code": { aspectRatio: 1, render: UntrustedModPictogram },
};

export function getPictogramRegistryEntry(slug: ThreatIntelligencePictogramSlug): PictogramRegistryEntry {
  return THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY[slug];
}
