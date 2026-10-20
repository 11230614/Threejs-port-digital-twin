import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
try {
  const { TaskExecutionBridge } = await vite.ssrLoadModule("/src/tasks/TaskExecutionBridge.ts");
  const calls = [];
  let failNextEvent = false;
  let deferredTaskResponse;
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method: init.method ?? "GET", body });

    if (path === "/api/tasks" && init.method === "POST") {
      return jsonResponse(taskDto("server-1", "running"));
    }
    if (path === "/api/tasks/server-1/execution-events") {
      if (failNextEvent) {
        failNextEvent = false;
        return jsonResponse({ error: { message: "temporary failure" } }, 500);
      }
      return jsonResponse(taskDto("server-1", "running"));
    }
    if (path === "/api/tasks/server-1") {
      if (deferredTaskResponse) return deferredTaskResponse;
      return jsonResponse(taskDto("server-1", "completed"));
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const localTask = {
    id: "local-1",
    type: "TRANSPORT_CONTAINER",
    status: "WAITING",
    steps: ["等待", "运输"],
    currentStepIndex: 0,
    updatedAt: 0,
    from: { area: "A" },
    to: { area: "B", position: { x: 0, y: 0, z: 0 } },
    agvId: "agv-1",
    agvEntityId: "entity-1",
    containerId: "container-1",
  };
  const taskMap = new Map([[localTask.id, localTask]]);
  const patches = [];
  const taskStore = {
    taskMap,
    patchTask(id, patch) {
      patches.push({ id, patch });
      const task = taskMap.get(id);
      if (task) Object.assign(task, patch);
    },
  };

  const bridge = new TaskExecutionBridge({ taskStore, createLocal: () => localTask });
  assert.equal(await bridge.createAndStart("TRANSPORT_CONTAINER"), "local-1");
  const createCall = calls.find((call) => call.path === "/api/tasks");
  assert.equal(createCall.method, "POST");
  assert.equal(createCall.body.type, "TRANSPORT_CONTAINER");
  assert.deepEqual(createCall.body.parameters, {});
  assert.equal(typeof createCall.body.clientRequestId, "string");
  assert.deepEqual(patches[0], {
    id: "local-1",
    patch: { serverTaskId: "server-1", clientRequestId: createCall.body.clientRequestId },
  });

  bridge.flush();
  assert.equal(calls.filter((call) => call.path.endsWith("execution-events")).length, 0, "pending tasks do not emit execution events");

  localTask.status = "RUNNING";
  localTask.currentStepIndex = 1;
  failNextEvent = true;
  bridge.flush();
  await new Promise((resolve) => setImmediate(resolve));
  bridge.flush();
  await new Promise((resolve) => setImmediate(resolve));

  const executionEvents = calls.filter((call) => call.path.endsWith("execution-events")).map((call) => call.body);
  assert.equal(executionEvents.length, 2);
  assert.deepEqual(executionEvents[0], executionEvents[1], "a failed post rolls sequence/key back so the same event is retried");
  assert.deepEqual(executionEvents[1], {
    eventId: "server-1-1",
    sequence: 1,
    status: "running",
    stage: "运输",
    agvId: "agv-1",
    agvEntityId: "entity-1",
    containerId: "container-1",
  });

  await bridge.query();
  assert.deepEqual(patches.at(-1), {
    id: "local-1",
    patch: { serverStatus: "completed", serverStage: "done", serverTaskUpdatedAt: "2026-10-15T00:00:00.000Z" },
  });
  const eventCountAtCompletion = executionEvents.length;
  localTask.currentStepIndex = 0;
  bridge.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.path.endsWith("execution-events")).length, eventCountAtCompletion, "terminal server task is removed from bridge polling");

  const lifecycleBridge = new TaskExecutionBridge({ taskStore, createLocal: () => localTask });
  await lifecycleBridge.createAndStart("TRANSPORT_CONTAINER");
  let resolvePendingResponse;
  deferredTaskResponse = new Promise((resolve) => { resolvePendingResponse = resolve; });
  const patchCountBeforeStop = patches.length;
  const pendingQuery = lifecycleBridge.query();
  lifecycleBridge.stop();
  resolvePendingResponse(jsonResponse(taskDto("server-1", "completed")));
  await pendingQuery;
  deferredTaskResponse = undefined;
  assert.equal(patches.length, patchCountBeforeStop, "a query finishing after stop does not mutate the store");

  const startupError = new Error("local startup failed");
  const failedBridge = new TaskExecutionBridge({ taskStore, createLocal: () => { throw startupError; } });
  await assert.rejects(failedBridge.createAndStart("TRANSPORT_CONTAINER"), (error) => error === startupError);
  const startupEvent = calls.filter((call) => call.path.endsWith("execution-events")).at(-1).body;
  assert.deepEqual(startupEvent, {
    eventId: "server-1-1",
    sequence: 1,
    status: "failed",
    stage: "startup",
    failure: { code: "LOCAL_START_FAILED", message: "local startup failed" },
  });

  const emptyBridge = new TaskExecutionBridge({ taskStore, createLocal: () => null });
  await assert.rejects(emptyBridge.createAndStart("TRANSPORT_CONTAINER"), /本地任务执行器未就绪/);
  const emptyStartupEvent = calls.filter((call) => call.path.endsWith("execution-events")).at(-1).body;
  assert.equal(emptyStartupEvent.failure.message, "本地任务执行器未就绪");

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals = [];
  const cleared = [];
  globalThis.setInterval = (callback, delay) => {
    const handle = { callback, delay };
    intervals.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => cleared.push(handle);
  try {
    const timerBridge = new TaskExecutionBridge({ taskStore, createLocal: () => localTask });
    timerBridge.start();
    timerBridge.start();
    assert.deepEqual(intervals.map(({ delay }) => delay), [250, 1000], "repeated start does not register duplicate timers");
    timerBridge.stop();
    assert.equal(cleared.length, 2);
    assert.deepEqual(cleared, intervals);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  console.log("TaskExecutionBridge behavior checks passed (DTO mapping, event retry, startup failure, query completion, timer lifecycle).");
} finally {
  await vite.close();
}

function taskDto(id, status) {
  return {
    id,
    clientRequestId: "client-1",
    type: "TRANSPORT_CONTAINER",
    parameters: {},
    status,
    stage: status === "completed" ? "done" : null,
    agvId: null,
    agvEntityId: null,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    failure: null,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
