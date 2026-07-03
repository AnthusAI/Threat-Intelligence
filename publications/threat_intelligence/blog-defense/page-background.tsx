"use client";

import { motion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BLOG_DEFENSE_CORE_NODE_ID,
  buildCompromiseSequenceFromPath,
  buildVisibleAttackPath,
  type BlogDefenseCompromiseStep,
} from "./graph";
import { layoutDefenseGraph, type LayoutDefenseNode, type LayoutRect } from "./layout";
import type { VerticalRhythm } from "../../../lib/blog-rhythm";
import { SITE_BRAND } from "../../../lib/site-brand";
import { PICTOGRAM_CYCLE_MS } from "../pictograms/registry";
import { useResolvedPapyrusTheme } from "../../../components/use-resolved-papyrus-theme";

const THROB_MS = 190;
const COMPROMISE_MS = 120;
const STEP_GAP_MS = 36;
const START_DELAY_MS = 40;
const COMPROMISE_TRANSITION_S = COMPROMISE_MS / 1000;
const THROB_TRANSITION_S = 0.21;
const BREACH_RING_DELAYS_S = [0, 0.6, 1.2];
const BREACH_RING_DURATION_S = 2.4;

type PictogramColors = {
  edge: string;
  node: string;
  throb: string;
  coreGlow: string;
  compromised: string;
  compromisedStroke: string;
};

const FALLBACK_COLORS: Record<"light" | "dark", PictogramColors> = {
  light: {
    edge: "var(--slate-8)",
    node: "var(--slate-8)",
    throb: "var(--tomato-8)",
    coreGlow: "var(--ti-alarm-red)",
    compromised: "var(--tomato-11)",
    compromisedStroke: "var(--sand-1)",
  },
  dark: {
    edge: "var(--slate-6)",
    node: "var(--slate-5)",
    throb: "var(--tomato-8)",
    coreGlow: "var(--ti-alarm-red)",
    compromised: "var(--tomato-9)",
    compromisedStroke: "var(--sand-2)",
  },
};

type Size = {
  width: number;
  height: number;
};

type BlogPageBackgroundProps = {
  headerObstacles?: LayoutRect[];
  pageRef: RefObject<HTMLElement | null>;
  rhythm: VerticalRhythm;
};

function readPictogramColors(container: HTMLElement): PictogramColors {
  const style = getComputedStyle(container);
  return {
    edge: style.getPropertyValue("--ti-pictogram-edge").trim() || FALLBACK_COLORS.light.edge,
    node: style.getPropertyValue("--ti-pictogram-node").trim() || FALLBACK_COLORS.light.node,
    throb: style.getPropertyValue("--ti-pictogram-throb").trim() || FALLBACK_COLORS.light.throb,
    coreGlow: style.getPropertyValue("--ti-pictogram-core-glow").trim() || FALLBACK_COLORS.light.coreGlow,
    compromised: style.getPropertyValue("--ti-pictogram-compromised").trim() || FALLBACK_COLORS.light.compromised,
    compromisedStroke: style.getPropertyValue("--ti-pictogram-compromised-stroke").trim() || FALLBACK_COLORS.light.compromisedStroke,
  };
}

function stepDurationMs(): number {
  return THROB_MS + COMPROMISE_MS + STEP_GAP_MS;
}

function isSameThrobStep(a: BlogDefenseCompromiseStep | null, b: BlogDefenseCompromiseStep | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.nodeId === b.nodeId;
  if (a.kind === "edge" && b.kind === "edge") return a.edgeId === b.edgeId;
  return false;
}

