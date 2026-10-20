export const TaskType = Object.freeze({
  TRANSPORT_CONTAINER: "TRANSPORT_CONTAINER", TRANSPORT: "TRANSPORT", LOADING: "LOADING", DISCHARGE: "DISCHARGE", YARD_TRANSFER: "YARD_TRANSFER", CHARGING: "CHARGING",
} as const);
export type TaskTypeValue = typeof TaskType[keyof typeof TaskType];
export const TaskStatus = Object.freeze({ WAITING: "WAITING", RUNNING: "RUNNING", PAUSED: "PAUSED", COMPLETED: "COMPLETED" } as const);
export type TaskStatusValue = typeof TaskStatus[keyof typeof TaskStatus];
export const TASK_TYPE_LABELS: Readonly<Record<TaskTypeValue, string>> = Object.freeze({
  [TaskType.TRANSPORT_CONTAINER]: "集装箱运输", [TaskType.TRANSPORT]: "运输任务", [TaskType.LOADING]: "装船任务", [TaskType.DISCHARGE]: "卸船任务", [TaskType.YARD_TRANSFER]: "堆场转运", [TaskType.CHARGING]: "充电任务",
});
export const TASK_STATUS_LABELS: Readonly<Record<TaskStatusValue, string>> = Object.freeze({ [TaskStatus.WAITING]: "等待", [TaskStatus.RUNNING]: "执行中", [TaskStatus.PAUSED]: "暂停", [TaskStatus.COMPLETED]: "完成" });
export const TASK_STEP_TEMPLATES: Readonly<Record<TaskTypeValue, readonly string[]>> = Object.freeze({
  [TaskType.TRANSPORT_CONTAINER]: ["下发任务", "释放集装箱", "分配 AGV", "前往取箱点", "集装箱装载", "前往目标区域", "卸载集装箱", "完成"],
  [TaskType.TRANSPORT]: ["选择 Container", "选择 AGV", "计算路径", "AGV 移动", "到达", "等待 RTG", "RTG 装箱", "完成"],
  [TaskType.LOADING]: ["Container", "RTG 取箱", "放到 AGV", "AGV 运输", "到达岸桥", "岸桥吊装", "放船上", "完成"],
  [TaskType.DISCHARGE]: ["船", "岸桥卸船", "放到 AGV", "AGV 运输", "RTG 接箱", "堆场落箱", "完成"],
  [TaskType.YARD_TRANSFER]: ["A01 起点", "RTG 取箱", "放 AGV", "AGV 运输", "另一台 RTG 接力", "A15 放下", "完成"],
  [TaskType.CHARGING]: ["AGV 电量 < 20%", "暂停运输", "前往充电站", "等待充电", "恢复运输", "完成"],
});
export function createTaskId(type: TaskTypeValue, index: number): string { return `${type}-${String(index + 1).padStart(3, "0")}`; }
