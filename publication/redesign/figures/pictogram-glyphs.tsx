import type { ReactNode } from "react";

export const PICTOGRAM_PLATE_VIEWBOX_WIDTH = 720;
export const PICTOGRAM_PLATE_VIEWBOX_HEIGHT = 360;

export const PICTOGRAM_STROKE = {
  ghost: 1.25,
  connector: 1.25,
  object: 1.5,
  signal: 2,
  signalHeavy: 2.5,
  structure: 3,
} as const;

export const PICTOGRAM_RADIUS = { node: 8, hub: 10, zone: 14 } as const;

export const PICTOGRAM_DASH = { boundary: "5 4", zone: "6 4", newKnowledge: "4 3" } as const;

export type PictogramLabelSize = "label" | "annotation";

export function PictogramLabel({
  x,
  y,
  children,
  size = "label",
  tone = "text",
  anchor = "middle",
  className = "",
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: PictogramLabelSize;
  tone?: "text" | "muted" | "ghost" | "signal" | "on-signal";
  anchor?: "start" | "middle" | "end";
  className?: string;
}) {
  const toneClassName = {
    text: "f-text",
    muted: "f-muted",
    ghost: "f-ghost",
    signal: "f-signal",
    "on-signal": "f-on",
  }[tone];
  return (
    <text
      className={`pictogram-label pictogram-label--${size} ${toneClassName} ${className}`.trim()}
      textAnchor={anchor}
      x={x}
      y={y}
    >
      {children}
    </text>
  );
}

export function ArrowheadMarkerDefinition({ markerId, tone }: { markerId: string; tone: "line" | "signal" }) {
  return (
    <marker
      id={markerId}
      markerHeight="7"
      markerWidth="7"
      orient="auto-start-reverse"
      refX="9"
      refY="5"
      viewBox="0 0 10 10"
    >
      <path className={tone === "signal" ? "f-signal" : "f-line"} d="M0 0 L10 5 L0 10 z" />
    </marker>
  );
}

export function IdentityGlyph({
  centerX,
  topY,
  tone = "line",
  strokeWidth = PICTOGRAM_STROKE.object,
  className = "",
}: {
  centerX: number;
  topY: number;
  tone?: "line" | "ghost" | "signal";
  strokeWidth?: number;
  className?: string;
}) {
  const strokeClassName = { line: "s-line", ghost: "s-ghost", signal: "s-signal" }[tone];
  return (
    <g className={`f-none ${strokeClassName} ${className}`.trim()} strokeWidth={strokeWidth}>
      <circle cx={centerX} cy={topY + 9} r="9" />
      <path d={`M${centerX - 16} ${topY + 41} Q${centerX} ${topY + 17} ${centerX + 16} ${topY + 41}`} />
    </g>
  );
}

export function NodeGlyph({
  x,
  y,
  width,
  height,
  label,
  tone = "line",
  className = "",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: ReactNode;
  tone?: "line" | "muted" | "ghost" | "signal";
  className?: string;
}) {
  const strokeClassName = { line: "s-line", muted: "s-muted", ghost: "s-ghost", signal: "s-signal" }[tone];
  const strokeWidth = tone === "signal" ? PICTOGRAM_STROKE.signalHeavy : tone === "ghost" ? PICTOGRAM_STROKE.ghost : PICTOGRAM_STROKE.object;
  return (
    <g className={className || undefined}>
      <rect className={`f-fill ${strokeClassName}`} height={height} rx={PICTOGRAM_RADIUS.node} strokeWidth={strokeWidth} width={width} x={x} y={y} />
      {label ? (
        <PictogramLabel tone={tone === "ghost" ? "ghost" : "text"} x={x + width / 2} y={y + height / 2 + 4}>
          {label}
        </PictogramLabel>
      ) : null}
    </g>
  );
}

export function HubGlyph({
  x,
  y,
  width,
  height,
  label,
  className = "",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: ReactNode;
  className?: string;
}) {
  return (
    <g className={className || undefined}>
      <rect className="f-signal" height={height} rx={PICTOGRAM_RADIUS.hub} width={width} x={x} y={y} />
      <PictogramLabel className="pictogram-label--hub" tone="on-signal" x={x + width / 2} y={y + height / 2 + 4}>
        {label}
      </PictogramLabel>
    </g>
  );
}

