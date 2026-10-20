// ============================================================================
// PathManager.js —— 路径管理器（Path Manager：算出车该怎么走）
//
// 【这个文件干什么】
// 任务系统说"把车从 A 点送到 B 点"，本文件负责回答"具体沿哪条线走"。
// 输出是一条 route（路线）对象，交给运动系统去执行。
//
// 【三种路线，从好到差依次降级】
//   1) createYardRoute（路网路线）——首选。走真实的道路网，
//      用 Dijkstra（迪杰斯特拉最短路算法）在路口之间找最短路径。
//      车看起来像真的在遵守道路规则。
//   2) calculateRoute（环线路线）——沿已有的巡航环线走到目标附近。
//   3) createDirectRoute（直线路线）——兜底。两点之间直接连线，
//      会穿过草地甚至穿过建筑，但保证"总有路可走"。
//
// 【为什么要有兜底】
// 路网可能还没建好、目标点可能孤立在路网之外、图可能不连通。
// 这些情况下若返回 null，任务会卡死、车永远停在原地，用户只看到一堆
// 不动的车却不知道为什么。降级成一条丑陋但可行的直线，至少流程能跑完——
// 这是 graceful degradation（优雅降级）。全文件出现五次 createDirectRoute
// 调用，就是五个降级出口。
//
// 【Dijkstra 算法在这里的实现要点】
// _findNetworkPath 是标准 Dijkstra：
//   · adjacency（邻接表）：每个节点连着哪些节点、各多远
//   · distances（距离表）：从起点到各节点的当前最短距离
//   · previous（前驱表）：每个节点是从哪来的，用于最后回溯出路径
//   · remaining（未处理集合）：还没确定最短距离的节点
// 每轮从 remaining 里挑距离最小的那个处理，更新它邻居的距离。
// 这里用的是朴素实现（线性扫描找最小值），复杂度 O(V²)；
// 换成优先队列可降到 O(E log V)，但本项目路口只有几十个，没必要。
//
// 【术语翻译】
//   Path（路径）             route（路线）        network（路网）
//   node（节点，即路口）      edge（边，即两个路口之间的路段）
//   adjacency（邻接表）      Dijkstra（迪杰斯特拉最短路算法）
//   graceful degradation（优雅降级，功能不可用时退回一个较差但可用的方案）
//   u（曲线参数，0~1 的归一化里程）
//   sample（采样点）         lerp（线性插值）
//   distanceTo / distanceToSquared（求距离 / 求距离的平方）
//   reduce（归约，把数组累计成一个值）
//   Array.from（由长度与生成函数造数组）
//   unshift（在数组头部插入）
//   Infinity（无穷大，作为"还没算出距离"的初始值）
//   compact（压缩，此处指去掉重复的点）
// ============================================================================

import * as THREE from "three";
import type { MotionRoute } from "../ecs/components/MotionComponent";

export interface RoadRecord {
  id: string;
  width: number;
  closed: boolean;
  laneIds: string[];
  transient?: boolean;
}

export interface LaneRecord {
  id: string;
  roadId: string;
  length: number;
}

export interface YardNetworkNode {
  id: string;
  position: THREE.Vector3;
  kind?: string;
}

export interface YardNetworkEdge { from: string; to: string }
export interface YardContainerAccess { nodeId: string; position: THREE.Vector3 }
export interface YardNetworkBounds { min?: { x: number }; max?: { x: number } }
export interface YardRoadNetwork {
  nodes: YardNetworkNode[];
  edges: YardNetworkEdge[];
  bounds?: YardNetworkBounds;
  containerAccess?: Map<string, YardContainerAccess>;
}

/** The intentionally small public boundary consumed from the still-JS RoadSystem. */
export interface RoadSystemPathApi {
  yardNetwork?: YardRoadNetwork | null;
  getRoad(id: string): RoadRecord | null;
  getLane(id: string): LaneRecord | null;
  getPrimaryLane(roadId: string): LaneRecord | null;
  getPointAt(laneId: string, u: number): THREE.Vector3 | null;
  getTangentAt(laneId: string, u: number): THREE.Vector3 | null;
  getNearestU(laneId: string, position: THREE.Vector3, samples?: number): number;
  createRoutePath(points: THREE.Vector3[]): { roadId: string; laneId: string; length: number };
  removeRoad(id: string): boolean;
}

export interface PathRequestOptions { roadId?: string; laneId?: string | null }
export interface YardRouteOptions { containerId?: string | null }
export interface BerthParkingPoint { position: THREE.Vector3; laneId: string; distanceToBerth: number }

