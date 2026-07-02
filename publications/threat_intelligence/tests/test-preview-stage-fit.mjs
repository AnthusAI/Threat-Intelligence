import test from "node:test";
import assert from "node:assert/strict";

import { computePreviewStageFit } from "../videoml/preview-stage-fit.ts";

test("preview stage fit preserves standard 16:9 article slots", () => {
  const fit = computePreviewStageFit({
    containerHeight: 406,
    containerWidth: 722,
    stageHeight: 720,
    stageWidth: 1280,
  });

  assert.equal(Math.round(fit.width), 722);
  assert.equal(Math.round(fit.height), 406);
  assert.ok(fit.scale > 0.56 && fit.scale < 0.57);
});

test("preview stage fit handles narrower blog rails", () => {
  const fit = computePreviewStageFit({
    containerHeight: 300,
    containerWidth: 533,
    stageHeight: 720,
    stageWidth: 1280,
  });

  assert.equal(Math.round(fit.width), 533);
  assert.equal(Math.round(fit.height), 300);
});

test("preview stage fit expands beyond the old 520px cap on wide layouts", () => {
  const fit = computePreviewStageFit({
    containerHeight: 675,
    containerWidth: 1200,
    stageHeight: 720,
    stageWidth: 1280,
  });

  assert.equal(Math.round(fit.width), 1200);
  assert.equal(Math.round(fit.height), 675);
  assert.ok(fit.height > 520);
});

test("preview stage fit falls back to the stage size when dimensions are missing", () => {
  const fit = computePreviewStageFit({
    containerHeight: 0,
    containerWidth: 0,
    stageHeight: 720,
    stageWidth: 1280,
  });

  assert.equal(fit.scale, 1);
  assert.equal(fit.width, 1280);
  assert.equal(fit.height, 720);
});
