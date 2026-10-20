/** Per-chunk InstancedMesh streaming with shared, reference-counted GPU resources. */
import * as THREE from "three";
import { PORT_CONTAINER_LAYOUT_CONFIG } from "../config/PortSpatialConfig.ts";
import { GpuResourcePool, type GpuResource } from "./GpuResourcePool.ts";
import { InstanceBatch } from "./InstanceBatch.ts";
import type { YardBlockRecord, YardContainerRecord, ContainerLayout } from "../world/YardSystem";

const PALETTE: Readonly<Record<string, number>> = Object.freeze({
  "container-blue": 0x3a78c9,
  "container-red": 0xc94a4a,
  "container-green": 0x4aa05a,
  fallback: 0x7b8fa3,
});

export interface ContainerModelAssetManager {
  get(assetId: string): { root?: THREE.Object3D | null } | null;
  retain?(assetId: string): unknown;
  release?(assetId: string): unknown;
}

export interface ContainerRenderManagerOptions {
  scene: THREE.Scene;
  modelAssetManager: ContainerModelAssetManager;
  containerLayout?: ContainerLayout;
  resourcePool?: GpuResourcePool | null;
}

export interface ContainerChunkLODRequest {
  chunkId: string;
  items: readonly YardContainerRecord[];
  level: number;
}

interface ChunkBatchEntry {
  batch: InstanceBatch;
  batchKey: string;
  resourceKey: string;
  lod: number;
}

interface ChunkState {
  chunkId: string;
  level: number;
  signature: string;
  records: YardContainerRecord[];
  batches: ChunkBatchEntry[];
}

interface ContainerResource {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  useColors: boolean;
}

export class ContainerRenderManager {
  readonly scene: THREE.Scene;
  readonly modelAssetManager: ContainerModelAssetManager;
  readonly containerLayout: ContainerLayout;
  readonly resourcePool: GpuResourcePool;
  readonly ownsResourcePool: boolean;
  readonly records = new Map<string, YardContainerRecord>();
  readonly chunkStates = new Map<string, ChunkState>();
  readonly detailBatches = new Map<string, InstanceBatch>();
  readonly simpleBatches = new Map<string, InstanceBatch>();
  readonly matrix = new THREE.Matrix4();
  readonly color = new THREE.Color();
  totalBlocks = 0;
  initialized = false;
  chunkCreates = 0;
  chunkDisposals = 0;
  private retainedAssetIds: string[] = [];

  constructor({ scene, modelAssetManager, containerLayout = PORT_CONTAINER_LAYOUT_CONFIG, resourcePool = null }: ContainerRenderManagerOptions) {
    this.scene = scene;
    this.modelAssetManager = modelAssetManager;
    this.containerLayout = containerLayout;
    this.resourcePool = resourcePool ?? new GpuResourcePool();
    this.ownsResourcePool = !resourcePool;
  }

  initialize(blocks: readonly YardBlockRecord[]): void {
    if (this.initialized) throw new Error("ContainerRenderManager is already initialized.");
    const records = blocks.flatMap((block) => block.containers);
    records.forEach((record) => this.records.set(record.id, record));
    this.retainedAssetIds = [...new Set(records.map((record) => record.assetId))];
    this.retainedAssetIds.forEach((assetId) => this.modelAssetManager.retain?.(assetId));
    this.totalBlocks = blocks.length;
    this.initialized = true;
  }

  applyChunkLOD({ chunkId, items, level }: ContainerChunkLODRequest): void {
    const records = items.filter((record) => this.records.has(record.id) && record.owner === "YARD");
    let state = this.chunkStates.get(chunkId);
    if (!state) {
      state = { chunkId, level: 3, signature: "", records: [], batches: [] };
      this.chunkStates.set(chunkId, state);
    }
    const signature = records.map((record) => record.id).sort().join("|");
    if (state.level === level && state.signature === signature) return;

    this._disposeChunkBatches(state);
    state.level = level;
    state.signature = signature;
    state.records = records;
    if (level >= 3 || records.length === 0) return;

    try {
      if (level === 0) {
        groupBy(records, (record) => record.assetId).forEach((assetRecords, assetId) => {
          this._createChunkBatch(state, assetRecords, level, assetId);
        });
      } else {
        this._createChunkBatch(state, records, level, null);
      }
    } catch (error) {
      // A chunk update is atomic from callers' perspective: roll back batches
      // already created for other asset groups and allow a later retry.
      this._disposeChunkBatches(state);
      state.level = 3;
      state.signature = "";
      state.records = [];
      throw error;
    }
    this.chunkCreates += 1;
  }

  promote(record: YardContainerRecord): void { this.detach(record); }

  detach(record: YardContainerRecord): void {
    record.renderBinding?.batch.remove(record);
    record.renderBinding = null;
  }

  getMetrics() {
    const records = [...this.records.values()];
    const renderedRecords = records.filter((record) => record.renderBinding);
    const lodCounts: Record<0 | 1 | 2, number> = { 0: 0, 1: 0, 2: 0 };
    renderedRecords.forEach((record) => {
      const lod = record.renderBinding?.lod;
      if (lod === 0 || lod === 1 || lod === 2) lodCounts[lod] += 1;
    });
    const activeBatches = [...this.detailBatches.values(), ...this.simpleBatches.values()];
    return {
      totalContainers: records.length,
      staticContainers: records.filter((record) => record.owner === "YARD").length,
      loadedBlocks: new Set(renderedRecords.map((record) => record.blockId)).size,
      totalBlocks: this.totalBlocks,
      loadedChunks: [...this.chunkStates.values()].filter((state) => state.batches.length).length,
      visibleInstances: activeBatches.reduce((total, batch) => total + batch.count, 0),
      allocatedCapacity: activeBatches.reduce((total, batch) => total + batch.capacity, 0),
      drawBatches: activeBatches.length,
      chunkCreates: this.chunkCreates,
      chunkDisposals: this.chunkDisposals,
      lodCounts,
    };
  }

