"use client";

import { useId, useRef, type ReactElement, type ReactNode, type RefObject } from "react";
import {
  ArrowheadMarkerDefinition,
  BlockedMarkGlyph,
  BoundaryGlyph,
  BucketGlyph,
  HubGlyph,
  IdentityGlyph,
  NodeGlyph,
  PICTOGRAM_DASH,
  PICTOGRAM_STROKE,
  PictogramLabel,
  SensitiveDataGlyph,
  SeparationWallGlyph,
} from "./pictogram-glyphs";
import { BalanceOfPowerFigure } from "./balance-of-power-figure";
import {
  ESTABLISH_ENDS_AT_MILLISECONDS,
  RESOLVE_ENDS_AT_MILLISECONDS,
  TRAVEL_ENDS_AT_MILLISECONDS,
  drawPathUpTo,
  easeOut,
  easeSignalTravel,
  findChoreographedElements,
  placeSignalHeadOnPath,
  popIn,
  progressBetween,
  scaleAboutPoint,
  signalFadeOpacityAt,
  usePictogramChoreography,
} from "./pictogram-choreography";

export type CanonicalFigureProps = { accessibleDescription: string };

function useUniqueMarkerId(markerPurpose: string): string {
  return `${markerPurpose}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function PictogramSvgCanvas({
  accessibleDescription,
  canvasReference,
  viewBoxHeight = 360,
  children,
}: {
  accessibleDescription: string;
  canvasReference?: RefObject<SVGSVGElement | null>;
  viewBoxHeight?: number;
  children: ReactNode;
}) {
  return (
    <svg aria-label={accessibleDescription} className="pictogram-canvas" ref={canvasReference} role="img" viewBox={`0 0 720 ${viewBoxHeight}`}>
      {children}
    </svg>
  );
}

const SIGNAL_TRAVEL_DURATION_MILLISECONDS = TRAVEL_ENDS_AT_MILLISECONDS - ESTABLISH_ENDS_AT_MILLISECONDS;
const RESOLVE_DURATION_MILLISECONDS = RESOLVE_ENDS_AT_MILLISECONDS - TRAVEL_ENDS_AT_MILLISECONDS;
const SIGNAL_HEAD_RADIUS = 4.5;
const TARGET_PULSE_DURATION_MILLISECONDS = 700;
const UNLIT_FILL_OPACITY = 0.15;

function signalTravelShareAt(loopTimeMilliseconds: number): number {
  return easeSignalTravel(progressBetween(loopTimeMilliseconds, ESTABLISH_ENDS_AT_MILLISECONDS, SIGNAL_TRAVEL_DURATION_MILLISECONDS));
}

function loopTimeWhenSignalReaches(travelShare: number): number {
  let earliest = ESTABLISH_ENDS_AT_MILLISECONDS;
  let latest = TRAVEL_ENDS_AT_MILLISECONDS;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const middle = (earliest + latest) / 2;
    if (signalTravelShareAt(middle) < travelShare) earliest = middle;
    else latest = middle;
  }
  return latest;
}

function choreographSignalTravel(canvas: SVGSVGElement, loopTimeMilliseconds: number): number {
  const travelShare = signalTravelShareAt(loopTimeMilliseconds);
  const fadeOpacity = signalFadeOpacityAt(loopTimeMilliseconds);
  findChoreographedElements<SVGPathElement>(canvas, "signal-path").forEach((signalPath) => {
    drawPathUpTo(signalPath, travelShare);
    signalPath.style.opacity = `${fadeOpacity}`;
    findChoreographedElements<SVGCircleElement>(canvas, "signal-head").forEach((signalHead) =>
      placeSignalHeadOnPath(signalHead, signalPath, travelShare, travelShare > 0 && travelShare < 0.995),
    );
  });
  return fadeOpacity;
}

function choreographTargetArrival(canvas: SVGSVGElement, loopTimeMilliseconds: number, fadeOpacity: number) {
  const lightProgress = easeOut(progressBetween(loopTimeMilliseconds, TRAVEL_ENDS_AT_MILLISECONDS - 40, RESOLVE_DURATION_MILLISECONDS));
  canvas.querySelectorAll<SVGElement>('[data-motion="target"], .figure-motion-target').forEach((target) => {
    target.style.fillOpacity = `${UNLIT_FILL_OPACITY + (1 - UNLIT_FILL_OPACITY) * lightProgress * fadeOpacity}`;
  });
  const pulseProgress = progressBetween(loopTimeMilliseconds, TRAVEL_ENDS_AT_MILLISECONDS - 40, TARGET_PULSE_DURATION_MILLISECONDS);
  findChoreographedElements<SVGEllipseElement>(canvas, "target-pulse").forEach((targetPulse) => {
    const centerX = Number(targetPulse.getAttribute("cx"));
    const centerY = Number(targetPulse.getAttribute("cy"));
    scaleAboutPoint(targetPulse, 1 + easeOut(pulseProgress) * 0.9, centerX, centerY);
    targetPulse.style.opacity = pulseProgress > 0 && pulseProgress < 1 ? `${0.7 * (1 - pulseProgress)}` : "0";
  });
}

function choreographArrivalMarks(canvas: SVGSVGElement, loopTimeMilliseconds: number, fadeOpacity: number) {
  findChoreographedElements<SVGGraphicsElement>(canvas, "arrival-mark").forEach((arrivalMark) => {
    const reachedAtShare = Number(arrivalMark.dataset.reachedAtShare ?? "1");
    const reachedAt = loopTimeWhenSignalReaches(reachedAtShare);
    popIn(arrivalMark, progressBetween(loopTimeMilliseconds, reachedAt - 30, RESOLVE_DURATION_MILLISECONDS), fadeOpacity);
  });
}

function choreographTravelToTarget(canvas: SVGSVGElement, loopTimeMilliseconds: number) {
  const fadeOpacity = choreographSignalTravel(canvas, loopTimeMilliseconds);
  choreographArrivalMarks(canvas, loopTimeMilliseconds, fadeOpacity);
  choreographTargetArrival(canvas, loopTimeMilliseconds, fadeOpacity);
}

const NEW_KNOWLEDGE_LINK_START = { x: 488, y: 266 };
const NEW_KNOWLEDGE_NODE_CENTER = { x: 526, y: 298 };

function choreographNewsroomLearningLoop(canvas: SVGSVGElement, loopTimeMilliseconds: number) {
  const fadeOpacity = signalFadeOpacityAt(loopTimeMilliseconds);
  const linkShare = signalTravelShareAt(loopTimeMilliseconds);
  findChoreographedElements<SVGLineElement>(canvas, "knowledge-link").forEach((knowledgeLink) => {
    knowledgeLink.setAttribute("x2", `${NEW_KNOWLEDGE_LINK_START.x + (NEW_KNOWLEDGE_NODE_CENTER.x - NEW_KNOWLEDGE_LINK_START.x) * linkShare}`);
    knowledgeLink.setAttribute("y2", `${NEW_KNOWLEDGE_LINK_START.y + (NEW_KNOWLEDGE_NODE_CENTER.y - NEW_KNOWLEDGE_LINK_START.y) * linkShare}`);
    knowledgeLink.style.opacity = `${linkShare > 0 ? fadeOpacity : 0}`;
  });
  choreographArrivalMarks(canvas, loopTimeMilliseconds, fadeOpacity);
}

const CONTROL_PLANE_CONNECTOR_STAGGER_MILLISECONDS = 150;
const CONTROL_PLANE_CONNECTOR_DRAW_MILLISECONDS = 640;

function choreographOpenAiControlPlane(canvas: SVGSVGElement, loopTimeMilliseconds: number) {
  const fadeOpacity = signalFadeOpacityAt(loopTimeMilliseconds);
  const connectors = findChoreographedElements<SVGPathElement>(canvas, "reach-connector");
  let reachGathered = 0;
  connectors.forEach((connector, connectorIndex) => {
    const drawStart = ESTABLISH_ENDS_AT_MILLISECONDS + connectorIndex * CONTROL_PLANE_CONNECTOR_STAGGER_MILLISECONDS;
    const drawnShare = easeSignalTravel(progressBetween(loopTimeMilliseconds, drawStart, CONTROL_PLANE_CONNECTOR_DRAW_MILLISECONDS));
    drawPathUpTo(connector, drawnShare);
    connector.style.opacity = `${fadeOpacity}`;
    reachGathered += easeOut(progressBetween(loopTimeMilliseconds, drawStart + CONTROL_PLANE_CONNECTOR_DRAW_MILLISECONDS * 0.7, 220));
  });
  const shareOfReachGathered = connectors.length ? reachGathered / connectors.length : 1;
  findChoreographedElements<SVGElement>(canvas, "target").forEach((controlPlane) => {
    controlPlane.style.fillOpacity = `${UNLIT_FILL_OPACITY + (1 - UNLIT_FILL_OPACITY) * shareOfReachGathered * fadeOpacity}`;
  });
  const lastConnectorArrives =
    ESTABLISH_ENDS_AT_MILLISECONDS + (connectors.length - 1) * CONTROL_PLANE_CONNECTOR_STAGGER_MILLISECONDS + CONTROL_PLANE_CONNECTOR_DRAW_MILLISECONDS;
  const settleProgress = progressBetween(loopTimeMilliseconds, lastConnectorArrives - 60, 420);
  findChoreographedElements<SVGGElement>(canvas, "control-plane").forEach((controlPlane) => {
    const swell = settleProgress > 0 && settleProgress < 1 ? Math.sin(Math.PI * settleProgress) * 0.045 : 0;
    scaleAboutPoint(controlPlane, 1 + swell, 360, 180);
  });
}

const CONTROL_WALL_SHAKE_DURATION_MILLISECONDS = 360;
const CONTROL_WALL_SHAKE_DISTANCE = 3;

function choreographGamingBlastRadius(canvas: SVGSVGElement, loopTimeMilliseconds: number) {
  const fadeOpacity = choreographSignalTravel(canvas, loopTimeMilliseconds);
  choreographArrivalMarks(canvas, loopTimeMilliseconds, fadeOpacity);
  const shakeProgress = progressBetween(loopTimeMilliseconds, TRAVEL_ENDS_AT_MILLISECONDS - 40, CONTROL_WALL_SHAKE_DURATION_MILLISECONDS);
  const shakeOffset =
    shakeProgress > 0 && shakeProgress < 1 ? CONTROL_WALL_SHAKE_DISTANCE * (1 - shakeProgress) * Math.sin(shakeProgress * Math.PI * 5) : 0;
  findChoreographedElements<SVGGElement>(canvas, "control-wall").forEach((controlWall) => {
    controlWall.setAttribute("transform", `translate(${shakeOffset.toFixed(2)} 0)`);
  });
}

function SignalHead() {
  return <circle className="f-signal" data-motion="signal-head" r={SIGNAL_HEAD_RADIUS} style={{ opacity: 0 }} />;
}

export function NewsroomLearningLoopFigure({ accessibleDescription }: CanonicalFigureProps) {
  const canvasReference = useRef<SVGSVGElement | null>(null);
  usePictogramChoreography(canvasReference, choreographNewsroomLearningLoop);
  const arrowMarkerId = useUniqueMarkerId("newsroom-arrow");
  const pipelineStages = [
    { x: 24, lines: ["EXPERT", "STEERING"] },
    { x: 208, lines: ["AI RESEARCH", "LOOPS"] },
    { x: 392, lines: ["KNOWLEDGE", "GRAPH"] },
  ];
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription} canvasReference={canvasReference}>
      <defs>
        <ArrowheadMarkerDefinition markerId={arrowMarkerId} tone="line" />
      </defs>
      {pipelineStages.map((stage) => (
        <rect className="f-fill s-line" height="72" key={stage.x} rx="8" strokeWidth={PICTOGRAM_STROKE.object} width="120" x={stage.x} y="140" />
      ))}
      <rect className="f-fill s-signal" height="72" rx="8" strokeWidth={PICTOGRAM_STROKE.signalHeavy} width="120" x="576" y="140" />
      <g className="s-line" strokeWidth={PICTOGRAM_STROKE.object}>
        <line markerEnd={`url(#${arrowMarkerId})`} x1="144" x2="204" y1="176" y2="176" />
        <line markerEnd={`url(#${arrowMarkerId})`} x1="328" x2="388" y1="176" y2="176" />
        <line markerEnd={`url(#${arrowMarkerId})`} x1="512" x2="572" y1="176" y2="176" />
      </g>
      <path
        className="f-none s-line motion-march"
        d="M240 136 A30 30 0 1 1 296 136"
        markerEnd={`url(#${arrowMarkerId})`}
        strokeDasharray="6 3"
        strokeWidth={PICTOGRAM_STROKE.object}
      />
      <PictogramLabel size="annotation" tone="muted" x={268} y={74}>CONTINUOUS</PictogramLabel>
      {pipelineStages.map((stage) => (
        <g key={`${stage.x}-label`}>
          <PictogramLabel x={stage.x + 60} y={172}>{stage.lines[0]}</PictogramLabel>
          <PictogramLabel x={stage.x + 60} y={188}>{stage.lines[1]}</PictogramLabel>
        </g>
      ))}
      <PictogramLabel x={636} y={172}>SECURITY</PictogramLabel>
      <PictogramLabel x={636} y={188}>GUIDANCE</PictogramLabel>
      <g className="s-muted" strokeWidth="1">
        <line x1="452" x2="452" y1="212" y2="244" />
        <line x1="416" x2="452" y1="266" y2="244" />
        <line x1="452" x2="488" y1="244" y2="266" />
        <line x1="416" x2="452" y1="266" y2="292" />
        <line x1="488" x2="452" y1="266" y2="292" />
        <line x1="452" x2="452" y1="244" y2="292" />
      </g>
      <line
        className="s-signal"
        data-motion="knowledge-link"
        strokeDasharray={PICTOGRAM_DASH.newKnowledge}
        strokeWidth={PICTOGRAM_STROKE.object}
        x1={NEW_KNOWLEDGE_LINK_START.x}
        x2={NEW_KNOWLEDGE_NODE_CENTER.x}
        y1={NEW_KNOWLEDGE_LINK_START.y}
        y2={NEW_KNOWLEDGE_NODE_CENTER.y}
      />
      <g className="f-fill s-line" strokeWidth={PICTOGRAM_STROKE.object}>
        <circle cx="452" cy="244" r="6" />
        <circle cx="416" cy="266" r="6" />
        <circle cx="488" cy="266" r="6" />
        <circle cx="452" cy="292" r="6" />
      </g>
      <circle className="f-signal" cx={NEW_KNOWLEDGE_NODE_CENTER.x} cy={NEW_KNOWLEDGE_NODE_CENTER.y} data-motion="arrival-mark" r="6" />
      <PictogramLabel size="annotation" tone="muted" x={452} y={330}>NEW NODE INHERITS CONTEXT</PictogramLabel>
    </PictogramSvgCanvas>
  );
}

