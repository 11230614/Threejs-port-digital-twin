import { test, expect } from "@playwright/test";

interface ContainerTaskCreated {
  taskId: string;
  taskType: string;
  containerId: string | null;
  beforeStart: {
    owner: string;
    state: string;
    hasStaticBatchBinding: boolean;
    visibleInstances: number | null;
    assetRefCount: number | null;
    activeLeases: number | null;
  } | null;
}

interface ContainerTaskSnapshot {
  requestId: string;
  task: {
    id: string;
    type: string;
    status: string;
    currentStepIndex: number;
    containerId: string | null;
    agvId: string | null;
    routeError: string | null;
  } | null;
  container: {
    id: string;
    assetId: string;
    owner: string;
    state: string;
    location: string;
    taskId: string | null;
    reservedBy: string | null;
    hasStaticBatchBinding: boolean;
    hasEntity: boolean;
    hasTransform: boolean;
    hasRender: boolean;
    hasBusinessComponent: boolean;
    renderModelAttached: boolean;
    wrapperParent: string | null;
    assetRefCount: number | null;
  } | null;
  rendering: { visibleInstances?: number; totalContainers?: number; drawBatches?: number } | null;
  resources: { activeLeases?: number; activeResources?: number; idleResources?: number } | null;
}

interface RuntimeDisposedEvent { canvasPresent: boolean; activeFrameTasks: number }

test("真实 UI 运输任务将静态箱 promote 为 ECS Entity 并继续推进", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const createdEvents: ContainerTaskCreated[] = [];
  const snapshots: ContainerTaskSnapshot[] = [];
  const runtimeReady: boolean[] = [];
  const disposedEvents: RuntimeDisposedEvent[] = [];
  const pageErrors: string[] = [];
  let requestSequence = 0;

  await page.exposeFunction("recordContainerTaskCreated", (event: ContainerTaskCreated) => createdEvents.push(event));
  await page.exposeFunction("recordContainerTaskSnapshot", (event: ContainerTaskSnapshot) => snapshots.push(event));
  await page.exposeFunction("recordContainerRuntimeReady", () => runtimeReady.push(true));
  await page.exposeFunction("recordContainerRuntimeDisposed", (event: RuntimeDisposedEvent) => disposedEvents.push(event));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener("runtime-ready", () => {
      void (window as Window & { recordContainerRuntimeReady?: () => Promise<void> }).recordContainerRuntimeReady?.();
    });
    window.addEventListener("runtime-disposed", (event) => {
      void (window as Window & { recordContainerRuntimeDisposed?: (value: unknown) => Promise<void> })
        .recordContainerRuntimeDisposed?.((event as CustomEvent).detail);
    });
    window.addEventListener("runtime-container-task-created", (event) => {
      void (window as Window & { recordContainerTaskCreated?: (value: unknown) => Promise<void> })
        .recordContainerTaskCreated?.((event as CustomEvent).detail);
    });
    window.addEventListener("runtime-container-task-snapshot", (event) => {
      void (window as Window & { recordContainerTaskSnapshot?: (value: unknown) => Promise<void> })
        .recordContainerTaskSnapshot?.((event as CustomEvent).detail);
    });
  });

  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect.poll(() => page.locator(".task-toolbar button").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.locator("canvas").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => runtimeReady.length, { timeout: 30_000 }).toBe(1);

  // 从用户真实入口创建任务；后端 API、TaskExecutionBridge、TaskSystem 和运行时系统均走生产实现。
  await page.getByRole("button", { name: "运输", exact: true }).click();
  await expect.poll(() => createdEvents.length, { timeout: 30_000 }).toBe(1);
  const created = createdEvents[0];
  expect(created.taskType).toBe("TRANSPORT");
  expect(created.containerId).toBeTruthy();
  expect(created.beforeStart).toMatchObject({ owner: "YARD", state: "YARD", hasStaticBatchBinding: true });
  expect(Number(created.beforeStart?.visibleInstances ?? 0)).toBeGreaterThan(1);

  const requestSnapshot = async (): Promise<ContainerTaskSnapshot> => {
    const requestId = `container-promote-${++requestSequence}`;
    await page.evaluate(({ taskId, requestId: id }) => {
      window.dispatchEvent(new CustomEvent("runtime-test-container-snapshot", { detail: { taskId, requestId: id } }));
    }, { taskId: created.taskId, requestId });
    await expect.poll(() => snapshots.some((snapshot) => snapshot.requestId === requestId), { timeout: 5_000 }).toBe(true);
    return snapshots.find((snapshot) => snapshot.requestId === requestId)!;
  };

  const promoted = await requestSnapshot();
  expect(promoted.task).toMatchObject({ id: created.taskId, type: "TRANSPORT", containerId: created.containerId });
  expect(promoted.container).toMatchObject({
    id: created.containerId,
    owner: "DYNAMIC",
    state: "RELEASED",
    taskId: created.taskId,
    reservedBy: null,
    hasStaticBatchBinding: false,
    hasEntity: true,
    hasTransform: true,
    hasRender: true,
    hasBusinessComponent: true,
    renderModelAttached: true,
    wrapperParent: "scene",
  });
  expect(promoted.task?.status).toBe("RUNNING");
  expect(promoted.rendering?.visibleInstances).toBe(created.beforeStart?.visibleInstances! - 1);
  expect(promoted.container?.assetRefCount).toBe(created.beforeStart?.assetRefCount! + 1);
  expect(Number(promoted.resources?.activeLeases ?? 0)).toBeGreaterThan(0);
  expect(promoted.resources?.activeLeases).toBe(created.beforeStart?.activeLeases);

  // 等待生产运动与 AGV_ARRIVED 事件至少完成取箱阶段，不把 Promote 当作整单完成。
  await expect.poll(async () => (await requestSnapshot()).container?.state, { timeout: 90_000, intervals: [250, 500, 1000] })
    .toMatch(/TRANSPORTING|DELIVERED/);
  const progressed = await requestSnapshot();
  expect(progressed.container?.owner).toBe("DYNAMIC");
  expect(progressed.task?.status).toMatch(/RUNNING|COMPLETED/);
  expect(pageErrors).toEqual([]);

  // 复用既有 DEV 销毁入口，确认 Promote 后也按真实 Runtime 顺序清理画布和帧任务。
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-dispose")));
  await expect.poll(() => disposedEvents.length, { timeout: 10_000 }).toBe(1);
  expect(disposedEvents[0]).toMatchObject({ canvasPresent: false, activeFrameTasks: 0 });
  expect(pageErrors).toEqual([]);
});
