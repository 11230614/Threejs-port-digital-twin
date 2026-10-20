// QuayCraneSystem 故障路径：使用真实 ECS 组件、Three.js 场景与 FrameObserver 验证异常隔离和失效依赖。
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
    { FrameObserver },
    { MotionComponent },
    { CraneComponent },
    { MotionSystem },
    { AGVSystem },
    { TaskSystem },
    { EquipmentManager },
    { TaskType },
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
    vite.ssrLoadModule("/src/core/FrameObserver.ts"),
    vite.ssrLoadModule("/src/ecs/components/MotionComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/CraneComponent.ts"),
    vite.ssrLoadModule("/src/ecs/systems/MotionSystem.ts"),
    vite.ssrLoadModule("/src/ecs/systems/AGVSystem.ts"),
    vite.ssrLoadModule("/src/ecs/systems/TaskSystem.ts"),
    vite.ssrLoadModule("/src/managers/EquipmentManager.ts"),
    vite.ssrLoadModule("/src/tasks/TaskCatalog.ts"),
  ]);

  function createFixture(prefix) {
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
    const crane = manager.createEntity(`${prefix}-crane`);
    crane.addComponent(ComponentTypes.QUAY_CRANE, new QuayCraneComponent(gantry, trolleyNode, hoistNode, ropes, spreader));
    crane.addComponent(ComponentTypes.TROLLEY, new TrolleyComponent({ node: trolleyNode, speed: 100 }));
    crane.addComponent(ComponentTypes.HOIST, new HoistComponent({ node: hoistNode, speed: 100 }));
    crane.addComponent(ComponentTypes.TASK, new TaskComponent());
    crane.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(gantry));
    manager.add(crane);

    const cargoSlot = new THREE.Group();
    cargoSlot.position.set(0, 1, 12);
    scene.add(cargoSlot);
    const agv = manager.createEntity(`${prefix}-agv`);
    agv.addComponent(ComponentTypes.AGV, new AGVComponent({ cargoSlot }));
    manager.add(agv);

    const containerWrapper = new THREE.Group();
    containerWrapper.position.set(0, 2, -12);
    containerWrapper.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 4), new THREE.MeshBasicMaterial()));
    scene.add(containerWrapper);
    const containerEntity = manager.createEntity(`${prefix}-container`);
    containerEntity.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(containerWrapper));
    manager.add(containerEntity);
    const container = { id: containerEntity.id, entity: containerEntity, state: "ON_SHIP", location: "ship-1", taskId: `${prefix}-task` };

    return { manager, scene, crane, agv, container, containerWrapper, cargoSlot, system: new QuayCraneSystem({ entityManager: manager }) };
  }

  // 状态通知异常仍向 FrameObserver 报告，但机械动作必须已下达，避免下一帧误推进。
  {
    const fixture = createFixture("state-error");
    const errors = [];
    const observer = new FrameObserver({ onError: (details) => errors.push(details) });
    observer.addTask({ name: "quay-crane", priority: 1, update: (dt) => fixture.system.update(dt) });
    fixture.system.start({
      crane: fixture.crane,
      agv: fixture.agv,
      container: fixture.container,
      taskId: "state-error-task",
      onStateChange: (state) => {
        if (state === QuayCraneState.LOWER_SPREADER_TO_CONTAINER) throw new Error("progress callback failed");
      },
    });
    fixture.scene.updateMatrixWorld(true);
    observer.update(1);
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.LOWER_SPREADER_TO_CONTAINER);
    assert.equal(fixture.crane.getComponent(ComponentTypes.HOIST).isMoving, true, "lowering command survives the observer-captured callback failure");
    assert.equal(errors.length, 1);
    assert.match(errors[0].error.message, /progress callback failed/);
    observer.update(0.01);
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.LOWER_SPREADER_TO_CONTAINER, "next frame does not skip the commanded lowering action");
  }

  // 完成回调异常继续向上交给 Observer；已完成任务仍清理，且不重复通知，其他帧任务继续运行。
  {
    const fixture = createFixture("complete-error");
    const errors = [];
    const observer = new FrameObserver({ onError: (details) => errors.push(details) });
    let callbackCount = 0;
    let unrelatedTaskCalls = 0;
    observer.addTask({ name: "quay-crane", priority: 1, update: (dt) => fixture.system.update(dt) });
    observer.addTask({ name: "unrelated", priority: 2, update: () => { unrelatedTaskCalls += 1; } });
    fixture.system.start({
      crane: fixture.crane,
      agv: fixture.agv,
      container: fixture.container,
      taskId: "complete-error-task",
      onComplete: () => { callbackCount += 1; throw new Error("completion callback failed"); },
    });
    for (let frame = 0; frame < 20 && fixture.crane.getComponent(ComponentTypes.TASK).state !== QuayCraneState.IDLE; frame += 1) {
      fixture.scene.updateMatrixWorld(true);
      observer.update(1);
    }
    assert.equal(callbackCount, 1, "failed completion notification is not retried on later frames");
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.IDLE);
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).operation, null);
    assert.equal(fixture.container.state, "ON_AGV");
    assert.equal(fixture.containerWrapper.parent, fixture.cargoSlot);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error.message, /completion callback failed/);
    const callsBeforeNextFrame = unrelatedTaskCalls;
    observer.update(0.016);
    assert.equal(unrelatedTaskCalls, callsBeforeNextFrame + 1, "FrameObserver continues unrelated work after isolating the callback error");
    assert.equal(callbackCount, 1);
  }

  // 移除必需组件时查询会跳过该岸桥；当前无自动取消/回滚契约，记录其状态与引用仍会滞留。
  {
    const fixture = createFixture("missing-component");
    const errors = [];
    const observer = new FrameObserver({ onError: (details) => errors.push(details) });
    observer.addTask({ name: "quay-crane", update: (dt) => fixture.system.update(dt) });
    fixture.system.start({ crane: fixture.crane, agv: fixture.agv, container: fixture.container, taskId: "missing-component-task" });
    const task = fixture.crane.getComponent(ComponentTypes.TASK);
    fixture.crane.removeComponent(ComponentTypes.TROLLEY);
    observer.update(1);
    assert.equal(task.state, QuayCraneState.MOVE_TO_CONTAINER);
    assert.ok(task.operation, "operation remains attached to the task component after required-component removal");
    assert.equal(errors.length, 0, "the incomplete crane is silently excluded by the required-component query");
  }

  // 箱体 Entity 在下降完成、锁箱之前被移除：真实状态机访问已失效引用并由
  // FrameObserver 隔离错误；当前没有约定自动取消、回滚预留或恢复 AGV 的规则。
  {
    const fixture = createFixture("missing-container-entity");
    const errors = [];
    const observer = new FrameObserver({ onError: (details) => errors.push(details) });
    observer.addTask({ name: "quay-crane", priority: 1, update: (dt) => fixture.system.update(dt) });
    fixture.container.taskId = "missing-container-task";
    fixture.system.start({
      crane: fixture.crane,
      agv: fixture.agv,
      container: fixture.container,
      taskId: "missing-container-task",
    });

    fixture.scene.updateMatrixWorld(true);
    observer.update(1);
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.LOWER_SPREADER_TO_CONTAINER);
    fixture.scene.updateMatrixWorld(true);
    observer.update(1);
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.ATTACH_CONTAINER);

    const operation = fixture.crane.getComponent(ComponentTypes.TASK).operation;
    fixture.manager.remove(fixture.container.id, fixture.scene);
    fixture.scene.updateMatrixWorld(true);
    observer.update(0.016);

    assert.equal(errors.length, 1, "missing container wrapper fails during the real attach operation");
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.ATTACH_CONTAINER);
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).operation, operation, "operation remains attached after the failed attach");
    assert.equal(fixture.container.state, "ON_SHIP", "business container state is not advanced before successful attachment");
    assert.equal(fixture.container.taskId, "missing-container-task", "ship-container reservation remains held");
    assert.equal(fixture.container.entity.wrapper, null, "the retained Entity reference no longer resolves a wrapper");

    observer.update(0.016);
    assert.equal(errors.length, 2, "later frames retry the same incomplete attach without an explicit recovery policy");
    assert.equal(fixture.crane.getComponent(ComponentTypes.TASK).state, QuayCraneState.ATTACH_CONTAINER);
  }

  // 使用真实 TaskSystem、AGVSystem、MotionSystem、QuayCraneSystem 和 FrameObserver
  // 验证 Runtime 同帧注册顺序：车辆到达回调启动岸桥后，岸桥在本帧后续任务中推进。
  {
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
    const crane = manager.createEntity("runtime-crane");
    crane.addComponent(ComponentTypes.QUAY_CRANE, new QuayCraneComponent(gantry, trolleyNode, hoistNode, ropes, spreader));
    crane.addComponent(ComponentTypes.TROLLEY, new TrolleyComponent({ node: trolleyNode, speed: 100 }));
    crane.addComponent(ComponentTypes.HOIST, new HoistComponent({ node: hoistNode, speed: 100 }));
    crane.addComponent(ComponentTypes.TASK, new TaskComponent());
    crane.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(gantry));
    crane.addComponent(ComponentTypes.CRANE, new CraneComponent({ model: gantry, phase: 0 }));
    manager.add(crane);

    const cargoSlot = new THREE.Group();
    cargoSlot.position.set(0, 1, 12);
    scene.add(cargoSlot);
    const agvNode = new THREE.Group();
    scene.add(agvNode);
    const agv = manager.createEntity("runtime-agv");
    agv.addComponent(ComponentTypes.AGV, new AGVComponent({ cargoSlot }));
    agv.addComponent(ComponentTypes.MOTION, new MotionComponent({ roadId: "stationary", laneId: "stationary" }));
    agv.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(agvNode));
    manager.add(agv);

    const containerWrapper = new THREE.Group();
    containerWrapper.position.set(0, 2, -12);
    containerWrapper.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 4), new THREE.MeshBasicMaterial()));
    scene.add(containerWrapper);
    const containerEntity = manager.createEntity("runtime-container");
    containerEntity.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(containerWrapper));
    manager.add(containerEntity);
    const shipContainer = { id: containerEntity.id, entity: containerEntity, state: "ON_SHIP", location: "ship-1", taskId: null };

    const motionSystem = new MotionSystem(manager, { roadSystem: { getLane: () => null, getRoad: () => null, getLaneLength: () => 0, removeRoad: () => false } });
    const agvSystem = new AGVSystem({ entityManager: manager, motionSystem });
    const quayCraneSystem = new QuayCraneSystem({ entityManager: manager });
    quayCraneSystem.registerShipContainer(shipContainer);
    const taskSystem = new TaskSystem({
      containerSystem: {},
      agvSystem,
      motionSystem,
      pathManager: { createYardRoute: () => ({ stationary: true, length: 0 }) },
      equipmentManager: new EquipmentManager(manager),
      quayCraneSystem,
    });
    const task = taskSystem.createTask(TaskType.DISCHARGE);
    taskSystem.startTask(task.id);
    assert.equal(taskSystem.store.taskMap.get(task.id).status, "RUNNING");

    const observer = new FrameObserver({ onError: (details) => { throw details.error; } });
    // 与 PortRuntime 相同：motion 先注册，quay-crane 同优先级随后注册。
    observer.addTask({ name: "motion", priority: 1, update: (dt) => motionSystem.update(dt) });
    observer.addTask({ name: "quay-crane", priority: 1, update: (dt) => quayCraneSystem.update(dt) });
    observer.update(0.016);

    const craneTask = crane.getComponent(ComponentTypes.TASK);
    assert.equal(craneTask.state, QuayCraneState.MOVE_TO_CONTAINER, "real AGV_ARRIVED callback starts the crane before the later same-frame crane task");
    assert.equal(crane.getComponent(ComponentTypes.TROLLEY).isMoving, true, "crane movement command is already being advanced in the arrival frame");
    assert.equal(taskSystem.store.taskMap.get(task.id).quayCraneState, QuayCraneState.MOVE_TO_CONTAINER);

    // 岸桥在作业开始后被 EntityManager 移除：跨系统观测实际滞留状态。
    // 当前源码没有定义应取消任务、释放船箱预留还是恢复 AGV 的规则。
    const operation = craneTask.operation;
    manager.remove(crane.id, scene);
    observer.update(0.016);
    const agvState = agv.getComponent(ComponentTypes.AGV);
    assert.equal(taskSystem.store.taskMap.get(task.id).status, "RUNNING");
    assert.equal(operation.container.state, "ON_SHIP");
    assert.equal(operation.container.taskId, task.id, "ship-container reservation remains attached to the active operation");
    assert.equal(agvState?.taskId, task.id, "AGV remains assigned after the crane entity disappears");
    assert.equal(agv.getComponent(ComponentTypes.MOTION)?.taskLocked, true);
    assert.equal(craneTask.state, QuayCraneState.MOVE_TO_CONTAINER, "detached TaskComponent remains at its last crane state");
    assert.equal(craneTask.operation, operation);
  }

  console.log("QuayCraneSystem failure-path checks passed (callback error propagation, completion cleanup, missing-component and missing-container observations, observer isolation, and real same-frame Task/Motion/Crane scheduling).");
} finally {
  await vite.close();
}
