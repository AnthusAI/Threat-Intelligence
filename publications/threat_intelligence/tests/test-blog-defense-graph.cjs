#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const {
  BLOG_DEFENSE_CORE_NODE_ID,
  BLOG_DEFENSE_NODES,
  BLOG_DEFENSE_EDGES,
  BLOG_DEFENSE_COMPROMISE_PATH,
  buildVisibleAttackPath,
  buildCompromiseSequenceFromPath,
} = require("../blog-defense/graph.ts");
const { layoutDefenseGraph } = require("../blog-defense/layout.ts");

const AZIMUTH_KEYS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const RING_PREFIXES = ["mid", "ring", "outer", "halo"];
const LEFT_ARM_HALO_TARGET_IDS = new Set(["halo_n", "halo_nw", "halo_w"]);
const RIGHT_ARM_HALO_TARGET_IDS = new Set(["halo_e", "halo_se", "halo_s", "halo_sw"]);
// Legacy hand-placed shoulder/bridge nodes must stay gone: the truss lanes and
// the halo attachments replace them.
const REMOVED_LEGACY_NODE_IDS = [
  "left_bridge_top",
  "left_attach_top",
  "left_attach_bottom",
  "left_tip",
  "right_bridge_top",
  "right_bridge_peak",
  "right_attach_top",
  "right_attach_bottom",
];
const LEFT_ARM_LANES = [
  Array.from({ length: 12 }, (_, index) => `left_a${index}`),
  Array.from({ length: 4 }, (_, index) => `left_b${index}`),
  Array.from({ length: 2 }, (_, index) => `left_c${index}`),
];
const RIGHT_ARM_LANES = [
  Array.from({ length: 7 }, (_, index) => `right_a${index}`),
  Array.from({ length: 4 }, (_, index) => `right_b${index}`),
  Array.from({ length: 2 }, (_, index) => `right_c${index}`),
];
// Lane ends whose three nodes must sit on one straight taper line per arm.
const LEFT_TAPER_IDS = ["left_a6", "left_b3", "left_c1"];
const RIGHT_TAPER_IDS = ["right_a6", "right_b3", "right_c1"];

function nodeById(nodes, id) {
  return nodes.find((node) => node.id === id);
}

