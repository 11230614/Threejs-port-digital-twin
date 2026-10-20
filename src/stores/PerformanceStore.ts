import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { PerformanceSnapshot } from "./types";

export const usePerformanceStore = defineStore("performance", () => {
  const snapshot = shallowRef<PerformanceSnapshot | null>(null);
  const hasSnapshot = computed(() => snapshot.value !== null);

  function update(nextSnapshot: PerformanceSnapshot): void { snapshot.value = nextSnapshot; }
  function reset(): void { snapshot.value = null; }

  return { snapshot, hasSnapshot, update, reset };
});
