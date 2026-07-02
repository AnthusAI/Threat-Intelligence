export const BLOG_DEFENSE_VIEWBOX_WIDTH = 1000;
export const BLOG_DEFENSE_VIEWBOX_HEIGHT = 700;

export type BlogDefenseNodeRole = "core" | "attack" | "perimeter" | "interior";
export type BlogDefenseZone = "core" | "left_arm" | "right_arm" | "right_corridor";

export type BlogDefenseNode = {
  id: string;
  x: number;
  y: number;
  radius: number;
  role: BlogDefenseNodeRole;
  zone: BlogDefenseZone;
  protectedIngress?: boolean;
};

export type BlogDefenseEdge = {
  id: string;
  from: string;
  to: string;
};

export type VisibleAttackPathInput = {
  nodes: BlogDefenseNode[];
  edges: BlogDefenseEdge[];
  coreId?: string;
  stochastic?: boolean;
};

export type VisibleAttackPath = {
  nodeIds: string[];
  edgeIds: string[];
};

export const BLOG_DEFENSE_CORE_NODE_ID = "core";

const STOCHASTIC = {
  improvingOnlyChance: 0.55,
  improvingBiasBase: 2.6,
  improvingBiasSlope: 0.85,
  lateralBias: 1.8,
  backtrackBias: 0.55,
  coreNeighborMultiplier: 1.35,
  revisitPenaltySlope: 0.95,
  euclideanBiasSlope: 0.006,
  maxStepsFloor: 22,
  maxStepsCeiling: 52,
  perimeterImprovingScale: 0.35,
  perimeterLateralScale: 3.0,
  weightJitter: 0.45,
  completionWanderSteps: 24,
  completionImprovingScale: 0.45,
  completionLateralScale: 2.2,
};

// The whole template derives from one construction: a right triangle hugging
// the top-right corner. Four true concentric octagon rings surround the core;
// each arm is a rail lying exactly on a halo tangent line (the left rail
// shares the halo's north y, the right rail its east x) with a short two-lane
// shoulder wedge where it roots into the ring. Past the wedge each arm thins
// to a single file of nodes so it can hug the page margin: the top margin
// going left, the right margin going down. The right rail's lower reach is
// the attack corridor — attacks come in on the margins.
const CENTER_X = 770;
const CENTER_Y = 175;

export const BLOG_DEFENSE_RING_RADII = {
  mid: 64,
  ring: 92,
  outer: 120,
  halo: 148,
} as const;

const HALO_RADIUS = BLOG_DEFENSE_RING_RADII.halo;

const RING_SPECS: Array<{
  prefix: "mid" | "ring" | "outer" | "halo";
  radius: number;
  role: BlogDefenseNodeRole;
  nodeRadius: number;
}> = [
  { prefix: "mid", radius: BLOG_DEFENSE_RING_RADII.mid, role: "interior", nodeRadius: 5 },
  { prefix: "ring", radius: BLOG_DEFENSE_RING_RADII.ring, role: "perimeter", nodeRadius: 7 },
  { prefix: "outer", radius: BLOG_DEFENSE_RING_RADII.outer, role: "perimeter", nodeRadius: 7 },
  { prefix: "halo", radius: BLOG_DEFENSE_RING_RADII.halo, role: "perimeter", nodeRadius: 7 },
];

const AZIMUTHS = [
  { key: "n", ux: 0, uy: -1 },
  { key: "ne", ux: Math.SQRT1_2, uy: -Math.SQRT1_2 },
  { key: "e", ux: 1, uy: 0 },
  { key: "se", ux: Math.SQRT1_2, uy: Math.SQRT1_2 },
  { key: "s", ux: 0, uy: 1 },
  { key: "sw", ux: -Math.SQRT1_2, uy: Math.SQRT1_2 },
  { key: "w", ux: -1, uy: 0 },
  { key: "nw", ux: -Math.SQRT1_2, uy: -Math.SQRT1_2 },
] as const;

