import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { AGVSystem, AGVStatus } = await vite.ssrLoadModule("/src/ecs/systems/AGVSystem.ts");
  const { ComponentTypes } = await vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts");
  const { AGVComponent } = await vite.ssrLoadModule("/src/ecs/components/AGVComponent.ts");
  const { MotionComponent } = await vite.ssrLoadModule("/src/ecs/components/MotionComponent.ts");
  const components = new Map([[ComponentTypes.TRANSFORM, {}], [ComponentTypes.MOTION, new MotionComponent({ roadId: "r", laneId: "l" })], [ComponentTypes.AGV, new AGVComponent()]]);
  const agv = { id: "agv-1", getComponent: (type) => components.get(type) ?? null, hasComponent: (type) => components.has(type) };
  const manager = { getEntitiesWith: () => [agv] };
  let command;
  const system = new AGVSystem({ entityManager: manager, motionSystem: { moveAGV: (input) => { command = input; return true; } } });
  assert.equal(system.assignVehicle({ taskId: "task-1", containerId: "box-1" }), agv);
  assert.equal(agv.getComponent(ComponentTypes.AGV).status, AGVStatus.ASSIGNED);
  assert.equal(system.dispatch({ agv, taskId: "wrong", phase: "PICKUP", route: { length: 1 } }), false);
  assert.equal(system.dispatch({ agv, taskId: "task-1", phase: "PICKUP", route: { length: 1 } }), true);
  assert.equal(command.agv, agv);
  system.markContainerLoaded(agv, "box-1");
  assert.equal(agv.getComponent(ComponentTypes.AGV).status, AGVStatus.TRANSPORTING);
  system.releaseVehicle(agv);
  assert.equal(agv.getComponent(ComponentTypes.AGV).status, AGVStatus.IDLE);
  assert.equal(agv.getComponent(ComponentTypes.AGV).taskId, null);
  console.log("AGVSystem behavior checks passed (assignment, task guard, dispatch, loading, release).");
} finally { await vite.close(); }
