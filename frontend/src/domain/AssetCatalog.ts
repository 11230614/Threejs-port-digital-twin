import type { AssetState } from "../stores/types";

export const AssetType = Object.freeze({
  AGV: "AGV",
  CRANE: "CRANE",
  YARD: "YARD",
  CONTAINER: "CONTAINER",
  ROAD: "ROAD",
  BERTH: "BERTH",
} as const);
export type AssetTypeValue = typeof AssetType[keyof typeof AssetType];

export const AssetStatus = Object.freeze({
  RUNNING: "RUNNING",
  STANDBY: "STANDBY",
  BUSY: "BUSY",
  IDLE: "IDLE",
  WARNING: "WARNING",
  MAINTENANCE: "MAINTENANCE",
} as const);
export type AssetStatusValue = typeof AssetStatus[keyof typeof AssetStatus];

export const OnlineStatus = Object.freeze({ ONLINE: "ONLINE", OFFLINE: "OFFLINE" } as const);
export type OnlineStatusValue = typeof OnlineStatus[keyof typeof OnlineStatus];

export const FaultStatus = Object.freeze({ NORMAL: "NORMAL", WARNING: "WARNING", FAULT: "FAULT" } as const);
export type FaultStatusValue = typeof FaultStatus[keyof typeof FaultStatus];

export const MaintenanceStatus = Object.freeze({ NORMAL: "NORMAL", DUE_SOON: "DUE_SOON", IN_PROGRESS: "IN_PROGRESS" } as const);
export type MaintenanceStatusValue = typeof MaintenanceStatus[keyof typeof MaintenanceStatus];

export const ASSET_TYPE_LABELS: Readonly<Record<AssetTypeValue, string>> = Object.freeze({
  [AssetType.AGV]: "AGV 自动导引车",
  [AssetType.CRANE]: "岸桥起重机",
  [AssetType.YARD]: "堆场区域",
  [AssetType.CONTAINER]: "集装箱资产",
  [AssetType.ROAD]: "道路设施",
  [AssetType.BERTH]: "泊位设施",
});
export const ASSET_STATUS_LABELS: Readonly<Record<AssetStatusValue, string>> = Object.freeze({
  [AssetStatus.RUNNING]: "运行中",
  [AssetStatus.STANDBY]: "待命",
  [AssetStatus.BUSY]: "作业中",
  [AssetStatus.IDLE]: "空闲",
  [AssetStatus.WARNING]: "告警",
  [AssetStatus.MAINTENANCE]: "维护中",
});
export const ONLINE_STATUS_LABELS: Readonly<Record<OnlineStatusValue, string>> = Object.freeze({
  [OnlineStatus.ONLINE]: "在线",
  [OnlineStatus.OFFLINE]: "离线",
});
export const FAULT_STATUS_LABELS: Readonly<Record<FaultStatusValue, string>> = Object.freeze({
  [FaultStatus.NORMAL]: "无故障",
  [FaultStatus.WARNING]: "轻微告警",
  [FaultStatus.FAULT]: "故障停用",
});
export const MAINTENANCE_STATUS_LABELS: Readonly<Record<MaintenanceStatusValue, string>> = Object.freeze({
  [MaintenanceStatus.NORMAL]: "正常",
  [MaintenanceStatus.DUE_SOON]: "即将保养",
  [MaintenanceStatus.IN_PROGRESS]: "保养中",
});

export interface AssetCatalogRecord extends AssetState {
  entityId: string | null;
  id: string;
  number: string;
  type: AssetTypeValue;
  area: string;
  status: AssetStatusValue;
  onlineStatus: OnlineStatusValue;
  faultStatus: FaultStatusValue;
  maintenanceStatus: MaintenanceStatusValue;
  currentTask?: string;
  ownerTeam: string;
  lastHeartbeat: string;
  nextMaintenance: string;
  metrics: Record<string, unknown>;
}

type AssetCatalogInput = {
  id: string;
  number: string;
  type: AssetTypeValue;
  area: string;
  status: AssetStatusValue;
  onlineStatus: OnlineStatusValue;
  faultStatus: FaultStatusValue;
  maintenanceStatus: MaintenanceStatusValue;
  currentTask?: string;
  ownerTeam: string;
  lastHeartbeat: string;
  nextMaintenance: string;
  metrics: Record<string, unknown>;
};

interface YardAssetSource { count: number }

export function createAGVAsset(index: number): AssetCatalogRecord {
  const number = `AGV-${String(index + 1).padStart(2, "0")}`;
  const tasks = [
    "A 区 12 贝位 -> 1# 泊位",
    "空箱回收 -> C 区缓存位",
    "2# 岸桥下交接 -> B 区",
    "D 区重箱 -> 查验通道",
    "等待 TOS 新任务派发",
  ];
  return createAsset({
    id: number, number, type: AssetType.AGV,
    area: index % 2 === 0 ? "水平运输区 / 北环线" : "水平运输区 / 南环线",
    status: index === 4 ? AssetStatus.IDLE : AssetStatus.RUNNING,
    onlineStatus: OnlineStatus.ONLINE,
    faultStatus: FaultStatus.NORMAL,
    maintenanceStatus: index === 2 ? MaintenanceStatus.DUE_SOON : MaintenanceStatus.NORMAL,
    currentTask: tasks[index],
    ownerTeam: "自动化运输班组", lastHeartbeat: "10 秒前", nextMaintenance: index === 2 ? "今日 22:30" : "7 天后",
    metrics: { 电量: `${92 - index * 7}%`, 载荷: index === 4 ? "空载" : "1 x 40HQ", 调度优先级: index === 1 ? "高" : "普通" },
  });
}

