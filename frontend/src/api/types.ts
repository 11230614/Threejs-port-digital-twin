export type JsonObject = Record<string, unknown>;

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  [key: string]: unknown;
}

export interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

export interface DatabaseHealthResponse {
  status: "ok" | "error";
  database: "postgresql";
  connected: boolean;
  message?: string;
}

export type DeviceType = "agv" | (string & {});

export interface DeviceProfileDto {
  id: string;
  entityId: string;
  name: string;
  type: DeviceType;
}

export interface DeviceListResponse {
  items: DeviceProfileDto[];
  total: number;
}

export type ContainerState = "YARD" | "RELEASED" | "TRANSPORTING" | "DELIVERED";

export interface ContainerSlot {
  x?: number;
  y?: number;
  z?: number;
  row?: number;
  col?: number;
  layer?: number;
  [key: string]: number | undefined;
}

export interface ContainerSnapshotItem {
  businessId: string;
  entityId?: string | null;
  assetId: string;
  blockId: string;
  area: string;
  slot: ContainerSlot;
  location?: string | null;
}

export interface ContainerDto extends ContainerSnapshotItem {
  databaseId: number | string;
  state: ContainerState;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ContainerListResponse extends PageResponse<ContainerDto> {}

export interface ContainerSyncResponse {
  synchronized: boolean;
  count: number;
  total: number;
  created?: number;
  existing?: number;
}

export type BackendTaskType =
  | "TRANSPORT_CONTAINER"
  | "TRANSPORT"
  | "LOADING"
  | "DISCHARGE"
  | "YARD_TRANSFER"
  | "CHARGING";
export type BackendTaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskParameters extends JsonObject {
  agvId?: string | null;
  agvEntityId?: string | null;
  containerId?: string | null;
}

export interface TaskFailure extends JsonObject {
  code?: string;
  message?: string;
}

export interface TaskDto {
  id: string;
  clientRequestId: string;
  type: BackendTaskType;
  parameters: TaskParameters;
  status: BackendTaskStatus;
  stage: string | null;
  agvId: string | null;
  agvEntityId: string | null;
  containerId?: string | null;
  createdAt: string;
  updatedAt: string;
  failure: TaskFailure | null;
}

export interface CreateTaskRequest {
  clientRequestId: string;
  type: BackendTaskType;
  parameters?: TaskParameters;
}

export interface ExecutionEventRequest extends JsonObject {
  eventId: string;
  sequence: number;
  status: Exclude<BackendTaskStatus, "pending">;
  stage?: string | null;
  agvId?: string | null;
  agvEntityId?: string | null;
  containerId?: string | null;
  failure?: TaskFailure | null;
}

export interface TaskListResponse extends PageResponse<TaskDto> {}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  signal?: AbortSignal;
  body?: BodyInit | JsonObject | null;
}

export interface TaskQuery {
  status?: BackendTaskStatus;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export interface ContainerQuery {
  state?: ContainerState;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}
