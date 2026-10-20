import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { DeviceViewModel } from "../viewmodels/DeviceViewModel.ts";
import type { DeviceProfileState, SceneEntity } from "./types";

export const useDeviceStore = defineStore("device", () => {
  const currentEntity = shallowRef<SceneEntity | null>(null);
  const entityMap = shallowRef<Map<string, SceneEntity>>(new Map());
  const deviceProfiles = shallowRef<Map<string, DeviceProfileState>>(new Map());
  const frameVersion = ref(0);
  const currentDeviceViewModel = computed(() => { frameVersion.value; return currentEntity.value ? DeviceViewModel.fromEntity(currentEntity.value) : null; });
  const allDeviceViewModels = computed(() => { frameVersion.value; return Array.from(entityMap.value.values()).map((entity) => DeviceViewModel.fromEntity(entity)); });
  const selectedId = computed(() => currentEntity.value?.id ?? null);
  const hasSelection = computed(() => currentEntity.value !== null);
  const currentDeviceProfile = computed(() => { frameVersion.value; if (!currentEntity.value) return null; return Array.from(deviceProfiles.value.values()).find((profile) => profile.entityId === currentEntity.value!.id) ?? null; });
  const deviceCount = computed(() => entityMap.value.size);
  const deviceProfilesList = computed(() => { frameVersion.value; return Array.from(deviceProfiles.value.values()).map((profile) => { const entity = entityMap.value.get(profile.entityId) ?? null; const runtime = entity ? DeviceViewModel.fromEntity(entity) : null; return { ...profile, hasSceneEntity: Boolean(entity), selectedClass: runtime?.selectedClass ?? "" }; }); });
  function setDeviceProfiles(profiles: readonly DeviceProfileState[]): void { const nextMap = new Map<string, DeviceProfileState>(); for (const profile of profiles) nextMap.set(profile.id, { ...profile }); deviceProfiles.value = nextMap; frameVersion.value += 1; }
  function registerEntity(entity: SceneEntity): void { const nextMap = new Map(entityMap.value); nextMap.set(entity.id, entity); entityMap.value = nextMap; frameVersion.value += 1; }
  function unregisterEntity(id: string): void { const nextMap = new Map(entityMap.value); nextMap.delete(id); entityMap.value = nextMap; if (currentEntity.value?.id === id) currentEntity.value = null; frameVersion.value += 1; }
  function selectEntity(entity: SceneEntity | null): void { if (currentEntity.value?.selectable) currentEntity.value.selectable.isSelected = false; currentEntity.value = entity; if (entity?.selectable) entity.selectable.isSelected = true; frameVersion.value += 1; }
  function deselectEntity(): void { selectEntity(null); }
  function getEntityById(id: string): SceneEntity | null { return entityMap.value.get(id) ?? null; }
  function markFrame(): void { frameVersion.value += 1; }
  return { currentEntity, entityMap, frameVersion, currentDeviceViewModel, allDeviceViewModels, selectedId, hasSelection, currentDeviceProfile, deviceCount, deviceProfiles, deviceProfilesList, setDeviceProfiles, registerEntity, unregisterEntity, selectEntity, deselectEntity, getEntityById, markFrame };
});
