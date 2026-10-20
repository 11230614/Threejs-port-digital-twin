/** Builds one-draw-call low-poly geometry from an existing GLB hierarchy. */
import * as THREE from "three";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface LowDetailOptions {
  source: THREE.Object3D;
  parent: THREE.Object3D;
  name?: string;
  color?: THREE.ColorRepresentation | null;
  ratio?: number;
  maxInputVertices?: number;
  maxSimplifyVertices?: number;
  maxBoxParts?: number;
}

export class LowDetailFactory {
  static createObject({
    source,
    parent,
    name = "low-detail",
    color = null,
    ratio = 0.18,
    maxInputVertices = 12_000,
    maxSimplifyVertices = 2_000,
    maxBoxParts = 24,
  }: LowDetailOptions): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    if (!source?.isObject3D || !parent?.isObject3D) {
      throw new TypeError("LowDetailFactory requires source and parent Object3D nodes.");
    }
    const geometry = createSimplifiedGeometry({
      source,
      parent,
      ratio,
      maxInputVertices,
      maxSimplifyVertices,
    }) ?? createBoxSilhouette({ source, parent, maxBoxParts });
    const material = new THREE.MeshStandardMaterial({
      color: color ?? findSourceColor(source),
      roughness: 0.84,
      metalness: 0.04,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.lowDetail = true;
    mesh.visible = false;
    return mesh;
  }
}

interface SimplifiedGeometryOptions {
  source: THREE.Object3D;
  parent: THREE.Object3D;
  ratio: number;
  maxInputVertices: number;
  maxSimplifyVertices: number;
}

function createSimplifiedGeometry({
  source,
  parent,
  ratio,
  maxInputVertices,
  maxSimplifyVertices,
}: SimplifiedGeometryOptions): THREE.BufferGeometry | null {
  try {
    parent.updateMatrixWorld(true);
    source.updateMatrixWorld(true);
    const parentInverse = parent.matrixWorld.clone().invert();
    const candidates: Array<{ child: THREE.Mesh; count: number }> = [];
    source.traverse((child) => {
      if (!isMesh(child) || isSkinnedMesh(child)) return;
      const count = child.geometry.attributes.position?.count ?? 0;
      if (count < 12) return;
      candidates.push({ child, count });
    });
    candidates.sort((left, right) => right.count - left.count);

    const selected: THREE.Mesh[] = [];
    let totalVertices = 0;
    candidates.forEach((candidate) => {
      if (totalVertices + candidate.count > maxInputVertices) return;
      selected.push(candidate.child);
      totalVertices += candidate.count;
    });
    if (!selected.length) return null;

    const geometries = selected.map((child) => {
      let geometry = child.geometry.clone();
      Object.keys(geometry.attributes).forEach((attributeName) => {
        if (attributeName !== "position") geometry.deleteAttribute(attributeName);
      });
      geometry.morphAttributes = {};
      geometry.applyMatrix4(parentInverse.clone().multiply(child.matrixWorld));
      if (geometry.index) geometry = geometry.toNonIndexed();
      return geometry;
    });
    let merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) return null;

    const welded = mergeVertices(merged, 1e-4);
    merged.dispose();
    merged = welded;
    const vertexCount = merged.attributes.position?.count ?? 0;
    if (vertexCount > maxSimplifyVertices) {
      merged.dispose();
      return null;
    }
    const targetCount = Math.max(24, Math.floor(vertexCount * ratio));
    const removeCount = Math.max(0, vertexCount - targetCount);
    if (removeCount > 0) {
      const simplified = new SimplifyModifier().modify(merged, removeCount);
      // The installed runtime modifier is synchronous; the declaration shipped
      // by @types/three also permits an asynchronous implementation, so retain
      // the safe fallback if a future version returns a Promise.
      if (simplified instanceof Promise) {
        merged.dispose();
        return null;
      }
      merged.dispose();
      merged = simplified;
    }
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  } catch {
    return null;
  }
}

function createBoxSilhouette({
  source,
  parent,
  maxBoxParts,
}: { source: THREE.Object3D; parent: THREE.Object3D; maxBoxParts: number }): THREE.BufferGeometry {
  parent.updateMatrixWorld(true);
  source.updateMatrixWorld(true);
  const parentInverse = parent.matrixWorld.clone().invert();
  const parts: Array<{ bounds: THREE.Box3; score: number }> = [];
  source.traverse((child) => {
    if (!isMesh(child) || !child.geometry.attributes.position) return;
    const bounds = new THREE.Box3().setFromObject(child);
    if (bounds.isEmpty()) return;
    const localBounds = transformBounds(bounds, parentInverse);
    const size = localBounds.getSize(new THREE.Vector3());
    parts.push({
      bounds: localBounds,
      score: Math.max(size.x * size.y * size.z, size.x * size.y, size.x * size.z, size.y * size.z),
    });
  });
  parts.sort((left, right) => right.score - left.score);
  const geometries = parts.slice(0, maxBoxParts).map(({ bounds }) => {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const geometry = new THREE.BoxGeometry(
      Math.max(size.x, 0.05),
      Math.max(size.y, 0.05),
      Math.max(size.z, 0.05),
    );
    geometry.translate(center.x, center.y, center.z);
    return geometry;
  });
  const merged = (geometries.length ? mergeGeometries(geometries, false) : null)
    ?? new THREE.BoxGeometry(1, 1, 1);
  geometries.forEach((geometry) => geometry.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function findSourceColor(source: THREE.Object3D): THREE.ColorRepresentation {
  let color: number | null = null;
  source.traverse((child) => {
    if (color !== null || !isMesh(child)) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (material && "color" in material && material.color instanceof THREE.Color) {
      color = material.color.getHex();
    }
  });
  return color ?? 0x7b8792;
}

function transformBounds(bounds: THREE.Box3, matrix: THREE.Matrix4): THREE.Box3 {
  const result = new THREE.Box3().makeEmpty();
  for (let x = 0; x <= 1; x += 1) {
    for (let y = 0; y <= 1; y += 1) {
      for (let z = 0; z <= 1; z += 1) {
        result.expandByPoint(new THREE.Vector3(
          x ? bounds.max.x : bounds.min.x,
          y ? bounds.max.y : bounds.min.y,
          z ? bounds.max.z : bounds.min.z,
        ).applyMatrix4(matrix));
      }
    }
  }
  return result;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object.isMesh === true;
}

function isSkinnedMesh(object: THREE.Mesh): object is THREE.SkinnedMesh {
  return "isSkinnedMesh" in object && object.isSkinnedMesh === true;
}
