// RoadSystem.ts —— 道路与堆场导航系统的 TypeScript 实现
// 本文件承载道路、车道、临时路径与堆场路网的唯一业务实现。
// 旧版中文业务注释保留在对应方法附近，兼容入口 RoadSystem.js 继续转发到这里。
import * as THREE from "three";

export interface RoadLaneDefinition { id?: string; offset?: number; direction?: 1 | -1 }
export interface RoadRecord { id: string; type: string; width: number; closed: boolean; points: THREE.Vector3[]; centerPath: THREE.CurvePath<THREE.Vector3>; cornerRadius: number; laneIds: string[]; meshGroup: THREE.Group | null; transient: boolean }
export interface LaneRecord { id: string; roadId: string; index: number; offset: number; direction: 1 | -1; path: THREE.CurvePath<THREE.Vector3>; length: number }
export interface IntersectionRecord { id: string; roadIds: string[]; position: THREE.Vector3; rules: Record<string, unknown> }
export interface RoadCreateOptions { id: string; type?: string; points: THREE.Vector3[]; width?: number; closed?: boolean; lanes?: RoadLaneDefinition[]; visualize?: boolean; transient?: boolean; cornerRadius?: number }
export interface RoadRenderSegment { id: string; object: THREE.Object3D; bounds: THREE.Box3; kind: "surface" | "detail" }
export interface YardNetworkNode { id: string; kind: string; position: THREE.Vector3 }
export interface YardNetworkEdge { from: string; to: string; kind: string; length: number }
export interface YardContainerAccess { nodeId: string; position: THREE.Vector3; slotPosition: THREE.Vector3 }
export interface YardNetwork { group: THREE.Group; nodes: YardNetworkNode[]; edges: YardNetworkEdge[]; nodeById: Map<string, YardNetworkNode>; containerAccess: Map<string, YardContainerAccess>; bounds: { min: THREE.Vector3; max: THREE.Vector3 } }
export interface YardSlotInput { id: string; bounds?: THREE.Box3; model?: THREE.Object3D }
export interface YardRoadBand { center: number; width: number; id?: string; laneId?: string }
export interface RoutePathRecord { roadId: string; laneId: string; length: number; points?: THREE.Vector3[] }

interface RoadSystemSlotBound extends YardSlotInput { box: THREE.Box3 }
interface RoadAxisBand { min: number; max: number; center: number; count: number }
interface RoadBand extends YardRoadBand { id?: string; laneId?: string }
interface RegisteredRoadBand extends RoadBand { id: string; laneId: string }
interface RoadDash { x: number; z: number; length: number; width: number }
interface RoadFrame { point: THREE.Vector3; normal: THREE.Vector3; distance: number }
interface RoadBuffer { positions: number[]; uvs: number[]; indices: number[] }
interface RoadNetworkBuildInput { slotBounds: RoadSystemSlotBound[]; mainRoads: RegisteredRoadBand[]; crossRoads: RegisteredRoadBand[]; roadMinX: number; roadMaxX: number; roadMinZ: number; roadMaxZ: number }
interface RoadSegmentOptions { height: number; receiveShadow?: boolean; name: string }
interface RoadRenderableObject extends THREE.Object3D { isLineSegments?: boolean; material?: THREE.Material | THREE.Material[] }

const ROAD_HEIGHT = 0.08;
const MARKING_HEIGHT = 0.105;
const ROAD_VISUAL_SEGMENT_LENGTH = 80;

export class RoadSystem {
  readonly scene: THREE.Scene;
  readonly group: THREE.Group;
  readonly roadMaterial: THREE.Material;
  readonly yellowMaterial: THREE.MeshBasicMaterial;
  readonly whiteMaterial: THREE.MeshBasicMaterial;
  readonly roads: Map<string, RoadRecord>;
  readonly lanes: Map<string, LaneRecord>;
  readonly intersections: Map<string, IntersectionRecord>;
  yardNetwork: YardNetwork | null;
  routeSequence: number;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.group = new THREE.Group();
    this.group.name = "yard-road-system";
    this.scene.add(this.group);

    this.roadMaterial = this._createConcreteMaterial();

    this.yellowMaterial = new THREE.MeshBasicMaterial({
      color: 0xeabf2d,
    });

    this.whiteMaterial = new THREE.MeshBasicMaterial({
      color: 0xf2f5f5,
    });

    this.roads = new Map();
    this.lanes = new Map();
    this.intersections = new Map();

