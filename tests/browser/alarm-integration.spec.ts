import { test, expect } from "@playwright/test";

interface DiagnosticEvent { name: string; detail: Record<string, unknown> }

test("真实 PortRuntime 告警扫描驱动视觉响应并在恢复后关闭", async ({ page, baseURL }) => {
  const events: DiagnosticEvent[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`));
  await page.exposeFunction("recordAlarmDiagnostic", (event: DiagnosticEvent) => events.push(event));
  await page.addInitScript(() => {
    const names = ["runtime-initialization-failed", "runtime-ready", "runtime-frame", "alarm-test-input-applied", "alarm-test-snapshot"];
    for (const name of names) {
      window.addEventListener(name, (event) => {
        const detail = (event as CustomEvent).detail ?? {};
        void (window as Window & { recordAlarmDiagnostic?: (event: DiagnosticEvent) => Promise<void> }).recordAlarmDiagnostic?.({ name, detail });
      });
    }
  });

  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect.poll(() => events.some((event) => event.name === "runtime-ready"), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => events.some((event) => event.name === "runtime-frame"), { timeout: 10_000 }).toBe(true);
  expect(events.some((event) => event.name === "runtime-initialization-failed")).toBe(false);

  const snapshot = async (): Promise<DiagnosticEvent | undefined> => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-alarm-snapshot")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [...events].reverse().find((event) => event.name === "alarm-test-snapshot");
  };

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-alarm", { detail: { action: "raise" } })));
  await expect.poll(() => events.some((event) => event.name === "alarm-test-input-applied" && event.detail.action === "raise"), { timeout: 5_000 }).toBe(true);
  const applied = events.find((event) => event.name === "alarm-test-input-applied" && event.detail.action === "raise");
  const assetId = String(applied?.detail.assetId ?? "");
  const entityId = String(applied?.detail.entityId ?? "");
  expect(assetId).not.toBe("");
  expect(entityId).not.toBe("");

  await expect.poll(async () => {
    const event = await snapshot();
    const alarms = (event?.detail.activeAlarms as Array<Record<string, unknown>> | undefined) ?? [];
    return alarms.some((alarm) => alarm.type === "AGV_LOW_BATTERY" && alarm.assetId === assetId && alarm.status === "ACTIVE");
  }, { timeout: 10_000 }).toBe(true);

  await expect.poll(async () => {
    const event = await snapshot();
    const visual = event?.detail.visual as { updates?: number; visualizedEntityIds?: string[]; visualizedSeverities?: string[] } | null | undefined;
    return Boolean(visual?.updates && visual.visualizedEntityIds?.includes(entityId) && visual.visualizedSeverities?.includes("SEVERE"));
  }, { timeout: 5_000 }).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-alarm", { detail: { action: "clear" } })));
  await expect.poll(() => events.some((event) => event.name === "alarm-test-input-applied" && event.detail.action === "clear"), { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => {
    const event = await snapshot();
    const alarms = (event?.detail.alarms as Array<Record<string, unknown>> | undefined) ?? [];
    const alarm = alarms.find((item) => item.type === "AGV_LOW_BATTERY" && item.assetId === assetId);
    const visual = event?.detail.visual as { visualizedEntityIds?: string[] } | null | undefined;
    return alarm?.status === "CLOSED" && alarm?.closedAt !== null && !visual?.visualizedEntityIds?.includes(entityId);
  }, { timeout: 10_000 }).toBe(true);

  expect(pageErrors).toEqual([]);
  expect(failedRequests.filter((entry) => entry.includes("/api/")).length).toBe(0);
});
