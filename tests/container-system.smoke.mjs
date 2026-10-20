import assert from "node:assert/strict";
import * as THREE from "three";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });

try {
  setActivePinia(createPinia());
  const [{ ContainerSystem, ContainerState }, { YardSystem }, { EntityManager }, { ComponentTypes }] = await Promise.all([
    vite.ssrLoadModule("/src/ecs/systems/ContainerSystem.ts"),
    vite.ssrLoadModule("/src/world/YardSystem.ts"),
    vite.ssrLoadModule("/src/ecs/EntityManager.ts"),
    vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts"),
  ]);
  const yardSystem = new YardSystem({ sourceAssetIds: ["container-model"] });
  yardSystem.createBlock(1, 2, 1, 0, 0, { blockId: "BLOCK-A", area: "YARD-A" });
  const [first, second] = yardSystem.getReleasableContainers();
  const calls = [];
  const scene = new THREE.Scene();
  const modelAssetManager = {
    acquire(assetId) { calls.push(`acquire:${assetId}`); return new THREE.Group(); },
    release(assetId) { calls.push(`release:${assetId}`); },
  };
  const containerRenderManager = { promote(record) { calls.push(`promote:${record.id}`); } };
  const containerSystem = new ContainerSystem({ scene, entityManager: new EntityManager(), yardSystem, modelAssetManager, containerRenderManager });

  assert.equal(containerSystem.registry, yardSystem.containers, "yard registry remains the single shared record map");
  assert.equal(containerSystem.getAvailableContainer(0)?.id, first.id);
  assert.equal(containerSystem.getAvailableContainer(1)?.id, second.id);
  assert.equal(containerSystem.reserveForTask(first.id, "task-a"), true);
  assert.equal(containerSystem.reserveForTask(first.id, "task-b"), false, "a reservation cannot be stolen");
  assert.equal(containerSystem.releaseForTask(first.id, "task-b"), null, "only the reserving task can release the container");

  const released = containerSystem.releaseForTask(first.id, "task-a");
  assert.equal(released, first);
  assert.equal(released.state, ContainerState.RELEASED);
  assert.equal(released.owner, "DYNAMIC");
  assert.equal(released.taskId, "task-a");
  assert.equal(released.reservedBy, null);
  assert.ok(released.entity);
  assert.equal(scene.children.includes(released.entity.wrapper), true);
  assert.deepEqual(calls.slice(0, 2), [`promote:${first.id}`, "acquire:container-model"], "batch promotion precedes model acquisition");

  const agv = containerSystem.entityManager.createEntity("agv-test");
  agv.addComponent(ComponentTypes.TRANSFORM, new (await vite.ssrLoadModule("/src/ecs/components/TransformComponent.ts")).TransformComponent(new THREE.Group()));
  containerSystem.entityManager.add(agv);
  const destination = new THREE.Vector3(12, 3, 9);
  assert.equal(containerSystem.handleAGVArrived({ phase: "PICKUP", agv, position: first.position }, { id: "task-a", containerId: first.id, to: { area: "BERTH-01" } }), first);
  assert.equal(first.state, ContainerState.TRANSPORTING);
  assert.equal(first.location, "AGV");
  assert.equal(first.currentAGV, agv.id);
  assert.equal(first.entity.wrapper.parent, agv.wrapper);
  assert.deepEqual(first.entity.wrapper.position.toArray(), [0, containerSystem.loadOffset.y, 0]);

  assert.equal(containerSystem.handleAGVArrived({ phase: "DELIVERY", agv, position: destination }, { id: "task-a", containerId: first.id, to: { area: "BERTH-01" } }), first);
  assert.equal(first.state, ContainerState.DELIVERED);
  assert.equal(first.location, "BERTH-01");
  assert.equal(first.currentAGV, null);
  assert.equal(first.taskId, null);
  assert.equal(first.entity.wrapper.parent, scene);
  assert.deepEqual(first.entity.wrapper.position.toArray(), destination.toArray());
  assert.equal(containerSystem.handleAGVArrived({ phase: "CHARGING", agv, position: destination }, { id: "task-a", containerId: first.id, to: { area: "BERTH-01" } }), null);

  const render = first.entity.getComponent(ComponentTypes.RENDER);
  render.dispose();
  assert.deepEqual(calls, [`promote:${first.id}`, "acquire:container-model", "release:container-model"], "entity disposal returns the acquired asset once");
  console.log("ContainerSystem behavior checks passed (reservation, promotion, pickup/delivery state, reparenting and asset release).");
} finally {
  await vite.close();
}
