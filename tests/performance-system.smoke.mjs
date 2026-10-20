import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { PerformanceSystem } = await vite.ssrLoadModule("/src/rendering/PerformanceSystem.ts");
  let now = 0;
  const renderer = {
    info: {
      autoReset: true,
      render: { calls: 0, triangles: 0, lines: 0, points: 0 },
      memory: { geometries: 12, textures: 4 },
      reset() { this.render.calls = this.render.triangles = this.render.lines = this.render.points = 0; },
    },
    domElement: { width: 1600, height: 900 },
    getPixelRatio: () => 2,
  };
  const snapshots = [];
  const system = new PerformanceSystem({ renderer, publishInterval: 100, onSnapshot: (snapshot) => snapshots.push(snapshot) });
  system._now = () => now;
  system.windowStart = 0;
  const unregister = system.registerMetricProvider("yard", () => ({ loadedChunks: 3 }));
  assert.equal(renderer.info.autoReset, false, "system owns renderer counter reset while sampling");

  system.beginFrame();
  now = 4;
  system.beforeRender();
  renderer.info.render.calls = 6;
  renderer.info.render.triangles = 120;
  now = 20;
  system.afterRender();
  system.beginFrame();
  now = 24;
  system.beforeRender();
  renderer.info.render.calls = 2;
  renderer.info.render.triangles = 40;
  now = 48;
  system.afterRender();
  now = 100;
  system.update();

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].frameMs.average, 24);
  assert.equal(snapshots[0].frameMs.p95, 28);
  assert.equal(snapshots[0].frameMs.max, 28);
  assert.equal(snapshots[0].cpuMs.update, 4);
  assert.equal(snapshots[0].cpuMs.render, 20);
  assert.equal(snapshots[0].render.calls, 4);
  assert.equal(snapshots[0].render.triangles, 80);
  assert.deepEqual(snapshots[0].memory, { geometries: 12, textures: 4 });
  assert.deepEqual(snapshots[0].display, { width: 1600, height: 900, pixelRatio: 2 });
  assert.deepEqual(snapshots[0].metrics, { yard: { loadedChunks: 3 } });
  assert.equal(Object.isFrozen(snapshots[0]), true);

  assert.equal(unregister(), true);
  system.dispose();
  assert.equal(renderer.info.autoReset, true, "dispose restores the renderer setting it received");
  assert.equal(system.metricProviders.size, 0);
  assert.equal(system.onSnapshot, null);
  assert.equal(system.disposed, true);
  console.log("PerformanceSystem behavior checks passed (frame sampling, aggregates, metrics, and renderer ownership cleanup).");
} finally {
  await vite.close();
}
