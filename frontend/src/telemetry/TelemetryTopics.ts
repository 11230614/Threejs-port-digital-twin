export const TelemetryChannel = Object.freeze({ MOCK_WEBSOCKET: "mock-websocket", MOCK_MQTT: "mock-mqtt" } as const);
export type TelemetryChannelValue = typeof TelemetryChannel[keyof typeof TelemetryChannel];
export const TelemetryTopic = Object.freeze({ AGV_POSITION: "port/agv/position", CRANE_STATUS: "port/crane/status", CONTAINER_OPERATION: "port/container/operation", DEVICE_ALARM: "port/device/alarm", TASK_PROGRESS: "port/task/progress" } as const);
export type TelemetryTopicValue = typeof TelemetryTopic[keyof typeof TelemetryTopic];
export const AlarmLevel = Object.freeze({ NORMAL: "NORMAL", INFO: "INFO", WARNING: "WARNING", CRITICAL: "CRITICAL" } as const);
export type AlarmLevelValue = typeof AlarmLevel[keyof typeof AlarmLevel];
export const ALARM_LEVEL_LABELS: Readonly<Record<AlarmLevelValue, string>> = Object.freeze({ [AlarmLevel.NORMAL]: "正常", [AlarmLevel.INFO]: "提示", [AlarmLevel.WARNING]: "告警", [AlarmLevel.CRITICAL]: "严重" });