function CoreBreachEffect({
  coreNode,
  colors,
  filterId,
  prefersReducedMotion,
  scale,
  layer,
}: {
  coreNode: LayoutDefenseNode;
  colors: PictogramColors;
  filterId: string;
  prefersReducedMotion: boolean;
  scale: number;
  layer: "rings" | "halo";
}) {
  const ringStartRadius = coreNode.radius * 1.2;
  const ringEndRadius = coreNode.radius * 3;
  const haloRadius = coreNode.radius * 1.85;

  if (layer === "rings") {
    return (
      <g className="blog-page-background__breach-rings" style={{ color: colors.coreGlow }}>
        {BREACH_RING_DELAYS_S.map((delay) => (
          <motion.circle
            animate={
              prefersReducedMotion
                ? { fillOpacity: 0.22, r: ringEndRadius * 0.75 }
                : {
                    fillOpacity: [0.45, 0],
                    r: [ringStartRadius, ringEndRadius],
                  }
            }
            cx={coreNode.x}
            cy={coreNode.y}
            fill="currentColor"
            initial={false}
            key={`breach-ring-${delay}`}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : {
                    delay,
                    duration: BREACH_RING_DURATION_S,
                    ease: "easeOut",
                    repeat: Infinity,
                  }
            }
          />
        ))}
      </g>
    );
  }

  const blurStdDeviation = Math.max(5, scale * 0.45);
  return (
    <g className="blog-page-background__breach-halo" style={{ color: colors.coreGlow }}>
      <motion.circle
        animate={
          prefersReducedMotion
            ? { fillOpacity: 0.42, r: haloRadius }
            : {
                fillOpacity: [0.35, 0.7, 0.35],
                r: haloRadius,
              }
        }
        cx={coreNode.x}
        cy={coreNode.y}
        fill="currentColor"
        filter={`url(#${filterId})`}
        initial={false}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : {
                duration: BREACH_RING_DURATION_S,
                ease: "easeInOut",
                repeat: Infinity,
              }
        }
      />
      <defs>
        <filter height="300%" id={filterId} width="300%" x="-100%" y="-100%">
          <feGaussianBlur result="blur" stdDeviation={blurStdDeviation} />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </g>
  );
}

