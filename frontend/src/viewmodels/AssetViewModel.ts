import {
  ASSET_STATUS_LABELS,
  ASSET_TYPE_LABELS,
  AssetStatus,
  FAULT_STATUS_LABELS,
  FaultStatus,
  MAINTENANCE_STATUS_LABELS,
  MaintenanceStatus,
  ONLINE_STATUS_LABELS,
  OnlineStatus,
} from "../domain/AssetCatalog";
import { ALARM_LEVEL_LABELS, AlarmLevel, type AlarmLevelValue } from "../telemetry/TelemetryTopics";
import type { AlarmState, AssetState, SceneEntity, TelemetryState } from "../stores/types";

export interface ActiveAlarmViewModel extends AlarmState {
  typeLabel: string;
  severityLabel: string;
  statusLabel: string;
  severityClass: string;
}

export interface AssetViewModelData {
  id: string;
  number?: string;
  type: string;
  typeLabel: string;
  area?: string;
  status?: string;
  statusText: string;
  onlineStatus?: string;
  onlineText: string;
  faultStatus?: string;
  faultText: string;
  maintenanceStatus?: string;
  maintenanceText: string;
  currentTask?: string | null;
  ownerTeam?: string;
  lastHeartbeat?: string | null;
  nextMaintenance?: string | null;
  metrics?: Record<string, unknown>;
  channel?: string;
  topic?: string;
  battery?: number | null;
  load?: string | number | null;
  taskProgress?: number | null;
  alarmLevel?: AlarmLevelValue;
  alarmText?: string;
  alarmMessage?: string;
  activeAlarm?: ActiveAlarmViewModel | null;
  activeAlarmText?: string;
  activeAlarmStatusText?: string;
  craneWorkState?: string | null;
  containerOperationStatus?: string | null;
  updatedAt?: number | string | null;
  speed?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  positionZ?: number | null;
  progress?: number | null;
  isSelected?: boolean;
  hasSceneEntity?: boolean;
}

export interface AssetViewModelOptions {
  entity?: SceneEntity | null;
  telemetry?: TelemetryState | null;
  activeAlarm?: ActiveAlarmViewModel | null;
  selectedAssetId?: string | null;
}

const label = (labels: Record<string, string>, value: string | undefined): string =>
  (value && labels[value]) ?? value ?? "";

export class AssetViewModel {
  readonly id: string;
  readonly number?: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly area?: string;
  readonly status?: string;
  readonly statusText: string;
  readonly onlineStatus?: string;
  readonly onlineText: string;
  readonly faultStatus?: string;
  readonly faultText: string;
  readonly maintenanceStatus?: string;
  readonly maintenanceText: string;
  readonly currentTask?: string | null;
  readonly ownerTeam?: string;
  readonly lastHeartbeat?: string | null;
  readonly nextMaintenance?: string | null;
  readonly metrics: Record<string, unknown>;
  readonly channel: string;
  readonly topic: string;
  readonly battery: number | null;
  readonly load: string | number | null;
  readonly taskProgress: number | null;
  readonly alarmLevel: AlarmLevelValue;
  readonly alarmText: string;
  readonly alarmMessage: string;
  readonly activeAlarm: ActiveAlarmViewModel | null;
  readonly activeAlarmText: string;
  readonly activeAlarmStatusText: string;
  readonly hasActiveAlarm: boolean;
  readonly craneWorkState: string | null;
  readonly containerOperationStatus: string | null;
  readonly updatedAt: number | string | null;
  readonly speed: number | null;
  readonly positionX: number | null;
  readonly positionY: number | null;
  readonly positionZ: number | null;
  readonly progress: number | null;
  readonly isSelected: boolean;
  readonly hasSceneEntity: boolean;