const AWS_QUIET_BUCKET_POSITIONS: Array<[number, number]> = [
  [80, 90], [160, 90], [320, 90], [400, 90], [480, 90], [560, 90], [640, 90],
  [80, 170], [160, 170], [240, 170], [320, 170], [400, 170], [560, 170], [640, 170],
  [80, 250], [240, 250], [320, 250], [400, 250], [480, 250], [560, 250],
];
const AWS_SENSITIVE_BUCKET_POSITIONS: Array<[number, number]> = [[240, 90], [160, 250], [640, 250]];

export function AwsExposureQueueFigure({ accessibleDescription }: CanonicalFigureProps) {
  const canvasReference = useRef<SVGSVGElement | null>(null);
  usePictogramChoreography(canvasReference, choreographTravelToTarget);
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription} canvasReference={canvasReference}>
      <PictogramLabel anchor="start" tone="muted" x={62} y={46}>ACCOUNT A</PictogramLabel>
      <PictogramLabel anchor="start" tone="muted" x={382} y={46}>ACCOUNT B</PictogramLabel>
      <line className="s-boundary" strokeDasharray="3 4" strokeWidth="1" x1="362" x2="362" y1="30" y2="330" />
      {AWS_QUIET_BUCKET_POSITIONS.map(([centerX, topY]) => (
        <BucketGlyph centerX={centerX} emphasis="quiet" key={`${centerX}-${topY}`} topY={topY} />
      ))}
      {AWS_SENSITIVE_BUCKET_POSITIONS.map(([centerX, topY]) => (
        <BucketGlyph centerX={centerX} emphasis="sensitive" key={`${centerX}-${topY}`} topY={topY} />
      ))}
      <ellipse className="f-none s-signal" cx="480" cy="170" data-motion="target-pulse" rx="18" ry="6" strokeWidth={PICTOGRAM_STROKE.signal} style={{ opacity: 0 }} />
      <g data-motion="target">
        <BucketGlyph centerX={480} emphasis="exposed" topY={170} />
      </g>
      <path
        className="f-none s-signal"
        d="M24 316 H440 V186 H452"
        data-motion="signal-path"
        strokeLinejoin="round"
        strokeWidth={PICTOGRAM_STROKE.signal}
      />
      <SignalHead />
      <path className="f-signal" d="M450 180 L461 186 L450 192 z" data-motion="arrival-mark" />
      <PictogramLabel anchor="start" size="annotation" tone="muted" x={28} y={340}>
        IDENTITY + DATA + KEY POLICY + LOGGING GAPS LINE UP
      </PictogramLabel>
    </PictogramSvgCanvas>
  );
}

