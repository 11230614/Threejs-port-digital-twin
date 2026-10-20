import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { deviceRepository } from "../repositories/deviceRepository.js";

export interface TelemetryMessage { type: "agv.telemetry"; version: 1; sequence: number; timestamp: number; data: { agvId: string; entityId: string; position: { x: number; y: number; z: number }; speed: number } }
export class TelemetryService {
  private readonly wss: WebSocketServer; private readonly clients = new Set<WebSocket>(); private readonly snapshots = new Map<string, TelemetryMessage>(); private timer: ReturnType<typeof setInterval> | null = null; private tick = 0;
  constructor(server: HttpServer, private readonly enabled = process.env.TELEMETRY_SIMULATOR === "true", private readonly interval = Number(process.env.TELEMETRY_INTERVAL_MS || 500)) {
    this.wss = new WebSocketServer({ server, path: "/ws/telemetry" });
    this.wss.on("connection", (socket) => { this.clients.add(socket); socket.on("close", () => this.clients.delete(socket)); socket.on("error", () => this.clients.delete(socket)); for (const message of this.snapshots.values()) socket.send(JSON.stringify(message)); });
    if (this.enabled) this.start();
  }
  start(): void { if (this.timer) return; this.timer = setInterval(() => void this.publish(), this.interval); }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; for (const client of this.clients) client.close(); this.clients.clear(); this.wss.close(); }
  snapshot(): TelemetryMessage[] { return [...this.snapshots.values()]; }
  private async publish(): Promise<void> { const devices = await deviceRepository.list({ type: "agv" }); const now = Date.now(); for (const [index, device] of devices.entries()) { const previous = this.snapshots.get(device.id); const position = previous?.data.position ?? { x: index * 18, y: 0.5, z: 0 }; const speed = 4 + ((this.tick + index) % 5); const message: TelemetryMessage = { type: "agv.telemetry", version: 1, sequence: (previous?.sequence ?? 0) + 1, timestamp: now, data: { agvId: device.id, entityId: device.entityId, position: { x: position.x + speed * this.interval / 1000, y: position.y, z: position.z }, speed } }; this.snapshots.set(device.id, message); this.clients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); }); } this.tick += 1; }
}
