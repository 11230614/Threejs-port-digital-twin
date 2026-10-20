import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { GpuResourcePool } = await vite.ssrLoadModule("/src/rendering/GpuResourcePool.ts");
  let now = 0;
  let created = 0;
  let disposed = 0;
  const pool = new GpuResourcePool({ idleDisposeMs: 100, now: () => now });
  const first = pool.acquire("proxy", { create: () => ({ geometry: { dispose: () => { disposed += 1; } } }), estimate: () => 128 });
  const second = pool.acquire("proxy", { create: () => { created += 1; return {}; }, estimate: () => 999 });
  assert.equal(first, second, "same key shares the first resource");
  assert.deepEqual(pool.getMetrics(), { definitions: 1, residentResources: 1, activeResources: 1, idleResources: 0, activeLeases: 2, estimatedBytes: 128, created: 1, disposed: 0, idleDisposeMs: 100 });
  assert.equal(pool.release("proxy"), true);
  assert.equal(pool.sweep(), 0, "resource with one remaining lease is retained");
  assert.equal(pool.release("proxy"), true);
  now = 99;
  assert.equal(pool.sweep(), 0);
  now = 100;
  assert.equal(pool.sweep(), 1);
  assert.equal(disposed, 1);
  assert.equal(created, 0, "later create callback is not used for an existing definition");
  const rebuilt = pool.acquire("proxy", { create: () => ({}) });
  assert.notEqual(rebuilt, first, "swept resource is recreated");
  assert.equal(pool.release("proxy"), true);
  assert.equal(pool.sweep({ force: true }), 1);
  assert.deepEqual(pool.getMetrics(), { definitions: 1, residentResources: 0, activeResources: 0, idleResources: 0, activeLeases: 0, estimatedBytes: 0, created: 2, disposed: 2, idleDisposeMs: 100 });
  pool.dispose();
  pool.dispose();
  assert.equal(pool.release("missing"), false);
  const afterDispose = pool.acquire("after-dispose", { create: () => ({}) });
  assert.ok(afterDispose, "acquire remains usable by creating a new definition after dispose");
  assert.equal(pool.release("after-dispose"), true);
  console.log("GpuResourcePool behavior checks passed (sharing, leases, grace-period sweep, recreation, force disposal).");
} finally {
  await vite.close();
}
