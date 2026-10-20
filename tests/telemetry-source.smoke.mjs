import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { RandomTelemetrySource } = await vite.ssrLoadModule("/src/telemetry/RandomTelemetrySource.ts");
  const { createTelemetrySource, normalizeIncomingTelemetry } = await vite.ssrLoadModule("/src/telemetry/TelemetryGateway.ts");
  const assets = [{ id: "AGV-01", type: "AGV", entityId: null }];
  const assetManager = { getAll: () => assets };
  const entityManager = { getById: () => undefined };
  const source = new RandomTelemetrySource({ assetManager, entityManager, interval: 250 });
  const messages = [];
  const unsubscribe = source.subscribe((message) => messages.push(message));

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers = [];
  const cleared = [];
  globalThis.setInterval = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => cleared.push(timer);
  try {
    source.start();
    source.start();
    assert.equal(messages.length, 1, "start publishes an initial snapshot");
    assert.equal(timers.length, 1, "repeated start does not register duplicate intervals");
    assert.equal(timers[0].delay, 250);
    timers[0].callback();
    assert.equal(messages.length, 2, "interval callback publishes another snapshot");
    assert.equal(messages[0].assetId, "AGV-01");
    assert.equal(messages[0].channel, "mock-websocket");
    assert.equal(typeof messages[0].taskProgress, "number");
    assert.equal(messages[0].entityId, null);
    const extraMessages = [];
    const removeExtraListener = source.subscribe((message) => extraMessages.push(message));
    removeExtraListener();
    timers[0].callback();
    assert.equal(extraMessages.length, 0, "unsubscribe removes a telemetry listener");
    source.stop();
    assert.deepEqual(cleared, timers, "stop clears the registered interval");
    source.stop();
    assert.equal(cleared.length, 1, "repeated stop does not clear twice");
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  const mqttSource = createTelemetrySource({ assetManager, entityManager, mode: "mock-mqtt" });
  const mqttMessages = [];
  mqttSource.subscribe((message) => mqttMessages.push(message));
  mqttSource.start();
  mqttSource.stop();
  assert.equal(mqttMessages[0].channel, "mock-mqtt");
  assert.deepEqual(normalizeIncomingTelemetry('{"assetId":"AGV-01"}'), { assetId: "AGV-01" });
  const object = { assetId: "AGV-02" };
  assert.equal(normalizeIncomingTelemetry(object), object, "object telemetry is passed through");
  unsubscribe();
  console.log("Telemetry source behavior checks passed (publish, subscription, timer lifecycle, channel selection, normalization).");
} finally {
  await vite.close();
}
