import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { InstanceBatch } = await vite.ssrLoadModule("/src/rendering/InstanceBatch.ts");
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const batch = new InstanceBatch({ name: "smoke-batch", scene, geometry, material, capacity: 2, useColors: true });
  const first = { id: "first" };
  const second = { id: "second" };
  const matrix = new THREE.Matrix4();
  const red = new THREE.Color(0xff0000);
  const blue = new THREE.Color(0x0000ff);
  const firstBinding = batch.add(first, matrix, red, { lod: 1 });
  const secondBinding = batch.add(second, matrix, blue, { lod: 1 });
  assert.equal(scene.children.includes(batch.mesh), true);
  assert.equal(batch.count, 2);
  assert.equal(firstBinding.index, 0);
  assert.equal(secondBinding.index, 1);
  assert.equal(first.renderBinding.lod, 1);
  assert.throws(() => batch.add({ id: "overflow" }, matrix), RangeError);

  assert.equal(batch.remove(first), true);
  assert.equal(batch.count, 1);
  assert.equal(second.renderBinding.index, 0, "last record is compacted into the removed slot");
  assert.equal(batch.remove(first), false);
  assert.equal(batch.remove(second), true);
  assert.equal(batch.count, 0);

  batch.dispose();
  assert.equal(scene.children.includes(batch.mesh), false);
  assert.equal(batch.records.length, 0);
  assert.equal(batch.count, 0);
  assert.throws(() => new InstanceBatch({ name: "bad", scene, geometry: new THREE.BoxGeometry(), material: new THREE.MeshBasicMaterial(), capacity: 0 }), RangeError);
  console.log("InstanceBatch behavior checks passed (instancing, colors, compaction, capacity, disposal).");
} finally {
  await vite.close();
}
