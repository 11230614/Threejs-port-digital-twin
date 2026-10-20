<template>
  <section class="performance-panel" aria-label="渲染性能监控">
    <header>
      <div>
        <span class="eyebrow">RENDER TELEMETRY</span>
        <strong>性能监控</strong>
      </div>
      <b :class="fpsClass">{{ snapshot ? `${snapshot.fps} FPS` : "采样中" }}</b>
    </header>

    <div v-if="snapshot" class="performance-grid">
      <div class="metric">
        <span>帧耗时</span>
        <strong>{{ snapshot.frameMs.average }} ms</strong>
        <small>P95 {{ snapshot.frameMs.p95 }} ms</small>
      </div>
      <div class="metric"><span>QUALITY</span><strong>{{ qualityText }}</strong><small>自适应画质</small></div>
      <div class="metric">
        <span>DRAW CALLS</span>
        <strong>{{ snapshot.render.calls }}</strong>
        <small>{{ snapshot.render.triangles.toLocaleString() }} triangles</small>
      </div>
      <div class="metric">
        <span>CPU 更新</span>
        <strong>{{ snapshot.cpuMs.update }} ms</strong>
        <small>渲染 {{ snapshot.cpuMs.render }} ms</small>
      </div>
      <div class="metric">
        <span>GPU 资源</span>
        <strong>{{ snapshot.memory.geometries }}</strong>
        <small>{{ snapshot.memory.textures }} textures</small>
      </div>
    </div>

    <div v-if="containerMetrics" class="container-strip">
      <span>实例容器</span>
      <strong>{{ containerMetrics.visibleInstances.toLocaleString() }} / {{ containerMetrics.staticContainers.toLocaleString() }}</strong>
      <small>Block {{ containerMetrics.loadedBlocks }} / {{ containerMetrics.totalBlocks }} · {{ containerMetrics.drawBatches }} 批次</small>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { usePerformanceStore } from "../stores/PerformanceStore";

const performanceStore = usePerformanceStore();
const snapshot = computed(() => performanceStore.snapshot);
interface ContainerMetrics { visibleInstances: number; staticContainers: number; loadedBlocks: number; totalBlocks: number; drawBatches: number }
const containerMetrics = computed<ContainerMetrics | null>(() => {
  const value = snapshot.value?.metrics?.containers;
  if (!value || typeof value !== "object") return null;
  const metrics = value as Partial<ContainerMetrics>;
  return typeof metrics.visibleInstances === "number" && typeof metrics.staticContainers === "number" && typeof metrics.loadedBlocks === "number" && typeof metrics.totalBlocks === "number" && typeof metrics.drawBatches === "number"
    ? metrics as ContainerMetrics
    : null;
});
const qualityText = computed(() => {
  const value = snapshot.value?.metrics?.quality;
  return typeof value === "string" ? value.toUpperCase() : "HIGH";
});
const fpsClass = computed(() => {
  const fps = snapshot.value?.fps ?? 0;
  if (fps >= 55) return "fps fps--healthy";
  if (fps >= 35) return "fps fps--warning";
  return "fps fps--critical";
});

</script>

<style scoped>
.performance-panel {
  display: grid;
  gap: 10px;
  padding: 13px;
  overflow: hidden;
  border: 1px solid rgba(81, 242, 166, 0.34);
  border-radius: 6px;
  background:
    linear-gradient(125deg, rgba(12, 52, 52, 0.88), rgba(3, 18, 29, 0.9)),
    repeating-linear-gradient(90deg, rgba(81, 242, 166, 0.05) 0 1px, transparent 1px 7px);
  box-shadow: inset 0 0 28px rgba(49, 247, 255, 0.06);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

header > div {
  display: grid;
  gap: 2px;
}

.eyebrow,
.metric span,
.container-strip span {
  color: rgba(184, 245, 255, 0.58);
  font-family: Consolas, "Courier New", monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
}

header strong {
  color: #ecffff;
  font-size: 14px;
}

.fps {
  min-width: 64px;
  padding: 5px 7px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  text-align: center;
}

.fps--healthy { color: #51f2a6; }
.fps--warning { color: #ffd45c; }
.fps--critical { color: #ff7a7a; }

.performance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.metric {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 7px;
  border-left: 2px solid rgba(49, 247, 255, 0.4);
  background: rgba(0, 10, 20, 0.35);
}

.metric strong,
.container-strip strong {
  color: #ffffff;
  font-family: Consolas, "Courier New", monospace;
  font-size: 15px;
}

.metric small,
.container-strip small {
  min-width: 0;
  color: rgba(184, 245, 255, 0.64);
  font-size: 10px;
  overflow-wrap: anywhere;
}

.container-strip {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 8px;
  align-items: baseline;
  padding-top: 8px;
  border-top: 1px dashed rgba(81, 242, 166, 0.3);
}

.container-strip small {
  grid-column: 1 / -1;
}
</style>
