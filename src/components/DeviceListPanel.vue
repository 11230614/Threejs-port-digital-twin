<template>
  <section class="device-list-panel">
    <header class="panel-header">
      <span>设备列表</span>
      <strong>{{ profileState === 'loaded' ? store.deviceProfilesList.length : '--' }}</strong>
    </header>

    <div v-if="profileState === 'loading'" class="profile-message">正在加载设备档案…</div>
    <div v-else-if="profileState === 'error'" class="profile-message">
      设备档案加载失败：{{ profileError }}
      <button type="button" @click.stop="loadProfiles">重试</button>
    </div>

    <button
      v-for="device in store.deviceProfilesList"
      :key="device.id"
      type="button"
      :disabled="!device.hasSceneEntity"
      :class="['device-card', device.selectedClass]"
      @click="selectDevice(device)"
    >
      <span class="device-card__main">
        <strong>{{ device.name }}</strong>
        <small>{{ device.id }} · {{ device.type }}</small>
      </span>
      <span class="device-card__meta">
        <span>{{ device.hasSceneEntity ? "已映射场景实体" : "场景中无对应实体" }}</span>
      </span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getDevices } from "../api/devices";
import { useDeviceStore } from "../stores/DeviceStore";
import type { DeviceProfileState } from "../stores/types";

const emit = defineEmits<{ (event: "locate-device", entityId: string): void }>();

const store = useDeviceStore();
const profileState = ref("loading");
const profileError = ref("");
let controller: AbortController | null = null;
let requestVersion = 0;

onMounted(() => void loadProfiles());
onBeforeUnmount(() => {
  requestVersion += 1;
  controller?.abort();
});

async function loadProfiles() {
  const version = ++requestVersion;
  controller?.abort();
  controller = new AbortController();
  profileState.value = "loading";
  profileError.value = "";
  try {
    const result = await getDevices({ signal: controller.signal });
    if (version !== requestVersion) return;
    store.setDeviceProfiles(result.items);
    profileState.value = "loaded";
  } catch (error: unknown) {
    if (version !== requestVersion || (error instanceof DOMException && error.name === "AbortError")) return;
    profileError.value = error instanceof Error ? error.message : "未知错误";
    profileState.value = "error";
  } finally {
    if (version === requestVersion) controller = null;
  }
}

function selectDevice(profile: DeviceProfileState & { hasSceneEntity: boolean }) {
  if (!profile.hasSceneEntity) return;
  const entity = store.getEntityById(profile.entityId);
  if (entity) {
    store.selectEntity(entity);
    emit("locate-device", profile.entityId);
  }
}
</script>

<style scoped>
.device-list-panel {
  display: grid;
  gap: 8px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(184, 245, 255, 0.74);
  font-size: 12px;
}

.panel-header strong {
  color: #ffffff;
  font-size: 16px;
}

.device-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 10px;
  border: 1px solid rgba(63, 216, 255, 0.2);
  border-radius: 6px;
  color: #d8fbff;
  text-align: left;
  background: rgba(4, 20, 36, 0.66);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;
}

.device-card:hover {
  border-color: rgba(63, 216, 255, 0.72);
  background: rgba(8, 36, 62, 0.84);
  transform: translateX(-2px);
}

.device-card:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.profile-message {
  color: rgba(184, 245, 255, 0.76);
  font-size: 12px;
  line-height: 1.6;
}

.profile-message button {
  margin-left: 8px;
}

.device-card--selected {
  border-color: rgba(49, 247, 255, 0.95);
  background: rgba(9, 54, 79, 0.92);
  box-shadow: inset 3px 0 0 #31f7ff;
}

.device-card__main,
.device-card__meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.device-card__main strong {
  overflow-wrap: anywhere;
}

.device-card__main small,
.device-card__meta {
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
}

.device-card__meta {
  justify-items: end;
  white-space: nowrap;
}

.status--running {
  color: #51f2a6;
}

.status--idle,
.status--standby {
  color: #ffd45c;
}

.status--warning {
  color: #ff7a7a;
}
</style>
