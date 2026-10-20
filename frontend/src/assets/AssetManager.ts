import { AssetLoader, type AssetLoadOptions } from "./AssetLoader";
import { AssetNormalizer, type AssetNormalizeOptions, type NormalizedAsset } from "./AssetNormalizer";
import { useAssetStore } from "../stores/AssetStore";
import type { AssetMetadata } from "./ModelMetadata";
import type { SceneEntity } from "../stores/types";
import type { AssetState } from "../stores/types";
import type * as THREE from "three";
import type { ComponentValue } from "../ecs/Entity";

export type RuntimeAsset = AssetState;
export interface AssetManifestOptions extends Omit<AssetNormalizeOptions, "id"> { [key: string]: unknown }
/** Supports the existing flat manifest shape and an optional nested options object. */
export interface AssetManifestEntry extends AssetManifestOptions { id: string; url: string; options?: AssetManifestOptions }
export interface AssetRecord {
  id: string; url: string; status: "loading" | "ready" | "error"; refCount: number;
  fileSize: number; root: THREE.Group | null; metadata: AssetMetadata | null;
  statistics: AssetStatistics | null; unusedSince: number | null;
}
export interface AssetStatistics { geometryCount: number; materialCount: number; textureCount: number; geometryBytes: number }
export interface AssetManagerOptions { loader?: AssetLoader; normalizer?: AssetNormalizer; idleDisposeMs?: number; now?: () => number }

export class AssetManager {
  private readonly loader: AssetLoader;
  private readonly normalizer: AssetNormalizer;
  private readonly cache = new Map<string, AssetRecord>();
  private readonly pending = new Map<string, Promise<AssetRecord>>();
  private readonly runtimeAssets = new Map<string, RuntimeAsset>();
  private runtimeStore: ReturnType<typeof useAssetStore> | null = null;
  private readonly manifest = new Map<string, AssetManifestEntry>();
  private readonly idleDisposeMs: number;
  private readonly now: () => number;
  private networkLoads = 0; private cacheHits = 0; private pendingHits = 0; private disposedAssets = 0;

