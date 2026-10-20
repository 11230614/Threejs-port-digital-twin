import assert from "node:assert/strict";
import * as THREE from "three";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

setActivePinia(createPinia());
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const [{ AlarmVisualSystem }, { EntityManager }, { TransformComponent }, { ComponentTypes }, { useAlarmStore }, { AlarmSeverity, AlarmType }] = await Promise.all([
    vite.ssrLoadModule("/src/rendering/AlarmVisualSystem.ts"),
    vite.ssrLoadModule("/src/ecs/EntityManager.ts"),
    vite.ssrLoadModule("/src/ecs/components/TransformComponent.ts"),
    vite.ssrLoadModule("/src/ecs/components/ComponentTypes.ts"),
    vite.ssrLoadModule("/src/stores/AlarmStore.ts"),
    vite.ssrLoadModule("/src/domain/AlarmCatalog.ts"),
  ]);

  const manager = new EntityManager();
  const entity = manager.add(manager.createEntity("agv-alarm"));
  const material = new THREE.MeshStandardMaterial({ color: 0x808080, emissive: 0x000000, opacity: 0.8, transparent: true });
  const wrapper = new THREE.Group();
  wrapper.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  entity.addComponent(ComponentTypes.TRANSFORM, new TransformComponent(wrapper));
  const alarmStore = useAlarmStore();
  alarmStore.upsertAlarm({ type: AlarmType.AGV_STALLED, severity: AlarmSeverity.URGENT, assetId: "agv-asset", entityId: entity.id });

  const system = new AlarmVisualSystem(manager);
  system.update(0.016, 0.25);
  const mesh = wrapper.children[0];
  assert.notEqual(mesh.material, material, "alarm application clones shared material");
  assert.equal(mesh.userData.alarmMaterialState.length, 1);
  assert.notEqual(mesh.material.emissive.getHex(), 0);
  assert.ok(mesh.material.emissiveIntensity > 0);

  alarmStore.closeAlarm("AGV_STALLED:agv-asset");
  system.update(0.016, 0.5);
  assert.equal(mesh.material.color.getHex(), 0x808080);
  assert.equal(mesh.material.emissive.getHex(), 0x000000);
  assert.equal(mesh.material.opacity, 0.8);
  console.log("AlarmVisualSystem behavior checks passed (material isolation, pulse, restore).");
} finally {
  await vite.close();
}
