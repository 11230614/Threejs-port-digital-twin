import { Prisma } from "@prisma/client";
import { prisma } from "../db/pool.js";
import { taskRepository as memoryRepository, taskTypes } from "../data/tasks.js";

export { taskTypes };

function mapTask(row: any) {
  if (!row) return null;
  return { id: row.id, clientRequestId: row.client_request_id, type: row.type, parameters: row.parameters,
    status: row.status, stage: row.stage, agvId: row.agv_id, agvEntityId: row.agv_entity_id,
    containerId: row.container_id, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(), failure: row.failure };
}

const selectTask = Prisma.sql`SELECT id, client_request_id, type, parameters, status, stage, agv_id, agv_entity_id,
  container_id, created_at, updated_at, failure FROM tasks`;

export const taskRepository = Object.freeze({
  async create({ clientRequestId, type, parameters = {} }) {
    if (!prisma) return memoryRepository.create({ clientRequestId, type, parameters });
    const id = `TASK-${crypto.randomUUID()}`;
    const containerId = parameters.containerId ?? null;
    const inserted = await prisma.$queryRaw<any[]>(Prisma.sql`INSERT INTO tasks (id, client_request_id, type, parameters, container_id)
      VALUES (${id}, ${clientRequestId}, ${type}, ${JSON.stringify(parameters)}::jsonb, ${containerId})
      ON CONFLICT (client_request_id) DO NOTHING
      RETURNING id, client_request_id, type, parameters, status, stage, agv_id, agv_entity_id, container_id, created_at, updated_at, failure`);
    if (inserted.length) return { task: mapTask(inserted[0]) };
    const existingResult = await prisma.$queryRaw<any[]>(Prisma.sql`${selectTask} WHERE client_request_id = ${clientRequestId}`);
    if (!existingResult.length) throw new Error("创建请求冲突后未找到已有任务记录");
    const existing = mapTask(existingResult[0]);
    const same = existing.type === type && JSON.stringify(existing.parameters) === JSON.stringify(parameters) && existing.containerId === containerId;
    return same ? { replay: true, task: existing } : { conflict: true, task: existing };
  },

  async list({ status, page = 1, pageSize = 20 }) {
    if (!prisma) return memoryRepository.list({ status, page, pageSize });
    const where = status ? { status } : undefined;
    const [total, rows] = await prisma.$transaction([
      prisma.tasks.count({ where }),
      prisma.tasks.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map(mapTask), total };
  },

  async get(id) {
    if (!prisma) return memoryRepository.get(id);
    return mapTask(await prisma.tasks.findUnique({ where: { id } }));
  },

  async applyEvent(id, event) {
    if (!prisma) return memoryRepository.applyEvent(id, event);
    return prisma.$transaction(async (tx) => {
      const found = await tx.$queryRaw<any[]>(Prisma.sql`${selectTask} WHERE id = ${id} FOR UPDATE`);
      if (!found.length) return { error: [404, "TASK_NOT_FOUND", "任务不存在"] };
      const task = mapTask(found[0]);
      const duplicate = await tx.task_execution_events.findFirst({ where: { task_id: id, event_id: event.eventId } });
      if (duplicate) return { duplicate: true, task };
      const last = await tx.task_execution_events.aggregate({ where: { task_id: id }, _max: { sequence: true } });
      if (event.sequence !== (last._max.sequence ?? 0) + 1) return { error: [409, "EVENT_SEQUENCE_CONFLICT", "事件序号不连续"] };
      const transitions = { pending: ["running", "failed"], running: ["running", "completed", "failed"], completed: [], failed: [] };
      if (!transitions[task.status]?.includes(event.status)) return { error: [409, "INVALID_TASK_TRANSITION", "任务状态转换不合法"] };
      const nextContainerId = event.containerId ?? task.containerId ?? null;
      if (nextContainerId && !await tx.containers.findUnique({ where: { business_id: nextContainerId }, select: { business_id: true } })) {
        return { error: [400, "UNKNOWN_CONTAINER", "containerId 不存在"] };
      }
      const failure = event.status === "failed" ? (event.failure ?? { code: "EXECUTION_FAILED", message: "前端执行失败" }) : Prisma.DbNull;
      const agvId = event.agvId ?? task.agvId;
      const agvEntityId = event.agvEntityId ?? task.agvEntityId;
      await tx.task_execution_events.create({ data: { task_id: id, event_id: event.eventId, sequence: event.sequence, status: event.status,
        stage: event.stage ?? null, agv_id: agvId, agv_entity_id: agvEntityId,
        failure: failure === Prisma.DbNull ? Prisma.DbNull : failure, payload: event } });
      const updated = await tx.tasks.update({ where: { id }, data: { status: event.status, stage: event.stage ?? undefined,
        agv_id: agvId, agv_entity_id: agvEntityId, container_id: nextContainerId, failure } });
      return { task: mapTask(updated) };
    });
  },
});