export function BlogPageBackground({ headerObstacles = [], pageRef, rhythm }: BlogPageBackgroundProps) {
  const svgId = useId().replace(/:/g, "-");
  const coreBreachFilterId = `${svgId}-core-breach-glow`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resolvedTheme = useResolvedPapyrusTheme();
  const [colors, setColors] = useState<PictogramColors>(FALLBACK_COLORS[resolvedTheme]);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [obstacles, setObstacles] = useState<LayoutRect[]>([]);
  const [enableStochasticPath] = useState(true);
  const [attackCycle, setAttackCycle] = useState(0);
  const [compromisedNodes, setCompromisedNodes] = useState<Set<string>>(() => new Set());
  const [compromisedEdges, setCompromisedEdges] = useState<Set<string>>(() => new Set());
  const [throbbingStep, setThrobbingStep] = useState<BlogDefenseCompromiseStep | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);
      if (width > 0 && height > 0) {
        setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
      }
      // headerObstacles are already tight to the measured text (see
      // useBlogHeaderObstacles); the per-check radius/inflate buffers in
      // layoutDefenseGraph provide the small remaining clearance, so no
      // extra padding is added here.
      setObstacles(headerObstacles);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [headerObstacles, rhythm.rowHeight]);

  useEffect(() => {
    if (!enableStochasticPath) return;
    const interval = window.setInterval(() => {
      setAttackCycle((current) => current + 1);
    }, PICTOGRAM_CYCLE_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [enableStochasticPath]);

  const graphLayout = useMemo(() => {
    if (!size.width || !size.height) return null;
    return layoutDefenseGraph({
      width: size.width,
      height: size.height,
      obstacles,
      rhythm,
    });
  }, [obstacles, rhythm, size.height, size.width]);

  const animationLayoutKey = `${size.width}:${size.height}`;
  const compromiseSequence = useMemo(() => {
    void attackCycle; // force recompute on attack cycle change
    if (!graphLayout) return [];
    const visiblePath = buildVisibleAttackPath({
      nodes: graphLayout.nodes,
      edges: graphLayout.edges,
      coreId: BLOG_DEFENSE_CORE_NODE_ID,
      stochastic: enableStochasticPath,
    });
    return buildCompromiseSequenceFromPath(visiblePath.nodeIds, graphLayout.edges);
  }, [attackCycle, enableStochasticPath, graphLayout]);
  const coreNode = useMemo(
    () => graphLayout?.nodes.find((node) => node.id === BLOG_DEFENSE_CORE_NODE_ID),
    [graphLayout?.nodes],
  );
  const coreBreached = compromisedNodes.has(BLOG_DEFENSE_CORE_NODE_ID);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setColors(readPictogramColors(container));
  }, [resolvedTheme, animationLayoutKey]);

  useEffect(() => {
    if (!graphLayout || compromiseSequence.length === 0) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(motionQuery.matches);
    setCompromisedNodes(new Set());
    setCompromisedEdges(new Set());
    setThrobbingStep(null);

    if (motionQuery.matches) {
      const nodes = new Set<string>();
      const edges = new Set<string>();
      for (const step of compromiseSequence) {
        if (step.kind === "node") nodes.add(step.nodeId);
        else edges.add(step.edgeId);
      }
      setCompromisedNodes(nodes);
      setCompromisedEdges(edges);
      return;
    }

    const timeouts: number[] = [];
    const perStepMs = stepDurationMs();
    compromiseSequence.forEach((step, index) => {
      const stepStartMs = START_DELAY_MS + index * perStepMs;
      const compromiseAtMs = stepStartMs + THROB_MS;

      timeouts.push(window.setTimeout(() => {
        setThrobbingStep(step);
      }, stepStartMs));

      timeouts.push(window.setTimeout(() => {
        setThrobbingStep((current) => (isSameThrobStep(current, step) ? null : current));
        if (step.kind === "node") {
          setCompromisedNodes((current) => new Set([...current, step.nodeId]));
        } else {
          setCompromisedEdges((current) => new Set([...current, step.edgeId]));
        }
      }, compromiseAtMs));
    });

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [animationLayoutKey, attackCycle, compromiseSequence, graphLayout]);

  if (SITE_BRAND.id !== "threat-intelligence") return null;

  return (
    <div
      aria-hidden="true"
      className="blog-page-background"
      data-blog-page-background="true"
      data-blog-page-background-obstacles={JSON.stringify(obstacles)}
      ref={containerRef}
    >
      {graphLayout ? (
        <svg
          className="blog-page-background__svg"
          preserveAspectRatio="xMaxYMin meet"
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <g className="blog-page-background__edges">
            {graphLayout.edges.map((edge) => {
              const isCompromised = compromisedEdges.has(edge.id);
              const isThrobbing = throbbingStep?.kind === "edge" && throbbingStep.edgeId === edge.id;
              const baseStrokeWidth = Math.max(1.4, graphLayout.scale * 1.2);
              return (
                <motion.line
                  animate={{
                    stroke: isCompromised
                      ? colors.compromised
                      : isThrobbing
                        ? [colors.edge, colors.throb, colors.edge]
                        : colors.edge,
                    strokeWidth: baseStrokeWidth,
                  }}
                  data-blog-edge-id={edge.id}
                  initial={false}
                  key={edge.id}
                  stroke={isCompromised ? colors.compromised : colors.edge}
                  strokeLinecap="round"
                  strokeWidth={baseStrokeWidth}
                  transition={
                    isThrobbing
                      ? { duration: THROB_TRANSITION_S, ease: "easeInOut", repeat: 1 }
                      : { duration: COMPROMISE_TRANSITION_S, ease: "easeOut" }
                  }
                  x1={edge.x1}
                  x2={edge.x2}
                  y1={edge.y1}
                  y2={edge.y2}
                />
              );
            })}
          </g>
          {coreBreached && coreNode ? (
            <CoreBreachEffect
              colors={colors}
              coreNode={coreNode}
              filterId={coreBreachFilterId}
              layer="rings"
              prefersReducedMotion={prefersReducedMotion}
              scale={graphLayout.scale}
            />
          ) : null}
          <g className="blog-page-background__nodes">
            {graphLayout.nodes.map((node) => {
              const isCompromised = compromisedNodes.has(node.id);
              const isThrobbing = throbbingStep?.kind === "node" && throbbingStep.nodeId === node.id;
              const isCore = node.role === "core";
              const coreBreachedNode = isCore && coreBreached;
              const coreStrokeWidth = isCore ? Math.max(4, graphLayout.scale * 1.5) : 0;
              const breachedCoreStrokeWidth = isCore
                ? Math.max(coreStrokeWidth * 1.35, graphLayout.scale * 2)
                : 0;
              return (
                <motion.circle
                  animate={{
                    fill: isCompromised
                      ? colors.compromised
                      : isThrobbing
                        ? [colors.node, colors.throb, colors.node]
                        : colors.node,
                    r: node.radius,
                    stroke: coreBreachedNode || (isCompromised && isCore)
                      ? colors.compromisedStroke
                      : "transparent",
                    strokeWidth: coreBreachedNode
                      ? breachedCoreStrokeWidth
                      : isCompromised && isCore
                        ? coreStrokeWidth
                        : 0,
                  }}
                  cx={node.x}
                  cy={node.y}
                  data-blog-node-id={node.id}
                  fill={isCompromised ? colors.compromised : colors.node}
                  initial={false}
                  key={node.id}
                  r={node.radius}
                  transition={
                    isThrobbing
                      ? { duration: THROB_TRANSITION_S, ease: "easeInOut", repeat: 1 }
                      : { duration: COMPROMISE_TRANSITION_S, ease: "easeOut" }
                  }
                />
              );
            })}
          </g>
          {coreBreached && coreNode ? (
            <CoreBreachEffect
              colors={colors}
              coreNode={coreNode}
              filterId={coreBreachFilterId}
              layer="halo"
              prefersReducedMotion={prefersReducedMotion}
              scale={graphLayout.scale}
            />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
