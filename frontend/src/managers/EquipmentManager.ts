// ============================================================================
// EquipmentManager.js —— 设备查询与位置管理器。原文件职责说明保留在文件最开始。
// ============================================================================

import * as THREE from "three";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

export interface RTGPoint { id: string; area: string; position: THREE.Vector3 }
export class EquipmentManager {
  readonly rtgPoints: readonly RTGPoint[];
  readonly chargerPosition = new THREE.Vector3(420, 0.2, -176);
  readonly shipPosition = new THREE.Vector3(0, 0.2, 62);
  readonly berthPosition = new THREE.Vector3(0, 0.2, 30);
  constructor(private readonly entityManager: EntityManager) {
    this.rtgPoints = [
      { id: "RTG-A01", area: "A01", position: new THREE.Vector3(-330, 0.2, -220) },
      { id: "RTG-A15", area: "A15", position: new THREE.Vector3(-250, 0.2, -220) },
      { id: "RTG-B01", area: "B01", position: new THREE.Vector3(-110, 0.2, -220) },
      { id: "RTG-C01", area: "C01", position: new THREE.Vector3(110, 0.2, -220) },
      { id: "RTG-D01", area: "D01", position: new THREE.Vector3(330, 0.2, -220) },
    ];
  }
  getAGVs(): Entity[] { return this.entityManager.getEntitiesWith(ComponentTypes.TRANSFORM, ComponentTypes.MOTION, ComponentTypes.AGV); }
  getCranes(): Entity[] { return this.entityManager.getEntitiesWith(ComponentTypes.TRANSFORM, ComponentTypes.CRANE); }
  getAvailableAGV(index = 0): Entity | null { const agvs = this.getAGVs(); return agvs[index % Math.max(agvs.length, 1)] ?? null; }
  getAvailableCrane(index = 0): Entity | null { const cranes = this.getCranes(); return cranes[index % Math.max(cranes.length, 1)] ?? null; }
  getRTG(index = 0): RTGPoint { return this.rtgPoints[index % this.rtgPoints.length]; }
  getRTGByArea(area: string): RTGPoint { return this.rtgPoints.find((rtg) => rtg.area === area) ?? this.rtgPoints[0]; }
}
