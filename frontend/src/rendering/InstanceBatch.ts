import * as THREE from "three";

/**
 * Generic InstancedMesh storage used by render adapters.
 * It owns the mesh and its cloned geometry/material resources.
 */
export interface InstanceRenderBinding {
  batch: InstanceBatch;
  index: number;
  [key: string]: unknown;
}

export interface InstanceRecord {
  renderBinding?: InstanceRenderBinding | null;
  [key: string]: unknown;
}

export interface InstanceBatchOptions {
  name: string;
  scene: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  capacity: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  useColors?: boolean;
  disposeGeometry?: boolean;
  disposeMaterial?: boolean;
}

export interface InstanceAddMetadata {
  [key: string]: unknown;
}

export class InstanceBatch {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  readonly capacity: number;
  readonly mesh: THREE.InstancedMesh;
  readonly useColors: boolean;
  readonly disposeGeometry: boolean;
  readonly disposeMaterial: boolean;
  readonly records: Array<InstanceRecord | undefined> = [];
  readonly matrix = new THREE.Matrix4();
  readonly color = new THREE.Color();
  count = 0;

  constructor({ name, scene, geometry, material, capacity, castShadow = false, receiveShadow = false, useColors = false, disposeGeometry = true, disposeMaterial = true }: InstanceBatchOptions) {
    if (!scene || !geometry || !material) throw new Error("InstanceBatch requires scene, geometry, and material.");
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("InstanceBatch capacity must be a positive integer.");
    this.geometry = geometry;
    this.material = material;
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.useColors = useColors;
    this.disposeGeometry = disposeGeometry;
    this.disposeMaterial = disposeMaterial;
    scene.add(this.mesh);
  }

  add(record: InstanceRecord, matrix: THREE.Matrix4, color?: THREE.Color | null, metadata: InstanceAddMetadata = {}): InstanceRenderBinding {
    if (this.count >= this.capacity) throw new RangeError(`InstanceBatch "${this.mesh.name}" capacity exceeded.`);
    const index = this.count;
    this.mesh.setMatrixAt(index, matrix);
    if (this.useColors && color) this.mesh.setColorAt(index, color);
    this.records[index] = record;
    this.count += 1;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.useColors && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const binding: InstanceRenderBinding = { batch: this, index, ...metadata };
    record.renderBinding = binding;
    return binding;
  }

  remove(record: InstanceRecord): boolean {
    const binding = record.renderBinding;
    if (!binding || binding.batch !== this) return false;
    const index = binding.index;
    const lastIndex = this.count - 1;
    const lastRecord = this.records[lastIndex];
    if (index !== lastIndex && lastRecord) {
      this.mesh.getMatrixAt(lastIndex, this.matrix);
      this.mesh.setMatrixAt(index, this.matrix);
      if (this.useColors && this.mesh.instanceColor) {
        this.mesh.getColorAt(lastIndex, this.color);
        this.mesh.setColorAt(index, this.color);
      }
      this.records[index] = lastRecord;
      if (lastRecord.renderBinding) lastRecord.renderBinding.index = index;
    }
    this.records.pop();
    this.count -= 1;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.useColors && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    record.renderBinding = null;
    return true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    if (this.disposeGeometry) this.geometry.dispose();
    if (this.disposeMaterial) {
      if (Array.isArray(this.material)) this.material.forEach((material) => material.dispose());
      else this.material.dispose();
    }
    this.records.length = 0;
    this.count = 0;
  }
}