interface ProjectedLanePoint { lane: LaneRecord; u: number; point: THREE.Vector3; distance: number }
interface RouteSegment { a: string; b: string; cuts: Array<{ id: string; t: number }> }
interface GraphEdge { to: string; length: number; points: () => THREE.Vector3[] }

export class PathManager {
  readonly roadSystem: RoadSystemPathApi;
  readonly yardRoadNetwork: YardRoadNetwork | null;
  readonly snapTolerance: number;
  lastError: string | null = null;

  constructor({ roadSystem, yardRoadNetwork = null, snapTolerance = 0.75 }: { roadSystem: RoadSystemPathApi; yardRoadNetwork?: YardRoadNetwork | null; snapTolerance?: number }) {
    this.roadSystem = roadSystem;
    this.yardRoadNetwork = yardRoadNetwork;
    this.snapTolerance = snapTolerance;
  }

  private _flat(point: THREE.Vector3): THREE.Vector3 { return new THREE.Vector3(point.x, 0.12, point.z); }
  private _distance(a: THREE.Vector3, b: THREE.Vector3): number { return Math.hypot(a.x - b.x, a.z - b.z); }
  private _fail(message: string): null { this.lastError = message; return null; }

  private _nearestLane(lane: LaneRecord, position: THREE.Vector3): ProjectedLanePoint | null {
    const closed = this.roadSystem.getRoad(lane.roadId)?.closed === true;
    const wrap = (u: number) => closed ? THREE.MathUtils.euclideanModulo(u, 1) : THREE.MathUtils.clamp(u, 0, 1);
    const at = (u: number) => this.roadSystem.getPointAt(lane.id, wrap(u));
    const u = this.roadSystem.getNearestU(lane.id, position, 1000);
    if (!at(u)) return null;
    let lo = u - 1 / 1000; let hi = u + 1 / 1000;
    for (let i = 0; i < 28; i += 1) {
      const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3;
      const aPoint = at(a); const bPoint = at(b);
      if (!aPoint || !bPoint) return null;
      if (this._distance(aPoint, position) < this._distance(bPoint, position)) hi = b; else lo = a;
    }
    const resultU = wrap((lo + hi) / 2); const resultPoint = at(resultU);
    if (!resultPoint) return null;
    const point = this._flat(resultPoint);
    return { lane, u: resultU, point, distance: this._distance(point, position) };
  }

