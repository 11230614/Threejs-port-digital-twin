import { Router } from "express";
import { containerRepository } from "../repositories/containerRepository.js";

export const containersRouter = Router();

containersRouter.post("/sync", async (req, res, next) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 10000) {
    const error = new Error("items 必须是最多 10000 项的数组");
    error.status = 400;
    error.code = "INVALID_CONTAINER_SNAPSHOT";
    return next(error);
  }
  const ids = new Set();
  const entityIds = new Set();
  for (const item of items) {
    const valid = item && typeof item === "object"
      && typeof item.businessId === "string" && /^C\d{5,}$/.test(item.businessId)
      && (item.entityId === null || item.entityId === undefined || typeof item.entityId === "string")
      && typeof item.assetId === "string" && item.assetId.length <= 64
      && typeof item.blockId === "string" && item.blockId.length <= 64
      && typeof item.area === "string" && item.area.length <= 128
      && item.slot && typeof item.slot === "object" && !Array.isArray(item.slot)
      && ["x", "y", "z", "row", "col", "layer"].every((key) => item.slot[key] === undefined || Number.isFinite(item.slot[key]))
      && (item.location === null || item.location === undefined || typeof item.location === "string");
    if (!valid) {
      const error = new Error("容器快照字段无效；只接受纯业务数据和数值箱位/坐标");
      error.status = 400;
      error.code = "INVALID_CONTAINER_SNAPSHOT_ITEM";
      return next(error);
    }
    if (ids.has(item.businessId)) {
      const error = new Error(`快照包含重复 businessId：${item.businessId}`);
      error.status = 400;
      error.code = "DUPLICATE_CONTAINER_BUSINESS_ID";
      return next(error);
    }
    ids.add(item.businessId);
    if (item.entityId) {
      if (entityIds.has(item.entityId)) {
        const error = new Error(`快照包含重复 entityId：${item.entityId}`);
        error.status = 400;
        error.code = "DUPLICATE_CONTAINER_ENTITY_ID";
        return next(error);
      }
      entityIds.add(item.entityId);
    }
  }
  try {
    const cleanItems = items.map(({ businessId, entityId = null, assetId, blockId, area, slot, location = null }) => ({ businessId, entityId, assetId, blockId, area, slot, location }));
    const result = await containerRepository.synchronizeSceneSnapshot(cleanItems);
    return res.status(200).json({ ...result, total: items.length });
  } catch (error) { return next(error); }
});

containersRouter.get("/", async (req, res, next) => {
  const state = req.query.state;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 50);
  if ((state !== undefined && !["YARD", "RELEASED", "TRANSPORTING", "DELIVERED"].includes(state))
    || !Number.isInteger(page) || page < 1
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    const error = new Error("state、page 或 pageSize 参数无效");
    error.status = 400;
    error.code = "INVALID_CONTAINER_QUERY";
    return next(error);
  }
  try {
    const result = await containerRepository.list({ state, page, pageSize });
    return res.status(200).json({ ...result, page, pageSize });
  } catch (error) { return next(error); }
});

containersRouter.get("/by-database-id/:databaseId", async (req, res, next) => {
  const databaseId = req.params.databaseId;
  if (!/^[1-9]\d*$/.test(databaseId)) {
    const error = new Error("databaseId 必须是正整数");
    error.status = 400;
    error.code = "INVALID_CONTAINER_DATABASE_ID";
    return next(error);
  }
  try {
    const container = await containerRepository.findByDatabaseId(databaseId);
    if (!container) {
      const error = new Error("集装箱不存在");
      error.status = 404;
      error.code = "CONTAINER_NOT_FOUND";
      return next(error);
    }
    return res.status(200).json(container);
  } catch (error) { return next(error); }
});

containersRouter.get("/:businessId", async (req, res, next) => {
  const { businessId } = req.params;
  if (!/^C\d{5,}$/.test(businessId)) {
    const error = new Error("业务箱号格式无效，例如 C00001");
    error.status = 400;
    error.code = "INVALID_CONTAINER_BUSINESS_ID";
    return next(error);
  }
  try {
    const container = await containerRepository.findByBusinessId(businessId);
    if (!container) {
      const error = new Error("集装箱不存在");
      error.status = 404;
      error.code = "CONTAINER_NOT_FOUND";
      return next(error);
    }
    return res.status(200).json(container);
  } catch (error) { return next(error); }
});
