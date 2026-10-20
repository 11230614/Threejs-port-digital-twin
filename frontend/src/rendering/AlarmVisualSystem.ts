import * as THREE from "three";
import { AlarmSeverity, type AlarmSeverityValue } from "../domain/AlarmCatalog";
import { useAlarmStore } from "../stores/AlarmStore";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import type { EntityManager } from "../ecs/EntityManager";
import type { Entity } from "../ecs/Entity";
import type { TransformComponent } from "../ecs/components/TransformComponent";

interface AlarmMaterial extends THREE.Material {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
}

interface AlarmMaterialState {
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  emissiveIntensity: number;
  opacity: number;
}

interface AlarmUserData {
  [key: string]: unknown;
  alarmMaterialState?: AlarmMaterialState[];
}

type AlarmMesh = THREE.Mesh & { userData: AlarmUserData };

const SEVERITY_COLORS: Readonly<Record<AlarmSeverityValue, THREE.Color>> = Object.freeze({
  [AlarmSeverity.INFO]: new THREE.Color(0x68d7ff),
  [AlarmSeverity.WARNING]: new THREE.Color(0xffd45c),
  [AlarmSeverity.SEVERE]: new THREE.Color(0xff7a2f),
  [AlarmSeverity.URGENT]: new THREE.Color(0xff3333),
});

export class AlarmVisualSystem {
  private readonly entityManager: EntityManager;
  private readonly alarmStore: ReturnType<typeof useAlarmStore>;
  private diagnosticUpdates = 0;
  private lastVisualizedEntityIds: string[] = [];
  private lastVisualizedSeverities: AlarmSeverityValue[] = [];

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
    this.alarmStore = useAlarmStore();
  }

  update(_dt: number, elapsedTime: number): void {
    const visualizedEntityIds: string[] = [];
    const visualizedSeverities: AlarmSeverityValue[] = [];
    this.entityManager.getEntitiesWith(ComponentTypes.TRANSFORM).forEach((entity) => {
      const alarm = this.alarmStore.getHighestActiveAlarmByEntityId(entity.id);
      if (!alarm) {
        this.restoreEntity(entity);
        return;
      }

      this.applyAlarmColor(entity, alarm.severity, elapsedTime);
      visualizedEntityIds.push(entity.id);
      visualizedSeverities.push(alarm.severity);
    });
    this.diagnosticUpdates += 1;
    this.lastVisualizedEntityIds = visualizedEntityIds;
    this.lastVisualizedSeverities = visualizedSeverities;
  }

  /** Read-only primitive summary used by development browser diagnostics. */
  getDiagnosticSnapshot(): { updates: number; visualizedEntityIds: string[]; visualizedSeverities: AlarmSeverityValue[] } {
    return {
      updates: this.diagnosticUpdates,
      visualizedEntityIds: [...this.lastVisualizedEntityIds],
      visualizedSeverities: [...this.lastVisualizedSeverities],
    };
  }

  private applyAlarmColor(entity: Entity, severity: AlarmSeverityValue, elapsedTime: number): void {
    const color = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS[AlarmSeverity.INFO];
    const pulse = severity === AlarmSeverity.SEVERE || severity === AlarmSeverity.URGENT
      ? 0.45 + Math.abs(Math.sin(elapsedTime * 7)) * 0.55
      : 0.72;
    const transform = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
    if (!transform) return;

    transform.wrapper.traverse((child) => {
      if (!child.isMesh) return;
      const mesh = child as AlarmMesh;
      if (!mesh.material) return;
      this.ensureMaterialState(mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((value) => {
        const material = value as AlarmMaterial;
        if (material.color) material.color.copy(color).lerp(new THREE.Color(0xffffff), 1 - pulse);
        if (material.emissive) {
          material.emissive.copy(color);
          material.emissiveIntensity = severity === AlarmSeverity.URGENT ? 1.6 * pulse : 0.8 * pulse;
        }
        if (material.transparent) material.opacity = Math.max(material.opacity, 0.22 + pulse * 0.18);
      });
    });
  }

  private restoreEntity(entity: Entity): void {
    const transform = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
    if (!transform) return;
    transform.wrapper.traverse((child) => {
      if (!child.isMesh) return;
      const mesh = child as AlarmMesh;
      const states = mesh.userData.alarmMaterialState;
      if (!states) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((value, index) => {
        const material = value as AlarmMaterial;
        const state = states[index];
        if (!state) return;
        if (material.color && state.color) material.color.copy(state.color);
        if (material.emissive && state.emissive) {
          material.emissive.copy(state.emissive);
          material.emissiveIntensity = state.emissiveIntensity;
        }
        material.opacity = state.opacity;
      });
    });
  }

  private ensureMaterialState(mesh: AlarmMesh): void {
    if (mesh.userData.alarmMaterialState) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone());
    else mesh.material = mesh.material.clone();

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.userData.alarmMaterialState = materials.map((value) => {
      const material = value as AlarmMaterial;
      return {
        color: material.color?.clone() ?? null,
        emissive: material.emissive?.clone() ?? null,
        emissiveIntensity: material.emissiveIntensity ?? 0,
        opacity: material.opacity,
      };
    });
  }
}
