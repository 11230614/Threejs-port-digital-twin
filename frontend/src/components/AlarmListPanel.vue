<template>
  <section class="alarm-panel">
    <header class="panel-header">
      <span>告警闭环</span>
      <strong>{{ alarmStore.activeCount }}</strong>
    </header>

    <div class="alarm-summary">
      <span>紧急 {{ alarmStore.urgentCount }}</span>
      <span>活跃 {{ alarmStore.activeCount }}</span>
      <span>全部 {{ alarmStore.alarms.length }}</span>
    </div>

    <div class="alarm-list">
      <article
        v-for="alarm in alarmStore.alarms"
        :key="alarm.id"
        :class="['alarm-card', alarm.severityClass, { 'alarm-card--closed': alarm.status === AlarmStatus.CLOSED }]"
      >
        <header>
          <div>
            <strong>{{ alarm.typeLabel }}</strong>
            <small>{{ alarm.assetNumber }} / {{ alarm.area }}</small>
          </div>
          <span>{{ alarm.severityLabel }}</span>
        </header>

        <p>{{ alarm.message }}</p>
        <p class="alarm-suggestion">{{ alarm.suggestion }}</p>

        <div class="alarm-meta">
          <span>{{ alarm.statusLabel }}</span>
          <span>{{ alarm.updatedAtText }}</span>
        </div>

        <textarea
          :value="alarm.note"
          rows="2"
          placeholder="处理备注"
          @change="updateNoteFromEvent(alarm.id, $event)"
        ></textarea>

        <div class="alarm-actions">
          <button type="button" @click="emit('locate-asset', alarm.assetId)">定位</button>
          <button type="button" :disabled="alarm.status !== AlarmStatus.ACTIVE" @click="alarmStore.acknowledgeAlarm(alarm.id)">确认</button>
          <button type="button" :disabled="alarm.status === AlarmStatus.CLOSED" @click="alarmStore.dispatchAlarm(alarm.id)">派单</button>
          <button type="button" :disabled="alarm.status === AlarmStatus.CLOSED" @click="alarmStore.closeAlarm(alarm.id)">关闭</button>
        </div>
      </article>

      <p v-if="alarmStore.alarms.length === 0" class="empty-text">暂无告警，系统运行正常。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { AlarmStatus } from "../domain/AlarmCatalog";
import { useAlarmStore } from "../stores/AlarmStore";

const emit = defineEmits<{ (event: "locate-asset", assetId: string): void }>();
const alarmStore = useAlarmStore();

function updateNote(id: string, note: string) {
  alarmStore.updateNote(id, note);
}

function updateNoteFromEvent(id: string, event: Event) {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement) updateNote(id, target.value);
}
</script>

<style scoped>
.alarm-panel {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 180, 92, 0.28);
  border-radius: 6px;
  background: rgba(28, 16, 8, 0.72);
}

.panel-header,
.alarm-summary,
.alarm-meta,
.alarm-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-header {
  color: rgba(255, 228, 188, 0.76);
  font-size: 12px;
}

.panel-header strong {
  color: #ffffff;
  font-size: 16px;
}

.alarm-summary {
  padding: 8px;
  border-radius: 4px;
  color: rgba(255, 232, 202, 0.82);
  font-size: 12px;
  background: rgba(0, 0, 0, 0.2);
}

.alarm-list {
  display: grid;
  gap: 8px;
}

.alarm-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(255, 212, 92, 0.24);
  border-left-width: 4px;
  border-radius: 6px;
  background: rgba(5, 18, 31, 0.46);
}

.alarm-card--closed {
  opacity: 0.56;
}

.alarm-card header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.alarm-card strong,
.alarm-card small,
.alarm-card p,
.alarm-meta span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.alarm-card strong {
  display: block;
  color: #ffffff;
  font-size: 14px;
}

.alarm-card small,
.alarm-card p,
.alarm-meta {
  color: rgba(255, 232, 202, 0.74);
  font-size: 12px;
}

.alarm-card p {
  margin: 0;
  line-height: 1.5;
}

.alarm-suggestion {
  color: rgba(184, 245, 255, 0.78);
}

.alarm-card textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  resize: vertical;
  padding: 7px;
  border: 1px solid rgba(255, 220, 160, 0.2);
  border-radius: 4px;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.24);
}

.alarm-actions button {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(255, 220, 160, 0.28);
  border-radius: 4px;
  color: #fff4df;
  background: rgba(255, 170, 60, 0.14);
  cursor: pointer;
}

.alarm-actions button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.alarm-severity--info {
  border-left-color: #68d7ff;
}

.alarm-severity--warning {
  border-left-color: #ffd45c;
}

.alarm-severity--severe {
  border-left-color: #ff7a2f;
}

.alarm-severity--urgent {
  border-left-color: #ff3333;
  box-shadow: 0 0 18px rgba(255, 51, 51, 0.18);
}

.empty-text {
  margin: 0;
  color: rgba(255, 232, 202, 0.62);
  font-size: 13px;
}
</style>
