import { test, expect } from "@playwright/test";

test("initializes PortRuntime, loads assets, creates entities, starts systems and frames", async ({ page, baseURL }) => {
  const events: Array<{ name: string; detail: Record<string, unknown> }> = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`));
  await page.exposeFunction("recordRuntimeDiagnostic", (event: { name: string; detail: Record<string, unknown> }) => events.push(event));
  await page.addInitScript(() => {
    const names = ["runtime-initialization-started", "assets-loaded", "initial-entities-created", "systems-started", "runtime-ready", "runtime-initialization-failed", "runtime-frame"];
    for (const name of names) window.addEventListener(name, (event) => {
      const detail = (event as CustomEvent).detail ?? {};
      void (window as Window & { recordRuntimeDiagnostic?: (event: unknown) => Promise<void> }).recordRuntimeDiagnostic?.({ name, detail });
    });
  });
  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("#app")).toBeVisible();
  await expect.poll(() => events.some((event) => event.name === "runtime-ready"), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => events.some((event) => event.name === "runtime-frame"), { timeout: 10_000 }).toBe(true);
  const names = events.map((event) => event.name);
  expect(names.indexOf("runtime-initialization-started")).toBeGreaterThanOrEqual(0);
  expect(names.indexOf("assets-loaded")).toBeGreaterThan(names.indexOf("runtime-initialization-started"));
  expect(names.indexOf("initial-entities-created")).toBeGreaterThan(names.indexOf("assets-loaded"));
  expect(names.indexOf("systems-started")).toBeGreaterThan(names.indexOf("initial-entities-created"));
  expect(names.indexOf("runtime-ready")).toBeGreaterThan(names.indexOf("systems-started"));
  expect(events.some((event) => event.name === "runtime-initialization-failed")).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(failedRequests.filter((entry) => entry.includes("/api/")).length).toBe(0);
  const ready = events.find((event) => event.name === "runtime-ready");
  expect(Number(ready?.detail.entities ?? 0)).toBeGreaterThan(0);
});
