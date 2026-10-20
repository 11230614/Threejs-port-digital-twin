import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { useAlarmStore } from "./AlarmStore";
import { AssetViewModel } from "../viewmodels/AssetViewModel.ts";
import type { AssetState, SceneEntity, TelemetryState } from "./types";

export const useAssetStore = defineStore("asset", () => {
  const assetMap = shallowRef<Map<string, AssetState>>(new Map());
  const entityMap = shallowRef<Map<string, SceneEntity>>(new Map());
  const telemetryMap = shallowRef<Map<string, TelemetryState>>(new Map());
  const selectedAssetId = ref<string | null>(null);
  const frameVersion = ref(0);

  const currentAssetViewModel = computed(() => {
    frameVersion.value;
    const asset = selectedAssetId.value ? assetMap.value.get(selectedAssetId.value) : null;
    if (!asset) return null;
    const alarmStore = useAlarmStore();
    return AssetViewModel.fromAsset(asset, { entity: asset.entityId ? entityMap.value.get(asset.entityId) : null, telemetry: telemetryMap.value.get(asset.id) ?? null, activeAlarm: alarmStore.getActiveAlarmByAssetId(asset.id), selectedAssetId: selectedAssetId.value });
  });
  const allAssetViewModels = computed(() => {
    frameVersion.value; const alarmStore = useAlarmStore();
    return Array.from(assetMap.value.values()).map((asset) => AssetViewModel.fromAsset(asset, { entity: asset.entityId ? entityMap.value.get(asset.entityId) : null, telemetry: telemetryMap.value.get(asset.id) ?? null, activeAlarm: alarmStore.getActiveAlarmByAssetId(asset.id), selectedAssetId: selectedAssetId.value }));
  });
  const assetCount = computed(() => assetMap.value.size);
  const hasSelection = computed(() => currentAssetViewModel.value !== null);
  function registerAsset(asset: AssetState): void { const nextMap = new Map(assetMap.value); nextMap.set(asset.id, { ...asset }); assetMap.value = nextMap; frameVersion.value += 1; }
  function attachEntity(assetId: string, entity: SceneEntity | null): void { const asset = assetMap.value.get(assetId); if (!asset || !entity) return; const nextAssets = new Map(assetMap.value); nextAssets.set(assetId, { ...asset, entityId: entity.id }); assetMap.value = nextAssets; const nextEntities = new Map(entityMap.value); nextEntities.set(entity.id, entity); entityMap.value = nextEntities; frameVersion.value += 1; }
  function selectAsset(assetId: string | null): void { selectedAssetId.value = assetId && assetMap.value.has(assetId) ? assetId : null; frameVersion.value += 1; }
  function selectEntity(entity: SceneEntity | null): void { selectedAssetId.value = entity?.asset?.id ?? null; frameVersion.value += 1; }
  function deselectAsset(): void { selectedAssetId.value = null; frameVersion.value += 1; }
  function getAssetById(id: string): AssetState | null { return assetMap.value.get(id) ?? null; }
  function getEntityByAssetId(id: string): SceneEntity | null { const asset = getAssetById(id); return asset?.entityId ? entityMap.value.get(asset.entityId) ?? null : null; }
  function updateTelemetry(assetId: string, telemetry: TelemetryState): void { if (!assetMap.value.has(assetId)) return; const nextTelemetry = new Map(telemetryMap.value); nextTelemetry.set(assetId, { ...nextTelemetry.get(assetId), ...telemetry }); telemetryMap.value = nextTelemetry; frameVersion.value += 1; }
  function getTelemetryByAssetId(id: string): TelemetryState | null { return telemetryMap.value.get(id) ?? null; }
  function markFrame(): void { frameVersion.value += 1; }
  return { assetMap, entityMap, telemetryMap, selectedAssetId, frameVersion, currentAssetViewModel, allAssetViewModels, assetCount, hasSelection, registerAsset, attachEntity, selectAsset, selectEntity, deselectAsset, getAssetById, getEntityByAssetId, updateTelemetry, getTelemetryByAssetId, markFrame };
});
