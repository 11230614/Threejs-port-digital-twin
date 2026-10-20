/**
 * @typedef {Object} AssetMetadata
 * @property {string} id
 * @property {{x: number, y: number, z: number}} originalSize
 * @property {{x: number, y: number, z: number}} normalizedSize
 * @property {{x: number, y: number, z: number}} center
 * @property {number} scale
 * @property {number} bottomOffset
 */

import type { Vector3 } from "three";

export interface AssetVectorData { x: number; y: number; z: number }
export interface AssetMetadata {
  id: string;
  originalSize: AssetVectorData;
  normalizedSize: AssetVectorData;
  center: AssetVectorData;
  scale: number;
  bottomOffset: number;
}

function vectorData(vector: Vector3): AssetVectorData {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function createAssetMetadata({ id, originalSize, normalizedSize, center, scale, bottomOffset }: {
  id: string;
  originalSize: Vector3;
  normalizedSize: Vector3;
  center: Vector3;
  scale: number;
  bottomOffset: number;
}): AssetMetadata {
  return Object.freeze({
    id,
    originalSize: Object.freeze(vectorData(originalSize)),
    normalizedSize: Object.freeze(vectorData(normalizedSize)),
    center: Object.freeze(vectorData(center)),
    scale,
    bottomOffset,
  });
}
