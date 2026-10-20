import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { ContainerRenderManager } = await vite.ssrLoadModule("/src/rendering/ContainerRenderManager.ts");
  const scene = new THREE.Scene();
  const calls = { acquire: [], release: [], retain: [], assetRelease: [], poolDispose: 0 };
  const resources = new Map();
  const pool = {
    acquire(key, { create }) {
      calls.acquire.push(key);
      if (!resources.has(key)) resources.set(key, { ...create(), leases: 0 });
      const resource = resources.get(key);
      resource.leases += 1;
      return resource;
    },
    release(key) { calls.release.push(key); const resource = resources.get(key); if (resource) resource.leases -= 1; },
    dispose() { calls.poolDispose += 1; },
  };

  const assetRoot = new THREE.Group();
  assetRoot.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshBasicMaterial()));
  assetRoot.updateMatrixWorld(true);
  const assets = { get: (id) => id === "container-blue" ? { root: assetRoot } : null };
  const modelAssetManager = {
    get: assets.get,
    retain(id) { calls.retain.push(id); },
    release(id) { calls.assetRelease.push(id); },
  };
  const manager = new ContainerRenderManager({ scene, modelAssetManager, resourcePool: pool });
  const record = { id: "container-1", owner: "YARD", assetId: "container-blue", blockId: "block-1", position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
  const block = { id: "block-1", containers: [record] };

  manager.initialize([block]);
  assert.deepEqual(calls.retain, ["container-blue"]);
  assert.throws(() => manager.initialize([block]), /already initialized/);

  manager.applyChunkLOD({ chunkId: "block-1", items: [record], level: 1 });
  assert.equal(manager.getMetrics().visibleInstances, 1);
  assert.equal(manager.getMetrics().loadedChunks, 1);
  const firstCreateCount = manager.getMetrics().chunkCreates;
  manager.applyChunkLOD({ chunkId: "block-1", items: [record], level: 1 });
  assert.equal(manager.getMetrics().chunkCreates, firstCreateCount, "same signature should not rebuild the batch");
  assert.ok(record.renderBinding);

  manager.applyChunkLOD({ chunkId: "block-1", items: [record], level: 3 });
  assert.equal(manager.getMetrics().visibleInstances, 0);
  assert.equal(manager.getMetrics().loadedChunks, 0);
  assert.equal(record.renderBinding, null);
  assert.equal(calls.release.length, 1);

  manager.applyChunkLOD({ chunkId: "block-1", items: [record], level: 0 });
  assert.equal(manager.getMetrics().visibleInstances, 1);
  assert.equal(manager.getMetrics().lodCounts[0], 1);
  manager.detach(record);
  assert.equal(record.renderBinding, null);
  manager.dispose();
  assert.deepEqual(calls.assetRelease, ["container-blue"]);
  assert.equal(calls.poolDispose, 0, "externally owned pool must not be disposed by manager");
  manager.dispose();
  assert.equal(calls.poolDispose, 0);
  console.log("ContainerRenderManager behavior checks passed (initialization, batch reuse, LOD disposal, binding cleanup, asset ownership).");
} finally {
  await vite.close();
}
