import * as THREE from "three";
import { ComponentTypes } from "../ecs/components/ComponentTypes.ts";
import type { TransformComponent } from "../ecs/components/TransformComponent";

export interface HighlightEntity {
  getComponent<T>(type: string): T | null;
}

export interface HighlightSelectionSystem {
  getSelected(): HighlightEntity | null;
}

export class HighlightSystem {
  private readonly scene: THREE.Scene;
  private readonly selectionSystem: HighlightSelectionSystem;
  private readonly helper: THREE.Box3Helper;

  constructor(scene: THREE.Scene, selectionSystem: HighlightSelectionSystem) {
    this.scene = scene;
    this.selectionSystem = selectionSystem;
    this.helper = new THREE.Box3Helper(new THREE.Box3(), 0x31f7ff);
    this.helper.visible = false;
    this.scene.add(this.helper);
  }

  update(): void {
    const entity = this.selectionSystem.getSelected();
    if (!entity) {
      this.helper.visible = false;
      return;
    }

    const transform = entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
    if (!transform) {
      this.helper.visible = false;
      return;
    }
    transform.updateBBox();
    this.helper.box.copy(transform.bbox);
    this.helper.visible = true;
  }
}
