import { expect, test } from "@playwright/test";

interface RuntimeFailureResult {
  caughtMessage: string;
  failureMessage: string;
  cleanupMessage: string;
  injected: boolean;
  runtimeDestroyed: boolean;
  runtimeStarted: boolean;
  groundInstanceRetained: boolean;
  groundRefsReset: boolean;
  sentinelPreserved: boolean;
  noGroundObjects: boolean;
  canvasRemoved: boolean;
  frameTasks: number;
  frameListeners: number;
  disposeCounts: number[];
  disposeEachOnce: boolean;
  groundOnlyNames: string[];
}

test("真实 PortRuntime 在 GroundSystem 部分创建失败时保留原始错误并完成统一清理", async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${baseURL ?? "http://127.0.0.1:5173"}/tests/browser/ground-runtime-failure-harness.html`);
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { runGroundRuntimeFailure?: unknown }).runGroundRuntimeFailure === "function")).toBe(true);
  const result = await page.evaluate(() => (window as Window & { runGroundRuntimeFailure: () => Promise<RuntimeFailureResult> }).runGroundRuntimeFailure());

  const fullCleanup = result.fullCleanup;
  const secondaryError = result.secondaryError;
  expect(fullCleanup.injected, JSON.stringify(fullCleanup)).toBe(true);
  expect(fullCleanup.caughtMessage).toBe(result.failureMessage);
  expect(fullCleanup.runtimeDestroyed).toBe(true);
  expect(fullCleanup.runtimeStarted).toBe(false);
  expect(fullCleanup.groundInstanceRetained).toBe(true);
  expect(fullCleanup.groundRefsReset).toBe(true);
  expect(fullCleanup.sentinelPreserved).toBe(true);
  expect(fullCleanup.noGroundObjects).toBe(true);
  expect(fullCleanup.canvasRemoved).toBe(true);
  expect(fullCleanup.frameTasks).toBe(0);
  expect(fullCleanup.frameListeners).toBe(0);
  expect(fullCleanup.disposeEachOnce).toBe(true);
  expect(secondaryError.injected).toBe(true);
  expect(secondaryError.caughtMessage).toBe(result.failureMessage);
  expect(secondaryError.caughtMessage).not.toBe(result.cleanupMessage);
  expect(secondaryError.runtimeDestroyed).toBe(true);
  expect(secondaryError.groundRefsReset).toBe(true);
  expect(secondaryError.sentinelPreserved).toBe(true);
  expect(secondaryError.disposeEachOnce).toBe(true);
  expect(consoleErrors.some((message) => message.includes(result.cleanupMessage))).toBe(true);
  expect(pageErrors).toEqual([]);
});
