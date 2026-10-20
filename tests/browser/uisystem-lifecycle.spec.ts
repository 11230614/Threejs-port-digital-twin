import { test, expect } from "@playwright/test";

test("UISystem renders, toggles cruise and removes its retained button listener on Runtime disposal", async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const root = page.locator(".dock-ui");
  const button = page.locator(".dock-ui__button");
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  await expect(root.locator("[data-selected-title]")).toHaveText("未选中资产");
  await expect(root.locator("[data-selected-speed]")).toHaveText("状态: --");
  await expect(root.locator("[data-selected-position]")).toHaveText("位置: --");
  await expect(button).toHaveText("启动自动巡航");
  const retainedButton = await button.elementHandle();
  expect(retainedButton).not.toBeNull();

  await button.click();
  await expect(button).toHaveText("停止自动巡航");
  await expect(button).toHaveClass(/is-active/);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("runtime-test-dispose")));
  await expect(root).toHaveCount(0);
  await retainedButton?.evaluate((element) => (element as HTMLButtonElement).click());

  // The retained detached node must no longer toggle local state or invoke the cruise callback.
  await expect.poll(() => retainedButton?.evaluate((element) => element.textContent)).toBe("停止自动巡航");
  expect(pageErrors).toEqual([]);
});
