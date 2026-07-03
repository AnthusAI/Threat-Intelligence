import {
  BLOG_DEFENSE_ARM_PITCH,
  BLOG_DEFENSE_CORE_NODE_ID,
  BLOG_DEFENSE_EDGES,
  BLOG_DEFENSE_NODES,
  BLOG_DEFENSE_RING_RADII,
  BLOG_DEFENSE_VIEWBOX_HEIGHT,
  BLOG_DEFENSE_VIEWBOX_WIDTH,
  type BlogDefenseNode,
} from "./graph";

export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutDefenseGraphInput = {
  width: number;
  height: number;
  obstacles?: LayoutRect[];
};

export type LayoutDefenseNode = BlogDefenseNode;

export type LayoutDefenseEdge = {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type LayoutDefenseGraphResult = {
  nodes: LayoutDefenseNode[];
  edges: LayoutDefenseEdge[];
  scale: number;
};

function uniformNodeRadius(scale: number): number {
  return Math.max(4.4, scale * 6);
}

// The arm rails hug the page margins: the top and right edges use these tight
// insets instead of the content-side padding, so the rails run as close to
// the edge as they can without clipping node circles or edge strokes.
const TOP_EDGE_INSET = 4;
const RIGHT_EDGE_INSET = 3;
const BOTTOM_EDGE_INSET = 2;
const LEFT_EDGE_INSET = 4;

// Static shoulder edges are skipped and rebuilt dynamically so the arms can
// re-target surviving halo nodes after obstacle culling. When nothing is
// culled the rebuilt edges match the static template exactly.
const STATIC_SHOULDER_EDGE_PREFIXES = ["left_shoulder_", "right_shoulder_"] as const;
const LEFT_ARM_ATTACH_SOURCE_IDS = ["left_a0", "left_b0", "left_c0"] as const;
const LEFT_ARM_HALO_TARGET_IDS = ["halo_n", "halo_nw", "halo_w"] as const;
const RIGHT_ARM_ATTACH_SOURCE_IDS = ["right_a0", "right_b0", "right_c0"] as const;
const RIGHT_ARM_HALO_TARGET_IDS = ["halo_e", "halo_se", "halo_s", "halo_sw"] as const;

function pointInRect(x: number, y: number, rect: LayoutRect, inflate = 0): boolean {
  return x >= rect.x - inflate
    && x <= rect.x + rect.width + inflate
    && y >= rect.y - inflate
    && y <= rect.y + rect.height + inflate;
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return bx <= Math.max(ax, cx) + 0.0001
    && bx + 0.0001 >= Math.min(ax, cx)
    && by <= Math.max(ay, cy) + 0.0001
    && by + 0.0001 >= Math.min(ay, cy);
}

function segmentsIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): boolean {
  const o1 = orientation(x1, y1, x2, y2, x3, y3);
  const o2 = orientation(x1, y1, x2, y2, x4, y4);
  const o3 = orientation(x3, y3, x4, y4, x1, y1);
  const o4 = orientation(x3, y3, x4, y4, x2, y2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(x1, y1, x3, y3, x2, y2)) return true;
  if (o2 === 0 && onSegment(x1, y1, x4, y4, x2, y2)) return true;
  if (o3 === 0 && onSegment(x3, y3, x1, y1, x4, y4)) return true;
  if (o4 === 0 && onSegment(x3, y3, x2, y2, x4, y4)) return true;
  return false;
}

function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: LayoutRect,
  inflate = 0,
): boolean {
  const inflated = {
    x: rect.x - inflate,
    y: rect.y - inflate,
    width: rect.width + inflate * 2,
    height: rect.height + inflate * 2,
  };
  if (pointInRect(x1, y1, inflated) || pointInRect(x2, y2, inflated)) return true;
  const left = inflated.x;
  const right = inflated.x + inflated.width;
  const top = inflated.y;
  const bottom = inflated.y + inflated.height;
  return segmentsIntersect(x1, y1, x2, y2, left, top, right, top)
    || segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom)
    || segmentsIntersect(x1, y1, x2, y2, right, bottom, left, bottom)
    || segmentsIntersect(x1, y1, x2, y2, left, bottom, left, top);
}

function edgeIntersectsObstacles(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: LayoutRect[],
): boolean {
  return obstacles.some((obstacle) => segmentIntersectsRect(x1, y1, x2, y2, obstacle, 2));
}

function nodeIntersectsObstacles(
  x: number,
  y: number,
  radius: number,
  obstacles: LayoutRect[],
): boolean {
  return obstacles.some((obstacle) => {
    const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
    const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
    const dx = x - nearestX;
    const dy = y - nearestY;
    return (dx * dx) + (dy * dy) <= (radius * radius);
  });
}

