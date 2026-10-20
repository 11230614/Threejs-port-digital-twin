import assert from "node:assert/strict";
import * as THREE from "three";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  setActivePinia(createPinia());
  const [
    { AssetManager },
    { ContainerRenderManager },
    { ContainerSystem },
    { EntityManager },
    { ComponentTypes },
    { RenderResourceSystem },
    { YardSystem },
  ] = await Promise.all([
    vite.ssrLoadModule("/src/assets/AssetManager.ts"),
    // Load through the legacy production import path to verify JS compatibility forwarding.
    vite.ssrLoadModule("/src/rendering/ContainerRenderManager.ts"),
    vite.ssrLoadModule("/src/ecs/systems/ContainerSystem.ts"),
    vite.ssrLoadModule("/src/ecs/EntityManager.ts"),
    vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts"),
    vite.ssrLoadModule("/src/systems/render/RenderResourceSystem.ts"),
    vite.ssrLoadModule("/src/world/YardSystem.ts"),
  ]);

  let now = 0;
  const sourceGeometryDisposals = { count: 0 };
  const sourceGeometry = new THREE.BoxGeometry(2, 1, 1);
  sourceGeometry.addEventListener("dispose", () => { sourceGeometryDisposals.count += 1; });
  const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0x123456 });
  const gltfScene = new THREE.Group();
  gltfScene.add(new THREE.Mesh(sourceGeometry, sourceMaterial));
  const assetManager = new AssetManager({
    loader: { async load() { return { scene: gltfScene }; } },
    idleDisposeMs: 0,
  });
  assetManager.registerManifest({ id: "container-blue", url: "/container.glb" });
  await assetManager.preload("container-blue");

  const yardSystem = new YardSystem({ sourceAssetIds: ["container-blue"] });
  const block = yardSystem.createBlock(1, 2, 1, 0, 0, { blockId: "BLOCK-A", area: "YARD-A" });
  const [promoted, remaining] = block.containers;
  const scene = new THREE.Scene();
  const renderResources = new RenderResourceSystem({ idleDisposeMs: 100, now: () => now });
  const manager = new ContainerRenderManager({
    scene,
    modelAssetManager: assetManager,
    resourcePool: renderResources.pool,
  });

  manager.initialize([block]);
  assert.equal(assetManager.get("container-blue")?.refCount, 1, "manager retains one canonical asset reference per used asset id");
  manager.applyChunkLOD({ chunkId: block.blockId, items: block.containers, level: 0 });
  assert.equal(manager.getMetrics().visibleInstances, 2);
  assert.equal(manager.getMetrics().drawBatches, 1, "same asset id uses one detailed batch in this chunk");
  assert.equal(renderResources.pool.getMetrics().activeLeases, 1, "one chunk batch holds one pooled-resource lease");
  assert.equal(promoted.renderBinding?.index, 0);
  assert.equal(remaining.renderBinding?.index, 1);

  // Observe the real pooled geometry/material without retaining a lease after this probe.
  const pooled = renderResources.pool.acquire("container:detail:container-blue", { create: () => { throw new Error("existing pooled resource should be reused"); } });
  let pooledGeometryDisposals = 0;
  let pooledMaterialDisposals = 0;
  pooled.geometry.addEventListener("dispose", () => { pooledGeometryDisposals += 1; });
  pooled.material.addEventListener("dispose", () => { pooledMaterialDisposals += 1; });
  assert.equal(renderResources.pool.release("container:detail:container-blue"), true);
  assert.equal(renderResources.pool.getMetrics().activeLeases, 1, "observer lease was returned; manager lease remains");

  const entityManager = new EntityManager();
  const containerSystem = new ContainerSystem({
    scene,
    entityManager,
    yardSystem,
    modelAssetManager: assetManager,
    containerRenderManager: manager,
  });
  assert.equal(containerSystem.reserveForTask(promoted.id, "task-1"), true);
  assert.equal(containerSystem.releaseForTask(promoted.id, "task-1"), promoted);
  assert.equal(promoted.owner, "DYNAMIC");
  assert.equal(promoted.renderBinding, null, "promote detaches the selected record from the shared batch");
  assert.equal(remaining.renderBinding?.index, 0, "InstanceBatch compacts the remaining record after removal");
  assert.equal(manager.getMetrics().visibleInstances, 1, "the unaffected container remains rendered");
  assert.equal(assetManager.get("container-blue")?.refCount, 2, "dynamic Entity acquire adds its own asset reference");
  assert.ok(promoted.entity?.wrapper?.parent === scene);

  entityManager.remove(promoted.id, scene);
  assert.equal(assetManager.get("container-blue")?.refCount, 1, "Entity RenderComponent disposal returns only its dynamic clone reference");
  assert.equal(manager.getMetrics().visibleInstances, 1);

  manager.dispose();
  manager.dispose();
  assert.equal(renderResources.pool.getMetrics().activeLeases, 0, "batch lease is returned exactly once despite repeated manager disposal");
  assert.equal(renderResources.pool.getMetrics().idleResources, 1, "returned pooled resource remains resident during its grace period");
  assert.equal(assetManager.get("container-blue"), null, "manager's final retain is released after the dynamic Entity reference was returned");
  assert.equal(sourceGeometryDisposals.count, 1, "AssetManager disposes its canonical model geometry after the final asset reference");
  now = 99;
  renderResources.update();
  assert.equal(pooledGeometryDisposals, 0, "RenderResourceSystem respects the pool's idle grace period");
  now = 100;
  renderResources.update();
  assert.equal(pooledGeometryDisposals, 1, "pool sweep disposes derived batch geometry after the grace period");
  assert.equal(pooledMaterialDisposals, 1, "pool sweep disposes derived batch material after the grace period");
  assert.equal(renderResources.getMetrics().activeLeases, 0);
  renderResources.dispose();

  // A malformed record triggers a failure after pool acquisition and InstancedMesh creation.
  // The same production manager must roll those partial effects back and remain retryable.
  setActivePinia(createPinia());
  const failureGeometry = new THREE.BoxGeometry(1, 1, 1);
  const failureSceneRoot = new THREE.Group();
  failureSceneRoot.add(new THREE.Mesh(failureGeometry, new THREE.MeshStandardMaterial()));
  const failureAssets = new AssetManager({ loader: { async load() { return { scene: failureSceneRoot }; } } });
  failureAssets.registerManifest([
    { id: "container-blue", url: "/failure-blue.glb" },
    { id: "container-red", url: "/failure-red.glb" },
  ]);
  await Promise.all([failureAssets.preload("container-blue"), failureAssets.preload("container-red")]);
  const failureYard = new YardSystem({ sourceAssetIds: ["container-blue", "container-red"] });
  const failureBlock = failureYard.createBlock(1, 2, 1, 0, 0, { blockId: "BLOCK-FAIL" });
  const [firstFailureRecord, failureRecord] = failureBlock.containers;
  firstFailureRecord.assetId = "container-blue";
  failureRecord.assetId = "container-red";
  const originalPosition = failureRecord.position;
  failureRecord.position = null;
  const failureScene = new THREE.Scene();
  const failureResources = new RenderResourceSystem({ idleDisposeMs: 0, now: () => now });
  const failureManager = new ContainerRenderManager({ scene: failureScene, modelAssetManager: failureAssets, resourcePool: failureResources.pool });
  failureManager.initialize([failureBlock]);
  assert.throws(
    () => failureManager.applyChunkLOD({ chunkId: failureBlock.blockId, items: failureBlock.containers, level: 0 }),
    TypeError,
    "bad record data remains an explicit failure rather than being swallowed",
  );
  assert.equal(failureScene.children.length, 0, "failed creation removes its partial InstancedMesh from the scene");
  assert.equal(failureResources.pool.getMetrics().activeLeases, 0, "failed creation returns the failing lease and any earlier asset-group lease");
  assert.equal(failureResources.pool.getMetrics().idleResources, 2, "both derived resources are returned to the pool after multi-group rollback");
  assert.equal(failureRecord.renderBinding, null);
  assert.equal(firstFailureRecord.renderBinding, null);
  assert.equal(failureManager.getMetrics().drawBatches, 0);

  failureRecord.position = originalPosition;
  failureManager.applyChunkLOD({ chunkId: failureBlock.blockId, items: failureBlock.containers, level: 0 });
  assert.equal(failureManager.getMetrics().visibleInstances, 2, "a later valid LOD update can retry after rollback");
  assert.equal(failureManager.getMetrics().drawBatches, 2, "retry creates one detailed batch per asset group");
  failureManager.dispose();
  assert.equal(failureResources.pool.getMetrics().activeLeases, 0);
  failureResources.dispose();
  failureAssets.clear();

  console.log("Container render lifecycle checks passed (real AssetManager, ContainerSystem promotion, InstanceBatch, GpuResourcePool grace-period disposal, partial-create rollback and retry).");
} finally {
  await vite.close();
}
