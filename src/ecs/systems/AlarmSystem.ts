// ============================================================================
// AlarmSystem.js —— 报警系统（Alarm System：把遥测数据变成可操作的告警）
//
// 【这个文件干什么】
// 遥测系统只负责把数据搬进仓库，本系统负责判断“这些数字意味着出事了吗”。
// 每帧扫描所有资产，逐项做规则判断，命中就 raise（抬起报警），恢复正常就
// clear（清除报警）。界面上的告警数据来自 AlarmStore。
//
// 【六条规则】
//   1) 设备离线      任何资产   无遥测 / 状态离线 / 数据超过 5 秒没更新
//   2) 车辆低电量    仅 AGV     电量 ≤ 25%（≤ 15% 升级为严重）
//   3) 车辆卡滞      仅 AGV     速度 < 0.6 且任务进度不动，持续 3 秒以上
//   4) 道路拥堵      道路资产   低速车 ≥ 3 台或平均车速 < 12
//   5) 起重机异常    仅吊机     异常标志 / 告警等级为警告或危急
//   6) 箱位冲突      仅集装箱   堆放冲突标志
//
// 每条规则都同时处理异常和恢复；卡滞规则通过 stalledState 记录资产 ID 对应的
// 起始时间与进度，避免将正常等待误报为故障。AlarmStore 是告警状态的唯一所有者。
// ============================================================================

import { AlarmSeverity, AlarmType, type AlarmSeverityValue, type AlarmTypeValue } from "../../domain/AlarmCatalog";
import { AssetType, OnlineStatus } from "../../domain/AssetCatalog";
import { AlarmLevel } from "../../telemetry/TelemetryTopics";
import { useAlarmStore } from "../../stores/AlarmStore";
import { useAssetStore } from "../../stores/AssetStore";
import type { AssetManager } from "../../assets/AssetManager";
import type { EntityManager } from "../EntityManager";
import type { AssetState, TelemetryState } from "../../stores/types";

interface StalledState { since: number | null; lastProgress: number }
type AlarmTelemetry = TelemetryState | null;
type AlarmStore = ReturnType<typeof useAlarmStore>;
type AssetStore = ReturnType<typeof useAssetStore>;

export interface AlarmSystemOptions {
  assetManager: Pick<AssetManager, "getAll">;
  entityManager: EntityManager;
}

interface AlarmRaiseInput {
  type: AlarmTypeValue;
  severity: AlarmSeverityValue;
  asset: AssetState;
  telemetry: AlarmTelemetry;
  message: string;
  suggestion: string;
}

export class AlarmSystem {
  assetManager: Pick<AssetManager, "getAll">;
  entityManager: EntityManager;
  assetStore: AssetStore;
  alarmStore: AlarmStore;
  stalledState = new Map<string, StalledState>();

  constructor({ assetManager, entityManager }: AlarmSystemOptions) {
    this.assetManager = assetManager;
    this.entityManager = entityManager;
    this.assetStore = useAssetStore();
    this.alarmStore = useAlarmStore();
  }

  update(): void {
    this._scanAssets();
    this._scanPathCongestion();
  }

  _scanAssets(): void {
    const now = Date.now();
    const assets = this.assetManager.getAll();
    const currentAssetIds = new Set(assets.map((asset) => asset.id));
    assets.forEach((asset) => {
      const telemetry = this.assetStore.getTelemetryByAssetId(asset.id);
      this._checkOffline(asset, telemetry, now);
      this._checkAgvBattery(asset, telemetry);
      this._checkAgvStalled(asset, telemetry, now);
      this._checkCraneException(asset, telemetry);
      this._checkContainerConflict(asset, telemetry);
    });
    // 资产卸载后清除其防抖计时，避免相同业务 ID 重新出现时继承旧计时窗口。
    this.stalledState.forEach((_state, assetId) => {
      if (!currentAssetIds.has(assetId)) this.stalledState.delete(assetId);
    });
  }

  _checkOffline(asset: AssetState, telemetry: AlarmTelemetry, now: number): void {
    if (!telemetry) {
      this.alarmStore.clearAutoAlarm(AlarmType.DEVICE_OFFLINE, asset.id, "当前没有遥测数据，设备状态未知；已清除旧的自动离线判断");
      return;
    }
    const isOffline = telemetry.onlineStatus === OnlineStatus.OFFLINE || now - Number(telemetry.timestamp) > 5000;
    if (!isOffline) { this.alarmStore.clearAutoAlarm(AlarmType.DEVICE_OFFLINE, asset.id); return; }
    this._raise({ type: AlarmType.DEVICE_OFFLINE, severity: AlarmSeverity.URGENT, asset, telemetry, message: `${asset.number} 数据中断或设备离线`, suggestion: "立即核对通信链路、电源状态与现场安全状态" });
  }

