import type { SceneEntity } from "../stores/types";

export interface DeviceViewModelData {
  id: string;
  type?: string | null;
  typeLabel: string;
  speed?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  positionZ?: number | null;
  progress?: number | null;
  isSelected?: boolean;
  isWarning?: boolean;
}

export class DeviceViewModel {
  readonly id: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly speed: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly progress: number | null;
  readonly isSelected: boolean;
  readonly isWarning: boolean;

  constructor(data: DeviceViewModelData) {
    this.id = data.id;
    this.type = data.type ?? "";
    this.typeLabel = data.typeLabel;
    this.speed = data.speed ?? 0;
    this.positionX = data.positionX ?? 0;
    this.positionY = data.positionY ?? 0;
    this.positionZ = data.positionZ ?? 0;
    this.progress = data.progress ?? null;
    this.isSelected = data.isSelected ?? false;
    this.isWarning = data.isWarning ?? false;
  }

  get speedFormatted(): string {
    return this.type === "AGV" ? `${this.speed.toFixed(1)} m/s` : "--";
  }

  get positionFormatted(): string {
    return `${this.positionX.toFixed(1)}, ${this.positionY.toFixed(1)}, ${this.positionZ.toFixed(1)}`;
  }

  get progressFormatted(): string {
    return this.progress === null ? "--" : `${this.progress.toFixed(1)}%`;
  }

  get selectedClass(): string {
    return this.isSelected ? "device-card--selected" : "";
  }

  get statusClass(): string {
    if (this.isWarning) return "status--warning";
    if (this.type !== "AGV") return "status--standby";
    if (this.speed < 0.1) return "status--idle";
    return "status--running";
  }

  get statusText(): string {
    if (this.isWarning) return "告警";
    if (this.type !== "AGV") return "待命";
    if (this.speed < 0.1) return "停止";
    return "运行中";
  }

  static fromEntity(entity: SceneEntity): DeviceViewModel {
    const worldPosition = entity.getWorldPosition();
    const motion = entity.motion ?? {};
    const selectable = entity.selectable ?? {};
    const progress = typeof motion.progress === "number" && Number.isFinite(motion.progress)
      ? motion.progress * 100
      : null;

    return new DeviceViewModel({
      id: entity.id,
      type: entity.type,
      typeLabel: DeviceViewModel.getTypeLabel(entity.type),
      speed: motion.speed ?? 0,
      positionX: worldPosition?.x,
      positionY: worldPosition?.y,
      positionZ: worldPosition?.z,
      progress,
      isSelected: selectable.isSelected ?? false,
      isWarning: selectable.isWarning ?? false,
    });
  }

  static getTypeLabel(type?: string | null): string {
    const labels: Readonly<Record<string, string>> = {
      AGV: "自动导引车",
      CRANE: "岸桥",
    };
    return (type && labels[type]) ?? type ?? "";
  }
}
