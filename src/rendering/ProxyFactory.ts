/** Creates lightweight render-only stand-ins without changing business transforms. */
import * as THREE from "three";

const CORNERS: ReadonlyArray<readonly [number, number, number]> = Object.freeze([
  [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1],
  [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1],
]);

export interface ObjectProxyOptions {
  source: THREE.Object3D;
  parent: THREE.Object3D;
  color?: THREE.ColorRepresentation;
  name?: string;
  attach?: boolean;
}

export interface AreaProxyOptions {
  scene: THREE.Object3D;
  bounds: THREE.Box3;
  color?: THREE.ColorRepresentation;
  name?: string;
  attach?: boolean;
}

export class ProxyFactory {
  static createObjectProxy({
    source,
    parent,
    color = 0x73869a,
    name = "lod-proxy",
    attach = true,
  }: ObjectProxyOptions): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
    if (!source?.isObject3D || !parent?.isObject3D) {
      throw new TypeError("Object proxy requires source and parent Object3D nodes.");
    }

    parent.updateMatrixWorld(true);
    source.updateMatrixWorld(true);
    const worldBounds = new THREE.Box3().setFromObject(source);
    const localBounds = transformBounds(worldBounds, parent.matrixWorld.clone().invert());
    const size = localBounds.getSize(new THREE.Vector3());
    const center = localBounds.getCenter(new THREE.Vector3());
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(size.x, 0.1),
        Math.max(size.y, 0.1),
        Math.max(size.z, 0.1),
      ),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.82,
        metalness: 0.04,
      }),
    );
    proxy.name = name;
    proxy.position.copy(center);
    proxy.visible = false;
    proxy.castShadow = false;
    proxy.receiveShadow = false;
    proxy.userData.lodProxy = true;
    if (attach) parent.add(proxy);
    return proxy;
  }

  static createAreaProxy({
    scene,
    bounds,
    color = 0x9ca5a8,
    name = "area-lod-proxy",
    attach = true,
  }: AreaProxyOptions): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
    if (!scene?.isObject3D || !bounds?.isBox3 || bounds.isEmpty()) {
      throw new TypeError("Area proxy requires a scene and non-empty Box3.");
    }
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(size.x, 0.5),
        Math.max(Math.min(size.y, 0.12), 0.06),
        Math.max(size.z, 0.5),
      ),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    proxy.name = name;
    proxy.position.set(center.x, Math.max(bounds.max.y, 0.06), center.z);
    proxy.visible = false;
    proxy.receiveShadow = true;
    proxy.userData.lodProxy = true;
    if (attach) scene.add(proxy);
    return proxy;
  }
}

function transformBounds(bounds: THREE.Box3, matrix: THREE.Matrix4): THREE.Box3 {
  const transformed = new THREE.Box3().makeEmpty();
  CORNERS.forEach(([x, y, z]) => {
    transformed.expandByPoint(new THREE.Vector3(
      x ? bounds.max.x : bounds.min.x,
      y ? bounds.max.y : bounds.min.y,
      z ? bounds.max.z : bounds.min.z,
    ).applyMatrix4(matrix));
  });
  return transformed;
}
