// ============================================================================
// TelemetrySystem.js —— 遥测系统（Telemetry System：接收并应用实时设备数据）
//
// 【这个文件干什么】
// Telemetry（遥测）指设备运行数据，本项目当前默认使用 mock-websocket 随机数据源，
// 并未实现真实 WebSocket。数据源回调只把最新消息写入 pendingTelemetry（待处理缓冲），
// 再由统一帧循环的
// update 一次性应用。Map 以 assetId 为键，同一设备一帧内多条消息会自动合并，
// 避免网络回调直接修改场景造成撕裂。当前项目的数据源仍是 mock-websocket
// 随机模拟源，接口保留了以后接入真实连接的边界。
//
// start 建立订阅后才启动数据源；stop 先退订、停止源并清空缓冲，支持再次启动。
// 遥测数据可只对应资产而不对应场景实体，因此资产 Store 更新不依赖 Entity 存在。
//
// 【术语翻译】
//   Telemetry（遥测）  pending（待处理）  buffer（缓冲）
//   coalescing（合并去重）  subscribe / unsubscribe（订阅 / 取消订阅）
//   lerp / smoothing（插值平滑）
// ============================================================================

import { useAssetStore } from "../../stores/AssetStore";
import { createTelemetrySource } from "../../telemetry/TelemetryGateway.ts";
import type { AssetManager } from "../../assets/AssetManager";
import type { EntityManager } from "../EntityManager";
import { ComponentTypes } from "../components/ComponentTypes";
import { MotionComponent } from "../components/MotionComponent";
import type { TelemetryState } from "../../stores/types";

export interface TelemetryMessage extends TelemetryState { assetId: string; entityId: string | null; }
interface TelemetrySource { subscribe(listener: (telemetry: TelemetryMessage) => void): () => boolean; start(): void; stop(): void }

export interface TelemetrySystemOptions { assetManager: AssetManager; entityManager: EntityManager; mode?: string; interval?: number }

export class TelemetrySystem {
  private readonly assetStore = useAssetStore();
  private readonly entityManager: EntityManager;
  private readonly source: TelemetrySource;
  private unsubscribe: (() => boolean) | null = null;
  private readonly pendingTelemetry = new Map<string, TelemetryMessage>();

  constructor({ assetManager, entityManager, mode = "websocket", interval = 1000 }: TelemetrySystemOptions) {
    this.entityManager = entityManager;
    this.source = createTelemetrySource({ assetManager, entityManager, mode, interval });
  }
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.source.subscribe((telemetry) => this.pendingTelemetry.set(telemetry.assetId, telemetry));
    this.source.start();
  }
  stop(): void { this.unsubscribe?.(); this.unsubscribe = null; this.source.stop(); this.pendingTelemetry.clear(); }
  update(): void { this.pendingTelemetry.forEach((telemetry) => this._applyTelemetry(telemetry)); this.pendingTelemetry.clear(); }
  /**
   * 仅供开发环境诊断使用：把受控输入放入与真实订阅相同的帧缓冲，
   * 后续仍由 TelemetrySystem.update() 在 FrameObserver 中应用到 Store。
   */
  injectForDevelopment(telemetry: TelemetryMessage): void {
    if (!import.meta.env.DEV) return;
    this.pendingTelemetry.set(telemetry.assetId, telemetry);
  }
  private _applyTelemetry(telemetry: TelemetryMessage): void {
    const entity = telemetry.entityId ? this.entityManager.getById(telemetry.entityId) : null;
    const motionValue = entity?.getComponent(ComponentTypes.MOTION);
    if (motionValue instanceof MotionComponent && Number.isFinite(telemetry.speed)) { motionValue.baseSpeed = telemetry.speed as number; motionValue.speed += ((telemetry.speed as number) - motionValue.speed) * 0.2; }
    this.assetStore.updateTelemetry(telemetry.assetId, telemetry);
  }
}
