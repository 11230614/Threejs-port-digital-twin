import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  const spatialTs = await vite.ssrLoadModule("/src/config/PortSpatialConfig.ts");
  const sceneTs = await vite.ssrLoadModule("/src/config/PortSceneConfig.ts");

  const spatialKeys = [
    "PORT_CONTAINER_LAYOUT_CONFIG", "PORT_YARD_LAYOUT_CONFIG", "PORT_AGV_LOOP_CONFIG",
    "PORT_CHUNK_CONFIG", "PORT_LOD_CONFIG", "PORT_RENDER_RESOURCE_CONFIG", "PORT_LOD_SHADOW_CONFIG",
  ];
  for (const key of spatialKeys) {
    assert.ok(spatialTs[key], `${key} is exported by the TypeScript authority`);
  }
  assert.equal(spatialTs.PORT_LOD_SHADOW_CONFIG, spatialTs.PORT_LOD_CONFIG);
  assert.equal(spatialTs.PORT_CONTAINER_LAYOUT_CONFIG.size.x, 15);
  assert.deepEqual(spatialTs.PORT_LOD_CONFIG.levels.map(({ level }) => level), [0, 1, 2]);

  const sceneKeys = [
    "PORT_MODEL_ASSETS", "PORT_CONTAINER_ASSET_IDS", "PORT_CONTAINER_RENDER_CONFIG",
    ...spatialKeys,
  ];
  for (const key of sceneKeys) {
    assert.ok(sceneTs[key], `${key} is exported by the TypeScript authority`);
  }
  assert.deepEqual(sceneTs.PORT_MODEL_ASSETS.map(({ id }) => id), ["container-blue", "container-red", "container-green", "ship", "crane", "agv"]);
  assert.deepEqual(sceneTs.PORT_CONTAINER_ASSET_IDS, ["container-blue", "container-red", "container-green"]);
  assert.equal(sceneTs.PORT_CONTAINER_RENDER_CONFIG.streamingDistances.unload, 1700);

  const runtime = await vite.ssrLoadModule("/src/app/PortRuntime.ts");
  assert.equal(typeof runtime.PortRuntime, "function", "PortRuntime resolves the TypeScript config module");
  const ground = await vite.ssrLoadModule("/src/world/GroundSystem.ts");
  assert.equal(typeof ground.GroundSystem, "function", "GroundSystem resolves the TypeScript spatial config");

  console.log("Config migration checks passed (TypeScript exports, values, re-exports, and production consumer imports).");
} finally {
  await vite.close();
}