  dispose(): void {
    this.chunkStates.forEach((state) => this._disposeChunkBatches(state));
    this.chunkStates.clear();
    this.detailBatches.clear();
    this.simpleBatches.clear();
    this.records.clear();
    this.retainedAssetIds.forEach((assetId) => this.modelAssetManager.release?.(assetId));
    this.retainedAssetIds = [];
    this.totalBlocks = 0;
    this.initialized = false;
    if (this.ownsResourcePool) this.resourcePool.dispose();
  }

  private _createChunkBatch(state: ChunkState, records: YardContainerRecord[], lod: number, assetId: string | null): void {
    const resourceKey = lod === 0 ? `container:detail:${assetId}` : `container:simple:lod${lod}`;
    const resource = this.resourcePool.acquire<ContainerResource>(resourceKey, {
      create: () => {
        if (lod === 0) {
          if (!assetId) throw new TypeError("Detailed container batches require an asset id.");
          return this._createDetailedResource(assetId);
        }
        return this._createSimpleResource(lod);
      },
    });
    const batchKey = lod === 0 ? `${state.chunkId}:${assetId}` : `${state.chunkId}:lod${lod}`;
    let batch: InstanceBatch | null = null;
    try {
      batch = new InstanceBatch({
        name: `container-chunk-${batchKey}`,
        scene: this.scene,
        geometry: resource.geometry,
        material: resource.material,
        capacity: Math.max(records.length, 1),
        castShadow: lod === 0,
        receiveShadow: true,
        useColors: resource.useColors,
        disposeGeometry: false,
        disposeMaterial: false,
      });
      records.forEach((record) => batch!.add(
        record,
        this._composeMatrix(record),
        this._getColor(record.assetId),
        { lod, chunkId: state.chunkId },
      ));
      const entry = { batch, batchKey, resourceKey, lod };
      state.batches.push(entry);
      if (lod === 0) this.detailBatches.set(batchKey, batch);
      else this.simpleBatches.set(batchKey, batch);
    } catch (error) {
      if (batch) {
        batch.records.filter((record): record is YardContainerRecord => Boolean(record)).forEach((record) => {
          if (record.renderBinding?.batch === batch) record.renderBinding = null;
        });
        batch.dispose();
      }
      this.resourcePool.release(resourceKey);
      throw error;
    }
  }

  private _disposeChunkBatches(state: ChunkState): void {
    if (!state.batches.length) return;
    state.batches.forEach(({ batch, batchKey, resourceKey, lod }) => {
      batch.records.filter((record): record is YardContainerRecord => Boolean(record)).forEach((record) => {
        if (record.renderBinding?.batch === batch) record.renderBinding = null;
      });
      batch.dispose();
      this.resourcePool.release(resourceKey);
      if (lod === 0) this.detailBatches.delete(batchKey);
      else this.simpleBatches.delete(batchKey);
    });
    state.batches = [];
    this.chunkDisposals += 1;
  }

  private _composeMatrix(record: YardContainerRecord): THREE.Matrix4 {
    return this.matrix.compose(record.position, record.quaternion, record.scale);
  }

  private _getColor(assetId: string): THREE.Color {
    return this.color.setHex(PALETTE[assetId] ?? PALETTE.fallback);
  }

  private _createDetailedResource(assetId: string): ContainerResource {
    const asset = this.modelAssetManager.get(assetId);
    const source = getPrimaryMesh(asset?.root ?? null);
    if (!source) return this._createSimpleResource(0);
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    normalizeDetailedContainerGeometry(geometry, this.containerLayout.size);
    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    const material = sourceMaterial?.clone() ?? new THREE.MeshStandardMaterial({ color: PALETTE[assetId] ?? PALETTE.fallback });
    return { geometry, material, useColors: false };
  }

  private _createSimpleResource(lod: number): ContainerResource {
    const segments = lod === 1 ? 2 : 1;
    const geometry = new THREE.BoxGeometry(this.containerLayout.size.x, this.containerLayout.size.y, this.containerLayout.size.z, segments, 1, 1);
    geometry.translate(0, this.containerLayout.size.y / 2, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.08, vertexColors: true });
    return { geometry, material, useColors: true };
  }
}

function groupBy<T, K>(items: readonly T[], keySelector: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  items.forEach((item) => {
    const key = keySelector(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  });
  return groups;
}

function getPrimaryMesh(root: THREE.Object3D | null): THREE.Mesh | null {
  if (!root) return null;
  root.updateMatrixWorld(true);
  let primary: THREE.Mesh | null = null;
  let highestVertexCount = -1;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const count = mesh.geometry.attributes.position.count;
    if (count <= highestVertexCount) return;
    highestVertexCount = count;
    primary = mesh;
  });
  return primary;
}

function normalizeDetailedContainerGeometry(geometry: THREE.BufferGeometry, containerSize: ContainerLayout["size"]): void {
  geometry.computeBoundingBox();
  let size = geometry.boundingBox!.getSize(new THREE.Vector3());
  if (size.z > size.x) {
    geometry.rotateY(Math.PI / 2);
    geometry.computeBoundingBox();
    size = geometry.boundingBox!.getSize(new THREE.Vector3());
  }
  geometry.scale(
    containerSize.x / Math.max(size.x, 0.001),
    containerSize.y / Math.max(size.y, 0.001),
    containerSize.z / Math.max(size.z, 0.001),
  );
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -geometry.boundingBox!.min.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
