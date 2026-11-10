import * as THREE from "three";
import type { FrameContext } from "../core/FrameObserver";
import type { EntityManager } from "../ecs/EntityManager";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import type { AgvRadarComponent } from "../ecs/components/AgvRadarComponent";
import type { TransformComponent } from "../ecs/components/TransformComponent";
import { agvRadarFragmentShader, agvRadarVertexShader } from "./shaders/agvRadar";

interface RadarState {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  scanPhase: number;
  seen: boolean;
}

/** Owns only radar resources. The business component never owns Three objects. */
export class AgvRadarEffectSystem {
  readonly group = new THREE.Group();
  readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly states = new Map<string, RadarState>();
  private readonly anchor = new THREE.Vector3();
  private readonly unsubscribe: () => void;
  private disposed = false;
  private created = 0;
  private released = 0;

  constructor(private readonly manager: EntityManager, private readonly scene: THREE.Scene) {
    this.group.name = "agv-radar-effects";
    // Keep a world-aligned effect root, including when the scene has a transform.
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    this.unsubscribe = manager.onBeforeRemove((entity) => this.remove(entity.id));
  }

  beforeRender({ deltaTime }: Pick<FrameContext, "deltaTime">): void {
    if (this.disposed) return;
    this.scene.updateWorldMatrix(true, false);
    this.group.matrix.copy(this.scene.matrixWorld).invert();
    this.group.updateWorldMatrix(false, false);
    for (const state of this.states.values()) state.seen = false;
    // Iterate the radar component store, rather than all port entities.
    const components = this.manager.componentStores.get(ComponentTypes.AGV_RADAR);
    if (components) for (const [id, value] of components) {
      const entity = this.manager.getById(id);
      const transform = entity?.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
      if (!entity?.hasComponent(ComponentTypes.AGV) || !transform) continue;
      const config = value as AgvRadarComponent;
      let state = this.states.get(id);
      // Don't allocate GPU resources for devices that have never enabled radar.
      if (!state && !config.enabled) continue;
      if (!state) { state = this.create(id); this.states.set(id, state); }
      state.seen = true;
      state.mesh.visible = config.enabled && Number.isFinite(config.radius) && config.radius > 0;
      if (!state.mesh.visible) continue; // Disabled scans pause (no catch-up on enable).
      if (Number.isFinite(config.angularSpeed) && Number.isFinite(deltaTime) && deltaTime >= 0) {
        state.scanPhase = THREE.MathUtils.euclideanModulo(state.scanPhase + config.angularSpeed * deltaTime, Math.PI * 2);
        if (config.angularSpeed !== 0) state.mesh.material.uniforms.uDirection!.value = Math.sign(config.angularSpeed);
      }
      transform.wrapper.updateWorldMatrix(true, false);
      this.anchor.copy(transform.groundAnchor).applyMatrix4(transform.wrapper.matrixWorld);
      state.mesh.position.copy(this.anchor);
      state.mesh.position.y += 0.12; // World-space lift above the road; no model-scale inheritance.
      state.mesh.scale.set(config.radius * 2, config.radius * 2, 1);
      state.mesh.material.uniforms.uScanPhase!.value = state.scanPhase;
    }
    for (const [id, state] of this.states) if (!state.seen) this.remove(id);
  }

  getDiagnosticSnapshot() {
    return { created: this.created, released: this.released, live: this.states.size, geometryDisposed: this.disposed,
      radars: [...this.states].map(([entityId, state]) => ({ entityId, visible: state.mesh.visible,
        scanPhase: state.scanPhase, radius: state.mesh.scale.x / 2, position: state.mesh.position.toArray(), materialUuid: state.mesh.material.uuid })) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.unsubscribe();
    for (const id of this.states.keys()) this.remove(id);
    this.group.removeFromParent();
    this.geometry.dispose();
    this.disposed = true;
  }

  private create(id: string): RadarState {
    const material = new THREE.ShaderMaterial({
      name: `agv-radar-${id}`, vertexShader: agvRadarVertexShader, fragmentShader: agvRadarFragmentShader,
      uniforms: { uScanPhase: { value: 0 }, uDirection: { value: 1 }, uColor: { value: new THREE.Color(0x21deb0) } },
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = `agv-radar-${id}`;
    mesh.rotation.x = -Math.PI / 2; // PlaneGeometry XY → XZ, normal +Y.
    mesh.raycast = () => {}; // This decorative plane must not intercept device picking.
    this.group.add(mesh); this.created++;
    return { mesh, scanPhase: 0, seen: true };
  }

  private remove(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    state.mesh.removeFromParent(); state.mesh.material.dispose();
    this.states.delete(id); this.released++;
  }
}
