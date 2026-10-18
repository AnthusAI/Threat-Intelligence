"use client";

import { useId, type ReactElement, type ReactNode } from "react";
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

export type CanonicalFigureProps = { accessibleDescription: string };

function useUniqueMarkerId(markerPurpose: string): string {
  return `${markerPurpose}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function PictogramSvgCanvas({
  accessibleDescription,
  viewBoxHeight = 360,
  children,
}: {
  accessibleDescription: string;
  viewBoxHeight?: number;
  children: ReactNode;
}) {
  return (
    <svg aria-label={accessibleDescription} className="pictogram-canvas" role="img" viewBox={`0 0 720 ${viewBoxHeight}`}>
      {children}
    </svg>
  );
}

const ATTACKER_POSITIONS_X = [122, 141, 160, 179, 198, 217, 236];

export function BalanceOfPowerFigure({ accessibleDescription }: CanonicalFigureProps) {
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription} viewBoxHeight={380}>
      <line className="s-ghost" strokeWidth={PICTOGRAM_STROKE.object} x1="80" x2="640" y1="330" y2="330" />
      <polygon className="f-fill s-line" points="325,330 395,330 360,250" strokeWidth={PICTOGRAM_STROKE.object} />
      <g className="figure-balance__beam">
        <line className="s-line" strokeLinecap="round" strokeWidth={PICTOGRAM_STROKE.structure} x1="150" x2="570" y1="279" y2="221" />
      </g>
      <circle className="f-line" cx="360" cy="250" r="4" />
      <g className="figure-balance__many-attempts-pan">
        <path className="f-none s-muted" d="M180 275 V284 M110 284 H250 M110 284 V318 M250 284 V318" strokeWidth="1" />
        <line className="s-line" strokeWidth={PICTOGRAM_STROKE.signalHeavy} x1="100" x2="260" y1="318" y2="318" />
        <g className="f-signal figure-balance__attempts">
          {ATTACKER_POSITIONS_X.map((attackerX) => (
            <g key={attackerX}>
              <circle cx={attackerX} cy="301" r="5" />
              <path d={`M${attackerX - 6} 317 Q${attackerX} 303 ${attackerX + 6} 317 Z`} />
            </g>
          ))}
        </g>
      </g>
      <g className="figure-balance__rare-adversary-pan">
        <path className="f-none s-muted" d="M540 225 V232 M495 232 H585 M495 232 V272 M585 232 V272" strokeWidth="1" />
        <line className="s-line" strokeWidth={PICTOGRAM_STROKE.signalHeavy} x1="485" x2="595" y1="272" y2="272" />
        <circle className="f-text" cx="540" cy="248" r="9" />
        <path className="f-text" d="M526 271 Q540 246 554 271 Z" />
      </g>
      <PictogramLabel tone="muted" x={180} y={356}>MANY CHEAP ATTEMPTS</PictogramLabel>
      <PictogramLabel tone="muted" x={540} y={298}>ONE RARE, CAPABLE ADVERSARY</PictogramLabel>
    </PictogramSvgCanvas>
  );
}

export function NewsroomLearningLoopFigure({ accessibleDescription }: CanonicalFigureProps) {
  const arrowMarkerId = useUniqueMarkerId("newsroom-arrow");
  const pipelineStages = [
    { x: 24, lines: ["EXPERT", "STEERING"] },
    { x: 208, lines: ["AI RESEARCH", "LOOPS"] },
    { x: 392, lines: ["KNOWLEDGE", "GRAPH"] },
  ];
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription}>
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
        className="s-signal motion-arrive"
        strokeDasharray={PICTOGRAM_DASH.newKnowledge}
        strokeWidth={PICTOGRAM_STROKE.object}
        x1="488"
        x2="526"
        y1="266"
        y2="298"
      />
      <g className="f-fill s-line" strokeWidth={PICTOGRAM_STROKE.object}>
        <circle cx="452" cy="244" r="6" />
        <circle cx="416" cy="266" r="6" />
        <circle cx="488" cy="266" r="6" />
        <circle cx="452" cy="292" r="6" />
      </g>
      <circle className="f-signal motion-arrive" cx="526" cy="298" r="6" />
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
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription}>
      <PictogramLabel anchor="start" tone="muted" x={62} y={46}>ACCOUNT A</PictogramLabel>
      <PictogramLabel anchor="start" tone="muted" x={382} y={46}>ACCOUNT B</PictogramLabel>
      <line className="s-boundary" strokeDasharray="3 4" strokeWidth="1" x1="362" x2="362" y1="30" y2="330" />
      {AWS_QUIET_BUCKET_POSITIONS.map(([centerX, topY]) => (
        <BucketGlyph centerX={centerX} emphasis="quiet" key={`${centerX}-${topY}`} topY={topY} />
      ))}
      {AWS_SENSITIVE_BUCKET_POSITIONS.map(([centerX, topY]) => (
        <BucketGlyph centerX={centerX} emphasis="sensitive" key={`${centerX}-${topY}`} topY={topY} />
      ))}
      <BucketGlyph centerX={480} className="motion-lit" emphasis="exposed" topY={170} />
      <path
        className="f-none s-signal motion-travel"
        d="M24 316 H440 V186 H452"
        pathLength={100}
        strokeLinejoin="round"
        strokeWidth={PICTOGRAM_STROKE.signal}
      />
      <path className="f-signal motion-arrive" d="M450 180 L461 186 L450 192 z" />
      <PictogramLabel anchor="start" size="annotation" tone="muted" x={28} y={340}>
        IDENTITY + DATA + KEY POLICY + LOGGING GAPS LINE UP
      </PictogramLabel>
    </PictogramSvgCanvas>
  );
}

export function AzureIdentityAttackPathFigure({ accessibleDescription }: CanonicalFigureProps) {
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription}>
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
        className="f-none s-signal motion-travel"
        d="M92 180 H600"
        pathLength={100}
        strokeWidth={PICTOGRAM_STROKE.signal}
      />
      <IdentityGlyph centerX={70} strokeWidth={PICTOGRAM_STROKE.signal} tone="signal" topY={157} />
      <PictogramLabel size="annotation" x={70} y={222}>IDENTITY</PictogramLabel>
      <NodeGlyph height={44} label="WORKLOAD" width={130} x={170} y={158} />
      <NodeGlyph height={44} label="SUBSCRIPTION" width={140} x={410} y={158} />
      <SensitiveDataGlyph centerX={640} lidClassName="motion-lit" topY={160} />
      <PictogramLabel size="annotation" x={640} y={238}>SENSITIVE DATA</PictogramLabel>
      <g className="f-signal motion-arrive">
        <path d="M157 174 L168 180 L157 186 z" />
        <path d="M397 174 L408 180 L397 186 z" />
        <path d="M591 174 L602 180 L591 186 z" />
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
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription}>
      <g className="s-muted" strokeWidth={PICTOGRAM_STROKE.connector}>
        {CONTROL_PLANE_CONNECTED_RESOURCES.map((resource) => (
          <path className="f-none motion-travel" d={resource.connectorPath} key={resource.label} pathLength={100} />
        ))}
        <line className="motion-march" strokeDasharray="4 5" x1="440" x2="530" y1="198" y2="290" />
      </g>
      {CONTROL_PLANE_CONNECTED_RESOURCES.map((resource) => (
        <NodeGlyph height={36} key={resource.label} label={resource.label} width={150} x={resource.boxX} y={resource.boxY} />
      ))}
      <NodeGlyph height={36} label="AUDIT SIGNALS" width={150} x={530} y={272} />
      <HubGlyph className="motion-lit" height={68} label="CONTROL PLANE" width={160} x={280} y={146} />
    </PictogramSvgCanvas>
  );
}

export function GamingBlastRadiusFigure({ accessibleDescription }: CanonicalFigureProps) {
  return (
    <PictogramSvgCanvas accessibleDescription={accessibleDescription}>
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
      <path className="f-none s-signal motion-travel" d="M262 192 H336" pathLength={100} strokeWidth={PICTOGRAM_STROKE.signal} />
      <BlockedMarkGlyph centerX={350} centerY={192} className="motion-arrive" />
      <SeparationWallGlyph height={280} topY={40} x={370} />
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
