import assert from "node:assert/strict";
import * as THREE from "three";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  setActivePinia(createPinia());
  const [
    { QuayCraneSystem, QuayCraneState },
    { EntityManager },
    { ComponentTypes },
    { QuayCraneComponent },
    { TrolleyComponent },
    { HoistComponent },
    { TaskComponent },
    { TransformComponent },
    { AGVComponent },
  ] = await Promise.all([
    vite.ssrLoadModule("/src/ecs/systems/QuayCraneSystem.ts"),
    vite.ssrLoadModule("/src/ecs/EntityManager.ts"),
    vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts"),
    vite.ssrLoadModule("/src/ecs/components/QuayCraneComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/TrolleyComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/HoistComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/TaskComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/TransformComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/AGVComponent.ts"),
  ]);

  const manager = new EntityManager();
  const scene = new THREE.Scene();
  const gantry = new THREE.Group();
  scene.add(gantry);
  const trolleyNode = new THREE.Group();
  gantry.add(trolleyNode);
  const hoistNode = new THREE.Group();
  hoistNode.position.y = 10;
  trolleyNode.add(hoistNode);
  const spreader = new THREE.Group();
  spreader.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 4), new THREE.MeshBasicMaterial()));
  hoistNode.add(spreader);
  const ropes = new THREE.Group();
  hoistNode.add(ropes);

  const crane = manager.createEntity("crane-1");
  crane.addComponent(ComponentTypes.QUAY_CRANE, new QuayCraneComponent(gantry, trolleyNode, hoistNode, ropes, spreader));
  crane.addComponent(ComponentTypes.TROLLEY, new TrolleyComponent({ node: trolleyNode, speed: 100 }));
  crane.addComponent(ComponentTypes.HOIST, new HoistComponent({ node: hoistNode, speed: 100 }));
  crane.addComponent(ComponentTypes.TASK, new TaskComponent());
  crane.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(gantry));
  manager.add(crane);

  const cargoSlot = new THREE.Group();
  cargoSlot.position.set(0, 1, 12);
  scene.add(cargoSlot);
  const agv = manager.createEntity("agv-1");
  agv.addComponent(ComponentTypes.AGV, new AGVComponent({ cargoSlot }));
  manager.add(agv);

  const containerWrapper = new THREE.Group();
  containerWrapper.position.set(0, 2, -12);
  containerWrapper.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 4), new THREE.MeshBasicMaterial()));
  scene.add(containerWrapper);
  const containerEntity = manager.createEntity("container-1");
  containerEntity.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(containerWrapper));
  manager.add(containerEntity);
  const container = { id: "container-1", entity: containerEntity, state: "ON_SHIP", location: "ship-1", taskId: null };

  const system = new QuayCraneSystem({ entityManager: manager });
  system.registerShipContainer(container);
  assert.equal(system.acquireShipContainer("task-1"), container, "first eligible ship container is locked to the task");
  assert.equal(system.acquireShipContainer("task-2"), null, "an already reserved ship container cannot be acquired twice");

  const stateChanges = [];
  let completedOperation = null;
  const accepted = system.start({
    crane,
    agv,
    container,
    taskId: "task-1",
    onStateChange: (state, index) => stateChanges.push([state, index]),
    onComplete: (operation) => {
      completedOperation = operation;
      assert.equal(crane.getComponent(ComponentTypes.TASK).operation, operation, "completion callback runs before TaskComponent.clear");
      assert.equal(operation.container.state, "ON_AGV");
    },
  });
  assert.equal(accepted, true);
  assert.equal(crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.MOVE_TO_CONTAINER);
  assert.equal(system.start({ crane, agv, container, taskId: "task-2" }), false, "busy crane rejects a second operation");

  for (let frame = 0; frame < 20 && crane.getComponent(ComponentTypes.TASK).state !== QuayCraneState.IDLE; frame += 1) {
    scene.updateMatrixWorld(true);
    system.update(1);
  }
  scene.updateMatrixWorld(true);

  assert.equal(crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.IDLE, "mechanical state machine reaches idle after all stages");
  assert.equal(crane.getComponent(ComponentTypes.TASK).operation, null, "operation references are cleared after completion callback");
  assert.deepEqual(stateChanges.map(([state]) => state), [
    QuayCraneState.MOVE_TO_CONTAINER,
    QuayCraneState.LOWER_SPREADER_TO_CONTAINER,
    QuayCraneState.ATTACH_CONTAINER,
    QuayCraneState.LIFT_CONTAINER,
    QuayCraneState.MOVE_TO_AGV,
    QuayCraneState.LOWER_SPREADER_TO_AGV,
    QuayCraneState.DETACH_CONTAINER,
    QuayCraneState.LIFT_SPREADER,
  ]);
  assert.deepEqual(stateChanges.map(([, index]) => index), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(container.state, "ON_AGV");
  assert.equal(container.location, agv.id);
  assert.equal(containerWrapper.parent, cargoSlot, "container is reparented under the actual AGV cargo slot");
  assert.ok(completedOperation);
  assert.equal(completedOperation.taskId, "task-1");
  console.log("QuayCraneSystem behavior checks passed (ship reservation, full nine-stage progression, state callbacks and cargo handoff).");
} finally {
  await vite.close();
}