const CARDINAL_KEYS = new Set(["n", "e", "s", "w"]);

// Node pitch along each arm rail, and the gap between an arm's lanes.
export const BLOG_DEFENSE_ARM_PITCH = 42;
const ARM_PITCH = BLOG_DEFENSE_ARM_PITCH;
const ARM_LANE_GAP = 36;

// Shoulder wedge lanes. Lane "a" is the tangent rail; b and c start later and
// end earlier in whole pitch steps so both staircase edges are straight lines
// and the wedge melts into a single-file rail at step 6.
const LANE_B = { lane: "b", count: 4, startStep: 2, role: "interior" as BlogDefenseNodeRole };
const LANE_C = { lane: "c", count: 2, startStep: 3, role: "interior" as BlogDefenseNodeRole };
const LEFT_RAIL_COUNT = 12;
// The right rail hands off to the attack corridor, which continues the same
// column at the same pitch — one unbroken line down the page margin.
const RIGHT_RAIL_COUNT = 7;
const CORRIDOR_COUNT = 5;
const ARM_NODE_RADIUS = 6;
const CORRIDOR_NODE_RADIUS = 7;

const TAPER_RAIL_STEP = LANE_B.startStep + LANE_B.count; // 6

function armLanes(railCount: number) {
  return [
    { lane: "a", count: railCount, startStep: 0, role: "perimeter" as BlogDefenseNodeRole },
    LANE_B,
    LANE_C,
  ];
}

function buildTemplateNodes(): BlogDefenseNode[] {
  const nodes: BlogDefenseNode[] = [
    { id: BLOG_DEFENSE_CORE_NODE_ID, x: CENTER_X, y: CENTER_Y, radius: 12, role: "core", zone: "core" },
  ];

  for (const ring of RING_SPECS) {
    for (const azimuth of AZIMUTHS) {
      nodes.push({
        id: `${ring.prefix}_${azimuth.key}`,
        x: CENTER_X + azimuth.ux * ring.radius,
        y: CENTER_Y + azimuth.uy * ring.radius,
        radius: ring.nodeRadius,
        role: ring.role,
        zone: "core",
      });
    }
  }

  const leftRailY = CENTER_Y - HALO_RADIUS;
  const leftOriginX = CENTER_X - ARM_PITCH;
  for (let laneIndex = 0; laneIndex < armLanes(LEFT_RAIL_COUNT).length; laneIndex += 1) {
    const { lane, count, startStep, role } = armLanes(LEFT_RAIL_COUNT)[laneIndex];
    for (let index = 0; index < count; index += 1) {
      nodes.push({
        id: `left_${lane}${index}`,
        x: leftOriginX - (startStep + index) * ARM_PITCH,
        y: leftRailY + laneIndex * ARM_LANE_GAP,
        radius: ARM_NODE_RADIUS,
        role,
        zone: "left_arm",
      });
    }
  }

  const rightRailX = CENTER_X + HALO_RADIUS;
  const rightOriginY = CENTER_Y + ARM_PITCH;
  for (let laneIndex = 0; laneIndex < armLanes(RIGHT_RAIL_COUNT).length; laneIndex += 1) {
    const { lane, count, startStep, role } = armLanes(RIGHT_RAIL_COUNT)[laneIndex];
    for (let index = 0; index < count; index += 1) {
      nodes.push({
        id: `right_${lane}${index}`,
        x: rightRailX - laneIndex * ARM_LANE_GAP,
        y: rightOriginY + (startStep + index) * ARM_PITCH,
        radius: ARM_NODE_RADIUS,
        role,
        zone: "right_arm",
      });
    }
  }

  for (let index = 0; index < CORRIDOR_COUNT; index += 1) {
    nodes.push({
      id: `corridor_${index}`,
      x: rightRailX,
      y: rightOriginY + (RIGHT_RAIL_COUNT + index) * ARM_PITCH,
      radius: CORRIDOR_NODE_RADIUS,
      role: "attack",
      zone: "right_corridor",
      protectedIngress: true,
    });
  }

  return nodes;
}

