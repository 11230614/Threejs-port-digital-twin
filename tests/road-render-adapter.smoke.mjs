import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { RoadRenderAdapter } = await vite.ssrLoadModule("/src/systems/render/adapters/RoadRenderAdapter.ts");
  const { GpuResourcePool } = await vite.ssrLoadModule("/src/rendering/GpuResourcePool.ts");
  const scene = new THREE.Scene();
  const calls = { acquire: [], release: [], dispose: 0 };
  const pool = {
    resources: new Map(),
    acquire(key, { create }) { calls.acquire.push(key); if (!this.resources.has(key)) this.resources.set(key, create()); return this.resources.get(key); },
    release(key) { calls.release.push(key); },
    dispose() { calls.dispose += 1; },
  };
  const surface = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 2), new THREE.MeshBasicMaterial());
  surface.position.set(2, 0, 1);
  surface.castShadow = true;
  surface.receiveShadow = true;
  const decoration = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshBasicMaterial());
  decoration.position.set(0, 0, 0);
  decoration.visible = false;
  scene.add(surface, decoration);
  surface.updateMatrixWorld(true);
  decoration.updateMatrixWorld(true);

  const adapter = new RoadRenderAdapter({ scene, resourcePool: pool });
  const items = [
    { object: surface, kind: "surface", bounds: new THREE.Box3().setFromObject(surface) },
    { object: decoration, kind: "marking", bounds: new THREE.Box3().setFromObject(decoration) },
  ];
  adapter.applyChunkLOD({ chunkId: "road-1", items, level: 1 });
  assert.equal(surface.visible, true);
  assert.equal(surface.castShadow, false);
  assert.equal(surface.receiveShadow, true);
  assert.equal(decoration.visible, false);
  assert.equal(adapter.getMetrics().trackedChunks, 1);

  adapter.applyChunkLOD({ chunkId: "road-1", items, level: 2 });
  assert.equal(surface.visible, false);
  assert.equal(adapter.getMetrics().visibleProxies, 1);
  assert.equal(calls.acquire.length, 1);
  assert.equal(scene.children.includes(surface), true);

  adapter.applyChunkLOD({ chunkId: "road-1", items, level: 0 });
  assert.equal(surface.visible, true);
  assert.equal(surface.castShadow, true);
  assert.equal(surface.receiveShadow, true);
  assert.equal(adapter.getMetrics().visibleProxies, 0);
  assert.equal(calls.release.length, 1);
  assert.equal(adapter.detach({ object: surface }), true);
  assert.equal(surface.visible, false);
  assert.equal(adapter.detach({ object: new THREE.Mesh() }), false);

  adapter.dispose();
  assert.equal(surface.visible, true);
  assert.equal(surface.castShadow, true);
  assert.equal(calls.dispose, 0, "externally owned pool must not be disposed");
  adapter.dispose();
  assert.equal(surface.visible, true, "repeated disposal keeps the original state");
  adapter.applyChunkLOD({ chunkId: "road-invalid", items, level: 4 });
  assert.equal(surface.visible, false, "legacy behavior hides road details for unknown levels");
  assert.equal(adapter.getMetrics().visibleProxies, 0, "unknown levels do not create proxies");

  let now = 0;
  const sharedPool = new GpuResourcePool({ idleDisposeMs: 10, now: () => now });
  const sharedScene = new THREE.Scene();
  const sharedSurface = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 3), new THREE.MeshBasicMaterial());
  sharedScene.add(sharedSurface);
  sharedSurface.updateMatrixWorld(true);
  const sharedItems = [{ object: sharedSurface, kind: "surface", bounds: new THREE.Box3().setFromObject(sharedSurface) }];
  const sharedAdapter = new RoadRenderAdapter({ scene: sharedScene, resourcePool: sharedPool });
  sharedAdapter.applyChunkLOD({ chunkId: "shared-road", items: sharedItems, level: 2 });
  const sharedProxy = sharedAdapter.chunkStates.get("shared-road").proxy;
  const disposeEvents = { geometry: 0, material: 0 };
  sharedProxy.geometry.addEventListener("dispose", () => { disposeEvents.geometry += 1; });
  sharedProxy.material.addEventListener("dispose", () => { disposeEvents.material += 1; });
  assert.equal(sharedPool.getMetrics().activeLeases, 1);
  assert.equal(sharedPool.acquire("road:shared-road:proxy", { create: () => new THREE.Mesh() }), sharedProxy);
  assert.equal(sharedPool.getMetrics().activeLeases, 2, "another owner can retain the pooled proxy");
  sharedAdapter.dispose();
  assert.equal(sharedPool.getMetrics().activeLeases, 1, "adapter returns only its own lease");
  assert.equal(disposeEvents.geometry, 0, "adapter does not dispose a resource still leased by another owner");
  sharedPool.release("road:shared-road:proxy");
  now = 11;
  assert.equal(sharedPool.sweep(), 1, "last lease follows the pool grace-period disposal policy");
  assert.equal(disposeEvents.geometry, 1);
  assert.equal(disposeEvents.material, 1);
  sharedPool.dispose();

  let failAdd = true;
  const failingScene = new THREE.Scene();
  const originalAdd = failingScene.add.bind(failingScene);
  failingScene.add = (...objects) => {
    if (failAdd) { failAdd = false; throw new Error("injected scene attachment failure"); }
    return originalAdd(...objects);
  };
  const failingPool = new GpuResourcePool();
  const failingSurface = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), new THREE.MeshBasicMaterial());
  failingScene.add = originalAdd;
  originalAdd(failingSurface);
  failingSurface.updateMatrixWorld(true);
  failingScene.add = (...objects) => {
    if (failAdd) { failAdd = false; throw new Error("injected scene attachment failure"); }
    return originalAdd(...objects);
  };
  const failingItems = [{ object: failingSurface, kind: "surface", bounds: new THREE.Box3().setFromObject(failingSurface) }];
  const failingAdapter = new RoadRenderAdapter({ scene: failingScene, resourcePool: failingPool });
  assert.throws(
    () => failingAdapter.applyChunkLOD({ chunkId: "retry-road", items: failingItems, level: 2 }),
    /injected scene attachment failure/,
  );
  assert.equal(failingSurface.visible, true, "failed first activation restores original node state");
  assert.equal(failingAdapter.getMetrics().trackedChunks, 0, "failed first activation removes its incomplete chunk state");
  assert.equal(failingPool.getMetrics().activeLeases, 0, "failed attachment returns the acquired pool lease");
  assert.equal(failingScene.children.some((object) => object.userData.lodProxy), false);
  failingAdapter.applyChunkLOD({ chunkId: "retry-road", items: failingItems, level: 2 });
  assert.equal(failingPool.getMetrics().activeLeases, 1, "retry after attachment failure can acquire a clean lease");
  failingAdapter.dispose();
  assert.equal(failingPool.getMetrics().activeLeases, 0);
  failingPool.dispose();

  console.log("RoadRenderAdapter checks passed (LOD 0-4 legacy input, snapshots, lease sharing, failure rollback, retry and disposal).");
} finally {
  await vite.close();
}