const AZURE_SIGNAL_PATH_START_X = 92;
const AZURE_SIGNAL_PATH_END_X = 600;

function shareOfAzurePathAt(pathX: number): number {
  return (pathX - AZURE_SIGNAL_PATH_START_X) / (AZURE_SIGNAL_PATH_END_X - AZURE_SIGNAL_PATH_START_X);
}

export function AzureIdentityAttackPathFigure({ accessibleDescription }: CanonicalFigureProps) {
  const canvasReference = useRef<SVGSVGElement | null>(null);
  usePictogramChoreography(canvasReference, choreographTravelToTarget);
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription} canvasReference={canvasReference}>
      <BoundaryGlyph bottomY={330} label="PRIVILEGE BOUNDARY" topY={56} x={360} />
      <IdentityGlyph centerX={70} strokeWidth={PICTOGRAM_STROKE.ghost} tone="ghost" topY={67} />
      <IdentityGlyph centerX={70} strokeWidth={PICTOGRAM_STROKE.ghost} tone="ghost" topY={247} />
      <g className="f-none s-ghost" strokeWidth={PICTOGRAM_STROKE.ghost}>
        <line x1="90" x2="170" y1="96" y2="168" />
        <line x1="90" x2="170" y1="272" y2="270" />
        <line x1="300" x2="348" y1="270" y2="270" />
        <line strokeWidth={PICTOGRAM_STROKE.signalHeavy} x1="348" x2="348" y1="260" y2="280" />
      </g>
      <NodeGlyph height={44} label="WORKLOAD" tone="ghost" width={130} x={170} y={248} />
      <path
        className="f-none s-signal"
        d={`M${AZURE_SIGNAL_PATH_START_X} 180 H${AZURE_SIGNAL_PATH_END_X}`}
        data-motion="signal-path"
        strokeWidth={PICTOGRAM_STROKE.signal}
      />
      <IdentityGlyph centerX={70} strokeWidth={PICTOGRAM_STROKE.signal} tone="signal" topY={157} />
      <PictogramLabel size="annotation" x={70} y={222}>IDENTITY</PictogramLabel>
      <NodeGlyph height={44} label="WORKLOAD" width={130} x={170} y={158} />
      <NodeGlyph height={44} label="SUBSCRIPTION" width={140} x={410} y={158} />
      <ellipse className="f-none s-signal" cx="640" cy="160" data-motion="target-pulse" rx="36" ry="9" strokeWidth={PICTOGRAM_STROKE.signal} style={{ opacity: 0 }} />
      <SensitiveDataGlyph centerX={640} lidClassName="figure-motion-target" topY={160} />
      <PictogramLabel size="annotation" x={640} y={238}>SENSITIVE DATA</PictogramLabel>
      <SignalHead />
      <g className="f-signal">
        <path d="M157 174 L168 180 L157 186 z" data-motion="arrival-mark" data-reached-at-share={shareOfAzurePathAt(168)} />
        <path d="M397 174 L408 180 L397 186 z" data-motion="arrival-mark" data-reached-at-share={shareOfAzurePathAt(408)} />
        <path d="M591 174 L602 180 L591 186 z" data-motion="arrival-mark" data-reached-at-share={1} />
      </g>
    </PictogramSvgCanvas>
  );
}

