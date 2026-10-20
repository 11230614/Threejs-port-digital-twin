// ============================================================================
// ObjectRenderAdapter.js —— 通用物体渲染适配器
//                          （Object Render Adapter：换模型精度，但不动身份）
//
// 【这个文件干什么】
// 收到“这个物体该降到 2 档了”的通知，把它的显示内容换成对应精度的版本。
// 车、岸桥、船都用它——三种物体的差异只体现在构造时传的参数上。
//
// 【最核心的设计：wrapper（外壳）与 detail（细节模型）分离】
// wrapper（外壳，一个 Group）承载位置、身份和 ECS 引用；detail（高精模型）、
// lowDetail（简模）与 proxy（代理色块）只在外壳内部切换。
// LOD0 显示高精模型，LOD1 显示简模，LOD2 显示代理，LOD3 不显示。
// 降档会关闭阴影；升档及销毁时恢复 detail 和每个 Mesh 原先各自的阴影值。
// 简模与代理的几何体、材质由 GpuResourcePool 按引用计数共享。
//
// 基类不创建/销毁 ECS Entity，不 retain/release AssetManager 模型引用，也不拥有
// wrapper/detail。它只拥有自身 states 中的替代 Mesh 和对应的 pool lease。
// ============================================================================

import * as THREE from "three";
import { ProxyFactory } from "../../../rendering/ProxyFactory.ts";
import { GpuResourcePool } from "../../../rendering/GpuResourcePool.ts";
import { LowDetailFactory } from "../../../rendering/LowDetailFactory.ts";

export interface ObjectRenderDescriptor {
  id: string;
  wrapper: THREE.Object3D;
  detail: THREE.Object3D;
  resourceId?: string | null;
  proxyColor?: THREE.ColorRepresentation | null;
}

export interface SharedObjectRenderResource {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  position: THREE.Vector3;
}

export interface ObjectRenderState<TItem> extends ObjectRenderDescriptor {
  resourceId: string;
  item: TItem;
  originalVisible: boolean;
  shadowStates: Array<{ object: THREE.Mesh; castShadow: boolean; receiveShadow: boolean }>;
  lowDetail: THREE.Mesh | null;
  proxy: THREE.Mesh | null;
  requestedLevel: number;
  effectiveLevel: number | null;
  chunkId: string | null;
}

export interface ObjectRenderAdapterOptions<TItem = unknown> {
  renderType: string;
  proxyColor?: THREE.ColorRepresentation;
  describe?: (item: TItem) => Partial<ObjectRenderDescriptor> | null | undefined;
  isPinned?: (item: TItem) => boolean;
  resourcePool?: GpuResourcePool | null;
  lowDetailRatio?: number;
}

/** Switches only the render slot inside a stable wrapper. */
export class ObjectRenderAdapter<TItem = unknown> {
  readonly renderType: string;
  readonly proxyColor: THREE.ColorRepresentation | undefined;
  readonly describe: (item: TItem) => Partial<ObjectRenderDescriptor> | null | undefined;
  readonly isPinned: (item: TItem) => boolean;
  resourcePool: GpuResourcePool;
  ownsResourcePool: boolean;
  readonly lowDetailRatio: number;
  readonly states = new Map<string, ObjectRenderState<TItem>>();
  switchCount = 0;

  constructor({ renderType, proxyColor, describe = defaultDescribe, isPinned = () => false, resourcePool = null, lowDetailRatio = 0.18 }: ObjectRenderAdapterOptions<TItem>) {
    this.renderType = renderType;
    this.proxyColor = proxyColor;
    this.describe = describe;
    this.isPinned = isPinned;
    this.resourcePool = resourcePool ?? new GpuResourcePool();
    this.ownsResourcePool = !resourcePool;
    this.lowDetailRatio = lowDetailRatio;
  }

  applyChunkLOD({ items, level, chunkId }: { items: readonly TItem[]; level: number; chunkId: string }): void {
    items.forEach((item) => {
      const state = this._getState(item);
      state.requestedLevel = level;
      state.chunkId = chunkId;
      this._applyState(state);
    });
  }

  update(): void {
    this.states.forEach((state) => this._applyState(state));
  }

  detach(item: TItem): boolean {
    const id = this.describe(item)?.id;
    const state = id ? this.states.get(id) : undefined;
    if (!state) return false;
    state.requestedLevel = 3;
    this._applyState(state);
    return true;
  }

  getMetrics(): { tracked: number; levels: Record<string, number>; switches: number; lowDetails: number; proxies: number } {
    const levels: Record<string, number> = {};
    this.states.forEach((state) => {
      const key = String(state.effectiveLevel);
      levels[key] = (levels[key] ?? 0) + 1;
    });
    return {
      tracked: this.states.size,
      levels,
      switches: this.switchCount,
      lowDetails: [...this.states.values()].filter((state) => state.lowDetail !== null).length,
      proxies: [...this.states.values()].filter((state) => state.proxy !== null).length,
    };
  }

  dispose(): void {
    this.states.forEach((state) => {
      state.detail.visible = state.originalVisible;
      restoreShadows(state);
      this._deactivateResource(state, "lowDetail");
      this._deactivateResource(state, "proxy");
    });
    this.states.clear();
    if (this.ownsResourcePool) this.resourcePool.dispose();
  }