export function createCraneAsset(index: number): AssetCatalogRecord {
  const number = `QC-${String(index + 1).padStart(2, "0")}`;
  return createAsset({
    id: number, number, type: AssetType.CRANE, area: `${index + 1}# 泊位前沿`,
    status: index === 1 ? AssetStatus.BUSY : AssetStatus.STANDBY,
    onlineStatus: OnlineStatus.ONLINE, faultStatus: FaultStatus.NORMAL,
    maintenanceStatus: index === 0 ? MaintenanceStatus.DUE_SOON : MaintenanceStatus.NORMAL,
    currentTask: index === 1 ? "执行船舶 BAY 18 装卸作业" : "等待下一条作业指令",
    ownerTeam: "岸桥作业班组", lastHeartbeat: "5 秒前", nextMaintenance: index === 0 ? "明日 02:00" : "12 天后",
    metrics: { 吊具: "40 英尺双箱吊具", 小车状态: index === 1 ? "往复作业" : "停靠安全位", 风速: `${7 + index} m/s` },
  });
}

export function createYardAsset(yard: YardAssetSource, index: number): AssetCatalogRecord {
  return createAsset({
    id: `YARD-${String.fromCharCode(65 + index)}`, number: `${String.fromCharCode(65 + index)} 区堆场`, type: AssetType.YARD,
    area: `堆场 ${String.fromCharCode(65 + index)} 区`, status: index === 2 ? AssetStatus.BUSY : AssetStatus.RUNNING,
    onlineStatus: OnlineStatus.ONLINE, faultStatus: FaultStatus.NORMAL, maintenanceStatus: MaintenanceStatus.NORMAL,
    currentTask: "堆存容量监控与箱位分配", ownerTeam: "堆场计划组", lastHeartbeat: "30 秒前", nextMaintenance: "15 天后",
    metrics: { 容量: yard.count, 占用率: `${72 + index * 4}%`, 冷藏箱位: `${8 + index * 3} 个` },
  });
}

export function createContainerAsset(yard: YardAssetSource, index: number): AssetCatalogRecord {
  return createAsset({
    id: `CNTR-BLOCK-${String.fromCharCode(65 + index)}`, number: `${String.fromCharCode(65 + index)} 区集装箱组`, type: AssetType.CONTAINER,
    area: `堆场 ${String.fromCharCode(65 + index)} 区`, status: AssetStatus.STANDBY,
    onlineStatus: OnlineStatus.ONLINE, faultStatus: FaultStatus.NORMAL, maintenanceStatus: MaintenanceStatus.NORMAL,
    currentTask: "等待装船/提箱计划匹配", ownerTeam: "箱务管理组", lastHeartbeat: "1 分钟前", nextMaintenance: "按箱况抽检",
    metrics: { 账面箱量: yard.count, 重箱比例: `${58 + index * 5}%`, 危险品箱: `${index + 1} 个` },
  });
}

export function createRoadAsset(): AssetCatalogRecord {
  return createAsset({
    id: "ROAD-RING-01", number: "港区环形道路 01", type: AssetType.ROAD, area: "AGV 主通行道路",
    status: AssetStatus.RUNNING, onlineStatus: OnlineStatus.ONLINE, faultStatus: FaultStatus.NORMAL, maintenanceStatus: MaintenanceStatus.NORMAL,
    currentTask: "交通流量监控与避让策略执行", ownerTeam: "道路设施组", lastHeartbeat: "15 秒前", nextMaintenance: "30 天后",
    metrics: { 车道: "双向 2 车道", 通行密度: "中", 限速: "35 m/s" },
  });
}

export function createBerthAsset(): AssetCatalogRecord {
  return createAsset({
    id: "BERTH-01", number: "1# 自动化泊位", type: AssetType.BERTH, area: "码头前沿水域",
    status: AssetStatus.BUSY, onlineStatus: OnlineStatus.ONLINE, faultStatus: FaultStatus.NORMAL, maintenanceStatus: MaintenanceStatus.NORMAL,
    currentTask: "靠泊作业与岸桥联动监控", ownerTeam: "泊位调度组", lastHeartbeat: "20 秒前", nextMaintenance: "21 天后",
    metrics: { 长度: "880 m", 水深: "17.5 m", 船舶: "MSC ORION" },
  });
}

export function createAsset(data: AssetCatalogInput): AssetCatalogRecord {
  const record: AssetCatalogRecord = { entityId: null, ...data };
  return record;
}