function crossProduct(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function assertUniformGaps(values, tolerance, message) {
  assert.ok(values.length >= 2, `${message}: needs at least two values`);
  const gaps = [];
  for (let index = 1; index < values.length; index += 1) {
    gaps.push(values[index] - values[index - 1]);
  }
  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  assert.ok(
    gaps.every((gap) => Math.abs(gap - avgGap) <= tolerance),
    `${message} (gaps ${gaps.map((gap) => gap.toFixed(2)).join(", ")})`,
  );
}

// --- static template ---------------------------------------------------

assert.equal(BLOG_DEFENSE_COMPROMISE_PATH[0], "corridor_4");
assert.equal(BLOG_DEFENSE_COMPROMISE_PATH.at(-1), BLOG_DEFENSE_CORE_NODE_ID);
for (let index = 0; index < BLOG_DEFENSE_COMPROMISE_PATH.length - 1; index += 1) {
  const from = BLOG_DEFENSE_COMPROMISE_PATH[index];
  const to = BLOG_DEFENSE_COMPROMISE_PATH[index + 1];
  assert.ok(
    BLOG_DEFENSE_EDGES.some((edge) => (
      (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
    )),
    `static compromise path must follow real template edges (${from} -> ${to})`,
  );
}

for (const id of REMOVED_LEGACY_NODE_IDS) {
  assert.ok(!BLOG_DEFENSE_NODES.some((node) => node.id === id), `${id} should be removed from the roster`);
}

const templateCore = nodeById(BLOG_DEFENSE_NODES, BLOG_DEFENSE_CORE_NODE_ID);
assert.ok(templateCore);

const ringRadii = {};
for (const prefix of RING_PREFIXES) {
  const ringNodes = AZIMUTH_KEYS.map((key) => nodeById(BLOG_DEFENSE_NODES, `${prefix}_${key}`));
  assert.ok(ringNodes.every(Boolean), `${prefix} ring should have all 8 azimuth nodes`);
  const radii = ringNodes.map((node) => Math.hypot(node.x - templateCore.x, node.y - templateCore.y));
  const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  assert.ok(
    radii.every((radius) => Math.abs(radius - meanRadius) <= 0.5),
    `${prefix} ring must be a true concentric ring (radii ${radii.map((r) => r.toFixed(1)).join(", ")})`,
  );
  ringRadii[prefix] = meanRadius;
}
assert.ok(
  ringRadii.mid < ringRadii.ring && ringRadii.ring < ringRadii.outer && ringRadii.outer < ringRadii.halo,
  "ring radii must increase outward",
);
assert.ok(
  ringRadii.mid >= ringRadii.ring * 0.66,
  `first core ring should not be too tight (${ringRadii.mid} vs ${ringRadii.ring})`,
);

for (const lanes of [LEFT_ARM_LANES, RIGHT_ARM_LANES]) {
  const horizontal = lanes === LEFT_ARM_LANES;
  const laneCross = [];
  for (const laneIds of lanes) {
    const laneNodes = laneIds.map((id) => nodeById(BLOG_DEFENSE_NODES, id));
    assert.ok(laneNodes.every(Boolean), `template lane ${laneIds[0]}.. should be complete`);
    const cross = horizontal ? laneNodes.map((node) => node.y) : laneNodes.map((node) => node.x);
    const along = horizontal ? laneNodes.map((node) => node.x) : laneNodes.map((node) => node.y);
    assert.ok(
      cross.every((value) => Math.abs(value - cross[0]) <= 0.001),
      `template lane ${laneIds[0]}.. must be straight`,
    );
    assertUniformGaps(along, 0.001, `template lane ${laneIds[0]}.. must have uniform pitch`);
    laneCross.push(cross[0]);
  }
  assertUniformGaps(laneCross, 0.001, "template arm lanes must have a uniform lane gap");
}
for (const taperIds of [LEFT_TAPER_IDS, RIGHT_TAPER_IDS]) {
  const [a, b, c] = taperIds.map((id) => nodeById(BLOG_DEFENSE_NODES, id));
  assert.ok(a && b && c);
  assert.ok(
    Math.abs(crossProduct(a, b, c)) <= 0.001,
    `taper lane ends ${taperIds.join(", ")} must be collinear`,
  );
}

const templateCorridor = BLOG_DEFENSE_NODES.filter((node) => node.zone === "right_corridor");
const templateRightRailX = nodeById(BLOG_DEFENSE_NODES, "right_a0").x;
assert.ok(templateCorridor.every((node) => node.protectedIngress === true));
assert.ok(
  templateCorridor.every((node) => Math.abs(node.x - templateRightRailX) <= 0.001),
  "corridor must continue the right rail as one single-file line",
);
assertUniformGaps(
  templateCorridor.map((node) => node.y).sort((a, b) => a - b),
  0.001,
  "corridor nodes must be evenly spaced",
);

const zoneCounts = BLOG_DEFENSE_NODES.reduce((acc, node) => {
  acc[node.zone] = (acc[node.zone] ?? 0) + 1;
  return acc;
}, {});
assert.ok(zoneCounts.core >= 8);
assert.ok(zoneCounts.left_arm >= 6);
assert.ok(zoneCounts.right_arm >= 6);
assert.ok(zoneCounts.right_corridor >= 5);

// --- responsive layout --------------------------------------------------

const desktopLayout = layoutDefenseGraph({ width: 720, height: 430 });
const tabletLayout = layoutDefenseGraph({ width: 520, height: 330 });
const mobileLayout = layoutDefenseGraph({ width: 280, height: 230 });
const namedLayouts = [
  { name: "desktop", width: 720, layout: desktopLayout },
  { name: "tablet", width: 520, layout: tabletLayout },
  { name: "mobile", width: 280, layout: mobileLayout },
];

function visibleLane(layout, laneIds) {
  return laneIds
    .map((id) => nodeById(layout.nodes, id))
    .filter(Boolean);
}

function assertLaneRegularity(name, layout, lanes, horizontal) {
  const laneCross = [];
  for (const laneIds of lanes) {
    const laneNodes = visibleLane(layout, laneIds);
    if (!laneNodes.length) continue;
    const cross = laneNodes.map((node) => (horizontal ? node.y : node.x));
    assert.ok(
      cross.every((value) => Math.abs(value - cross[0]) <= 0.5),
      `${name} lane ${laneIds[0]}.. should stay straight after layout`,
    );
    laneCross.push(cross[0]);

    // Pitch must stay uniform between consecutive surviving template slots;
    // culling may truncate a lane but never reshapes it.
    const pitchGaps = [];
    for (let index = 1; index < laneIds.length; index += 1) {
      const previous = nodeById(layout.nodes, laneIds[index - 1]);
      const current = nodeById(layout.nodes, laneIds[index]);
      if (!previous || !current) continue;
      pitchGaps.push(Math.abs(horizontal ? current.x - previous.x : current.y - previous.y));
    }
    if (pitchGaps.length >= 2) {
      const avgPitch = pitchGaps.reduce((sum, gap) => sum + gap, 0) / pitchGaps.length;
      assert.ok(
        pitchGaps.every((gap) => Math.abs(gap - avgPitch) <= 0.5),
        `${name} lane ${laneIds[0]}.. pitch should stay uniform (${pitchGaps.map((gap) => gap.toFixed(2)).join(", ")})`,
      );
    }
  }
  if (laneCross.length >= 2) {
    assertUniformGaps(laneCross, 0.5, `${name} arm lane gap should stay uniform`);
  }
}

for (const { name, width, layout } of namedLayouts) {
  assert.ok(layout.nodes.length > 0);
  assert.ok(layout.edges.length > 0);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(layout.edges.every((edge) => Number.isFinite(edge.x1) && Number.isFinite(edge.y1)));

  const nodeRadii = layout.nodes.map((node) => node.radius);
  const minRadius = Math.min(...nodeRadii);
  const maxRadius = Math.max(...nodeRadii);
  assert.ok(
    Math.abs(maxRadius - minRadius) <= 0.001,
    `${name} should render all node dots at a uniform radius`,
  );

  for (let a = 0; a < layout.nodes.length; a += 1) {
    for (let b = a + 1; b < layout.nodes.length; b += 1) {
      const distance = Math.hypot(
        layout.nodes[a].x - layout.nodes[b].x,
        layout.nodes[a].y - layout.nodes[b].y,
      );
      assert.ok(
        distance >= minRadius * 2,
        `${name} nodes must never overlap (${layout.nodes[a].id} vs ${layout.nodes[b].id})`,
      );
    }
  }

  assert.ok(
    !layout.edges.some((edge) => edge.id.startsWith("left_shoulder_") || edge.id.startsWith("right_shoulder_")),
    `${name} should not render static shoulder edges (they are rebuilt dynamically)`,
  );
  assert.ok(
    layout.edges.every((edge) => (
      layout.nodes.some((node) => node.id === edge.from)
      && layout.nodes.some((node) => node.id === edge.to)
    )),
    `${name} edges must reference visible nodes`,
  );

  const coreCenter = nodeById(layout.nodes, BLOG_DEFENSE_CORE_NODE_ID);
  assert.ok(coreCenter, `${name} should keep a core node`);

  // Every ring that survives culling must stay perfectly concentric.
  for (const prefix of RING_PREFIXES) {
    const ringNodes = layout.nodes.filter((node) => node.id.startsWith(`${prefix}_`) && node.zone === "core");
    if (ringNodes.length < 2) continue;
    const radii = ringNodes.map((node) => Math.hypot(node.x - coreCenter.x, node.y - coreCenter.y));
    const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
    assert.ok(
      radii.every((radius) => Math.abs(radius - meanRadius) <= 0.5),
      `${name} ${prefix} ring should stay concentric after layout`,
    );
  }

  // Left arm: flat rail hugging the top, uniform truss, straight leftward taper.
  const leftLanes = LEFT_ARM_LANES.map((laneIds) => visibleLane(layout, laneIds));
  if (leftLanes[0].length >= 2) {
    assertLaneRegularity(name, layout, LEFT_ARM_LANES, true);

    const laneLeftEdges = leftLanes
      .filter((laneNodes) => laneNodes.length > 0)
      .map((laneNodes) => Math.min(...laneNodes.map((node) => node.x - node.radius)));
    for (let index = 1; index < laneLeftEdges.length; index += 1) {
      assert.ok(
        laneLeftEdges[index] >= laneLeftEdges[index - 1] - 0.001,
        `${name} left-arm lower lanes should taper inward from the rail`,
      );
    }

    const leftTaper = LEFT_TAPER_IDS.map((id) => nodeById(layout.nodes, id));
    if (leftTaper.every(Boolean)) {
      assert.ok(
        Math.abs(crossProduct(...leftTaper)) <= 1,
        `${name} left-arm taper ends should stay collinear`,
      );
    }

    const leftAttachments = layout.edges.filter((edge) => edge.id.startsWith("left_dynamic_attach_"));
    assert.ok(leftAttachments.length >= 2, `${name} should keep rebuilt left-arm attachments`);
    assert.ok(
      leftAttachments.every((edge) => LEFT_ARM_HALO_TARGET_IDS.has(edge.to)),
      `${name} left-arm attachments must target left halo azimuths only`,
    );
    const expectedLeft = [
      ["left_a0", "halo_n"],
      ["left_b0", "halo_nw"],
      ["left_c0", "halo_w"],
    ];
    for (const [sourceId, targetId] of expectedLeft) {
      if (!nodeById(layout.nodes, sourceId) || !nodeById(layout.nodes, targetId)) continue;
      const attachment = leftAttachments.find((edge) => edge.from === sourceId);
      assert.ok(attachment, `${name} ${sourceId} should have a halo attachment`);
      assert.equal(
        attachment.to,
        targetId,
        `${name} ${sourceId} should splay to ${targetId} when unobstructed`,
      );
    }
  }

  // Right arm: straight rail hugging the right edge, uniform truss, downward taper.
  const rightLanes = RIGHT_ARM_LANES.map((laneIds) => visibleLane(layout, laneIds));
  if (rightLanes[0].length >= 2) {
    assertLaneRegularity(name, layout, RIGHT_ARM_LANES, false);

    const coreNodes = layout.nodes.filter((node) => node.zone === "core");
    const coreRight = Math.max(...coreNodes.map((node) => node.x + node.radius));
    const rightArmNodes = layout.nodes.filter((node) => node.zone === "right_arm");
    const rightArmRight = Math.max(...rightArmNodes.map((node) => node.x + node.radius));
    assert.ok(
      rightArmRight <= coreRight + 0.001,
      `${name} right arm must not extend beyond core right edge (${rightArmRight} > ${coreRight})`,
    );

    const laneBottomEdges = rightLanes
      .filter((laneNodes) => laneNodes.length > 0)
      .map((laneNodes) => Math.max(...laneNodes.map((node) => node.y + node.radius)));
    for (let index = 1; index < laneBottomEdges.length; index += 1) {
      assert.ok(
        laneBottomEdges[index] <= laneBottomEdges[index - 1] + 0.001,
        `${name} right-arm inner lanes should taper upward from the rail (downward point)`,
      );
    }

    const rightTaper = RIGHT_TAPER_IDS.map((id) => nodeById(layout.nodes, id));
    if (rightTaper.every(Boolean)) {
      assert.ok(
        Math.abs(crossProduct(...rightTaper)) <= 1,
        `${name} right-arm taper ends should stay collinear`,
      );
    }

    const rightAttachments = layout.edges.filter((edge) => edge.id.startsWith("right_dynamic_attach_"));
    assert.ok(rightAttachments.length >= 3, `${name} should keep rebuilt right-arm attachments`);
    assert.ok(
      rightAttachments.every((edge) => RIGHT_ARM_HALO_TARGET_IDS.has(edge.to)),
      `${name} right-arm attachments must target right halo azimuths only`,
    );
    const expectedRight = [
      ["right_a0", "halo_e"],
      ["right_b0", "halo_se"],
      ["right_c0", "halo_s"],
    ];
    for (const [sourceId, targetId] of expectedRight) {
      if (!nodeById(layout.nodes, sourceId) || !nodeById(layout.nodes, targetId)) continue;
      const attachment = rightAttachments.find((edge) => edge.from === sourceId);
      assert.ok(attachment, `${name} ${sourceId} should have a halo attachment`);
      assert.equal(
        attachment.to,
        targetId,
        `${name} ${sourceId} should splay to ${targetId} when unobstructed`,
      );
    }
  }

  // Margin hugging: the right rail sits flush against the right edge and the
  // top rail flush against the top edge of the container.
  const maxNodeRight = Math.max(...layout.nodes.map((node) => node.x));
  assert.ok(
    maxNodeRight >= width - minRadius - 4,
    `${name} right rail should hug the right edge (max x ${maxNodeRight.toFixed(1)} of ${width})`,
  );
  const minNodeTop = Math.min(...layout.nodes.map((node) => node.y));
  assert.ok(
    minNodeTop <= minRadius + 5,
    `${name} top rail should hug the top edge (min y ${minNodeTop.toFixed(1)})`,
  );

  // Past the shoulder wedge each arm must thin to a single-file margin line.
  const rightRailNode = nodeById(layout.nodes, "right_a0");
  const rightTaperEnd = nodeById(layout.nodes, "right_a6");
  if (rightRailNode && rightTaperEnd) {
    const marginNodes = layout.nodes.filter((node) => (
      (node.zone === "right_arm" || node.zone === "right_corridor") && node.y > rightTaperEnd.y + 1
    ));
    assert.ok(
      marginNodes.every((node) => Math.abs(node.x - rightRailNode.x) <= 0.5),
      `${name} the descent below the shoulder must be single-file on the right margin`,
    );
  }
  const leftRailNode = nodeById(layout.nodes, "left_a0");
  const leftTaperEnd = nodeById(layout.nodes, "left_a6");
  if (leftRailNode && leftTaperEnd) {
    const marginNodes = layout.nodes.filter((node) => (
      node.zone === "left_arm" && node.x < leftTaperEnd.x - 1
    ));
    assert.ok(
      marginNodes.every((node) => Math.abs(node.y - leftRailNode.y) <= 0.5),
      `${name} the leftward stretch past the shoulder must be single-file on the top margin`,
    );
  }
}

// --- margin rail extensions ------------------------------------------------

const tallLayout = layoutDefenseGraph({ width: 720, height: 900 });
const tallRail = nodeById(tallLayout.nodes, "right_a0");
const tallExtension = tallLayout.nodes.filter((node) => node.id.startsWith("corridor_ext_"));
assert.ok(tallRail, "tall layout should keep the right rail");
assert.ok(tallExtension.length >= 3, "tall containers should extend the ingress rail down the margin");
assert.ok(
  tallExtension.every((node) => node.zone === "right_corridor" && node.protectedIngress === true),
  "extension nodes must be attack ingress nodes",
);
assert.ok(
  tallExtension.every((node) => Math.abs(node.x - tallRail.x) <= 0.5),
  "extension nodes must continue the rail column",
);
const tallPitch = 42 * tallLayout.scale;
const tallDeepest = Math.max(...tallExtension.map((node) => node.y));
assert.ok(
  tallDeepest >= 900 - tallPitch - 10,
  `extended rail should reach the container bottom (deepest ${tallDeepest.toFixed(1)})`,
);
const tallCorridorChain = tallLayout.nodes
  .filter((node) => node.zone === "right_corridor")
  .sort((a, b) => a.y - b.y);
for (let index = 0; index < tallCorridorChain.length - 1; index += 1) {
  const from = tallCorridorChain[index];
  const to = tallCorridorChain[index + 1];
  assert.ok(
    tallLayout.edges.some((edge) => (
      (edge.from === from.id && edge.to === to.id) || (edge.from === to.id && edge.to === from.id)
    )),
    `extended ingress rail must stay chained (${from.id} -> ${to.id})`,
  );
}

const leftExtension = desktopLayout.nodes.filter((node) => node.id.startsWith("left_ext_"));
const desktopLeftRail = nodeById(desktopLayout.nodes, "left_a0");
assert.ok(desktopLeftRail, "desktop layout should keep the top rail");
assert.ok(leftExtension.length >= 1, "the top rail should extend leftward across the container");
assert.ok(
  leftExtension.every((node) => Math.abs(node.y - desktopLeftRail.y) <= 0.5),
  "left extension nodes must continue the top rail",
);
const desktopPitch = 42 * desktopLayout.scale;
const leftExtensionMin = Math.min(...leftExtension.map((node) => node.x));
assert.ok(
  leftExtensionMin <= 18 + desktopLeftRail.radius + desktopPitch,
  `left extension should reach the content padding (leftmost ${leftExtensionMin.toFixed(1)})`,
);

const desktopCore = nodeById(desktopLayout.nodes, BLOG_DEFENSE_CORE_NODE_ID);
assert.ok(desktopCore);
assert.ok(desktopCore.x > 470, "core should remain in the top-right region");
assert.ok(desktopCore.y < 210, "core should remain near top area");

const corridorVisible = desktopLayout.nodes
  .filter((node) => node.zone === "right_corridor")
  .sort((a, b) => b.y - a.y);
assert.ok(corridorVisible.length >= 1, "at least one right-corridor node should survive");
assert.ok(corridorVisible[0].x > 640, "corridor should stay in right margin");

// --- obstacle culling ----------------------------------------------------

const blockedLayout = layoutDefenseGraph({
  width: 720,
  height: 430,
  obstacles: [
    { x: 635, y: 210, width: 85, height: 130 },
  ],
});
const blockedCorridor = blockedLayout.nodes.filter((node) => node.zone === "right_corridor");
assert.ok(blockedCorridor.length >= 1, "corridor should still have visible points after culling");
assert.ok(
  blockedLayout.edges.every((edge) => (
    blockedLayout.nodes.some((node) => node.id === edge.from)
    && blockedLayout.nodes.some((node) => node.id === edge.to)
  )),
  "all visible edges must reference surviving visible nodes",
);

const collisionProbe = nodeById(desktopLayout.nodes, "left_c0");
assert.ok(collisionProbe, "expected a stable left-arm lane node for collision regression");
const collisionLayout = layoutDefenseGraph({
  width: 720,
  height: 430,
  obstacles: [
    { x: collisionProbe.x - 6, y: collisionProbe.y - 6, width: 12, height: 12 },
  ],
});
assert.ok(
  !collisionLayout.nodes.some((node) => node.id === "left_c0"),
  "a node whose rendered circle overlaps an obstacle should be fully removed",
);
assert.ok(
  collisionLayout.nodes.some((node) => node.id === "left_c1"),
  "an adjacent node outside the obstacle should remain visible",
);
assert.ok(
  collisionLayout.edges.every((edge) => edge.from !== "left_c0" && edge.to !== "left_c0"),
  "edges referencing a removed node should also be removed",
);

const edgeProbeStart = nodeById(desktopLayout.nodes, "left_c0");
const edgeProbeEnd = nodeById(desktopLayout.nodes, "left_c1");
assert.ok(edgeProbeStart && edgeProbeEnd, "expected stable left-arm nodes for edge collision regression");
const edgeMidX = (edgeProbeStart.x + edgeProbeEnd.x) / 2;
const edgeMidY = (edgeProbeStart.y + edgeProbeEnd.y) / 2;
const edgeCollisionLayout = layoutDefenseGraph({
  width: 720,
  height: 430,
  obstacles: [
    { x: edgeMidX - 2, y: edgeMidY - 2, width: 4, height: 4 },
  ],
});
assert.ok(
  edgeCollisionLayout.nodes.some((node) => node.id === "left_c0")
  && edgeCollisionLayout.nodes.some((node) => node.id === "left_c1"),
  "nodes adjacent to an edge-only obstacle should survive when not overlapped",
);
assert.ok(
  !edgeCollisionLayout.edges.some((edge) => (
    (edge.from === "left_c0" && edge.to === "left_c1")
    || (edge.from === "left_c1" && edge.to === "left_c0")
  )),
  "an edge intersecting an obstacle should be removed even when both endpoint nodes survive",
);

// --- attack path ----------------------------------------------------------

const visiblePath = buildVisibleAttackPath({
  nodes: desktopLayout.nodes,
  edges: desktopLayout.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
  coreId: BLOG_DEFENSE_CORE_NODE_ID,
});
assert.ok(visiblePath.nodeIds.length >= 2);
assert.equal(visiblePath.nodeIds.at(-1), BLOG_DEFENSE_CORE_NODE_ID);
assert.equal(visiblePath.nodeIds.at(-2), "mid_s", "final node before core should be the south mid approach");
assert.ok(visiblePath.nodeIds.includes("mid_s"), "visible path should include the south mid approach node");
assert.ok(visiblePath.edgeIds.includes("mid_to_outer_s"), "visible path should include the south ring-to-mid edge");
assert.ok(visiblePath.edgeIds.includes("mid_spoke_s"), "visible path should include the south mid-to-core edge");
const startNode = nodeById(desktopLayout.nodes, visiblePath.nodeIds[0]);
assert.ok(startNode);
assert.equal(startNode.zone, "right_corridor");

const sequence = buildCompromiseSequenceFromPath(
  visiblePath.nodeIds,
  desktopLayout.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
);
assert.ok(sequence.length >= 3);
assert.equal(sequence[0].kind, "node");
assert.equal(sequence.at(-1).kind, "node");
assert.equal(sequence.at(-1).nodeId, BLOG_DEFENSE_CORE_NODE_ID);

const stochasticPaths = new Set();
const stochasticApproaches = new Set();
for (let index = 0; index < 80; index += 1) {
  const stochasticPath = buildVisibleAttackPath({
    nodes: desktopLayout.nodes,
    edges: desktopLayout.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
    coreId: BLOG_DEFENSE_CORE_NODE_ID,
    stochastic: true,
  });
  stochasticPaths.add(stochasticPath.nodeIds.join(">"));
  stochasticApproaches.add(stochasticPath.nodeIds.at(-2));
}
assert.ok(
  stochasticPaths.size >= 12,
  `stochastic attack paths should vary across cycles, got ${stochasticPaths.size} unique paths`,
);
assert.ok(
  stochasticApproaches.size >= 2,
  `stochastic attack paths should reach multiple core approaches, got ${[...stochasticApproaches].join(", ")}`,
);

const pathEdgeIds = new Set(visiblePath.edgeIds);
for (const edgeId of pathEdgeIds) {
  assert.ok(desktopLayout.edges.some((edge) => edge.id === edgeId), "visible path must use visible edges only");
}

console.log("blog-defense graph/layout tests passed");
