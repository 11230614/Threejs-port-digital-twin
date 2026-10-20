import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  setActivePinia(createPinia());
  const { AlarmSystem } = await vite.ssrLoadModule("/src/ecs/systems/AlarmSystem.ts");
  const { useAssetStore } = await vite.ssrLoadModule("/src/stores/AssetStore.ts");
  const { useAlarmStore } = await vite.ssrLoadModule("/src/stores/AlarmStore.ts");
  const assets = [];
  const makeAsset = (id, number, type) => { const asset = { id, number, type, area: "测试区域", entityId: `entity-${id}` }; assets.push(asset); return asset; };
  const asset = makeAsset("agv-alarm-1", "AGV-ALARM-01", "AGV");
  const offline = makeAsset("agv-offline", "AGV-OFFLINE", "AGV");
  const boundary = makeAsset("agv-boundary", "AGV-BOUNDARY", "AGV");
  const stalled = makeAsset("agv-stalled", "AGV-STALLED", "AGV");
  const congestionAgv1 = makeAsset("agv-congestion-1", "AGV-CONGESTION-1", "AGV");
  const congestionAgv2 = makeAsset("agv-congestion-2", "AGV-CONGESTION-2", "AGV");
  const congestionAgv3 = makeAsset("agv-congestion-3", "AGV-CONGESTION-3", "AGV");
  const road = makeAsset("road-alarm", "ROAD-ALARM", "ROAD");
  const crane = makeAsset("crane-alarm", "CRANE-ALARM", "CRANE");
  const container = makeAsset("container-alarm", "CONTAINER-ALARM", "CONTAINER");
  const noEntityId = { id: "agv-no-entity-id", number: "AGV-NO-ENTITY-ID", type: "AGV", area: "测试区域" };
  const orphan = { id: "agv-orphan", number: "AGV-ORPHAN", type: "AGV", area: "测试区域", entityId: "entity-not-in-manager" };
  const noComponents = { id: "agv-no-components", number: "AGV-NO-COMPONENTS", type: "AGV", area: "测试区域", entityId: "entity-without-components" };
  assets.push(orphan);
  assets.push(noComponents);
  assets.push(noEntityId);
  const assetStore = useAssetStore();
  const alarmStore = useAlarmStore();
  assets.forEach((item) => assetStore.registerAsset(item));
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const telemetry = (id, data) => {
    assetStore.updateTelemetry(id, { timestamp: now, onlineStatus: "ONLINE", speed: 20, taskProgress: 1, ...data });
  };
  const getAlarm = (type, assetId) => alarmStore.alarms.find((alarm) => alarm.type === type && alarm.assetId === assetId);
  try {
    const emptySystem = new AlarmSystem({ assetManager: { getAll: () => [] }, entityManager: {} });
    assert.doesNotThrow(() => emptySystem.update(), "an empty asset list is a valid no-op");
    const system = new AlarmSystem({ assetManager: { getAll: () => assets }, entityManager: { getById: (id) => id === noComponents.entityId ? {} : undefined } });

    telemetry(orphan.id, { battery: 10 });
    assert.doesNotThrow(() => system.update(), "assets without an entity id remain scannable");
    assert.equal(getAlarm("AGV_LOW_BATTERY", orphan.id)?.entityId, orphan.entityId, "rule evaluation does not require the referenced Entity to exist");

    telemetry(noEntityId.id, { battery: 10 });
    system.update();
    assert.equal(getAlarm("AGV_LOW_BATTERY", noEntityId.id)?.entityId, undefined, "an absent entityId remains absent in the alarm snapshot");

    telemetry(noComponents.id, { battery: 10 });
    assert.doesNotThrow(() => system.update(), "an existing Entity with no ECS Components does not block asset telemetry rules");
    assert.equal(getAlarm("AGV_LOW_BATTERY", noComponents.id)?.entityId, noComponents.entityId);

    const noTelemetry = makeAsset("agv-no-telemetry", "AGV-NO-TELEMETRY", "AGV");
    assetStore.registerAsset(noTelemetry);
    assert.doesNotThrow(() => system.update(), "missing telemetry does not throw");
    assert.equal(getAlarm("DEVICE_OFFLINE", noTelemetry.id), undefined, "unknown telemetry is not treated as offline");

    telemetry(asset.id, { battery: 10 });
    system.update();
    const first = getAlarm("AGV_LOW_BATTERY", asset.id);
    assert.equal(first?.severity, "SEVERE");
    const firstId = first?.id;
    telemetry(asset.id, { battery: 8, taskProgress: 2 });
    system.update();
    assert.equal(getAlarm("AGV_LOW_BATTERY", asset.id)?.id, firstId, "repeated rule uses the same alarm key");
    telemetry(asset.id, { battery: 80, taskProgress: 3 });
    system.update();
    const clearedBattery = getAlarm("AGV_LOW_BATTERY", asset.id);
    assert.equal(clearedBattery?.status, "CLOSED");
    assert.ok(clearedBattery?.closedAt, "automatic clear keeps a closed history timestamp");
    assert.equal(alarmStore.activeAlarms.some((alarm) => alarm.id === clearedBattery?.id), false);

    telemetry(offline.id, { battery: 80, onlineStatus: "OFFLINE" });
    system.update();
    assert.equal(getAlarm("DEVICE_OFFLINE", offline.id)?.severity, "URGENT");
    telemetry(offline.id, { battery: 80, onlineStatus: "ONLINE" });
    system.update();
    assert.equal(getAlarm("DEVICE_OFFLINE", offline.id)?.status, "CLOSED");

    telemetry(boundary.id, { battery: 25 });
    system.update();
    assert.equal(getAlarm("AGV_LOW_BATTERY", boundary.id)?.severity, "WARNING");
    telemetry(boundary.id, { battery: undefined });
    system.update();
    assert.equal(getAlarm("AGV_LOW_BATTERY", boundary.id)?.status, "ACTIVE", "missing battery does not clear an existing low-battery alarm");

    telemetry(stalled.id, { battery: 80, speed: 0, taskProgress: 0 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", stalled.id), undefined);
    now += 2_999;
    telemetry(stalled.id, { battery: 80, speed: 0, taskProgress: 0 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", stalled.id), undefined, "stalled rule is debounced");
    telemetry(stalled.id, { battery: 80, speed: 20, taskProgress: 1 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", stalled.id), undefined, "temporary recovery clears the pending stalled state");
    now += 2_999;
    telemetry(stalled.id, { battery: 80, speed: 0, taskProgress: 1 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", stalled.id), undefined, "a new stall starts a fresh debounce window");
    now += 3_001;
    telemetry(stalled.id, { battery: 80, speed: 0, taskProgress: 1 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", stalled.id)?.severity, "SEVERE");
    telemetry(stalled.id, { battery: 80, speed: 20, taskProgress: 1 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", stalled.id)?.status, "CLOSED");

    telemetry(congestionAgv1.id, { battery: 80, speed: 0 });
    telemetry(congestionAgv2.id, { battery: 80, speed: 0 });
    telemetry(congestionAgv3.id, { battery: 80, speed: 0 });
    system.update();
    assert.equal(getAlarm("PATH_CONGESTION", road.id)?.severity, "WARNING");
    telemetry(congestionAgv1.id, { battery: 80, speed: 20 });
    telemetry(congestionAgv2.id, { battery: 80, speed: 20 });
    system.update();
    assert.equal(getAlarm("PATH_CONGESTION", road.id)?.status, "CLOSED");

    telemetry(crane.id, { alarmLevel: "WARNING" });
    system.update();
    assert.equal(getAlarm("CRANE_EXCEPTION", crane.id)?.severity, "SEVERE");
    telemetry(crane.id, { alarmLevel: "NORMAL" });
    system.update();
    assert.equal(getAlarm("CRANE_EXCEPTION", crane.id)?.status, "CLOSED");

    telemetry(container.id, { containerConflict: true });
    system.update();
    assert.equal(getAlarm("CONTAINER_STACK_CONFLICT", container.id)?.severity, "SEVERE");
    telemetry(container.id, { containerConflict: false });
    system.update();
    assert.equal(getAlarm("CONTAINER_STACK_CONFLICT", container.id)?.status, "CLOSED");

    const reloaded = makeAsset("agv-reloaded", "AGV-RELOADED", "AGV");
    assetStore.registerAsset(reloaded);
    telemetry(reloaded.id, { battery: 80, speed: 0, taskProgress: 0 });
    system.update();
    assets.splice(assets.indexOf(reloaded), 1);
    now += 5_000;
    system.update();
    assets.push(reloaded);
    telemetry(reloaded.id, { battery: 80, speed: 0, taskProgress: 0 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", reloaded.id), undefined, "a reloaded business ID starts a fresh debounce window");
    now += 2_999;
    telemetry(reloaded.id, { battery: 80, speed: 0, taskProgress: 0 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", reloaded.id), undefined);
    now += 1;
    telemetry(reloaded.id, { battery: 80, speed: 0, taskProgress: 0 });
    system.update();
    assert.equal(getAlarm("AGV_STALLED", reloaded.id)?.severity, "SEVERE");

    const removedFromManager = assets.indexOf(container);
    assets.splice(removedFromManager, 1);
    system.update();
    assert.equal(getAlarm("CONTAINER_STACK_CONFLICT", container.id)?.status, "CLOSED", "removed assets retain their historical closed state");
    console.log("AlarmSystem behavior checks passed (six rules, missing Entity/Components, debounce lifecycle, aggregation, upsert identity, automatic clear).");
  } finally {
    Date.now = originalNow;
  }
} finally {
  await vite.close();
}