const CONTROL_PLANE_CONNECTED_RESOURCES = [
  { label: "PROJECTS", boxX: 40, boxY: 52, connectorPath: "M190 70 L280 162" },
  { label: "API KEYS", boxX: 40, boxY: 162, connectorPath: "M190 180 L280 180" },
  { label: "SERVICE ACCOUNTS", boxX: 40, boxY: 272, connectorPath: "M190 290 L280 198" },
  { label: "FILES", boxX: 530, boxY: 52, connectorPath: "M530 70 L440 162" },
  { label: "CONNECTORS", boxX: 530, boxY: 162, connectorPath: "M530 180 L440 180" },
];

export function OpenAiControlPlaneFigure({ accessibleDescription }: CanonicalFigureProps) {
  const canvasReference = useRef<SVGSVGElement | null>(null);
  usePictogramChoreography(canvasReference, choreographOpenAiControlPlane);
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription} canvasReference={canvasReference}>
      <g className="s-muted" strokeWidth={PICTOGRAM_STROKE.connector}>
        {CONTROL_PLANE_CONNECTED_RESOURCES.map((resource) => (
          <path className="f-none" d={resource.connectorPath} data-motion="reach-connector" key={resource.label} />
        ))}
        <line className="motion-march" strokeDasharray="4 5" x1="440" x2="530" y1="198" y2="290" />
      </g>
      {CONTROL_PLANE_CONNECTED_RESOURCES.map((resource) => (
        <NodeGlyph height={36} key={resource.label} label={resource.label} width={150} x={resource.boxX} y={resource.boxY} />
      ))}
      <NodeGlyph height={36} label="AUDIT SIGNALS" width={150} x={530} y={272} />
      <g data-motion="control-plane">
        <g data-motion="target">
          <HubGlyph height={68} label="CONTROL PLANE" width={160} x={280} y={146} />
        </g>
      </g>
    </PictogramSvgCanvas>
  );
}

