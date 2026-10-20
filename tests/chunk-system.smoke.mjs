import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { ChunkSystem } = await vite.ssrLoadModule("/src/systems/chunk/ChunkSystem.ts");
  const system = new ChunkSystem({ chunkSize: 10, loadDistance: 12, unloadDistance: 15 });
  const events = [];
  const unsubscribe = system.subscribe((event) => events.push(event));
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
  const unregister = system.register({ id: "static", bounds: box, renderType: "container", data: { source: "test" } });
  const camera = new THREE.Vector3(0, 0, 0);
  const first = system.update(camera, 100);
  assert.equal(first.activeChunks.length, 1);
  assert.equal(events[0].type, "enter");
  assert.equal(system.getChunk("0:0").revision, 1);
  assert.equal(system.getMetrics().visibleActiveChunks, 1);
  system.update(new THREE.Vector3(30, 0, 0), 200);
  assert.equal(events.at(-1).type, "exit");
  assert.equal(system.getSnapshot().activeChunks.length, 0);

  let dynamic = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
  system.register({ id: "dynamic", getBounds: () => dynamic, dynamic: true });
  system.update(camera, 300);
  const beforeMoves = system.getMetrics().dynamicMoves;
  dynamic = new THREE.Box3(new THREE.Vector3(20, 0, 0), new THREE.Vector3(21, 1, 1));
  system.update(camera, 400);
  assert.equal(system.getMetrics().dynamicMoves, beforeMoves + 1);
  assert.equal(system.getChunkKeyAt(new THREE.Vector3(-0.1, 0, 0)), "-1:0");
  unregister();
  assert.equal(system.unregister("static"), false);
  unsubscribe();
  system.clear();
  assert.equal(system.getMetrics().totalChunks, 0);
  assert.throws(() => new ChunkSystem({ chunkSize: 0 }), RangeError);
  assert.throws(() => system.update({}), TypeError);
  console.log("ChunkSystem behavior checks passed (partitioning, hysteresis, events, dynamic movement, cleanup).");
} finally {
  await vite.close();
}
