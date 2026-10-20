import { test, expect } from "@playwright/test";

test("loads the real Vite page and reports runtime/API diagnostics", async ({ page, baseURL }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`));

  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("智慧码头数字孪生");
  await expect(page.locator("#app")).toBeVisible();

  await page.waitForTimeout(2_000);
  const rendering = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    return {
      canvasCount: canvases.length,
      webglContexts: canvases.filter((canvas) => Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"))).length,
    };
  });
  test.info().annotations.push({ type: "rendering-observation", description: JSON.stringify(rendering) });
  const diagnostics = { consoleErrors, pageErrors, failedRequests };
  test.info().annotations.push({ type: "browser-diagnostics", description: JSON.stringify(diagnostics) });

  expect(pageErrors, `uncaught browser errors: ${JSON.stringify(diagnostics)}`).toEqual([]);
  const backendFailures = failedRequests.filter((entry) => entry.includes("/api/"));
  expect(backendFailures, `API requests failed; start backend on 127.0.0.1:3002. Diagnostics: ${JSON.stringify(diagnostics)}`).toEqual([]);
  expect(rendering.canvasCount, `no canvas was created: ${JSON.stringify({ rendering, diagnostics })}`).toBeGreaterThan(0);
  expect(rendering.webglContexts, `no WebGL context was created: ${JSON.stringify({ rendering, diagnostics })}`).toBeGreaterThan(0);
});
