import type { AlarmSeverityValue, AlarmStatusValue, AlarmTypeValue } from "../domain/AlarmCatalog";
import type { TaskStatusValue, TaskTypeValue } from "../tasks/TaskCatalog";
import type * as THREE from "three";

export interface ScenePosition { x: number; y: number; z: number }
export interface TaskLocation { area: string; slot?: string }
export interface TaskDestination { area: string; position: ScenePosition }
export interface SceneEntity {
  id: string;
  type?: string | null;
  asset?: AssetState | null;
  motion?: { speed?: number; progress?: number } | null;
  selectable?: { isSelected?: boolean; isWarning?: boolean } | null;
  getWorldPosition: () => THREE.Vector3 | null;
}

export interface DeviceProfileState {
  id: string;
  entityId: string;
  name: string;
  type: string;
}

export interface AssetState {
  id: string;
  number?: string;
  type: string;
  area?: string;
  status?: string;
  onlineStatus?: string;
  faultStatus?: string;
  maintenanceStatus?: string;
  currentTask?: string | null;
  ownerTeam?: string;
  lastHeartbeat?: string | null;
  nextMaintenance?: string | null;
  metrics?: Record<string, unknown>;
  entityId?: string | null;
  [key: string]: unknown;
}

export interface TelemetryState {
  status?: string;
  onlineStatus?: string;
  faultStatus?: string;
  channel?: string;
  topic?: string;
  battery?: number | null;
  load?: string | number | null;
  taskProgress?: number | null;
  alarmLevel?: string;
  alarmMessage?: string;
  craneWorkState?: string | null;
  containerOperationStatus?: string | null;
  timestamp?: number | string | null;
  speed?: number | null;
  position?: ScenePosition | null;
  [key: string]: unknown;
}

export interface AlarmState {
  id: string;
  type: AlarmTypeValue;
  severity: AlarmSeverityValue;
  status: AlarmStatusValue;
  assetId: string;
  entityId?: string | null;
  message?: string;
  createdAt: number;
  updatedAt: number;
  acknowledgedAt?: number | null;
  dispatchedAt?: number | null;
  closedAt?: number | null;
  note: string;
  assignee: string;
  assetNumber?: string;
  area?: string;
  suggestion?: string;
  [key: string]: unknown;
}

export interface AlarmInput {
  id?: string;
  type: AlarmTypeValue;
  severity: AlarmSeverityValue;
  assetId: string;
  entityId?: string | null;
  message?: string;
  [key: string]: unknown;
}

export interface TaskState {
  id: string;
  type: TaskTypeValue;
  status: TaskStatusValue;
  steps: readonly string[];
  currentStepIndex: number;
  updatedAt: number;
  createdAt?: number;
  from: TaskLocation;
  to: TaskDestination;
  containerId?: string | null;
  rtgId?: string | null;
  agvId?: string | null;
  agvEntityId?: string | null;
  craneId?: string | null;
  routeError?: string | null;
  agvParkingPosition?: ScenePosition;
  agvParkingLaneId?: string;
  quayCraneState?: string;
  [key: string]: unknown;
}

export interface TaskPatch { [key: string]: unknown }

export interface PerformanceSnapshot {
  timestamp: string;
  fps: number;
  frameMs: { average: number; p95: number; max: number };
  cpuMs: { update: number; render: number };
  render: { calls: number; triangles: number; lines: number; points: number };
  memory: { geometries: number; textures: number };
  display?: { width: number; height: number; pixelRatio: number };
  metrics: Record<string, unknown>;
}
