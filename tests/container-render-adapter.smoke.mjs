import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { ContainerRenderAdapter } = await vite.ssrLoadModule("/src/systems/render/adapters/ContainerRenderAdapter.ts");
  const calls = [];
  const metrics = { loadedChunks: 2 };
  const manager = {
    applyChunkLOD(context) { calls.push(["lod", context]); },
    detach(item) { calls.push(["detach", item]); return item?.id === "c-1"; },
    getMetrics() { return metrics; },
    dispose() { calls.push(["dispose"]); },
  };
  const adapter = new ContainerRenderAdapter(manager);
  const context = { chunkId: "yard-a", items: [{ id: "c-1" }], level: 1, transition: "enter" };
  adapter.applyChunkLOD(context);
  assert.equal(calls[0][0], "lod");
  assert.equal(calls[0][1], context);
  assert.equal(adapter.detach({ id: "c-1" }), true);
  assert.equal(adapter.detach({ id: "unknown" }), false);
  assert.equal(adapter.getMetrics(), metrics);
  adapter.dispose();
  assert.equal(calls.at(-1)[0], "dispose");
  assert.throws(() => new ContainerRenderAdapter({}), /requires a render manager/);
  console.log("ContainerRenderAdapter behavior checks passed (delegation, validation, metrics, disposal).");
} finally {
  await vite.close();
}
