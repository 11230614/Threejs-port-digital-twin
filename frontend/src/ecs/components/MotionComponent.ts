// ============================================================================
// MotionComponent.js —— 运动组件（Motion Component：沿道路行驶的运动状态）
//
// 【这个文件干什么】
// 描述一辆车“在哪条路、哪条车道、跑了多远、跑多快”。
// 注意它存的不是 x/y/z 坐标，而是“路 + 里程”这种一维参数化位置：
// MotionSystem（运动系统）每帧根据 speed（速度）累加 distance（里程），
// 再交给 PathManager（路径管理器）把里程换算成真实三维坐标。
// 这种做法叫 spline following（沿曲线行进），车永远不会开出路面。
//
// 【术语翻译】
//   Motion（运动）        roadId（道路编号）      laneId（车道编号）
//   distance（已行驶里程，单位：米）             speed（当前速度）
//   baseSpeed（基础速度，未受拥堵/减速影响的原始值）
//   progress（进度，0~1 表示走完全程的百分比）
//   command（指令，外部下发的行驶命令）
//   taskLocked（任务锁定：正在执行任务，禁止调度系统抢走这辆车）
// ============================================================================

export type MotionPhase = "PICKUP" | "DELIVERY" | "QUAY_PICKUP" | "CHARGING";

/** A route returned by PathManager and consumed by MotionSystem. Distances are meters. */
export interface MotionRoute {
  roadId?: string | null;
  laneId?: string | null;
  stationary?: boolean;
  length: number;
  networked?: boolean;
  [key: string]: unknown;
}

export interface MotionCommand {
  taskId?: string;
  phase?: MotionPhase;
  route: MotionRoute;
  speed: number;
  distance: number;
  length: number;
}

export class MotionComponent {
  /** Latest backend position target; MotionSystem is the sole final Transform writer. */
  telemetryTarget: { x: number; y: number; z: number } | null;
  telemetryDriven: boolean;
  /** Progress on lane.path used to keep telemetry-driven movement on the road curve. */
  telemetryProgress: number | null;
  roadId: string;
  laneId: string;
  distance: number;
  speed: number;
  baseSpeed: number;
  progress: number;
  command: MotionCommand | null;
  taskLocked: boolean;

  constructor({ roadId, laneId, distance = 0, speed = 30 }: { roadId: string; laneId: string; distance?: number; speed?: number }) {
    this.roadId = roadId; this.laneId = laneId; this.distance = distance;
    this.telemetryTarget = null; this.telemetryDriven = false; this.telemetryProgress = null;
    this.speed = speed; this.baseSpeed = speed; this.progress = 0;
    this.command = null; this.taskLocked = false;
  }
}
