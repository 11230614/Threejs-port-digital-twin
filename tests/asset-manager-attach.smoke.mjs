import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  setActivePinia(createPinia());
  const [{ AssetManager }, { EntityManager }, { AlarmSystem }, { useAssetStore }, { useAlarmStore }] = await Promise.all([
    vite.ssrLoadModule("/src/assets/AssetManager.ts"),
    vite.ssrLoadModule("/src/ecs/EntityManager.ts"),
    vite.ssrLoadModule("/src/ecs/systems/AlarmSystem.ts"),
    vite.ssrLoadModule("/src/stores/AssetStore.ts"),
    vite.ssrLoadModule("/src/stores/AlarmStore.ts"),
  ]);
  const assetStore = useAssetStore();
  const alarmStore = useAlarmStore();
  const entityManager = new EntityManager();
  const entity = entityManager.createEntity("entity-attach-regression");
  entityManager.add(entity);
  const assetManager = new AssetManager();
  const asset = { id: "asset-attach-regression", number: "AGV-ATTACH-01", type: "AGV", area: "测试区域" };

  const attached = assetManager.attach(entity, asset);
  assert.equal(attached, asset, "attach retains the registered runtime asset object");
  assert.equal(assetManager.getById(asset.id), asset);
  assert.equal(assetManager.getById(asset.id)?.entityId, entity.id, "the actual RuntimeAsset field stores the Entity ID");
  assert.equal(assetStore.getAssetById(asset.id)?.entityId, entity.id, "AssetStore registers the same entity relationship");
  assert.equal(assetStore.getEntityByAssetId(asset.id), entity, "downstream lookup resolves the exact associated Entity");

  const repeated = assetManager.attach(entity, { ...asset, entityId: "stale-duplicate-entity" });
  assert.equal(repeated, asset, "a repeated manifest object with the same ID resolves to the canonical RuntimeAsset");
  assert.equal(assetManager.getAll().filter((item) => item.id === asset.id).length, 1, "repeated attach does not duplicate runtime asset records");
  assert.equal(assetStore.getAssetById(asset.id)?.entityId, entity.id, "repeated attach keeps the expected Entity association");

  assetStore.updateTelemetry(asset.id, { timestamp: Date.now(), onlineStatus: "ONLINE", battery: 10 });
  new AlarmSystem({ assetManager, entityManager }).update();
  const alarm = alarmStore.alarms.find((item) => item.type === "AGV_LOW_BATTERY" && item.assetId === asset.id);
  assert.equal(alarm?.entityId, entity.id, "the real AlarmSystem caller reads the associated Entity ID from AssetManager");
  console.log("AssetManager attach checks passed (runtime field, AssetStore lookup, downstream alarm mapping, repeated attach).");
} finally {
  await vite.close();
}