function buildTemplateEdges(): BlogDefenseEdge[] {
  const edges: BlogDefenseEdge[] = [];
  const push = (id: string, from: string, to: string) => {
    edges.push({ id, from, to });
  };

  for (const ring of RING_SPECS) {
    const octagonPrefix = ring.prefix === "mid" ? "mid_ring" : ring.prefix;
    for (let index = 0; index < AZIMUTHS.length; index += 1) {
      const from = AZIMUTHS[index].key;
      const to = AZIMUTHS[(index + 1) % AZIMUTHS.length].key;
      push(`${octagonPrefix}_${index + 1}`, `${ring.prefix}_${from}`, `${ring.prefix}_${to}`);
    }
  }

  for (const azimuth of AZIMUTHS) {
    push(`halo_to_outer_${azimuth.key}`, `halo_${azimuth.key}`, `outer_${azimuth.key}`);
    push(`outer_to_ring_${azimuth.key}`, `outer_${azimuth.key}`, `ring_${azimuth.key}`);
    push(`mid_to_outer_${azimuth.key}`, `mid_${azimuth.key}`, `ring_${azimuth.key}`);
    if (CARDINAL_KEYS.has(azimuth.key)) {
      push(`mid_spoke_${azimuth.key}`, `mid_${azimuth.key}`, BLOG_DEFENSE_CORE_NODE_ID);
    }
  }

  for (const side of ["left", "right"] as const) {
    const railCount = side === "left" ? LEFT_RAIL_COUNT : RIGHT_RAIL_COUNT;
    for (const { lane, count } of armLanes(railCount)) {
      for (let index = 0; index < count - 1; index += 1) {
        push(`${side}_${lane}_chain_${index + 1}`, `${side}_${lane}${index}`, `${side}_${lane}${index + 1}`);
      }
    }

    // Shoulder truss: a rung at every shared step plus diagonals that all lean
    // toward the core, and one closing edge per taper step (the two closing
    // edges are collinear, drawing the straight taper line into the rail).
    for (let step = LANE_B.startStep; step < LANE_B.startStep + LANE_B.count; step += 1) {
      push(`${side}_rung_ab_${step}`, `${side}_a${step}`, `${side}_b${step - LANE_B.startStep}`);
    }
    for (let step = LANE_C.startStep; step < LANE_C.startStep + LANE_C.count; step += 1) {
      push(`${side}_rung_bc_${step}`, `${side}_b${step - LANE_B.startStep}`, `${side}_c${step - LANE_C.startStep}`);
    }
    for (let index = 0; index < LANE_B.count; index += 1) {
      push(`${side}_diag_ab_${index}`, `${side}_b${index}`, `${side}_a${index + 1}`);
    }
    for (let index = 0; index < LANE_C.count; index += 1) {
      push(`${side}_diag_bc_${index}`, `${side}_c${index}`, `${side}_b${index}`);
    }
    push(`${side}_taper_ab`, `${side}_b${LANE_B.count - 1}`, `${side}_a${TAPER_RAIL_STEP}`);
    push(
      `${side}_taper_bc`,
      `${side}_c${LANE_C.count - 1}`,
      `${side}_b${LANE_C.startStep + LANE_C.count - LANE_B.startStep}`,
    );
  }

  // Static shoulder attachments splay each lane end into its own halo azimuth.
  // The layout skips these ids and rebuilds equivalent attachments dynamically
  // so arms can re-target surviving halo nodes after obstacle culling.
  push("left_shoulder_a0", "left_a0", "halo_n");
  push("left_shoulder_b0", "left_b0", "halo_nw");
  push("left_shoulder_c0", "left_c0", "halo_w");
  push("right_shoulder_a0", "right_a0", "halo_e");
  push("right_shoulder_b0", "right_b0", "halo_se");
  push("right_shoulder_c0", "right_c0", "halo_s");

  push("corridor_link", `right_a${RIGHT_RAIL_COUNT - 1}`, "corridor_0");
  for (let index = 0; index < CORRIDOR_COUNT - 1; index += 1) {
    push(`corridor_chain_${index + 1}`, `corridor_${index}`, `corridor_${index + 1}`);
  }

  return edges;
}

