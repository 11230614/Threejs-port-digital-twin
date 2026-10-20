// ============================================================================
// RoadRenderAdapter.js —— 道路渲染适配器
//                        （Road Render Adapter：按距离拆掉路面的装饰）
//
// 【这个文件干什么】
// 道路的降档方式与车辆完全不同。车可以换成一个简模，
// 道路却是"一堆各自独立的碎片"：路面、车道虚线、箭头、箱位框线。
// 所以本适配器的降档策略是"逐层剥离"而非"整体替换"。
//
// 【四档做法：从繁到简一层层扒掉】
//   LOD0 —— 全部显示：路面 + 虚线 + 箭头 + 框线，路面还投影
//   LOD1 —— 只留路面（surface），装饰全部隐藏，不再投影
//   LOD2 —— 连路面也不画，整格换成一块灰色矩形代理
//   LOD3 —— 什么都不画
//
// 【为什么装饰件最先被砍】车道虚线与箱位框线是数量最多的部分
//（一格里可能有上千条），却也是最小的——远处只有不到一个像素。
// 砍掉它们省下的绘制量最大，画面损失最小。
// 而路面是大块面积，砍早了会让画面出现明显的空洞。
//
// 【与 ObjectRenderAdapter 的三点关键差异】
//   1) 状态按"格"记而非按"物体"记 —— 道路碎片没有独立身份，
//      用户不会点选某一条虚线，也没有任务挂在上面。
//   2) 代理是整格一块矩形（createAreaProxy）而非逐个物体的色块 ——
//      一格里上千个碎片换成一千个色块毫无意义。
//   3) 代理直接挂在 scene 下而非某个外壳下 —— 道路是静态的，
//      不需要跟随任何物体移动。
//
// 【originalStates 快照表的必要性】
// 有些路面本来就是隐藏的（比如 createRoutePath 造的导航曲线，
// visualize: false）。升档时若一律设为可见，
// 那些不该看见的辅助线会全部冒出来。所以要先记住原值，
// 之后所有可见性都是"目标状态 且 原本可见"的与运算。
//
// 【术语翻译】
//   kind（碎片类别）:"surface"（路面）与其他装饰
//   surface（路面）          proxy（代理）
//   chunkState（按格记录的状态）  originalState（原始状态快照）
//   uuid（Three.js 给每个对象自动生成的唯一编号）
//   makeEmpty（把包围盒置为空）   union（求包围盒并集）
//   reduce（归约）           acquire / release（借出 / 归还）
//
// 原 JS 的逐段注释保留在这里作为实现说明；运行时代码只有本 TS 实现。
// ============================================================================

import * as THREE from "three";
import { ProxyFactory } from "../../../rendering/ProxyFactory.ts";
import { GpuResourcePool } from "../../../rendering/GpuResourcePool.ts";

export type RoadLODLevel = 0 | 1 | 2 | 3;
export interface RoadRenderItem {
  object: THREE.Object3D;
  kind: string;
  bounds: THREE.Box3;
}
export interface RoadChunkLODRequest {
  chunkId: string;
  items: readonly RoadRenderItem[];
  level: number;
}
interface RoadOriginalState {
  object: THREE.Object3D;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}
interface RoadChunkState {
  chunkId: string;
  items: readonly RoadRenderItem[];
  proxy: THREE.Mesh | null;
  level: number | null;
}

export class RoadRenderAdapter {
  readonly scene: THREE.Scene;
  readonly resourcePool: GpuResourcePool;
  readonly ownsResourcePool: boolean;
  readonly chunkStates = new Map<string, RoadChunkState>();
  readonly originalStates = new Map<string, RoadOriginalState>();
  switchCount = 0;

  constructor({ scene, resourcePool = null }: { scene: THREE.Scene; resourcePool?: GpuResourcePool | null }) {
    if (!scene?.isObject3D) throw new TypeError("RoadRenderAdapter requires a scene.");
    this.scene = scene;
    this.resourcePool = resourcePool ?? new GpuResourcePool();
    this.ownsResourcePool = !resourcePool;
  }

