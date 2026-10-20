export const AlarmType = Object.freeze({
  DEVICE_OFFLINE: "DEVICE_OFFLINE", AGV_LOW_BATTERY: "AGV_LOW_BATTERY", AGV_STALLED: "AGV_STALLED",
  PATH_CONGESTION: "PATH_CONGESTION", CRANE_EXCEPTION: "CRANE_EXCEPTION", CONTAINER_STACK_CONFLICT: "CONTAINER_STACK_CONFLICT",
} as const);
export type AlarmTypeValue = typeof AlarmType[keyof typeof AlarmType];
export const AlarmSeverity = Object.freeze({ INFO: "INFO", WARNING: "WARNING", SEVERE: "SEVERE", URGENT: "URGENT" } as const);
export type AlarmSeverityValue = typeof AlarmSeverity[keyof typeof AlarmSeverity];
export const AlarmStatus = Object.freeze({ ACTIVE: "ACTIVE", ACKNOWLEDGED: "ACKNOWLEDGED", DISPATCHED: "DISPATCHED", CLOSED: "CLOSED" } as const);
export type AlarmStatusValue = typeof AlarmStatus[keyof typeof AlarmStatus];
export const ALARM_TYPE_LABELS: Readonly<Record<AlarmTypeValue, string>> = Object.freeze({
  [AlarmType.DEVICE_OFFLINE]: "设备离线", [AlarmType.AGV_LOW_BATTERY]: "AGV 电量低", [AlarmType.AGV_STALLED]: "AGV 停滞",
  [AlarmType.PATH_CONGESTION]: "路径拥堵", [AlarmType.CRANE_EXCEPTION]: "起重机异常", [AlarmType.CONTAINER_STACK_CONFLICT]: "集装箱堆放冲突",
});
export const ALARM_SEVERITY_LABELS: Readonly<Record<AlarmSeverityValue, string>> = Object.freeze({
  [AlarmSeverity.INFO]: "提示", [AlarmSeverity.WARNING]: "警告", [AlarmSeverity.SEVERE]: "严重", [AlarmSeverity.URGENT]: "紧急",
});
export const ALARM_STATUS_LABELS: Readonly<Record<AlarmStatusValue, string>> = Object.freeze({
  [AlarmStatus.ACTIVE]: "待确认", [AlarmStatus.ACKNOWLEDGED]: "已确认", [AlarmStatus.DISPATCHED]: "已派单", [AlarmStatus.CLOSED]: "已关闭",
});
export const ALARM_SEVERITY_RANK: Readonly<Record<AlarmSeverityValue, number>> = Object.freeze({
  [AlarmSeverity.INFO]: 1, [AlarmSeverity.WARNING]: 2, [AlarmSeverity.SEVERE]: 3, [AlarmSeverity.URGENT]: 4,
});
export function createAlarmKey(type: AlarmTypeValue, assetId: string): string { return `${type}:${assetId}`; }
