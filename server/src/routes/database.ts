import { Router } from "express";
import { checkDatabaseConnection } from "../db/pool.js";

export const databaseRouter = Router();

databaseRouter.get("/db/health", async (_req, res) => {
  const result = await checkDatabaseConnection();
  if (!result.connected) {
    return res.status(503).json({ status: "error", database: "postgresql", connected: false, message: result.message });
  }
  return res.status(200).json({ status: "ok", database: "postgresql", connected: true });
});
