// ============================================================================
// MotionSystem.js —— 运动系统（Motion System：让车辆沿道路平滑行驶）
//
// 【这个文件干什么】
// 每帧计算所有 AGV（无人集卡）的新位置与朝向。核心思路是 curve following
// （沿曲线行进）：不直接操作 x/y/z，而是维护"沿车道走了多少米"这一个数字，
// 再交给道路系统换算成三维坐标。好处是车永远不会偏离路面。
//
// 系统把车辆分成两类分别处理：
//   · commanded（受指令控制的车）：正在执行任务，按指定路线从头走到尾，
//     到终点后广播 AGV_ARRIVED（已抵达）事件。
//   · free（自由巡航的车）：没任务时绕环线转圈，并做 car following
//     （跟车避撞）——检测前车距离，太近就减速。
//
// 另一个值得注意的实现细节是 vector reuse（向量复用）：三个临时向量在构造
// 函数里建好长期复用，而不是每帧 new。每帧几十辆车若各新建向量，
// 一秒钟就是几千个短命对象，会造成周期性的垃圾回收卡顿。
//
// 【术语翻译】
//   Motion（运动）             curve following（沿曲线行进）
//   lane（车道）               road（道路）        laneId / roadId（车道/道路编号）
//   u（曲线参数，0 表示起点、1 表示终点，是"归一化里程"）
//   tangent（切线向量，曲线在某点的前进方向，用来定车头朝向）
//   lookAt（朝向某点，自动算出所需的旋转）
//   car following（跟车模型）   safeDistance（安全车距）
//   closed（闭合的，指环形道路首尾相接）
//   transient（临时的，指用完即删的一次性道路）
//   euclideanModulo（欧几里得取模，结果恒为非负，适合环形绕圈）
//   clamp（钳制，限制在上下界之间）
//   exponential smoothing（指数平滑，让速度渐变而非突跳）
//   emit（发射事件）           payload（事件负载数据）
//   Infinity（无穷大，用作"还没找到最近前车"的初始值）
// ============================================================================

import * as THREE from "three";
import type { Entity } from "../Entity";
import type { EntityManager } from "../EntityManager";
import { ComponentTypes } from "../components/ComponentTypes";
import type { MotionComponent, MotionPhase, MotionRoute } from "../components/MotionComponent";
import type { TransformComponent } from "../components/TransformComponent";

export interface MotionRoad {
  id: string;
  closed: boolean;
  transient?: boolean;
}

export interface MotionLane { id: string; roadId: string; length: number }

export interface MotionRoadApi {
  getLane(id: string): MotionLane | null;
  getRoad(id: string): MotionRoad | null;
  getLaneLength(id: string): number;
  getPointAt(id: string, u: number, target?: THREE.Vector3): THREE.Vector3 | null;
  getTangentAt(id: string, u: number, target?: THREE.Vector3): THREE.Vector3 | null;
  getNearestU(id: string, position: THREE.Vector3, samples?: number): number;
  removeRoad(id: string): boolean;
}

export interface MotionSystemConfig { roadSystem?: MotionRoadApi | null; safeDistance?: number }
export interface MotionCommandInput { agv: Entity | null; taskId?: string; phase?: MotionPhase; route: MotionRoute | null; speed?: number }
export interface AGVArrivalEvent { agv: Entity; taskId?: string; phase?: MotionPhase; position: THREE.Vector3 }
export type MotionEventListener = (event: AGVArrivalEvent) => void;

export class MotionSystem {
  readonly manager: EntityManager;
  readonly roadSystem: MotionRoadApi | null;
  readonly safeDistance: number;
  readonly listeners = new Map<string, Set<MotionEventListener>>();
  private readonly _position = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();
  private readonly _lookAt = new THREE.Vector3();
  private readonly _heldAGVs = new Set<string>();

  constructor(entityManager: EntityManager, config: MotionSystemConfig = {}) {
    this.manager = entityManager;
    this.roadSystem = config.roadSystem ?? null;
    this.safeDistance = config.safeDistance ?? 30;
  }

  on(eventName: string, listener: MotionEventListener): () => boolean {
    const listeners = this.listeners.get(eventName) ?? new Set<MotionEventListener>();
    listeners.add(listener); this.listeners.set(eventName, listeners);
    return () => listeners.delete(listener);
  }

  holdAGV(agv: Entity): void {
    this._heldAGVs.add(agv.id);
    const motion = agv.getComponent<MotionComponent>(ComponentTypes.MOTION);
    if (!motion) return;
    motion.taskLocked = true; motion.speed = 0;
  }

  update(deltaTime: number): void { this._updateAGVs(deltaTime); }

