import { Router } from "express";
import { taskRepository, taskTypes } from "../repositories/taskRepository.js";
import { devices } from "../data/devices.js";
export const tasksRouter = Router();
tasksRouter.post("/", async (req, res, next) => {
  const { clientRequestId, type, parameters } = req.body ?? {};
  if (typeof clientRequestId !== "string" || !/^[\w-]{8,100}$/.test(clientRequestId) || !taskTypes.includes(type) || (parameters !== undefined && (typeof parameters !== "object" || Array.isArray(parameters)))) {
    const e = new Error("clientRequestId、type 或 parameters 无效"); e.status = 400; e.code = "INVALID_TASK_REQUEST"; return next(e);
  }
  if (parameters?.agvId && !devices.some((device) => device.id === parameters.agvId)) {
    const e = new Error("parameters.agvId 不是已知设备"); e.status = 400; e.code = "UNKNOWN_DEVICE"; return next(e);
  }
  let result;
  try { result = await taskRepository.create({ clientRequestId, type, parameters }); } catch (error) { return next(error); }
  if (result.conflict) { const e = new Error("clientRequestId 已用于不同任务"); e.status = 409; e.code = "CLIENT_REQUEST_CONFLICT"; return next(e); }
  res.status(result.replay ? 200 : 201).location(`/api/tasks/${result.task.id}`).json(result.task);
});
tasksRouter.get("/", async (req, res, next) => {
  const status = req.query.status;
  const page = Number(req.query.page ?? 1); const pageSize = Number(req.query.pageSize ?? 20);
  if ((status && !["pending", "running", "completed", "failed"].includes(status)) || !Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    const e = new Error("status、page 或 pageSize 无效"); e.status = 400; e.code = "INVALID_TASK_QUERY"; return next(e);
  }
  try {
    const result = await taskRepository.list({ status, page, pageSize });
    return res.json({ ...result, page, pageSize });
  } catch (error) { return next(error); }
});
tasksRouter.get("/:id", async (req, res, next) => {
  let task;
  try { task = await taskRepository.get(req.params.id); } catch (error) { return next(error); }
  if (!task) { const e = new Error("任务不存在"); e.status = 404; e.code = "TASK_NOT_FOUND"; return next(e); }
  return res.json(task);
});
tasksRouter.post("/:id/execution-events", async (req, res, next) => {
  const { eventId, sequence, status, stage } = req.body ?? {};
  if (typeof eventId !== "string" || !eventId || !Number.isInteger(sequence) || sequence < 1 || !["running", "completed", "failed"].includes(status)) { const e = new Error("执行事件字段无效"); e.status = 400; e.code = "INVALID_EXECUTION_EVENT"; return next(e); }
  if (req.body.containerId !== undefined && req.body.containerId !== null
    && (typeof req.body.containerId !== "string" || !/^C\d{5,}$/.test(req.body.containerId))) {
    const e = new Error("containerId 必须是有效业务箱号，例如 C00001"); e.status = 400; e.code = "INVALID_CONTAINER_ID"; return next(e);
  }
  let result;
  try { result = await taskRepository.applyEvent(req.params.id, req.body); } catch (error) { return next(error); }
  if (result.error) { const e = new Error(result.error[2]); e.status = result.error[0]; e.code = result.error[1]; return next(e); }
  res.status(result.duplicate ? 200 : 202).json(result.task);
});