function templateNodeById(id: string): BlogDefenseNode | undefined {
  return BLOG_DEFENSE_NODES.find((node) => node.id === id);
}

type BoundsChecker = (x: number, y: number) => boolean;

function makeBoundsChecker(input: {
  width: number;
  height: number;
  nodeRadius: number;
}): BoundsChecker {
  const { width, height, nodeRadius } = input;
  return (x, y) => (
    x > LEFT_EDGE_INSET + nodeRadius
    && x <= width - nodeRadius - RIGHT_EDGE_INSET + 0.5
    && y >= TOP_EDGE_INSET + nodeRadius - 0.5
    && y <= height - nodeRadius - BOTTOM_EDGE_INSET
  );
}

function coreAnchor(input: {
  width: number;
  scale: number;
  coreNode: BlogDefenseNode;
  nodeRadius: number;
}): { x: number; y: number } {
  const { width, scale, coreNode, nodeRadius } = input;
  // The right rail (the template's rightmost element) sits flush against the
  // right edge inset, and the halo crown sits flush against the top inset —
  // the arm rails share the halo's tangent lines, so both rails hug their
  // page margins by construction.
  const maxDx = BLOG_DEFENSE_NODES.reduce((max, node) => Math.max(max, node.x - coreNode.x), 0);
  return {
    x: width - nodeRadius - RIGHT_EDGE_INSET - maxDx * scale,
    y: TOP_EDGE_INSET + nodeRadius + BLOG_DEFENSE_RING_RADII.halo * scale,
  };
}

function bestCoreAnchor(input: {
  width: number;
  scale: number;
  coreNode: BlogDefenseNode;
  nodeRadius: number;
  obstacles: LayoutRect[];
  inBounds: BoundsChecker;
}): { x: number; y: number } {
  const { width, scale, coreNode, nodeRadius, obstacles, inBounds } = input;
  const base = coreAnchor({ width, scale, coreNode, nodeRadius });
  if (!obstacles.length) return base;

  const coreZoneNodes = BLOG_DEFENSE_NODES.filter((node) => node.zone === "core");
  const maxAnchorX = width - nodeRadius - RIGHT_EDGE_INSET;
  const step = Math.max(4, Math.round(width * 0.012));
  let best = base;
  let bestScore = -Infinity;

  for (let x = base.x; x <= maxAnchorX + 0.001; x += step) {
    let score = 0;
    for (const node of coreZoneNodes) {
      const candidateX = x + (node.x - coreNode.x) * scale;
      const candidateY = base.y + (node.y - coreNode.y) * scale;
      if (!inBounds(candidateX, candidateY)) continue;
      if (nodeIntersectsObstacles(candidateX, candidateY, nodeRadius + 2, obstacles)) continue;
      score += node.id === BLOG_DEFENSE_CORE_NODE_ID ? 100 : 1;
    }

    const distancePenalty = Math.abs(x - base.x) / Math.max(1, width);
    const adjustedScore = score - distancePenalty;
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      best = { x, y: base.y };
    }
  }

  return best;
}

function buildEdgeRecord(from: LayoutDefenseNode, to: LayoutDefenseNode, id: string): LayoutDefenseEdge {
  return {
    id,
    from: from.id,
    to: to.id,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
  };
}

function buildArmAttachmentEdges(input: {
  side: "left" | "right";
  sourceIds: readonly string[];
  targetIds: readonly string[];
  positionedNodes: Map<string, LayoutDefenseNode>;
  obstacles: LayoutRect[];
  usedEdgeIds: Set<string>;
}): LayoutDefenseEdge[] {
  const { side, sourceIds, targetIds, positionedNodes, obstacles, usedEdgeIds } = input;
  const targets = targetIds
    .map((id) => positionedNodes.get(id))
    .filter((node): node is LayoutDefenseNode => Boolean(node));
  if (!targets.length) return [];

  const usedTargetIds = new Set<string>();
  const attachmentEdges: LayoutDefenseEdge[] = [];

  for (const sourceId of sourceIds) {
    const source = positionedNodes.get(sourceId);
    if (!source) continue;
    const reachable = targets.filter((target) => (
      !edgeIntersectsObstacles(source.x, source.y, target.x, target.y, obstacles)
    ));
    if (!reachable.length) continue;
    const preferred = reachable.filter((target) => !usedTargetIds.has(target.id));
    const pool = preferred.length ? preferred : reachable;
    const bestTarget = pool
      .slice()
      .sort((left, right) => {
        const leftDistance = Math.hypot(source.x - left.x, source.y - left.y);
        const rightDistance = Math.hypot(source.x - right.x, source.y - right.y);
        if (Math.abs(leftDistance - rightDistance) > 0.001) {
          return leftDistance - rightDistance;
        }
        return targetIds.indexOf(left.id) - targetIds.indexOf(right.id);
      })[0];
    if (!bestTarget) continue;

    const edgeId = `${side}_dynamic_attach_${sourceId}_${bestTarget.id}`;
    if (usedEdgeIds.has(edgeId)) continue;
    attachmentEdges.push(buildEdgeRecord(source, bestTarget, edgeId));
    usedEdgeIds.add(edgeId);
    usedTargetIds.add(bestTarget.id);
  }

  return attachmentEdges;
}