export const BLOG_DEFENSE_NODES: BlogDefenseNode[] = buildTemplateNodes();

export const BLOG_DEFENSE_EDGES: BlogDefenseEdge[] = buildTemplateEdges();

export const BLOG_DEFENSE_COMPROMISE_PATH: string[] = [
  "corridor_4",
  "corridor_3",
  "corridor_2",
  "corridor_1",
  "corridor_0",
  "right_a6",
  "right_b3",
  "right_b2",
  "right_b1",
  "right_b0",
  "halo_se",
  "outer_se",
  "ring_se",
  "ring_s",
  "mid_s",
  "core",
];

export type BlogDefenseCompromiseStep =
  | { kind: "node"; nodeId: string }
  | { kind: "edge"; from: string; to: string; edgeId: string };

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function buildGraphIndex(edges: BlogDefenseEdge[]): {
  adjacency: Map<string, string[]>;
  edgeByNodes: Map<string, BlogDefenseEdge>;
} {
  const adjacency = new Map<string, string[]>();
  const edgeByNodes = new Map<string, BlogDefenseEdge>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
    edgeByNodes.set(edgeKey(edge.from, edge.to), edge);
  }
  return { adjacency, edgeByNodes };
}

export function getBlogDefensePathEdge(from: string, to: string): BlogDefenseEdge | undefined {
  return BLOG_DEFENSE_EDGES.find(
    (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
  );
}

export function buildCompromiseSequenceFromPath(nodeIds: string[], edges: BlogDefenseEdge[]): BlogDefenseCompromiseStep[] {
  const steps: BlogDefenseCompromiseStep[] = [];
  if (!nodeIds.length) return steps;
  const { edgeByNodes } = buildGraphIndex(edges);
  steps.push({ kind: "node", nodeId: nodeIds[0] });
  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    const edge = edgeByNodes.get(edgeKey(from, to));
    if (!edge) continue;
    steps.push({ kind: "edge", from, to, edgeId: edge.id });
    steps.push({ kind: "node", nodeId: to });
  }
  return steps;
}

function shortestPathWithTieBreak(
  startId: string,
  targetId: string,
  nodeById: Map<string, BlogDefenseNode>,
  adjacency: Map<string, string[]>,
  blockedNodeIds: Set<string> = new Set(),
): string[] {
  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);
  const prev = new Map<string, string>();
  const targetNode = nodeById.get(targetId);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current === targetId) break;
    const neighbors = [...(adjacency.get(current) ?? [])];
    neighbors.sort((a, b) => {
      const aNode = nodeById.get(a);
      const bNode = nodeById.get(b);
      if (!aNode || !bNode || !targetNode) return 0;
      const aDist = Math.hypot(aNode.x - targetNode.x, aNode.y - targetNode.y);
      const bDist = Math.hypot(bNode.x - targetNode.x, bNode.y - targetNode.y);
      return aDist - bDist;
    });
    for (const neighbor of neighbors) {
      if (neighbor !== targetId && blockedNodeIds.has(neighbor)) continue;
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      prev.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  if (!visited.has(targetId)) return [];
  const path: string[] = [targetId];
  let current = targetId;
  while (current !== startId) {
    const parent = prev.get(current);
    if (!parent) return [];
    path.unshift(parent);
    current = parent;
  }
  return path;
}

function nodeApproachPriority(node: BlogDefenseNode): number {
  if (node.id.startsWith("mid_")) return 0;
  if (node.id.startsWith("ring_")) return 1;
  if (node.id.startsWith("outer_")) return 2;
  if (node.id.startsWith("halo_")) return 3;
  return 4;
}

