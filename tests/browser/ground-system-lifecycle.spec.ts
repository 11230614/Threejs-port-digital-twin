import { expect, test } from "@playwright/test";

interface GroundSystemSnapshot {
  rootObjectCount: number;
  dockAttached: boolean;
  waterAttached: boolean;
  roadGroupAttached: boolean;
  yardCount: number;
  containerCount: number;
  labelCount: number;
  waterTime: number;
  foamOffsetX: number;
  buoyPositionY: number;
  expectedBuoyPositionY: number;
  updateAddedObjects: number;
}

interface GroundSystemWindow extends Window {
  groundSystemHarness?: {
    THREE: typeof import("three");
    GroundSystem: typeof import("../../src/world/GroundSystem.ts").GroundSystem;
  };
}

async function loadHarness(page: import("@playwright/test").Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL ?? "http://127.0.0.1:5173"}/tests/browser/ground-system-harness.html`);
  await expect.poll(() => page.evaluate(() => Boolean((window as GroundSystemWindow).groundSystemHarness))).toBe(true);
  await expect.poll(() => page.evaluate(() => typeof (window as GroundSystemWindow).groundSystemHarness?.GroundSystem === "function")).toBe(true);
}

test("GroundSystem 创建真实港口场景清单并按既有契约更新水面、泡沫和浮标", async ({ page, baseURL }) => {
  await loadHarness(page, baseURL);

  const snapshot = await page.evaluate((): GroundSystemSnapshot => {
    const harness = (window as GroundSystemWindow).groundSystemHarness;
    if (!harness) throw new Error("GroundSystem harness did not load");

    const scene = new harness.THREE.Scene();
    const ground = new harness.GroundSystem(scene);
    const result = ground.create();
    const rootObjectCount = scene.children.length;
    const buoy = ground.buoys[0];
    const phase = buoy.userData.phase as number;
    const initialWaterTime = ground.water.material.uniforms.time.value as number;

    ground.update(0.5, 10);

    return {
      rootObjectCount,
      dockAttached: result.dock.parent === scene && result.dock.name === "dock-ground",
      waterAttached: result.water.parent === scene && result.water === ground.water,
      roadGroupAttached: result.roadSystem.group.parent === scene,
      yardCount: result.yards.length,
      containerCount: result.containerCount,
      labelCount: ground.yardLabels.length,
      waterTime: ground.water.material.uniforms.time.value as number,
      foamOffsetX: ground.foamTexture.offset.x,
      buoyPositionY: buoy.position.y,
      expectedBuoyPositionY: Math.sin(10 * 0.8 + phase) * 0.4,
      updateAddedObjects: scene.children.length - rootObjectCount,
    };
  });

  expect(snapshot.dockAttached).toBe(true);
  expect(snapshot.waterAttached).toBe(true);
  expect(snapshot.roadGroupAttached).toBe(true);
  expect(snapshot.yardCount).toBeGreaterThan(0);
  expect(snapshot.containerCount).toBeGreaterThan(0);
  expect(snapshot.labelCount).toBe(snapshot.yardCount);
  expect(snapshot.waterTime).toBeCloseTo(0.5);
  expect(snapshot.foamOffsetX).toBeCloseTo(0.4);
  expect(snapshot.buoyPositionY).toBeCloseTo(snapshot.expectedBuoyPositionY);
  expect(snapshot.updateAddedObjects).toBe(0);
});

test("GroundSystem 重复 create 幂等，失败回滚且可重试，并支持幂等销毁", async ({ page, baseURL }) => {
  await loadHarness(page, baseURL);

  const result = await page.evaluate(() => {
    const harness = (window as GroundSystemWindow).groundSystemHarness;
    if (!harness) throw new Error("GroundSystem harness did not load");

    const scene = new harness.THREE.Scene();
    const ground = new harness.GroundSystem(scene);
    const firstResult = ground.create();
    const firstWater = ground.water;
    const firstCount = scene.children.length;
    const secondResult = ground.create();

    const failureScene = new harness.THREE.Scene();
    const failureGround = new harness.GroundSystem(failureScene);
    const add = failureScene.add;
    let addCalls = 0;
    failureScene.add = function (...objects) {
      addCalls += 1;
      if (addCalls === 7) throw new Error("injected dock attachment failure");
      return add.apply(this, objects);
    };

    let failureMessage = "";
    try {
      failureGround.create();
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }
    failureScene.add = add;

    const sentinel = new harness.THREE.Object3D();
    sentinel.name = "unrelated-sentinel";
    failureScene.add(sentinel);
    const beforeFailure = failureScene.children.length;
    return {
      repeatedCreateIdempotent: scene.children.length === firstCount,
      sameCreateResult: firstResult === secondResult,
      previousWaterStillAttached: firstWater.parent === scene,
      sameWaterReference: firstWater === ground.water,
      failureMessage,
      sentinelPreserved: sentinel.parent === failureScene,
      partialFailureRootObjects: failureScene.children.length,
      failureCleaned: failureGround.water === null && failureGround.foamTexture === null,
      retrySucceeded: Boolean(failureGround.create()?.water),
      retryRootObjects: failureScene.children.length,
      destroyAvailable: typeof ground.destroy === "function",
    };
  });

  expect(result.repeatedCreateIdempotent).toBe(true);
  expect(result.sameCreateResult).toBe(true);
  expect(result.previousWaterStillAttached).toBe(true);
  expect(result.sameWaterReference).toBe(true);
  expect(result.failureMessage).toBe("injected dock attachment failure");
  expect(result.sentinelPreserved).toBe(true);
  expect(result.partialFailureRootObjects).toBe(1);
  expect(result.failureCleaned).toBe(true);
  expect(result.retrySucceeded).toBe(true);
  expect(result.retryRootObjects).toBeGreaterThan(1);
  expect(result.destroyAvailable).toBe(true);

  const disposal = await page.evaluate(() => {
    const harness = (window as GroundSystemWindow).groundSystemHarness;
    if (!harness) throw new Error("GroundSystem harness did not load");
    const scene = new harness.THREE.Scene();
    const sentinel = new harness.THREE.Object3D();
    scene.add(sentinel);
    const ground = new harness.GroundSystem(scene);
    ground.create();
    const dock = ground._createResult.dock;
    const foamTexture = ground.foamTexture;
    let geometryDisposed = false;
    let materialDisposed = false;
    let foamTextureDisposed = false;
    dock.geometry.addEventListener("dispose", () => { geometryDisposed = true; });
    dock.material.addEventListener("dispose", () => { materialDisposed = true; });
    foamTexture.addEventListener("dispose", () => { foamTextureDisposed = true; });
    ground.destroy();
    ground.destroy();
    if (sentinel.parent !== scene) throw new Error("destroy removed unrelated scene object");
    if (scene.children.length !== 1) throw new Error("destroy left GroundSystem objects attached");
    if (ground.water !== null || ground.buoys.length !== 0) throw new Error("destroy kept runtime references");
    let message = "";
    try { ground.create(); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    if (message !== "GroundSystem has been destroyed") throw new Error(`unexpected recreate result: ${message}`);
    return { geometryDisposed, materialDisposed, foamTextureDisposed };
  });
  expect(disposal.geometryDisposed).toBe(true);
  expect(disposal.materialDisposed).toBe(true);
  expect(disposal.foamTextureDisposed).toBe(true);
});