  protected _getState(item: TItem): ObjectRenderState<TItem> {
    const descriptor = this.describe(item);
    if (!descriptor?.id || !descriptor.wrapper?.isObject3D || !descriptor.detail?.isObject3D) {
      throw new TypeError(`${this.renderType} render item requires id, wrapper and detail.`);
    }
    const existing = this.states.get(descriptor.id);
    if (existing) {
      existing.item = item;
      return existing;
    }

    const shadowStates: ObjectRenderState<TItem>["shadowStates"] = [];
    descriptor.detail.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        shadowStates.push({ object: mesh, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow });
      }
    });
    const state: ObjectRenderState<TItem> = {
      id: descriptor.id,
      wrapper: descriptor.wrapper,
      detail: descriptor.detail,
      proxyColor: descriptor.proxyColor,
      item,
      originalVisible: descriptor.detail.visible,
      shadowStates,
      resourceId: descriptor.resourceId ?? descriptor.detail.userData?.assetMetadata?.id ?? descriptor.id,
      lowDetail: null,
      proxy: null,
      requestedLevel: 3,
      effectiveLevel: null,
      chunkId: null,
    };
    this.states.set(descriptor.id, state);
    return state;
  }

  protected _applyState(state: ObjectRenderState<TItem>): void {
    const effectiveLevel = this.isPinned(state.item) ? 0 : state.requestedLevel;
    if (state.effectiveLevel === effectiveLevel) return;
    const previousLevel = state.effectiveLevel;
    try {
      if (effectiveLevel <= 1) {
        this._deactivateResource(state, "proxy");
        if (effectiveLevel === 0) {
          this._deactivateResource(state, "lowDetail");
          state.detail.visible = state.originalVisible;
          restoreShadows(state);
        } else {
          state.detail.visible = false;
          disableShadows(state);
          this._activateLowDetail(state);
        }
      } else if (effectiveLevel === 2) {
        this._deactivateResource(state, "lowDetail");
        state.detail.visible = false;
        this._activateProxy(state);
      } else {
        this._deactivateResource(state, "lowDetail");
        this._deactivateResource(state, "proxy");
        state.detail.visible = false;
      }
      state.effectiveLevel = effectiveLevel;
      this.switchCount += 1;
    } catch (error) {
      this._deactivateResource(state, "lowDetail");
      this._deactivateResource(state, "proxy");
      state.effectiveLevel = null;
      if (previousLevel === null || previousLevel === 0) {
        state.detail.visible = state.originalVisible;
        restoreShadows(state);
      }
      throw error;
    }
  }

  private _activateLowDetail(state: ObjectRenderState<TItem>): void {
    if (state.lowDetail) return;
    const key = `${this.renderType}:${state.resourceId}:low-detail`;
    const resource = this.resourcePool.acquire<SharedObjectRenderResource>(key, {
      create: () => {
        const template = LowDetailFactory.createObject({ source: state.detail, parent: state.wrapper, color: state.proxyColor ?? this.proxyColor, ratio: this.lowDetailRatio });
        return { geometry: template.geometry, material: template.material, position: template.position.clone() };
      },
    });
    try {
      state.lowDetail = new THREE.Mesh(resource.geometry, resource.material);
      state.lowDetail.name = `${state.id}-low-detail`;
      state.lowDetail.castShadow = false;
      state.lowDetail.receiveShadow = false;
      state.lowDetail.userData.lowDetail = true;
      state.lowDetail.userData.resourceKey = key;
      state.lowDetail.position.copy(resource.position);
      state.lowDetail.visible = state.originalVisible;
      state.wrapper.add(state.lowDetail);
    } catch (error) {
      if (state.lowDetail) this._deactivateResource(state, "lowDetail");
      else this.resourcePool.release(key);
      throw error;
    }
  }

  private _activateProxy(state: ObjectRenderState<TItem>): void {
    if (state.proxy) return;
    const key = `${this.renderType}:${state.resourceId}:proxy`;
    const resource = this.resourcePool.acquire<SharedObjectRenderResource>(key, {
      create: () => {
        const template = ProxyFactory.createObjectProxy({ source: state.detail, parent: state.wrapper, color: state.proxyColor ?? this.proxyColor, attach: false });
        return { geometry: template.geometry, material: template.material, position: template.position.clone() };
      },
    });
    try {
      state.proxy = new THREE.Mesh(resource.geometry, resource.material);
      state.proxy.name = `${state.id}-lod-proxy`;
      state.proxy.castShadow = false;
      state.proxy.receiveShadow = false;
      state.proxy.userData.lodProxy = true;
      state.proxy.userData.resourceKey = key;
      state.proxy.position.copy(resource.position);
      state.proxy.visible = state.originalVisible;
      state.wrapper.add(state.proxy);
    } catch (error) {
      if (state.proxy) this._deactivateResource(state, "proxy");
      else this.resourcePool.release(key);
      throw error;
    }
  }

  private _deactivateResource(state: ObjectRenderState<TItem>, property: "lowDetail" | "proxy"): void {
    const object = state[property];
    if (!object) return;
    object.visible = false;
    object.removeFromParent();
    const key = object.userData.resourceKey;
    if (typeof key === "string" && key) this.resourcePool.release(key);
    state[property] = null;
  }
}

function defaultDescribe(item: unknown): Partial<ObjectRenderDescriptor> | null {
  if (!item || typeof item !== "object") return null;
  const value = item as { id?: unknown; wrapper?: unknown; renderObject?: unknown };
  const detail = value.renderObject as THREE.Object3D | undefined;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    wrapper: value.wrapper as THREE.Object3D | undefined,
    detail,
    resourceId: detail?.userData?.assetMetadata?.id,
  };
}

function disableShadows<TItem>(state: ObjectRenderState<TItem>): void {
  state.shadowStates.forEach(({ object }) => { object.castShadow = false; object.receiveShadow = false; });
}

function restoreShadows<TItem>(state: ObjectRenderState<TItem>): void {
  state.shadowStates.forEach(({ object, castShadow, receiveShadow }) => {
    object.castShadow = castShadow;
    object.receiveShadow = receiveShadow;
  });
}