export function GamingBlastRadiusFigure({ accessibleDescription }: CanonicalFigureProps) {
  const canvasReference = useRef<SVGSVGElement | null>(null);
  usePictogramChoreography(canvasReference, choreographGamingBlastRadius);
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription} canvasReference={canvasReference}>
      <rect
        className="f-none s-signal"
        height="264"
        rx="14"
        strokeDasharray={PICTOGRAM_DASH.zone}
        strokeWidth={PICTOGRAM_STROKE.object}
        width="300"
        x="32"
        y="48"
      />
      <PictogramLabel anchor="start" size="annotation" tone="signal" x={52} y={76}>GAMES · MODS · LAUNCHERS</PictogramLabel>
      <rect className="f-fill s-line" height="64" rx="32" strokeWidth="1.75" width="140" x="112" y="160" />
      <g className="s-line" strokeLinecap="round" strokeWidth={PICTOGRAM_STROKE.structure}>
        <line x1="146" x2="146" y1="181" y2="203" />
        <line x1="135" x2="157" y1="192" y2="192" />
      </g>
      <circle className="f-line" cx="214" cy="184" r="5" />
      <circle className="f-line" cx="230" cy="200" r="5" />
      <path className="f-none s-signal" d="M262 192 H336" data-motion="signal-path" strokeWidth={PICTOGRAM_STROKE.signal} />
      <SignalHead />
      <g data-motion="arrival-mark">
        <BlockedMarkGlyph centerX={350} centerY={192} />
      </g>
      <g data-motion="control-wall">
        <SeparationWallGlyph height={280} topY={40} x={370} />
      </g>
      <PictogramLabel size="annotation" tone="muted" x={376} y={344}>SEPARATION</PictogramLabel>
      <NodeGlyph height={52} label="BANKING" tone="muted" width={250} x={430} y={64} />
      <NodeGlyph height={52} label="WORK" tone="muted" width={250} x={430} y={154} />
      <NodeGlyph height={52} label="RECOVERY ACCOUNTS" tone="muted" width={250} x={430} y={244} />
    </PictogramSvgCanvas>
  );
}

