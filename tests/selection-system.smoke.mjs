import assert from "node:assert/strict";
import { createServer } from "vite";
import { createPinia, setActivePinia } from "pinia";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  setActivePinia(createPinia());
  const { SelectionSystem } = await vite.ssrLoadModule("/src/ecs/systems/SelectionSystem.ts");
  const { useDeviceStore } = await vite.ssrLoadModule("/src/stores/DeviceStore.ts");
  const { useAssetStore } = await vite.ssrLoadModule("/src/stores/AssetStore.ts");
  const deviceStore = useDeviceStore();
  const assetStore = useAssetStore();
  const entity = { id: "entity-1", asset: { id: "asset-1" }, selectable: { isSelected: false }, getWorldPosition: () => null };
  const system = new SelectionSystem({});

  system.select(entity);
  assert.equal(system.getSelected(), entity);
  assert.equal(deviceStore.currentEntity, entity);
  assert.equal(assetStore.selectedAssetId, "asset-1");
  assert.equal(entity.selectable.isSelected, true);

  system.deselect();
  assert.equal(system.getSelected(), null);
  assert.equal(deviceStore.currentEntity, null);
  assert.equal(assetStore.selectedAssetId, null);
  assert.equal(entity.selectable.isSelected, false);
  console.log("SelectionSystem behavior checks passed (bridge, store synchronization, selection reset).");
} finally {
  await vite.close();
}
