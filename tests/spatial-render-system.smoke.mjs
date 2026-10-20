import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { RenderSystem } = await vite.ssrLoadModule("/src/systems/render/RenderSystem.ts");
  let consumed = false;
  const applied = [];
  const lodSystem = {
    consumeDirtyChunks() {
      if (consumed) return [];
      consumed = true;
      return [{ chunkId: "A", nextLevel: 2, previousLevel: 1, reason: "distance", distance: 30, chunk: { members: [
        { renderType: "agv", data: { id: "agv-1" } },
        { renderType: "agv", data: null },
        { renderType: "road", data: { id: "road-1" } },
        { data: { id: "ignored" } },
      ] } }];
    },
  };
  const system = new RenderSystem({ lodSystem });
  let updates = 0;
  const unregister = system.registerAdapter("agv", { applyChunkLOD: (event) => applied.push(event), update: () => { updates += 1; }, getMetrics: () => ({ active: 1 }) });
  system.registerAdapter("road", { applyChunkLOD: (event) => applied.push(event) });
  const transitions = system.update();
  assert.equal(transitions.length, 1);
  assert.equal(applied.length, 2);
  assert.deepEqual(applied[0].items, [{ id: "agv-1" }]);
  assert.equal(applied[0].level, 2);
  assert.equal(updates, 1);
  assert.equal(system.getMetrics().appliedItems, 2);
  assert.equal(system.update().length, 0);
  assert.throws(() => system.registerAdapter("road", { applyChunkLOD() {} }), /already registered/);
  assert.equal(unregister(), true);
  assert.equal(unregister(), false);
  assert.equal(system.getMetrics().appliedTransitions, 2);
  assert.equal(system.getMetrics().transitionsByType.agv, 1);
  system.clear();
  assert.equal(system.getMetrics().adapters, 0);
  assert.equal(system.getMetrics().dirtyChunksApplied, 0);
  assert.equal(system.getMetrics().appliedTransitions, 2);
  assert.equal(system.getMetrics().appliedItems, 2);
  assert.deepEqual(system.getMetrics().transitionsByType, { agv: 1, road: 1 });
  assert.throws(() => system.registerAdapter("", { applyChunkLOD() {} }), /non-empty/);

  let failureConsumed = false;
  const failingSystem = new RenderSystem({ lodSystem: { consumeDirtyChunks: () => {
    if (failureConsumed) return [];
    failureConsumed = true;
    return [{
      chunkId: "B", nextLevel: 1, previousLevel: 0, reason: "distance", distance: 10,
      chunk: { members: new Map([["agv-2", { id: "agv-2", renderType: "agv", data: { id: "agv-2" } }]]) },
    }];
  } } });
  let failedAdapterUpdate = 0;
  failingSystem.registerAdapter("agv", {
    applyChunkLOD() { throw new Error("adapter failure"); },
    update() { failedAdapterUpdate += 1; },
  });
  let adapterError;
  try { failingSystem.update(); } catch (error) { adapterError = error; }
  assert.equal(adapterError?.message, "adapter failure");
  assert.equal(failedAdapterUpdate, 0);
  assert.equal(failingSystem.getMetrics().dirtyChunksApplied, 1);
  assert.equal(failingSystem.getMetrics().appliedTransitions, 0);
  assert.equal(failingSystem.update().length, 0);
  assert.equal(failedAdapterUpdate, 1);

  console.log("Spatial RenderSystem behavior checks passed (dispatch grouping, metrics, adapter lifecycle, validation).");
} finally {
  await vite.close();
}
