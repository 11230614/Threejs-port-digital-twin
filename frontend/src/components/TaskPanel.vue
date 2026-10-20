<template>
  <section class="task-panel">
    <header class="panel-header">
      <span>作业任务</span>
      <strong>{{ loadState !== 'loaded' && tasks.length === 0 ? '--' : taskTotal }}</strong>
    </header>

    <div v-if="loadState === 'loading' && tasks.length === 0" class="task-message">正在从数据库加载任务…</div>
    <div v-else-if="loadState === 'error' && tasks.length === 0" class="task-message">
      数据库任务读取失败：{{ loadError }}
      <button type="button" @click="loadTasks">重试</button>
    </div>

    <div class="task-toolbar">
      <button type="button" @click="emit('create-task', TaskType.TRANSPORT)">运输</button>
      <button type="button" @click="emit('create-task', TaskType.LOADING)">装船</button>
      <button type="button" @click="emit('create-task', TaskType.DISCHARGE)">卸船</button>
      <button type="button" @click="emit('create-task', TaskType.YARD_TRANSFER)">转运</button>
    </div>
    <p v-if="createError" class="task-message">创建任务失败：{{ createError }}</p>

    <div class="task-list">
      <article
        v-for="task in tasks"
        :key="task.id"
        :class="['task-card', `task-card--${task.status}`]"
      >
        <header>
          <div>
            <strong>{{ typeLabels[task.type] ?? task.type }}</strong>
            <small>{{ task.id }} · PostgreSQL</small>
          </div>
          <span>{{ statusLabels[task.status] ?? task.status }}</span>
        </header>

        <div class="task-current">
          <span>执行阶段：{{ task.stage || "--" }}</span>
          <strong>{{ task.agvId ?? "尚未分配 AGV" }}</strong>
        </div>
        <small>创建于 {{ formatTime(task.createdAt) }}</small>
      </article>
      <p v-if="loadState === 'loaded' && tasks.length === 0" class="task-message">数据库中暂无运输任务。点击上方按钮创建任务。</p>
      <p v-if="loadState === 'error' && tasks.length > 0" class="task-message">数据库暂时不可用，显示的是上次读取的记录。<button type="button" @click="loadTasks">重试</button></p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { TaskType } from "../tasks/TaskCatalog";
import type { BackendTaskType, BackendTaskStatus, TaskDto } from "../api/types";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getTasks } from "../api/tasks";

defineProps<{ createError?: string }>();
const emit = defineEmits<{ (event: "create-task", type: BackendTaskType): void }>();
const tasks = ref<TaskDto[]>([]);
const taskTotal = ref(0);
const loadState = ref<"loading" | "loaded" | "error">("loading");
const loadError = ref("");
let controller: AbortController | null = null;
let requestVersion = 0;
let pollTimer: number | null = null;
let inFlight = false;

const typeLabels: Record<BackendTaskType, string> = {
  TRANSPORT_CONTAINER: "集装箱运输",
  TRANSPORT: "运输任务",
  LOADING: "装船任务",
  DISCHARGE: "卸船任务",
  YARD_TRANSFER: "堆场转运",
  CHARGING: "充电任务",
};
const statusLabels: Record<BackendTaskStatus, string> = { pending: "等待执行", running: "执行中", completed: "已完成", failed: "执行失败" };

onMounted(() => {
  void loadTasks();
  pollTimer = window.setInterval(() => void loadTasks(), 2000);
});

onBeforeUnmount(() => {
  requestVersion += 1;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  controller?.abort();
});

async function loadTasks() {
  if (inFlight) return;
  inFlight = true;
  const version = ++requestVersion;
  controller?.abort();
  controller = new AbortController();
  try {
    const result = await getTasks({ page: 1, pageSize: 50, signal: controller.signal });
    if (version !== requestVersion) return;
    tasks.value = result.items;
    taskTotal.value = result.total;
    loadState.value = "loaded";
    loadError.value = "";
  } catch (error: unknown) {
    if (version !== requestVersion || (error instanceof DOMException && error.name === "AbortError")) return;
    loadState.value = "error";
    loadError.value = error instanceof Error ? error.message : "未知错误";
  } finally {
    if (version === requestVersion) {
      controller = null;
      inFlight = false;
    }
  }
}

function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
</script>

<style scoped>
.task-panel {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(118, 210, 255, 0.26);
  border-radius: 6px;
  background: rgba(7, 22, 34, 0.74);
}

.panel-header,
.task-card header,
.task-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-header {
  color: rgba(184, 245, 255, 0.74);
  font-size: 12px;
}

.panel-header strong {
  color: #ffffff;
  font-size: 16px;
}

.task-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.task-toolbar button,
.task-card button {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(63, 216, 255, 0.28);
  border-radius: 4px;
  color: #d8fbff;
  background: rgba(40, 180, 220, 0.16);
  cursor: pointer;
}

.task-card button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.task-list {
  display: grid;
  gap: 8px;
}

.task-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(63, 216, 255, 0.18);
  border-radius: 6px;
  background: rgba(0, 12, 24, 0.45);
  cursor: pointer;
}

.task-card--running {
  border-color: rgba(81, 242, 166, 0.55);
}

.task-card--completed {
  opacity: 0.62;
}

.task-card--failed {
  border-color: rgba(255, 122, 122, 0.55);
}

.task-card strong,
.task-card small,
.task-card span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-card header strong {
  display: block;
  color: #ffffff;
  font-size: 14px;
}

.task-card header small,
.task-card header span,
.task-current {
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
}

.task-message {
  margin: 0;
  color: rgba(184, 245, 255, 0.68);
  font-size: 12px;
  line-height: 1.6;
}
</style>
