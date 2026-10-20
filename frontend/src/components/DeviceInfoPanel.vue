<template>
  <section class="device-info-panel">
    <header class="panel-header">
      <span>设备档案（PostgreSQL）</span>
      <strong>{{ store.hasSelection ? (store.currentDeviceProfile?.id ?? device.id) : "未选择" }}</strong>
    </header>

    <div v-if="store.hasSelection" class="info-grid">
      <div>
        <span>名称</span>
        <strong>{{ store.currentDeviceProfile?.name ?? "档案未匹配" }}</strong>
      </div>
      <div>
        <span>类型</span>
        <strong>{{ store.currentDeviceProfile?.type ?? "--" }}</strong>
      </div>
      <div>
        <span>业务编号 / ECS 编号</span>
        <strong>{{ store.currentDeviceProfile?.id ?? "--" }} / {{ device.id }}</strong>
      </div>
      <div>
        <span>场景状态（本地 ECS）</span>
        <strong :class="device.statusClass">{{ device.statusText }}</strong>
      </div>
      <div>
        <span>速度</span>
        <strong>{{ device.speedFormatted }}</strong>
      </div>
      <div>
        <span>轨道进度</span>
        <strong>{{ device.progressFormatted }}</strong>
      </div>
      <div class="info-grid__wide">
        <span>位置</span>
        <strong>{{ device.positionFormatted }}</strong>
      </div>
    </div>

    <p v-else class="empty-text">点击场景实体或右侧列表查看设备详情</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useDeviceStore } from "../stores/DeviceStore";

const store = useDeviceStore();
const device = computed(() => store.currentDeviceViewModel!);
</script>

<style scoped>
.device-info-panel {
  padding: 14px;
  border: 1px solid rgba(63, 216, 255, 0.24);
  border-radius: 6px;
  background: rgba(4, 20, 36, 0.78);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: rgba(184, 245, 255, 0.74);
  font-size: 12px;
}

.panel-header strong {
  min-width: 0;
  color: #ffffff;
  overflow-wrap: anywhere;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.info-grid div {
  min-width: 0;
  padding: 9px;
  border-radius: 4px;
  background: rgba(0, 12, 24, 0.48);
}

.info-grid__wide {
  grid-column: 1 / -1;
}

.info-grid span {
  display: block;
  margin-bottom: 4px;
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
}

.info-grid strong {
  color: #ffffff;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.empty-text {
  margin: 0;
  color: rgba(184, 245, 255, 0.62);
  font-size: 13px;
  line-height: 1.7;
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