  constructor(data: AssetViewModelData) {
    this.id = data.id;
    this.number = data.number;
    this.type = data.type;
    this.typeLabel = data.typeLabel;
    this.area = data.area;
    this.status = data.status;
    this.statusText = data.statusText;
    this.onlineStatus = data.onlineStatus;
    this.onlineText = data.onlineText;
    this.faultStatus = data.faultStatus;
    this.faultText = data.faultText;
    this.maintenanceStatus = data.maintenanceStatus;
    this.maintenanceText = data.maintenanceText;
    this.currentTask = data.currentTask;
    this.ownerTeam = data.ownerTeam;
    this.lastHeartbeat = data.lastHeartbeat;
    this.nextMaintenance = data.nextMaintenance;
    this.metrics = data.metrics ?? {};
    this.channel = data.channel ?? "--";
    this.topic = data.topic ?? "--";
    this.battery = data.battery ?? null;
    this.load = data.load ?? "--";
    this.taskProgress = data.taskProgress ?? null;
    this.alarmLevel = data.alarmLevel ?? AlarmLevel.NORMAL;
    this.alarmText = data.alarmText ?? "正常";
    this.alarmMessage = data.alarmMessage ?? "无告警";
    this.activeAlarm = data.activeAlarm ?? null;
    this.activeAlarmText = data.activeAlarmText ?? "无闭环告警";
    this.activeAlarmStatusText = data.activeAlarmStatusText ?? "--";
    this.hasActiveAlarm = Boolean(this.activeAlarm);
    this.craneWorkState = data.craneWorkState ?? null;
    this.containerOperationStatus = data.containerOperationStatus ?? null;
    this.updatedAt = data.updatedAt ?? null;
    this.speed = data.speed ?? null;
    this.positionX = data.positionX ?? null;
    this.positionY = data.positionY ?? null;
    this.positionZ = data.positionZ ?? null;
    this.progress = data.progress ?? null;
    this.isSelected = data.isSelected ?? false;
    this.hasSceneEntity = data.hasSceneEntity ?? false;
  }

