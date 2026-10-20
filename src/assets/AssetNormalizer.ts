import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createAssetMetadata, type AssetMetadata } from "./ModelMetadata";

export interface AssetNormalizeOptions { id: string; targetSize?: number; excludeNodes?: readonly string[] }
export interface NormalizedAsset { id: string; root: THREE.Group; metadata: AssetMetadata }

export class AssetNormalizer {
  normalize(gltf: GLTF, { id, targetSize, excludeNodes = [] }: AssetNormalizeOptions): NormalizedAsset {
    const root = gltf.scene;
    if (!root) throw new Error(`Asset "${id}" does not contain gltf.scene.`);

    excludeNodes.forEach((nodeName) => root.getObjectByName(nodeName)?.removeFromParent());
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error(`Asset "${id}" has no renderable bounds.`);

    const originalSize = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize = Math.max(originalSize.x, originalSize.y, originalSize.z);
    const scale = Number.isFinite(targetSize) && targetSize! > 0 ? targetSize! / maxSize : 1;

    // Scale first so all following offsets are evaluated in project units.
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    box.setFromObject(root);

    // Center horizontally. The vertical axis is handled only by ground alignment.
    const scaledCenter = box.getCenter(new THREE.Vector3());
    root.position.x -= scaledCenter.x;
    root.position.z -= scaledCenter.z;
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    const bottomOffset = -box.min.y;
    root.position.y += bottomOffset;
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    const normalizedSize = box.getSize(new THREE.Vector3());
    this._enableShadows(root);

    // Keep all normalization offsets inside the model. Device instances move the
    // wrapper, so assigning device.position can never overwrite this correction.
    const assetRoot = new THREE.Group();
    assetRoot.name = `asset-${id}`;
    assetRoot.add(root);
    assetRoot.updateMatrixWorld(true);
    const metadata = createAssetMetadata({ id, originalSize, normalizedSize, center, scale, bottomOffset });
    assetRoot.userData.assetMetadata = metadata;
    return Object.freeze({ id, root: assetRoot, metadata });
  }

  private _enableShadows(root: THREE.Object3D): void {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }
}