function resolveCoreApproachCandidates(
  startId: string,
  coreId: string,
  nodeById: Map<string, BlogDefenseNode>,
  adjacency: Map<string, string[]>,
): string[] {
  const coreNode = nodeById.get(coreId);
  const startNode = nodeById.get(startId);
  if (!coreNode || !startNode) return [];

  const startAngle = Math.atan2(startNode.y - coreNode.y, startNode.x - coreNode.x);
  return [...(adjacency.get(coreId) ?? [])]
    .map((id) => nodeById.get(id))
    .filter((node): node is BlogDefenseNode => Boolean(node))
    .sort((left, right) => {
      const leftPriority = nodeApproachPriority(left);
      const rightPriority = nodeApproachPriority(right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftAngle = Math.atan2(left.y - coreNode.y, left.x - coreNode.x);
      const rightAngle = Math.atan2(right.y - coreNode.y, right.x - coreNode.x);
      const leftDelta = Math.abs(normalizeAngle(leftAngle - startAngle));
      const rightDelta = Math.abs(normalizeAngle(rightAngle - startAngle));
      if (Math.abs(leftDelta - rightDelta) > 0.001) return leftDelta - rightDelta;

      const leftDistance = Math.hypot(startNode.x - left.x, startNode.y - left.y);
      const rightDistance = Math.hypot(startNode.x - right.x, startNode.y - right.y);
      return leftDistance - rightDistance;
    })
    .map((node) => node.id);
}

function buildPathToCoreWithPreferredApproach(
  startId: string,
  coreId: string,
  nodeById: Map<string, BlogDefenseNode>,
  adjacency: Map<string, string[]>,
): string[] {
  const approachCandidates = resolveCoreApproachCandidates(startId, coreId, nodeById, adjacency);
  for (const approachId of approachCandidates) {
    const approachPath = shortestPathWithTieBreak(startId, approachId, nodeById, adjacency, new Set([coreId]));
    if (!approachPath.length) continue;
    if (!(adjacency.get(approachId) ?? []).includes(coreId)) continue;
    return [...approachPath, coreId];
  }

  return shortestPathWithTieBreak(startId, coreId, nodeById, adjacency);
}

function hopDistanceToCore(
  coreId: string,
  adjacency: Map<string, string[]>,
  blockedNodeIds: Set<string> = new Set(),
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: string[] = [coreId];
  distances.set(coreId, 0);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    const currentDistance = distances.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (neighbor !== coreId && blockedNodeIds.has(neighbor)) continue;
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  return distances;
}

function chooseWeightedIndex(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + (weight > 0 ? weight : 0), 0);
  if (total <= 0) return 0;
  let roll = Math.random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= Math.max(0, weights[index]);
    if (roll <= 0) return index;
  }
  return Math.max(0, weights.length - 1);
}

function isPerimeterExplorationNode(node: BlogDefenseNode | undefined): boolean {
  if (!node) return false;
  return node.zone === "core" || node.role === "perimeter" || node.role === "interior";
}

function stochasticWeightJitter(): number {
  return 1 - STOCHASTIC.weightJitter / 2 + Math.random() * STOCHASTIC.weightJitter;
}

type StochasticWalkInput = {
  current: string;
  coreId: string;
  coreNeighbors: Set<string>;
  nodeById: Map<string, BlogDefenseNode>;
  adjacency: Map<string, string[]>;
  distances: Map<string, number>;
  visitCounts: Map<string, number>;
  improvingOnlyScale?: number;
  lateralScale?: number;
};

