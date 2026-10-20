// ============================================================================
// RandomTelemetrySource.js —— 随机遥测数据源（TypeScript 权威实现）
//
// 保留原有 mock-websocket / mock-mqtt 数据源行为：数据源按固定间隔为资产
// 生成遥测快照，订阅者只接收数据，不直接修改场景或 Store。
// ============================================================================

import { AssetStatus, FaultStatus, OnlineStatus, type AssetStatusValue, type AssetTypeValue } from "../domain/AssetCatalog";
import { AlarmLevel, TelemetryChannel, TelemetryTopic, type AlarmLevelValue, type TelemetryChannelValue, type TelemetryTopicValue } from "./TelemetryTopics";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import type { AssetManager, RuntimeAsset } from "../assets/AssetManager";
import type { EntityManager } from "../ecs/EntityManager";
import type { MotionComponent } from "../ecs/components/MotionComponent";
import type { ScenePosition, TelemetryState } from "../stores/types";

const TASKS = ["等待调度任务", "执行水平运输", "岸桥装卸联动", "堆场箱位复核", "异常避让与路径重算"] as const;
const CRANE_STATES = ["待命", "小车运行", "吊具下降", "集装箱起升", "装船确认"] as const;
const CONTAINER_STATES = ["等待装船", "正在装船", "卸船入场", "海关查验", "已完成"] as const;

export interface TelemetryMessage extends TelemetryState {
  assetId: string;
  entityId: string | null;
  channel: TelemetryChannelValue;
  topic: TelemetryTopicValue;
  timestamp: number;
  status: AssetStatusValue;
  onlineStatus: "ONLINE" | "OFFLINE";
  faultStatus: "NORMAL" | "WARNING" | "FAULT";
  currentTask: string;
  taskProgress: number;
  speed: number;
  battery: number;
  load: string;
  craneException: boolean;
  containerConflict: boolean;
  alarmLevel: AlarmLevelValue;
  alarmMessage: string;
}

export interface RandomTelemetrySourceOptions {
  assetManager: AssetManager;
  entityManager: EntityManager;
  interval?: number;
  channel?: TelemetryChannelValue;
}

type TelemetryListener = (telemetry: TelemetryMessage) => void;
interface AlarmResult { level: AlarmLevelValue; message: string }
interface AlarmFlags { offline?: boolean; craneException?: boolean; containerConflict?: boolean }
type PreviousTelemetry = Partial<TelemetryMessage>;

export class RandomTelemetrySource {
  private readonly assetManager: AssetManager;
  private readonly entityManager: EntityManager;
  private readonly interval: number;
  private readonly channel: TelemetryChannelValue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<TelemetryListener>();
  private readonly state = new Map<string, PreviousTelemetry>();

  constructor({ assetManager, entityManager, interval = 1000, channel = TelemetryChannel.MOCK_WEBSOCKET }: RandomTelemetrySourceOptions) {
    this.assetManager = assetManager;
    this.entityManager = entityManager;
    this.interval = interval;
    this.channel = channel;
  }