  private _lanePoints(lane: LaneRecord, start: number, delta: number): THREE.Vector3[] | null {
    const closed = this.roadSystem.getRoad(lane.roadId)?.closed === true;
    const count = Math.max(1, Math.ceil(delta * lane.length));
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= count; i += 1) {
      const u = start + (delta * i) / count;
      const point = this.roadSystem.getPointAt(lane.id, closed ? THREE.MathUtils.euclideanModulo(u, 1) : Math.min(u, 1));
      if (!point) return null;
      points.push(this._flat(point));
    }
    return points;
  }

  private _finish(points: THREE.Vector3[]): MotionRoute {
    const compact: THREE.Vector3[] = [];
    for (const point of points) {
      const previous = compact[compact.length - 1];
      if (!previous || this._distance(point, previous) > 1e-4) compact.push(point.clone());
    }
    if (compact.length < 2) return { stationary: true, length: 0, networked: true };
    return { ...this.roadSystem.createRoutePath(compact), networked: true };
  }

  calculateRoute(from: THREE.Vector3, to: THREE.Vector3, { roadId = "AGV_LOOP_01", laneId = null }: PathRequestOptions = {}): MotionRoute | null {
    this.lastError = null;
    const lane = laneId ? this.roadSystem.getLane(laneId) : this.roadSystem.getPrimaryLane(roadId);
    if (!lane) return this._fail("巡航车道不存在");
    const a = this._nearestLane(lane, from); const b = this._nearestLane(lane, to);
    if (!a || !b) return this._fail("指定巡航车道没有可用几何");
    if (Math.max(a.distance, b.distance) > this.snapTolerance) return this._fail("起点或终点不在指定巡航车道上");
    let delta = b.u - a.u;
    if (delta < -1e-8) {
      if (!this.roadSystem.getRoad(lane.roadId)?.closed) return this._fail("非闭环车道不允许逆行");
      delta += 1;
    }
    const lanePoints = this._lanePoints(lane, a.u, Math.max(0, delta));
    if (!lanePoints) return this._fail("指定巡航车道几何不可用");
    return this._finish([this._flat(from), ...lanePoints, this._flat(to)]);
  }

  createDirectRoute(): null { return this._fail("已禁用无道路依据的直线路线"); }

  getBerthParkingPoint(destination: THREE.Vector3): BerthParkingPoint | null {
    const road = this.roadSystem.getRoad("AGV_LOOP_01");
    if (!road) { this.lastError = "外侧 AGV 环线不存在"; return null; }
    let nearest: ProjectedLanePoint | null = null;
    for (const laneId of road.laneIds) {
      const lane = this.roadSystem.getLane(laneId);
      if (!lane || lane.length <= 0) continue;
      const candidate = this._nearestLane(lane, destination);
      if (!candidate) continue;
      if (!nearest || candidate.distance < nearest.distance) nearest = candidate;
    }
    if (!nearest) { this.lastError = "外侧环线没有可用车道"; return null; }
    return { position: nearest.point.clone(), laneId: nearest.lane.id, distanceToBerth: nearest.distance };
  }

  createYardRoute(from: THREE.Vector3, to: THREE.Vector3, options: YardRouteOptions = {}): MotionRoute | null {
    this.lastError = null;
    const network = this.yardRoadNetwork ?? this.roadSystem.yardNetwork;
    if (!network?.nodes?.length) return this._fail("堆场路网尚未创建");
    const access = options.containerId != null ? network.containerAccess?.get(options.containerId) : undefined;
    if (options.containerId != null && !access) return this._fail("该集装箱没有接驳节点");
    const target = access?.position ?? to;
    if (!from || !target) return this._fail("缺少路线起点或终点");

    const nodes = new Map<string, THREE.Vector3>(network.nodes.map((node) => [node.id, this._flat(node.position)]));
    const segments: RouteSegment[] = network.edges.map((edge) => ({ a: edge.from, b: edge.to, cuts: [] })).filter((edge) => nodes.has(edge.a) && nodes.has(edge.b));
    const loop = this.roadSystem.getRoad("AGV_LOOP_01");
    const lanes = (loop?.laneIds ?? []).map((id) => this.roadSystem.getLane(id)).filter((lane): lane is LaneRecord => Boolean(lane && lane.length > 0));
    const laneStops = new Map<string, Array<{ id: string; u: number }>>(lanes.map((lane) => [lane.id, []]));
    let sequence = 0;
    const addNode = (point: THREE.Vector3): string => { let id = ""; do { id = `__route_${++sequence}`; } while (nodes.has(id)); nodes.set(id, this._flat(point)); return id; };

    const rows = new Map<string, YardNetworkNode[]>();
    for (const node of network.nodes) {
      if (node.kind !== "intersection") continue;
      const key = node.position.z.toFixed(4); const row = rows.get(key) ?? []; row.push(node); rows.set(key, row);
    }
    for (const lane of lanes) {
      const count = Math.max(16, Math.ceil(lane.length / 2));
      const samples = Array.from({ length: count + 1 }, (_, i) => this.roadSystem.getPointAt(lane.id, i / count));
      for (const row of rows.values()) {
        row.sort((a, b) => a.position.x - b.position.x); const z = row[0].position.z;
        for (const side of ["min", "max"] as const) {
          const boundary = network.bounds?.[side]?.x;
          if (typeof boundary !== "number" || !Number.isFinite(boundary)) continue;
          const yardNode = side === "min" ? row[0] : row.at(-1); if (!yardNode) continue;
          for (let i = 0; i < count; i += 1) {
            const a = samples[i]; const b = samples[i + 1];
            if (!a || !b) continue;
            if (Math.abs(b.z - a.z) < 1e-8 || (a.z - z) * (b.z - z) > 0) continue;
            let lo = i / count; let hi = (i + 1) / count;
            let valid = true;
            for (let k = 0; k < 30; k += 1) { const mid = (lo + hi) / 2; const p = this.roadSystem.getPointAt(lane.id, mid); if (!p) { valid = false; break; } if ((a.z <= z) === (p.z <= z)) lo = mid; else hi = mid; }
            if (!valid) continue;
            const u = (lo + hi) / 2; const p = this.roadSystem.getPointAt(lane.id, u); const tangent = this.roadSystem.getTangentAt(lane.id, u);
            const boundaryX = boundary;
            if (!p || !tangent || Math.abs(tangent.x) > 0.15 || Math.abs(p.x - boundaryX) > (loop?.width ?? 0) / 2) continue;
            const stops = laneStops.get(lane.id); if (!stops || stops.some((stop) => Math.abs(stop.u - u) < 1e-6)) continue;
            const id = addNode(p); stops.push({ id, u }); segments.push({ a: yardNode.id, b: id, cuts: [] });
          }
        }
      }
    }

    const projectSegment = (point: THREE.Vector3, segment: RouteSegment) => {
      const a = nodes.get(segment.a); const b = nodes.get(segment.b); if (!a || !b) return null;
      const delta = b.clone().sub(a); const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(delta) / Math.max(delta.lengthSq(), 1e-12), 0, 1); const projected = a.clone().addScaledVector(delta, t);
      return { segment, t, point: projected, distance: this._distance(point, projected) };
    };
    const attach = (position: THREE.Vector3, isStart: boolean) => {
      const point = this._flat(position); let best: (ProjectedLanePoint & { lane: LaneRecord }) | ({ segment: RouteSegment; t: number; point: THREE.Vector3; distance: number }) | null = null;
      for (const lane of lanes) { const candidate = this._nearestLane(lane, point); if (candidate && (!best || candidate.distance < best.distance)) best = candidate; }
      for (const segment of segments) { const candidate = projectSegment(point, segment); if (candidate && (!best || candidate.distance < best.distance - 1e-6)) best = candidate; }
      if (!best || best.distance > this.snapTolerance) return null;
      const id = addNode(best.point);
      if ("lane" in best) laneStops.get(best.lane.id)?.push({ id, u: best.u }); else best.segment.cuts.push({ id, t: best.t });
      return { id, point, projected: best.point, isStart };
    };
    const start = attach(from, true); if (!start) return this._fail("AGV 不在已登记道路附近，无法合法接入路网");
    const accessNode = access ? nodes.get(access.nodeId) : undefined;
    const end = access ? (accessNode && this._distance(accessNode, access.position) <= this.snapTolerance ? { id: access.nodeId, point: this._flat(access.position) } : null) : attach(target, false);
    if (!end) return this._fail(access ? "集装箱接驳点与节点不一致" : "目标没有道路接入点，请配置真实的作业接驳道路");

    const adjacency = new Map<string, GraphEdge[]>([...nodes.keys()].map((id) => [id, []]));
    const addEdge = (a: string, b: string, length: number, points: () => THREE.Vector3[]) => adjacency.get(a)?.push({ to: b, length, points });
    for (const segment of segments) {
      const cuts = [{ id: segment.a, t: 0 }, ...segment.cuts, { id: segment.b, t: 1 }].sort((a, b) => a.t - b.t);
      for (let i = 1; i < cuts.length; i += 1) { const a = nodes.get(cuts[i - 1].id); const b = nodes.get(cuts[i].id); if (!a || !b) continue; const fromId = cuts[i - 1].id; const toId = cuts[i].id; const length = this._distance(a, b); addEdge(fromId, toId, length, () => [a, b]); addEdge(toId, fromId, length, () => [b, a]); }
    }
    for (const lane of lanes) {
      const stops = laneStops.get(lane.id) ?? []; stops.sort((a, b) => a.u - b.u); const closed = this.roadSystem.getRoad(lane.roadId)?.closed === true; const count = closed ? stops.length : stops.length - 1;
      for (let i = 0; i < count; i += 1) { const a = stops[i]; const b = stops[(i + 1) % stops.length]; if (!a || !b) continue; const delta = b.u - a.u + (i === stops.length - 1 ? 1 : 0); const lanePoints = this._lanePoints(lane, a.u, delta); if (!lanePoints) continue; addEdge(a.id, b.id, delta * lane.length, () => lanePoints.map((point) => point.clone())); }
    }
    const distance = new Map<string, number>([[start.id, 0]]); const previous = new Map<string, { from: string; edge: GraphEdge }>(); const pending = new Set(nodes.keys());
    while (pending.size) {
      let current: string | null = null; let min = Infinity;
      for (const id of pending) { const candidateDistance = distance.get(id) ?? Infinity; if (candidateDistance < min) { current = id; min = candidateDistance; } }
      if (current === null || current === end.id) break; pending.delete(current);
      for (const edge of adjacency.get(current) ?? []) { const next = min + edge.length; if (pending.has(edge.to) && next < (distance.get(edge.to) ?? Infinity)) { distance.set(edge.to, next); previous.set(edge.to, { from: current, edge }); } }
    }
    if (!distance.has(end.id)) return this._fail("外环与堆场之间没有合法连通路径");
    const steps: GraphEdge[] = []; for (let id = end.id; id !== start.id;) { const step = previous.get(id); if (!step) return this._fail("路线回溯失败"); steps.push(step.edge); id = step.from; }
    const startNode = nodes.get(start.id);
    if (!startNode) return this._fail("路线起点节点不存在");
    const points = [start.point, startNode]; for (const edge of steps.reverse()) points.push(...edge.points()); points.push(end.point);
    return this._finish(points);
  }
}
