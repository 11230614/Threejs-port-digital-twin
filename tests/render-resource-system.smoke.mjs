import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { RenderResourceSystem } = await vite.ssrLoadModule("/src/systems/render/RenderResourceSystem.ts");
  let now = 0;
  const system = new RenderResourceSystem({ idleDisposeMs: 50, now: () => now });
  let disposed = 0;
  const resource = system.pool.acquire("resource", { create: () => ({ geometry: { dispose: () => { disposed += 1; } } }), estimate: () => 64 });
  assert.ok(resource);
  system.update();
  assert.equal(system.getMetrics().sweeps, 1);
  assert.equal(system.pool.release("resource"), true);
  now = 50;
  system.update();
  assert.equal(system.getMetrics().disposedLastSweep, 1);
  assert.equal(disposed, 1);
  system.dispose();
  system.dispose();
  console.log("RenderResourceSystem behavior checks passed (pool delegation, sweep metrics, disposal idempotence).");
} finally {
  await vite.close();
}
