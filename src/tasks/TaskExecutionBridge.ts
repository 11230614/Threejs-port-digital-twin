import { createTask, getTask, postExecutionEvent } from "../api/tasks";
import type { BackendTaskStatus, ExecutionEventRequest, TaskDto } from "../api/types";
import type { TaskPatch, TaskState } from "../stores/types";
import type { TaskTypeValue } from "./TaskCatalog";

interface TaskExecutionBridgePatch extends TaskPatch {
  serverTaskId?: string;
  clientRequestId?: string;
  serverStatus?: BackendTaskStatus;
  serverStage?: string | null;
  serverTaskUpdatedAt?: string;
}

interface TaskExecutionStore {
  taskMap: Map<string, TaskState>;
  patchTask(id: string, patch: TaskExecutionBridgePatch): void;
}

interface TaskExecutionBridgeOptions {
  taskStore: TaskExecutionStore;
  createLocal(type: TaskTypeValue): TaskState | null;
}

interface TaskMapping {
  localTaskId: string;
  sequence: number;
  last: string;
}

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function getBackendStatus(status: TaskState["status"]): BackendTaskStatus {
  if (status === "WAITING") return "pending";
  if (status === "RUNNING") return "running";
  if (status === "COMPLETED") return "completed";
  return "failed";
}

export class TaskExecutionBridge {
  private readonly taskStore: TaskExecutionStore;
  private readonly createLocal: TaskExecutionBridgeOptions["createLocal"];
  private readonly mappings = new Map<string, TaskMapping>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private queryTimer: ReturnType<typeof setInterval> | null = null;
  private queryInFlight = false;
  private lifecycleVersion = 0;

  constructor({ taskStore, createLocal }: TaskExecutionBridgeOptions) {
    this.taskStore = taskStore;
    this.createLocal = createLocal;
  }

  start(): void {
    this.timer ??= setInterval(() => this.flush(), 250);
    this.queryTimer ??= setInterval(() => void this.query(), 1000);
  }

  async createAndStart(type: TaskTypeValue): Promise<string> {
    const clientRequestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const serverTask: TaskDto = await createTask({
      clientRequestId,
      type,
      parameters: {},
    });
    const existingMapping = this.mappings.get(serverTask.id);
    if (existingMapping) return existingMapping.localTaskId;

    let localTask: TaskState | null;
    try {
      localTask = this.createLocal(type);
    } catch (error: unknown) {
      await postExecutionEvent(serverTask.id, {
        eventId: `${serverTask.id}-1`,
        sequence: 1,
        status: "failed",
        stage: "startup",
        failure: { code: "LOCAL_START_FAILED", message: getErrorMessage(error) },
      });
      throw error;
    }

    if (!localTask) {
      await postExecutionEvent(serverTask.id, {
        eventId: `${serverTask.id}-1`,
        sequence: 1,
        status: "failed",
        stage: "startup",
        failure: { code: "LOCAL_START_FAILED", message: "本地任务执行器未就绪" },
      });
      throw new Error("本地任务执行器未就绪");
    }

    this.taskStore.patchTask(localTask.id, { serverTaskId: serverTask.id, clientRequestId });
    this.mappings.set(serverTask.id, { localTaskId: localTask.id, sequence: 0, last: "" });
    return localTask.id;
  }

  flush(): void {
    for (const [serverId, mapping] of this.mappings) {
      const task = this.taskStore.taskMap.get(mapping.localTaskId);
      if (!task) continue;

      const status = getBackendStatus(task.status);
      const stage = task.steps[task.currentStepIndex] ?? "completed";
      const key = `${status}|${stage}|${task.agvId ?? ""}|${task.agvEntityId ?? ""}|${task.containerId ?? ""}|${task.routeError ?? ""}`;
      if (key === mapping.last || status === "pending") continue;

      mapping.last = key;
      mapping.sequence += 1;
      const event: ExecutionEventRequest = {
        eventId: `${serverId}-${mapping.sequence}`,
        sequence: mapping.sequence,
        status,
        stage,
        agvId: task.agvId,
        agvEntityId: task.agvEntityId,
        containerId: task.containerId ?? null,
        ...(status === "failed"
          ? { failure: { code: "LOCAL_EXECUTION_PAUSED", message: task.routeError ?? "本地执行暂停" } }
          : {}),
      };
      postExecutionEvent(serverId, event).catch(() => {
        mapping.sequence -= 1;
        mapping.last = "";
      });
    }
  }

  async query(): Promise<void> {
    if (this.queryInFlight) return;
    this.queryInFlight = true;
    const lifecycleVersion = this.lifecycleVersion;
    try {
      for (const [serverId, mapping] of this.mappings) {
        const serverTask: TaskDto = await getTask(serverId);
        if (lifecycleVersion !== this.lifecycleVersion) return;
        this.taskStore.patchTask(mapping.localTaskId, {
          serverStatus: serverTask.status,
          serverStage: serverTask.stage,
          serverTaskUpdatedAt: serverTask.updatedAt,
        });
        if (serverTask.status === "completed" || serverTask.status === "failed") {
          this.mappings.delete(serverId);
        }
      }
    } catch { /* event retry remains authoritative */ }
    finally {
      if (lifecycleVersion === this.lifecycleVersion) this.queryInFlight = false;
    }
  }

  stop(): void {
    this.lifecycleVersion += 1;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.queryTimer !== null) clearInterval(this.queryTimer);
    this.timer = null;
    this.queryTimer = null;
    this.queryInFlight = false;
  }
}