function chooseStochasticNeighbor(input: StochasticWalkInput): string | null {
  const {
    current,
    coreId,
    coreNeighbors,
    nodeById,
    adjacency,
    distances,
    visitCounts,
    improvingOnlyScale = 1,
    lateralScale = 1,
  } = input;

  const neighbors = (adjacency.get(current) ?? []).filter((neighbor) => distances.has(neighbor));
  if (!neighbors.length) return null;

  const currentNode = nodeById.get(current);
  const exploring = isPerimeterExplorationNode(currentNode);
  const improvingOnlyChance = (exploring
    ? STOCHASTIC.improvingOnlyChance * STOCHASTIC.perimeterImprovingScale
    : STOCHASTIC.improvingOnlyChance) * improvingOnlyScale;

  const currentHop = distances.get(current) ?? Number.POSITIVE_INFINITY;
  const improving = neighbors.filter((neighbor) => (distances.get(neighbor) ?? Number.POSITIVE_INFINITY) < currentHop);
  const candidatePool = improving.length && Math.random() < improvingOnlyChance ? improving : neighbors;

  const coreNode = nodeById.get(coreId);
  const weights = candidatePool.map((neighbor) => {
    const neighborHop = distances.get(neighbor) ?? Number.POSITIVE_INFINITY;
    const hopDelta = currentHop - neighborHop;
    const revisitPenalty = 1 / (1 + (visitCounts.get(neighbor) ?? 0) * STOCHASTIC.revisitPenaltySlope);
    const neighborNode = nodeById.get(neighbor);
    const euclideanBias = coreNode && neighborNode
      ? 1 / (1 + Math.hypot(neighborNode.x - coreNode.x, neighborNode.y - coreNode.y) * STOCHASTIC.euclideanBiasSlope)
      : 1;

    const lateralBias = (exploring
      ? STOCHASTIC.lateralBias * STOCHASTIC.perimeterLateralScale
      : STOCHASTIC.lateralBias) * lateralScale;

    let bias = 1;
    if (hopDelta > 0) bias = STOCHASTIC.improvingBiasBase + hopDelta * STOCHASTIC.improvingBiasSlope;
    else if (hopDelta === 0) bias = lateralBias;
    else bias = STOCHASTIC.backtrackBias;
    if (coreNeighbors.has(neighbor)) bias *= STOCHASTIC.coreNeighborMultiplier;

    return Math.max(0.01, bias * revisitPenalty * euclideanBias * stochasticWeightJitter());
  });

  return candidatePool[chooseWeightedIndex(weights)] ?? null;
}

function buildStochasticInwardPath(
  startId: string,
  coreId: string,
  nodeById: Map<string, BlogDefenseNode>,
  adjacency: Map<string, string[]>,
): string[] {
  const distances = hopDistanceToCore(coreId, adjacency);
  if (!distances.has(startId)) return [];

  const coreNeighbors = new Set(adjacency.get(coreId) ?? []);
  const maxSteps = Math.max(
    STOCHASTIC.maxStepsFloor,
    Math.min(STOCHASTIC.maxStepsCeiling, nodeById.size + 8),
  );
  const path = [startId];
  const visitCounts = new Map<string, number>([[startId, 1]]);
  let current = startId;

  const finishAtCore = (): boolean => {
    if (!coreNeighbors.has(current)) return false;
    path.push(coreId);
    return true;
  };

  const wander = (steps: number, improvingOnlyScale = 1, lateralScale = 1): void => {
    for (let step = 0; step < steps; step += 1) {
      if (finishAtCore()) return;

      const next = chooseStochasticNeighbor({
        current,
        coreId,
        coreNeighbors,
        nodeById,
        adjacency,
        distances,
        visitCounts,
        improvingOnlyScale,
        lateralScale,
      });
      if (!next) break;

      path.push(next);
      visitCounts.set(next, (visitCounts.get(next) ?? 0) + 1);
      current = next;
    }
  };

  wander(maxSteps);
  if (finishAtCore() || path[path.length - 1] === coreId) return path;

  wander(
    STOCHASTIC.completionWanderSteps,
    STOCHASTIC.completionImprovingScale,
    STOCHASTIC.completionLateralScale,
  );
  if (finishAtCore() || path[path.length - 1] === coreId) return path;

  const completion = shortestPathWithTieBreak(current, coreId, nodeById, adjacency);
  if (completion.length > 1) path.push(...completion.slice(1));
  return path[path.length - 1] === coreId ? path : [];
}

