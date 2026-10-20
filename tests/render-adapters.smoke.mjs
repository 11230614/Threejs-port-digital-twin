import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const [{ AGVRenderAdapter }, { CraneRenderAdapter }, { ObjectRenderAdapter }, { GpuResourcePool }, { ComponentTypes }] = await Promise.all([
    vite.ssrLoadModule("/src/systems/render/adapters/AGVRenderAdapter.ts"),
    vite.ssrLoadModule("/src/systems/render/adapters/CraneRenderAdapter.ts"),
    vite.ssrLoadModule("/src/systems/render/adapters/ObjectRenderAdapter.ts"),
    vite.ssrLoadModule("/src/rendering/GpuResourcePool.ts"),
    vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts"),
  ]);
  assert.equal(typeof ObjectRenderAdapter, "function", "the legacy JS import resolves the TS base implementation");
  const resourcePool = new GpuResourcePool();
  const selected = { id: "agv-1" };
  const agv = new AGVRenderAdapter({ resourcePool, selectionSystem: { getSelected: () => selected } });
  assert.equal(agv.renderType, "agv");
  assert.equal(agv.proxyColor, 0x2f8fd5);
  assert.equal(agv.lowDetailRatio, 0.24);
  assert.equal(agv.isPinned(selected), true);

  let task = null;
  const craneEntity = { id: "qc-1", getComponent: (type) => type === ComponentTypes.TASK ? task : null };
  const crane = new CraneRenderAdapter({ resourcePool, selectionSystem: { getSelected: () => null } });
  assert.equal(crane.renderType, "crane");
  assert.equal(crane.proxyColor, 0xe5b62f);
  assert.equal(crane.lowDetailRatio, 0.12);
  assert.equal(crane.isPinned(craneEntity), false);
  task = { state: "MOVE_TO_CONTAINER" };
  assert.equal(crane.isPinned(craneEntity), true);
  task = { state: "IDLE" };
  assert.equal(crane.isPinned(craneEntity), false);
  const selectedCrane = { id: "qc-1", getComponent: () => null };
  const selectedCraneAdapter = new CraneRenderAdapter({ resourcePool, selectionSystem: { getSelected: () => selectedCrane } });
  assert.equal(selectedCraneAdapter.isPinned(selectedCrane), true);
  assert.equal(selectedCraneAdapter.resourcePool, resourcePool);

  const makeEntity = (id, visible = true) => {
    const wrapper = new THREE.Group();
    const detail = new THREE.Group();
    detail.visible = visible;
    detail.userData.assetMetadata = { id: "shared-agv-model" };
    const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial());
    firstMesh.castShadow = true;
    firstMesh.receiveShadow = false;
    const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    secondMesh.castShadow = false;
    secondMesh.receiveShadow = true;
    detail.add(firstMesh, secondMesh);
    wrapper.add(detail);
    return { id, wrapper, renderObject: detail, firstMesh, secondMesh };
  };
  const entityA = makeEntity("agv-a");
  const entityB = makeEntity("agv-b");
  const firstAdapter = new AGVRenderAdapter({ resourcePool });
  const secondAdapter = new AGVRenderAdapter({ resourcePool });
  firstAdapter.applyChunkLOD({ chunkId: "agv-chunk", items: [entityA], level: 2 });
  secondAdapter.applyChunkLOD({ chunkId: "agv-chunk", items: [entityB], level: 2 });
  assert.equal(entityA.renderObject.visible, false);
  assert.equal(entityA.wrapper.children.filter((child) => child.userData.lodProxy).length, 1);
  assert.equal(firstAdapter.states.get("agv-a").proxy.visible, true);
  assert.equal(entityB.wrapper.children.filter((child) => child.userData.lodProxy).length, 1);
  assert.equal(firstAdapter.states.get("agv-a").proxy.geometry, secondAdapter.states.get("agv-b").proxy.geometry,
    "same asset shares pooled proxy geometry while each entity owns a separate Mesh");
  assert.notEqual(firstAdapter.states.get("agv-a").proxy, secondAdapter.states.get("agv-b").proxy,
    "each wrapper receives its own proxy Mesh");
  assert.equal(resourcePool.getMetrics().activeLeases, 2);
  firstAdapter.applyChunkLOD({ chunkId: "agv-chunk", items: [entityA], level: 1 });
  assert.equal(entityA.wrapper.children.some((child) => child.userData.lowDetail), true,
    "LOD1 attaches the actual low-detail mesh under the stable wrapper");
  assert.equal(entityA.firstMesh.castShadow, false);
  assert.equal(entityA.secondMesh.receiveShadow, false);
  assert.equal(resourcePool.getMetrics().activeLeases, 2,
    "switching proxy to low detail releases one lease before acquiring its replacement");
  firstAdapter.applyChunkLOD({ chunkId: "agv-chunk", items: [entityA], level: 0 });
  assert.equal(entityA.renderObject.visible, true);
  assert.equal(entityA.firstMesh.castShadow, true);
  assert.equal(entityA.secondMesh.receiveShadow, true);
  assert.equal(entityA.wrapper.children.some((child) => child.userData.lowDetail), false);
  assert.equal(resourcePool.getMetrics().activeLeases, 1);

  const selectedEntity = { id: "agv-a" };
  const pinnedAdapter = new AGVRenderAdapter({ resourcePool, selectionSystem: { getSelected: () => selectedEntity } });
  const pinnedEntity = makeEntity("agv-a", false);
  pinnedAdapter.applyChunkLOD({ chunkId: "agv-chunk", items: [pinnedEntity], level: 2 });
  assert.equal(pinnedAdapter.getMetrics().levels["0"], 1, "selected entity is pinned to full detail despite requested LOD2");
  assert.equal(pinnedEntity.renderObject.visible, false, "pinning preserves the model's original hidden state");
  assert.equal(pinnedEntity.firstMesh.castShadow, true);
  assert.equal(pinnedEntity.secondMesh.receiveShadow, true);
  assert.equal(resourcePool.getMetrics().activeLeases, 1, "pinned object does not acquire a proxy lease");

  firstAdapter.dispose();
  assert.equal(resourcePool.getMetrics().activeLeases, 1, "disposing one derived adapter returns only its lease");
  assert.equal(entityB.wrapper.children.filter((child) => child.userData.lodProxy).length, 1,
    "base disposal does not detach another adapter's per-entity mesh");
  assert.equal(resourcePool.getMetrics().definitions, 2, "adapter does not dispose the shared pool or its idle definitions");
  secondAdapter.dispose();
  pinnedAdapter.dispose();
  assert.equal(resourcePool.getMetrics().activeLeases, 0);
  assert.equal(resourcePool.getMetrics().definitions, 2);
  resourcePool.dispose();

  const failurePool = new GpuResourcePool();
  const failureEntity = makeEntity("agv-fail");
  let failAttach = true;
  const originalWrapperAdd = failureEntity.wrapper.add.bind(failureEntity.wrapper);
  failureEntity.wrapper.add = (...objects) => {
    if (failAttach) {
      failAttach = false;
      throw new Error("injected wrapper attachment failure");
    }
    return originalWrapperAdd(...objects);
  };
  const failureAdapter = new AGVRenderAdapter({ resourcePool: failurePool });
  assert.throws(
    () => failureAdapter.applyChunkLOD({ chunkId: "agv-failure", items: [failureEntity], level: 2 }),
    /injected wrapper attachment failure/,
  );
  const failedState = failureAdapter.states.get("agv-fail");
  assert.equal(failedState.effectiveLevel, null, "failed first transition is not recorded as applied");
  assert.equal(failedState.proxy, null);
  assert.equal(failureEntity.renderObject.visible, true, "failed first transition restores detail visibility");
  assert.equal(failureEntity.firstMesh.castShadow, true, "failed first transition restores per-mesh shadow state");
  assert.equal(failurePool.getMetrics().activeLeases, 0, "failed wrapper attachment returns its acquired lease");
  failureAdapter.applyChunkLOD({ chunkId: "agv-failure", items: [failureEntity], level: 2 });
  assert.equal(failurePool.getMetrics().activeLeases, 1, "same instance can retry after attachment failure");
  failureAdapter.dispose();
  assert.equal(failurePool.getMetrics().activeLeases, 0);
  failurePool.dispose();

  console.log("Render adapter behavior checks passed (AGV/Crane configuration, pinning, task state, shared pool).");
} finally {
  await vite.close();
}
