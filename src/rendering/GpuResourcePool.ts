// ============================================================================
// GpuResourcePool.js —— GPU 资源池（GPU Resource Pool：显存的引用计数管理者）
//
// 负责派生 GPU 资源的共享、引用计数、空闲宽限期释放和显存估算；原始 GLB
// 资源仍由 AssetManager 所有。本文件保留原有 acquire/release/sweep/dispose
// 生命周期与中文说明，作为 TypeScript 权威实现。
// ============================================================================

import type * as THREE from "three";

type Disposable = { dispose: () => void };
type TextureLike = Disposable & { isTexture?: boolean; image?: { width?: number; height?: number } };
type GeometryLike = (Disposable & { index?: { array?: { byteLength?: number } } | null; attributes?: Record<string, { array?: { byteLength?: number } }> }) | THREE.BufferGeometry;
type RenderObject = { geometry?: GeometryLike; material?: MaterialLike | MaterialLike[]; isObject3D?: boolean; traverse?: (visit: (object: RenderObject) => void) => void };
type MaterialLike = (Disposable & Record<string, unknown>) | THREE.Material;
export type GpuResource = RenderObject | { geometry?: GeometryLike; material?: MaterialLike | MaterialLike[] };
export type ResourceFactory<T extends GpuResource> = () => T;
export type ResourceDisposer<T extends GpuResource> = (resource: T) => void;
export type ResourceEstimator<T extends GpuResource> = (resource: T) => number | undefined;

interface ResourceEntry<T extends GpuResource> {
  key: string;
  create: ResourceFactory<T>;
  dispose: ResourceDisposer<T>;
  estimate: ResourceEstimator<T>;
  resource: T | null;
  refCount: number;
  idleSince: number | null;
  bytes: number;
}

export interface GpuResourcePoolOptions { idleDisposeMs?: number; now?: () => number }
export interface GpuResourcePoolMetrics { definitions: number; residentResources: number; activeResources: number; idleResources: number; activeLeases: number; estimatedBytes: number; created: number; disposed: number; idleDisposeMs: number }

export class GpuResourcePool {
  private readonly idleDisposeMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, ResourceEntry<GpuResource>>();
  private createdCount = 0;
  private disposedCount = 0;

  constructor({ idleDisposeMs = 15_000, now = defaultNow }: GpuResourcePoolOptions = {}) {
    this.idleDisposeMs = Math.max(0, idleDisposeMs);
    this.now = now;
  }

  acquire<T extends GpuResource>(key: string, { create, dispose = disposeGpuResource as ResourceDisposer<T>, estimate = estimateGpuBytes as ResourceEstimator<T> }: { create: ResourceFactory<T>; dispose?: ResourceDisposer<T>; estimate?: ResourceEstimator<T> }): T {
    if (typeof key !== "string" || !key) throw new TypeError("GPU resource key is required.");
    if (typeof create !== "function") throw new TypeError(`GPU resource "${key}" requires create().`);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, create: create as ResourceFactory<GpuResource>, dispose: dispose as ResourceDisposer<GpuResource>, estimate: estimate as ResourceEstimator<GpuResource>, resource: null, refCount: 0, idleSince: null, bytes: 0 };
      this.entries.set(key, entry);
    }
    if (!entry.resource) {
      entry.resource = entry.create();
      entry.bytes = Math.max(0, entry.estimate(entry.resource) ?? 0);
      this.createdCount += 1;
    }
    entry.refCount += 1;
    entry.idleSince = null;
    return entry.resource as T;
  }

  release(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.refCount <= 0) return false;
    entry.refCount -= 1;
    if (entry.refCount === 0) entry.idleSince = this.now();
    return true;
  }

  sweep({ force = false }: { force?: boolean } = {}): number {
    const now = this.now();
    let disposed = 0;
    this.entries.forEach((entry) => {
      if (!entry.resource || entry.refCount > 0 || entry.idleSince === null) return;
      if (!force && now - entry.idleSince < this.idleDisposeMs) return;
      entry.dispose(entry.resource);
      entry.resource = null;
      entry.bytes = 0;
      entry.idleSince = null;
      disposed += 1;
      this.disposedCount += 1;
    });
    return disposed;
  }

  getMetrics(): GpuResourcePoolMetrics {
    const entries = [...this.entries.values()];
    return {
      definitions: entries.length,
      residentResources: entries.filter((entry) => entry.resource !== null).length,
      activeResources: entries.filter((entry) => entry.refCount > 0).length,
      idleResources: entries.filter((entry) => entry.resource !== null && entry.refCount === 0).length,
      activeLeases: entries.reduce((total, entry) => total + entry.refCount, 0),
      estimatedBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      created: this.createdCount,
      disposed: this.disposedCount,
      idleDisposeMs: this.idleDisposeMs,
    };
  }

  dispose(): void {
    this.entries.forEach((entry) => { if (entry.resource) entry.dispose(entry.resource); });
    this.entries.clear();
  }
}

export function disposeGpuResource(resource: GpuResource): void {
  const geometries = new Set<GeometryLike>();
  const materials = new Set<MaterialLike>();
  const textures = new Set<TextureLike>();
  const visit = (object: RenderObject): void => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter((material): material is MaterialLike => Boolean(material)).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => { if (isTexture(value)) textures.add(value); });
    });
  };
  if (isRenderObject(resource) && resource.isObject3D && resource.traverse) resource.traverse(visit);
  else visit(resource as RenderObject);
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

export function estimateGpuBytes(resource: GpuResource): number {
  const geometries = new Set<GeometryLike>();
  const textures = new Set<TextureLike>();
  const visit = (object: RenderObject): void => {
    if (object.geometry) geometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter((material): material is MaterialLike => Boolean(material)).forEach((material) => Object.values(material).forEach((value) => { if (isTexture(value)) textures.add(value); }));
  };
  if (isRenderObject(resource) && resource.isObject3D && resource.traverse) resource.traverse(visit); else visit(resource as RenderObject);
  let bytes = 0;
  geometries.forEach((geometry) => { bytes += geometry.index?.array?.byteLength ?? 0; Object.values(geometry.attributes ?? {}).forEach((attribute) => { bytes += attribute.array?.byteLength ?? 0; }); });
  textures.forEach((texture) => { const image = texture.image; if (image?.width && image.height) bytes += image.width * image.height * 4; });
  return bytes;
}

function isTexture(value: unknown): value is TextureLike { return typeof value === "object" && value !== null && "isTexture" in value && Boolean(value.isTexture) && "dispose" in value; }
function isRenderObject(resource: GpuResource): resource is RenderObject { return "isObject3D" in resource || "traverse" in resource; }
function defaultNow(): number { return globalThis.performance?.now() ?? Date.now(); }
