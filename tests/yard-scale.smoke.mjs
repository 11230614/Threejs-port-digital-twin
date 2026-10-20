import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { YardSystem } = await vite.ssrLoadModule("/src/world/YardSystem.ts");
  const yard = new YardSystem({ sourceAssetIds: ["box-a", "box-b"] });
  const block = yard.createBlock(20, 25, 20, -100, -120, { blockId: "scale-yard", count: 10_000 });
  assert.equal(block.containers.length, 10_000, "large block creates the requested records");
  assert.equal(yard.getAllContainers().length, 10_000);
  assert.equal(yard.getYardContainers().length, 10_000);
  assert.equal(block.layout.rows, 20);
  assert.equal(block.layout.cols, 25);
  assert.equal(block.layout.layers, 20);

  const floorContainer = block.containers[0];
  const middle = block.containers[9_000];
  assert.ok(middle);
  assert.equal(yard.canReleaseContainer(floorContainer.id), false, "a box under occupied layers is not releasable");
  assert.equal(yard.releaseContainer(floorContainer.id, { requireTop: true }), null);

  const topContainer = block.containers[9_500];
  assert.ok(topContainer);
  assert.equal(yard.canReleaseContainer(topContainer.id), true);
  const released = yard.releaseContainer(topContainer.id, { requireTop: true });
  assert.equal(released, topContainer);
  assert.equal(released.owner, "RELEASED");
  assert.equal(released.state, "RELEASED");
  assert.equal(released.releasedFrom?.slot.layer, 19);
  assert.equal(yard.canReleaseContainer(middle.id), true, "removing the top record exposes the layer below");
  console.log("YardSystem scale checks passed (10,000 records, layout capacity, and stacked release rules).");
} finally {
  await vite.close();
}
