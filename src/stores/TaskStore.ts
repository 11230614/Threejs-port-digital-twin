import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS, TaskStatus } from "../tasks/TaskCatalog";
import type { TaskPatch, TaskState } from "./types";

export const useTaskStore = defineStore("task", () => {
  const taskMap = shallowRef<Map<string, TaskState>>(new Map());
  const selectedTaskId = ref<string | null>(null);
  const frameVersion = ref(0);

  const tasks = computed(() => {
    frameVersion.value;
    return Array.from(taskMap.value.values()).map(toViewModel);
  });
  const activeTasks = computed(() => tasks.value.filter((task) => task.status !== TaskStatus.COMPLETED));
  const selectedTask = computed(() => {
    frameVersion.value;
    const task = selectedTaskId.value ? taskMap.value.get(selectedTaskId.value) : null;
    return task ? toViewModel(task) : null;
  });

  function registerTask(task: TaskState): void {
    const nextMap = new Map(taskMap.value); nextMap.set(task.id, task); taskMap.value = nextMap;
    if (!selectedTaskId.value) selectedTaskId.value = task.id;
    frameVersion.value += 1;
  }
  function patchTask(id: string, patch: TaskPatch): void {
    const task = taskMap.value.get(id); if (!task) return;
    const nextMap = new Map(taskMap.value);
    nextMap.set(id, { ...task, ...patch, updatedAt: Date.now() });
    taskMap.value = nextMap; frameVersion.value += 1;
  }
  function selectTask(id: string | null): void {
    selectedTaskId.value = id && taskMap.value.has(id) ? id : null; frameVersion.value += 1;
  }
  return { taskMap, selectedTaskId, frameVersion, tasks, activeTasks, selectedTask, registerTask, patchTask, selectTask };
});

function toViewModel(task: TaskState) {
  const progress = task.steps.length <= 1 ? 100 : (task.currentStepIndex / (task.steps.length - 1)) * 100;
  return {
    ...task,
    typeLabel: TASK_TYPE_LABELS[task.type] ?? task.type,
    statusLabel: TASK_STATUS_LABELS[task.status] ?? task.status,
    progress,
    progressText: `${Math.min(100, progress).toFixed(0)}%`,
    currentStep: task.steps[task.currentStepIndex] ?? "完成",
    equipmentText: [task.rtgId ? `RTG ${task.rtgId}` : null, task.agvId ? `AGV ${task.agvId}` : null, task.craneId ? `岸桥 ${task.craneId}` : null].filter(Boolean).join(" / "),
  };
}
