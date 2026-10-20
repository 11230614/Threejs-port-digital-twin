import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { AGVRenderAdapter } = await vite.ssrLoadModule("/src/systems/render/adapters/AGVRenderAdapter.ts");
  const resourcePool = { acquire() {}, release() {}, dispose() {} };
  const selected = { id: "agv-1" };
  const adapter = new AGVRenderAdapter({ resourcePool, selectionSystem: { getSelected: () => selected } });
  assert.equal(adapter.renderType, "agv");
  assert.equal(adapter.proxyColor, 0x2f8fd5);
  assert.equal(adapter.lowDetailRatio, 0.24);
  assert.equal(adapter.isPinned(selected), true);
  assert.equal(adapter.isPinned({ id: "agv-2" }), false);
  selected.id = "agv-2";
  assert.equal(adapter.isPinned({ id: "agv-2" }), true);
  const optional = new AGVRenderAdapter({ resourcePool });
  assert.equal(optional.isPinned({ id: "agv-1" }), false);
  assert.equal(optional.resourcePool, resourcePool);
  console.log("AGVRenderAdapter behavior checks passed (configuration, selection pinning, shared pool).");
} finally {
  await vite.close();
}
