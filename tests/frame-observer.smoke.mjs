import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { FrameObserver } = await vite.ssrLoadModule("/src/core/FrameObserver.ts");
  const errors = [];
  const order = [];
  const observer = new FrameObserver({ onError: (error) => errors.push(error) });
  let visualCalls = 0;
  let scanCalls = 0;

  observer.addTask({ name: "alarm-visual", interval: 100, priority: 4, update: () => { visualCalls += 1; order.push("visual"); } });
  const removeScan = observer.addTask({ name: "alarm-scan", interval: 500, priority: 8, update: () => { scanCalls += 1; order.push("scan"); } });
  observer.addTask({ name: "isolated-failure", interval: 0, priority: 1, update: () => { throw new Error("expected task failure"); } });

  for (let frame = 1; frame <= 5; frame += 1) observer.update(0.1, frame * 0.1);
  assert.equal(visualCalls, 5, "100ms task executes on every 100ms frame");
  assert.equal(scanCalls, 1, "500ms task executes only when its own interval expires");
  assert.equal(order.at(-2), "visual", "when both are due, priority 4 visual runs before priority 8 scan");
  assert.equal(order.at(-1), "scan");
  assert.equal(errors.length, 5, "task errors are reported for each run");
  assert.equal(observer.tasks.some((task) => task.name === "alarm-visual"), true, "a failing peer does not stop later tasks");

  removeScan();
  for (let frame = 6; frame <= 10; frame += 1) observer.update(0.1, frame * 0.1);
  assert.equal(scanCalls, 1, "removed task no longer runs");
  assert.equal(visualCalls, 10, "remaining task continues after peer removal");
  observer.clear();
  assert.equal(observer.tasks.length, 0, "clear removes all scheduled tasks");
  console.log("FrameObserver behavior checks passed (independent intervals, due-task priority, error isolation, removal, clear).");
} finally {
  await vite.close();
}
