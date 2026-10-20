// ============================================================================
// AGVSystem.ts —— 无人集卡系统（AGV System：车辆调度的状态管理）
//
// 管理车队业务状态流转，不负责位移；真正的行驶由 MotionSystem 执行。
// 原有 JavaScript 说明和业务规则保留在此权威实现文件的开头。
// ============================================================================

import { ComponentTypes } from "../components/ComponentTypes";
import type { AGVComponent } from "../components/AGVComponent";
import type { Entity } from "../Entity";
import type { EntityManager } from "../EntityManager";
import type { MotionPhase, MotionRoute } from "../components/MotionComponent";

export const AGVStatus = Object.freeze({
  IDLE: "IDLE",
  ASSIGNED: "ASSIGNED",
  TO_PICKUP: "TO_PICKUP",
  TRANSPORTING: "TRANSPORTING",
  TO_DELIVERY: "TO_DELIVERY",
} as const);
export type AGVStatusValue = (typeof AGVStatus)[keyof typeof AGVStatus];

export interface AGVMotionSystem { moveAGV(input: { agv: Entity; taskId?: string; phase?: MotionPhase; route: MotionRoute; speed?: number }): boolean }
export interface AGVSystemOptions { entityManager: EntityManager; motionSystem: AGVMotionSystem }
export interface AssignVehicleInput { taskId: string; containerId?: string | null }
export interface DispatchInput { agv: Entity | null; taskId: string; phase: MotionPhase; route: MotionRoute; speed?: number }

export class AGVSystem {
  readonly entityManager: EntityManager;
  readonly motionSystem: AGVMotionSystem;

  constructor({ entityManager, motionSystem }: AGVSystemOptions) { this.entityManager = entityManager; this.motionSystem = motionSystem; }

  assignVehicle({ taskId, containerId = null }: AssignVehicleInput): Entity | null {
    const agv = this.getAGVs().find((candidate) => candidate.getComponent<AGVComponent>(ComponentTypes.AGV)?.status === AGVStatus.IDLE);
    if (!agv) return null;
    const operation = agv.getComponent<AGVComponent>(ComponentTypes.AGV);
    if (!operation) return null;
    operation.status = AGVStatus.ASSIGNED;
    operation.taskId = taskId;
    operation.currentContainer = containerId;
    return agv;
  }

  dispatch({ agv, taskId, phase, route, speed = 30 }: DispatchInput): boolean {
    const operation = agv?.getComponent<AGVComponent>(ComponentTypes.AGV);
    if (!operation || !agv || operation.taskId !== taskId) return false;
    operation.status = phase === "PICKUP" ? AGVStatus.TO_PICKUP : AGVStatus.TO_DELIVERY;
    return this.motionSystem.moveAGV({ agv, taskId, phase, route, speed });
  }

  markContainerLoaded(agv: Entity | null, containerId: string): void {
    if (!agv) return;
    const operation = agv.getComponent<AGVComponent>(ComponentTypes.AGV);
    if (!operation) return;
    operation.currentContainer = containerId;
    operation.status = AGVStatus.TRANSPORTING;
  }

  releaseVehicle(agv: Entity | null): void {
    if (!agv) return;
    const operation = agv.getComponent<AGVComponent>(ComponentTypes.AGV);
    if (!operation) return;
    operation.status = AGVStatus.IDLE;
    operation.taskId = null;
    operation.currentContainer = null;
  }

  getAGVs(): Entity[] { return this.entityManager.getEntitiesWith(ComponentTypes.TRANSFORM, ComponentTypes.MOTION, ComponentTypes.AGV); }
}