  subscribe(listener: TelemetryListener): () => boolean {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer !== null) return;
    this.publishTick();
    this.timer = globalThis.setInterval(() => this.publishTick(), this.interval);
  }

  stop(): void {
    if (this.timer === null) return;
    globalThis.clearInterval(this.timer);
    this.timer = null;
  }

  private publishTick(): void {
    this.assetManager.getAll().forEach((asset) => {
      const entity = asset.entityId ? this.entityManager.getById(asset.entityId) : undefined;
      const telemetry = this.createTelemetry(asset, entity ?? null);
      this.listeners.forEach((listener) => listener(telemetry));
    });
  }

  private createTelemetry(asset: RuntimeAsset, entity: ReturnType<EntityManager["getById"]> | null): TelemetryMessage {
    const previous = this.state.get(asset.id) ?? {};
    const worldPosition = entity?.getWorldPosition?.() ?? null;
    const offline = Math.random() > 0.992;
    const stalled = asset.type === "AGV" && Math.random() > 0.965;
    const craneException = asset.type === "CRANE" && Math.random() > 0.94;
    const containerConflict = asset.type === "CONTAINER" && Math.random() > 0.945;
    const randomAlarm = this.getAlarm(asset.type, { offline, craneException, containerConflict });
    const progress = this.nextProgress(previous.taskProgress);
    const motion = entity?.getComponent<MotionComponent>(ComponentTypes.MOTION);
    const speed = stalled || offline ? 0 : this.jitter(motion?.speed ?? previous.speed ?? 0, 3, 0, 40);
    const battery = asset.type === "AGV" && Math.random() > 0.96
      ? 12 + Math.random() * 12
      : this.jitter(previous.battery ?? this.initialBattery(asset.id), 1.6, 8, 100);
    const telemetry: TelemetryMessage = {
      assetId: asset.id,
      entityId: asset.entityId ?? null,
      channel: this.channel,
      topic: this.getTopic(asset.type, randomAlarm.level),
      timestamp: Date.now(),
      status: this.getStatus(asset.type, randomAlarm.level, speed),
      onlineStatus: offline ? OnlineStatus.OFFLINE : OnlineStatus.ONLINE,
      faultStatus: randomAlarm.level === AlarmLevel.CRITICAL ? FaultStatus.FAULT : FaultStatus.NORMAL,
      currentTask: this.getTask(asset.type, progress),
      taskProgress: stalled ? previous.taskProgress ?? progress : progress,
      speed,
      battery,
      load: this.getLoad(asset.type),
      position: worldPosition ? this.position(worldPosition) : previous.position ?? null,
      craneWorkState: this.getCraneWorkState(asset.type),
      containerOperationStatus: this.getContainerState(asset.type),
      craneException,
      containerConflict,
      alarmLevel: randomAlarm.level,
      alarmMessage: randomAlarm.message,
    };
    this.state.set(asset.id, telemetry);
    return telemetry;
  }

  private position(worldPosition: { x: number; y: number; z: number }): ScenePosition { return { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z }; }
  private getTopic(type: string, alarmLevel: AlarmLevelValue): TelemetryTopicValue { if (alarmLevel !== AlarmLevel.NORMAL) return TelemetryTopic.DEVICE_ALARM; if (type === "AGV") return TelemetryTopic.AGV_POSITION; if (type === "CRANE") return TelemetryTopic.CRANE_STATUS; if (type === "CONTAINER") return TelemetryTopic.CONTAINER_OPERATION; return TelemetryTopic.TASK_PROGRESS; }
  private getStatus(type: string, alarmLevel: AlarmLevelValue, speed: number): AssetStatusValue { if (alarmLevel === AlarmLevel.CRITICAL || alarmLevel === AlarmLevel.WARNING) return AssetStatus.WARNING; if (type === "AGV") return speed > 0.1 ? AssetStatus.RUNNING : AssetStatus.IDLE; if (type === "CRANE") return Math.random() > 0.35 ? AssetStatus.BUSY : AssetStatus.STANDBY; if (type === "CONTAINER") return Math.random() > 0.45 ? AssetStatus.BUSY : AssetStatus.STANDBY; return Math.random() > 0.2 ? AssetStatus.RUNNING : AssetStatus.STANDBY; }
  private getTask(type: string, progress: number): string { if (type === "AGV") return `${TASKS[1]}，任务进度 ${progress.toFixed(0)}%`; if (type === "CRANE") return `${TASKS[2]}，任务进度 ${progress.toFixed(0)}%`; if (type === "CONTAINER") return `${TASKS[3]}，任务进度 ${progress.toFixed(0)}%`; return `${TASKS[Math.floor(Math.random() * TASKS.length)]}，任务进度 ${progress.toFixed(0)}%`; }
  private getAlarm(type: string, flags: AlarmFlags = {}): AlarmResult { if (flags.offline) return { level: AlarmLevel.CRITICAL, message: "设备通信中断" }; if (flags.craneException) return { level: AlarmLevel.CRITICAL, message: "起重机安全联锁触发" }; if (flags.containerConflict) return { level: AlarmLevel.WARNING, message: "集装箱堆放规则冲突" }; const roll = Math.random(); if (roll > 0.985) return { level: AlarmLevel.CRITICAL, message: type === "AGV" ? "驱动控制器通信中断" : "设备安全联锁触发" }; if (roll > 0.92) return { level: AlarmLevel.WARNING, message: type === "AGV" ? "电量偏低，请调度充电" : "作业节拍偏离计划" }; return { level: AlarmLevel.NORMAL, message: "无告警" }; }
  private getLoad(type: string): string { if (type === "AGV") return Math.random() > 0.38 ? "1 x 40HQ" : "空载"; if (type === "CRANE") return Math.random() > 0.5 ? "吊具带箱" : "吊具空载"; if (type === "CONTAINER") return `${Math.floor(70 + Math.random() * 90)} TEU`; return "--"; }
  private getCraneWorkState(type: string): string | null { return type === "CRANE" ? CRANE_STATES[Math.floor(Math.random() * CRANE_STATES.length)] : null; }
  private getContainerState(type: string): string | null { return type === "CONTAINER" ? CONTAINER_STATES[Math.floor(Math.random() * CONTAINER_STATES.length)] : null; }
  private nextProgress(value = Math.random() * 100): number { return (value + 2 + Math.random() * 8) % 100; }
  private initialBattery(id: string): number { let seed = 0; for (let index = 0; index < id.length; index += 1) seed += id.charCodeAt(index); return 64 + (seed % 28); }
  private jitter(value: number, range: number, min: number, max: number): number { const next = value + (Math.random() - 0.5) * range; return Math.min(max, Math.max(min, next)); }
}
