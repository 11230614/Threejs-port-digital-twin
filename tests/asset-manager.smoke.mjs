import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  const { AssetManager } = await vite.ssrLoadModule("/src/assets/AssetManager.ts");
  let loadCount = 0;
  let disposedGeometry = 0;
  let disposedMaterial = 0;
  const geometry = new THREE.BoxGeometry(2, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  geometry.dispose = () => { disposedGeometry += 1; };
  material.dispose = () => { disposedMaterial += 1; };
  const gltf = { scene: new THREE.Group() };
  gltf.scene.add(new THREE.Mesh(geometry, material));
  const loader = {
    async load(url) {
      loadCount += 1;
      assert.equal(url, "/models/container.glb");
      return gltf;
    },
  };
  const manager = new AssetManager({ loader });
  manager.registerManifest({ id: "container-test", url: "/models/container.glb", targetSize: 4 });

  const record = await manager.preload("container-test");
  assert.equal(record.status, "ready");
  assert.equal(manager.get("container-test"), record, "load registers a canonical cached record");
  assert.equal(loadCount, 1);
  assert.equal(record.metadata.id, "container-test");
  assert.equal(record.metadata.scale, 2, "manifest normalization options reach AssetNormalizer");
  assert.deepEqual(record.statistics, {
    geometryCount: 1,
    materialCount: 1,
    textureCount: 0,
    geometryBytes: Object.values(geometry.attributes).reduce((total, attribute) => total + attribute.array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0),
  });

  const clone = await manager.acquireAsync("container-test");
  assert.notEqual(clone, record.root, "acquireAsync returns a separate scene instance");
  assert.equal(record.refCount, 1);
  await manager.preload("container-test");
  assert.equal(manager.getMetrics().cacheHits, 1, "preload of a resident asset uses the cache");
  assert.equal(manager.release("container-test"), true, "final release disposes an unreferenced asset by default");
  assert.equal(manager.get("container-test"), null);
  assert.equal(disposedGeometry, 1);
  assert.equal(disposedMaterial, 1);
  assert.equal(manager.getMetrics().disposedAssets, 1);
  assert.throws(() => manager.preload("missing"), /does not contain/);

  console.log("AssetManager behavior checks passed (manifest preload, normalization, canonical cache, acquire/release and disposal).");
} finally {
  await vite.close();
}