    this.yardNetwork = null;
    this.routeSequence = 0;
  }

  // 创建道路，同时生成导航曲线和可选的道路模型。
  createRoad({
    id,
    type = "GENERAL",
    points,
    width = 8,
    closed = false,
    lanes = [{ id: `${id}_L1`, offset: 0, direction: 1 }],
    visualize = true,
    transient = false,
    cornerRadius = 0,
  }: RoadCreateOptions): RoadRecord {
    if (!id || this.roads.has(id)) {
      throw new Error(`Road "${id}" already exists.`);
    }

    if (!Array.isArray(points) || points.length < 2) {
      throw new Error(`Road "${id}" requires at least two points.`);
    }

    const centerline = points.map((point) => point.clone());

    const centerPath = this._createPathCurve(
      centerline,
      closed,
      cornerRadius,
    );

    const road: RoadRecord = {
      id,
      type,
      width,
      closed,
      points: centerline,
      centerPath,
      cornerRadius,
      laneIds: [],
      meshGroup: null,
      transient,
    };

    this.roads.set(id, road);

    lanes.forEach((definition, index) => {
      const laneId = definition.id ?? `${id}_L${index + 1}`;

      const lanePoints = this._offsetPathPoints(
        centerline,
        definition.offset ?? 0,
        closed,
      );

      const path = this._createPathCurve(
        lanePoints,
        closed,
        cornerRadius,
      );

      const lane: LaneRecord = {
        id: laneId,
        roadId: id,
        index,
        offset: definition.offset ?? 0,
        direction: definition.direction === -1 ? -1 : 1,
        path,
        length: path.getLength(),
      };

      this.lanes.set(laneId, lane);
      road.laneIds.push(laneId);
    });

    if (visualize) {
      road.meshGroup = this._createPathRoadVisual(road);
    }

    return road;
  }

  createAGVRoad(options: RoadCreateOptions): RoadRecord {
    return this.createRoad({
      type: "AGV",
      width: 9,
      cornerRadius: 24,
      ...options,
    });
  }

  createRoutePath(points: THREE.Vector3[], { id = null }: { id?: string | null } = {}): RoutePathRecord {
    const routeId =
      id ?? `ROUTE_${String(++this.routeSequence).padStart(4, "0")}`;

    const road = this.createRoad({
      id: routeId,
      type: "ROUTE",
      points,
      width: 0,
      lanes: [
        {
          id: `${routeId}_L1`,
          offset: 0,
          direction: 1,
        },
      ],
      visualize: false,
      transient: true,
    });

    return {
      roadId: road.id,
      laneId: road.laneIds[0],
      length: (() => {
        const lane = this.getLane(road.laneIds[0]);
        if (!lane) throw new Error(`Route lane "${road.laneIds[0]}" was not registered.`);
        return lane.length;
      })(),
    };
  }

  getRoad(id: string): RoadRecord | null {
    return this.roads.get(id) ?? null;
  }

  getLane(id: string): LaneRecord | null {
    return this.lanes.get(id) ?? null;
  }

  registerIntersection({ id, roadIds, position, rules = {} }: { id: string; roadIds: string[]; position: THREE.Vector3; rules?: Record<string, unknown> }): IntersectionRecord {
    if (!id || this.intersections.has(id)) {
      throw new Error(`Intersection "${id}" already exists.`);
    }

    const unknownRoad = roadIds?.find(
      (roadId) => !this.roads.has(roadId),
    );

    if (
      !Array.isArray(roadIds) ||
      roadIds.length < 2 ||
      unknownRoad
    ) {
      throw new Error(
        `Intersection "${id}" requires at least two registered roads.`,
      );
    }

    const intersection = {
      id,
      roadIds: [...roadIds],
      position: position.clone(),
      rules: { ...rules },
    };

    this.intersections.set(id, intersection);

    return intersection;
  }

  getIntersection(id: string): IntersectionRecord | null {
    return this.intersections.get(id) ?? null;
  }

  getPrimaryLane(roadId: string): LaneRecord | null {
    const road = this.getRoad(roadId);
    return road ? this.getLane(road.laneIds[0]) : null;
  }

  getPath(roadId: string, laneId: string | null = null): THREE.CurvePath<THREE.Vector3> | null {
    const lane = laneId
      ? this.getLane(laneId)
      : this.getPrimaryLane(roadId);

    return lane?.path ?? null;
  }

  getLaneLength(laneId: string): number {
    return this.getLane(laneId)?.length ?? 0;
  }

  // 提供给分块 / LOD 系统的可渲染对象。
  getRenderSegments(): RoadRenderSegment[] {
    this.group.updateMatrixWorld(true);

    const segments: RoadRenderSegment[] = [];
    let index = 0;

    this.group.traverse((object) => {
      const renderObject = object as RoadRenderableObject;
      if (!renderObject.isMesh && !renderObject.isLineSegments) return;

      const bounds = new THREE.Box3().setFromObject(renderObject);
      if (bounds.isEmpty()) return;

      segments.push({
        id: `ROAD_RENDER_${String(++index).padStart(5, "0")}`,
        object: renderObject,
        bounds,
        kind:
          renderObject.isMesh && renderObject.material === this.roadMaterial
            ? "surface"
            : "detail",
      });
    });

    return segments;
  }

  getPointAt(laneId: string, u: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    const lane = this.getLane(laneId);
    if (!lane) return null;

    return lane.path.getPointAt(
      lane.direction === 1 ? u : 1 - u,
      target,
    );
  }

  getTangentAt(laneId: string, u: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    const lane = this.getLane(laneId);
    if (!lane) return null;

    lane.path.getTangentAt(
      lane.direction === 1 ? u : 1 - u,
      target,
    );

    if (lane.direction === -1) target.negate();

    return target;
  }

  getNearestU(laneId: string, position: THREE.Vector3, samples = 240): number {
    const lane = this.getLane(laneId);
    if (!lane) return 0;

    const probe = new THREE.Vector3();

    let nearestU = 0;
    let nearestDistance = Infinity;

    for (let index = 0; index <= samples; index += 1) {
      const u = index / samples;

      this.getPointAt(laneId, u, probe);

      const distance = probe.distanceToSquared(position);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestU = u;
      }
    }

    return nearestU;
  }

  removeRoad(roadId: string): boolean {
    const road = this.getRoad(roadId);
    if (!road) return false;

    road.laneIds.forEach((laneId) => this.lanes.delete(laneId));

    road.meshGroup?.removeFromParent();
    this.roads.delete(roadId);

    return true;
  }

  // 根据箱位布局创建堆场道路和导航网络。
  createYardNetwork({
    slots,
    outerRoadWidth = 12,
    minimumMainRoadWidth = 8,
    minimumCrossRoadWidth = 8,
  }: { slots: YardSlotInput[]; outerRoadWidth?: number; minimumMainRoadWidth?: number; minimumCrossRoadWidth?: number }): YardNetwork {
    const slotBounds: RoadSystemSlotBound[] = slots.map((slot) => ({
      ...slot,
      box:
        slot.bounds?.clone() ??
        new THREE.Box3().setFromObject(slot.model ?? new THREE.Object3D()),
    }));

    const rows = this._createAxisBands(slotBounds, "z");
    const columns = this._createAxisBands(slotBounds, "x");

    const crossRoads = this._createRoadBands(
      rows,
      outerRoadWidth,
      minimumCrossRoadWidth,
    );

    const mainRoads = this._createRoadBands(
      columns,
      outerRoadWidth,
      minimumMainRoadWidth,
    );

    if (!mainRoads.length || !crossRoads.length) {
      throw new Error("Yard network requires at least one main road and one cross road.");
    }
    const firstMainRoad = mainRoads[0];
    const lastMainRoad = mainRoads[mainRoads.length - 1];
    const firstCrossRoad = crossRoads[0];
    const lastCrossRoad = crossRoads[crossRoads.length - 1];
    const roadMinX = firstMainRoad.center - firstMainRoad.width / 2;

    const roadMaxX =
      lastMainRoad.center + lastMainRoad.width / 2;

    const roadMinZ =
      firstCrossRoad.center - firstCrossRoad.width / 2;

    const roadMaxZ =
      lastCrossRoad.center + lastCrossRoad.width / 2;

    const roadCenterX = (roadMinX + roadMaxX) / 2;
    const roadCenterZ = (roadMinZ + roadMaxZ) / 2;
    const roadLength = roadMaxX - roadMinX;
    const roadDepth = roadMaxZ - roadMinZ;

    const dashes = {
      horizontal: [],
      vertical: [],
    };

    mainRoads.forEach((road) => {
      this._createMainRoad(
        road.center,
        roadCenterZ,
        road.width,
        roadDepth,
      );

      this._queueMainMarkings(
        road,
        roadMinZ,
        roadMaxZ,
        dashes.vertical,
      );
    });

    crossRoads.forEach((road) => {
      this._createCrossRoad(
        roadCenterX,
        road.center,
        roadLength,
        road.width,
      );

      this._queueCrossMarkings(
        road,
        roadMinX,
        roadMaxX,
        dashes.horizontal,
      );
    });

    this._createDashes(dashes.horizontal, "horizontal");
    this._createDashes(dashes.vertical, "vertical");
    this._createSlotFrames(slotBounds);
    this._createIntersectionArrows(mainRoads, crossRoads);

    const registeredMainRoads: RegisteredRoadBand[] = mainRoads.map((road, index) => {
      const id = `YARD_MAIN_${String(index + 1).padStart(2, "0")}`;
      const laneId = `${id}_L1`;

      return { ...road, id, laneId };
    });

    registeredMainRoads.forEach((road) => {

      this.createRoad({
        id: road.id,
        type: "YARD_MAIN",
        points: [
          new THREE.Vector3(road.center, 0.12, roadMinZ),
          new THREE.Vector3(road.center, 0.12, roadMaxZ),
        ],
        width: road.width,
        lanes: [
          {
            id: road.laneId,
            offset: 0,
            direction: 1,
          },
        ],
        visualize: false,
      });
    });

    const registeredCrossRoads: RegisteredRoadBand[] = crossRoads.map((road, index) => {
      const id = `YARD_CROSS_${String(index + 1).padStart(2, "0")}`;
      const laneId = `${id}_L1`;

      return { ...road, id, laneId };
    });

    registeredCrossRoads.forEach((road) => {

      this.createRoad({
        id: road.id,
        type: "YARD_CROSS",
        points: [
          new THREE.Vector3(roadMinX, 0.12, road.center),
          new THREE.Vector3(roadMaxX, 0.12, road.center),
        ],
        width: road.width,
        lanes: [
          {
            id: road.laneId,
            offset: 0,
            direction: 1,
          },
        ],
        visualize: false,
      });
    });

    const network = this._createNetwork({
      slotBounds,
      mainRoads: registeredMainRoads,
      crossRoads: registeredCrossRoads,
      roadMinX,
      roadMaxX,
      roadMinZ,
      roadMaxZ,
    });

    this.yardNetwork = network;

    return network;
  }

  _offsetPathPoints(points: THREE.Vector3[], offset: number, closed: boolean): THREE.Vector3[] {
    if (Math.abs(offset) < 0.0001) {
      return points.map((point) => point.clone());
    }

    return points.map((point, index) => {
      const previous =
        points[
          index === 0
            ? closed
              ? points.length - 1
              : 0
            : index - 1
        ];

      const next =
        points[
          index === points.length - 1
            ? closed
              ? 0
              : points.length - 1
            : index + 1
        ];

      const tangent = next.clone().sub(previous);
      tangent.y = 0;

      if (tangent.lengthSq() < 0.000001) {
        return point.clone();
      }

      tangent.normalize();

      return point.clone().add(
        new THREE.Vector3(-tangent.z, 0, tangent.x)
          .multiplyScalar(offset),
      );
    });
  }

  // 创建导航曲线，保留原有贝塞尔倒角逻辑。
  _createPathCurve(points: THREE.Vector3[], closed: boolean, cornerRadius: number): THREE.CurvePath<THREE.Vector3> {
    const path = new THREE.CurvePath<THREE.Vector3>();

    if (points.length < 2) return path;

    if (cornerRadius <= 0 || points.length < 3) {
      for (let index = 1; index < points.length; index += 1) {
        path.add(
          new THREE.LineCurve3(points[index - 1], points[index]),
        );
      }

      if (closed) {
        path.add(new THREE.LineCurve3(points.at(-1), points[0]));
      }

      return path;
    }

    const corners = points.map((point, index) => {
      const isEndpoint =
        !closed && (index === 0 || index === points.length - 1);

      if (isEndpoint) {
        return {
          entry: point.clone(),
          exit: point.clone(),
          rounded: false,
        };
      }

      const previous =
        points[index === 0 ? points.length - 1 : index - 1];

      const next = points[(index + 1) % points.length];

      const incoming = point.clone().sub(previous);
      const outgoing = next.clone().sub(point);

      incoming.y = 0;
      outgoing.y = 0;

      const incomingLength = incoming.length();
      const outgoingLength = outgoing.length();

      if (incomingLength < 0.001 || outgoingLength < 0.001) {
        return {
          entry: point.clone(),
          exit: point.clone(),
          rounded: false,
        };
      }

      incoming.divideScalar(incomingLength);
      outgoing.divideScalar(outgoingLength);

      const turn = Math.abs(
        incoming.x * outgoing.z - incoming.z * outgoing.x,
      );

      if (turn < 0.001) {
        return {
          entry: point.clone(),
          exit: point.clone(),
          rounded: false,
        };
      }

      const radius = Math.min(
        cornerRadius,
        incomingLength * 0.45,
        outgoingLength * 0.45,
      );

      return {
        entry: point.clone().addScaledVector(incoming, -radius),
        exit: point.clone().addScaledVector(outgoing, radius),
        rounded: true,
      };
    });

    const addSegment = (from: THREE.Vector3, to: THREE.Vector3): void => {
      if (from.distanceToSquared(to) > 0.000001) {
        path.add(new THREE.LineCurve3(from, to));
      }
    };

    const addCorner = (index: number): void => {
      const corner = corners[index];

      if (corner.rounded) {
        path.add(
          new THREE.QuadraticBezierCurve3(
            corner.entry,
            points[index],
            corner.exit,
          ),
        );
      }
    };

    if (closed) {
      const firstCorner = corners[0];
      const lastCorner = corners[corners.length - 1];
      if (!firstCorner || !lastCorner) return path;

      let cursor = lastCorner.exit;

      for (let index = 0; index < points.length; index += 1) {
        const corner = corners[index];
        if (!corner) continue;
        addSegment(cursor, corner.entry);
        addCorner(index);
        cursor = corner.exit;
      }

      return path;
    }

    const firstCorner = corners[0];
    const lastCorner = corners[corners.length - 1];
    if (!firstCorner || !lastCorner) return path;

    let cursor = firstCorner.exit;

    for (let index = 1; index < points.length - 1; index += 1) {
      const corner = corners[index];
      if (!corner) continue;
      addSegment(cursor, corner.entry);
      addCorner(index);
      cursor = corner.exit;
    }

    addSegment(cursor, lastCorner.entry);

    return path;
  }

  // 弯道优化：
  // 路面、黄线、虚线共用同一组截面，避免独立 Plane 拼接产生裂缝。
  // 每约 80 米合并为一组网格，保留分块裁剪能力。
  _createPathRoadVisual(road: RoadRecord): THREE.Group {
    const group = new THREE.Group();
    group.name = `${road.id}-visual`;

    if (road.width <= 0) {
      this.group.add(group);
      return group;
    }

    // 分别采样每条子曲线，保留直线和贝塞尔之间的连接点。
    // 直线约 8 米一个采样点，弯道约 1 米一个采样点。
    const points: THREE.Vector3[] = [];

    for (const curve of road.centerPath.curves) {
      const length = curve.getLength();

      if (length < 0.000001) continue;

      const curveWithLineFlag = curve as THREE.Curve<THREE.Vector3> & {
        isLineCurve3?: boolean;
      };
      const count = Math.max(
        1,
        Math.ceil(length / (curveWithLineFlag.isLineCurve3 ? 8 : 1)),
      );

      for (let i = 0; i <= count; i += 1) {
        const point = curve.getPointAt(i / count);
        point.y = 0;

        const previousPoint = points[points.length - 1];
        if (!previousPoint || point.distanceToSquared(previousPoint) > 1e-12) {
          points.push(point);
        }
      }
    }

    if (points.length < 2) {
      this.group.add(group);
      return group;
    }

    // 闭环首尾使用相同坐标。
    if (road.closed) {
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      if (!firstPoint || !lastPoint) {
        this.group.add(group);
        return group;
      }

      if (firstPoint.distanceToSquared(lastPoint) < 1e-10) {
        points.pop();
      }

      points.push(firstPoint.clone());
    }

    const last = points.length - 1;
    let distance = 0;

    // 每个采样点保存位置、横向偏移向量和累计里程。
    const frames = points.map((point, i) => {
      if (i > 0) {
        distance += point.distanceTo(points[i - 1]);
      }

      const previous =
        i > 0
          ? points[i - 1]
          : road.closed
            ? points[last - 1]
            : point;

      const next =
        i < last
          ? points[i + 1]
          : road.closed
            ? points[1]
            : point;

      const incoming = point.clone().sub(previous).normalize();
      const outgoing = next.clone().sub(point).normalize();

      if (incoming.lengthSq() < 1e-12) {
        incoming.copy(outgoing);
      }

      if (outgoing.lengthSq() < 1e-12) {
        outgoing.copy(incoming);
      }

      const normalIn = new THREE.Vector3(
        -incoming.z,
        0,
        incoming.x,
      );

      const normalOut = new THREE.Vector3(
        -outgoing.z,
        0,
        outgoing.x,
      );

      const normal = normalIn.clone().add(normalOut);

      if (normal.lengthSq() < 1e-12) {
        normal.copy(normalOut);
      }

      normal.normalize();

      // 斜接补偿：相邻段共用边缘顶点，限制尖角过度外伸。
      normal.multiplyScalar(
        1 / Math.max(0.5, normal.dot(normalOut)),
      );

      return {
        point,
        normal,
        distance,
      };
    });

    const totalLength = distance;

    if (totalLength < 0.000001) {
      this.group.add(group);
      return group;
    }

    // 按累计里程获取截面，分块边界与虚线端点使用相同插值。
    const frameAt = (s: number): RoadFrame => {
      let low = 0;
      let high = frames.length - 1;

      while (low + 1 < high) {
        const mid = (low + high) >> 1;

        if (frames[mid].distance <= s) {
          low = mid;
        } else {
          high = mid;
        }
      }

      const a = frames[low];
      const b = frames[high];

      const t = THREE.MathUtils.clamp(
        (s - a.distance) / (b.distance - a.distance),
        0,
        1,
      );

      return {
        point: a.point.clone().lerp(b.point, t),
        normal: a.normal.clone().lerp(b.normal, t),
        distance: s,
      };
    };

    // 截取某个里程区间的所有截面。
    const slice = (start: number, end: number): RoadFrame[] => {
      const result = [frameAt(start)];

      let low = 0;
      let high = frames.length;

      while (low < high) {
        const mid = (low + high) >> 1;

        if (frames[mid].distance <= start + 1e-8) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }

      for (
        let i = low;
        i < frames.length && frames[i].distance < end - 1e-8;
        i += 1
      ) {
        result.push(frames[i]);
      }

      result.push(frameAt(end));

      return result;
    };

    const newBuffer = (): RoadBuffer => ({
      positions: [],
      uvs: [],
      indices: [],
    });

    // 向缓冲区添加连续条带，可用于路面、边线和虚线。
    const appendStrip = (
      buffer: RoadBuffer,
      section: RoadFrame[],
      offset: number,
      width: number,
      height: number,
    ): void => {
      const base = buffer.positions.length / 3;

      for (const frame of section) {
        for (const side of [-1, 1]) {
          const lateral = offset + (side * width) / 2;

          const x =
            frame.point.x + frame.normal.x * lateral;

          const z =
            frame.point.z + frame.normal.z * lateral;

          buffer.positions.push(x, height, z);

          // 世界坐标 UV，避免分块接缝处纹理重新开始。
          buffer.uvs.push(x / 16, z / 16);
        }
      }

      for (let i = 0; i < section.length - 1; i += 1) {
        const a = base + i * 2;

        // 三角形朝向 +Y。
        buffer.indices.push(
          a,
          a + 1,
          a + 2,
          a + 1,
          a + 3,
          a + 2,
        );
      }
    };

    const addMesh = (
      buffer: RoadBuffer,
      material: THREE.Material,
      name: string,
      receiveShadow = false,
    ): void => {
      if (!buffer.indices.length) return;

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(buffer.positions, 3),
      );

      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(buffer.uvs, 2),
      );

      geometry.setIndex(buffer.indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(geometry, material);

      mesh.name = name;
      mesh.receiveShadow = receiveShadow;

      group.add(mesh);
    };

    const edgeWidth = Math.min(0.22, road.width * 0.1);

    const edgeOffset = Math.max(
      road.width / 2 - 0.25,
      edgeWidth / 2,
    );

    const dashLength = 4.2;
    const dashPeriod = 8;

    // 闭环调整为整数个虚线周期，避免首尾节奏不一致。
    const period = road.closed
      ? totalLength /
        Math.max(1, Math.round(totalLength / dashPeriod))
      : dashPeriod;

    const paintedLength = Math.min(
      dashLength,
      period * 0.525,
    );

    const dashMargin = (period - paintedLength) / 2;

    const chunkCount = Math.max(
      1,
      Math.ceil(totalLength / ROAD_VISUAL_SEGMENT_LENGTH),
    );

    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      const start = (chunk * totalLength) / chunkCount;
      const end = ((chunk + 1) * totalLength) / chunkCount;

      const section = slice(start, end);

      const surface = newBuffer();
      const edges = newBuffer();
      const dashes = newBuffer();

      appendStrip(
        surface,
        section,
        0,
        road.width,
        ROAD_HEIGHT,
      );

      for (const offset of [-edgeOffset, edgeOffset]) {
        appendStrip(
          edges,
          section,
          offset,
          edgeWidth,
          MARKING_HEIGHT,
        );
      }

      if (road.laneIds.length > 1) {
        for (
          let k = Math.floor(start / period);
          k * period < end;
          k += 1
        ) {
          const dashStart = Math.max(
            start,
            k * period + dashMargin,
          );

          const dashEnd = Math.min(
            end,
            k * period + dashMargin + paintedLength,
          );

          if (dashEnd - dashStart > 1e-6) {
            appendStrip(
              dashes,
              slice(dashStart, dashEnd),
              0,
              Math.min(0.2, road.width * 0.1),
              MARKING_HEIGHT,
            );
          }
        }
      }

      addMesh(
        surface,
        this.roadMaterial,
        `${road.id}-surface-${chunk}`,
        true,
      );

      addMesh(
        edges,
        this.yellowMaterial,
        `${road.id}-edges-${chunk}`,
      );

      addMesh(
        dashes,
        this.whiteMaterial,
        `${road.id}-dashes-${chunk}`,
      );
    }

    this.group.add(group);

    return group;
  }

  _createAxisBands(slots: RoadSystemSlotBound[], axis: "x" | "z"): RoadAxisBand[] {
    const bands: RoadAxisBand[] = [];
    const axisCenter = axis === "x" ? "x" : "z";

    const values = slots
      .map((slot) => ({
        min: axis === "x" ? slot.box.min.x : slot.box.min.z,
        max: axis === "x" ? slot.box.max.x : slot.box.max.z,
        center: slot.box.getCenter(new THREE.Vector3())[axisCenter],
      }))
      .sort((left, right) => left.center - right.center);

    values.forEach((value) => {
      const band = bands.at(-1);

      if (!band || Math.abs(value.center - band.center) > 0.5) {
        bands.push({
          ...value,
          count: 1,
        });

        return;
      }

      band.min = Math.min(band.min, value.min);
      band.max = Math.max(band.max, value.max);

      band.center =
        (band.center * band.count + value.center) /
        (band.count + 1);

      band.count += 1;
    });

    return bands;
  }

  _createRoadBands(
    bands: RoadAxisBand[],
    outerRoadWidth: number,
    minimumInteriorWidth: number,
  ): RoadBand[] {
    if (!bands.length) return [];

    const roads: RoadBand[] = [
      {
        center: bands[0].min - outerRoadWidth / 2,
        width: outerRoadWidth,
      },
    ];

    for (let index = 0; index < bands.length - 1; index += 1) {
      const gap = bands[index + 1].min - bands[index].max;

      if (gap >= minimumInteriorWidth) {
        roads.push({
          center:
            (bands[index].max + bands[index + 1].min) / 2,
          width: gap,
        });
      }
    }

    const lastBand = bands[bands.length - 1];
    if (!lastBand) return roads;

    roads.push({
      center: lastBand.max + outerRoadWidth / 2,
      width: outerRoadWidth,
    });

    return roads;
  }

  _createMainRoad(x: number, z: number, width: number, depth: number): void {
    this._createSegmentedPlane(
      width,
      depth,
      x,
      z,
      this.roadMaterial,
      {
        height: ROAD_HEIGHT,
        receiveShadow: true,
        name: "yard-main-road-segment",
      },
    );

    const edgeOffset = width / 2 - 0.35;

    this._createLine(
      0.28,
      depth,
      x - edgeOffset,
      z,
      this.yellowMaterial,
    );

    this._createLine(
      0.28,
      depth,
      x + edgeOffset,
      z,
      this.yellowMaterial,
    );
  }

  _createCrossRoad(x: number, z: number, length: number, width: number): void {
    this._createSegmentedPlane(
      length,
      width,
      x,
      z,
      this.roadMaterial,
      {
        height: ROAD_HEIGHT,
        receiveShadow: true,
        name: "yard-cross-road-segment",
      },
    );

    const edgeOffset = width / 2 - 0.35;

    this._createLine(
      length,
      0.28,
      x,
      z - edgeOffset,
      this.yellowMaterial,
    );

    this._createLine(
      length,
      0.28,
      x,
      z + edgeOffset,
      this.yellowMaterial,
    );
  }

  _queueCrossMarkings(road: RoadBand, minX: number, maxX: number, target: RoadDash[]): void {
    for (let x = minX + 5; x < maxX - 2; x += 8) {
      target.push({
        x,
        z: road.center,
        length: 4.2,
        width: 0.3,
      });
    }
  }

  _queueMainMarkings(road: RoadBand, minZ: number, maxZ: number, target: RoadDash[]): void {
    for (let z = minZ + 5; z < maxZ - 2; z += 8) {
      target.push({
        x: road.center,
        z,
        length: 4.2,
        width: 0.3,
      });
    }
  }

  _createDashes(dashes: RoadDash[], direction: "horizontal" | "vertical"): void {
    if (!dashes.length) return;

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.InstancedMesh(
      geometry,
      this.whiteMaterial,
      dashes.length,
    );

    const matrix = new THREE.Matrix4();

    dashes.forEach((dash: RoadDash, index: number) => {
      const scale =
        direction === "horizontal"
          ? new THREE.Vector3(dash.length, dash.width, 1)
          : new THREE.Vector3(dash.width, dash.length, 1);

      matrix.compose(
        new THREE.Vector3(dash.x, MARKING_HEIGHT, dash.z),
        new THREE.Quaternion(),
        scale,
      );

      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = `yard-${direction}-lane-dashes`;

    this.group.add(mesh);
  }

  _createSlotFrames(slotBounds: RoadSystemSlotBound[]): void {
    const positions: number[] = [];
    const floorSlots = new Map<string, RoadSystemSlotBound>();

    slotBounds.forEach((slot) => {
      const center = slot.box.getCenter(new THREE.Vector3());
      const key = `${center.x.toFixed(3)}:${center.z.toFixed(3)}`;
      const current = floorSlots.get(key);

      if (!current || slot.box.min.y < current.box.min.y) {
        floorSlots.set(key, slot);
      }
    });

    floorSlots.forEach((slot) => {
      const { min, max } = slot.box;

      const offsetX = 0.35;
      const offsetZ = 0.24;
      const y = MARKING_HEIGHT;

      const corners = [
        [min.x - offsetX, min.z - offsetZ],
        [max.x + offsetX, min.z - offsetZ],
        [max.x + offsetX, max.z + offsetZ],
        [min.x - offsetX, max.z + offsetZ],
      ];

      corners.forEach((corner, index) => {
        const next = corners[(index + 1) % corners.length];

        positions.push(
          corner[0],
          y,
          corner[1],
          next[0],
          y,
          next[1],
        );
      });
    });

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );

    const frames = new THREE.LineSegments(
      geometry,
      this.yellowMaterial,
    );

    frames.name = "yard-container-slot-frames";

    this.group.add(frames);
  }

  _createIntersectionArrows(mainRoads: RoadBand[], crossRoads: RoadBand[]): void {
    mainRoads.forEach((mainRoad) => {
      crossRoads.forEach((crossRoad, index) => {
        if (index % 2 !== 0) return;

        this._createArrow(
          mainRoad.center,
          crossRoad.center,
          index % 4 === 0 ? 0 : Math.PI,
        );
      });
    });
  }

  _createArrow(x: number, z: number, rotationY: number): void {
    const shape = new THREE.Shape();

    shape.moveTo(-2.1, -0.7);
    shape.lineTo(0.5, -0.7);
    shape.lineTo(0.5, -1.35);
    shape.lineTo(2.25, 0);
    shape.lineTo(0.5, 1.35);
    shape.lineTo(0.5, 0.7);
    shape.lineTo(-2.1, 0.7);
    shape.closePath();

    const arrow = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      this.whiteMaterial,
    );

    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = rotationY;
    arrow.position.set(x, MARKING_HEIGHT, z);

    this.group.add(arrow);
  }

  _createLine(width: number, depth: number, x: number, z: number, material: THREE.Material): void {
    this._createSegmentedPlane(
      width,
      depth,
      x,
      z,
      material,
      {
        height: MARKING_HEIGHT,
        name: "yard-road-edge-segment",
      },
    );
  }

  _createSegmentedPlane(
    width: number,
    depth: number,
    x: number,
    z: number,
    material: THREE.Material,
    {
      height,
      receiveShadow = false,
      name,
    }: RoadSegmentOptions,
  ): void {
    const splitX = width >= depth;
    const totalLength = splitX ? width : depth;

    const count = Math.max(
      1,
      Math.ceil(totalLength / ROAD_VISUAL_SEGMENT_LENGTH),
    );

    const segmentLength = totalLength / count;
    const start = -totalLength / 2 + segmentLength / 2;

    for (let index = 0; index < count; index += 1) {
      const segmentWidth = splitX ? segmentLength : width;
      const segmentDepth = splitX ? depth : segmentLength;

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(segmentWidth, segmentDepth),
        material,
      );

      mesh.name = name;
      mesh.rotation.x = -Math.PI / 2;

      mesh.position.set(
        splitX ? x + start + index * segmentLength : x,
        height,
        splitX ? z : z + start + index * segmentLength,
      );

      mesh.receiveShadow = receiveShadow;

      this.group.add(mesh);
    }
  }

  // 创建路口节点、路段边及箱位接驳点。
  _createNetwork({
    slotBounds,
    mainRoads,
    crossRoads,
    roadMinX,
    roadMaxX,
    roadMinZ,
    roadMaxZ,
  }: RoadNetworkBuildInput): YardNetwork {
    const nodes: YardNetworkNode[] = [];
    const edges: YardNetworkEdge[] = [];
    const nodeById = new Map<string, YardNetworkNode>();
    const containerAccess = new Map<string, YardContainerAccess>();
    const edgeIds = new Set<string>();

    const addNode = (id: string, x: number, z: number, kind: string): YardNetworkNode => {
      const node: YardNetworkNode = {
        id,
        kind,
        position: new THREE.Vector3(x, 0.12, z),
      };

      nodes.push(node);
      nodeById.set(id, node);

      return node;
    };

    const addEdge = (from: string, to: string, kind: string): void => {
      if (!from || !to || from === to) return;

      const edgeId = [from, to].sort().join("|");

      if (edgeIds.has(edgeId)) return;

      edgeIds.add(edgeId);

      const startNode = nodeById.get(from);
      const endNode = nodeById.get(to);
      if (!startNode || !endNode) return;
      const start = startNode.position;
      const end = endNode.position;

      edges.push({
        from,
        to,
        kind,
        length: start.distanceTo(end),
      });
    };

    crossRoads.forEach((crossRoad, crossIndex) => {
      mainRoads.forEach((mainRoad, mainIndex) => {
        addNode(
          `ROAD_${mainIndex}_${crossIndex}`,
          mainRoad.center,
          crossRoad.center,
          "intersection",
        );

        this.registerIntersection({
          id: `INTERSECTION_${mainIndex}_${crossIndex}`,
          roadIds: [mainRoad.id, crossRoad.id],
          position: new THREE.Vector3(
            mainRoad.center,
            0.12,
            crossRoad.center,
          ),
        });

        if (mainIndex > 0) {
          addEdge(
            `ROAD_${mainIndex - 1}_${crossIndex}`,
            `ROAD_${mainIndex}_${crossIndex}`,
            "cross",
          );
        }

        if (crossIndex > 0) {
          addEdge(
            `ROAD_${mainIndex}_${crossIndex - 1}`,
            `ROAD_${mainIndex}_${crossIndex}`,
            "main",
          );
        }
      });
    });

    const stackAccess = new Map<string, { nodeId: string }>();

    slotBounds.forEach((slot) => {
      const center = slot.box.getCenter(new THREE.Vector3());

      const stackKey =
        `${center.x.toFixed(3)}:${center.z.toFixed(3)}`;

      let access = stackAccess.get(stackKey);

      if (!access) {
        const accessIndex = stackAccess.size;

        const crossIndex = this._nearestRoadIndex(
          crossRoads,
          center.z,
        );

        const leftIndex = this._leftRoadIndex(
          mainRoads,
          center.x,
        );

        const rightIndex = Math.min(
          leftIndex + 1,
          mainRoads.length - 1,
        );

        const nodeId = `ACCESS_STACK_${accessIndex}`;

        addNode(
          nodeId,
          center.x,
          crossRoads[crossIndex].center,
          "container-access",
        );

        addEdge(
          `ROAD_${leftIndex}_${crossIndex}`,
          nodeId,
          "access",
        );

        addEdge(
          nodeId,
          `ROAD_${rightIndex}_${crossIndex}`,
          "access",
        );

        access = { nodeId };
        stackAccess.set(stackKey, access);
      }

      const accessNode = nodeById.get(access.nodeId);
      if (!accessNode) return;
      containerAccess.set(slot.id, {
        nodeId: access.nodeId,
        position: accessNode.position.clone(),
        slotPosition: center,
      });
    });

    return {
      group: this.group,
      nodes,
      edges,
      nodeById,
      containerAccess,
      bounds: {
        min: new THREE.Vector3(roadMinX, 0, roadMinZ),
        max: new THREE.Vector3(roadMaxX, 0, roadMaxZ),
      },
    };
  }

  _nearestRoadIndex(roads: RoadBand[], coordinate: number): number {
    return roads.reduce(
      (nearest, road, index) =>
        Math.abs(road.center - coordinate) <
        Math.abs(roads[nearest].center - coordinate)
          ? index
          : nearest,
      0,
    );
  }

  _leftRoadIndex(roads: RoadBand[], coordinate: number): number {
    let index = 0;

    roads.forEach((road, candidateIndex) => {
      if (road.center <= coordinate) {
        index = candidateIndex;
      }
    });

    return index;
  }

  _createConcreteMaterial() {
    if (typeof document === "undefined") {
      return new THREE.MeshStandardMaterial({
        color: 0xb4babd,
        roughness: 0.92,
      });
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;

    const context = canvas.getContext("2d");
    if (!context) return new THREE.MeshStandardMaterial({ color: 0xb4babd, roughness: 0.92 });

    context.fillStyle = "#b8bec1";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 12000; index += 1) {
      const tone = 150 + Math.floor(Math.random() * 34);

      context.fillStyle =
        `rgba(${tone},${tone + 2},${tone + 3},0.13)`;

      context.fillRect(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        1,
        1,
      );
    }

    const texture = new THREE.CanvasTexture(canvas);

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 6);
    texture.colorSpace = THREE.SRGBColorSpace;

    return new THREE.MeshStandardMaterial({
      color: 0xb9bec0,
      map: texture,
      roughness: 0.9,
      metalness: 0,
    });
  }
}

export default RoadSystem;
