// ============================================================================
// AGVComponent.js —— 无人集卡组件（AGV Component：车辆的作业状态）
//
// 【这个文件干什么】
// AGV = Automated Guided Vehicle（自动导引运输车），码头里负责在岸桥和
// 堆场之间驮运集装箱的无人车。这个组件记录车辆的“业务状态”，而它跑到哪了
// 是由 MotionComponent（运动组件）管的，两者分工明确。
//
// 【术语翻译】
//   AGV（自动导引运输车 / 无人集卡）   status（状态）
//   IDLE（空闲，等派活）              capacity（载箱能力，能装几个箱子）
//   cargoSlot（载货位，车板上放箱子的那个挂载点）
//   currentContainer（当前载运的集装箱）   taskId（任务编号）
// ============================================================================

import type * as THREE from "three";
import type { Entity } from "../Entity";

export type AGVStatus = "IDLE" | string;

export class AGVComponent {
  status: AGVStatus;
  capacity: number;
  currentContainer: Entity | string | null;
  taskId: string | null;
  cargoSlot: THREE.Object3D | null;

  constructor({ status = "IDLE", capacity = 1, cargoSlot = null }: { status?: AGVStatus; capacity?: number; cargoSlot?: THREE.Object3D | null } = {}) {
    this.status = status; this.capacity = capacity; this.currentContainer = null;
    this.taskId = null; this.cargoSlot = cargoSlot;
  }
}