  constructor({ loader = new AssetLoader(), normalizer = new AssetNormalizer(), idleDisposeMs = 0, now = () => globalThis.performance?.now() ?? Date.now() }: AssetManagerOptions = {}) {
    this.loader = loader; this.normalizer = normalizer; this.idleDisposeMs = Math.max(0, idleDisposeMs); this.now = now;
  }
  registerManifest(entries: AssetManifestEntry | readonly AssetManifestEntry[]): void {
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      const { id, url, options, ...flatOptions } = entry;
      if (!id || !url) throw new TypeError("Asset manifest entries require id and url.");
      this.manifest.set(id, { id, url, options: { ...flatOptions, ...(options ?? {}) } });
    }
  }
  preload(id: string): Promise<AssetRecord> { const definition = this.manifest.get(id); if (!definition) throw new Error(`Asset manifest does not contain "${id}".`); return this.load(id, definition.url, definition.options); }
  async acquireAsync(id: string): Promise<THREE.Group> { if (!this.get(id)) await this.preload(id); return this.acquire(id); }
  async load(id: string, url: string, options: AssetManifestOptions = {}): Promise<AssetRecord> {
    const cached = this.cache.get(id); if (cached) { this.cacheHits += 1; return cached; }
    const pending = this.pending.get(id); if (pending) { this.pendingHits += 1; return pending; }
    this.networkLoads += 1;
    const record: AssetRecord = { id, url, status: "loading", refCount: 0, fileSize: 0, root: null, metadata: null, statistics: null, unusedSince: null };
    const request = this.loader.load(url, { onProgress: (event) => { if (event.lengthComputable && event.total > 0) record.fileSize = event.total; } })
      .then((gltf) => this.normalizer.normalize(gltf, { id, ...options }))
      .then((asset) => { record.status = "ready"; record.root = asset.root; record.metadata = asset.metadata; record.statistics = inspectAsset(asset.root); this.cache.set(id, record); return record; })
      .catch((error) => { record.status = "error"; throw error; }).finally(() => this.pending.delete(id));
    this.pending.set(id, request); return request;
  }
  get(id: string): AssetRecord | null { return this.cache.get(id) ?? null; }
  clone(id: string): THREE.Group { return this.acquire(id); }
  acquire(id: string): THREE.Group { const asset = this.get(id); if (!asset) throw new Error(`Standard asset "${id}" has not been loaded.`); if (asset.status !== "ready" || !asset.root) throw new Error(`Asset "${id}" is not ready.`); asset.refCount += 1; asset.unusedSince = null; return asset.root.clone(true); }
  retain(id: string): boolean { const asset = this.get(id); if (!asset || asset.status !== "ready") return false; asset.refCount += 1; asset.unusedSince = null; return true; }
  getMetadata(id: string): AssetMetadata | null { return this.get(id)?.metadata ?? null; }
  release(id: string): boolean { const asset = this.cache.get(id); if (!asset) return false; asset.refCount = Math.max(0, asset.refCount - 1); if (asset.refCount > 0) return false; if (this.idleDisposeMs > 0) { asset.unusedSince = this.now(); return false; } this.dispose(id); return true; }
  sweep(): number { if (this.idleDisposeMs <= 0) return 0; const now = this.now(); let disposed = 0; this.cache.forEach((asset, id) => { if (asset.refCount > 0 || asset.unusedSince === null || now - asset.unusedSince < this.idleDisposeMs) return; if (this.dispose(id)) disposed += 1; }); return disposed; }
  dispose(id: string, { force = false }: { force?: boolean } = {}): boolean { const asset = this.cache.get(id); if (!asset || (!force && asset.refCount > 0) || !asset.root) return false; disposeAssetRoot(asset.root); this.cache.delete(id); this.disposedAssets += 1; return true; }
  clear({ force = true }: { force?: boolean } = {}): void { [...this.cache.keys()].forEach((id) => this.dispose(id, { force })); }
  getSnapshot() { return [...this.cache.values()].map(({ id, url, status, refCount, fileSize, unusedSince, statistics }) => ({ id, url, status, refCount, fileSize, unusedSince, ...statistics })); }
  getMetrics() { const assets = [...this.cache.values()]; return { manifestAssets: this.manifest.size, residentAssets: assets.length, pendingAssets: this.pending.size, referencedAssets: assets.filter((asset) => asset.refCount > 0).length, totalReferences: assets.reduce((total, asset) => total + asset.refCount, 0), fileBytes: assets.reduce((total, asset) => total + asset.fileSize, 0), geometryBytes: assets.reduce((total, asset) => total + (asset.statistics?.geometryBytes ?? 0), 0), networkLoads: this.networkLoads, cacheHits: this.cacheHits, pendingHits: this.pendingHits, disposedAssets: this.disposedAssets, idleDisposeMs: this.idleDisposeMs }; }
  add(asset: RuntimeAsset): RuntimeAsset { this.runtimeAssets.set(asset.id, asset); this._getRuntimeStore().registerAsset(asset); return asset; }
  attach(entity: SceneEntity & { addComponent?: (name: string, value: ComponentValue) => unknown; wrapper?: THREE.Object3D | null }, asset: RuntimeAsset): RuntimeAsset { const registeredAsset = this.runtimeAssets.get(asset.id) ?? this.add(asset); registeredAsset.entityId = entity.id; entity.addComponent?.("asset", { asset: registeredAsset }); if (entity.wrapper) entity.wrapper.userData.assetId = registeredAsset.id; this._getRuntimeStore().attachEntity(registeredAsset.id, entity); return registeredAsset; }
  getById(id: string): RuntimeAsset | null { return this.runtimeAssets.get(id) ?? null; }
  getAll(): RuntimeAsset[] { return Array.from(this.runtimeAssets.values()); }
  private _getRuntimeStore() { this.runtimeStore ??= useAssetStore(); return this.runtimeStore; }
}

function inspectAsset(root: THREE.Object3D): AssetStatistics { const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>(); let geometryBytes = 0; root.traverse((child) => { const mesh = child as THREE.Mesh; if (!mesh.isMesh) return; if (mesh.geometry && !geometries.has(mesh.geometry)) { geometries.add(mesh.geometry); geometryBytes += geometryByteSize(mesh.geometry); } const childMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; childMaterials.filter(Boolean).forEach((material) => { if (materials.has(material)) return; materials.add(material); Object.values(material).forEach((value) => { if (value && typeof value === "object" && "isTexture" in value && value.isTexture) textures.add(value as THREE.Texture); }); }); }); return Object.freeze({ geometryCount: geometries.size, materialCount: materials.size, textureCount: textures.size, geometryBytes }); }
function geometryByteSize(geometry: THREE.BufferGeometry): number { let bytes = 0; const index = geometry.index?.array as ArrayLike<number> & { byteLength?: number } | undefined; bytes += index?.byteLength ?? 0; Object.values(geometry.attributes).forEach((attribute) => { const array = attribute.array as ArrayLike<number> & { byteLength?: number }; bytes += array.byteLength ?? 0; }); return bytes; }
function disposeAssetRoot(root: THREE.Object3D): void { const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>(); root.traverse((child) => { const mesh = child as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry); const childMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; childMaterials.filter(Boolean).forEach((material) => { materials.add(material); Object.values(material).forEach((value) => { if (value && typeof value === "object" && "isTexture" in value && value.isTexture) textures.add(value as THREE.Texture); }); }); }); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); textures.forEach((texture) => texture.dispose()); }
