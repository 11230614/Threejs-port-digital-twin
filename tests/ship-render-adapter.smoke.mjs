import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
const { ShipRenderAdapter } = await vite.ssrLoadModule("/src/systems/render/adapters/ShipRenderAdapter.ts");
const sharedPool = { acquire() { throw new Error("not reached"); }, release() {}, dispose() {} };
const adapter = new ShipRenderAdapter({ resourcePool: sharedPool });
assert.equal(adapter.renderType, "ship");
assert.equal(adapter.proxyColor, 0x607b8a);
assert.equal(adapter.lowDetailRatio, 0.1);
assert.equal(adapter.resourcePool, sharedPool);
assert.equal(adapter.ownsResourcePool, false);

const wrapper = new THREE.Group();
const detail = new THREE.Group();
detail.userData.assetMetadata = { id: "cargo-ship" };
const item = { id: "ship-1", wrapper, detail };
adapter.applyChunkLOD({ chunkId: "ships", items: [item], level: 3 });
assert.equal(adapter.getMetrics().tracked, 1);
assert.equal(adapter.detach(item), true);
assert.equal(adapter.detach({ id: "unknown", wrapper, detail }), false);

const fallback = new ShipRenderAdapter({ resourcePool: sharedPool });
const fallbackDetail = new THREE.Group();
fallback.applyChunkLOD({ chunkId: "ships", items: [{ id: "ship-2", wrapper: new THREE.Group(), detail: fallbackDetail }], level: 3 });
assert.equal(fallback.getMetrics().tracked, 1);
console.log("ship render adapter smoke passed");
} finally {
  await vite.close();
}
