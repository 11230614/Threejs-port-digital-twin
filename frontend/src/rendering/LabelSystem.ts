import type { Camera, Scene } from "three";
import type { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export interface LabelGroundSystem {
  updateLabels(): void;
}

export interface LabelSystemOptions {
  scene: Scene;
  camera: Camera;
  labelRenderer: CSS2DRenderer;
  groundSystem: LabelGroundSystem;
}

/** Coordinates GroundSystem label visibility updates with the CSS2D renderer. */
export class LabelSystem {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly groundSystem: LabelGroundSystem;

  constructor({ scene, camera, labelRenderer, groundSystem }: LabelSystemOptions) {
    this.scene = scene;
    this.camera = camera;
    this.labelRenderer = labelRenderer;
    this.groundSystem = groundSystem;
  }

  update(): void {
    this.groundSystem.updateLabels();
    this.labelRenderer.render(this.scene, this.camera);
  }
}
