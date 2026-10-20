<template>
  <section class="asset-info-panel">
    <header class="panel-header">
      <span>资产详情</span>
      <strong>{{ store.hasSelection ? asset.number : "未选择" }}</strong>
    </header>

    <div v-if="store.hasSelection" class="asset-detail">
      <div class="asset-title">
        <span :class="['asset-title__dot', asset.statusClass]"></span>
        <div>
          <strong>{{ asset.typeLabel }}</strong>
          <small>{{ asset.area }}</small>
        </div>
      </div>

      <div class="info-grid">
        <div>
          <span>编号</span>
          <strong>{{ asset.number }}</strong>
        </div>
        <div>
          <span>当前状态</span>
          <strong :class="asset.statusClass">{{ asset.statusText }}</strong>
        </div>
        <div>
          <span>在线状态</span>
          <strong :class="asset.onlineClass">{{ asset.onlineText }}</strong>
        </div>
        <div>
          <span>故障状态</span>
          <strong :class="asset.faultClass">{{ asset.faultText }}</strong>
        </div>
        <div>
          <span>维护状态</span>
          <strong :class="asset.maintenanceClass">{{ asset.maintenanceText }}</strong>
        </div>
        <div>
          <span>责任班组</span>
          <strong>{{ asset.ownerTeam }}</strong>
        </div>
        <div class="info-grid__wide">
          <span>当前任务</span>
          <strong>{{ asset.currentTask }}</strong>
        </div>
      </div>

      <section class="telemetry-card" aria-label="实时遥测">
        <header>
          <span>实时遥测</span>
          <strong>{{ asset.updatedAtFormatted }}</strong>
        </header>
        <div class="telemetry-grid">
          <div>
            <span>速度</span>
            <strong>{{ asset.speedFormatted }}</strong>
          </div>
          <div>
            <span>电量</span>
            <strong>{{ asset.batteryFormatted }}</strong>
          </div>
          <div>
            <span>载重</span>
            <strong>{{ asset.load }}</strong>
          </div>
          <div>
            <span>任务进度</span>
            <strong>{{ asset.taskProgressFormatted }}</strong>
          </div>
          <div>
            <span>轨道进度</span>
            <strong>{{ asset.progressFormatted }}</strong>
          </div>
          <div>
            <span>告警</span>
            <strong :class="asset.alarmClass">{{ asset.activeAlarmText }}</strong>
          </div>
          <div>
            <span>闭环状态</span>
            <strong :class="asset.alarmClass">{{ asset.activeAlarmStatusText }}</strong>
          </div>
          <div v-if="asset.craneWorkState">
            <span>起重机工况</span>
            <strong>{{ asset.craneWorkState }}</strong>
          </div>
          <div v-if="asset.containerOperationStatus">
            <span>装卸状态</span>
            <strong>{{ asset.containerOperationStatus }}</strong>
          </div>
          <div class="telemetry-grid__wide">
            <span>场景坐标</span>
            <strong>{{ asset.positionFormatted }}</strong>
          </div>
          <div class="telemetry-grid__wide">
            <span>告警内容</span>
            <strong :class="asset.alarmClass">{{ asset.alarmMessage }}</strong>
          </div>
        </div>
      </section>

      <dl class="metric-list">
        <div v-for="(value, key) in asset.metrics" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>

      <footer class="asset-foot">
        <span>数据通道：{{ asset.channel }}</span>
        <span>Topic：{{ asset.topic }}</span>
      </footer>
    </div>

    <p v-else class="empty-text">点击场景实体或资产列表查看实时业务信息。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAssetStore } from "../stores/AssetStore";

const store = useAssetStore();
const asset = computed(() => store.currentAssetViewModel!);
</script>

<style scoped>
.asset-info-panel {
  padding: 14px;
  border: 1px solid rgba(63, 216, 255, 0.24);
  border-radius: 6px;
  background: rgba(4, 20, 36, 0.78);
}

.panel-header,
.asset-foot,
.telemetry-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(184, 245, 255, 0.74);
  font-size: 12px;
}

.panel-header {
  margin-bottom: 12px;
}

.panel-header strong,
.telemetry-card header strong {
  min-width: 0;
  color: #ffffff;
  overflow-wrap: anywhere;
}

.asset-detail {
  display: grid;
  gap: 10px;
}

.asset-title {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(63, 216, 255, 0.18);
}

.asset-title__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
}

.asset-title strong,
.asset-title small {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.asset-title strong {
  color: #ffffff;
  font-size: 15px;
}

.asset-title small {
  margin-top: 3px;
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
}

.info-grid,
.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.info-grid div,
.telemetry-grid div {
  min-width: 0;
  padding: 9px;
  border-radius: 4px;
  background: rgba(0, 12, 24, 0.48);
}

.telemetry-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(63, 216, 255, 0.2);
  border-radius: 6px;
  background: rgba(0, 26, 48, 0.36);
}

.info-grid__wide,
.telemetry-grid__wide {
  grid-column: 1 / -1;
}

.info-grid span,
.telemetry-grid span,
.metric-list dt {
  display: block;
  margin-bottom: 4px;
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
}

.info-grid strong,
.telemetry-grid strong,
.metric-list dd {
  margin: 0;
  color: #ffffff;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.metric-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.metric-list div {
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(63, 216, 255, 0.16);
  border-radius: 4px;
  background: rgba(5, 18, 31, 0.42);
}

.metric-list dd {
  font-size: 13px;
}

.asset-foot {
  align-items: flex-start;
  padding-top: 10px;
  border-top: 1px solid rgba(63, 216, 255, 0.18);
  line-height: 1.5;
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
