import { test, expect } from "@playwright/test";

interface SpatialSnapshot {
  name: string;
  detail: {
    camera?: { x: number; y: number; z: number };
    chunks?: { activeChunks?: number; visibleActiveChunks?: number };
    lod?: { trackedChunks?: number; switches?: number; levels?: Record<string, number> };
    spatialRender?: { appliedTransitions?: number; appliedItems?: number };
    road?: { trackedChunks?: number; visibleProxies?: number; switches?: number } | null;
    containers?: { totalContainers?: number; loadedChunks?: number; visibleInstances?: number; drawBatches?: number; lodCounts?: Record<string, number> } | null;
    renderer?: { calls?: number; triangles?: number };
  };
}

test("真实相机移动驱动道路 LOD、容器实例批次和 renderer 观测", async ({ page, baseURL }) => {
  const snapshots: SpatialSnapshot[] = [];
  const renderedFrames: Array<{ calls?: number; triangles?: number }> = [];
  const pageErrors: string[] = [];
  await page.exposeFunction("recordSpatialSnapshot", (event: SpatialSnapshot) => snapshots.push(event));
  await page.exposeFunction("recordRenderedFrame", (event: { renderer?: { calls?: number; triangles?: number } }) => renderedFrames.push(event.renderer ?? {}));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener("spatial-render-snapshot", (event) => {
      void (window as Window & { recordSpatialSnapshot?: (value: unknown) => Promise<void> })
        .recordSpatialSnapshot?.({ name: "spatial-render-snapshot", detail: (event as CustomEvent).detail });
    });
    window.addEventListener("runtime-frame", (event) => {
      void (window as Window & { recordRenderedFrame?: (value: unknown) => Promise<void> })
        .recordRenderedFrame?.((event as CustomEvent).detail ?? {});
    });
  });

  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect.poll(() => snapshots.length, { timeout: 30_000 }).toBeGreaterThan(0);

  const initial = snapshots.at(-1)?.detail;
  expect(initial?.road).not.toBeNull();
  expect(initial?.containers).not.toBeNull();
  expect(Number(initial?.containers?.totalContainers ?? 0)).toBeGreaterThan(0);
  await expect.poll(() => renderedFrames.some((frame) => Number(frame.calls ?? 0) > 0), { timeout: 10_000 }).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-camera", {
    detail: { position: { x: 5000, y: 220, z: 5000 }, lookAt: { x: 0, y: 0, z: 0 } },
  })));
  await expect.poll(() => snapshots.some((snapshot) => snapshot.detail.camera?.x === 5000), { timeout: 10_000 }).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-camera", {
    detail: { position: { x: 380, y: 220, z: 360 }, lookAt: { x: 0, y: 0, z: 0 } },
  })));
  await expect.poll(() => snapshots.some((snapshot) => snapshot.detail.camera?.x === 380), { timeout: 10_000 }).toBe(true);

  const final = snapshots.at(-1)?.detail;
  expect(Number(final?.lod?.switches ?? 0)).toBeGreaterThan(0);
  expect(Number(final?.spatialRender?.appliedTransitions ?? 0)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: "test-results/spatial-rendering-success.png", fullPage: true });
});
