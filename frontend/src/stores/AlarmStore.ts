import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { ALARM_SEVERITY_LABELS, ALARM_SEVERITY_RANK, ALARM_STATUS_LABELS, ALARM_TYPE_LABELS, AlarmSeverity, AlarmStatus, createAlarmKey } from "../domain/AlarmCatalog";
import type { AlarmInput, AlarmState } from "./types";

export const useAlarmStore = defineStore("alarm", () => {
  const alarmMap = shallowRef<Map<string, AlarmState>>(new Map());
  const selectedAlarmId = ref<string | null>(null);
  const frameVersion = ref(0);
  const alarms = computed(() => {
    frameVersion.value;
    return Array.from(alarmMap.value.values()).map(toViewModel).sort((a, b) => {
      if (a.status === AlarmStatus.CLOSED && b.status !== AlarmStatus.CLOSED) return 1;
      if (a.status !== AlarmStatus.CLOSED && b.status === AlarmStatus.CLOSED) return -1;
      return ALARM_SEVERITY_RANK[b.severity] - ALARM_SEVERITY_RANK[a.severity] || b.updatedAt - a.updatedAt;
    });
  });
  const activeAlarms = computed(() => alarms.value.filter((alarm) => alarm.status !== AlarmStatus.CLOSED));
  const activeCount = computed(() => activeAlarms.value.length);
  const urgentCount = computed(() => activeAlarms.value.filter((alarm) => alarm.severity === AlarmSeverity.URGENT).length);

  function upsertAlarm(data: AlarmInput): void {
    const id = data.id ?? createAlarmKey(data.type, data.assetId); const now = Date.now(); const current = alarmMap.value.get(id);
    const carried = current && current.status !== AlarmStatus.CLOSED ? current : null; const nextMap = new Map(alarmMap.value);
    nextMap.set(id, { ...current, ...data, id, createdAt: carried?.createdAt ?? now, acknowledgedAt: carried?.acknowledgedAt ?? null, dispatchedAt: carried?.dispatchedAt ?? null, closedAt: null, note: carried?.note ?? "", assignee: carried?.assignee ?? "", status: carried?.status ?? AlarmStatus.ACTIVE, updatedAt: now });
    alarmMap.value = nextMap; frameVersion.value += 1;
  }
  function clearAutoAlarm(type: AlarmInput["type"], assetId: string, note = "系统检测恢复后自动关闭"): void {
    const id = createAlarmKey(type, assetId); const alarm = alarmMap.value.get(id); if (!alarm || alarm.status === AlarmStatus.CLOSED) return;
    patchAlarm(id, { status: AlarmStatus.CLOSED, closedAt: Date.now(), note: alarm.note || note });
  }
  function acknowledgeAlarm(id: string, note = "现场已确认"): void { patchAlarm(id, { status: AlarmStatus.ACKNOWLEDGED, acknowledgedAt: Date.now(), note }); }
  function dispatchAlarm(id: string, assignee = "维修班组", note = "已派单处理"): void { patchAlarm(id, { status: AlarmStatus.DISPATCHED, dispatchedAt: Date.now(), assignee, note }); }
  function closeAlarm(id: string, note = "处理完成，关闭告警"): void { patchAlarm(id, { status: AlarmStatus.CLOSED, closedAt: Date.now(), note }); }
  function updateNote(id: string, note: string): void { patchAlarm(id, { note }); }
  function selectAlarm(id: string | null): void { selectedAlarmId.value = id && alarmMap.value.has(id) ? id : null; frameVersion.value += 1; }
  function getActiveAlarmByAssetId(assetId: string) { return activeAlarms.value.find((alarm) => alarm.assetId === assetId) ?? null; }
  function getHighestActiveAlarmByEntityId(entityId: string) { return activeAlarms.value.filter((alarm) => alarm.entityId === entityId).sort((a, b) => ALARM_SEVERITY_RANK[b.severity] - ALARM_SEVERITY_RANK[a.severity])[0] ?? null; }
  function patchAlarm(id: string, patch: Partial<AlarmState>): void { const alarm = alarmMap.value.get(id); if (!alarm) return; const nextMap = new Map(alarmMap.value); nextMap.set(id, { ...alarm, ...patch, updatedAt: Date.now() }); alarmMap.value = nextMap; frameVersion.value += 1; }
  return { alarmMap, selectedAlarmId, frameVersion, alarms, activeAlarms, activeCount, urgentCount, upsertAlarm, clearAutoAlarm, acknowledgeAlarm, dispatchAlarm, closeAlarm, updateNote, selectAlarm, getActiveAlarmByAssetId, getHighestActiveAlarmByEntityId };
});

function toViewModel(alarm: AlarmState) {
  return { ...alarm, typeLabel: ALARM_TYPE_LABELS[alarm.type] ?? alarm.type, severityLabel: ALARM_SEVERITY_LABELS[alarm.severity] ?? alarm.severity, statusLabel: ALARM_STATUS_LABELS[alarm.status] ?? alarm.status, severityClass: getSeverityClass(alarm.severity), createdAtText: formatTime(alarm.createdAt), updatedAtText: formatTime(alarm.updatedAt) };
}
function formatTime(timestamp: number): string { return timestamp ? new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"; }
function getSeverityClass(severity: AlarmState["severity"]): string { if (severity === AlarmSeverity.URGENT) return "alarm-severity--urgent"; if (severity === AlarmSeverity.SEVERE) return "alarm-severity--severe"; if (severity === AlarmSeverity.WARNING) return "alarm-severity--warning"; return "alarm-severity--info"; }
