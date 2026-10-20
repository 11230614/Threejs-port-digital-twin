<template>
  <section class="asset-list-panel">
    <header class="panel-header">
      <span>资产列表</span>
      <strong>{{ assetStore.assetCount }}</strong>
    </header>

    <button
      v-for="asset in assetStore.allAssetViewModels"
      :key="asset.id"
      type="button"
      :class="['asset-card', asset.selectedClass]"
      @click="selectAsset(asset.id)"
    >
      <span class="asset-card__main">
        <strong>{{ asset.number }}</strong>
        <small>{{ asset.typeLabel }}</small>
      </span>
      <span class="asset-card__meta">
        <span :class="asset.statusClass">{{ asset.statusText }}</span>
        <span :class="asset.alarmClass">{{ asset.alarmText }} / {{ asset.taskProgressFormatted }}</span>
      </span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { useAssetStore } from "../stores/AssetStore";
import { useDeviceStore } from "../stores/DeviceStore";

const assetStore = useAssetStore();
const deviceStore = useDeviceStore();

function selectAsset(id: string) {
  const entity = assetStore.getEntityByAssetId(id);
  assetStore.selectAsset(id);

  if (entity) {
    deviceStore.selectEntity(entity);
  } else {
    deviceStore.deselectEntity();
  }
}
</script>

<style scoped>
.asset-list-panel {
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

.asset-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(108px, auto);
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

.asset-card:hover {
  border-color: rgba(63, 216, 255, 0.72);
  background: rgba(8, 36, 62, 0.84);
  transform: translateX(-2px);
}

.asset-card--selected {
  border-color: rgba(49, 247, 255, 0.95);
  background: rgba(9, 54, 79, 0.92);
  box-shadow: inset 3px 0 0 #31f7ff;
}

.asset-card__main,
.asset-card__meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.asset-card__main strong,
.asset-card__main small,
.asset-card__meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-card__main small,
.asset-card__meta {
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
}

.asset-card__meta {
  justify-items: end;
}

.status--running {
  color: #51f2a6;
}

.status--standby {
  color: #ffd45c;
}

.status--danger {
  color: #ff7a7a;
}

.status--maintenance {
  color: #75a7ff;
}

.alarm-severity--info {
  color: #68d7ff;
}

.alarm-severity--warning {
  color: #ffd45c;
}

.alarm-severity--severe {
  color: #ff7a2f;
}

.alarm-severity--urgent {
  color: #ff3333;
}
</style>
