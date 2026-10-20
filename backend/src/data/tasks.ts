const records = new Map<string, any>();
const clientRequests = new Map<string, string>();
const eventKeys = new Map<string, Set<string>>();
export const taskTypes = Object.freeze(["TRANSPORT_CONTAINER", "TRANSPORT", "LOADING", "DISCHARGE", "YARD_TRANSFER", "CHARGING"]);
const transitions: Record<string, string[]> = { pending: ["running", "failed"], running: ["running", "completed", "failed"], completed: [], failed: [] };
export const taskRepository = {
  async create({ clientRequestId, type, parameters = {} }: any) {
    const existingId = clientRequests.get(clientRequestId);
    if (existingId) { const existing = records.get(existingId); return JSON.stringify(existing.parameters) === JSON.stringify(parameters) && existing.type === type ? { replay: true, task: existing } : { conflict: true, task: existing }; }
    const now = new Date().toISOString();
    const task = { id: `TASK-${crypto.randomUUID()}`, clientRequestId, type, parameters, status: "pending", stage: "created", agvId: null, agvEntityId: null, containerId: parameters.containerId ?? null, createdAt: now, updatedAt: now, failure: null };
    records.set(task.id, task); clientRequests.set(clientRequestId, task.id); eventKeys.set(task.id, new Set()); return { task };
  },
  async list({ status, page = 1, pageSize = 20 }: any) { const all = [...records.values()].filter((task) => !status || task.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)); return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length }; },
  async get(id: string) { return records.get(id) ?? null; },
  async applyEvent(id: string, event: any) {
    const task = records.get(id); if (!task) return { error: [404, "TASK_NOT_FOUND", "任务不存在"] }; const keys = eventKeys.get(id)!;
    if (keys.has(event.eventId)) return { duplicate: true, task }; if (event.sequence !== keys.size + 1) return { error: [409, "EVENT_SEQUENCE_CONFLICT", "事件序号不连续"] }; if (!transitions[task.status]?.includes(event.status)) return { error: [409, "INVALID_TASK_TRANSITION", "任务状态转换不合法"] };
    keys.add(event.eventId); task.status = event.status; task.stage = event.stage ?? task.stage; if (event.agvId !== undefined) task.agvId = event.agvId; if (event.agvEntityId !== undefined) task.agvEntityId = event.agvEntityId; if (event.containerId !== undefined) task.containerId = event.containerId; task.failure = event.status === "failed" ? (event.failure ?? { code: "EXECUTION_FAILED", message: "前端执行失败" }) : null; task.updatedAt = new Date().toISOString(); return { task };
  },
};