export function buildVisibleAttackPath(input: VisibleAttackPathInput): VisibleAttackPath {
  const coreId = input.coreId ?? BLOG_DEFENSE_CORE_NODE_ID;
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const visibleEdges = input.edges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to));
  const { adjacency, edgeByNodes } = buildGraphIndex(visibleEdges);

  const corridorCandidates = input.nodes
    .filter((node) => node.zone === "right_corridor")
    .sort((a, b) => {
      if (b.y !== a.y) return b.y - a.y;
      return b.x - a.x;
    });

  const starts = corridorCandidates.length
    ? corridorCandidates
    : input.nodes.slice().sort((a, b) => {
        if (b.y !== a.y) return b.y - a.y;
        return b.x - a.x;
      });

  if (input.stochastic && starts.length) {
    const stochasticStartWeights = starts.map((node, index) => {
      const yBias = Math.max(1, node.y);
      const rankBias = Math.max(0.35, 1 - index * 0.06);
      return yBias * rankBias;
    });
    const stochasticStart = starts[chooseWeightedIndex(stochasticStartWeights)];
    const stochasticPath = buildStochasticInwardPath(stochasticStart.id, coreId, nodeById, adjacency);
    if (stochasticPath.length) {
      const sequence = buildCompromiseSequenceFromPath(stochasticPath, visibleEdges);
      return {
        nodeIds: sequence.filter((step) => step.kind === "node").map((step) => step.nodeId),
        edgeIds: sequence.filter((step) => step.kind === "edge").map((step) => step.edgeId),
      };
    }
  }

  for (const start of starts) {
    const path = buildPathToCoreWithPreferredApproach(start.id, coreId, nodeById, adjacency);
    if (!path.length) continue;
    const sequence = buildCompromiseSequenceFromPath(path, visibleEdges);
    return {
      nodeIds: sequence.filter((step) => step.kind === "node").map((step) => step.nodeId),
      edgeIds: sequence.filter((step) => step.kind === "edge").map((step) => step.edgeId),
    };
  }

  const fallback = input.nodes
    .filter((node) => node.id !== coreId)
    .sort((a, b) => {
      const core = nodeById.get(coreId);
      if (!core) return 0;
      const aDist = Math.hypot(a.x - core.x, a.y - core.y);
      const bDist = Math.hypot(b.x - core.x, b.y - core.y);
      return bDist - aDist;
    });
  for (const start of fallback) {
    const path = buildPathToCoreWithPreferredApproach(start.id, coreId, nodeById, adjacency);
    if (!path.length) continue;
    const sequence = buildCompromiseSequenceFromPath(path, visibleEdges);
    return {
      nodeIds: sequence.filter((step) => step.kind === "node").map((step) => step.nodeId),
      edgeIds: sequence.filter((step) => step.kind === "edge").map((step) => step.edgeId),
    };
  }

  return {
    nodeIds: nodeById.has(coreId) ? [coreId] : [],
    edgeIds: [],
  };
}

export function buildBlogDefenseCompromiseSequence(): BlogDefenseCompromiseStep[] {
  return buildCompromiseSequenceFromPath(BLOG_DEFENSE_COMPROMISE_PATH, BLOG_DEFENSE_EDGES);
}

export function isBlogDefenseAttackEdge(from: string, to: string): boolean {
  for (let index = 0; index < BLOG_DEFENSE_COMPROMISE_PATH.length - 1; index += 1) {
    const a = BLOG_DEFENSE_COMPROMISE_PATH[index];
    const b = BLOG_DEFENSE_COMPROMISE_PATH[index + 1];
    if ((from === a && to === b) || (from === b && to === a)) return true;
  }
  return false;
}

export function edgeIdForNodes(from: string, to: string, edges: BlogDefenseEdge[]): string | null {
  const edge = edges.find((entry) => (
    (entry.from === from && entry.to === to) || (entry.from === to && entry.to === from)
  ));
  return edge ? edge.id : null;
}