// Extend a margin rail one pitch at a time until it reaches the container
// boundary, so the single-file line runs the full margin regardless of
// container proportions. A step blocked by an obstacle is skipped rather
// than treated as the end of the rail: the walk keeps advancing toward the
// boundary and resumes emitting nodes as soon as it's clear again, so one
// transient obstacle only opens a small gap instead of truncating everything
// beyond it.
function extendMarginRail(input: {
  seed: LayoutDefenseNode;
  stepX: number;
  stepY: number;
  withinBounds: (x: number, y: number) => boolean;
  makeNode: (index: number, x: number, y: number) => LayoutDefenseNode;
  idPrefix: string;
  positionedNodes: Map<string, LayoutDefenseNode>;
  edges: LayoutDefenseEdge[];
  usedEdgeIds: Set<string>;
  obstacles: LayoutRect[];
}): void {
  const {
    seed,
    stepX,
    stepY,
    withinBounds,
    makeNode,
    idPrefix,
    positionedNodes,
    edges,
    usedEdgeIds,
    obstacles,
  } = input;
  let previous = seed;
  let emitted = 0;
  for (let step = 1; ; step += 1) {
    const x = seed.x + stepX * step;
    const y = seed.y + stepY * step;
    if (!withinBounds(x, y)) break;
    if (nodeIntersectsObstacles(x, y, seed.radius + 2, obstacles)) continue;
    const node = makeNode(emitted, x, y);
    positionedNodes.set(node.id, node);
    if (!edgeIntersectsObstacles(previous.x, previous.y, x, y, obstacles)) {
      const edgeId = `${idPrefix}_chain_${emitted}`;
      edges.push(buildEdgeRecord(previous, node, edgeId));
      usedEdgeIds.add(edgeId);
    }
    previous = node;
    emitted += 1;
  }
}

