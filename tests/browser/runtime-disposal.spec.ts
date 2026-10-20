import { test, expect } from "@playwright/test";

interface DiagnosticEvent {
  name: string;
  detail: Record<string, unknown>;
}

test("PortRuntime 真实销毁后停止帧循环并保持幂等", async ({ page, baseURL }) => {
  const events: DiagnosticEvent[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.exposeFunction("recordRuntimeLifecycle", (event: DiagnosticEvent) => events.push(event));
  await page.addInitScript(() => {
    const names = [
      "runtime-ready",
      "runtime-frame",
      "runtime-disposal-started",
      "runtime-disposed",
      "runtime-initialization-failed",
    ];
    for (const name of names) {
      window.addEventListener(name, (event) => {
        void (window as Window & { recordRuntimeLifecycle?: (value: unknown) => Promise<void> })
          .recordRuntimeLifecycle?.({ name, detail: (event as CustomEvent).detail ?? {} });
      });
    }
  });

  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect.poll(() => events.some((event) => event.name === "runtime-ready"), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => events.filter((event) => event.name === "runtime-frame").length, { timeout: 10_000 }).toBeGreaterThan(0);

  const framesBeforeDispose = events.filter((event) => event.name === "runtime-frame").length;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-dispose")));
  await expect.poll(() => events.filter((event) => event.name === "runtime-disposed").length, { timeout: 10_000 }).toBe(1);

  const disposalStarted = events.filter((event) => event.name === "runtime-disposal-started");
  expect(disposalStarted).toHaveLength(1);
  const disposed = events.find((event) => event.name === "runtime-disposed");
  expect(disposed?.detail.canvasPresent).toBe(false);
  expect(Number(disposed?.detail.activeFrameTasks ?? -1)).toBe(0);

  await page.waitForTimeout(250);
  expect(events.filter((event) => event.name === "runtime-frame").length).toBe(framesBeforeDispose);

  // 第二次请求走同一个真实入口，但 destroy 的幂等保护不应重复释放或发事件。
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-dispose")));
  await page.waitForTimeout(100);
  expect(events.filter((event) => event.name === "runtime-disposal-started")).toHaveLength(1);
  expect(events.filter((event) => event.name === "runtime-disposed")).toHaveLength(1);
  expect(events.some((event) => event.name === "runtime-initialization-failed")).toBe(false);
  expect(pageErrors).toEqual([]);
});
