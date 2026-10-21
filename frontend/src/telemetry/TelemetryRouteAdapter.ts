import * as THREE from "three";
import type { MotionRoadApi } from "../ecs/systems/MotionSystem";

/**
 * Boundary between backend telemetry coordinates and the scene navigation model.
 * Backend coordinates are treated as a measurement only. The adapter resolves
 * that measurement to the existing lane parameter (u), which is the same
 * representation used by the original local AGV motion.
 */
export class TelemetryRouteAdapter {
  constructor(private readonly roads: MotionRoadApi) {}

  resolveLaneProgress(laneId: string, position: { x: number; y: number; z: number }): number | null {
    const lane = this.roads.getLane(laneId);
    if (!lane || lane.length <= 0 || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
    return this.roads.getNearestU(laneId, new THREE.Vector3(position.x, position.y, position.z), 512);
  }

  isClosedLane(laneId: string): boolean {
    const lane = this.roads.getLane(laneId);
    return lane ? Boolean(this.roads.getRoad(lane.roadId)?.closed) : false;
  }
}
