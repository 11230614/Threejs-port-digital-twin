import express from "express";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { devicesRouter } from "./routes/devices.js";
import { tasksRouter } from "./routes/tasks.js";
import { databaseRouter } from "./routes/database.js";
import { containersRouter } from "./routes/containers.js";

export function createApp(extraRoutes?: (app: express.Express) => void) {
  const app = express();

  app.disable("x-powered-by"); // ① 安全：隐藏技术栈
  app.use(requestLogger); // ② 日志：最先记录
  app.use(express.json({ limit: "100kb" })); // ③ 解析 body
  app.use("/api", healthRouter); // ④ 健康检查
  app.use("/api", databaseRouter); // ⑤ 数据库状态
  app.use("/api/devices", devicesRouter); // ⑥ 设备路由
  app.use("/api/containers", containersRouter); // 集装箱路由
  app.use("/api/tasks", tasksRouter); // ⑦ 任务路由
  extraRoutes?.(app);
  app.use((req, res, next) => {
    if (req.path === "/api/telemetry/snapshot" && app.locals.telemetryService) {
      return res.json({ items: app.locals.telemetryService.snapshot() });
    }
    // ⑧ 兜底 404
    const error = new Error("接口不存在");
    error.status = 404;
    error.code = "NOT_FOUND";
    next(error);
  });
  app.use(errorHandler); // ⑨ 统一错误处理

  return app;
}