export type CanonicalFigureEntry = {
  aspectRatio: number;
  render: (props: CanonicalFigureProps) => ReactElement;
  defaultAccessibleDescription: string;
};

export const CANONICAL_EDITION_FIGURES: Record<string, CanonicalFigureEntry> = {
  "the-balance-of-power-is-shifting": {
    aspectRatio: 720 / 380,
    render: BalanceOfPowerFigure,
    defaultAccessibleDescription:
      "A balance beam tilts toward many small attacker figures, outweighing one larger adversary on the other side",
  },
  "how-our-newsroom-learns": {
    aspectRatio: 2,
    render: NewsroomLearningLoopFigure,
    defaultAccessibleDescription:
      "A pipeline from expert steering through continuous AI research loops and a knowledge graph to security guidance",
  },
  "audit-aws-exposure-before-attackers-do": {
    aspectRatio: 2,
    render: AwsExposureQueueFigure,
    defaultAccessibleDescription:
      "A grid of S3 buckets across two accounts, with sensitive buckets highlighted and an exposure path reaching one of them",
  },
  "audit-azure-blast-radius-before-attackers-do": {
    aspectRatio: 2,
    render: AzureIdentityAttackPathFigure,
    defaultAccessibleDescription:
      "An attack path runs from an identity through a workload, across a privilege boundary, into a subscription and on to sensitive data",
  },
  "treat-openai-accounts-like-production-infrastructure": {
    aspectRatio: 2,
    render: OpenAiControlPlaneFigure,
    defaultAccessibleDescription:
      "A central control plane connected to projects, API keys, service accounts, files, connectors and audit signals",
  },
  "how-to-play-games-securely": {
    aspectRatio: 2,
    render: GamingBlastRadiusFigure,
    defaultAccessibleDescription:
      "A game controller inside its own dashed zone; a separating wall stops an attack before it reaches banking, work and recovery accounts",
  },
};