  resumeCruise(agv: Entity): boolean {
    const motion = agv.getComponent<MotionComponent>(ComponentTypes.MOTION);
    if (!motion || motion.command) return false;
    this.holdAGV(agv);
    const roadSystem = this.roadSystem; const lane = roadSystem?.getLane(motion.laneId);
    if (!roadSystem || !lane || lane.length <= 0) return false;
    const road = roadSystem.getRoad(lane.roadId); if (!road) return false;
    const transform = agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
    if (!transform?.wrapper) return false;
    const position = transform.wrapper.position;
    const wrap = (u: number) => road.closed ? THREE.MathUtils.euclideanModulo(u, 1) : THREE.MathUtils.clamp(u, 0, 1);
    const distance = (u: number) => { const point = roadSystem.getPointAt(lane.id, wrap(u)); return point ? Math.hypot(point.x - position.x, point.z - position.z) : Infinity; };
    const u = roadSystem.getNearestU(lane.id, position, 1000); let lo = u - 0.001; let hi = u + 0.001;
    for (let i = 0; i < 28; i += 1) { const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3; if (distance(a) < distance(b)) hi = b; else lo = a; }
    const nearest = wrap((lo + hi) / 2); if (distance(nearest) > 0.05) return false;
    motion.distance = nearest * lane.length; motion.taskLocked = false; this._heldAGVs.delete(agv.id); return true;
  }

  moveAGV({ agv, taskId, phase, route, speed = 30 }: MotionCommandInput): boolean {
    const roadSystem = this.roadSystem;
    if (!agv || !route || !roadSystem || !Number.isFinite(speed) || speed <= 0) return false;
    const laneId = route.laneId;
    let length = 0;
    if (!route.stationary) {
      if (!route.roadId || !laneId || !roadSystem.getLane(laneId)) return false;
      length = roadSystem.getLaneLength(laneId);
    }
    const motion = agv.getComponent<MotionComponent>(ComponentTypes.MOTION);
    if (!motion || !agv.hasComponent(ComponentTypes.AGV)) return false;
    if (!Number.isFinite(length) || (!route.stationary && length <= 0)) return false;
    this.holdAGV(agv);
    motion.command = { taskId, phase, route, speed, distance: 0, length };
    return true;
  }

  private _updateAGVs(deltaTime: number): void {
    const agvs = this.manager.getEntitiesWith(ComponentTypes.TRANSFORM, ComponentTypes.MOTION, ComponentTypes.AGV);
    agvs.filter((entity) => entity.getComponent<MotionComponent>(ComponentTypes.MOTION)?.telemetryDriven)
      .forEach((entity) => this._updateTelemetryTransform(entity, deltaTime));
    const locallyDriven = agvs.filter((entity) => !entity.getComponent<MotionComponent>(ComponentTypes.MOTION)?.telemetryDriven);
    locallyDriven.filter((entity) => entity.getComponent<MotionComponent>(ComponentTypes.MOTION)?.command).forEach((entity) => this._updateCommand(entity, deltaTime));
    const freeAgvs = locallyDriven.filter((entity) => { const motion = entity.getComponent<MotionComponent>(ComponentTypes.MOTION); return Boolean(motion && !motion.command && !motion.taskLocked && !this._heldAGVs.has(entity.id)); });
    freeAgvs.forEach((entity) => this._updateDistance(entity, deltaTime, freeAgvs));
    freeAgvs.forEach((entity) => this._applyCurveTransform(entity));
  }

  private _updateTelemetryTransform(entity: Entity, deltaTime: number): void {
    const motion = entity.getComponent<MotionComponent>(ComponentTypes.MOTION);
    const transform = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
    const target = motion?.telemetryTarget;
    if (!motion || !transform || !target) return;
    const lane = this.roadSystem?.getLane(motion.laneId);
    if (!lane || !this.roadSystem || lane.length <= 0) return;
    const raw = new THREE.Vector3(target.x, target.y, target.z);
      const targetProgress = this.roadSystem.getNearestU(lane.id, raw, 512);
      const road = this.roadSystem.getRoad(lane.roadId);
      const closed = road?.closed ?? false;
      if (motion.telemetryProgress === null) {
        motion.telemetryProgress = this.roadSystem.getNearestU(lane.id, transform.wrapper.position, 512);
      }

      let difference = targetProgress - motion.telemetryProgress;
      if (closed) {
        if (difference > 0.5) difference -= 1;
        else if (difference < -0.5) difference += 1;
      }
      const requestedDistance = Math.abs(difference) * lane.length;
      const maxDistance = Math.max(0, motion.speed) * Math.max(0, deltaTime);
      const distanceStep = Math.min(requestedDistance, maxDistance);
      if (requestedDistance > 0) {
        motion.telemetryProgress += Math.sign(difference) * distanceStep / lane.length;
      }
      if (closed) motion.telemetryProgress = THREE.MathUtils.euclideanModulo(motion.telemetryProgress, 1);
      else motion.telemetryProgress = THREE.MathUtils.clamp(motion.telemetryProgress, 0, 1);

      if (!this.roadSystem.getPointAt(lane.id, motion.telemetryProgress, this._position)) return;
      if (this.roadSystem.getTangentAt(lane.id, motion.telemetryProgress, this._tangent)) {
        transform.wrapper.position.copy(this._position);
        this._lookAt.copy(this._position).add(this._tangent);
        transform.wrapper.lookAt(this._lookAt);
      } else {
        transform.wrapper.position.copy(this._position);
      }
    transform.updateBBox();
  }

