<template>
  <main class="app-shell">
    <div ref="container" class="scene-host"></div>
    <aside class="panel-container" aria-label="资产监控面板">
      <div class="backend-status" role="status" aria-live="polite">
        <span :class="['backend-status__indicator', `is-${healthState.status}`]"></span>
        <span>PostgreSQL：{{ healthState.label }}</span>
        <button
          v-if="healthState.status === 'error'"
          type="button"
          class="backend-status__retry"
          @click="checkBackendHealth"
        >
          重试
        </button>
      </div>
      <!-- 资产详情/列表依赖本地 AssetCatalog 的演示业务字段，数据库尚无对应档案表，先不展示。 -->
      <!-- <AssetInfoPanel /> -->
      <DeviceInfoPanel />
      <TaskPanel :create-error="taskCreateError" @create-task="createTask" />
      <AlarmListPanel @locate-asset="locateAsset" />
      <!-- <AssetListPanel /> -->
      <DeviceListPanel @locate-device="locateDevice" />
    </aside>
    <PerformanceDebugPanel />
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import AlarmListPanel from "./components/AlarmListPanel.vue";
import DeviceListPanel from "./components/DeviceListPanel.vue";
import DeviceInfoPanel from "./components/DeviceInfoPanel.vue";
import TaskPanel from "./components/TaskPanel.vue";
import PerformanceDebugPanel from "./components/PerformanceDebugPanel.vue";
import { PortRuntime } from "./app/PortRuntime";
import { usePerformanceStore } from "./stores/PerformanceStore";
import { getDatabaseHealth } from "./api/health";
import type { PerformanceSnapshot } from "./stores/types";
import type { TaskTypeValue } from "./tasks/TaskCatalog";

const container = ref<HTMLElement | null>(null);
let portRuntime: PortRuntime | null = null;
const performanceStore = usePerformanceStore();
const healthState = reactive<{ status: "checking" | "connected" | "error"; label: string }>({ status: "checking", label: "检查中" });
let healthController: AbortController | null = null;
let healthRequestId = 0;
let taskCreateInFlight = false;
const taskCreateError = ref("");

onMounted(async () => {
  void checkBackendHealth();
  const sceneContainer = container.value;
  if (!sceneContainer) return;
  portRuntime = new PortRuntime({
    container: sceneContainer,
    qualityPixelRatio: 0.6, // B 组：保持 high，仅降低渲染分辨率。
    onPerformanceSnapshot: (snapshot: PerformanceSnapshot) => {
      console.log("[PerformanceSnapshot]", snapshot);
      performanceStore.update(snapshot);
    },
  });
  await portRuntime.start();
});

onBeforeUnmount(() => {
  healthRequestId += 1;
  healthController?.abort();
  healthController = null;
  portRuntime?.destroy();
  portRuntime = null;
  performanceStore.reset();
});

async function checkBackendHealth() {
  const requestId = ++healthRequestId;
  healthController?.abort();
  const controller = new AbortController();
  healthController = controller;
  healthState.status = "checking";
  healthState.label = "检查中";

  try {
    await getDatabaseHealth({ signal: controller.signal });
    if (requestId !== healthRequestId) return;
    healthState.status = "connected";
    healthState.label = "已连接";
  } catch (error: unknown) {
    if (requestId !== healthRequestId || (error instanceof DOMException && error.name === "AbortError")) return;
    healthState.status = "error";
    healthState.label = "连接失败";
  } finally {
    if (requestId === healthRequestId) healthController = null;
  }
}

function locateAsset(assetId: string) {
  portRuntime?.focusAsset(assetId);
}

function locateDevice(entityId: string) {
  portRuntime?.focusDeviceEntity(entityId);
}

async function createTask(type: TaskTypeValue) {
  if (taskCreateInFlight || !portRuntime) return;
  taskCreateInFlight = true;
  taskCreateError.value = "";
  try {
    await portRuntime.createTask(type);
  } catch (error: unknown) {
    taskCreateError.value = error instanceof Error ? error.message : "任务创建失败";
  } finally {
    taskCreateInFlight = false;
  }
}
</script>
