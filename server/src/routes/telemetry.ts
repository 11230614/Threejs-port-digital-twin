import { Router } from "express";
import type { TelemetryService } from "../telemetry/TelemetryService.js";
export function telemetryRouter(service: TelemetryService) { const router = Router(); router.get("/telemetry/snapshot", (_req, res) => res.json({ items: service.snapshot() })); return router; }