  private _updateCommand(entity: Entity, deltaTime: number): void {
    const motion = entity.getComponent<MotionComponent>(ComponentTypes.MOTION); const command = motion?.command;
    if (!motion || !command) return;
    command.distance += command.speed * Math.max(0, deltaTime);
    const progress = command.route.stationary ? 1 : Math.min(command.distance / command.length, 1);
    motion.progress = progress;
    if (!command.route.stationary && command.route.laneId) this._applyLaneTransform(entity, command.route.laneId, progress);
    if (progress < 1) return;
    const transform = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM); const position = transform?.wrapper?.position.clone() ?? new THREE.Vector3();
    motion.command = null; this.holdAGV(entity);
    const routeRoad = command.route.roadId ? this.roadSystem?.getRoad(command.route.roadId) : null;
    if (routeRoad?.transient) this.roadSystem?.removeRoad(routeRoad.id);
    this._emit("AGV_ARRIVED", { agv: entity, taskId: command.taskId, phase: command.phase, position });
  }

  private _updateDistance(entity: Entity, deltaTime: number, agvs: Entity[]): void {
    const roadSystem = this.roadSystem; const motion = entity.getComponent<MotionComponent>(ComponentTypes.MOTION);
    if (!roadSystem || !motion) return;
    const lane = roadSystem.getLane(motion.laneId); if (!lane) return;
    const road = roadSystem.getRoad(lane.roadId); if (!road) return;
    const curveLength = lane.length; const myU = this._getLaneU(lane, road, motion.distance); let nearestAhead = Infinity;
    agvs.forEach((other) => {
      if (other.id === entity.id) return;
      const otherMotion = other.getComponent<MotionComponent>(ComponentTypes.MOTION); if (!otherMotion || otherMotion.laneId !== lane.id) return;
      const otherU = this._getLaneU(lane, road, otherMotion.distance); let ahead = otherU - myU;
      if (road.closed && ahead < 0) ahead += 1; if (!road.closed && ahead < 0) return;
      nearestAhead = Math.min(nearestAhead, ahead * curveLength);
    });
    let targetSpeed = motion.baseSpeed;
    if (nearestAhead < this.safeDistance * 2) {
      if (nearestAhead < this.safeDistance * 0.65) targetSpeed = motion.baseSpeed * 0.18;
      else if (nearestAhead < this.safeDistance) targetSpeed = motion.baseSpeed * 0.45;
      else targetSpeed = motion.baseSpeed * 0.75;
    }
    motion.speed += (targetSpeed - motion.speed) * 0.12;
    motion.distance = this._advanceDistance(lane, road, motion.distance, motion.speed * deltaTime);
  }

  private _applyCurveTransform(entity: Entity): void {
    const roadSystem = this.roadSystem; const motion = entity.getComponent<MotionComponent>(ComponentTypes.MOTION); if (!roadSystem || !motion) return;
    const lane = roadSystem.getLane(motion.laneId); if (!lane) return; const road = roadSystem.getRoad(lane.roadId); if (!road) return;
    const u = this._getLaneU(lane, road, motion.distance); this._applyLaneTransform(entity, lane.id, u); motion.progress = this._getLaneU(lane, road, motion.distance);
  }

  private _applyLaneTransform(entity: Entity, laneId: string, u: number): void {
    const roadSystem = this.roadSystem; const transform = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM); if (!roadSystem || !transform?.wrapper) return;
    if (!roadSystem.getPointAt(laneId, u, this._position)) return;
    if (!roadSystem.getTangentAt(laneId, u, this._tangent)) return;
    transform.wrapper.position.copy(this._position); this._lookAt.copy(this._position).add(this._tangent); transform.wrapper.lookAt(this._lookAt); transform.updateBBox();
  }

  private _getLaneU(lane: MotionLane, road: MotionRoad, distance: number): number {
    if (lane.length <= 0) return 0;
    return road.closed ? THREE.MathUtils.euclideanModulo(distance, lane.length) / lane.length : THREE.MathUtils.clamp(distance / lane.length, 0, 1);
  }

  private _advanceDistance(lane: MotionLane, road: MotionRoad, distance: number, delta: number): number {
    return road.closed ? distance + delta : THREE.MathUtils.clamp(distance + delta, 0, lane.length);
  }

  private _emit(eventName: string, payload: AGVArrivalEvent): void { this.listeners.get(eventName)?.forEach((listener) => listener(payload)); }
}
