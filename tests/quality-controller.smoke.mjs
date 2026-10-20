import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { QualityController } = await vite.ssrLoadModule("/src/rendering/QualityController.ts");
  const calls = { render: [], renderer: [], composer: [], size: [], lod: [] };
  const controller = new QualityController({
    renderer: { domElement: { clientWidth: 800, clientHeight: 600 }, setPixelRatio: (ratio) => calls.renderer.push(ratio) },
    composer: { setPixelRatio: (ratio) => calls.composer.push(ratio), setSize: (width, height) => calls.size.push([width, height]) },
    renderSystem: { applyQuality: (settings) => calls.render.push(settings) },
    lodSystem: { setQualityLevel: (level, lod) => calls.lod.push([level, lod]) },
    pixelRatioOverride: 0.75,
  });
  controller.apply("medium");
  controller.apply("medium");
  assert.deepEqual(calls.render, [{ pixelRatio: 0.75, bloom: false }]);
  assert.deepEqual(calls.renderer, [0.75]);
  assert.deepEqual(calls.composer, [0.75]);
  assert.deepEqual(calls.size, [[800, 600]]);
  assert.deepEqual(calls.lod, [["medium", 0.8]]);
  controller.apply("low");
  assert.deepEqual(calls.render.at(-1), { pixelRatio: 0.75, bloom: false });
  assert.deepEqual(calls.lod.at(-1), ["low", 0.6]);
  controller.apply("invalid");
  assert.equal(calls.render.length, 2, "invalid levels are ignored");
  console.log("QualityController behavior checks passed (quality mapping, synchronization, deduplicated and invalid levels).");
} finally {
  await vite.close();
}
