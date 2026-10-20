import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { LODSystem } = await vite.ssrLoadModule("/src/systems/lod/LODSystem.ts");
  const levels = [
    { level: 0, enter: 10, exit: 12 },
    { level: 1, enter: 20, exit: 24 },
  ];
  const camera = new THREE.Vector3(0, 0, 0);
  const chunk = (distance, extra = {}) => ({ key: "A", bounds: new THREE.Box3(new THREE.Vector3(distance, 0, 0), new THREE.Vector3(distance, 0, 0)), distance, revision: 1, ...extra });

  const lod = new LODSystem({ levels, hiddenLevel: 3, debounceMs: 100 });
  let dirty = lod.update({ cameraPosition: camera, activeChunks: [chunk(5)], timestamp: 0 });
  assert.equal(dirty[0].nextLevel, 0);
  assert.equal(dirty[0].reason, "initial");
  assert.equal(lod.peekDirtyChunks().length, 1);
  assert.equal(lod.consumeDirtyChunks().length, 1);
  assert.equal(lod.consumeDirtyChunks().length, 0);

  dirty = lod.update({ cameraPosition: camera, activeChunks: [chunk(15)], timestamp: 10 });
  assert.equal(dirty.length, 0, "candidate is debounced");
  dirty = lod.update({ cameraPosition: camera, activeChunks: [chunk(15)], timestamp: 110 });
  assert.equal(dirty[0].nextLevel, 1);
  lod.consumeDirtyChunks();

  // Exit hysteresis keeps LOD1 while the distance remains inside its exit band.
  dirty = lod.update({ cameraPosition: camera, activeChunks: [chunk(21)], timestamp: 120 });
  assert.equal(dirty.length, 0);
  dirty = lod.update({ cameraPosition: camera, activeChunks: [chunk(30)], timestamp: 130 });
  assert.equal(dirty.length, 0);
  dirty = lod.update({ cameraPosition: camera, activeChunks: [chunk(30)], timestamp: 230 });
  assert.equal(dirty[0].nextLevel, 3);
  lod.consumeDirtyChunks();

  const changed = chunk(30, { revision: 2 });
  dirty = lod.update({ cameraPosition: camera, activeChunks: [changed], timestamp: 240 });
  assert.equal(dirty[0].reason, "members");
  lod.consumeDirtyChunks();
  lod.update({ cameraPosition: camera, activeChunks: [], timestamp: 250 });
  assert.equal(lod.getLevel("A"), 3);
  assert.equal(lod.getMetrics().trackedChunks, 1);
  lod.clear();
  assert.equal(lod.getMetrics().trackedChunks, 0);
  assert.throws(() => new LODSystem({ levels: [{ level: 0, enter: 2, exit: 1 }] }), RangeError);
  assert.throws(() => lod.update({ cameraPosition: {}, activeChunks: [] }), TypeError);
  console.log("LODSystem behavior checks passed (thresholds, hysteresis, debounce, dirty lifecycle, revisions, inactive chunks).");
} finally {
  await vite.close();
}