export function bucketBodyPath(centerX: number, topY: number, radiusX: number, bodyHeight: number, radiusY: number): string {
  return `M${centerX - radiusX} ${topY} v${bodyHeight} a${radiusX} ${radiusY} 0 0 0 ${radiusX * 2} 0 v-${bodyHeight}`;
}

export function BucketGlyph({
  centerX,
  topY,
  radiusX = 18,
  radiusY = 6,
  bodyHeight = 30,
  emphasis = "quiet",
  className = "",
}: {
  centerX: number;
  topY: number;
  radiusX?: number;
  radiusY?: number;
  bodyHeight?: number;
  emphasis?: "quiet" | "sensitive" | "exposed";
  className?: string;
}) {
  const groupClassName = {
    quiet: "f-fill s-muted",
    sensitive: "f-signal-soft s-signal",
    exposed: "f-signal s-signal",
  }[emphasis];
  const strokeWidth = emphasis === "quiet" ? PICTOGRAM_STROKE.ghost : 1.75;
  return (
    <g className={`${groupClassName} ${className}`.trim()} strokeWidth={strokeWidth}>
      <path d={bucketBodyPath(centerX, topY, radiusX, bodyHeight, radiusY)} />
      <ellipse cx={centerX} cy={topY} rx={radiusX} ry={radiusY} />
    </g>
  );
}

export function SensitiveDataGlyph({
  centerX,
  topY,
  radiusX = 36,
  radiusY = 9,
  bodyHeight = 44,
  lidClassName = "",
}: {
  centerX: number;
  topY: number;
  radiusX?: number;
  radiusY?: number;
  bodyHeight?: number;
  lidClassName?: string;
}) {
  return (
    <g strokeWidth={PICTOGRAM_STROKE.object}>
      <path className="f-fill s-line" d={bucketBodyPath(centerX, topY, radiusX, bodyHeight, radiusY)} />
      <ellipse className={`f-signal s-line ${lidClassName}`.trim()} cx={centerX} cy={topY} rx={radiusX} ry={radiusY} />
    </g>
  );
}

export function KeyGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g className="f-none s-line" strokeLinecap="round" strokeWidth={PICTOGRAM_STROKE.object}>
      <circle cx={x + 12} cy={y} r="12" />
      <path d={`M${x + 24} ${y} H${x + 64} M${x + 52} ${y} V${y + 10} M${x + 60} ${y} V${y + 8}`} />
    </g>
  );
}

export function SeparationWallGlyph({ x, topY, height }: { x: number; topY: number; height: number }) {
  return <rect className="f-line" height={height} rx="3" width="12" x={x} y={topY} />;
}

export function BoundaryGlyph({ x, topY, bottomY, label }: { x: number; topY: number; bottomY: number; label?: ReactNode }) {
  return (
    <g>
      <line
        className="s-boundary"
        strokeDasharray={PICTOGRAM_DASH.boundary}
        strokeWidth={PICTOGRAM_STROKE.ghost}
        x1={x}
        x2={x}
        y1={topY}
        y2={bottomY}
      />
      {label ? (
        <PictogramLabel anchor="start" size="annotation" tone="muted" x={x + 10} y={topY + 8}>
          {label}
        </PictogramLabel>
      ) : null}
    </g>
  );
}

export function BlockedMarkGlyph({ centerX, centerY, className = "" }: { centerX: number; centerY: number; className?: string }) {
  return (
    <g className={`s-signal ${className}`.trim()} strokeLinecap="round" strokeWidth={PICTOGRAM_STROKE.signalHeavy}>
      <line x1={centerX - 8} x2={centerX + 8} y1={centerY - 8} y2={centerY + 8} />
      <line x1={centerX + 8} x2={centerX - 8} y1={centerY - 8} y2={centerY + 8} />
    </g>
  );
}
