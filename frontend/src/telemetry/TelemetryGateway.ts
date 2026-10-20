import { RandomTelemetrySource, type RandomTelemetrySourceOptions } from "./RandomTelemetrySource";
import { TelemetryChannel, type TelemetryChannelValue } from "./TelemetryTopics";

export interface TelemetrySourceOptions extends RandomTelemetrySourceOptions {
  mode?: string;
}

class WebSocketTelemetrySource {
  private socket: WebSocket | null = null; private stopped = true; private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(value: any) => void>(); private latest = new Map<string, number>();
  constructor(private readonly reconnectMs = 1000) { }
  subscribe(listener: (value: any) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.socket?.close(); this.socket = null; }
  private connect() { 
    console.log(
  "Telemetry WebSocket URL:",
  import.meta.env.VITE_TELEMETRY_WS_URL,
);
    if (this.stopped) return; const protocol = location.protocol === "https:" ? "wss" : "ws"; const url = import.meta.env.VITE_TELEMETRY_WS_URL || `${protocol}://${location.host}/ws/telemetry`; this.socket = new WebSocket(url); this.socket.onmessage = (event) => { try { const message = JSON.parse(event.data); if (message?.type !== "agv.telemetry") return; const old = this.latest.get(message.data.agvId) ?? 0; if (message.sequence <= old) return; this.latest.set(message.data.agvId, message.sequence); this.listeners.forEach((listener) => listener({ assetId: message.data.agvId, entityId: message.data.entityId, channel: "websocket", topic: "port/agv/position", timestamp: message.timestamp, position: message.data.position, speed: message.data.speed })); } catch { /* ignore malformed frames */ } }; this.socket.onclose = () => { this.socket = null; if (!this.stopped) this.timer = setTimeout(() => this.connect(), this.reconnectMs); }; }
}

export function createTelemetrySource(options: TelemetrySourceOptions): RandomTelemetrySource | WebSocketTelemetrySource {
  const mode = options.mode ?? "mock-websocket";
  if (mode === "websocket") return new WebSocketTelemetrySource();
  return new RandomTelemetrySource({
    ...options,
    channel: mode === "mock-mqtt" ? TelemetryChannel.MOCK_MQTT : TelemetryChannel.MOCK_WEBSOCKET,
  });
}

export function normalizeIncomingTelemetry<T = unknown>(message: string | T): T {
  return typeof message === "string" ? JSON.parse(message) as T : message;
}

export type { TelemetryChannelValue };