  applyChunkLOD({ chunkId, items, level }: RoadChunkLODRequest): void {
    let state = this.chunkStates.get(chunkId);
    const isNewState = !state;
    if (!state) {
      state = { chunkId, items: [], proxy: null, level: null };
      this.chunkStates.set(chunkId, state);
    }
    state.items = items;
    try {
      this._applyState(state, level);
    } catch (error) {
      const originalLevel = state.level;
      state.items.forEach((item) => {
        const original = this.originalStates.get(item.object.uuid);
        if (!original) return;
        if (originalLevel === null) {
          item.object.visible = original.visible;
          item.object.castShadow = original.castShadow;
          item.object.receiveShadow = original.receiveShadow;
          return;
        }
        item.object.visible = (originalLevel === 0 || (originalLevel === 1 && item.kind === "surface")) && original.visible;
        item.object.castShadow = originalLevel === 0 && original.castShadow;
        item.object.receiveShadow = originalLevel <= 1 && original.receiveShadow;
      });
      if (state.proxy) this._deactivateProxy(state);
      if (isNewState) {
        this.chunkStates.delete(chunkId);
        const trackedElsewhere = new Set([...this.chunkStates.values()].flatMap((chunk) => chunk.items.map((item) => item.object.uuid)));
        state.items.forEach((item) => { if (!trackedElsewhere.has(item.object.uuid)) this.originalStates.delete(item.object.uuid); });
      }
      throw error;
    }
  }

  getMetrics(): { trackedChunks: number; trackedObjects: number; levels: Record<string, number>; visibleProxies: number; switches: number } {
    const levels: Record<string, number> = {};
    this.chunkStates.forEach((state) => { const key = String(state.level); levels[key] = (levels[key] ?? 0) + 1; });
    return { trackedChunks: this.chunkStates.size, trackedObjects: this.originalStates.size, levels, visibleProxies: [...this.chunkStates.values()].filter((state) => state.proxy?.visible).length, switches: this.switchCount };
  }

  detach(item: { object?: THREE.Object3D | null } | null | undefined): boolean {
    const object = item?.object;
    const original = object ? this.originalStates.get(object.uuid) : undefined;
    if (!original || !object) return false;
    object.visible = false; object.castShadow = false; object.receiveShadow = false;
    return true;
  }

  dispose(): void {
    this.originalStates.forEach(({ object, visible, castShadow, receiveShadow }) => { object.visible = visible; object.castShadow = castShadow; object.receiveShadow = receiveShadow; });
    this.chunkStates.forEach((state) => this._deactivateProxy(state));
    this.originalStates.clear(); this.chunkStates.clear();
    if (this.ownsResourcePool) this.resourcePool.dispose();
  }

  private _applyState(state: RoadChunkState, level: number): void {
    if (state.level === level) return;
    state.items.forEach((item) => {
      const original = this._remember(item.object);
      item.object.visible = (level === 0 || (level === 1 && item.kind === "surface")) && original.visible;
      item.object.castShadow = level === 0 && original.castShadow;
      item.object.receiveShadow = level <= 1 && original.receiveShadow;
    });
    if (level === 2) this._activateProxy(state); else this._deactivateProxy(state);
    state.level = level; this.switchCount += 1;
  }

  private _activateProxy(state: RoadChunkState): void {
    if (state.proxy || !state.items.length) return;
    const proxyItems = state.items.some((item) => item.kind === "surface") ? state.items.filter((item) => item.kind === "surface") : state.items;
    const bounds = proxyItems.reduce((box, item) => box.union(item.bounds), new THREE.Box3().makeEmpty());
    const key = `road:${state.chunkId}:proxy`;
    state.proxy = this.resourcePool.acquire(key, { create: () => ProxyFactory.createAreaProxy({ scene: this.scene, bounds, name: `road-chunk-${state.chunkId}-lod-proxy`, attach: false }) });
    state.proxy.visible = true; this.scene.add(state.proxy);
  }

  private _deactivateProxy(state: RoadChunkState): void {
    if (!state.proxy) return;
    state.proxy.visible = false; state.proxy.removeFromParent();
    this.resourcePool.release(`road:${state.chunkId}:proxy`); state.proxy = null;
  }

  private _remember(object: THREE.Object3D): RoadOriginalState {
    let state = this.originalStates.get(object.uuid);
    if (!state) { state = { object, visible: object.visible, castShadow: object.castShadow, receiveShadow: object.receiveShadow }; this.originalStates.set(object.uuid, state); }
    return state;
  }
}

export default RoadRenderAdapter;