  _checkAgvBattery(asset: AssetState, telemetry: AlarmTelemetry): void {
    if (asset.type !== AssetType.AGV || !telemetry?.battery) return;
    if (telemetry.battery > 25) { this.alarmStore.clearAutoAlarm(AlarmType.AGV_LOW_BATTERY, asset.id); return; }
    this._raise({ type: AlarmType.AGV_LOW_BATTERY, severity: telemetry.battery <= 15 ? AlarmSeverity.SEVERE : AlarmSeverity.WARNING, asset, telemetry, message: `${asset.number} 电量 ${telemetry.battery.toFixed(0)}%，低于调度安全阈值`, suggestion: "派发就近充电任务或切换备用车辆" });
  }

  _checkAgvStalled(asset: AssetState, telemetry: AlarmTelemetry, now: number): void {
    if (asset.type !== AssetType.AGV || !telemetry) return;
    const progress = telemetry.taskProgress ?? 0;
    const state = this.stalledState.get(asset.id) ?? { since: null, lastProgress: progress };
    const progressDelta = Math.abs(progress - state.lastProgress);
    const isStalled = (telemetry.speed ?? 0) < 0.6 && progressDelta < 0.5;
    if (!isStalled) {
      this.stalledState.set(asset.id, { since: null, lastProgress: progress });
      this.alarmStore.clearAutoAlarm(AlarmType.AGV_STALLED, asset.id);
      return;
    }
    const since = state.since ?? now;
    this.stalledState.set(asset.id, { since, lastProgress: telemetry.taskProgress ?? state.lastProgress });
    if (now - since < 3000) return;
    this._raise({ type: AlarmType.AGV_STALLED, severity: AlarmSeverity.SEVERE, asset, telemetry, message: `${asset.number} 速度持续低于 0.6 m/s，任务进度无变化`, suggestion: "检查道路占用、避障状态与车辆驱动系统" });
  }

  _scanPathCongestion(): void {
    const assets = this.assetManager.getAll();
    const agvTelemetry = assets.filter((asset) => asset.type === AssetType.AGV)
      .map((asset) => this.assetStore.getTelemetryByAssetId(asset.id))
      .filter((item): item is TelemetryState => item !== null);
    const roadAsset = assets.find((asset) => asset.type === AssetType.ROAD);
    if (!roadAsset) return;
    if (agvTelemetry.length === 0) {
      this.alarmStore.clearAutoAlarm(AlarmType.PATH_CONGESTION, roadAsset.id, "当前没有 AGV 遥测数据，无法判断道路拥堵；已清除旧的自动判断");
      return;
    }
    const slowCount = agvTelemetry.filter((item) => (item.speed ?? 0) < 8).length;
    const averageSpeed = agvTelemetry.reduce((sum, item) => sum + (item.speed ?? 0), 0) / Math.max(agvTelemetry.length, 1);
    if (slowCount < 3 && averageSpeed >= 12) { this.alarmStore.clearAutoAlarm(AlarmType.PATH_CONGESTION, roadAsset.id); return; }
    this._raise({ type: AlarmType.PATH_CONGESTION, severity: slowCount >= 4 ? AlarmSeverity.SEVERE : AlarmSeverity.WARNING, asset: roadAsset, telemetry: this.assetStore.getTelemetryByAssetId(roadAsset.id), message: `主通行道路拥堵，低速 AGV ${slowCount} 台，平均速度 ${averageSpeed.toFixed(1)} m/s`, suggestion: "启用绕行策略，暂停低优先级运输任务" });
  }

  _checkCraneException(asset: AssetState, telemetry: AlarmTelemetry): void {
    if (asset.type !== AssetType.CRANE || !telemetry) return;
    const hasException = telemetry.craneException || telemetry.alarmLevel === AlarmLevel.CRITICAL || telemetry.alarmLevel === AlarmLevel.WARNING;
    if (!hasException) { this.alarmStore.clearAutoAlarm(AlarmType.CRANE_EXCEPTION, asset.id); return; }
    this._raise({ type: AlarmType.CRANE_EXCEPTION, severity: telemetry.alarmLevel === AlarmLevel.CRITICAL ? AlarmSeverity.URGENT : AlarmSeverity.SEVERE, asset, telemetry, message: `${asset.number} ${telemetry.alarmMessage || "起重机作业异常"}`, suggestion: "暂停相关作业面，核对吊具、联锁与风速安全条件" });
  }

  _checkContainerConflict(asset: AssetState, telemetry: AlarmTelemetry): void {
    if (asset.type !== AssetType.CONTAINER || !telemetry?.containerConflict) {
      this.alarmStore.clearAutoAlarm(AlarmType.CONTAINER_STACK_CONFLICT, asset.id);
      return;
    }
    this._raise({ type: AlarmType.CONTAINER_STACK_CONFLICT, severity: AlarmSeverity.SEVERE, asset, telemetry, message: `${asset.number} 检测到箱位重叠或堆放规则冲突`, suggestion: "冻结相关箱位，重新计算堆场计划并派发复核" });
  }

  _raise({ type, severity, asset, telemetry, message, suggestion }: AlarmRaiseInput): void {
    this.alarmStore.upsertAlarm({ type, severity, assetId: asset.id, assetNumber: asset.number, assetType: asset.type, area: asset.area, entityId: asset.entityId, message, suggestion, position: telemetry?.position ?? null });
  }
}
