import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { deviceRepository } from "../repositories/deviceRepository.js";

export interface TelemetryMessage { type: "agv.telemetry"; version: 1; sequence: number; timestamp: number; data: { agvId: string; entityId: string; position: { x: number; y: number; z: number }; speed: number } }

// Coordinates mirror the front-end AGV_LOOP_01 activity area (world units/metres).
// The simulator deliberately uses a closed perimeter instead of an unbounded X axis.
const TRACK = [
  { x: -500, z: -10 }, { x: -500, z: -470 }, { x: 500, z: -470 },
  { x: 500, z: -10 }, { x: 500, z: 10 }, { x: -500, z: 10 },
] as const;
const TRACK_Y = 0.12;
const SPEED = 8;
const segmentLengths = TRACK.map((point, index) => {
  const next = TRACK[(index + 1) % TRACK.length];
  return Math.hypot(next.x - point.x, next.z - point.z);
});
const TRACK_LENGTH = segmentLengths.reduce((sum, length) => sum + length, 0);

function trackPosition(distance: number): { x: number; y: number; z: number } {
  let remaining = ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  for (let index = 0; index < TRACK.length; index += 1) {
    const start = TRACK[index]; const end = TRACK[(index + 1) % TRACK.length]; const length = segmentLengths[index];
    if (remaining <= length) { const ratio = length === 0 ? 0 : remaining / length; return { x: start.x + (end.x - start.x) * ratio, y: TRACK_Y, z: start.z + (end.z - start.z) * ratio }; }
    remaining -= length;
  }
  return { x: TRACK[0].x, y: TRACK_Y, z: TRACK[0].z };
}

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
  private async publish(): Promise<void> { const devices = await deviceRepository.list({ type: "agv" }); const now = Date.now(); for (const [index, device] of devices.entries()) { const previous = this.snapshots.get(device.id); const distance = this.tick * SPEED * this.interval / 1000 + (index / Math.max(devices.length, 1)) * TRACK_LENGTH; const position = trackPosition(distance); const message: TelemetryMessage = { type: "agv.telemetry", version: 1, sequence: (previous?.sequence ?? 0) + 1, timestamp: now, data: { agvId: device.id, entityId: device.entityId, position, speed: SPEED } }; this.snapshots.set(device.id, message); this.clients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); }); } this.tick += 1; }
}
