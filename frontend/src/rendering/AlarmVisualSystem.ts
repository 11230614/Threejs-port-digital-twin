import * as THREE from "three";
import type { AlarmSeverityValue } from "../domain/AlarmCatalog";
import { useAlarmStore } from "../stores/AlarmStore";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import type { EntityManager } from "../ecs/EntityManager";
import type { Entity } from "../ecs/Entity";
import type { TransformComponent } from "../ecs/components/TransformComponent";
import { AlarmMaterialVariants, type AlarmVariant } from "./AlarmMaterialVariants";

type Materials = THREE.Material | THREE.Material[];
interface Binding { entity: Entity; severity: AlarmSeverityValue; original: Materials; assigned: Materials; entries: AlarmVariant[] }

export class AlarmVisualSystem {
  private readonly alarmStore = useAlarmStore();
  private readonly variants = new AlarmMaterialVariants();
  private readonly bindings = new Map<THREE.Mesh, Binding>();
  private diagnosticUpdates = 0;
  private lastVisualizedEntityIds: string[] = [];
  private lastVisualizedSeverities: AlarmSeverityValue[] = [];
  private readonly unsubscribe: () => void;

  constructor(private readonly entityManager: EntityManager) {
    this.unsubscribe = entityManager.onBeforeRemove((entity) => this.releaseEntity(entity));
  }

  update(_dt: number, elapsedTime: number): void {
    const seen = new Set<THREE.Mesh>();
    this.lastVisualizedEntityIds = [];
    this.lastVisualizedSeverities = [];
    for (const entity of this.entityManager.getEntitiesWith(ComponentTypes.TRANSFORM)) {
      const alarm = this.alarmStore.getHighestActiveAlarmByEntityId(entity.id);
      if (!alarm) continue;
      const wrapper = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.wrapper;
      if (!wrapper) continue;
      wrapper.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.material) return;
        seen.add(mesh);
        const binding = this.bindings.get(mesh);
        if (binding && binding.severity === alarm.severity && this.isIntact(mesh, binding)) return;
        if (binding) this.restore(mesh, binding);
        const original = mesh.material;
        const entries = (Array.isArray(original) ? original : [original]).map((material) => this.variants.acquire(material, alarm.severity));
        const assigned = Array.isArray(original) ? entries.map((entry) => entry.material) : entries[0].material;
        mesh.material = assigned;
        this.bindings.set(mesh, { entity, severity: alarm.severity, original, assigned, entries });
      });
      this.lastVisualizedEntityIds.push(entity.id);
      this.lastVisualizedSeverities.push(alarm.severity);
    }
    // Includes removed children/models and entities no longer returned by ECS.
    for (const [mesh, binding] of this.bindings) if (!seen.has(mesh)) this.restore(mesh, binding);
    this.variants.updateFallback(elapsedTime);
    this.diagnosticUpdates++;
  }

  beforeRender({ elapsedTime }: { elapsedTime: number }): void { this.variants.beforeRender(elapsedTime); }

  private isIntact(mesh: THREE.Mesh, binding: Binding): boolean {
    const slots = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return mesh.material === binding.assigned && slots.length === binding.entries.length
      && slots.every((slot, i) => slot === binding.entries[i].material);
  }

  private restore(mesh: THREE.Mesh, binding: Binding): void {
    if (this.isIntact(mesh, binding)) mesh.material = binding.original;
    else if (Array.isArray(mesh.material)) {
      // A later owner may replace one slot in-place. Restore only our slots.
      mesh.material = mesh.material.map((slot, i) => slot === binding.entries[i]?.material ? binding.entries[i].original : slot);
    }
    this.bindings.delete(mesh);
    binding.entries.forEach((entry) => this.variants.release(entry));
  }

  releaseEntity(entity: Entity): void {
    for (const [mesh, binding] of this.bindings) if (binding.entity === entity) this.restore(mesh, binding);
  }

  dispose(): void {
    this.unsubscribe();
    for (const [mesh, binding] of this.bindings) this.restore(mesh, binding);
  }

  getDiagnosticSnapshot() {
    return { updates: this.diagnosticUpdates, visualizedEntityIds: [...this.lastVisualizedEntityIds],
      visualizedSeverities: [...this.lastVisualizedSeverities], boundMeshes: this.bindings.size, materials: this.variants.snapshot() };
  }
}
