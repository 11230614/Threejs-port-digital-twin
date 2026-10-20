import assert from "node:assert/strict";
import * as THREE from "three";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

class TestCanvas {
  listeners = new Map();
  addCalls = 0;
  removeCalls = 0;
  rect = { left: 100, top: 50, width: 200, height: 100 };
  addEventListener(type, listener) { this.addCalls += 1; this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    this.removeCalls += 1;
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  getBoundingClientRect() { return this.rect; }
  click(clientX, clientY) { this.listeners.get("click")?.({ clientX, clientY }); }
}

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  setActivePinia(createPinia());
  const [{ PickSystem }, { EntityManager }, { TransformComponent }, { SelectableComponent }, { ComponentTypes }, { SelectionSystem }, { useDeviceStore }, { useAssetStore }] = await Promise.all([
    vite.ssrLoadModule("/src/ecs/systems/PickSystem.ts"),
    vite.ssrLoadModule("/src/ecs/EntityManager.ts"),
    vite.ssrLoadModule("/src/ecs/components/TransformComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/SelectableComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts"),
    vite.ssrLoadModule("/src/ecs/systems/SelectionSystem.ts"),
    vite.ssrLoadModule("/src/stores/DeviceStore.ts"),
    vite.ssrLoadModule("/src/stores/AssetStore.ts"),
  ]);
  const deviceStore = useDeviceStore();
  const assetStore = useAssetStore();
  const entityManager = new EntityManager();
  const entity = entityManager.createEntity("pick-entity-1");
  const wrapper = new THREE.Group();
  wrapper.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  entity.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(wrapper));
  entity.addComponent(ComponentTypes.SELECTABLE, new SelectableComponent());
  entityManager.add(entity);

  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  wrapper.updateMatrixWorld(true);
  const canvas = new TestCanvas();
  const pickSystem = new PickSystem(camera, canvas, entityManager);
  const selectionSystem = new SelectionSystem(entityManager);
  const observed = [];
  pickSystem.onPick((picked) => { observed.push(picked); selectionSystem.select(picked); });
  assert.equal(canvas.addCalls, 1, "constructor registers exactly one canvas click listener");

  canvas.click(200, 100);
  assert.equal(observed[0], entity, "center canvas ray resolves the actual ECS entity");
  assert.equal(deviceStore.currentEntity, entity);
  assert.equal(assetStore.selectedAssetId, null);

  canvas.click(101, 51);
  assert.equal(observed[1], null, "a ray with no target reports null through the same callback");
  assert.equal(deviceStore.currentEntity, null, "blank-space click clears the authoritative selection");
  assert.equal(entity.selectable.isSelected, false);

  wrapper.visible = false;
  canvas.click(200, 100);
  assert.equal(observed[2], null, "an invisible ancestor is filtered even when the mesh is raycastable");
  wrapper.visible = true;
  canvas.click(200, 100);
  assert.equal(observed[3], entity, "restoring visibility makes the entity pickable again");

  entityManager.remove(entity.id, new THREE.Scene());
  canvas.click(200, 100);
  assert.equal(observed[4], null, "removed entity wrapper is no longer part of the pickable set");
  assert.equal(deviceStore.currentEntity, null);

  pickSystem.destroy();
  pickSystem.destroy();
  assert.equal(canvas.listeners.has("click"), false, "destroy unregisters the exact listener");
  assert.equal(canvas.removeCalls, 2, "repeated destroy delegates to idempotent DOM removal");
  const observedAfterDestroy = observed.length;
  canvas.click(200, 100);
  assert.equal(observed.length, observedAfterDestroy, "click after destroy does not call subscribers");
  console.log("PickSystem behavior checks passed (real raycast, visibility, selection clear, entity removal and listener teardown).");
} finally {
  await vite.close();
}