export function layoutDefenseGraph(input: LayoutDefenseGraphInput): LayoutDefenseGraphResult {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  // Obstacles are real measured DOM rects, not rendered/snapped grid
  // elements — grid-snapping them here only adds asymmetric drift on top of
  // whatever tight buffer the caller already applied, with no crispness
  // benefit (unlike node/edge coordinates, obstacle rects are never drawn).
  const obstacles = input.obstacles ?? [];
  const core = templateNodeById(BLOG_DEFENSE_CORE_NODE_ID) ?? BLOG_DEFENSE_NODES[0];
  const baseScale = Math.min(width / BLOG_DEFENSE_VIEWBOX_WIDTH, height / BLOG_DEFENSE_VIEWBOX_HEIGHT);
  const scaleBoost = width >= 720
    ? 1.08
    : width >= 520
      ? 1.05
      : 1.02;
  // The floor only needs to stay high enough that the closest pair of nodes
  // anywhere in the template (halo_nw and left_b0's shoulder wedge, ~22.6
  // template units apart) don't overlap once node radius bottoms out at its
  // own floor (4.4px): 22.6 * 0.42 = 9.5 > 2 * 4.4. Below ~720px-wide
  // containers baseScale can undershoot a much higher floor, which used to
  // clip whole rail segments against the padding/edge bounds even though
  // nothing was actually obstructing them — the template just didn't fit.
  const scale = Math.max(0.42, Math.min(1.18, baseScale * scaleBoost));
  const nodeRadius = uniformNodeRadius(scale);
  const pitch = BLOG_DEFENSE_ARM_PITCH * scale;
  const inBounds = makeBoundsChecker({ width, height, nodeRadius });
  const anchor = bestCoreAnchor({
    width,
    scale,
    coreNode: core,
    nodeRadius,
    obstacles,
    inBounds,
  });

  // The template is already a finished geometric construction, so layout is a
  // uniform scale-and-anchor: no per-node reshaping, only culling of nodes
  // that fall outside the margins or under an obstacle.
  const positionedNodes = new Map<string, LayoutDefenseNode>();
  for (const node of BLOG_DEFENSE_NODES) {
    const x = anchor.x + (node.x - core.x) * scale;
    const y = anchor.y + (node.y - core.y) * scale;

    if (!inBounds(x, y)) continue;
    if (nodeIntersectsObstacles(x, y, nodeRadius + 2, obstacles)) continue;

    positionedNodes.set(node.id, {
      ...node,
      x,
      y,
      radius: nodeRadius,
    });
  }

  const edges: LayoutDefenseEdge[] = [];
  const usedEdgeIds = new Set<string>();
  for (const edge of BLOG_DEFENSE_EDGES) {
    if (STATIC_SHOULDER_EDGE_PREFIXES.some((prefix) => edge.id.startsWith(prefix))) continue;
    const from = positionedNodes.get(edge.from);
    const to = positionedNodes.get(edge.to);
    if (!from || !to) continue;
    if (edgeIntersectsObstacles(from.x, from.y, to.x, to.y, obstacles)) continue;
    edges.push(buildEdgeRecord(from, to, edge.id));
    usedEdgeIds.add(edge.id);
  }

  edges.push(...buildArmAttachmentEdges({
    side: "left",
    sourceIds: LEFT_ARM_ATTACH_SOURCE_IDS,
    targetIds: LEFT_ARM_HALO_TARGET_IDS,
    positionedNodes,
    obstacles,
    usedEdgeIds,
  }));
  edges.push(...buildArmAttachmentEdges({
    side: "right",
    sourceIds: RIGHT_ARM_ATTACH_SOURCE_IDS,
    targetIds: RIGHT_ARM_HALO_TARGET_IDS,
    positionedNodes,
    obstacles,
    usedEdgeIds,
  }));

  // Re-chain surviving template corridor nodes across culled gaps so the
  // ingress rail stays a connected attack route.
  const corridorNodes = Array.from(positionedNodes.values())
    .filter((node) => node.zone === "right_corridor")
    .sort((a, b) => a.y - b.y);
  for (let index = 0; index < corridorNodes.length - 1; index += 1) {
    const from = corridorNodes[index];
    const to = corridorNodes[index + 1];
    if (edgeIntersectsObstacles(from.x, from.y, to.x, to.y, obstacles)) continue;
    const templateEdge = BLOG_DEFENSE_EDGES.find((edge) => (
      (edge.from === from.id && edge.to === to.id) || (edge.from === to.id && edge.to === from.id)
    ));
    const id = templateEdge ? templateEdge.id : `corridor_relink_${from.id}_${to.id}`;
    if (usedEdgeIds.has(id)) continue;
    edges.push(buildEdgeRecord(from, to, id));
    usedEdgeIds.add(id);
  }

  // Stretch the right rail down the page margin: extra ingress nodes continue
  // the single-file line to the bottom of the container.
  const rightRailSeed = Array.from(positionedNodes.values())
    .filter((node) => node.zone === "right_corridor" || /^right_a\d/.test(node.id))
    .sort((a, b) => b.y - a.y)[0];
  if (rightRailSeed) {
    extendMarginRail({
      seed: rightRailSeed,
      stepX: 0,
      stepY: pitch,
      withinBounds: (x, y) => inBounds(x, y),
      makeNode: (index, x, y) => ({
        id: `corridor_ext_${index}`,
        x,
        y,
        radius: nodeRadius,
        role: "attack",
        zone: "right_corridor",
        protectedIngress: true,
      }),
      idPrefix: "corridor_ext",
      positionedNodes,
      edges,
      usedEdgeIds,
      obstacles,
    });
  }

  // Stretch the left rail along the top margin toward the content padding.
  const leftRailSeed = Array.from(positionedNodes.values())
    .filter((node) => /^left_a\d/.test(node.id))
    .sort((a, b) => a.x - b.x)[0];
  if (leftRailSeed) {
    extendMarginRail({
      seed: leftRailSeed,
      stepX: -pitch,
      stepY: 0,
      withinBounds: (x, y) => inBounds(x, y),
      makeNode: (index, x, y) => ({
        id: `left_ext_${index}`,
        x,
        y,
        radius: nodeRadius,
        role: "perimeter",
        zone: "left_arm",
      }),
      idPrefix: "left_ext",
      positionedNodes,
      edges,
      usedEdgeIds,
      obstacles,
    });
  }

  return {
    nodes: Array.from(positionedNodes.values()),
    edges,
    scale,
  };
}