  get speedFormatted(): string { return this.speed === null ? "--" : `${this.speed.toFixed(1)} m/s`; }
  get positionFormatted(): string {
    if (this.positionX === null || this.positionY === null || this.positionZ === null) return "--";
    return `${this.positionX.toFixed(1)}, ${this.positionY.toFixed(1)}, ${this.positionZ.toFixed(1)}`;
  }
  get progressFormatted(): string { return this.progress === null ? "--" : `${this.progress.toFixed(1)}%`; }
  get batteryFormatted(): string { return this.battery === null ? "--" : `${this.battery.toFixed(0)}%`; }
  get taskProgressFormatted(): string { return this.taskProgress === null ? "--" : `${this.taskProgress.toFixed(0)}%`; }
  get updatedAtFormatted(): string {
    if (!this.updatedAt) return "--";
    return new Date(this.updatedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  get alarmClass(): string {
    if (this.activeAlarm?.severityClass) return this.activeAlarm.severityClass;
    if (this.alarmLevel === AlarmLevel.CRITICAL) return "status--danger";
    if (this.alarmLevel === AlarmLevel.WARNING) return "status--standby";
    return "status--running";
  }
  get selectedClass(): string { return this.isSelected ? "asset-card--selected" : ""; }
  get statusClass(): string {
    if (this.status === AssetStatus.WARNING || this.faultStatus === FaultStatus.FAULT) return "status--danger";
    if (this.status === AssetStatus.MAINTENANCE || this.maintenanceStatus === MaintenanceStatus.IN_PROGRESS) return "status--maintenance";
    if (this.status === AssetStatus.STANDBY || this.status === AssetStatus.IDLE || this.maintenanceStatus === MaintenanceStatus.DUE_SOON) return "status--standby";
    return "status--running";
  }
  get onlineClass(): string { return this.onlineStatus === OnlineStatus.ONLINE ? "status--running" : "status--danger"; }
  get faultClass(): string {
    if (this.faultStatus === FaultStatus.FAULT) return "status--danger";
    if (this.faultStatus === FaultStatus.WARNING) return "status--standby";
    return "status--running";
  }
  get maintenanceClass(): string {
    if (this.maintenanceStatus === MaintenanceStatus.IN_PROGRESS) return "status--maintenance";
    if (this.maintenanceStatus === MaintenanceStatus.DUE_SOON) return "status--standby";
    return "status--running";
  }

  static fromAsset(asset: AssetState, options: AssetViewModelOptions = {}): AssetViewModel {
    const entity = options.entity ?? null;
    const telemetry = options.telemetry ?? {};
    const activeAlarm = options.activeAlarm ?? null;
    const selectedAssetId = options.selectedAssetId ?? null;
    const worldPosition = entity?.getWorldPosition?.() ?? null;
    const motion = entity?.motion ?? {};
    const progress = typeof motion.progress === "number" && Number.isFinite(motion.progress)
      ? motion.progress * 100
      : null;
    const status = telemetry.status ?? asset.status;
    const onlineStatus = telemetry.onlineStatus ?? asset.onlineStatus;
    const faultStatus = telemetry.faultStatus ?? asset.faultStatus;
    const alarmLevel = isAlarmLevel(telemetry.alarmLevel) ? telemetry.alarmLevel : AlarmLevel.NORMAL;
    const currentTask = typeof telemetry.currentTask === "string"
      ? telemetry.currentTask
      : asset.currentTask;

    return new AssetViewModel({
      id: asset.id,
      number: asset.number,
      type: asset.type,
      typeLabel: label(ASSET_TYPE_LABELS, asset.type),
      area: asset.area,
      status,
      statusText: label(ASSET_STATUS_LABELS, status),
      onlineStatus,
      onlineText: label(ONLINE_STATUS_LABELS, onlineStatus),
      faultStatus,
      faultText: label(FAULT_STATUS_LABELS, faultStatus),
      maintenanceStatus: asset.maintenanceStatus,
      maintenanceText: label(MAINTENANCE_STATUS_LABELS, asset.maintenanceStatus),
      currentTask,
      ownerTeam: asset.ownerTeam,
      lastHeartbeat: asset.lastHeartbeat,
      nextMaintenance: asset.nextMaintenance,
      metrics: asset.metrics,
      channel: telemetry.channel,
      topic: telemetry.topic,
      battery: telemetry.battery ?? null,
      load: telemetry.load ?? "--",
      taskProgress: telemetry.taskProgress ?? null,
      alarmLevel,
      alarmText: activeAlarm ? activeAlarm.severityLabel : label(ALARM_LEVEL_LABELS, alarmLevel),
      alarmMessage: activeAlarm?.message ?? telemetry.alarmMessage ?? "无告警",
      activeAlarm,
      activeAlarmText: activeAlarm ? `${activeAlarm.severityLabel} / ${activeAlarm.typeLabel}` : "无闭环告警",
      activeAlarmStatusText: activeAlarm?.statusLabel ?? "--",
      craneWorkState: telemetry.craneWorkState ?? null,
      containerOperationStatus: telemetry.containerOperationStatus ?? null,
      updatedAt: telemetry.timestamp ?? null,
      speed: telemetry.speed ?? motion.speed ?? null,
      positionX: telemetry.position?.x ?? worldPosition?.x ?? null,
      positionY: telemetry.position?.y ?? worldPosition?.y ?? null,
      positionZ: telemetry.position?.z ?? worldPosition?.z ?? null,
      progress,
      isSelected: asset.id === selectedAssetId,
      hasSceneEntity: Boolean(asset.entityId),
    });
  }
}

function isAlarmLevel(value: unknown): value is AlarmLevelValue {
  return value === AlarmLevel.NORMAL || value === AlarmLevel.INFO || value === AlarmLevel.WARNING || value === AlarmLevel.CRITICAL;
}
