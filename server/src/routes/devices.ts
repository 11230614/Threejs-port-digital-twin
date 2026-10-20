import { Router } from "express";
import { deviceRepository, deviceTypes } from "../repositories/deviceRepository.js";

export const devicesRouter = Router();

devicesRouter.get("/", async (req, res, next) => {
  const type = req.query.type;
  if (type !== undefined && (typeof type !== "string" || !deviceTypes.includes(type))) {
    const error = new Error(`type 必须是以下值之一：${deviceTypes.join(", ")}`);
    error.status = 400;
    error.code = "INVALID_DEVICE_TYPE";
    return next(error);
  }

  try {
    const items = await deviceRepository.list({ type });
    return res.status(200).json({ items, total: items.length });
  } catch (error) { return next(error); }
});

devicesRouter.get("/:id", async (req, res, next) => {
  const { id } = req.params;
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id)) {
    const error = new Error("设备编号格式无效");
    error.status = 400;
    error.code = "INVALID_DEVICE_ID";
    return next(error);
  }

  let device;
  try { device = await deviceRepository.findById(id); } catch (error) { return next(error); }
  if (!device) {
    const error = new Error("设备不存在");
    error.status = 404;
    error.code = "DEVICE_NOT_FOUND";
    return next(error);
  }
  return res.status(200).json(device);
});
